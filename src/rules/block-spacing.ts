import { walk } from "../syntax/walk.js";
import type { Blockquote, Root, RootContent } from "mdast";
import { directive } from "../core/directives.js";
import type { Document, Finding, Rule } from "../core/types.js";
import { blockIdentifier } from "../syntax/block-identifier.js";
import { misreadLists } from "../syntax/misread-lists.js";
import { otherReading, range, startsWithMarker } from "../syntax/parse.js";
import { endsInOpenFence, takesLines } from "./blocks.js";
import { countBelow } from "../syntax/source.js";
import { type Range } from "./shared.js";
import { misreadTable } from "./protections.js";
import { lineBounds, lineEnding } from "../syntax/source.js";
import { optionsSchema } from "./shared.js";

/** A line holding nothing but block quote markers and blank space. */
const blankLine = /^[ \t>]*$/;

const blockContainers = ["blockquote", "list", "listItem", "footnoteDefinition"];

/** The innermost last block of a container, where its text ends. */
function lastBlock(node: RootContent): RootContent {
  while (blockContainers.includes(node.type) && "children" in node && node.children.length)
    node = node.children.at(-1) as RootContent;
  return node;
}

/** The innermost first block of a container, where its text starts. */
function firstBlock(node: RootContent): RootContent {
  while (blockContainers.includes(node.type) && "children" in node && node.children.length)
    node = node.children[0] as RootContent;
  return node;
}

/**
 * Whether two neighboring blocks have to stay as they are, although one of
 * them is a heading or a list, because a blank line between them would change
 * what they mean or what a comment or callout applies to.
 */
function together(
  document: Document,
  parent: Root | Blockquote,
  index: number,
  directiveLines: Set<number>,
): boolean {
  const before = parent.children[index - 1]!;
  const after = parent.children[index]!;
  const { source } = document;
  const [beforeStart, beforeEnd] = range(before);
  const [afterStart, afterEnd] = range(after);
  if (document.dialect === "obsidian") {
    // Reading view keeps an adjacent, unindented quote in the last item,
    // although the parser ends the list before it (#437).
    if (before.type === "list" && after.type === "blockquote") return true;
    // Reading view takes text directly below an empty marker into its item
    // (#438). Keep both boundaries of a lone marker, including after a table
    // that Live Preview reads as paragraph text.
    const continuesEmptyItem = (list: RootContent, next: RootContent | undefined) =>
      list.type === "list" &&
      list.children.at(-1)?.children.length === 0 &&
      next?.type === "paragraph" &&
      next.position?.start.line === list.position!.end.line + 1;
    if (
      continuesEmptyItem(before, after) ||
      (after.type === "list" &&
        after.children.length === 1 &&
        continuesEmptyItem(after, parent.children[index + 1]))
    )
      return true;
  }
  // Front matter is not part of the document's text.
  if (["yaml", "toml"].includes(before.type)) return true;
  // An unclosed HTML comment or block at the end of a list would take in the
  // blank line, and so would an unclosed code fence there on the renderers.
  if (takesLines(before) || endsInOpenFence(source, before)) return true;
  // Other tools, too, read a comment as applying to the line below it, and
  // `mdtools-disable-next-line` does: a blank line would take that line's place.
  if (before.type === "html" && /^<!--[^]*-->$/.test(before.value.trim())) return true;
  if (directiveLines.has(after.position!.start.line - 1)) return true;
  // The line that opens a callout or alert stays with the body below it.
  if (
    index === 1 &&
    parent.type === "blockquote" &&
    before.type === "paragraph" &&
    before.position!.start.line === before.position!.end.line &&
    startsWithMarker(source.slice(beforeStart, beforeEnd), before)
  )
    return true;
  // Obsidian may attach a block identifier on its own line to the block above.
  const alone = document.dialect === "obsidian" ? blockIdentifier(source, after) : undefined;
  if (alone && source.slice(afterStart, afterEnd).trimEnd() === `^${alone.id}`) return true;
  // Directly below a table that ends inside a list or block quote, the parser
  // reads the next table as a paragraph, or as the text of a heading
  // underlined below it, while GitHub reads a table, and a blank line would
  // make it a table there as well.
  if (
    document.dialect !== "commonmark" &&
    (after.type === "paragraph" || after.type === "heading") &&
    misreadTable(source.slice(afterStart, afterEnd))
  )
    return true;
  // In a block quote, the parser counts a line of quote markers below a list
  // that ends in an empty footnote definition as part of the list item, which
  // makes the item loose.
  const last = lastBlock(before);
  if (
    parent.type === "blockquote" &&
    before.type === "list" &&
    last.type === "footnoteDefinition" &&
    !last.children.length
  )
    return true;
  // Renderers may read a list where the parser read text that starts with a
  // list marker, the blocks indented below it inside that list's last item,
  // and a list after those as more of its items (issue #191). A blank line
  // above a list or quote that starts with such text, as `- -` or `- 2. Step`
  // directly below text, would make the parser read the list too, and one
  // between the blocks of such a list would make it loose.
  const misread = misreadLists(document);
  if (
    misread.nested.has(after) ||
    (after.type === "list" && misread.next.has(after)) ||
    misread.text.has(firstBlock(after))
  )
    return true;
  // Directly below text or a link reference definition, `-` underlined with
  // `---` is a heading, and below a blank line an empty list item and a
  // thematic break.
  if (after.type !== "heading" || !["paragraph", "definition"].includes(lastBlock(before).type))
    return false;
  const firstLine = source.slice(afterStart, lineBounds(source, afterStart, afterStart)[1]);
  return !/^[ \t]*#/.test(firstLine);
}

