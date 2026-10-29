import type { Nodes, Parents } from "mdast";
import type { Document } from "../core/types.js";
import { leaves } from "./protection-source.js";

/** GitHub's display-math paragraph can carry through a following native heading. */
export function collectGithubMathProtections(document: Document): Set<Nodes> {
  const boundaryText = new Set<Nodes>();
  // GitHub builds display math from paragraphs. A Setext underline below
  // text directly after its closing dollars underlines the whole paragraph,
  // including the dollar lines (#336). Keep that boundary and its content
  // together, including consecutive math blocks and blocks inside containers,
  // or a lazy continuation outside the container ending with that math.
  if (document.dialect === "github") {
    const visitMath = (parent: Parents): Nodes | undefined => {
      let first: Nodes | undefined;
      let previous: Nodes | undefined;
      for (const child of parent.children) {
        const trailing =
          "children" in child && !leaves.has(child.type) ? visitMath(child) : undefined;
        const adjacent =
          previous?.position !== undefined &&
          child.position !== undefined &&
          previous.position.end.line === child.position.start.line - 1;
        if (child.type === "math") {
          if (!adjacent || !first) first = child;
        } else {
          if (
            first?.position &&
            adjacent &&
            child.type === "heading" &&
            child.position!.end.line > child.position!.start.line
          )
            boundaryText.add({
              ...child,
              position: { start: first.position.start, end: child.position!.end },
            });
          first = trailing;
        }
        previous = child;
      }
      // The final math paragraph can continue lazily outside its quote or
      // list item. A physical blank at the container's end stops that carry.
      return previous?.position?.end.line === parent.position?.end.line ? first : undefined;
    };
    visitMath(document.tree);
  }
  return boundaryText;
}

/**
 * A complete open or closing tag alone on its line, apart from spaces and tabs:
 * the start of a CommonMark HTML block of kind 7. Unlike the specification,
 * GitHub starts one at `</pre>` too, so the raw-text names are not excluded.
 * Kind 6 names cannot reach a line of paragraph text after its first.
 */
export const tagLine =
  /^(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][\w.:-]*(?:[ \t]*=[ \t]*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^ \t\r\n"'=<>`]+))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/;
/** The line break before the next line of only spaces and tabs, through that line's break. */
const blankLine = /(?:\r\n|\r(?!\n)|\n)[ \t]*(?:\r\n|\r(?!\n)|\n|$)/g;

/** A container open around a paragraph, and how a later line continues it. */
interface Open {
  /** The block that GitHub ends at a lazy tag line: a quote, a footnote, or an item's list. */
  unit: Nodes;
  /** A quote's `>`, or else the column that its content starts at. */
  column: number | ">";
}

/**
 * GitHub (cmark-gfm) lets a lazy line that starts an HTML block of kind 7, such
 * as `<b>` alone below `- a`, end the list item, block quote, or footnote
 * definition that the line does not continue, and reads it as an HTML block up
 * to the next blank line. CommonMark, the primary reading, keeps it in the
 * container's paragraph, as commonmark.js, markdown-it, Forgejo, Gitea, and
 * Obsidian do (#762). Each region runs from the outermost container that
 * GitHub ends, a list for an item, through that blank line and any top-level
 * block that starts before it: edits there could change what GitHub shows,
 * as `_` for literal `*` after the tag, a blank line that splits GitHub's
 * HTML block, or numbering that a separate GitHub list keeps.
 */
export function collectGithubLazyHtmlProtections(
  document: Document,
  boundaryText: Set<Nodes>,
): void {
  const { source, dialect, tree } = document;
  if (dialect !== "github" || !source.includes("<")) return;
  /** The visual column of `offset` on its line, with tabs to multiples of four. */
  const columnOf = (offset: number) => {
    let start = offset;
    while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") start--;
    let column = 0;
    for (let at = start; at < offset; at++)
      column = source[at] === "\t" ? column + 4 - (column % 4) : column + 1;
    return column;
  };
  /**
   * The outermost container in `chain` that the line from `from` to `to` does
   * not continue, when the line then starts an HTML block of kind 7.
   */
  const endedBy = (from: number, to: number, chain: Open[]): Open | undefined => {
    let at = from;
    let column = 0;
    const advance = () => {
      column = source[at] === "\t" ? column + 4 - (column % 4) : column + 1;
      at++;
    };
    for (const open of chain) {
      const matchedAt = at;
      const matchedColumn = column;
      while (at < to && (source[at] === " " || source[at] === "\t")) {
        if (open.column !== ">" && column >= open.column) break;
        advance();
      }
      const continued =
        open.column === ">"
          ? column - matchedColumn <= 3 && source[at] === ">"
          : column >= open.column;
      if (!continued) {
        // Block starts are tried after the containers that the line continues.
        let indent = matchedColumn;
        let text = matchedAt;
        while (text < to && (source[text] === " " || source[text] === "\t")) {
          indent = source[text] === "\t" ? indent + 4 - (indent % 4) : indent + 1;
          text++;
        }
        return indent - matchedColumn <= 3 && tagLine.test(source.slice(text, to))
          ? open
          : undefined;
      }
      if (open.column === ">") {
        advance();
        // The optional space after `>`; a tab's remaining columns stay counted.
        if (source[at] === " " || source[at] === "\t") advance();
      }
    }
    return undefined;
  };
  const regions: [Nodes, number, number][] = [];
  // Lines of one stretch share the next blank line; search each stretch once.
  let searched: [number, number] = [-1, -1];
  // Lines are checked in source order, so one forward search finds each `<`.
  let nextTag = -1;
  /** Checks the line from `from` against `chain`; returns where the line ends. */
  const scanLine = (from: number, chain: Open[]): number => {
    if (nextTag < from) {
      nextTag = source.indexOf("<", from);
      if (nextTag < 0) nextTag = source.length;
    }
    let to = from;
    while (to < source.length && source[to] !== "\n" && source[to] !== "\r") to++;
    if (nextTag >= to) return to;
    const ended = endedBy(from, to, chain);
    if (!ended) return to;
    if (!(from >= searched[0] && from < searched[1])) {
      blankLine.lastIndex = to;
      const blank = blankLine.exec(source);
      searched = [from, blank ? blank.index + blank[0].length : source.length];
    }
    // Later tag lines of one stretch usually repeat its range.
    const unitStart = ended.unit.position!.start.offset!;
    const last = regions.at(-1);
    if (last?.[1] !== unitStart || last[2] !== searched[1])
      regions.push([ended.unit, unitStart, searched[1]]);
    return to;
  };
  /**
   * Lazy lines only ever continue paragraph text, and CommonMark derives more
   * than paragraphs from it: a Setext heading (never an ATX heading, a single
   * line) and leading link definitions, whose following paragraph or heading
   * can then start at a lazy line.
   */
  const paragraphText = (node: Nodes) =>
    node.type === "paragraph" ||
    node.type === "definition" ||
    (node.type === "heading" && node.position!.end.line > node.position!.start.line);
  const visit = (parent: Parents, chain: Open[]) => {
    let previous: Nodes | undefined;
    for (const node of parent.children) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      if (chain.length) {
        // A block right below a paragraph or definition in the same container
        // starts on a line that the open paragraph text could take lazily: a
        // following paragraph or heading after definitions, or a table whose
        // header row is the tag line (#770).
        if (
          (previous?.type === "paragraph" || previous?.type === "definition") &&
          previous.position?.end.line === node.position!.start.line - 1
        ) {
          let from = start;
          while (from > 0 && source[from - 1] !== "\n" && source[from - 1] !== "\r") from--;
          scanLine(from, chain);
        }
        if (paragraphText(node))
          for (let at = start; at < end; at++) {
            if (source[at] !== "\n" && source[at] !== "\r") continue;
            if (source[at] === "\r" && source[at + 1] === "\n") at++;
            at = Math.min(scanLine(at + 1, chain), end) - 1;
          }
      }
      previous = node;
      if ("children" in node && !leaves.has(node.type)) {
        let open: Open | undefined;
        if (node.type === "blockquote") open = { unit: node, column: ">" };
        else if (node.type === "listItem" || node.type === "footnoteDefinition") {
          const first = node.children[0]?.position?.start.offset;
          if (first !== undefined)
            open = {
              unit: node.type === "listItem" ? parent : node,
              column:
                node.type === "listItem"
                  ? columnOf(first)
                  : columnOf(node.position!.start.offset!) + 4,
            };
        }
        visit(node, open ? [...chain, open] : chain);
      }
    }
  };
  visit(tree, []);
  const roots = tree.children;
  for (const [unit, start, blankEnd] of regions) {
    let end = blankEnd;
    // Top-level blocks that start before the blank line may continue past it
    // in the primary reading, where GitHub starts afresh.
    let low = 0;
    let high = roots.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (roots[middle]!.position!.end.offset! <= start) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < roots.length; index++) {
      const root = roots[index]!.position!;
      if (root.start.offset! >= end) break;
      end = Math.max(end, root.end.offset!);
    }
    boundaryText.add({
      ...unit,
      position: {
        start: unit.position!.start,
        end: { ...unit.position!.end, offset: end },
      },
    });
  }
}

