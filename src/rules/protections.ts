import { walk } from "../syntax/walk.js";
import type { Dialect, Document } from "../core/types.js";
import { range, startsWithMarker } from "../syntax/parse.js";
import { countBelow } from "../syntax/source.js";
import { type Range } from "./shared.js";
import { lineBounds, lineBreak } from "../syntax/source.js";

/**
 * Where a document's line breaks are, and where the strings that rules look
 * for on a line occur, all sorted. Rules ask about the line of every emphasis
 * or code span; searching the line itself each time took time that grows with
 * the square of a long line's length.
 */
interface LineIndex {
  breaks: number[];
  found: Map<string, number[]>;
}

const lineIndexes = new WeakMap<Document, LineIndex>();

function lineIndex(document: Document): LineIndex {
  let index = lineIndexes.get(document);
  if (!index) {
    const breaks: number[] = [];
    for (let at = 0; at < document.source.length; at++)
      if (document.source[at] === "\r" || document.source[at] === "\n") breaks.push(at);
    lineIndexes.set(document, (index = { breaks, found: new Map() }));
  }
  return index;
}

/** `lineBounds` for a document, from its line index. */
function indexedLineBounds(document: Document, start: number, end: number): [number, number] {
  const { breaks } = lineIndex(document);
  const before = countBelow(breaks, start);
  const after = countBelow(breaks, end);
  return [before ? breaks[before - 1]! + 1 : 0, breaks[after] ?? document.source.length];
}

/**
 * Where `text` occurs in the document between `from` and `to`, wholly: the
 * last occurrence, or -1 for none.
 */
function lastWithin(document: Document, text: string, from: number, to: number): number {
  const { found } = lineIndex(document);
  let positions = found.get(text);
  if (!positions) {
    positions = [];
    for (
      let at = document.source.indexOf(text);
      at >= 0;
      at = document.source.indexOf(text, at + 1)
    )
      positions.push(at);
    found.set(text, positions);
  }
  const last = positions[countBelow(positions, to - text.length + 1) - 1];
  return last !== undefined && last >= from ? last : -1;
}

/**
 * Gitea does not parse a `_` run as an emphasis delimiter when the next `_` on
 * its physical line starts `_.py`, or when the run itself does and no `_`
 * follows, so `__init__.py` stays literal. The outcome depends on everything
 * else on the line, code spans included: a line containing `_.py` before or
 * after an edit can gain or lose emphasis when markers change or lines join.
 */
function giteaPyLine(document: Document, start: number, end: number): boolean {
  return lastWithin(document, "_.py", ...indexedLineBounds(document, start, end)) >= 0;
}

/** Forgejo and its upstream Gitea build on goldmark with shared extensions. */
const goldmarkForges: Partial<Record<Dialect, string>> = { forgejo: "Forgejo", gitea: "Gitea" };

/**
 * Whether a range lies between `\(` and `\)` on its line, which Forgejo, and
 * Gitea where enabled, render as math. GFM parses emphasis and code spans
 * there, and changing them would change the formula.
 */
function inForgeMath(document: Document, start: number, end: number): boolean {
  const [lineStart, lineEnd] = indexedLineBounds(document, start, end);
  return (
    lastWithin(document, "\\(", lineStart, start) > lastWithin(document, "\\)", lineStart, start) &&
    lastWithin(document, "\\)", end, lineEnd) >= 0
  );
}

/**
 * The first lines of the document's Obsidian callouts and GitHub, Forgejo, or
 * Gitea alerts, from the marker on, which hold an Obsidian callout's title and
 * an alert's marker on its own.
 */
function calloutTitles(document: Document): Range[] {
  const titles: Range[] = [];
  if (document.dialect !== "commonmark")
    walk(document.tree, "blockquote", (quote) => {
      const first = quote.children[0];
      if (first?.type !== "paragraph") return;
      const [start] = range(first);
      const end = lineBounds(document.source, start, start)[1];
      if (startsWithMarker(document.source.slice(start, end), first)) titles.push([start, end]);
    });
  return titles;
}

/** Inline nodes whose source joined lines cannot change. */
const obsidianOpaque = new Set(["inlineCode", "inlineMath", "wikiLink", "obsidianHighlight"]);

/**
 * Whether text that the parser read as a paragraph or a heading's text has a
 * table delimiter row as its second line. GitHub reads a table there, and so
 * does the parser, except directly below a table that ends in a list item or
 * block quote, where it reads the lines as text (issue #283). Joining the lines
 * or adding a blank line above them would change what GitHub or the parser
 * reads.
 */
function misreadTable(text: string): boolean {
  const second = text.split(lineBreak, 2)[1];
  return second !== undefined && second.includes("|") && delimiterRow.test(second);
}

/** A GFM table's delimiter row, such as `| --- | :-: |`, after any container markers. */
const delimiterRow = /^[ \t>]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
export { giteaPyLine, goldmarkForges, inForgeMath, calloutTitles, obsidianOpaque, misreadTable };
