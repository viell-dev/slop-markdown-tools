import { walk } from "../syntax/walk.js";
import type { Dialect, Finding, Rule } from "../core/types.js";
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
      walk(document.tree, "blockquote", (node) => {
        const child = node.children[0];
        if (child?.type !== "paragraph") return;
        const start = range(child)[0];
        const match = /^\[!([\w-]+)\]/.exec(document.source.slice(start));
        if (!match) return;
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
      walk(document.tree, "text", (node) => {
        const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(node.value);
        if (!match) return;
        const id = match[1]!;
        if (seen.has(id))
          findings.push({ start: range(node)[0], message: `Duplicate block identifier ^${id}.` });
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
        const lineEnd = underline ? start + underline.index : end;
        const block = headingAttributeBlock(source.slice(lineStart, lineEnd));
        // goldmark hands a number, boolean, null, or list to the renderers,
        // which expect text: Gitea 1.26 and later give the heading an empty
        // id, Forgejo and earlier Gitea versions fail on the whole document.
        if (block?.id === null)
          findings.push({
            start: lineStart + block.start,
            end: lineEnd,
            message:
              'Heading id is not text: Forgejo, and Gitea before 1.26, render nothing for a document containing it. Quote it: {id="5"}.',
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
                "Obsidian strictLineBreaks is not verified true; paragraph reflow is disabled. Set it in Obsidian or supply workspace.strictLineBreaks to the library.",
            },
          ]
        : [];
    },
  },
};
