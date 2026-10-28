import type { Nodes } from "mdast";
import type { Document } from "../core/types.js";
import type { ObsidianBlocks } from "./obsidian-protections.js";
import type { Point, ProtectionSource } from "./protection-source.js";
import { codeFence } from "./fences.js";
import { lineBreak as lineEndingPattern } from "./source.js";

/** Container termination and rejected tilde-fence openers can shift every later pairing. */
export function collectContainerFences(
  document: Document,
  { order }: ObsidianBlocks,
  positions: ProtectionSource,
  openFences: Set<Nodes>,
): void {
  const { source } = document;
  const { stretch, lineOf } = positions;
  for (let index = 0; index < order.length; index++) {
    const [leaf] = order[index]!;
    if (leaf.type !== "code" || !leaf.position) continue;
    const text = source.slice(leaf.position.start.offset, leaf.position.end.offset);
    const fence = /^[ \t]*(`{3,}|~{3,})/.exec(text)?.[1];
    if (fence === undefined) continue;
    /** Whether `line` would close the fence, after the markers of its containers. */
    const closes = (line: string) => {
      const run = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      return run !== undefined && run[0] === fence[0] && run.length >= fence.length;
    };
    const lines = text.split(lineEndingPattern);
    // Live Preview rejects a raw backtick in tilde-fence info too. Its
    // primary closer instead opens code, shifting the later pairings (#567).
    // Use the parsed boundary: a shorter or overindented body run is no closer.
    if (fence[0] === "~" && lines[0]!.includes("`") && codeFence(source, leaf)?.close) {
      openFences.add(stretch(leaf, lineOf(leaf), { ...leaf.position.end, offset: source.length }));
      break;
    }
    if (index === order.length - 1 || (lines.length > 1 && closes(lines.at(-1)!))) continue;
    // The fence ends before the document does, so its container ended it.
    // Live Preview reads on to a line that closes it, where the parser opens
    // a fence, and pairs the fences after that otherwise, so the rest of the
    // document counts.
    openFences.add(stretch(leaf, lineOf(leaf), { ...leaf.position.end, offset: source.length }));
    break;
  }
}

