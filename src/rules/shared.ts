import type { Nodes } from "mdast";
import { walk } from "../syntax/walk.js";
/** A JSON Schema for an options object with these properties and no others. */
export function optionsSchema(properties: Record<string, unknown>) {
  return { type: "object", properties, additionalProperties: false };
}

type Range = [number, number];

/** The blocks whose inline content the parser reads, and pairs delimiters in, as a whole. */
const inlineBlocks = new Set(["paragraph", "heading", "tableCell"]);

function located(node: Nodes): boolean {
  return node.position?.start.offset !== undefined && node.position.end.offset !== undefined;
}

function holds(node: Nodes, type: string): boolean {
  let found = false;
  walk(node, (child) => {
    if (child.type === type) found = true;
  });
  return found;
}
/**
 * A word that Obsidian reads as a tag after blank space or at the start of a
 * line's content; Live Preview does not directly after a block quote's `>`
 * (issue #409). It is `#` and the characters Obsidian allows in a tag,
 * letters, digits, `_`, `-`, and `/`, among them one that is not a digit.
 */
const obsidianTag = /^#[\p{L}\p{N}_/-]*[\p{L}_/-]/u;
export { inlineBlocks, located, holds, obsidianTag };

export type { Range };
