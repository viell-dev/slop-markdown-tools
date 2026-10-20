import type { Table } from "mdast";
import { range } from "./parse.js";

/**
 * The first row that a site generator may read as a colon-container boundary,
 * rather than part of this GFM table; -1 when there is none. Inspect the source:
 * a cell written as `| ::: |` is ordinary table content.
 */
export function tableContainerBoundary(source: string, table: Table): number {
  return table.children.findIndex((row) => /^[ \t]*:{3,}/.test(source.slice(...range(row))));
}
