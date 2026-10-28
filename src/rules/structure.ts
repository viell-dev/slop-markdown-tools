import type { Heading, Nodes, Root, RootContent } from "mdast";
import type { Document, Finding, Rule } from "../core/types.js";
import { range, startsWithMarker, textContent } from "../syntax/parse.js";
import { lineEnd, lineStart } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { obsidianTag, optionsSchema } from "./shared.js";

function content(nodes: RootContent[]): RootContent[] {
  return nodes.filter((node) => !["yaml", "toml"].includes(node.type));
}
/**
 * The headings of a document, in source order, as separate outlines: the
 * document's own, then one for each block quote and footnote. A block quote,
 * which is also how callouts and alerts are written, and a footnote stand
 * apart from the text around them, as they do in an HTML outline, so their
 * headings are checked among themselves and do not count for the document's.
 */
function outlines(tree: Root): Heading[][] {
  const document: Heading[] = [];
  const result = [document];
  const visit = (node: Nodes, outline: Heading[]) => {
    if (node.type === "heading") outline.push(node);
    if (!("children" in node)) return;
    for (const child of node.children)
      if (child.type === "blockquote" || child.type === "footnoteDefinition") {
        const own: Heading[] = [];
        result.push(own);
        visit(child, own);
      } else visit(child, outline);
  };
  visit(tree, document);
  return result;
}
const levelSchema = { type: "integer", minimum: 1, maximum: 6, default: 1 };
const titleSchema = {
  description:
    "True uses the default literal title field; a string matches front matter in multiline mode; false or an empty string disables it.",
  anyOf: [{ type: "boolean" }, { type: "string", format: "regex" }],
};
type TitleSetting = boolean | string;
/** Whether front matter contains a recognized title field or matches a configured pattern. */
function frontMatterTitle(tree: Root, setting: TitleSetting = true): boolean {
  if (setting === false || setting === "") return false;
  const pattern = typeof setting === "string" ? new RegExp(setting, "m") : undefined;
  return tree.children.some((node) => {
    // The tree's types know YAML front matter only; the parser also reads TOML.
    const { type, value } = node as { type: string; value?: string };
    if (pattern) return (type === "yaml" || type === "toml") && pattern.test(value ?? "");
    if (type === "yaml") return /^["']?title["']?[ \t]*:/m.test(value ?? "");
    if (type !== "toml") return false;
    // TOML keys after a table header belong to that table.
    const top = (value ?? "").split(/^[ \t]*\[/m, 1)[0]!;
    return /^[ \t]*["']?title["']?[ \t]*=/m.test(top);
  });
}
/** A heading's text as a reader sees it, with blank space collapsed. */
function headingText(node: Heading): string {
  return textContent(node).replace(/\s+/g, " ").trim();
}

/**
 * The offsets where paragraphs start a line that renderers would read as an
 * ATX heading if it started with one: each paragraph's first line, and, below
 * the line of an alert's or callout's marker, the line where its body starts.
 * Later lines of a paragraph can start with any word once it is wrapped, such
 * as an issue reference or a hashtag, so they are left out.
 */
function lineStartsOfParagraphs(document: Document): number[] {
  const { source } = document;
  const starts: number[] = [];
  walk(document.tree, "paragraph", (node, _index, parent) => {
    const [start, end] = range(node);
    starts.push(start);
    if (document.dialect === "commonmark" || parent?.type !== "blockquote") return;
    if (parent.children[0] !== node) return;
    const first = lineEnd(source, start);
    if (first >= end || !startsWithMarker(source.slice(start, first), node)) return;
    let at = first + (source.startsWith("\r\n", first) ? 2 : 1);
    // The body's line starts after its container's markers and indentation.
    while (at < end && (source[at] === ">" || source[at] === " " || source[at] === "\t")) at++;
    if (at < end) starts.push(at);
  });
  return starts;
}
/**
 * One to six `#` before what would be a heading's text after a space: a
 * letter or a digit, also after `*`, `_`, or a backtick that opens emphasis or
 * code. Other characters after `#` mark other notations, such as a shebang
 * (`#!`) or a keycap emoji.
 */
const unspacedHeading = /^(#{1,6})(?=[*_`]*[\p{L}\p{N}])/u;
/** A single `#` before a number alone, as in an issue reference such as `#123`. */
const numberReference = /^#\p{N}+(?![\p{L}\p{N}])/u;
/** A closing run of `#` that a space before it would make a closed heading's, not escaped. */
const closingRun = /(?:^|[^\\#])#+$/;

export const structureRules: Record<string, Rule> = {
  "structure/initial-heading": {
    description: "Require an initial heading at the configured level.",
    kind: "problem",
    schema: optionsSchema({
      level: levelSchema,
      allowPreamble: { type: "boolean", default: false },
      frontMatterTitle: { ...titleSchema, default: false },
    }),
    check({ document, options }) {
      if (frontMatterTitle(document.tree, (options.frontMatterTitle ?? false) as TitleSetting))
        return [];
      const level = (options.level as number | undefined) ?? 1;
      const blocks = content(document.tree.children);
      const first = options.allowPreamble
        ? blocks.find((node) => node.type === "heading")
        : blocks[0];
      return first?.type === "heading" && first.depth === level
        ? []
        : [
            {
              start: first ? range(first)[0] : blocks[0] ? range(blocks[0])[0] : 0,
              message: options.allowPreamble
                ? `Use a level-${level} heading as the first heading after any preamble or front matter.`
                : `Start the document with a level-${level} heading after optional front matter.`,
            },
          ];
    },
  },
  "structure/heading-increment": {
    description: "Report headings more than one level deeper than the heading before them.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      for (const outline of outlines(document.tree))
        for (let i = 1; i < outline.length; i++) {
          const previous = outline[i - 1]!.depth;
          const heading = outline[i]!;
          if (heading.depth > previous + 1)
            findings.push({
              start: range(heading)[0],
              message: `Heading level ${heading.depth} follows level ${previous}; use at most level ${previous + 1}.`,
            });
        }
      return findings;
    },
  },
  "structure/single-title": {
    description:
      "Report repeated title headings at the configured level, including front matter titles.",
    kind: "problem",
    schema: optionsSchema({
      level: levelSchema,
      frontMatterTitle: { ...titleSchema, default: true },
    }),
    check({ document, options }) {
      const level = (options.level as number | undefined) ?? 1;
      const findings: Finding[] = [];
      outlines(document.tree).forEach((outline, index) => {
        // Only the document's own outline has front matter.
        let title =
          index === 0 &&
          frontMatterTitle(document.tree, options.frontMatterTitle as TitleSetting | undefined)
            ? "the front matter sets the title"
            : undefined;
        for (const heading of outline) {
          if (heading.depth !== level) continue;
          if (title === undefined) {
            title = `the title is on line ${heading.position!.start.line}`;
            continue;
          }
          findings.push({
            start: range(heading)[0],
            message: `Use one level-${level} heading per document; ${title}.`,
          });
        }
      });
      return findings;
    },
  },
  "structure/duplicate-heading": {
    description: "Report repeated heading text among siblings or across an outline.",
    kind: "problem",
    schema: optionsSchema({ siblingsOnly: { type: "boolean", default: true } }),
    check({ document, options }) {
      const findings: Finding[] = [];
      for (const outline of outlines(document.tree)) {
        // The headings that a following heading can be under, from the outermost.
        const parents: Heading[] = [];
        // The texts of the headings under each parent so far, by parent.
        const seen = new Map<Heading | undefined, Map<string, Heading>>();
        for (const heading of outline) {
          while (parents.length && parents.at(-1)!.depth >= heading.depth) parents.pop();
          const parent = options.siblingsOnly === false ? undefined : parents.at(-1);
          parents.push(heading);
          const text = headingText(heading);
          if (!text) continue;
          let siblings = seen.get(parent);
          if (!siblings) seen.set(parent, (siblings = new Map<string, Heading>()));
          const earlier = siblings.get(text);
          if (earlier)
            findings.push({
              start: range(heading)[0],
              message: `Heading "${text}" repeats the heading on line ${earlier.position!.start.line} ${options.siblingsOnly === false ? "in this outline" : "under the same parent"}; give it a distinct name.`,
            });
          else siblings.set(text, heading);
        }
      }
      return findings;
    },
  },
  "structure/unspaced-heading": {
    description: "Report paragraph text that would be an ATX heading with a space after its #.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const { source } = document;
      const findings: Finding[] = [];
      for (const start of lineStartsOfParagraphs(document)) {
        const line = source.slice(start, lineEnd(source, start)).trimEnd();
        const hashes = unspacedHeading.exec(line)?.[1];
        if (!hashes || numberReference.test(line)) continue;
        // Obsidian reads `#word` as a tag.
        if (document.dialect === "obsidian" && obsidianTag.test(line)) continue;
        const closed = closingRun.test(line.slice(hashes.length));
        findings.push({
          start,
          end: start + line.length,
          message: `Text starts with "${hashes}" without a space after it, so it is not a heading; if it should be one, ${closed ? `add spaces inside the hashes, as in "${hashes} Heading ${hashes}"` : `add a space after "${hashes}"`}.`,
        });
      }
      return findings;
    },
  },
  "structure/split-quote": {
    description: "Report block quotes separated only by blank lines, which may be meant as one.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const { source } = document;
      const findings: Finding[] = [];
      walk(document.tree, (parent) => {
        if (!("children" in parent)) return;
        const children: Nodes[] = parent.children;
        for (let i = 1; i < children.length; i++) {
          const before = children[i - 1]!;
          const after = children[i]!;
          if (before.type !== "blockquote" || after.type !== "blockquote") continue;
          // A blank line is the only way to write an alert or callout directly
          // after a quote, so one that opens the next quote stands apart.
          const opening = after.children[0];
          if (opening?.type === "paragraph") {
            const [start] = range(opening);
            if (startsWithMarker(source.slice(start, lineEnd(source, start)), opening)) continue;
          }
          const end = lineEnd(source, range(before)[1]);
          const from = end + (source.startsWith("\r\n", end) ? 2 : 1);
          const gap = source.slice(from, lineStart(source, range(after)[0]));
          // Only blank lines, with the markers of an enclosing quote.
          if (!/^[ \t>\r\n]*$/.test(gap)) continue;
          findings.push({
            start: from,
            end: from + gap.replace(/(?:\r\n|\r|\n)$/, "").length,
            message:
              'A blank line separates two block quotes, which some renderers join into one; to write one quote, start the blank line with ">", or to keep two, put text or a comment between them.',
          });
        }
      });
      return findings;
    },
  },
};
