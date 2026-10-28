import { walk } from "../syntax/walk.js";
import stringWidth from "string-width";
import type { Finding, Rule } from "../core/types.js";
import { tableContainerBoundary } from "../syntax/site-generator.js";
import { range } from "../syntax/parse.js";
import { lineEnding } from "../syntax/source.js";
import { optionsSchema } from "./shared.js";

const table: Rule = {
  description: "Format GFM table padding and pipes while preserving inline source.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({
    style: { enum: ["aligned", "compact", "tight"] },
    pipeStyle: {
      enum: [
        "consistent",
        "leadingAndTrailing",
        "leadingOnly",
        "trailingOnly",
        "noLeadingOrTrailing",
        "perTable",
      ],
    },
    alignedDelimiter: { type: "boolean" },
    padding: { enum: ["right", "alignment"] },
  }),
  check({ document, options }) {
    const findings: Finding[] = [];
    const aligned = options.style !== "compact" && options.style !== "tight";
    const gap = options.style === "tight" ? "" : " ";
    let firstBorders: readonly [boolean, boolean] | undefined;
    const newline = lineEnding(document.source);
    walk(document.tree, "table", (node) => {
      const [start, end] = range(node);
      const header = document.source.slice(...range(node.children[0]!)).trim();
      const borders = [header.startsWith("|"), /(?<!\\)(?:\\\\)*\|$/.test(header)] as const;
      firstBorders ??= borders;
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
        aligned
          ? rows.reduce((width, row) => Math.max(width, stringWidth(row[i] ?? "")), 3)
          : Math.max(3, options.alignedDelimiter ? stringWidth(rows[0]?.[i] ?? "") : 3),
      );
      let [leading, trailing] =
        options.pipeStyle === "consistent"
          ? firstBorders
          : options.pipeStyle === "perTable"
            ? borders
            : [
                options.pipeStyle !== "trailingOnly" && options.pipeStyle !== "noLeadingOrTrailing",
                options.pipeStyle !== "leadingOnly" && options.pipeStyle !== "noLeadingOrTrailing",
              ];
      // Obsidian's table widget needs both borders for one column. Never remove a
      // leading border there: body rows with a different convention can become prose.
      if (document.dialect === "obsidian") {
        if (borders[0]) leading = true;
        if (count === 1) leading = trailing = true;
      }
      // A one-column header needs a border to remain a table.
      if (!leading && !trailing && count === 1) leading = trailing = true;
      const render = (cells: string[]) =>
        (leading ? `|${gap}` : "") + cells.join(`${gap}|${gap}`) + (trailing ? `${gap}|` : "");
      const pad = (cell: string, i: number, header: boolean) => {
        if (!aligned && !(header && options.alignedDelimiter)) return cell;
        const extra = widths[i]! - stringWidth(cell);
        const alignment = options.padding === "alignment" ? node.align?.[i] : null;
        const left =
          alignment === "right" ? extra : alignment === "center" ? Math.floor(extra / 2) : 0;
        return " ".repeat(left) + cell + " ".repeat(extra - left);
      };
      // Keep each row's own cell count: adding cells to a short row changes the parsed table.
      const rendered = rows.map((row, index) =>
        render(row.map((cell, i) => pad(cell, i, index === 0))),
      );
      rendered.splice(
        1,
        0,
        render(
          widths.map((width, i) => {
            const align = node.align?.[i];
            return (
              (align === "left" || align === "center" ? ":" : "-") +
              "-".repeat(width - 2) +
              (align === "right" || align === "center" ? ":" : "-")
            );
          }),
        ),
      );
      const replacement = rendered.join(newline);
      if (replacement !== document.source.slice(start, end))
        findings.push({
          start,
          end,
          message: "Format table padding and pipes.",
          edit: { start, end, text: replacement },
        });
    });
    return findings;
  },
};
export { table };
