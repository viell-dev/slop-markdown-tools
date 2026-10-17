import type { Nodes, Root } from "mdast";
import { range } from "../syntax/parse.js";
import type { Edit, SourceRange } from "./types.js";

/**
 * The nodes whose children are blocks of their own. Every other child of one
 * of them is a leaf block, such as a paragraph, heading, table, or code block,
 * and is selected as a whole.
 */
const containers = new Set<Nodes["type"]>([
  "root",
  "blockquote",
  "list",
  "listItem",
  "footnoteDefinition",
]);

/** Stops with an error for ranges that are not half-open offsets into `source`. */
export function checkRanges(ranges: readonly SourceRange[], source: string): void {
  for (const item of ranges)
    if (
      !Number.isInteger(item.start) ||
      !Number.isInteger(item.end) ||
      item.start < 0 ||
      item.end < item.start ||
      item.end > source.length
    )
      throw new Error(
        `Invalid range ${JSON.stringify({ start: item.start, end: item.end })}: a range needs integer offsets with 0 <= start <= end <= ${source.length}.`,
      );
}

/** A leaf block's whole lines, and the same with the line breaks before and after them. */
interface Block {
  lines: [number, number];
  scope: [number, number];
}
/**
 * The leaf blocks of a document, in the order of its source; they do not
 * overlap. A block's lines begin with what stands before it on its first
 * line, such as a list item's marker or a quote's `>`, and end with the rest
 * of its last line. Its scope adds the line breaks next to those lines, where
 * the spacing between it and its neighbors is edited.
 */
function leafBlocks(tree: Root, source: string): Block[] {
  const blocks: Block[] = [];
  const visit = (node: Nodes) => {
    if (!("children" in node)) return;
    for (const child of node.children)
      if (containers.has(child.type)) visit(child);
      else {
        let [start, end] = range(child);
        while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") start--;
        while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end++;
        const before = source.endsWith("\r\n", start) ? 2 : start > 0 ? 1 : 0;
        const after = source.startsWith("\r\n", end) ? 2 : end < source.length ? 1 : 0;
        blocks.push({ lines: [start, end], scope: [start - before, end + after] });
      }
  };
  visit(tree);
  return blocks;
}

/**
 * Where processing is limited to for `ranges`: each range together with the
 * scope of the leaf blocks that it touches, sorted, with overlapping and
 * adjoining parts joined. A non-empty range touches a block whose lines it
 * overlaps, and an empty one, a position, the block whose lines hold it. A
 * range that touches no block, such as one in a run of blank lines, selects
 * nothing.
 */
export function widen(tree: Root, source: string, ranges: readonly SourceRange[]): SourceRange[] {
  const blocks = leafBlocks(tree, source);
  const widened: SourceRange[] = [];
  for (const { start, end } of ranges) {
    const touched = blocks.filter(({ lines: [from, to] }) =>
      start === end ? from <= start && start <= to : start < to && end > from,
    );
    if (!touched.length) continue;
    widened.push({
      start: Math.min(start, touched[0]!.scope[0]),
      end: Math.max(end, touched[touched.length - 1]!.scope[1]),
    });
  }
  widened.sort((a, b) => a.start - b.start);
  const joined: SourceRange[] = [];
  for (const part of widened) {
    const last = joined[joined.length - 1];
    if (last && part.start <= last.end) last.end = Math.max(last.end, part.end);
    else joined.push({ ...part });
  }
  return joined;
}

/** Whether a position lies in the scope; the end of a part still belongs to it. */
export function covers(scope: readonly SourceRange[], at: number): boolean {
  return scope.some((part) => part.start <= at && at <= part.end);
}

/** Whether an edit lies wholly in one part of the scope. */
export function holds(scope: readonly SourceRange[], edit: Edit): boolean {
  return scope.some((part) => part.start <= edit.start && edit.end <= part.end);
}

/**
 * The scope after `edits`, which all lie in it and are sorted and free of
 * duplicates, were applied: each part grows or shrinks by the edits in it and
 * moves by those before it.
 */
export function moved(scope: readonly SourceRange[], edits: readonly Edit[]): SourceRange[] {
  let shift = 0;
  let next = 0;
  return scope.map((part) => {
    let change = 0;
    for (; next < edits.length && edits[next]!.end <= part.end; next++) {
      const edit = edits[next]!;
      change += edit.text.length - (edit.end - edit.start);
    }
    const result = { start: part.start + shift, end: part.end + shift + change };
    shift += change;
    return result;
  });
}

/**
 * Ranges in the positions of a text that has `by` more characters in front,
 * or fewer for a negative `by`. A position in the removed part becomes 0, and
 * a non-empty range that lies wholly in it is dropped: it selected nothing of
 * the rest, and as an empty range it would select the first block.
 */
export function shifted(ranges: readonly SourceRange[], by: number): SourceRange[] {
  return ranges.flatMap((part) =>
    by < 0 && part.start < part.end && part.end <= -by
      ? []
      : [{ start: Math.max(0, part.start + by), end: Math.max(0, part.end + by) }],
  );
}
