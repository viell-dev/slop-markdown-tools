import stringWidth from "string-width";
import type { Finding, Rule } from "../core/types.js";
import { walk } from "../syntax/walk.js";
import { lineBreak } from "../syntax/source.js";
import { optionsSchema } from "./shared.js";
import { lineWidth } from "./wrap.js";

/** Report literal block lines without proposing structural edits or duplicating prose reflow. */
export const lineLength: Rule = {
  description:
    "Reports heading, code block, and table lines longer than a limit, without editing them.",
  kind: "problem",
  schema: optionsSchema({
    lineLength: { type: "integer", minimum: 0 },
    headingLineLength: { type: "integer", minimum: 0 },
    codeBlockLineLength: { type: "integer", minimum: 0 },
    codeBlocks: { type: "boolean" },
    tables: { type: "boolean" },
    headings: { type: "boolean" },
    strict: { type: "boolean" },
    stern: { type: "boolean" },
    measure: { enum: ["columns", "codepoints"] },
  }),
  check({ document, options }) {
    const kinds = new Map<number, "heading" | "code" | "table">();
    walk(document.tree, (node) => {
      if (node.type !== "heading" && node.type !== "code" && node.type !== "table") return;
      if (!node.position) return;
      for (let line = node.position.start.line; line <= node.position.end.line; line++)
        kinds.set(line, node.type);
    });
    const measure =
      options.measure === "codepoints" ? (text: string) => [...text].length : stringWidth;
    const unit = options.measure === "codepoints" ? "code points" : "columns";
    const findings: Finding[] = [];
    let start = 0;
    for (const [index, line] of document.source.split(lineBreak).entries()) {
      const kind = kinds.get(index + 1);
      const limit = Number(
        (kind === "heading"
          ? options.headingLineLength
          : kind === "code"
            ? options.codeBlockLineLength
            : undefined) ??
          options.lineLength ??
          80,
      );
      const enabled =
        kind === "heading"
          ? options.headings !== false
          : kind === "code"
            ? options.codeBlocks !== false
            : kind === "table" && options.tables !== false;
      if (enabled && limit > 0 && lineWidth(line, measure) > limit) {
        // Default permits an overflowing final token; stern permits a single token
        // after indentation/quote/heading markers. Strict takes precedence.
        const report =
          options.strict === true ||
          (options.stern === true
            ? !/^(?:[#>\s]*\s)?\S*$/.test(line)
            : lineWidth(line.replace(/\S*$/, ""), measure) >= limit);
        if (report)
          findings.push({
            start,
            end: start + line.length,
            message: `${kind} line exceeds ${limit} ${unit}.`,
          });
      }
      start += line.length;
      if (document.source[start] === "\r") start++;
      if (document.source[start] === "\n") start++;
    }
    return findings;
  },
};
