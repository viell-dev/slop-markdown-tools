import type { Heading, Nodes, Root, RootContent } from "mdast";
import type { Finding, Rule } from "../core/types.js";
import { range, textContent } from "../syntax/parse.js";
import { optionsSchema } from "./style.js";

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
          if (!siblings) seen.set(parent, (siblings = new Map()));
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
};
