import { attributed, attributionOf } from "../core/source-checks.js";
import { walk } from "../syntax/walk.js";
import stringWidth from "string-width";
import type { Nodes, Table } from "mdast";
import type { Finding, Rule } from "../core/types.js";
import { tableContainerBoundary } from "../syntax/site-generator.js";
import { range } from "../syntax/parse.js";
import { lineEnd, lineEnding, lineStart } from "../syntax/source.js";
import { vitepressTokens } from "../syntax/vitepress/projection.js";
import { optionsSchema } from "./shared.js";

/**
 * The tables inside lists and block quotes, reached only through those
 * containers. Other containers, such as footnote definitions, keep their tables.
 */
function containedTables(tree: Nodes): Set<Table> {
  const tables = new Set<Table>();
  const visit = (node: Nodes, contained: boolean) => {
    if (!("children" in node)) return;
    for (const child of node.children) {
      if (child.type === "table" && contained) tables.add(child);
      else if (child.type === "list" || child.type === "listItem" || child.type === "blockquote")
        visit(child, true);
    }
  };
  visit(tree, false);
  return tables;
}

/** Text between rows of a contained table: one line ending, then container markers and indentation. */
const rowSeparator = /^(?:\r\n|\r|\n)[ \t>]*$/;

/**
 * The source ranges of a contained table's rows, the delimiter row second,
 * each from its first character to the end of its line. The text before each
 * row, its container markers and indentation, stays outside them. Undefined
 * when a row does not start a line of its own after such a prefix.
 */
function containedRows(source: string, node: Table): [number, number][] | undefined {
  const rows = node.children.map((row) => range(row));
  const [, headerEnd] = rows[0]!;
  let delimiterStart = headerEnd;
  if (source[delimiterStart] === "\r") delimiterStart++;
  if (source[delimiterStart] === "\n") delimiterStart++;
  while (/[ \t>]/.test(source[delimiterStart] ?? "")) delimiterStart++;
  const delimiter: [number, number] = [delimiterStart, lineEnd(source, delimiterStart)];
  const lines = [rows[0]!, delimiter, ...rows.slice(1)];
  for (let i = 1; i < lines.length; i++)
    if (!rowSeparator.test(source.slice(lines[i - 1]![1], lines[i]![0]))) return undefined;
  return lines;
}

const table: Rule = {
  description: "Pads table cells to their column's width and writes the delimiter row to match.",
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
    const contained = containedTables(document.tree);
    // markdown-it, which VitePress uses, reads some tables on other lines or
    // not at all, such as a lazy header line in a block quote or a one-column
    // header without a pipe, which can be a tag line (#770). Only a table that
    // it reads on the same lines is formatted; the others stay as written.
    let vitepressTables: Set<string> | undefined;
    if (document.dialect === "vitepress") {
      vitepressTables = new Set();
      for (const token of vitepressTokens(document))
        if (token.type === "table_open" && token.map)
          vitepressTables.add(`${token.map[0] + 1}:${token.map[1]}`);
    }
    walk(document.tree, "table", (node) => {
      const { start: first, end: last } = node.position!;
      if (vitepressTables && !vitepressTables.has(`${first.line}:${last.line}`)) return;
      const [start, end] = range(node);
      const header = document.source.slice(...range(node.children[0]!)).trim();
      const borders = [header.startsWith("|"), /(?<!\\)(?:\\\\)*\|$/.test(header)] as const;
      firstBorders ??= borders;
      // A table in a list or block quote is formatted after each line's
      // container markers and indentation, which stay as written. Other
      // indented tables, such as those in footnote definitions, stay as written.
      const lines = contained.has(node) ? containedRows(document.source, node) : undefined;
      if (contained.has(node) ? !lines : node.position!.start.column !== 1) return;
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
      // markdown-it, which VitePress uses, reads a header without a leading
      // pipe on its list item's marker line, as in `- a | b`, as a table
      // outside the list with the marker in its first cell. Adding or removing
      // that pipe would move the table into or out of the list.
      const markerLine =
        lines !== undefined &&
        /[^ \t>]/.test(document.source.slice(lineStart(document.source, start), start));
      if (markerLine) leading = borders[0];
      // A one-column header needs a border to remain a table.
      if (!leading && !trailing && count === 1) leading = trailing = true;
      // A row keeps the border it needs: without it, an empty first or last
      // cell would vanish into the remaining pipe, and a first cell that
      // starts like another block, such as `- x` or `# x`, would start that
      // block and end the table.
      if (
        !leading &&
        rows.some((row) => /^(?:$|[-+*#>=~`<|:[!$\\]|\d{1,9}[.)])/.test(row[0] ?? ""))
      )
        leading = true;
      if (!trailing && rows.some((row) => (row.at(-1) ?? "") === "")) trailing = true;
      // Such a header that needs a leading pipe stays as written.
      if (markerLine && leading !== borders[0]) return;
      // Without a trailing pipe, padding after the last cell would only leave
      // blank space at the end of the line.
      const render = (cells: string[]) => {
        const text =
          (leading ? `|${gap}` : "") + cells.join(`${gap}|${gap}`) + (trailing ? `${gap}|` : "");
        return trailing ? text : text.replace(/[ \t]+$/, "");
      };
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
      // In a container, each line ending and the container markers and
      // indentation after it stay as written. The table remains one edit, so
      // that a renderer protection holds all of its rows or none.
      const replacement = lines
        ? rendered.reduce(
            (text, row, i) => text + document.source.slice(lines[i - 1]![1], lines[i]![0]) + row,
          )
        : rendered.join(newline);
      if (replacement !== document.source.slice(start, end)) {
        const ranges =
          lines ??
          (() => {
            const result: [number, number][] = [];
            let at = start;
            while (at < end) {
              const to = Math.min(end, lineEnd(document.source, at));
              result.push([at, to]);
              at = to;
              if (document.source[at] === "\r") at++;
              if (document.source[at] === "\n") at++;
            }
            return result;
          })();
        const parts: Finding[] = [];
        const inner = (row: string) => {
          let text = row.trim();
          if (text.startsWith("|")) {
            text = text.slice(1);
            if (text.startsWith(" ")) text = text.slice(1);
          }
          if (/(?<!\\)(?:\\\\)*\|$/.test(text)) {
            text = text.slice(0, -1);
            if (text.endsWith(" ")) text = text.slice(0, -1);
          }
          return text;
        };
        for (const [i, [a, b]] of ranges.entries()) {
          const before = document.source.slice(a, b).trim();
          const after = rendered[i]!;
          const checks: string[] = [];
          if (
            before.startsWith("|") !== after.startsWith("|") ||
            /(?<!\\)(?:\\\\)*\|$/.test(before) !== /(?<!\\)(?:\\\\)*\|$/.test(after)
          )
            checks.push("MD055");
          if (inner(before) !== inner(after) || (!checks.includes("MD055") && before !== after))
            checks.push("MD060");
          if (checks.length)
            parts.push(
              attributed({ start: a, end: b, message: "Format table padding and pipes." }, checks),
            );
        }
        findings.push(
          attributed(
            {
              start,
              end,
              message: "Format table padding and pipes.",
              edit: { start, end, text: replacement },
            },
            [...new Set(parts.flatMap((part) => attributionOf(part)!.checks))],
            parts,
          ),
        );
      }
    });
    return findings;
  },
};
export { table };
