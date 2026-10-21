import type { Heading } from "mdast";
import { range } from "./parse.js";
import { lineBreaks } from "./source.js";

/** The last text line of a heading, without trailing blank space or a Setext underline. */
export function lastHeadingTextLine(
  source: string,
  node: Heading,
): { start: number; end: number; setext: boolean } {
  const [start, end] = range(node);
  const breaks = [...lineBreaks(source.slice(start, end))];
  const underline = breaks.at(-1);
  const previous = breaks.at(-2);
  let lineEnd = underline ? start + underline.index : end;
  while (source[lineEnd - 1] === " " || source[lineEnd - 1] === "\t") lineEnd--;
  return {
    start: previous ? start + previous.index + previous[0].length : start,
    end: lineEnd,
    setext: underline !== undefined,
  };
}
