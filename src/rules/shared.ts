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
export { inlineBlocks, located, holds };

export type { Range };
