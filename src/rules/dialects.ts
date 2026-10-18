import { walk } from "../syntax/walk.js";
import type { Dialect, Finding, Rule } from "../core/types.js";
import { blockIdentifier } from "../syntax/block-identifier.js";
import { range } from "../syntax/parse.js";
import { headingAttributeBlock } from "../workspace/heading-attributes.js";
import { optionsSchema } from "./style.js";

const githubAlerts = new Set<Dialect>(["github", "forgejo", "gitea"]);
function calloutRule(obsidian: boolean): Rule {
  return {
    description: obsidian
      ? "Use lowercase Obsidian callout types."
      : "Use uppercase GitHub alert types.",
    kind: "style",
    phase: "inline",
    schema: optionsSchema({}),
    check({ document }) {
      // Forgejo and Gitea render the same five GitHub alert types, case-insensitively.
      if (obsidian ? document.dialect !== "obsidian" : !githubAlerts.has(document.dialect))
        return [];
      const findings: Finding[] = [];
      walk(document.tree, "blockquote", (node, _index, parent) => {
        const child = node.children[0];
        if (child?.type !== "paragraph") return;
        const [start, end] = range(child);
        const match = /^\[!([\w-]+)\]/.exec(document.source.slice(start));
        if (!match) return;
        // GitHub shows an alert only in a block quote at the top level, with
        // the marker alone on its first line and content below it; elsewhere
        // the marker is text, whose letters would change (issue #334).
        if (!obsidian) {
          const lineEnd = /\r\n|\r|\n|$/.exec(document.source.slice(start + match[0].length))!;
          const rest = document.source.slice(
            start + match[0].length,
            start + match[0].length + lineEnd.index,
          );
          const below = start + match[0].length + lineEnd.index < end || node.children.length > 1;
          if (parent?.type !== "root" || /[^ \t]/.test(rest) || !below) return;
        }
        const original = match[1]!;
        if (
          !obsidian &&
          !["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"].includes(original.toUpperCase())
        )
          return;
        const replacement = obsidian ? original.toLowerCase() : original.toUpperCase();
        if (original !== replacement)
          findings.push({
            start: start + 2,
            end: start + 2 + original.length,
            message: `Use ${replacement} for the callout type.`,
            edit: { start: start + 2, end: start + 2 + original.length, text: replacement },
          });
      });
      return findings;
    },
  };
}
export const dialectRules: Record<string, Rule> = {
  "github/alert-marker": calloutRule(false),
  "obsidian/callout-marker": calloutRule(true),
  "github/task-marker": {
    description: "Use lowercase x in completed task markers.",
    kind: "style",
    phase: "inline",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      walk(document.tree, "listItem", (node) => {
        if (node.checked !== true) return;
        const start = range(node)[0];
        const match = /^(?:[-+*]|\d+[.)])\s+\[X\]/.exec(document.source.slice(start));
        if (!match) return;
        const offset = start + match[0].length - 2;
        findings.push({
          start: offset,
          message: "Use lowercase x in task markers.",
          edit: { start: offset, end: offset + 1, text: "x" },
        });
      });
      return findings;
    },
  },
  "obsidian/block-reference": {
    description: "Report duplicate block identifiers.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      if (document.dialect !== "obsidian") return [];
      const seen = new Set<string>();
      const findings: Finding[] = [];
      walk(document.tree, (node) => {
        const found = blockIdentifier(document.source, node);
        if (!found) return;
        const { id } = found;
        if (seen.has(id))
          findings.push({
            start: range(found.node)[0],
            message: `Duplicate block identifier ^${id}.`,
          });
        seen.add(id);
      });
      return findings;
    },
  },
  "forgejo/heading-id": {
    description:
      "Report heading attribute ids that are not text, which Forgejo and Gitea before 1.26 cannot render.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      if (document.dialect !== "forgejo" && document.dialect !== "gitea") return [];
      const findings: Finding[] = [];
      const { source } = document;
      walk(document.tree, "heading", (node) => {
        const [start, end] = range(node);
        // The block ends an ATX heading's line or the last text line of a
        // Setext heading, whose last line is its underline.
        const breaks = [...source.slice(start, end).matchAll(/\r\n?|\n/g)];
        const underline = breaks.at(-1);
        const previous = breaks.at(-2);
        const lineStart = previous ? start + previous.index + previous[0].length : start;
        let lineEnd = underline ? start + underline.index : end;
        while (source[lineEnd - 1] === " " || source[lineEnd - 1] === "\t") lineEnd--;
        let line = source.slice(lineStart, lineEnd);
        let block = headingAttributeBlock(line);
        // Gitea before 1.26 also reads a block followed by a closing `#` sequence.
        if (!block && !underline) {
          const closed = /[ \t]+#+$/.exec(line);
          if (closed) {
            line = line.slice(0, closed.index);
            block = headingAttributeBlock(line);
          }
        }
        // goldmark hands a number, boolean, null, or list to the renderers,
        // which expect text: Gitea 1.26 and later give the heading an empty
        // id, Forgejo and earlier Gitea versions fail on the whole document.
        if (block?.id === null)
          findings.push({
            start: lineStart + block.start,
            end: lineStart + line.length,
            message:
              'Heading id is not text: Forgejo, and Gitea before 1.26, cannot render a document containing it. Quote it: {id="5"}.',
          });
      });
      return findings;
    },
  },
  "obsidian/strict-line-breaks": {
    description: "Require verified soft-line-break behavior before reflowing an Obsidian document.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document, workspace }) {
      return document.dialect === "obsidian" && workspace?.strictLineBreaks !== true
        ? [
            {
              start: 0,
              message:
                "Obsidian's \"Strict line breaks\" setting is not known to be on, so paragraphs are not reflowed. Turn it on in the vault's settings, which keep it in .obsidian/app.json; a program that calls the library passes strictLineBreaks to createWorkspace.",
            },
          ]
        : [];
    },
  },
};
