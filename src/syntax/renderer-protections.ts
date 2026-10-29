import type { List, Nodes, Root } from "mdast";
import type { Document } from "../core/types.js";
import { protectionSource } from "./protection-source.js";
import { collectListProtections } from "./list-protections.js";
import {
  collectGithubLazyHtmlProtections,
  collectGithubMathProtections,
} from "./github-protections.js";
import { collectForgeProtections } from "./forge-protections.js";
import { collectObsidianProtections } from "./obsidian-protections.js";

/**
 * Positioned source regions whose renderer readings differ from the primary tree.
 * Sets retain original nodes where possible and copies only for extended ranges.
 */
export interface RendererProtections {
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
   *
   * A paired code span with one or two backticks that crosses a physical line
   * also resets in Live Preview (#565). Its range starts at the opener, or a
   * containing inline node, and continues through its inline block, since
   * later primary spans may be out of phase too. Earlier text and independent
   * blocks remain editable.
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
  /** The block-derived subset; inline-tag Live Preview stretches are not block HTML. */
  blockHtmlText: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, the underlined headings whose underline one of the
   * views reads as text: Reading view one with blank space after it, or before
   * it beyond the heading's text, and Live Preview a lone `-` (issue #383);
   * level-1 headings with more than one text line, or headings beginning with
   * a reference-like line, also after indentation or quote markers (#397,
   * #434), plus an adjacent Setext title that continues that Reading paragraph
   * (#583); and paragraphs in a block quote or list item
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
   * Setext headings with a title line beginning directly with math, or whose
   * only child is an image/embed. Converting them to ATX can change widget
   * typography or block placement in Live Preview (#383). Keep the whole
   * heading without treating it as paragraph text for following blocks.
   */
  widgetHeadings: ReadonlySet<Nodes>;
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
   * start to its content, and from the line break before that list. Also the
   * markers of a list whose escaping HTML region already protects a later
   * list marker: changing only the earlier markers can split or merge the
   * native list, including HTML opened inside the earlier item (#399, #428).
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
   * Also a closed tilde fence whose info has a raw backtick: Live Preview
   * reads its opener as text, then opens code at the primary closer. Later
   * fence pairings may disagree, so keep the same EOF suffix (#567).
   * A fence on a list line that the primary parse reads as paragraph text
   * retains the suffix too, including physical blank gaps, even when inline
   * pairing hides that opener (#584).
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
   * A one-column table also keeps its source when either header or delimiter
   * lacks an outer pipe: Live Preview needs both borders, while Reading view
   * also accepts matching trailing-only borders (#568).
   * On Forgejo and Gitea, tables also retain rows that GFM instead reads as
   * lists: native paragraph continuation ends at its first interruption (#661).
   */
  tableText: ReadonlySet<Nodes>;
  /**
   * Obsidian footnote, task-fence, and cross-block emphasis boundaries
   * (#488, #493–#496, #506, #507), plus an earlier lazy list line's preceding
   * break and margin through its first character or containing inline node
   * where that boundary makes a later final line a Live Preview heading (#554).
   * On GitHub, contiguous display math and the immediately following Setext
   * heading form one native heading, so the complete range stays together.
   * A heading after a container ending in math can instead continue its native
   * paragraph lazily; retain that complete boundary too (#336).
   * GitHub also ends a list item, block quote or footnote definition at a lazy
   * line that starts an HTML block of kind 7, such as `<b>` alone, which the
   * primary reading keeps in the paragraph, and reads HTML to the next blank
   * line. The range runs from the outermost container that GitHub ends, its
   * list for an item, through that blank line and any top-level block that
   * starts before it (#762).
   * A quoted block opened after a Tab immediately after `>` or `> ` keeps its
   * whole physical source too: Reading view can read literal code where the
   * primary parser reads a list, heading or inline text (#597). Same-block
   * continuations stay together, as do quoted blank rows between consecutive
   * such children: Reading view keeps them inside one code block. Later
   * independent blocks remain editable.
   * Forgejo and Gitea retain table header/delimiter pairs hidden inside primary
   * paragraphs (#663), and URL-adjacent backslash hard breaks (#664).
   */
  boundaryText: ReadonlySet<Nodes>;
  /**
   * Lists whose markers and indentation affect continuations outside their
   * parsed container, including a lazy paragraph after a heading (#513, #543)
   * or lists joined through a quote, table or display formula (#582, #586).
   * Inline formatting remains safe; the structural list unit stays as written.
   */
  boundaryLists: ReadonlySet<List>;
  /**
   * A root list ending in a nested list, and a following quote's opening list
   * after exactly two spaces. Live Preview carries the former indentation
   * into the latter, even across blank lines: removing one space can remove
   * its painted bullet (#596). Number-width changes move that indentation too;
   * same-width numbering, delimiters, markers and inline preferences remain safe.
   */
  indentLists: ReadonlySet<List>;
}

const found = new WeakMap<Root, RendererProtections>();

/** One cached protection result per positioned root; collectors never request another parse. */
export function rendererProtections(document: Document): RendererProtections {
  const known = found.get(document.tree);
  if (known) return known;
  // List text feeds physical Obsidian fence discovery. GitHub and Obsidian
  // append their boundaries without sorting or replacing positioned nodes.
  const positions = protectionSource(document.source);
  const { text, nested, next, descriptions } = collectListProtections(document, positions);
  const boundaryText = collectGithubMathProtections(document);
  collectGithubLazyHtmlProtections(document, boundaryText);
  const {
    unclosedCode,
    htmlCodeToEnd,
    htmlText,
    blockHtmlText,
    underlines,
    widgetHeadings,
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
    boundaryLists,
    indentLists,
  } = collectObsidianProtections(document, positions, text, boundaryText);
  collectForgeProtections(document, positions, tableText, boundaryText);
  const result = {
    text,
    nested,
    next,
    descriptions,
    unclosedCode,
    htmlCodeToEnd,
    htmlText,
    blockHtmlText,
    underlines,
    widgetHeadings,
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
    indentLists,
  };
  found.set(document.tree, result);
  return result;
}
