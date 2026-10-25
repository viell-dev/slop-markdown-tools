import type { Document, Edit } from "./types.js";
import { otherReading, range, unclosedFrontMatter } from "../syntax/parse.js";
import { rendererProtections } from "../syntax/renderer-protections.js";
import { githubHeadingLimit } from "../workspace/github-heading-source.js";

/**
 * Whether an edit would change text that the parser read where renderers may
 * read a list, or a block indented below it, which renderers may read inside
 * that list (`rendererProtections`, issue #191): replace some of their characters, or
 * insert text between two of them. Renderers may read such text as list items
 * or code, and the indentation of the blocks below it otherwise, which the
 * safety check, comparing the parser's readings, cannot see: `_r_` for `*r*`
 * in `- 0.     *r*` below a paragraph changes code on GitHub. The same goes for
 * a definition description on Forgejo and Gitea and the blocks below it, which
 * those renderers read as the description's blocks (issue #344), for a block
 * in Obsidian with a backtick that no run closes, where Obsidian shows code
 * that the parser does not (issue #362), for the blocks that Obsidian reads as
 * more of an HTML block above them (issue #358) or of a paragraph above lines
 * of blank space that hold a tab (issue #398), for the underlines, lazy
 * lines, and definition-like lines that Obsidian reads otherwise (issues #376,
 * #377, #383, #391, and #397), for the footnote definitions, lines below link
 * reference definitions, and blocks below open fences that Obsidian reads as
 * text or code (issues #378, #379, and #390), for the tables that it reads
 * otherwise (issue #359), and for the HTML blocks that it keeps inside a list
 * item, with the blocks and list markers that then stay as written (issue
 * #399), and for inline HTML comments that Live Preview carries across blocks
 * from paragraphs, headings, and table cells (issue #408). Only the part of the
 * edit that changes the text counts, so that an edit that copies such text,
 * such as a list rule's, can still apply.
 */
