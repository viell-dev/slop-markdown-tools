import type { List, Nodes } from "mdast";
import type { Document } from "../../core/types.js";
import { hidesList } from "./projection.js";

/**
 * In the VitePress dialect, the lists whose markers and indentation decide how
 * markdown-it reads the blocks around them, which the list rules keep, with
 * the lists beside them, as written:
 *
 * - Lists with an item whose first line is a table's header row, as
 *   `*   a | b` above `    --|--` is. markdown-it tries a table before a
 *   list, so the item's marker and indentation decide whether it reads the
 *   table inside the item or above the list, with the marker in its first cell
 *   (#763): less indentation, or a marker that joins the list to a list beside
 *   it, changes that reading.
 * - Lists directly beside a list that a component left opaque (#769), which
 *   another marker would join to it.
 */
export function collectVitePressListProtections(document: Document, lists: Set<List>): void {
  if (document.dialect !== "vitepress") return;
  const { children } = document.tree;
  children.forEach((child, index) => {
    if (!hidesList(child)) return;
    for (const beside of [children[index - 1], children[index + 1]])
      if (beside?.type === "list") lists.add(beside);
  });
  const open: { list: List; line: number }[] = [];
  const visit = (node: Nodes, list: List | undefined) => {
    if (node.type === "table") {
      const line = node.position?.start.line;
      for (let index = open.length - 1; index >= 0 && open[index]!.line === line; index--)
        lists.add(open[index]!.list);
      return;
    }
    if (!("children" in node)) return;
    const line = node.type === "listItem" && list ? node.position?.start.line : undefined;
    const item = line !== undefined && list !== undefined;
    if (item) open.push({ list, line });
    for (const child of node.children) visit(child, node.type === "list" ? node : undefined);
    if (item) open.pop();
  };
  visit(document.tree, undefined);
}
