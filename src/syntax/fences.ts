import type { Code, Nodes } from "mdast";
import { range } from "./parse.js";
import { lineBreak, lineEnd } from "./source.js";

/** A fenced code or math block's marker runs, as source ranges. */
export interface Fence {
  marker: "`" | "~" | "$";
  open: [number, number];
  /** Absent when the block runs to the end of its container without a closing fence. */
  close?: [number, number];
}

/** Read a code or math fence; indented code has no fence. */
export function codeFence(
  source: string,
  node: Code | Extract<Nodes, { type: "math" }>,
): Fence | undefined {
  const [start, end] = range(node);
  // A fenced block starts at its fence; an indented one at its indentation.
  const opening = /^(?:`{3,}|~{3,}|\${2,})/.exec(source.slice(start, lineEnd(source, start)));
  if (!opening) return undefined;
  const marker = opening[0][0] as Fence["marker"];
  const fence: Fence = { marker, open: [start, start + opening[0].length] };
  // The block's lines are the opening fence, the content, and the closing
  // fence if there is one. An empty value is no line or one blank line, and a
  // closing fence is never blank.
  const lines = source.slice(start, end).split(lineBreak);
  const last = lines.at(-1)!;
  const closing = new RegExp(
    `(?:${marker === "$" ? "\\$" : marker}){${opening[0].length},}(?=[ \\t]*$)`,
  ).exec(last);
  const content = node.value === "" ? undefined : node.value.split(lineBreak).length;
  if (closing && lines.length > 1 && (content === undefined || lines.length === content + 2)) {
    const at = end - last.length + closing.index;
    fence.close = [at, at + closing[0].length];
  }
  return fence;
}
