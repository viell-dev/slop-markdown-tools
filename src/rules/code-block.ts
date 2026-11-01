import type { Edit, Finding, Rule } from "../core/types.js";
import { protectedEdit } from "../core/protection-edits.js";
import { codeFence } from "../syntax/fences.js";
import { range } from "../syntax/parse.js";
import { lineBreak, lineEnding, lineStart } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { located, optionsSchema } from "./shared.js";

/** Code form is independent of the spelling of an existing fence. */
export const codeBlock: Rule = {
  description: "Writes code blocks in one form, fenced or indented.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({ style: { enum: ["consistent", "fenced", "indented"] } }),
  check({ document, options }) {
    const { source } = document;
    let style = typeof options.style === "string" ? options.style : "consistent";
    const findings: Finding[] = [];
    const protectedByRenderer = protectedEdit(document);
    walk(document.tree, "code", (node) => {
      if (!located(node)) return;
      const fenced = codeFence(source, node) !== undefined;
      if (style === "consistent") style = fenced ? "fenced" : "indented";
      if (fenced === (style === "fenced")) return;
      const [start, end] = range(node);
      let edit: Edit | undefined;
      // VitePress renders fences with highlighting and a copy control; its
      // indented blocks retain their distinct rendering and opaque protection.
      if (!fenced && document.dialect !== "vitepress") {
        // Positions begin after container indentation, before code indentation.
        // Repeat the container, replacing a first-line list marker with spaces.
        const firstPrefix = source.slice(lineStart(source, start), start);
        const prefix = firstPrefix.replace(/(?:[-+*]|\d+[.)])[ ]+/g, (marker) =>
          " ".repeat(marker.length),
        );
        // A tab in a container prefix can cross tab stops differently after
        // removing code indentation. Report that ambiguous layout only.
        if (/^[ >]*$/.test(prefix)) {
          let longest = 2;
          for (const run of node.value.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
          const fence = "`".repeat(longest + 1);
          const eol = lineEnding(source);
          const content = node.value
            .split(lineBreak)
            .map((line) => prefix + line)
            .join(eol);
          edit = { start, end, text: fence + eol + content + eol + prefix + fence };
          if (protectedByRenderer(edit)) edit = undefined;
        }
      }
      findings.push({
        start,
        end,
        message: `Use ${style} code blocks.`,
        ...(edit ? { edit } : {}),
      });
    });
    return findings;
  },
};
