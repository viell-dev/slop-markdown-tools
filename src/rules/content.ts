import { walk } from "../syntax/walk.js";
import type { Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { tableContainerBoundary } from "../syntax/site-generator.js";
import { optionsSchema } from "./style.js";

/** `|100` or `|100x50` at the end of an Obsidian image's text sets its size, not its text. */
const obsidianSize = /\|\d+(?:x\d+)?$/;

export const contentRules: Record<string, Rule> = {
  "content/image-alt": {
    description: "Report images without alternative text.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      // Obsidian's `![[image.png]]` embeds are wikilinks, which have no place for the text.
      walk(document.tree, (node) => {
        if (node.type !== "image" && node.type !== "imageReference") return;
        let alt = node.alt ?? "";
        if (document.dialect === "obsidian") alt = alt.replace(obsidianSize, "");
        if (alt.trim()) return;
        const [start, end] = range(node);
        findings.push({
          start,
          end,
          message: "Add alternative text to the image, for readers who cannot see it.",
        });
      });
      return findings;
    },
  },
  "content/table-columns": {
    description: "Report table rows with more or fewer cells than the header row.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      walk(document.tree, "table", (node) => {
        const boundary = tableContainerBoundary(document.source, node);
        const [header, ...rows] = boundary < 0 ? node.children : node.children.slice(0, boundary);
        const columns = header?.children.length ?? 0;
        for (const row of rows) {
          const cells = row.children.length;
          if (cells === columns) continue;
          const [start, end] = range(row);
          const counted = `Row has ${cells} ${cells === 1 ? "cell" : "cells"} and the header ${columns}`;
          findings.push({
            start,
            end,
            message:
              cells > columns
                ? `${counted}; ${cells - columns === 1 ? "the extra cell is" : "the extra cells are"} not shown.`
                : `${counted}; the row is shown with ${columns - cells === 1 ? "an empty cell" : "empty cells"} added.`,
          });
        }
      });
      return findings;
    },
  },
  "content/code-language": {
    description: "Report fenced code blocks that do not name a language.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      walk(document.tree, "code", (node) => {
        const [start] = range(node);
        // An indented code block starts with its indentation, and has no place for a language.
        const fence = document.source[start];
        if (node.lang || (fence !== "`" && fence !== "~")) return;
        let end = start;
        while (document.source[end] === fence) end++;
        const marker = document.source.slice(start, end);
        findings.push({
          start,
          end,
          message: `Name the code block's language after its opening fence, such as ${marker}sh, or ${marker}text for plain text.`,
        });
      });
      return findings;
    },
  },
};
