import { visit } from "unist-util-visit";
import type { Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { optionsSchema } from "./style.js";

function calloutRule(obsidian: boolean): Rule {
  return {
    description: obsidian
      ? "Use lowercase Obsidian callout types."
      : "Use uppercase GitHub alert types.",
    kind: "style",
    phase: "inline",
    schema: optionsSchema({}),
    check({ document }) {
      if (document.dialect !== (obsidian ? "obsidian" : "github")) return [];
      const findings: Finding[] = [];
      visit(document.tree, "blockquote", (node) => {
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
      visit(document.tree, "listItem", (node) => {
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
      visit(document.tree, "text", (node) => {
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