/** Unclosed inline runs and physical list fences share Live Preview's carried code state. */
export function collectUnclosedCode(
  document: Document,
  { order, openers, quotedItems, quotedLeaves }: ObsidianBlocks,
  positions: ProtectionSource,
  lines: readonly string[],
  text: ReadonlySet<Nodes>,
  openFences: Set<Nodes>,
): Set<Nodes> {
  const { source } = document;
  const { stretch, lineOf } = positions;
  const unclosedCode = new Set<Nodes>();
  /**
   * The runs of backticks that nothing closes in the text of `node`, outside
   * code, math, and wikilinks. Live Preview starts code at them also inside a
   * highlight, an inline comment, and an image's description, whose source
   * the parser does not read as code spans; a backtick in a link's
   * destination or title starts none, but counts in an image's source.
   */
  const openRuns = (node: Nodes, blockEnd: Point, inlineStart?: Point): Run[] => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return [];
    if (
      node.type === "inlineCode" &&
      node.position!.end.line > node.position!.start.line &&
      !source.startsWith("```", start)
    ) {
      unclosedCode.add(stretch(node, inlineStart ?? node.position!.start, blockEnd));
      return [];
    }
    if (
      node.type === "obsidianHighlight" ||
      node.type === "obsidianComment" ||
      node.type === "image" ||
      node.type === "imageReference"
    )
      return unclosedRuns(source, start, end);
    // The parser reads every run that another closes as code, so every one
    // left in text is unclosed.
    if (node.type === "text") return backtickRuns(source, start, end);
    return "children" in node
      ? node.children.flatMap((child) =>
          openRuns(child, blockEnd, inlineStart ?? child.position?.start),
        )
      : [];
  };
  /** A physical list-item fence hidden inside a block already read as list text. */
  const physicalListFence = (leaf: Nodes): boolean => {
    if (!text.has(leaf) || !leaf.position) return false;
    // Read each eligible leaf's physical rows once, before inline parsing
    // can pair raw backticks (#584). Tilde info with a raw backtick remains
    // paragraph text in Live Preview, so it does not start this fence state.
    for (let number = leaf.position.start.line; number <= leaf.position.end.line; number++)
      if (/^[ \t>]*(?:[-+*]|\d{1,9}[.)])[ \t]+(?:`{3,}|~{3,})[^`]*$/.test(lines[number - 1] ?? ""))
        return true;
    return false;
  };
  /**
   * The length of a run of three or more backticks whose code Live Preview
   * carries into the blocks below, up to a block with a run of the same
   * length, a fenced code block, or a list item. A run in a wikilink, in math,
   * or in an HTML block closes it too, because Live Preview reads none of
   * those inside the code.
   */
  let carry: number | undefined;
  // An outer run keeps styling nested quoted items (#524). Preserve the
  // existing protection for items that open their blockquote too (#494).
  let carryInQuote = false;
  for (const [leaf, item] of order) {
    const start = leaf.position?.start.offset;
    const end = leaf.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    if (physicalListFence(leaf)) {
      // A real native fence changes subsequent pairing, so retain the
      // existing conservative source-to-EOF policy (#390, #584).
      openFences.add(stretch(leaf, lineOf(leaf), { ...leaf.position!.end, offset: source.length }));
      break;
    }
    if (carry !== undefined) {
      const fenced = leaf.type === "code" && /^ {0,3}(?:```|~~~)/.test(source.slice(start, end));
      // A list item that a footnote definition opens, as in `[^1]: - a`, is
      // footnote text to Live Preview, which carries the code through it (#670).
      const opener = openers.get(leaf)?.type;
      if (
        (item &&
          opener !== "blockquote" &&
          opener !== "footnoteDefinition" &&
          (!quotedItems.has(leaf) || carryInQuote)) ||
        fenced
      )
        carry = undefined;
      else {
        // Quoted markers are literal code in Live Preview too (#494).
        unclosedCode.add(stretch(leaf, lineOf(leaf)));
        // A physical fence in HTML source starts code in Live Preview even
        // when the primary parse has no code node there (#519). Subsequent
        // fence pairings disagree, so the rest of the source must stay.
        if (
          leaf.type === "html" &&
          leaf.value.split(lineEndingPattern).some((line) => {
            const fence = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
            return fence && (fence[1]![0] === "~" || !fence[2]!.includes("`"));
          })
        ) {
          openFences.add(
            stretch(leaf, lineOf(leaf), { ...leaf.position!.end, offset: source.length }),
          );
          break;
        }
        // Live Preview shows an indented code block there as more of the
        // code, and its backticks close nothing.
        if (leaf.type === "code") continue;
        const runs = backtickRuns(source, start, end);
        const close = runs.findIndex(([, length]) => length === carry);
        if (close >= 0) {
          carry = carried(source, runs.slice(close + 1));
          carryInQuote = quotedLeaves.has(leaf);
        }
        continue;
      }
    }
    const parts =
      leaf.type === "table"
        ? leaf.children.flatMap((row) => row.children)
        : leaf.type === "paragraph" || leaf.type === "heading"
          ? [leaf]
          : [];
    const runs = parts.flatMap((part) => {
      const open = openRuns(part, part.position!.end);
      if (open.length > 0) unclosedCode.add(part);
      return open;
    });
    const long = runs.find(([, length]) => length >= 3);
    if (long === undefined) continue;
    // Live Preview shows the rest of a table as code from such a run.
    if (leaf.type === "table") unclosedCode.add(leaf);
    const after = backtickRuns(source, long[0] + long[1], end);
    const close = after.findIndex(([, length]) => length === long[1]);
    carry = close < 0 ? long[1] : carried(source, after.slice(close + 1));
    carryInQuote = quotedLeaves.has(leaf);
  }
  return unclosedCode;
}

