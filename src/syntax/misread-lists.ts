import type { Nodes, Parents, Root } from "mdast";
import type { Document } from "../core/types.js";

/**
 * A list marker as CommonMark reads one at the start of a line's content: a
 * bullet, `-`, `*`, or `+`, or a number of one to nine digits followed by `.`
 * or `)`, and then a space, a tab, or the end of the line.
 */
export const listMarker = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t\r\n]|$)/;
/**
 * A line whose content, after blank space and block quote markers, starts with
 * `:` and a space or tab. In a paragraph, such a line opens a definition
 * description on Forgejo and Gitea.
 */
export const descriptionLine = /^[ \t>]*:[ \t]/m;

/**
 * Text that the parser read where renderers may read a list, or on Forgejo and
 * Gitea a definition description, and the blocks after it.
 */
export interface MisreadLists {
  /**
   * Paragraphs, and headings underlined with `===` or `---`, whose text starts
   * with a list marker, and the text that renderers read as continuing it.
   */
  text: ReadonlySet<Nodes>;
  /**
   * The blocks after such text, or after a description, in its container whose
   * first lines start further right than the text, up to one that does not.
   * Renderers may read them inside the list's last item or the description,
   * where their indentation counts from the item's text: an indented code block
   * can be a paragraph there.
   */
  nested: ReadonlySet<Nodes>;
  /**
   * The block after those below such text, which starts no further right than
   * the text. Renderers may read it as more items of the list.
   */
  next: ReadonlySet<Nodes>;
  /**
   * In the Forgejo and Gitea dialects, paragraphs with a line that opens a
   * definition description, as `Term` and `: 2. x` do. Those renderers read
   * the description as blocks, here an ordered list (issue #344).
   */
  descriptions: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, paragraphs, headings, and table cells whose text
   * holds a backtick that no run of the same length closes, which the parser
   * leaves as text, also in a highlight, an inline comment, or an image's
   * description. Obsidian's Live Preview shows the text after it as code, at
   * least to the end of its line, and Reading view pairs a run of two or more
   * with a later, shorter one, as in ``a ``` b `c` d`` (issue #362).
   *
   * After a run of three or more, Live Preview shows the blocks below as code
   * too, also out of a list item and across blank lines, up to a block with a
   * run of the same length outside an indented code block, which it closes
   * there, a fenced code block, or a list item. Those blocks are in the set as
   * well, with a table that holds such a run.
   */
  unclosedCode: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, the blocks that Reading view reads as more of an
   * HTML block above them. A line of blank space directly below an HTML block
   * that ends at a blank line continues the block, and so do the blocks after
   * it, up to an empty line (issue #358). Each counts from the start of its
   * first line, with the marker of a list item there.
   */
  htmlText: ReadonlySet<Nodes>;
}

/** Leaf blocks: their children, if they have any, are not blocks. */
const leaves = new Set<Nodes["type"]>(["paragraph", "heading", "table", "code", "html"]);
const found = new WeakMap<Root, MisreadLists>();

/**
 * Where renderers may read a list in text that the parser read as text.
 *
 * micromark refuses to start a list that does not start at 1, or an empty
 * item, where it would interrupt a paragraph, as CommonMark says, but also
 * where no paragraph is open: at the start of a list item, block quote, or
 * footnote definition below a paragraph, and after an indented code block
 * (issue #191). It reads the line as text there, where GitHub, commonmark.js,
 * and markdown-it read a list. By CommonMark's rules, text can start with a
 * list marker only below a link reference definition, as what remains of the
 * definition's lines; GitHub and commonmark.js read text there too, and
 * markdown-it a list. The paragraph of a task list item starts after its
 * checkbox, which renderers read as the start of the item's text, so it does
 * not count. Renderers read the `===` below such text as text, of the list
 * item or after an empty one, so a paragraph or heading on the next line
 * continues it too, and a block there is nested: a `---` would underline it.
 * Where such text ends a list item or block quote, renderers continue it
 * lazily into a paragraph or heading on the next line below the container.
 *
 * Forgejo and Gitea read a definition list, which the parser reads as text:
 * `Term` and a line `: 2. x` below it are a term and a description, and the
 * description holds blocks, here an ordered list, as a list item does. The
 * blocks indented below it in its container belong to it too (issue #344).
 */
export function misreadLists(document: Document): MisreadLists {
  const known = found.get(document.tree);
  if (known) return known;
  const { source } = document;
  const forge = document.dialect === "forgejo" || document.dialect === "gitea";
  const text = new Set<Nodes>();
  const nested = new Set<Nodes>();
  const next = new Set<Nodes>();
  const descriptions = new Set<Nodes>();
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
  /** Where a paragraph's or an underlined heading's text starts. */
  const textStart = (node: Nodes): number | undefined => {
    const start = node.position?.start.offset;
    if (start === undefined || node.position?.end.offset === undefined) return undefined;
    if (node.type === "paragraph") return start;
    // An underlined heading below link reference definitions starts at them.
    if (node.type === "heading" && source[start] !== "#")
      return node.children[0]?.position?.start.offset ?? start;
    return undefined;
  };
  /** Returns the last line of misread text that ends `parent` and whose `===` renderers read as text. */
  const visit = (parent: Parents): number | undefined => {
    let reach: number | undefined;
    /** The last line of misread text whose `===` renderers read as text, if the last block is that. */
    let continued: number | undefined;
    /** Whether that text ends the last block, a container, rather than being it. */
    let inside = false;
    /** The column of the last definition description while the blocks after it may belong to it. */
    let described: number | undefined;
    parent.children.forEach((child, index) => {
      const offset = child.position?.start.offset;
      if (offset === undefined) return;
      const start = textStart(child);
      if (described !== undefined) {
        if (columnAt(offset) > described) nested.add(child);
        else described = undefined;
      }
      if (
        forge &&
        start !== undefined &&
        descriptionLine.test(source.slice(offset, child.position!.end.offset))
      ) {
        descriptions.add(child);
        described = Math.min(described ?? columnAt(offset), columnAt(offset));
      }
      // Renderers continue the text lazily on the line below the container
      // that it ends, but only with text (issue #343).
      const adjacent =
        continued === child.position!.start.line - 1 && (!inside || start !== undefined);
      const misread =
        start !== undefined &&
        (listMarker.test(source.slice(start, start + 11)) || adjacent) &&
        !(index === 0 && parent.type === "listItem" && typeof parent.checked === "boolean");
      if (misread || adjacent || reach !== undefined) {
        const column = columnAt(misread ? start! : offset);
        if ((adjacent && !misread) || (reach !== undefined && column > reach)) nested.add(child);
        else if (reach !== undefined) {
          next.add(child);
          reach = undefined;
        }
        if (misread) {
          text.add(child);
          reach = Math.min(reach ?? column, column);
        }
      }
      continued =
        misread && child.type === "heading" && child.depth === 1
          ? child.position!.end.line
          : undefined;
      inside = false;
      if ("children" in child && !leaves.has(child.type)) {
        const last = visit(child);
        if (last !== undefined && last === child.position!.end.line) {
          continued = last;
          inside = true;
        }
      }
    });
    return continued;
  };
  visit(document.tree);
  const htmlText = new Set<Nodes>();
  const unclosedCode = new Set<Nodes>();
  if (document.dialect === "obsidian") {
    /**
     * Leaf blocks in document order, and whether each starts a list item, also
     * inside a container that does, as in `- > a`.
     */
    const order: [Nodes, boolean][] = [];
    const collect = (node: Nodes, item: boolean) => {
      if (leaves.has(node.type) || !("children" in node)) order.push([node, item]);
      else
        node.children.forEach((child, index) =>
          collect(child, index === 0 && (item || node.type === "listItem")),
        );
    };
    collect(document.tree, false);
    const lines = source.split(/\r\n|\r|\n/);
    /** Whether line `number`, counted from 1, holds blank space and more than block quote markers. */
    const spaced = (number: number) => {
      const line = lines[number - 1] ?? "";
      return /^[ \t>]*$/.test(line) && /[^>]/.test(line);
    };
    /**
     * Whether the last leaf block is an HTML block that ends at a blank line, or
     * text that Obsidian reads as more of one, which the next block may continue.
     * Leaf blocks count, not containers, because an empty line inside a list
     * ends the HTML block there.
     */
    let open = false;
    order.forEach(([leaf], index) => {
      const previous = order[index - 1]?.[0];
      if (open && previous?.position && leaf.position) {
        for (let line = previous.position.end.line + 1; line < leaf.position.start.line; line++)
          if (!spaced(line)) open = false;
        if (open) {
          // From the start of its line: a list item's marker there, `- ` in
          // `- *a*`, is text of the HTML block too.
          const offset = leaf.position.start.offset ?? 0;
          let from = offset;
          while (from > 0 && source[from - 1] !== "\n" && source[from - 1] !== "\r") from--;
          const start = { ...leaf.position.start, offset: from, column: 1 };
          htmlText.add(from === offset ? leaf : { ...leaf, position: { ...leaf.position, start } });
        }
      }
      // Other HTML blocks end at their own end marker, as a comment does at `-->`.
      if (
        !open &&
        leaf.type === "html" &&
        leaf.position &&
        !/^<(?:!--|\?|!\[CDATA\[|![A-Za-z]|(?:script|pre|style|textarea)(?:[\s>]|$))/i.test(
          leaf.value.trimStart(),
        )
      )
        open = spaced(leaf.position.end.line + 1);
    });
    /**
     * The runs of backticks that nothing closes in the text of `node`, outside
     * code, math, and wikilinks. Live Preview starts code at them also inside a
     * highlight, an inline comment, and an image's description, whose source
     * the parser does not read as code spans; a backtick in a link's
     * destination or title starts none, but counts in an image's source.
     */
    const openRuns = (node: Nodes): Run[] => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return [];
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
      return "children" in node ? node.children.flatMap(openRuns) : [];
    };
    /**
     * The length of a run of three or more backticks whose code Live Preview
     * carries into the blocks below, up to a block with a run of the same
     * length, a fenced code block, or a list item. A run in a wikilink, in math,
     * or in an HTML block closes it too, because Live Preview reads none of
     * those inside the code.
     */
    let carry: number | undefined;
    for (const [leaf, item] of order) {
      const start = leaf.position?.start.offset;
      const end = leaf.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      if (carry !== undefined) {
        const fenced = leaf.type === "code" && /^ {0,3}(?:```|~~~)/.test(source.slice(start, end));
        if (item || fenced) carry = undefined;
        else {
          unclosedCode.add(leaf);
          // Live Preview shows an indented code block there as more of the
          // code, and its backticks close nothing.
          if (leaf.type === "code") continue;
          const runs = backtickRuns(source, start, end);
          const close = runs.findIndex(([, length]) => length === carry);
          if (close >= 0) carry = carried(source, runs.slice(close + 1));
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
        const open = openRuns(part);
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
    }
  }
  const result = { text, nested, next, descriptions, unclosedCode, htmlText };
  found.set(document.tree, result);
  return result;
}

/** A run of backticks: its offset and its length. */
type Run = [number, number];

/**
 * The runs of backticks from `start` to `end`. A backslash before a run
 * escapes its first backtick only.
 */
function backtickRuns(source: string, start: number, end: number): Run[] {
  const runs: Run[] = [];
  for (let at = source.indexOf("`", start); at >= 0 && at < end;) {
    let after = at;
    while (after < end && source[after] === "`") after++;
    let slashes = 0;
    while (source[at - 1 - slashes] === "\\") slashes++;
    const from = slashes % 2 === 0 ? at : at + 1;
    if (after > from) runs.push([from, after - from]);
    at = source.indexOf("`", after);
  }
  return runs;
}

/**
 * The runs of backticks from `start` to `end` that no later run of the same
 * length there closes, as CommonMark pairs them into code spans.
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
    if (next[index]! < 0) open.push(runs[index]!);
    else index = next[index]!;
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
