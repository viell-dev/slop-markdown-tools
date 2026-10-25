import type { Heading, Nodes } from "mdast";
import { lineBreakMatcher } from "./source.js";
export type ProtectionSource = ReturnType<typeof protectionSource>;
/** A place in the source, as a node's position gives it. */
export type Point = NonNullable<Nodes["position"]>["start"];
export const leaves = new Set<Nodes["type"]>(["paragraph", "heading", "table", "code", "html"]);

/** Source-coordinate helpers shared by the renderer collectors; no parsing or tree copies. */
export function protectionSource(source: string) {
  /** The column of the first character from `offset` on, after spaces and tabs. */
  const columnAt = (offset: number) => {
    let start = offset;
    while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") start--;
    let column = 0;
    for (let at = start; at < source.length; at++) {
      const character = source[at];
      if (at >= offset && character !== " " && character !== "\t") break;
      column = character === "\t" ? column + 4 - (column % 4) : column + 1;
    }
    return column;
  };
  /** Whether a primary heading has a physical underline after its inline title. */
  const isSetextHeading = (node: Nodes): node is Heading =>
    node.type === "heading" &&
    node.position !== undefined &&
    node.position.end.line > (node.children.at(-1)?.position?.end.line ?? node.position.start.line);
  /** Where a paragraph's or an underlined heading's text starts. */
  const textStart = (node: Nodes): number | undefined => {
    const start = node.position?.start.offset;
    if (start === undefined || node.position?.end.offset === undefined) return undefined;
    if (node.type === "paragraph") return start;
    // An underlined heading below link reference definitions starts at them.
    if (isSetextHeading(node)) return node.children[0]?.position?.start.offset ?? start;
    return undefined;
  };
  /** Where the line holding `offset` starts. */
  const lineStart = (offset: number) => {
    let at = offset;
    while (at > 0 && source[at - 1] !== "\n" && source[at - 1] !== "\r") at--;
    return at;
  };
  /** A copy of `node` that starts at `start` and ends at `end`. */
  const stretch = (node: Nodes, start: Point, end = node.position!.end): Nodes =>
    start.offset === node.position!.start.offset && end === node.position!.end
      ? node
      : { ...node, position: { start, end } };
  /** The start of the line holding `node`'s start. */
  const lineOf = (node: Nodes): Point => {
    const start = node.position!.start;
    const offset = lineStart(start.offset!);
    return offset === start.offset ? start : { line: start.line, column: 1, offset };
  };
  /** The offsets where the line holding `offset` starts and ends. */
  const lineAround = (offset: number): [number, number] => {
    let start = offset;
    while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") start--;
    let end = offset;
    while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end++;
    return [start, end];
  };
  /** Where each line from `start` to `end` after the first starts and ends. */
  const laterLines = (start: number, end: number): [number, number][] => {
    const found: [number, number][] = [];
    const breaks = lineBreakMatcher();
    breaks.lastIndex = start;
    for (let at = breaks.exec(source); at && at.index < end; at = breaks.exec(source)) {
      const from = at.index + at[0].length;
      found.push([from, Math.min(lineAround(from)[1], end)]);
    }
    return found;
  };
  /** A copy of `node` from the line break before `from` to `to`. */
  const breakBefore = (node: Nodes, from: number, to: number): Nodes => {
    const { start, end } = node.position!;
    return {
      ...node,
      position: { start: { ...start, offset: from - 1 }, end: { ...end, offset: to } },
    };
  };
  /** `first` to `last` as one block, from the start of its first line to the end of its last. */
  const wholeLines = (first: Nodes, last = first): Nodes => {
    const start = first.position!.start;
    const end = last.position!.end;
    return {
      ...first,
      position: {
        start: { ...start, offset: lineAround(start.offset!)[0], column: 1 },
        end: { ...end, offset: lineAround(end.offset!)[1] },
      },
    };
  };

  return {
    columnAt,
    isSetextHeading,
    textStart,
    lineStart,
    stretch,
    lineOf,
    lineAround,
    laterLines,
    breakBefore,
    wholeLines,
  };
}