const blockSpacing: Rule = {
  description: "Separate headings and lists from neighboring blocks with a blank line.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({}),
  check({ document }) {
    const { source } = document;
    const findings: Finding[] = [];
    const newline = lineEnding(source);
    // These parsed headings continue as paragraph text in an Obsidian view
    // (#383, #397). Keep the boundary after their underline too (#434).
    const paragraphHeadingEnds = new Set(
      [...misreadLists(document).underlines]
        .filter((node) => node.type === "heading")
        .map((node) => range(node)[1]),
    );
    // HTML can continue across parsed block boundaries in either Obsidian
    // view (#435, #439). Test the next
    // physical line's start, including a continuation leaf's first newline.
    const continued: Range[] = [];
    if (document.dialect === "obsidian") {
      for (const node of misreadLists(document).htmlText) continued.push(range(node));
    }
    continued.sort((a, b) => a[0] - b[0]);
    const joined: Range[] = [];
    for (const [start, end] of continued) {
      const previous = joined.at(-1);
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
      else joined.push([start, end]);
    }
    const ends = joined.map(([, end]) => end);
    const continuesAt = (point: number) => {
      const next = joined[countBelow(ends, point + 1)];
      return next !== undefined && next[0] <= point;
    };
    // Without TOML front matter, one paragraph can continue through several
    // blocks of the front-matter reading, such as empty and numbered lists
    // (#426). A separator inside that paragraph would create a new block.
    const plainText: Range[] = [];
    if (document.tree.children[0]?.type === ("toml" as string)) {
      const plain = otherReading(document.tree);
      if (plain)
        walk(plain, (node) => {
          if (
            (node.type === "paragraph" || node.type === "heading") &&
            node.position?.start.offset !== undefined &&
            node.position.end.offset !== undefined
          )
            plainText.push(range(node));
        });
    }
    const splitsPlainText = (from: number, to: number) => {
      let low = 0;
      let high = plainText.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (plainText[middle]![1] <= from) low = middle + 1;
        else high = middle;
      }
      const block = plainText[low];
      return block !== undefined && block[0] <= from && to < block[1];
    };
    const directiveLines = new Set<number>();
    if (source.includes("mdtools-"))
      walk(document.tree, "html", (node) => {
        if (directive(node.value)?.kind === "disable-next-line")
          directiveLines.add(node.position!.end.line);
      });
    // Only the blocks of the document and of block quotes are compared. A
    // blank line between the blocks of a list item makes its list loose.
    walk(document.tree, (parent) => {
      if (parent.type !== "root" && parent.type !== "blockquote") return;
      // Live Preview reads headings/list markers inside ordinary quotes as
      // literal inline text, so their paragraph boundaries stay (#436).
      if (document.dialect === "obsidian" && parent.type === "blockquote") return;
      for (let index = 1; index < parent.children.length; index++) {
        const before = parent.children[index - 1]!;
        const after = parent.children[index]!;
        const subject = [after, before].find(
          (node) => node.type === "heading" || node.type === "list",
        );
        // A plugin's syntax can add a node without a source position.
        const located = [before, after].every(
          ({ position }) =>
            position?.start.offset !== undefined && position.end.offset !== undefined,
        );
        if (!subject || !located || together(document, parent, index, directiveLines)) continue;
        const end = range(before)[1];
        const start = range(after)[0];
        const lineStart = lineBounds(source, start, start)[0];
        const breakStart = lineStart - (source.startsWith("\r\n", lineStart - 2) ? 2 : 1);
        if (breakStart < end) continue;
        if (before.type === "heading" && paragraphHeadingEnds.has(breakStart)) continue;
        if (continuesAt(lineStart)) continue;
        if (splitsPlainText(breakStart, lineStart)) continue;
        // A blank line, or one with only quote markers, already separates them.
        const previous = source.slice(lineBounds(source, breakStart, breakStart)[0], breakStart);
        if (blankLine.test(previous)) continue;
        // The block's own line holds the quote markers that the new line needs.
        const prefix = source.slice(lineStart, start);
        if (!blankLine.test(prefix)) continue;
        const kind = subject.type === "heading" ? "heading" : "list";
        findings.push({
          start: subject === after ? start : end,
          message: `Add a blank line ${subject === after ? "before" : "after"} the ${kind}.`,
          edit: {
            start: breakStart,
            end: lineStart,
            text: source.slice(breakStart, lineStart) + prefix.replace(/[ \t]+$/, "") + newline,
          },
        });
      }
    });
    return findings;
  },
};
export { blockSpacing };