export function protectedEdit(document: Document): (edit: Edit) => boolean {
  // Live Preview reads all of an unclosed YAML document as source, including
  // below a malformed closer that Reading view accepts (issue #404).
  if (
    document.dialect === "obsidian" &&
    unclosedFrontMatter(document.source) === "---" &&
    !/^---(?:\r\n|\r|\n)?$/.test(document.source)
  )
    return () => true;
  const readings = [rendererProtections(document)];
  // Obsidian reads TOML front matter as paragraph text. Run the same range
  // protections on that reading too, so blocks below it see the paragraph
  // above them (issue #407). Range discovery does not request other readings.
  const plain =
    document.dialect === "obsidian" && document.tree.children[0]?.type === ("toml" as string)
      ? otherReading(document.tree)
      : undefined;
  if (plain) readings.push(rendererProtections({ ...document, tree: plain }));
  const { source } = document;
  // Only explicit separators have protected insertion points. A whole-line
  // boundaryText range still uses the ordinary strict block edges (#590).
  const boundaryStarts = new Set<number>();
  for (const misread of readings)
    for (const node of misread.boundaryText) {
      let start = range(node)[0];
      if (source[start] === "\n" && source[start - 1] === "\r") start--;
      if (
        start > 0 &&
        (source[start] === "\r" || source[start] === "\n") &&
        source[start - 1] !== "\r" &&
        source[start - 1] !== "\n"
      ) {
        boundaryStarts.add(start);
        // A separator-only range ends immediately after its line break. Keep
        // insertions there too, without freezing the following marker (#598).
        const end = range(node)[1];
        if (end - start <= 2 && /^(?:\r\n?|\n)$/.test(source.slice(start, end)))
          boundaryStarts.add(end);
      }
    }
  // Each distinct physical separator has one horizontal margin. These left
  // scans are disjoint, even when several readings protect the same break.
  const boundaryMargins: [number, number][] = [];
  const quoteMarkers: [number, number][] = [];
  for (const start of [...boundaryStarts].sort((a, b) => a - b)) {
    let left = start;
    while (left > 0 && (source[left - 1] === " " || source[left - 1] === "\t")) left--;
    boundaryMargins.push([left, start]);
    if (source[left - 1] === ">") {
      let first = left - 1;
      while (first > 0 && " \t>".includes(source[first - 1]!)) first--;
      if (first === 0 || source[first - 1] === "\r" || source[first - 1] === "\n") {
        // Keep physical quote-only markers, with their preceding line break,
        // while leaving trailing horizontal cleanup eligible (#590).
        let before = first;
        if (source[before - 1] === "\n") before--;
        if (source[before - 1] === "\r") before--;
        quoteMarkers.push([before, left]);
      }
    }
  }
  // The blocks can hold one another; their union, in order, is searched in O(log n).
  const blocks: [number, number][] = [];
  let githubLimit = document.dialect === "github" ? githubHeadingLimit(document) : undefined;
  const githubReading = document.dialect === "github" && otherReading(document.tree);
  if (githubReading) {
    const limit = githubHeadingLimit({ ...document, tree: githubReading });
    if (limit !== undefined) githubLimit = Math.min(githubLimit ?? limit, limit);
  }
  for (const [start, end] of Array.from(
    readings.flatMap((misread) => [
      ...misread.text,
      ...misread.nested,
      ...misread.descriptions,
      ...misread.unclosedCode,
      ...misread.htmlText,
      ...misread.underlines,
      ...misread.widgetHeadings,
      ...misread.lazyItems,
      ...misread.footnoteText,
      ...misread.definitionCode,
      ...misread.definitionLines,
      ...misread.openFences,
      ...misread.tableText,
      ...misread.tabText,
      ...misread.itemHtml,
      ...misread.commentText,
      ...misread.boundaryText,
    ]),
    (node) => range(node),
  )
    .concat(quoteMarkers)
    .sort((a, b) => a[0] - b[0])) {
    const last = blocks.at(-1);
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else blocks.push([start, end]);
  }
  if (githubLimit !== undefined) {
    // Merge with any existing ranges before the shared binary search.
    while (blocks.length && blocks.at(-1)![0] >= githubLimit) blocks.pop();
    const last = blocks.at(-1);
    if (last && last[1] >= githubLimit) last[1] = document.source.length;
    else blocks.push([githubLimit, document.source.length]);
  }
  if (!blocks.length) return () => false;
  // Existing source spaces can survive as a common suffix after a new break.
  // A replacement's quote-only blank margin has the same effect (#590).
  const trailingBreaks = (value: string, from: number, to: number): string => {
    let start = to;
    while (start > from && "\r\n \t>".includes(value[start - 1]!)) start--;
    return value.slice(start, to).replace(/[ \t>]/g, "");
  };
  const boundaryAt = (point: number) => {
    // A point between CR and LF reaches that same physical separator. This
    // also retains protection when a producer's original start was the LF.
    if (source[point] === "\n" && source[point - 1] === "\r") point--;
    let low = 0;
    let high = boundaryMargins.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (boundaryMargins[middle]![1] < point) low = middle + 1;
      else high = middle;
    }
    const margin = boundaryMargins[low];
    return margin !== undefined && margin[0] <= point;
  };
  const within = (from: number, to: number) => {
    let low = 0;
    let high = blocks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (blocks[middle]![1] <= from) low = middle + 1;
      else high = middle;
    }
    const block = blocks[low];
    return block !== undefined && from < block[1] && to > block[0];
  };
  return (edit) => {
    if (
      githubLimit !== undefined &&
      edit.start === source.length &&
      edit.end === edit.start &&
      edit.text
    )
      return true;
    if (!within(edit.start, edit.end) && !boundaryAt(edit.end)) return false;
    const before = source.slice(edit.start, edit.end);
    const { text } = edit;
    if (before === text) return false;
    const shorter = Math.min(before.length, text.length);
    let prefix = 0;
    while (prefix < shorter && before[prefix] === text[prefix]) prefix++;
    let suffix = 0;
    while (suffix < shorter - prefix && before.at(-1 - suffix) === text.at(-1 - suffix)) suffix++;
    const from = edit.start + prefix;
    const to = edit.end - suffix;
    if (
      boundaryAt(to) &&
      trailingBreaks(before, prefix, before.length - suffix) !==
        trailingBreaks(text, prefix, text.length - suffix)
    )
      return true;
    return within(from, to) || (from === to && boundaryAt(from));
  };
}
