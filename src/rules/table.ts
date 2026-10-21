import { walk } from "../syntax/walk.js";
import stringWidth from "string-width";
import type { Finding, Rule } from "../core/types.js";
import { tableContainerBoundary } from "../syntax/site-generator.js";
import { range } from "../syntax/parse.js";
import { lineEnding } from "../syntax/source.js";
import { optionsSchema } from "./shared.js";

const table: Rule = {
  description: "Align or compact GFM table cells while preserving their inline source.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({ style: { enum: ["aligned", "compact"] } }),
  check({ document, options }) {
    const findings: Finding[] = [];
    // A compact table has one space around each cell and the shortest delimiters.
    const compact = options.style === "compact";
    const newline = lineEnding(document.source);
    walk(document.tree, "table", (node) => {
      const [start, end] = range(node);
      // Nested tables retain container prefixes until a dedicated container printer handles them.
      if (node.position!.start.column !== 1) return;
      // Site generators close or open a container here, where GFM still reads table rows.
      if (tableContainerBoundary(document.source, node) >= 0) return;
      const rows = node.children.map((row) =>
        row.children.map((cell) => {
          if (!cell.children.length) return "";
          const first = range(cell.children[0]!)[0];
          const last = range(cell.children.at(-1)!)[1];
          return document.source.slice(first, last);
        }),
      );
      const count = node.align?.length ?? rows[0]?.length ?? 0;
      if (rows.some((row) => row.length > count)) return;
      const widths = Array.from({ length: count }, (_, i) =>
        compact ? 3 : rows.reduce((width, row) => Math.max(width, stringWidth(row[i] ?? "")), 3),
      );
      const pad = (cell: string, i: number) =>
        compact ? cell : cell + " ".repeat(widths[i]! - stringWidth(cell));
      // Keep each row's own cell count: adding cells to a short row changes the parsed table.
      const rendered = rows.map((row) => `| ${row.map(pad).join(" | ")} |`);
      rendered.splice(
        1,
        0,
        `| ${widths
          .map((width, i) => {
            const align = node.align?.[i];
            return (
              (align === "left" || align === "center" ? ":" : "-") +
              "-".repeat(width - 2) +
              (align === "right" || align === "center" ? ":" : "-")
            );
          })
          .join(" | ")} |`,
      );
      const replacement = rendered.join(newline);
      if (replacement !== document.source.slice(start, end))
        findings.push({
          start,
          end,
          message: compact ? "Write the table compactly." : "Align table cells.",
          edit: { start, end, text: replacement },
        });
    });
    return findings;
  },
};
export { table };