/** A Setext underline alone on its line, which a paragraph can show as text. */
const underlineLine = /^[ \t]*(?:=+|-+)[ \t]*$/;

/**
 * GitHub reads the link reference definitions at the start of a paragraph
 * when a Setext underline (`===`, `--` or `-`) follows them, before a table
 * directly below can interrupt the paragraph, and shows the underline as
 * text (#732). Joined with the next line, the underline is no longer one and
 * GitHub shows the definitions as text instead. Keep the line breaks around
 * such an underline when the paragraph has more lines.
 */
export function collectGithubDefinitionUnderlines(
  document: Document,
  boundaryText: Set<Nodes>,
): void {
  const { source, dialect, tree } = document;
  if (dialect !== "github") return;
  const adjacent = (above: Nodes | undefined, below: Nodes) =>
    above?.position !== undefined && above.position.end.line === below.position!.start.line - 1;
  const lineBreak = /\r\n?|\n/g;
  const visit = (parent: Parents) => {
    parent.children.forEach((child, index) => {
      if ("children" in child && !leaves.has(child.type)) visit(child);
      const next = parent.children[index + 1];
      if (
        child.type !== "paragraph" ||
        parent.children[index - 1]?.type !== "definition" ||
        next?.type !== "table" ||
        !adjacent(parent.children[index - 1], child) ||
        !adjacent(child, next)
      )
        return;
      const start = child.position!.start.offset!;
      lineBreak.lastIndex = start;
      const after = lineBreak.exec(source);
      if (!after || after.index >= child.position!.end.offset!) return;
      if (!underlineLine.test(source.slice(start, after.index))) return;
      let before = start;
      while (before > 0 && source[before - 1] !== "\n" && source[before - 1] !== "\r") before--;
      before--;
      if (source[before] === "\n" && source[before - 1] === "\r") before--;
      boundaryText.add({
        ...child,
        position: {
          start: { ...child.position!.start, offset: before },
          end: { ...child.position!.end, offset: after.index + after[0].length },
        },
      });
    });
  };
  visit(tree);
}
