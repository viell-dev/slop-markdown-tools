import type { List, Nodes, Parents, Root } from "mdast";
import type { Document } from "../core/types.js";
import { labelEnd, range, startsWithMarker } from "./parse.js";
import {
  capturedLineBreak,
  lineBreak as lineEndingPattern,
  lineBreakMatcher,
  lineBreaks,
  escaped,
} from "./source.js";

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
 * A line that Obsidian's Live Preview styles as a link reference definition
 * where it starts at the first column (issue #391): `[`, a label, in which `[`
 * and an escaped `]` may stand, and `]:`, whatever follows. It styles neither
 * `[[x]]: y` nor `[r][s]: x` nor `[r] : x` so. After indentation or quote
 * markers it hides the destination too, without that line class (issue #411).
 */
export const definitionLike = /^\[(?:\\.|[^\\\]])*\]:/;

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
  /** Either Obsidian view can keep code through EOF after an HTML/code transition (#433, #529). */
  htmlCodeToEnd: boolean;
  /**
   * In the Obsidian dialect, the blocks that Reading view reads as more of an
   * HTML block above them. A line of blank space directly below an HTML block
   * that ends at a blank line continues the block, and so do the blocks after
   * it, up to an empty line (issue #358). Each counts from the start of its
   * first line, with the marker of a list item there.
   * Also the HTML source opened in a container and continued beyond its end:
   * each range spans both views' raw regions, through their later terminator
   * or EOF, starting at the HTML opener (issue #428).
   * An inline HTML opener can carry Live Preview's raw state across blocks
   * too, through its closer or EOF (issue #435). In root HTML, an unclosed
   * child can retain that state after the parent's closer (issue #556).
   */
  htmlText: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, the underlined headings whose underline one of the
   * views reads as text: Reading view one with blank space after it, or before
   * it beyond the heading's text, and Live Preview a lone `-` (issue #383);
   * level-1 headings with more than one text line, or headings beginning with
   * a reference-like line, also after indentation or quote markers (#397,
   * #434); and paragraphs in a block quote or list item
   * with a lazy line of `=` or `-`, which Reading view reads as an underline
   * (issue #377). Each counts from the line break before the underline to the
   * end of its line. Also the final text line before a compact hyphen break
   * outside its container: a quote's lazy continuation, or a list's second
   * or later continuation after an earlier lazy line. Its range runs from
   * the prior break through the underline, including any inline node that
   * crosses that break, preserving the physical heading line (#554).
   */
  underlines: ReadonlySet<Nodes>;
  /**
   * Zero-based physical line indexes of earlier lazy list continuations
   * that supply the final Live Preview heading before an external hyphen
   * break (#554). Narrowing a list item's content column must keep them lazy.
   */
  headingLazyLines: ReadonlySet<number>;
  /**
   * In the Obsidian dialect, the blocks that Reading view reads as more of a
   * paragraph above them, across lines of blank space that hold a tab at or
   * right of the paragraph's column, which it reads as more of the paragraph
   * where the parser reads a blank line (issue #398): a paragraph, a table, an
   * underlined heading, an indented code block, a definition, a footnote
   * definition, a numbered list that does not start at 1, or an HTML block
   * that cannot interrupt a paragraph, each up to an empty line or a block that
   * can. Each counts from the start of its first line, with the marker of a
   * list item there.
   */
  tabText: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, the HTML blocks directly below a list, which
   * Reading view keeps inside the list's last item, where CommonMark ends the
   * list (issue #399), each from the end of the list; the indentation of the
   * blocks below such a block that start at or right of the item's content,
   * which Reading view reads inside the item, each from the line break before
   * it, with the markers of a list there; and the markers of the list's items
   * and of the lists nested in its last item, whose spacing sets that column,
   * where such blocks follow, or a block that a narrower spacing would bring
   * inside, or a list of the same kind, which continues the list with every
   * item whose marker matches, with that list's markers, each from the item's
   * start to its content, and from the line break before that list.
   */
  itemHtml: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, a paragraph, heading, or table with an inline HTML
   * comment that no closer ends in that block, and the blocks through the one
   * holding the next closer, or through the document's end without one. Live
   * Preview carries comment styling across the blocks and restores container
   * styling only after the closer's line (issue #408). Whole source lines count.
   */
  commentText: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, the paragraphs of a list item with a lazy line,
   * one that starts left of the item's content, with the blocks after them in
   * the item, which Live Preview reads outside the list (issue #376). Each
   * counts as one stretch, from the start of the paragraph's first line to the
   * end of the item's last block.
   */
  lazyItems: ReadonlySet<Nodes>;
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
   * In the Obsidian dialect, the lines of a paragraph whose content Live Preview
   * reads as a link reference definition: `[`, a label, and `]:`, whatever
   * follows, where the parser reads text because a definition cannot interrupt
   * a paragraph or because the line is no definition, as `[r]: a b` is not
   * (issue #391). Each counts
   * from the line break before the line, or from the line's start where the
   * paragraph starts there, to the line break after it, or to the line's end
   * where the paragraph ends there. Indented or quoted starts hide destinations
   * as well (#411), except the content on a list's marker line. An empty colon
   * line protects the next nonblank source line, which supplies the hidden destination.
   */
  definitionLines: ReadonlySet<Nodes>;
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
  /**
   * In the Obsidian dialect, the tables that Obsidian reads otherwise, and the
   * lines around them (issue #359): a table directly below a line of paragraph
   * text, which Obsidian reads as more of the text; a one-column table whose
   * header line does not end with a pipe, which it reads as text; the rows of
   * a table from the first without a pipe, which ends the table there; and a
   * line with a pipe above a list item that reads as a delimiter row, as
   * `x | y` and `- | -` do, which Reading view reads as a table. Each counts
   * from the line break or line where Obsidian's reading starts to differ.
   * Also the final physical table line directly above a compact hyphen
   * break, which Live Preview displays as a heading: its final body row,
   * or its delimiter when it has no body. That line's preceding break and
   * the underline count too (#553).
   * A body row that changes its header's leading-pipe convention, or has
   * only its leading pipe, begins a protected suffix too: adding borders
   * can otherwise absorb native paragraph text into the table (#558).
   */
  tableText: ReadonlySet<Nodes>;
  /**
   * Obsidian footnote, task-fence, and cross-block emphasis boundaries
   * (#488, #493–#496, #506, #507), plus an earlier lazy list line's preceding
   * break and margin through its first character or containing inline node
   * where that boundary makes a later final line a Live Preview heading (#554).
   */
  boundaryText: ReadonlySet<Nodes>;
  /**
   * Lists whose markers and indentation affect continuations outside their
   * parsed container, including a lazy paragraph after a heading (#513, #543).
   * Inline formatting remains safe; the structural list unit stays as written.
   */
  boundaryLists: ReadonlySet<List>;
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
 * the container, as Live Preview does further (issue #390). Live Preview
 * styles a paragraph line that starts at the first column with `[`, a label,
 * and `]:` as a link reference definition (issue #391), also the one line of
 * text of an underlined heading, whose underline it reads as text (issue
 * #397). Reading view continues a paragraph across lines of blank space that
 * hold a tab, with the block below them unless it interrupts a paragraph
 * (issue #398), and keeps an HTML block directly below a list inside its last
 * item, so that a list below the block can continue it (issue #399).
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
  const obsidianItem = (node: Nodes, quoted: boolean, callout: boolean): number | undefined => {
    const end = node.position!.end.offset!;
    // A marker four or more columns right of the text is more of the text.
    const text = columnAt(node.position!.start.offset!);
    const breaks = lineBreakMatcher();
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
        ((ordered && Number(ordered[1]) !== 1 && (!quoted || callout)) ||
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
      const callout =
        parent.type === "blockquote" &&
        child.type === "paragraph" &&
        index === 0 &&
        startsWithMarker(source.slice(offset, child.position!.end.offset), child);
      const item =
        obsidian && start !== undefined ? obsidianItem(child, quoted, callout) : undefined;
      const misread = atStart || item !== undefined;
      if (misread || adjacent || reach !== undefined) {
        const column = columnAt(atStart ? start : (item ?? offset));
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
  const tableText = new Set<Nodes>();
  const unclosedCode = new Set<Nodes>();
  let htmlCodeToEnd = false;
  const underlines = new Set<Nodes>();
  const headingLazyLines = new Set<number>();
  const lazyItems = new Set<Nodes>();
  const footnoteText = new Set<Nodes>();
  const definitionCode = new Set<Nodes>();
  const definitionLines = new Set<Nodes>();
  const openFences = new Set<Nodes>();
  const tabText = new Set<Nodes>();
  const itemHtml = new Set<Nodes>();
  const commentText = new Set<Nodes>();
  const boundaryText = new Set<Nodes>();
  const boundaryLists = new Set<List>();
  if (document.dialect === "obsidian") {
    const containerHtml = new Set<Nodes>();
    const quotedLeaves = new Set<Nodes>();
    const quotedItems = new Set<Nodes>();
    /**
     * Leaf blocks in document order, and whether each starts a list item, also
     * inside a container that does, as in `- > a`.
     */
    const order: [Nodes, boolean][] = [];
    /** Footnote definitions, each with the number of leaf blocks before it. */
    const footnotes: [Nodes, number][] = [];
    /** The footnote definition that each leaf block inside one is in. */
    const inFootnotes = new Map<Nodes, Nodes>();
    /**
     * The outermost list, block quote, or footnote definition that each leaf
     * block starts, also as the first block of a later list item.
     */
    const openers = new Map<Nodes, Parents>();
    const collect = (
      node: Nodes,
      item: boolean,
      footnote: Nodes | undefined,
      opener: Parents | undefined,
      contained: boolean,
      quoted: boolean,
      quotedItem: boolean,
    ) => {
      if (node.type === "footnoteDefinition") footnotes.push([node, order.length]);
      if (leaves.has(node.type) || !("children" in node)) {
        order.push([node, item]);
        if (footnote) inFootnotes.set(node, footnote);
        if (opener) openers.set(node, opener);
        if (contained && node.type === "html") containerHtml.add(node);
        if (quoted) quotedLeaves.add(node);
        if (item && quotedItem) quotedItems.add(node);
      } else
        node.children.forEach((child, index) =>
          collect(
            child,
            index === 0 && (item || node.type === "listItem"),
            node.type === "footnoteDefinition" ? node : footnote,
            index === 0 || node.type === "list"
              ? (opener ?? (node.type === "root" ? undefined : node))
              : undefined,
            contained || node.type === "listItem" || node.type === "blockquote",
            quoted || node.type === "blockquote",
            index === 0 && (item || node.type === "listItem") && (item ? quotedItem : quoted),
          ),
        );
    };
    collect(document.tree, false, undefined, undefined, false, false, false);
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
        : { ...node, position: { start, end } };
    /** The start of the line holding `node`'s start. */
    const lineOf = (node: Nodes): Point => {
      const start = node.position!.start;
      const offset = lineStart(start.offset!);
      return offset === start.offset ? start : { line: start.line, column: 1, offset };
    };
    /** Footnote definitions that Reading view reads as paragraph text. */
    const joined = new Set<Nodes>();
    const lines = source.split(lineEndingPattern);
    // A joined footnote can end in HTML, a heading, or code in the primary
    // parse while still continuing its preceding Reading paragraph (#549, #551).
    // Only physical empty or space-only lines establish a boundary here:
    // tabs can continue Reading text (#398), so keep uncertain tab contexts.
    // Share one lazy prefix across overlapping footnote/table ranges.
    const footnoteBlanks = [0];
    const continuesFootnoteParagraph = (leaf: Nodes): boolean => {
      const footnote = inFootnotes.get(leaf);
      if (!footnote?.position || !leaf.position || !joined.has(footnote)) return false;
      while (footnoteBlanks.length <= leaf.position.end.line)
        footnoteBlanks.push(
          footnoteBlanks.at(-1)! + Number(/^ *$/.test(lines[footnoteBlanks.length - 1] ?? "")),
        );
      return (
        footnoteBlanks[leaf.position.end.line] === footnoteBlanks[footnote.position.start.line - 1]
      );
    };
    for (const [footnote, count] of footnotes) {
      const previous = order[count - 1]?.[0];
      // A definition below another that is text, as `[^1]: a` and `[^2]: b`
      // below `Text` are, is text too, even after a non-paragraph leaf
      // of the first definition while its Reading paragraph stays open (#551).
      const around = previous && inFootnotes.get(previous);
      if (
        ((previous?.type === "paragraph" && (around === undefined || joined.has(around))) ||
          (previous !== undefined && continuesFootnoteParagraph(previous))) &&
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
      const lines = text.split(lineEndingPattern);
      if (lines.length > 1 && closes(lines.at(-1)!)) continue;
      // The fence ends before the document does, so its container ended it.
      // Live Preview reads on to a line that closes it, where the parser opens
      // a fence, and pairs the fences after that otherwise, so the rest of the
      // document counts.
      openFences.add(stretch(leaf, lineOf(leaf), { ...leaf.position.end, offset: source.length }));
      break;
    }
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
    const topHtml = new Set<Nodes>(document.tree.children.filter((node) => node.type === "html"));
    let open = false;
    let topLevel = false;
    let topUntil = 0;
    // A top-level HTML block reads quote markers literally. Only a physical
    // empty line ends that reading; a contained block can consume its prefixes.
    const continuesHtml = (number: number) =>
      topLevel ? (lines[number - 1] ?? "").length > 0 : spaced(number);
    order.forEach(([leaf], index) => {
      const previous = order[index - 1]?.[0];
      if (open && previous?.position && leaf.position) {
        for (let line = previous.position.end.line + 1; line < leaf.position.start.line; line++)
          if (!continuesHtml(line)) open = false;
        if (open) {
          // From the start of its line: a list item's marker there, `- ` in
          // `- *a*`, is text of the HTML block too.
          const offset = leaf.position.start.offset ?? 0;
          let from = offset;
          while (from > 0 && source[from - 1] !== "\n" && source[from - 1] !== "\r") from--;
          const start = { ...leaf.position.start, offset: from, column: 1 };
          htmlText.add(from === offset ? leaf : { ...leaf, position: { ...leaf.position, start } });
          // The opener is still HTML source in Reading view. A physical empty
          // line inside its body ends that HTML, so its closer instead opens
          // Reading-view code and later fences pair differently (#529).
          if (
            leaf.type === "code" &&
            /^(?:`{3,}|~{3,})/.test(source.slice(offset, offset + 3)) &&
            source
              .slice(offset, leaf.position.end.offset)
              .split(lineEndingPattern)
              .some((line) => (topLevel ? line.length === 0 : /^[>]*$/.test(line)))
          ) {
            openFences.add(stretch(leaf, start, { ...leaf.position.end, offset: source.length }));
            htmlCodeToEnd = true;
          }
        }
      }
      // Other HTML blocks end at their own end marker, as a comment does at `-->`.
      if (!open && leaf.position && blankTerminatedHtml(leaf)) {
        topLevel = topHtml.has(leaf);
        open = continuesHtml(leaf.position.end.line + 1);
        if (open && topLevel && leaf.position.start.offset! >= topUntil) {
          // Empty quotes have no leaves in `order`, but their literal markers
          // are still Reading-view HTML text. Protect the whole continuation,
          // independently of Live Preview's code/HTML union. Each root inside
          // that span is covered once, including gaps with no leaf at all.
          let end = leaf.position.end;
          for (let cursor = lineBreak(source, end.offset!); cursor < source.length;) {
            const from = cursor + (source.startsWith("\r\n", cursor) ? 2 : 1);
            cursor = lineBreak(source, from);
            if (cursor === from) break;
            end = { offset: cursor, line: end.line + 1, column: cursor - from + 1 };
          }
          topUntil = end.offset!;
          htmlText.add(stretch(leaf, leaf.position.start, end));
        }
      }
    });
    /**
     * Whether line `number`, counted from 1, holds blank space and block quote
     * markers with a tab that starts at or right of `column`. Reading view
     * reads such a line as more of a paragraph at that column, so `- a` goes
     * on below `  ` and a tab, and ends below a tab alone.
     */
    const tabbedAt = (number: number, column: number) => {
      const line = lines[number - 1] ?? "";
      if (!/^[ \t>]*$/.test(line)) return false;
      let at = 0;
      for (const character of line) {
        if (character !== "\t") at++;
        else if (at >= column) return true;
        else at += 4 - (at % 4);
      }
      return false;
    };
    /**
     * Whether `leaf` starts a block that interrupts a paragraph in Reading
     * view: a block quote, a bullet list, a numbered list that starts at 1, a
     * `#` heading, a thematic break, a fenced code or math block, or an HTML
     * block of CommonMark's kinds 1 to 6; a footnote definition, a numbered
     * list that starts elsewhere, and the other blocks are more of the text.
     */
    const interrupts = (leaf: Nodes): boolean => {
      const opener = openers.get(leaf);
      if (opener?.type === "blockquote") return true;
      if (opener?.type === "list") return !opener.ordered || (opener.start ?? 1) === 1;
      if (opener !== undefined) return false;
      const start = leaf.position!.start.offset!;
      switch (leaf.type) {
        case "heading":
          return source[start] === "#";
        case "thematicBreak":
        case "math":
          return true;
        case "code":
          return /^ {0,3}(?:```|~~~)/.test(source.slice(start, start + 6));
        case "html":
          return interruptingHtml.test(leaf.value.trimStart());
        default:
          return false;
      }
    };
    /**
     * The column of the paragraph that Reading view may continue across the
     * lines below the last leaf block: a paragraph's own, or that of the one
     * that it reads the block as more of (issue #398).
     */
    let column: number | undefined;
    /** The end of a list or footnote definition that Reading view read as text, while inside it. */
    let joinedEnd = 0;
    const paragraphLike = (leaf: Nodes) =>
      leaf.type === "paragraph" ||
      (leaf.type === "heading" &&
        leaf.depth === 1 &&
        leaf.position!.end.line >
          (leaf.children[0]?.position?.start.line ?? leaf.position!.start.line) + 1 &&
        source[leaf.position!.start.offset!] !== "#");
    order.forEach(([leaf], index) => {
      const previous = order[index - 1]?.[0];
      const start = leaf.position?.start.offset;
      if (start === undefined) {
        column = undefined;
        return;
      }
      if (start < joinedEnd) return;
      // A table directly below paragraph text is more of that text in
      // Obsidian (#394), so a tab below it still continues that paragraph.
      // The table's own range is protected below, with the other tables.
      if (
        column !== undefined &&
        previous !== undefined &&
        paragraphLike(previous) &&
        leaf.type === "table" &&
        previous.position!.end.line === leaf.position!.start.line - 1
      )
        return;
      let below = previous?.position?.end.line;
      // The parser reads such a line below an indented code block as more of
      // the code; Reading view reads it below the code's last line of text.
      if (below !== undefined && previous!.type === "code")
        while (below > previous.position!.start.line && /^[ \t]*$/.test(lines[below - 1]!)) below--;
      // A block already read as text keeps continuing on the next line, even
      // when the primary parse starts another list there (#510).
      const adjacent =
        previous?.position !== undefined &&
        previous.position.end.offset! <= joinedEnd &&
        leaf.position!.start.line === below! + 1;
      let joins =
        column !== undefined &&
        below !== undefined &&
        (leaf.position!.start.line > below + 1 || adjacent);
      for (let line = (below ?? 0) + 1; joins && line < leaf.position!.start.line; line++)
        if (!tabbedAt(line, column!)) joins = false;
      if (joins && !interrupts(leaf)) {
        // From the start of its line, with a list item's marker there, and the
        // whole of a list or footnote definition that it starts: Reading view
        // reads none of their later lines as a list or footnote either.
        const opener = openers.get(leaf);
        const block =
          opener?.type === "list" || opener?.type === "footnoteDefinition" ? opener : leaf;
        tabText.add(
          stretch(block, adjacent ? previous.position!.end : lineOf(leaf), block.position!.end),
        );
        joinedEnd = block.position!.end.offset!;
        return;
      }
      column = paragraphLike(leaf) ? columnAt(textStart(leaf) ?? start) : undefined;
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
    // An outer run keeps styling nested quoted items (#524). Preserve the
    // existing protection for items that open their blockquote too (#494).
    let carryInQuote = false;
    for (const [leaf, item] of order) {
      const start = leaf.position?.start.offset;
      const end = leaf.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      if (carry !== undefined) {
        const fenced = leaf.type === "code" && /^ {0,3}(?:```|~~~)/.test(source.slice(start, end));
        if (
          (item &&
            openers.get(leaf)?.type !== "blockquote" &&
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
      carryInQuote = quotedLeaves.has(leaf);
    }
    /** The offsets where the line holding `offset` starts and ends. */
    const lineAround = (offset: number): [number, number] => {
      let start = offset;
      while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") start--;
      let end = offset;
      while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end++;
      return [start, end];
    };
    /** Where each line from `start` to `end` after the first starts and ends. */
    const laterLines = (start: number, end: number): [number, number][] => {
      const found: [number, number][] = [];
      const breaks = lineBreakMatcher();
      breaks.lastIndex = start;
      for (let at = breaks.exec(source); at && at.index < end; at = breaks.exec(source)) {
        const from = at.index + at[0].length;
        found.push([from, Math.min(lineAround(from)[1], end)]);
      }
      return found;
    };
    /** A copy of `node` from the line break before `from` to `to`. */
    const breakBefore = (node: Nodes, from: number, to: number): Nodes => {
      const { start, end } = node.position!;
      return {
        ...node,
        position: { start: { ...start, offset: from - 1 }, end: { ...end, offset: to } },
      };
    };
    /** `first` to `last` as one block, from the start of its first line to the end of its last. */
    const wholeLines = (first: Nodes, last = first): Nodes => {
      const start = first.position!.start;
      const end = last.position!.end;
      return {
        ...first,
        position: {
          start: { ...start, offset: lineAround(start.offset!)[0], column: 1 },
          end: { ...end, offset: lineAround(end.offset!)[1] },
        },
      };
    };
    // List reflow adds its own continuation margin, which Live Preview can
    // read outside the footnote (#496). Continuation text outside the four-column
    // margin can change that styling when joined (#518). Paragraphs at that margin
    // wrap, and trailing space after the list remains eligible for cleanup (#405).
    for (const [footnote] of footnotes)
      if ("children" in footnote)
        for (const child of footnote.children.slice(1)) {
          const uneven =
            child.type === "paragraph" &&
            [
              lineAround(child.position!.start.offset!),
              ...laterLines(child.position!.start.offset!, child.position!.end.offset!),
            ].some(([from, to]) => {
              const prefix = /^[ \t>]*/.exec(source.slice(from, to))![0];
              return (
                from + prefix.length < to &&
                columnAt(from + prefix.length) !== columnAt(footnote.position!.start.offset!) + 4
              );
            });
          if (child.type !== "list" && child.type !== "blockquote" && !uneven) continue;
          const block = wholeLines(child);
          let end = block.position!.end.offset!;
          while (source[end - 1] === " " || source[end - 1] === "\t") end--;
          boundaryText.add(
            stretch(block, block.position!.start, { ...block.position!.end, offset: end }),
          );
        }
    // A nonempty line of spaces resets Live Preview's definition continuation
    // state; an empty line or a tab does not (#493, #495). Preserve that boundary.
    for (const [leaf] of order) {
      const footnote = inFootnotes.get(leaf);
      if (
        leaf.type !== "definition" &&
        !(footnote && "children" in footnote && footnote.children[0] === leaf)
      )
        continue;
      let until = lineAround(leaf.position!.end.offset!)[1];
      for (let line = leaf.position!.end.line; line < lines.length; line++) {
        if (!/^[ \t>]*$/.test(lines[line]!)) break;
        until += (source.startsWith("\r\n", until) ? 2 : 1) + lines[line]!.length;
        if (/[ \t]/.test(lines[line]!))
          boundaryText.add(
            stretch(leaf, leaf.position!.end, { ...leaf.position!.end, offset: until }),
          );
      }
    }
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
      boundaryText.add(
        stretch(leaf, lineOf(leaf), { ...leaf.position.end, offset: source.length }),
      );
      break;
    }
    /** Unpaired emphasis openers left in text, outside code, math, and escaped syntax. */
    const openEmphasis = (node: Nodes): boolean => {
      if (node.type !== "text") return "children" in node && node.children.some(openEmphasis);
      const start = node.position?.start.offset;
      if (start === undefined) return false;
      const text = source.slice(start, node.position!.end.offset);
      for (const match of text.matchAll(/\*+|_+/g)) {
        let at = start + match.index;
        const end = at + match[0].length;
        // An escape consumes just the first marker of a run, not the rest.
        if (escaped(source, at)) at++;
        if (at === end) continue;
        const before = source[at - 1];
        const after = source[end];
        const beforeSpace = before === undefined || /\s/.test(before);
        const afterSpace = after === undefined || /\s/.test(after);
        const beforePunctuation = before !== undefined && /\p{P}|\p{S}/u.test(before);
        const afterPunctuation = after !== undefined && /\p{P}|\p{S}/u.test(after);
        const left = !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation);
        const right = !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation);
        if (left && (source[at] === "*" || !right || beforePunctuation)) return true;
      }
      return false;
    };
    /** The final block inside any trailing list items or quotes. */
    const endsWithHeading = (node: Nodes): boolean => {
      let last = node;
      while (last.type === "list" || last.type === "listItem" || last.type === "blockquote") {
        const child = last.children.at(-1);
        if (!child) return false;
        last = child;
      }
      return last.type === "heading";
    };
    /** Whether a source line holds a pipe that no backslash escapes. */
    const piped = (line: string) => /(?:^|[^\\])(?:\\\\)*\|/.test(line);
    /** Ordered structural units still open at a container's trailing boundary. */
    const retainTrailingLists = (node: Nodes) => {
      const pending = [node];
      while (pending.length) {
        const last = pending.pop()!;
        if (last.type === "list") {
          if (last.ordered) boundaryLists.add(last);
          else {
            const item = last.children.at(-1);
            if (item) pending.push(item);
          }
        } else if (
          last.type === "blockquote" ||
          last.type === "footnoteDefinition" ||
          last.type === "listItem"
        ) {
          let index = last.children.length - 1;
          // Reading view can retain these quotes inside an earlier ordered
          // item even when the primary tree makes them siblings. Retain both
          // units rather than inferring independence from that tree (#543).
          while (
            last.children[index]?.type === "blockquote" ||
            last.children[index]?.type === "footnoteDefinition"
          )
            pending.push(last.children[index--]!);
          const list = last.children[index];
          if (list?.type === "list") pending.push(list);
        }
      }
    };
    const visitBoundaries = (parent: Parents) => {
      parent.children.forEach((child, index) => {
        const previous = parent.children[index - 1];
        if (
          previous?.position &&
          child.position &&
          previous.position.end.line === child.position.start.line - 1
        ) {
          // A compact hyphen break can underline the last physical row in
          // Live Preview, where the parser and Reading view keep a table.
          // Its pipes and padding display as heading text, so keep that
          // physical source line and both boundaries as written.
          if (
            previous.type === "table" &&
            child.type === "thematicBreak" &&
            /^-{3,}[ \t]*$/.test(source.slice(...range(child)))
          ) {
            // The delimiter is the final physical line without a body row;
            // the header's child position would protect the wrong line.
            tableText.add(
              breakBefore(
                previous,
                lineAround(previous.position.end.offset!)[0],
                child.position.end.offset!,
              ),
            );
          }
          // A view underlines a final text line after a lazy continuation
          // where the parser closes its container before a hyphen break. Retain
          // that physical line and both boundaries: merely keeping its final
          // newline would still allow wrapping to split the displayed title.
          if (
            child.type === "thematicBreak" &&
            /^-{3,}[ \t]*$/.test(source.slice(...range(child)))
          ) {
            let listed = false;
            let quoted = false;
            let last: Nodes = previous;
            while (
              last.type === "list" ||
              last.type === "listItem" ||
              last.type === "blockquote" ||
              last.type === "footnoteDefinition"
            ) {
              if (last.type === "list") listed = true;
              if (last.type === "blockquote") quoted = true;
              const next: Nodes | undefined = last.children.at(-1);
              if (!next) break;
              last = next;
            }
            if (
              last !== previous &&
              last.type === "paragraph" &&
              last.position &&
              (quoted || listed) &&
              last.position.start.line < last.position.end.line &&
              last.position.end.line === child.position.start.line - 1
            ) {
              const [from, to] = lineAround(last.position.end.offset!);
              const prefix = /^[ \t>]*/.exec(source.slice(from, to))![0].length;
              const opening = source.slice(
                lineAround(last.position.start.offset!)[0],
                last.position.start.offset,
              );
              const contentColumn = columnAt(last.position.start.offset!);
              const missingQuote =
                quoted &&
                (source.slice(from, from + prefix).match(/>/g)?.length ?? 0) <
                  (opening.match(/>/g)?.length ?? 0);
              const later = listed
                ? laterLines(last.position.start.offset!, last.position.end.offset!)
                : [];
              const lazy =
                later.length > 1
                  ? later.find(([start, end]) => {
                      const margin = /^[ \t>]*/.exec(source.slice(start, end))![0].length;
                      return columnAt(start + margin) < contentColumn;
                    })
                  : undefined;
              const lazyList = lazy !== undefined && lazy[0] < from;
              if (missingQuote || lazyList) {
                const parts = last.children;
                const inlineAt = (at: number) =>
                  parts.find(
                    (node) =>
                      node.type !== "text" &&
                      node.position?.start.offset !== undefined &&
                      node.position.end.offset !== undefined &&
                      node.position.start.offset <= at &&
                      node.position.end.offset > at,
                  );
                const across = inlineAt(from - 1);
                // Paired inline syntax crossing that newline stays whole.
                underlines.add(
                  stretch(child, {
                    ...child.position.start,
                    offset: Math.min(from - 1, across?.position?.start.offset ?? from - 1),
                  }),
                );
                if (lazyList) {
                  // later[0] is the physical line after the paragraph's
                  // start, so this sum is its zero-based line index.
                  headingLazyLines.add(last.position.start.line + later.indexOf(lazy));
                  const [start, end] = lazy;
                  const margin = /^[ \t>]*/.exec(source.slice(start, end))![0].length;
                  // That earlier lazy margin supplies the heading's context.
                  // Reflow can keep the final line as an exact common suffix
                  // while indenting this one. Include its first character so
                  // an insertion at the content's start is inside the range.
                  const first = start + margin;
                  // Keep paired markers together if that character belongs
                  // to inline syntax, including a span opened on an earlier
                  // line. Suppressing just one delimiter is not a safe edit.
                  const inline = inlineAt(first);
                  boundaryText.add(
                    stretch(
                      last,
                      {
                        ...last.position.start,
                        offset: Math.min(start - 1, inline?.position?.start.offset ?? start - 1),
                      },
                      {
                        ...last.position.end,
                        offset: Math.max(first + 1, inline?.position?.end.offset ?? first + 1),
                      },
                    ),
                  );
                }
              }
            }
          }
          if (
            (previous.type === "footnoteDefinition" || previous.type === "blockquote") &&
            child.type === "list" &&
            child.ordered &&
            child.start !== 1
          ) {
            boundaryText.add(stretch(child, previous.position.end));
            // Reading view can continue the earlier list across the missing
            // container prefix. Either delimiter direction can join or split
            // it, so keep that list's structural unit, including nested lists,
            // while allowing safe inline changes (#543).
            retainTrailingLists(previous);
          }
          // An unpiped table row starts paragraph text in Reading view. A
          // non-one ordered list cannot interrupt it (#532). Retain the list
          // and separating break: its later items can still continue that
          // paragraph, and an empty item may have no leaf in `order` at all.
          if (
            previous.type === "table" &&
            child.type === "list" &&
            child.ordered &&
            (child.start ?? 1) !== 1 &&
            source
              .slice(...range(previous))
              .split(lineEndingPattern)
              .slice(2)
              .some((row) => !piped(row))
          )
            boundaryText.add(
              stretch(child, {
                ...previous.position.end,
                offset: previous.position.end.offset! - 1,
              }),
            );
          // Reading view retains an unindented paragraph directly below a
          // heading in a list's last item, where the parser ends that list (#513).
          if (previous.type === "list" && endsWithHeading(previous) && child.type === "paragraph") {
            let end = child.position.end;
            const next = parent.children[index + 1];
            if (
              next?.type === "list" &&
              next.position &&
              next.position.start.line === child.position.end.line + 1
            ) {
              // A blank before the next item changes the host list's
              // tightness, and independent marker changes can merge runs.
              boundaryLists.add(previous);
              boundaryLists.add(next);
              const marker = listMarker.exec(
                source.slice(next.position.start.offset, next.position.start.offset! + 11),
              );
              const length = marker?.[0].length ?? 1;
              end = {
                ...next.position.start,
                offset: next.position.start.offset! + length,
                column: next.position.start.column + length,
              };
            }
            boundaryText.add(stretch(child, previous.position.end, end));
          }
          if (
            previous.type === "paragraph" &&
            child.type === "blockquote" &&
            openEmphasis(previous)
          )
            boundaryText.add(wholeLines(previous, child));
        }
        if ("children" in child && !leaves.has(child.type)) visitBoundaries(child);
      });
    };
    visitBoundaries(document.tree);
    // A container can end the parser's HTML block before Obsidian stops reading
    // its source as HTML (#428). Reading view and Live Preview have different
    // ends; preserve their union, including a closer inside another leaf block.
    // Each scan consumes every opener through that union's end, so a contained
    // leaf already inside it cannot extend the region without being visited.
    let htmlUntil = 0;
    let htmlCode: Map<number, HtmlCode> | undefined;
    const htmlCodeEnd = (at: number): HtmlCode | undefined => {
      const code = (htmlCode ??= htmlCodeSpans(source)).get(at);
      if (code?.toEnd) htmlCodeToEnd = true;
      return code;
    };
    const htmlRoots: [Nodes, boolean, number?][] = [];
    const inlineHtml = (node: Nodes) => {
      if (node.type === "html" && /^<[a-z][a-z0-9-]*(?=[\s/>])/i.test(node.value))
        htmlRoots.push([node, false]);
      else if ("children" in node) node.children.forEach(inlineHtml);
    };
    for (const [leaf] of order) {
      if (containerHtml.has(leaf)) htmlRoots.push([leaf, true]);
      // Root Reading protection above already handles physical continuations.
      // Start Live Preview with only the parsed HTML extent: a closed root
      // must not pull genuine later fences into its inline-code scan (#529).
      else if (topHtml.has(leaf) && leaf.position)
        htmlRoots.push([leaf, true, leaf.position.end.offset!]);
      else if ("children" in leaf) leaf.children.forEach(inlineHtml);
    }
    // Source positions for the extended raw regions. Build once, not once per
    // opener; the union scan below visits each token at most once (#435).
    const starts = [0];
    if (htmlRoots.length)
      for (const found of lineBreaks(source)) starts.push(found.index + found[0].length);
    let line = 0;
    const pointAt = (offset: number): Point => {
      // HTML roots and their union ends advance monotonically in source order.
      while (line + 1 < starts.length && starts[line + 1]! <= offset) line++;
      return { offset, line: line + 1, column: offset - starts[line]! + 1 };
    };
    for (const [leaf, block, rootEnd] of htmlRoots) {
      if (!leaf.position) continue;
      const [start, end] = [leaf.position.start.offset!, leaf.position.end.offset!];
      if (start < htmlUntil) continue;
      const until = obsidianHtmlEnd(source, start, htmlCodeEnd, block, rootEnd);
      htmlUntil = until;
      if (block && until <= end) continue;
      htmlText.add({
        ...leaf,
        position: { ...leaf.position, end: pointAt(until) },
      });
    }
    /**
     * Comment openers in text, highlights, and image descriptions, where Live
     * Preview starts HTML comments too, excluding code spans and math.
     */
    const commentOpeners = (node: Nodes): number[] => {
      const start = node.position?.start.offset;
      const image = node.type === "image" || node.type === "imageReference";
      const end = image ? (labelEnd(node) ?? node.position?.end.offset) : node.position?.end.offset;
      if (start === undefined || end === undefined) return [];
      if (node.type !== "text" && node.type !== "obsidianHighlight" && !image)
        return "children" in node ? node.children.flatMap(commentOpeners) : [];
      const offsets: number[] = [];
      for (const match of source.slice(start, end).matchAll(/<!--/g)) {
        const at = start + match.index;
        let slashes = 0;
        while (source[at - slashes - 1] === "\\") slashes++;
        if (slashes % 2 === 0) offsets.push(at);
      }
      return offsets;
    };
    let commentedUntil = 0;
    for (let index = 0; index < order.length; index++) {
      const [leaf] = order[index]!;
      // These leaf blocks hold inline syntax, including a table's cells.
      // Live Preview carries comment state out of any of them (issue #408).
      if (
        (leaf.type !== "paragraph" && leaf.type !== "heading" && leaf.type !== "table") ||
        !leaf.position
      )
        continue;
      for (const opener of commentOpeners(leaf)) {
        if (opener < commentedUntil) continue;
        const closer = source.indexOf("-->", opener + 4);
        // Comments do not nest, even inside one block. Searching for the
        // same closer at every nested opener was quadratic (issue #418).
        commentedUntil = closer < 0 ? source.length : closer + 3;
        if (closer >= 0 && closer < leaf.position.end.offset!) continue;
        let last = index;
        while (
          last + 1 < order.length &&
          (closer < 0 || (order[last]![0].position?.end.offset ?? 0) < closer + 3)
        )
          last++;
        commentText.add(wholeLines(leaf, order[last]![0]));
        // The complete closing block stays: reflow on either side of the
        // closer could move words onto its line. Later blocks still format.
        break;
      }
    }
    const visitLines = (parent: Parents) =>
      parent.children.forEach((child, index) => {
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        if (start === undefined || end === undefined) return;
        if (child.type === "heading" && source[start] !== "#") {
          // The underline: blank space after it, or before it beyond the
          // heading's text, makes Reading view read text, and a lone `-` makes
          // Live Preview read text (issue #383). It stays on its own line, as
          // written.
          const [from, to] = lineAround(end);
          const underline = source.slice(from, to);
          const prefix = /^[ \t>]*/.exec(underline)![0].length;
          const text = textStart(child) ?? start;
          // The heading's own start can overlap preceding definitions.
          const textLine = child.children[0]?.position?.start.line ?? child.position!.start.line;
          // A reference-like first line can make Live Preview read a one-line
          // heading's underline as text, also after indentation/quote markers.
          // Reading view reads multiline level-1 headings as paragraph text,
          // including their underline (#434), regardless of reference labels.
          // Both need their underline and following boundary.
          const [textFrom, textTo] = lineAround(text);
          const definitionText =
            /^[ \t>]*$/.test(source.slice(textFrom, text)) &&
            definitionLike.test(source.slice(text, textTo));
          if (
            from > start &&
            (/[ \t]$/.test(underline) ||
              /^[ \t>]*-[ \t]*$/.test(underline) ||
              columnAt(from + prefix) > columnAt(text) ||
              (child.depth === 1 && child.position!.end.line > textLine + 1) ||
              definitionText)
          )
            underlines.add(breakBefore(child, from, to));
        }
        if (child.type === "paragraph") {
          // A line whose content starts with `[`, a label, and `]:` hides its
          // destination, including after indentation and quote markers, with the
          // lines above and below it as text, where the parser reads more of
          // the paragraph, also at its start, where the line is no definition
          // (issue #391). It stays on a line of its own, as written: the line
          // break before and after it count, where the paragraph has them.
          const [lineFrom, lineTo] = lineAround(start);
          const prefix = source.slice(lineFrom, start);
          // The first content on a list's marker line is text, not a definition.
          const marker = /(?:^|[ \t>])(?:[-+*]|\d{1,9}[.)])[ \t]/.test(prefix);
          const first: [number, number][] = marker ? [] : [[start, Math.min(lineTo, end)]];
          for (const [from, to] of [...first, ...laterLines(start, end)]) {
            const content = source.slice(from, to).replace(/^[ \t>]+/, "");
            const label = definitionLike.exec(content);
            if (label) {
              let until = to;
              // An empty colon line keeps its pending destination across blank
              // lines; the first following word can be hidden in another block.
              if (!content.slice(label[0].length).trim()) {
                let next = to;
                while (next < source.length) {
                  next += source.startsWith("\r\n", next) ? 2 : 1;
                  until = lineAround(next)[1];
                  if (
                    source
                      .slice(next, until)
                      .replace(/^[ \t>]+/, "")
                      .trim()
                  )
                    break;
                  next = until;
                }
              }
              definitionLines.add({
                ...child,
                position: {
                  start: { ...child.position!.start, offset: from === start ? start : from - 1 },
                  end: {
                    ...child.position!.end,
                    offset: until < source.length ? until + 1 : until,
                  },
                },
              });
            }
          }
        }
        if (
          child.type === "paragraph" &&
          (parent.type === "blockquote" || parent.type === "listItem")
        ) {
          const later = laterLines(start, end);
          // A task whose first source line ends after its checkbox needs that
          // separator, even with text on a following line (#525). The task
          // parser can place the paragraph's start after that first line, so
          // take the opening source from its item. Keep the whole paragraph
          // so wrapping cannot remove the separator either.
          if (parent.type === "listItem" && index === 0 && parent.position) {
            const block = wholeLines(parent, child);
            if (
              /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+(?:>[ \t]*)*)+\[[^\]\r\n]\][ \t]+$/.test(
                source.slice(
                  block.position!.start.offset,
                  lineAround(parent.position.start.offset!)[1],
                ),
              )
            )
              boundaryText.add(block);
          }
          // Reading view ends the quote at an unquoted indented continuation
          // and reads its four-column margin as literal code, although the
          // primary parse keeps the line in the quoted paragraph (#530).
          if (quotedLeaves.has(child))
            for (const [from, to] of later) {
              const prefix = /^[ \t]+/.exec(source.slice(from, to))?.[0];
              if (
                prefix &&
                columnAt(from + prefix.length) >= 4 &&
                !/^[ \t]*>/.test(source.slice(from, to))
              ) {
                boundaryText.add(breakBefore(child, from, end));
                break;
              }
            }
          // A lazy line of `=` or `-` underlines the text in Reading view,
          // where the parser reads more of the text (issue #377). It stays on
          // its own line, as written.
          for (const [from, to] of later)
            if (/^[ \t>]*(?:=+|-+)[ \t]*$/.test(source.slice(from, to)))
              underlines.add(breakBefore(child, from, to));
          // A lazy line, left of the item's content, ends the item in Live
          // Preview for the blocks after it (issue #376).
          const content = parent.children[0]?.position?.start.offset;
          if (
            parent.type === "listItem" &&
            index < parent.children.length - 1 &&
            content !== undefined &&
            later.some(([from, to]) => {
              let at = from;
              while (at < to && (source[at] === " " || source[at] === "\t" || source[at] === ">"))
                at++;
              return columnAt(at) < columnAt(content);
            })
          )
            lazyItems.add(wholeLines(child, parent.children.at(-1)));
        }
        if ("children" in child && !leaves.has(child.type)) visitLines(child);
      });
    visitLines(document.tree);
    /** The point where the line holding `node`'s start begins, less one: the line break before it. */
    const breakBeforeLine = (node: Nodes): Point => ({
      ...node.position!.start,
      offset: lineAround(node.position!.start.offset!)[0] - 1,
    });
    /**
     * The markers of `list`'s items as stretches: each from the item's start,
     * or from `from` for the first, to the item's content, or to its end
     * without content.
     */
    const markersOf = (list: List, from?: Point): Nodes[] =>
      list.children.map((item, position) =>
        stretch(item, position === 0 && from ? from : item.position!.start, {
          ...item.position!.end,
          offset: item.children[0]?.position?.start.offset ?? item.position!.end.offset!,
        }),
      );
    const visitHtml = (parent: Parents) =>
      parent.children.forEach((child, index) => {
        if ("children" in child && !leaves.has(child.type)) visitHtml(child);
        // Live Preview recognizes list markers inside a closing-tag HTML
        // block, so the following list can be nested in that list (#487).
        const followingList = parent.children[index + 1];
        if (
          child.type === "html" &&
          /^<\//.test(child.value) &&
          child.value
            .split(lineEndingPattern)
            .slice(1)
            .some((line) => listMarker.test(line.trimStart())) &&
          followingList?.type === "list"
        )
          itemHtml.add(wholeLines(child, followingList));
        const list = parent.children[index - 1];
        // Reading view keeps an HTML block directly below a list inside the
        // list's last item, where the parser ends the list (issue #399), and
        // so the list goes on there.
        if (
          child.type !== "html" ||
          list?.type !== "list" ||
          !list.position ||
          !child.position ||
          child.position.start.line !== list.position.end.line + 1
        )
          return;
        const item = list.children.at(-1)!;
        const itemStart = item.position!.start.offset!;
        // The item's content column, from which the blocks below are its, and
        // the lowest one that its spacing could give it, one space after the
        // marker.
        const content = item.children[0]?.position?.start.offset;
        const least =
          columnAt(itemStart) +
          /^(?:[-+*]|\d{1,9}[.)])?/.exec(source.slice(itemStart, itemStart + 11))![0].length +
          1;
        const column = content !== undefined ? columnAt(content) : least;
        // From the end of the list: a blank line there would end it.
        let at = list.position.end.offset!;
        while (source[at - 1] === " " || source[at - 1] === "\t") at--;
        itemHtml.add(stretch(child, { ...list.position.end, offset: at }));
        // A comment closing after a marker on a later line makes Reading
        // view retain the preceding list's original indentation (#492).
        const commentEnd = child.value.startsWith("<!--") ? child.value.indexOf("-->") : -1;
        if (
          commentEnd >= 0 &&
          /(?:\r\n|\r|\n)[ \t>]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|(?=\r|\n|$))/.test(
            child.value.slice(0, commentEnd),
          )
        )
          for (const marker of markersOf(list, lineOf(list))) itemHtml.add(marker);
        let next = index + 1;
        for (; next < parent.children.length; next++) {
          const block = parent.children[next]!;
          const start = block.position?.start.offset;
          if (start === undefined || columnAt(start) < column) break;
          // Its indentation, and a list's markers, from the line break before
          // it: Reading view reads the block the same way, inside the item.
          const from = breakBeforeLine(block);
          if (block.type === "list")
            for (const marker of markersOf(block, from)) itemHtml.add(marker);
          else itemHtml.add(stretch(block, from, block.position!.start));
        }
        // A list of the same kind continues the list with every item whose
        // marker matches, and the item's spacing sets the column from which
        // Reading view reads blocks inside it, which a block at or right of
        // the lowest one could come to reach, so the markers on both sides
        // stay.
        const following = parent.children[next];
        const continues =
          following?.type === "list" && following.ordered === list.ordered && following.position
            ? following
            : undefined;
        const reaches =
          following?.position?.start.offset !== undefined &&
          columnAt(following.position.start.offset) >= least;
        if (next === index + 1 && !continues && !reaches) return;
        // The list and the lists nested in its last item, in turn, are open
        // there: a list item line below the block continues the innermost one
        // whose marker matches at its column.
        for (let open: Nodes | undefined = list; open?.type === "list";) {
          for (const marker of markersOf(open)) itemHtml.add(marker);
          open = open.children.at(-1)?.children.at(-1);
        }
        if (continues)
          for (const marker of markersOf(continues, breakBeforeLine(continues)))
            itemHtml.add(marker);
      });
    visitHtml(document.tree);
    /** A copy of `node` from `start` to its end. */
    const startingAt = (node: Nodes, start: number): Nodes => ({
      ...node,
      position: { ...node.position!, start: { ...node.position!.start, offset: start } },
    });
    /** A delimiter row that starts with `-` and a space, which the parser reads as a list item. */
    const listedDelimiter = /^[ \t>]*-[ \t]+\|(?:[ \t]*:?-+:?[ \t]*\|)*(?:[ \t]*:?-+:?[ \t]*)?$/;
    const delimiterRow = (line: string) => {
      if (!piped(line)) return false;
      let value = line.replace(/^[ \t>]+/, "").trimEnd();
      if (value.startsWith("|")) value = value.slice(1);
      if (value.endsWith("|")) value = value.slice(0, -1);
      const cells = value.split("|");
      return cells.every((cell) => /^[ \t]*:?-+:?[ \t]*$/.test(cell));
    };
    const paragraphHeadingEnds = new Set([...underlines].map((node) => node.position!.end.offset));
    // A run of pipe rows can contain several blocks of the primary parse.
    // Scan its union once, rather than once per parsed table within it.
    let tableUntil = 0;
    const tableContinuation = (leaf: Nodes) => {
      if (leaf.position!.end.offset! < tableUntil) return;
      let until = leaf.position!.end.offset!;
      for (let line = leaf.position!.end.line; line < lines.length && piped(lines[line]!); line++)
        until += (source.startsWith("\r\n", until) ? 2 : 1) + lines[line]!.length;
      if (until > leaf.position!.end.offset!)
        tableText.add(
          stretch(
            leaf,
            { ...leaf.position!.end, offset: leaf.position!.end.offset! - 1 },
            { ...leaf.position!.end, offset: until },
          ),
        );
      tableUntil = until;
    };
    order.forEach(([leaf], index) => {
      const previous = order[index - 1]?.[0];
      const start = leaf.position?.start.offset;
      const end = leaf.position?.end.offset;
      if (start === undefined || end === undefined) return;
      // Also below a setext underline that Reading view keeps as paragraph
      // text: the next table belongs to that same paragraph (#489).
      const below =
        (previous?.type === "paragraph" ||
          (leaf.type === "table" &&
            previous !== undefined &&
            continuesFootnoteParagraph(previous)) ||
          (previous?.type === "heading" &&
            paragraphHeadingEnds.has(previous.position?.end.offset))) &&
        previous.position !== undefined &&
        previous.position.end.line === leaf.position!.start.line - 1;
      if (leaf.type === "table") {
        // Reading view retains pipe-containing rows even when they start a
        // heading, list, quote, or fence in the parser or Live Preview (#505).
        tableContinuation(leaf);
        const rows = source.slice(start, end).split(lineEndingPattern);
        if (below) {
          let at = previous.position!.end.offset!;
          while (source[at - 1] === " " || source[at - 1] === "\t") at--;
          tableText.add(startingAt(leaf, at));
        } else if (leaf.children[0]?.children.length === 1 && !/\|[ \t]*$/.test(rows[0]!))
          tableText.add(startingAt(leaf, lineStart(start)));
        else {
          // Keep the physical row convention of the header. Either view ends
          // a bordered table before an unbordered row, or before a leading
          // pipe with no second divider, even when GFM keeps that row (#558).
          const bordered = /^[ \t>]*\|/.test(rows[0]!);
          const parts = source.slice(start, end).split(capturedLineBreak);
          for (let part = 0, at = start; part < parts.length; part += 2) {
            // A missing leading pipe on a header or delimiter changes where
            // Reading view ends this table or starts another one. Adding pipes
            // merges the remaining source into the preceding table (#511).
            const next = parts[part + 2];
            const newTable =
              next !== undefined &&
              (!/^[ \t>]*\|/.test(parts[part]!) || !/^[ \t>]*\|/.test(next)) &&
              delimiterRow(next);
            const leading = /^[ \t>]*\|/.exec(parts[part]!);
            const rowBoundary = bordered
              ? !leading || !piped(parts[part]!.slice(leading[0].length))
              : leading !== null;
            if (part >= 4 && (!piped(parts[part]!) || rowBoundary || newTable)) {
              tableText.add(startingAt(leaf, at - parts[part - 1]!.length));
              break;
            }
            at += parts[part]!.length + (parts[part + 1]?.length ?? 0);
          }
        }
      }
      // `x | y` above `- | -`: Reading view reads a table, the parser a
      // paragraph and a list item.
      if (
        below &&
        leaf.type === "paragraph" &&
        previous.position!.start.line === previous.position!.end.line &&
        piped(source.slice(previous.position!.start.offset, previous.position!.end.offset)) &&
        listedDelimiter.test(source.slice(lineStart(start), end).split(lineEndingPattern)[0]!)
      ) {
        tableContinuation(leaf);
        tableText.add({
          ...leaf,
          position: {
            start: {
              ...previous.position!.start,
              offset: lineStart(previous.position!.start.offset!),
            },
            end: leaf.position!.end,
          },
        });
      }
    });
  }
  const result = {
    text,
    nested,
    next,
    descriptions,
    unclosedCode,
    htmlCodeToEnd,
    htmlText,
    underlines,
    headingLazyLines,
    lazyItems,
    footnoteText,
    definitionCode,
    definitionLines,
    openFences,
    tableText,
    tabText,
    itemHtml,
    commentText,
    boundaryText,
    boundaryLists,
  };
  found.set(document.tree, result);
  return result;
}

/** Whether an HTML block ends at a blank line instead of an explicit marker. */
function blankTerminatedHtml(node: Nodes): boolean {
  return (
    node.type === "html" &&
    !/^<(?:!--|\?|!\[CDATA\[|![A-Za-z]|(?:script|pre|style|textarea)(?:[\s>]|$))/i.test(
      node.value.trimStart(),
    )
  );
}

/**
 * The start of an HTML block of CommonMark's kinds 1 to 6, which can interrupt
 * a paragraph: raw text elements, a comment, a processing instruction, a
 * declaration, CDATA, or a tag of one of the block-level names that the
 * specification lists. A block of kind 7, any other complete tag on a line of
 * its own, cannot.
 */
const interruptingHtml =
  /^<(?:!--|\?|!\[CDATA\[|![A-Za-z]|(?:script|pre|style|textarea)(?:[\s>]|$)|\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\s>]|\/>|$))/i;

const voidHtml = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Both views' contained HTML union, or Live Preview's inline/root HTML end. */
function obsidianHtmlEnd(
  source: string,
  start: number,
  codeEnd: (at: number) => HtmlCode | undefined,
  block = true,
  rootEnd?: number,
): number {
  // Only the opening token's prefix is needed here. Inline roots on one long
  // line must not repeatedly search or copy the remaining physical-line suffix.
  const first = source.slice(start, start + 16);
  const explicit = /^<(?:script|pre|style|textarea)(?:[\s>]|$)/i.test(first)
    ? /<\/(?:script|pre|style|textarea)[ \t]*>/gi
    : first.startsWith("<!--")
      ? "-->"
      : first.startsWith("<?")
        ? "?>"
        : first.startsWith("<![CDATA[")
          ? "]]>"
          : /^<![A-Za-z]/.test(first)
            ? ">"
            : undefined;
  let reading = rootEnd ?? (block ? lineBreak(source, start) : start + 1);
  if (block && rootEnd === undefined && explicit) {
    const from = start + (first.startsWith("<?") ? 1 : first.startsWith("<![CDATA[") ? 9 : 2);
    let end: number;
    if (typeof explicit === "string") {
      const at = source.indexOf(explicit, from);
      end = at < 0 ? source.length : at + explicit.length;
    } else {
      explicit.lastIndex = from;
      const close = explicit.exec(source);
      end = close ? close.index + close[0].length : source.length;
    }
    reading = lineBreak(source, end);
  } else if (block && rootEnd === undefined) {
    let cursor = reading;
    while (cursor < source.length) {
      cursor += source.startsWith("\r\n", cursor) ? 2 : 1;
      const end = lineBreak(source, cursor);
      const line = source.slice(cursor, end);
      // Obsidian keeps whitespace-only lines as HTML source (#358), but a
      // physically empty line or bare quote markers end Reading view's block.
      if (/^[ \t>]*$/.test(line) && !/[ \t]/.test(line)) break;
      reading = end;
      cursor = end;
    }
  }
  // Live Preview's HTML mode survives blank lines until its tag stack closes.
  // A later opener before Reading view's end, or on that closing source line,
  // can open another such region, including inside a separate parsed HTML leaf.
  // Quoted attribute values and comments cannot supply closing tags; void and
  // self-closing tags need no closer. Each ordinary closer consumes one open
  // element, even when its name differs; it cannot close an entire ancestor
  // stack (#556). Raw-text elements below still require their own closer.
  const stack: string[] = [];
  // Cache the physical line end: consecutive roots on that line must not
  // rescan its remaining suffix for every closing tag or explicit token.
  let until = reading;
  for (let cursor = start; cursor < source.length;) {
    let at: number;
    if (!stack.length) {
      // Between HTML roots Live Preview resumes Markdown, even while Reading
      // view still reads raw HTML. Escapes and matched code spans supply no
      // new opener. Their run-pair index is built once for the whole document.
      while (cursor < until) {
        if (source[cursor] === "\\") cursor += 2;
        else if (source[cursor] === "`") {
          const code = codeEnd(cursor);
          // A multiline run can reach a fence opener the parser still reads
          // inside this HTML block (#433). Preserve its uncertain end.
          if (code?.toEnd) return source.length;
          cursor = code?.end ?? cursor + 1;
          if (cursor > until) until = lineBreak(source, cursor);
        } else if (source[cursor] === "<") break;
        else cursor++;
      }
      at = cursor;
    } else at = source.indexOf("<", cursor);
    if (at < 0) break;
    if (!stack.length && at >= until) break;
    // Consume each special token once, ignoring tags inside its body. Live
    // Preview needs `-->` even when Reading view closes at `--!>`.
    const marker = source.startsWith("<!--", at)
      ? "-->"
      : source.startsWith("<?", at)
        ? "?>"
        : source.slice(at, at + 9).toUpperCase() === "<![CDATA["
          ? "]]>"
          : /^<![A-Za-z]/.test(source.slice(at, at + 3))
            ? ">"
            : undefined;
    if (marker) {
      const end = source.indexOf(marker, at + (marker === "-->" ? 4 : marker === "]]>" ? 9 : 2));
      if (end < 0) return source.length;
      cursor = end + marker.length;
      if (!stack.length && cursor > until) until = lineBreak(source, cursor);
      continue;
    }
    const closing = source[at + 1] === "/";
    const from = at + (closing ? 2 : 1);
    if (!/[a-z]/i.test(source[from] ?? "")) {
      cursor = from;
      continue;
    }
    let end = from + 1;
    while (end < source.length && /[a-z0-9-]/i.test(source[end]!)) end++;
    // Between roots this is Markdown: a scheme colon or an email's `@` cannot
    // be an HTML name delimiter. Hyphenated custom tag names remain possible.
    if (!stack.length && end < source.length && !/[\s/>]/.test(source[end]!)) {
      cursor = end;
      continue;
    }
    const name = source.slice(from, end).toLowerCase();
    let quote = "";
    let multiline = false;
    for (; end < source.length; end++) {
      const char = source[end]!;
      if (char === "\r" || char === "\n") multiline = true;
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "<" || char === ">") break;
    }
    if (end === source.length) return source.length;
    cursor = end;
    // A new opener ends this incomplete token; resume there without rescanning
    // its prefix. Quoted values above are each traversed only once as well.
    if (source[end] === "<") continue;
    cursor++;
    // Container markers can stand inside a multiline tag's source. Without
    // reconstructing that HTML token stream, retain the remaining source.
    if (multiline) return source.length;
    const raw = stack.at(-1);
    if (raw && /^(?:script|style|textarea)$/.test(raw) && (!closing || name !== raw)) continue;
    if (closing) stack.pop();
    else if (!voidHtml.has(name) && !/\/[ \t\r\n]*$/.test(source.slice(from, end)))
      stack.push(name);
    // Inline HTML resumes Markdown on the same line. Later parsed inline
    // roots are visited independently, preserving the Markdown between them
    // (#435). Block HTML still needs the union of both views' source lines.
    if (!block && !stack.length) return cursor;
    if (!stack.length && cursor > until) until = lineBreak(source, cursor);
  }
  return stack.length ? source.length : until;
}

/** A code run's known end, or conservative protection through EOF. */
type HtmlCode = { end: number; toEnd: boolean };

/** Code runs between HTML roots, indexed once; escaped ticks can still close code. */
function htmlCodeSpans(source: string): Map<number, HtmlCode> {
  type HtmlRun = { from: number; length: number; lineEnd: number; fence: boolean };
  const runs: HtmlRun[] = [];
  let lineEnd = -1;
  for (let from = source.indexOf("`"); from >= 0;) {
    const first = from >= lineEnd;
    let fence = false;
    if (first) {
      lineEnd = lineBreak(source, from);
      let start = from;
      while (start > 0 && source[start - 1] !== "\r" && source[start - 1] !== "\n") start--;
      fence = /^(?:[ \t>]|(?:[-+*]|\d{1,9}[.)])[ \t])*$/.test(source.slice(start, from));
    }
    let after = from + 1;
    while (source[after] === "`") after++;
    runs.push({ from, length: after - from, lineEnd, fence });
    from = source.indexOf("`", after);
  }
  const result = new Map<number, HtmlCode>();
  const nearby = new Map<number, HtmlRun>();
  const later = new Map<number, HtmlRun>();
  lineEnd = -1;
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index]!;
    if (run.lineEnd !== lineEnd) nearby.clear();
    lineEnd = run.lineEnd;
    const record = (from: number, length: number) => {
      const close = (length <= 2 ? nearby : later).get(length);
      result.set(from, {
        end: close ? close.from + length : length <= 2 ? run.lineEnd : source.length,
        toEnd: length >= 3 && (!close || (close.lineEnd !== run.lineEnd && close.fence)),
      });
    };
    record(run.from, run.length);
    // Outside code a backslash escapes only a run's first tick. Inside code
    // every full raw run can close it, regardless of a preceding backslash.
    if (run.length > 1) record(run.from + 1, run.length - 1);
    nearby.set(run.length, run);
    later.set(run.length, run);
  }
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
