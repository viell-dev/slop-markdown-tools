/** Any CommonMark line ending, including a lone carriage return. */
export const lineBreak = /\r\n|\r|\n/;
/** A split pattern that also keeps the line ending between content pieces. */
export const capturedLineBreak = new RegExp(`(${lineBreak.source})`);

/** A stateful matcher owned by one source scan. */
export function lineBreakMatcher(): RegExp {
  return new RegExp(lineBreak.source, "g");
}

/** Each complete line ending, with its offset, without shared matcher state. */
export function lineBreaks(source: string) {
  return source.matchAll(lineBreakMatcher());
}

/** The source's line ending, taken from its first line break, or LF. */
export function lineEnding(source: string): string {
  return lineBreak.exec(source)?.[0] ?? "\n";
}

/** Offsets where physical lines start, with CRLF counted as one line ending. */
export function lineStarts(source: string): number[] {
  const starts = [0];
  for (const match of lineBreaks(source)) starts.push(match.index + match[0].length);
  return starts;
}

/** The start of the physical line containing `at`. */
export function lineStart(source: string, at: number): number {
  while (at > 0 && source[at - 1] !== "\n" && source[at - 1] !== "\r") at--;
  return at;
}

/** The end of the physical line containing `at`, before its line ending. */
export function lineEnd(source: string, at: number): number {
  while (at < source.length && source[at] !== "\n" && source[at] !== "\r") at++;
  return at;
}

/** Start and end of the physical lines containing a source range. */
export function lineBounds(source: string, start: number, end: number): [number, number] {
  return [lineStart(source, start), lineEnd(source, end)];
}

/** Whether the character at `index` is escaped by an odd number of backslashes before it. */
function escaped(source: string, index: number): boolean {
  let count = 0;
  while (source[index - count - 1] === "\\") count++;
  return count % 2 === 1;
}

/** The number of values in the sorted `values` that are less than `limit`. */
function countBelow(values: number[], limit: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle]! < limit) low = middle + 1;
    else high = middle;
  }
  return low;
}
export { escaped, countBelow };
