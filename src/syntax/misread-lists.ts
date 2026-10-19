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
   * with a list marker, and the text that renderers read as continuing it. In
   * the Obsidian dialect also those with a later line that Obsidian reads as
   * starting a list item where CommonMark reads text (issue #375).
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
  /**
   * In the Obsidian dialect, footnote definitions directly below a line of
   * paragraph text, also one that ends a list item or block quote. Reading view
   * reads the definition as more of that paragraph, and its indented lines as
   * code (issue #378). Each counts from the end of the line above it.
   */
  footnoteText: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, paragraphs and underlined headings whose text
   * starts on the line below a link reference definition and further right
   * than the definition. Reading view reads such a line as an indented code
   * block from four columns right of its container's content (issue #379).
   * Each counts from the start of its first line.
   */
  definitionCode: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, the first fenced code block that a list item or
   * block quote ends before a closing fence, with the rest of the document.
   * Obsidian reads the blocks below it as more of the code: Reading view the
   * lines directly below the fence's container, Live Preview everything up to
   * a line that would close the fence, where the parser opens one, so that it
   * pairs the fences after it otherwise (issue #390). It counts as one
   * stretch, from the start of the fence's first line to the document's end.
   */
  openFences: ReadonlySet<Nodes>;
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
 *
 * Obsidian starts a list below a paragraph line where CommonMark does not:
 * Live Preview at an ordered marker with a number other than 1 and text after
 * it, except in a block quote, and Reading view at an empty item, `*`, `+`,
 * `- `, or `1.`, which Live Preview reads so for `+ ` and `- ` (issue #375).
 * Its Reading view also continues a paragraph with a footnote definition
 * directly below it (issue #378), reads a line below a link reference
 * definition as an indented code block (issue #379), and continues a fenced
 * code block that a list item or block quote leaves open with the lines below
 * the container, as Live Preview does further (issue #390).
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
  const obsidian = document.dialect === "obsidian";
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
  /**
   * In the Obsidian dialect, the offset of the marker on the first line of
   * `node` after its first that Obsidian reads as starting a list item where
   * CommonMark reads text; `quoted` says whether `node` is in a block quote.
   */
  const obsidianItem = (node: Nodes, quoted: boolean): number | undefined => {
    const end = node.position!.end.offset!;
    // A marker four or more columns right of the text is more of the text.
    const text = columnAt(node.position!.start.offset!);
    const breaks = /\r\n|\r|\n/g;
    breaks.lastIndex = node.position!.start.offset!;
    for (let found = breaks.exec(source); found && found.index < end; found = breaks.exec(source)) {
      const lineStart = found.index + found[0].length;
      let lineEnd = lineStart;
      while (lineEnd < end && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") lineEnd++;
      const line = source.slice(lineStart, lineEnd);
      const prefix = /^[ \t>]*/.exec(line)![0].length;
      const content = line.slice(prefix);
      const ordered = /^(\d{1,9})[.)][ \t]+\S/.exec(content);
      if (
        columnAt(lineStart + prefix) - text <= 3 &&
        ((ordered && Number(ordered[1]) !== 1 && !quoted) ||
          /^(?:[*+]|-(?=[ \t])|0*1[.)])[ \t]*$/.test(content))
      )
        return lineStart + prefix;
    }
    return undefined;
  };
  /** Returns the last line of misread text that ends `parent` and whose `===` renderers read as text. */
  const visit = (parent: Parents, quoted = false): number | undefined => {
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
      const atStart =
        start !== undefined &&
        (listMarker.test(source.slice(start, start + 11)) || adjacent) &&
        !(index === 0 && parent.type === "listItem" && typeof parent.checked === "boolean");
      const item = obsidian && start !== undefined ? obsidianItem(child, quoted) : undefined;
      const misread = atStart || item !== undefined;
      if (misread || adjacent || reach !== undefined) {
        const column = columnAt(atStart ? start! : (item ?? offset));
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
        const last = visit(child, quoted || child.type === "blockquote");
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
  const footnoteText = new Set<Nodes>();
  const definitionCode = new Set<Nodes>();
  const openFences = new Set<Nodes>();
  if (document.dialect === "obsidian") {
    /**
     * Leaf blocks in document order, and whether each starts a list item, also
     * inside a container that does, as in `- > a`.
     */
    const order: [Nodes, boolean][] = [];
    /** Footnote definitions, each with the number of leaf blocks before it. */
    const footnotes: [Nodes, number][] = [];
    /** The footnote definition that each leaf block inside one is in. */
    const inFootnotes = new Map<Nodes, Nodes>();
    const collect = (node: Nodes, item: boolean, footnote: Nodes | undefined) => {
      if (node.type === "footnoteDefinition") footnotes.push([node, order.length]);
      if (leaves.has(node.type) || !("children" in node)) {
        order.push([node, item]);
        if (footnote) inFootnotes.set(node, footnote);
      } else
        node.children.forEach((child, index) =>
          collect(
            child,
            index === 0 && (item || node.type === "listItem"),
            node.type === "footnoteDefinition" ? node : footnote,
          ),
        );
    };
    collect(document.tree, false, undefined);
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
        : ({ ...node, position: { start, end } } as Nodes);
    /** The start of the line holding `node`'s start. */
    const lineOf = (node: Nodes): Point => {
      const start = node.position!.start;
      const offset = lineStart(start.offset!);
      return offset === start.offset ? start : { line: start.line, column: 1, offset };
    };
    /** Footnote definitions that Reading view reads as paragraph text. */
    const joined = new Set<Nodes>();
    for (const [footnote, count] of footnotes) {
      const previous = order[count - 1]?.[0];
      // A definition below another that is text, as `[^1]: a` and `[^2]: b`
      // below `Text` are, is text too.
      const around = previous && inFootnotes.get(previous);
      if (
        previous?.type === "paragraph" &&
        (around === undefined || joined.has(around)) &&
        previous.position &&
        footnote.position &&
        previous.position.end.line === footnote.position.start.line - 1
      ) {
        joined.add(footnote);
        // From the blank space that ends the line above, a line break there.
        let offset = previous.position.end.offset!;
        while (source[offset - 1] === " " || source[offset - 1] === "\t") offset--;
        footnoteText.add(stretch(footnote, { ...previous.position.end, offset }));
      }
    }
    order.forEach(([leaf], index) => {
      const next = order[index + 1]?.[0];
      if (leaf.type !== "definition" || !leaf.position || !next?.position) return;
      // An underlined heading below the definition starts at it, and its text after it.
      const start = textStart(next);
      const line =
        next.type === "heading" ? next.children[0]?.position?.start.line : next.position.start.line;
      // Only blank space and quote markers come before the text on its line, so
      // that it continues the definition's container, unlike the text of a
      // footnote definition or list item that starts there.
      if (
        start !== undefined &&
        line === leaf.position.end.line + 1 &&
        /^[ \t>]*$/.test(source.slice(lineStart(start), start)) &&
        columnAt(start) > columnAt(leaf.position.start.offset!)
      )
        definitionCode.add(stretch(next, lineOf(next)));
    });
    for (let index = 0; index < order.length - 1; index++) {
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
      const lines = text.split(/\r\n|\r|\n/);
      if (lines.length > 1 && closes(lines.at(-1)!)) continue;
      // The fence ends before the document does, so its container ended it.
      // Live Preview reads on to a line that closes it, where the parser opens
      // a fence, and pairs the fences after that otherwise, so the rest of the
      // document counts.
      openFences.add(stretch(leaf, lineOf(leaf), { ...leaf.position.end, offset: source.length }));
      break;
    }
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
  const result = {
    text,
    nested,
    next,
    descriptions,
    unclosedCode,
    htmlText,
    footnoteText,
    definitionCode,
    openFences,
  };
  found.set(document.tree, result);
  return result;
}

/** A run of backticks: its offset and its length. */
type Run = [number, number];
/** A place in the source, as a node's position gives it. */
type Point = NonNullable<Nodes["position"]>["start"];

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
