import type { Nodes } from "mdast";
import type { Document } from "../core/types.js";
import { range } from "./parse.js";
import { walk } from "./walk.js";

/**
 * Where inline math at the start of a line decides what Obsidian's Live Preview
 * shows (issue #1008). Live Preview reads what follows such math as the start
 * of a block, so it hides a `>` there and shows the rest of the line as a
 * quote. On a line with indentation or a quote marker it always does. On a line
 * that starts with the math at the first column, it does only below an earlier
 * line that starts with math there, however far above that line is.
 */
export interface ObsidianMathLines {
  /** The inline math, by offset, that only blank space or more math separates from a `>`. */
  opening: ReadonlySet<number>;
  /** That of it which starts a line, and which Live Preview reads a quote after. */
  quotes: ReadonlySet<number>;
  /**
   * The first line that starts with math at the first column, where reflow
   * could move that math and a line below would then show otherwise.
   */
  kept: number | undefined;
  /** No line above this offset may come to start with math at the first column. */
  guarded: number;
}

export function obsidianMathLines(document: Document): ObsidianMathLines {
  const { source, tree } = document;
  const opening = new Set<number>();
  const quotes = new Set<number>();
  if (document.dialect !== "obsidian" || !source.includes("$") || !source.includes(">"))
    return { opening, quotes, kept: undefined, guarded: 0 };

  const inline: [from: number, to: number][] = [];
  /** The lines that start with math at the first column. */
  const lines: { at: number; reflows: boolean }[] = [];
  let block: Nodes | undefined;
  walk(tree, (node) => {
    if (node.type === "paragraph" || node.type === "heading" || node.type === "table") block = node;
    if ((node.type !== "inlineMath" && node.type !== "math") || !node.position) return;
    const [from, to] = range(node);
    if (node.type === "inlineMath") inline.push([from, to]);
    if (node.position.start.column !== 1) return;
    // Reflow keeps the start of a paragraph's first line, and moves no other block's lines.
    const reflows =
      node.type === "inlineMath" &&
      block?.type === "paragraph" &&
      block.position?.start.line !== node.position.start.line;
    lines.push({ at: from, reflows });
  });
  const first = lines[0]?.at ?? Infinity;

  // From the last math on, so that math directly before other math knows what follows that.
  for (let index = inline.length - 1; index >= 0; index--) {
    const [from, to] = inline[index]!;
    let next = to;
    while (/[^\S\r\n]/.test(source[next] ?? "")) next++;
    if (source[next] !== ">" && (inline[index + 1]?.[0] !== next || !opening.has(next))) continue;
    opening.add(from);
    let content = from;
    while (content > 0 && /[ \t>]/.test(source[content - 1]!)) content--;
    if (content > 0 && !/[\r\n]/.test(source[content - 1]!)) continue;
    if (content < from || from > first) quotes.add(from);
  }

  // The first line at the first column that the line at `first` makes a quote, unless a line
  // between them that stays in place does so too.
  const shown = lines.find(({ at }) => quotes.has(at));
  const kept =
    shown && lines.every(({ at, reflows }) => reflows || at >= shown.at) ? first : undefined;
  // The line at `first` would be such a quote itself, if a line above it started with math.
  return { opening, quotes, kept, guarded: kept !== undefined || opening.has(first) ? first : 0 };
}
