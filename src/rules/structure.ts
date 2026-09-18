import path from "node:path";
import { minimatch } from "minimatch";
import { visit } from "unist-util-visit";
import type { Paragraph, RootContent } from "mdast";
import type { Finding, Rule } from "../core/types.js";
import { range, textContent } from "../syntax/parse.js";
import { optionsSchema } from "./style.js";

function content(nodes: RootContent[]): RootContent[] {
  return nodes.filter((node) => !["yaml", "toml"].includes(node.type));
}
export const structureRules: Record<string, Rule> = {
  "structure/initial-heading": {
    description: "Require the first content block to be a level-1 heading.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const first = content(document.tree.children)[0];
      return first?.type === "heading" && first.depth === 1
        ? []
        : [
            {
              start: first ? range(first)[0] : 0,
              message: "Start the document with a level-1 heading after optional front matter.",
            },
          ];
    },
  },
  "structure/title-matches-filename": {
    description: "Require the first top-level title to match the filename stem.",
    kind: "problem",
    schema: optionsSchema({ ignore: { type: "array", items: { type: "string" } } }),
    check({ document, options }) {
      const filename = path.posix.basename(document.path.replaceAll("\\", "/"));
      const stem = path.posix.parse(filename).name;
      if (
        (options.ignore as string[] | undefined)?.some(
          (pattern) =>
            minimatch(filename, pattern, { dot: true }) || minimatch(stem, pattern, { dot: true }),
        )
      )
        return [];
      const title = document.tree.children.find(
        (node) => node.type === "heading" && node.depth === 1,
      );
      return title && textContent(title) === stem
        ? []
        : [
            {
              start: title ? range(title)[0] : 0,
              message: title
                ? `Title must match filename: ${stem}.`
                : `Missing level-1 title for ${filename}.`,
            },
          ];
    },
  },
  "structure/metadata-line": {
    description: "Require one matching metadata paragraph after the title and optional callout.",
    kind: "problem",
    schema: {
      ...optionsSchema({
        pattern: { type: "string", minLength: 1 },
        afterCallout: { type: "boolean" },
      }),
      required: ["pattern"],
    },
    check({ document, options }) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(String(options.pattern));
      } catch {
        throw new Error(
          "Invalid options for structure/metadata-line: pattern must be a valid regular expression.",
        );
      }
      const blocks = content(document.tree.children);
      const title = blocks[0];
      let index = 1;
      const next = blocks[index];
      if (
        options.afterCallout === true &&
        document.dialect === "obsidian" &&
        next?.type === "blockquote"
      ) {
        const first = next.children[0];
        if (
          first?.type === "paragraph" &&
          /^\[![\w-]+\]/.test(document.source.slice(...range(first)))
        )
          index++;
      }
      const expected = title?.type === "heading" && title.depth === 1 ? blocks[index] : undefined;
      const matches: { node: Paragraph; start: number; standalone: boolean }[] = [];
      visit(document.tree, "paragraph", (node) => {
        const [start, end] = range(node);
        const raw = document.source.slice(start, end);
        const protectedRanges: [number, number][] = [];
        visit(node, (child) => {
          if (["inlineCode", "html", "obsidianComment"].includes(child.type))
            protectedRanges.push(range(child));
        });
        let offset = start;
        for (const line of raw.split(/\r?\n/)) {
          if (
            pattern.test(line) &&
            !protectedRanges.some(([a, b]) => a < offset + line.length && b > offset)
          )
            matches.push({ node, start: offset, standalone: !/[\r\n]/.test(raw) });
          offset +=
            line.length + (document.source.slice(offset + line.length).startsWith("\r\n") ? 2 : 1);
        }
      });
      if (!matches.length)
        return [
          {
            start: title ? range(title)[1] : 0,
            message: "Missing metadata line matching the configured pattern.",
          },
        ];
      const findings: Finding[] = [];
      for (const [i, match] of matches.entries()) {
        if (i > 0) findings.push({ start: match.start, message: "Duplicate metadata line." });
        if (match.node !== expected || !match.standalone)
          findings.push({
            start: match.start,
            message:
              "Metadata must be a standalone paragraph immediately after the title and optional callout.",
          });
      }
      return findings;
    },
  },
  "style/accidental-marker": {
    description: "Report a possible accidental block marker immediately after top-level prose.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      const blocks = document.tree.children;
      for (let i = 1; i < blocks.length; i++) {
        const previous = blocks[i - 1]!;
        const block = blocks[i]!;
        if (
          previous.type !== "paragraph" ||
          !["list", "heading", "blockquote"].includes(block.type)
        )
          continue;
        if (
          previous.position!.start.column !== 1 ||
          previous.position!.end.line + 1 !== block.position!.start.line ||
          previous.position!.start.column !== block.position!.start.column ||
          textContent(previous).trimEnd().endsWith(":")
        )
          continue;
        // Restrict the heuristic to top-level paragraphs with no lazy quote/list
        // continuation or indentation. Blank-separated blocks never match.
        const prose = document.source.slice(...range(previous));
        if (prose.split(/\r?\n/).some((line) => /^\s/.test(line))) continue;
        findings.push({
          start: range(block)[0],
          message:
            "Possible accidental block marker after prose; add a blank line for an intentional block or rejoin the sentence.",
        });
      }
      return findings;
    },
  },
};