/** A task marker can hide a native fence from the primary paragraph reading. */
export function collectTaskFences(
  document: Document,
  { order }: ObsidianBlocks,
  positions: ProtectionSource,
  boundaryText: Set<Nodes>,
): void {
  const { source } = document;
  const { lineStart, lineAround, stretch, lineOf } = positions;
  // A task item's fence is parsed as paragraph text, but starts a real code
  // block in Live Preview. Later fences pair differently in the two readings,
  // as for an open container fence, so preserve the remaining source (#488).
  for (const [leaf] of order) {
    if (leaf.type !== "paragraph" || !leaf.position) continue;
    const start = leaf.position.start.offset!;
    const line = source.slice(lineStart(start), lineAround(start)[1]);
    const task =
      /^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)+\[[^\]\r\n]\][ \t]+(`{3,}|~{3,})([^\r\n]*)$/.exec(
        line,
      );
    if (!task || (task[1]![0] === "`" && task[2]!.includes("`"))) continue;
    boundaryText.add(stretch(leaf, lineOf(leaf), { ...leaf.position.end, offset: source.length }));
    break;
  }
}

/** A run of backticks: its offset and its length. */
type Run = [number, number];

/**
 * The runs of backticks from `start` to `end`. A backslash before a run
 * escapes its first backtick only.
 */
function backtickRuns(source: string, start: number, end: number): Run[] {
  const runs: Run[] = [];
  // Bound the search itself: text without ticks must not repeatedly scan the
  // rest of the document before discovering that the result lies past `end`.
  const text = source.slice(start, end);
  for (let found = text.indexOf("`"); found >= 0;) {
    const at = start + found;
    let after = at;
    while (after < end && source[after] === "`") after++;
    let slashes = 0;
    while (source[at - 1 - slashes] === "\\") slashes++;
    const from = slashes % 2 === 0 ? at : at + 1;
    if (after > from) runs.push([from, after - from]);
    found = text.indexOf("`", after - start);
  }
  return runs;
}

/**
 * The runs of backticks from `start` to `end` that no later run of the same
 * length there closes. Runs of one or two also remain open when their next
 * matching run is on another physical line: Live Preview resets short code
 * there, including inside inline comments and image descriptions (#565).
 */
function unclosedRuns(source: string, start: number, end: number): Run[] {
  const runs = backtickRuns(source, start, end);
  /** The index of the next run of the same length after each run, or -1. */
  const next: number[] = [];
  const later = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index--) {
    const length = runs[index]![1];
    next[index] = later.get(length) ?? -1;
    later.set(length, index);
  }
  const open: Run[] = [];
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]!;
    const close = next[index]!;
    if (
      close < 0 ||
      (run[1] < 3 && lineEndingPattern.test(source.slice(run[0] + run[1], runs[close]![0])))
    )
      open.push(run);
    else index = close;
  }
  return open;
}

/**
 * The length of the run of three or more backticks whose code Live Preview
 * carries past the last of `runs`, if any. Live Preview closes a run with the
 * next run of the same length; the code of a run of one or two backticks ends
 * with its line.
 */
function carried(source: string, runs: Run[]): number | undefined {
  let open: Run | undefined;
  /** Where the line of the open run ends, and that of the current one. */
  let openLineEnd = 0;
  let lineEnd = -1;
  for (const run of runs) {
    if (run[0] >= lineEnd) lineEnd = lineBreak(source, run[0]);
    if (open !== undefined) {
      const sameLine = run[0] < openLineEnd;
      if (run[1] === open[1] && (open[1] >= 3 || sameLine)) {
        open = undefined;
        continue;
      }
      // Other runs are part of the code.
      if (open[1] >= 3 || sameLine) continue;
    }
    open = run;
    openLineEnd = lineEnd;
  }
  return open !== undefined && open[1] >= 3 ? open[1] : undefined;
}

/** The offset of the first line break at or after `from`, or the length of `source`. */
function lineBreak(source: string, from: number): number {
  for (let at = from; at < source.length; at++)
    if (source[at] === "\n" || source[at] === "\r") return at;
  return source.length;
}
