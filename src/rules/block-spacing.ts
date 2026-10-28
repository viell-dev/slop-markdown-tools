import { walk } from "../syntax/walk.js";
import type { Blockquote, Root, RootContent } from "mdast";
import { directive } from "../core/directives.js";
import type { Document, Finding, Rule } from "../core/types.js";
import { blockIdentifier } from "../syntax/block-identifier.js";
import { rendererProtections } from "../syntax/renderer-protections.js";
import { continuesListBlock } from "../syntax/list-protections.js";
import { otherReading, range, startsWithMarker } from "../syntax/parse.js";
import { endsInOpenFence, takesLines } from "./blocks.js";
import { codeFence } from "../syntax/fences.js";
import { countBelow } from "../syntax/source.js";
import { type Range } from "./shared.js";
import { misreadTable } from "./protections.js";
import { lineBounds, lineEnd, lineEnding } from "../syntax/source.js";
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
 * Whether a block is a fenced code block with its closing fence. A fence
 * without one, and in Obsidian a tilde opener with a written backtick in its
 * info, which Live Preview reads as paragraph text (#567), keep the handling
 * they have as a neighbor of a heading or list and are not separated on their
 * own account.
 */
function closedFence(document: Document, node: RootContent): boolean {
  if (node.type !== "code") return false;
  const { source } = document;
  const fence = codeFence(source, node);
  if (!fence?.close) return false;
  return !(
    document.dialect === "obsidian" &&
    fence.marker === "~" &&
    source.slice(fence.open[0], lineEnd(source, fence.open[0])).includes("`")
  );
}

/**
 * Whether a block ends a table directly above it in every renderer. GFM reads
 * any other line below a table as one more row, and Forgejo and Gitea read a
 * table as a paragraph that only a block able to interrupt one ends.
 */
function endsTable(document: Document, node: RootContent): boolean {
  return ["blockquote", "thematicBreak", "html"].includes(node.type) || closedFence(document, node);
}

/**
 * Whether a table directly below a block starts where the parser starts it in
 * every renderer. A block quote, list or footnote definition can end in a
 * paragraph that would take the header in lazily, and math is text to the
 * renderers without it.
 */
function precedesTable(document: Document, node: RootContent): boolean {
  if (node.type === "code")
    return codeFence(document.source, node) === undefined || closedFence(document, node);
  return ["paragraph", "thematicBreak", "html"].includes(node.type);
}

/**
 * Whether the text directly above a table starts with a link reference
 * definition. GitHub shows such a definition as text when the table
 * interrupts the paragraph that its lines start, where the parser reads a
 * definition, and a blank line above the table would hide that text.
 */
function definitionAbove(parent: Root | Blockquote, index: number): boolean {
  for (let at = index - 1; at > 0; at--) {
    const node = parent.children[at]!;
    const above = parent.children[at - 1]!;
    if (node.type !== "paragraph" && node.type !== "definition") return false;
    if (above.position?.end.line !== (node.position?.start.line ?? 0) - 1) return false;
    if (above.type === "definition") return true;
  }
  return false;
}

/** The block that needs separating from its neighbor, with its name in findings. */
function subjectOf(
  document: Document,
  parent: Root | Blockquote,
  index: number,
): { node: RootContent; kind: string } | undefined {
  const before = parent.children[index - 1]!;
  const after = parent.children[index]!;
  const block = [after, before].find((node) => node.type === "heading" || node.type === "list");
  if (block) return { node: block, kind: block.type };
  // Fences can interrupt a paragraph, and the line after a closing fence
  // starts a block, so their neighbors keep their reading (#684).
  for (const node of [after, before])
    if (closedFence(document, node)) return { node, kind: "fenced code block" };
  // A table ends only before a block that interrupts it; text below it is
  // another row. Above it, the parser's reading decides (#697).
  if (before.type === "table" && endsTable(document, after)) return { node: before, kind: "table" };
  if (after.type === "table" && precedesTable(document, before) && !definitionAbove(parent, index))
    return { node: after, kind: "table" };
  return undefined;
}

/**
 * Whether two neighboring blocks have to stay as they are, although one of
 * them is a heading, a list, a fenced code block, or a table that ends or
 * starts there, because a blank line between them would change
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
    // A new blank after a secondary list paragraph or indented code splits
    // text that Live Preview still groups with the following list (#598).
    if (continuesListBlock(source, before, after)) return true;
    // Live Preview reads a tilde opener with a written backtick in its info
    // as paragraph text. A new blank would split the list continuation (#567).
    if (
      before.type === "list" &&
      lastBlock(before).type === "paragraph" &&
      after.type === "code" &&
      before.position!.end.line === after.position!.start.line - 1 &&
      /^~{3,}[^\r\n]*`/.test(
        source.slice(afterStart, lineBounds(source, afterStart, afterStart)[1]),
      )
    )
      return true;
    // Reading view keeps an adjacent, unindented quote in the last item,
    // although the parser ends the list before it (#437).
    if (before.type === "list" && after.type === "blockquote") return true;
    // Reading keeps an adjacent table or display math inside the last item,
    // including after its heading or code block (#582, #586). Retain the first
    // separator without freezing table cells or the math body.
    if (
      before.type === "list" &&
      (after.type === "table" || after.type === "math") &&
      before.position!.end.line === after.position!.start.line - 1
    )
      return true;
    // Live Preview shows the rows of a table directly below a block other than
    // a heading as text, such as below a fence, where Reading view shows a
    // table; a blank line would make it a table in Live Preview too (#697).
    if (after.type === "table" && before.type !== "heading") return true;
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
  // `mdrefine-disable-next-line` does: a blank line would take that line's place.
  if (before.type === "html" && /^<!--[^]*-->$/.test(before.value.trim())) return true;
  // Obsidian can keep a standalone comment in the following paragraph even
  // when the parser ends its block. Retain that next boundary (#357).
  if (document.dialect === "obsidian" && before.type === "obsidianComment") return true;
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
  const misread = rendererProtections(document);
  // Forgejo and Gitea read the lines of a table directly below a definition
  // description's text as more of that text, which they then turn into a
  // table inside the description; a blank line would move it out.
  if (after.type === "table" && misread.descriptions.has(before)) return true;
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
  description:
    "Separate headings, lists, fenced code blocks, and tables from neighboring blocks with a blank line.",
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
      [...rendererProtections(document).underlines]
        .filter((node) => node.type === "heading")
        .map((node) => range(node)[1]),
    );
    // HTML can continue across parsed block boundaries in either Obsidian
    // view (#435, #439). Test the next
    // physical line's start, including a continuation leaf's first newline.
    const continued: Range[] = [];
    if (document.dialect === "obsidian") {
      for (const node of rendererProtections(document).htmlText) continued.push(range(node));
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
    if (source.includes("mdrefine-"))
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
        // A plugin's syntax can add a node without a source position.
        const located = [before, after].every(
          ({ position }) =>
            position?.start.offset !== undefined && position.end.offset !== undefined,
        );
        if (!located) continue;
        const subject = subjectOf(document, parent, index);
        if (!subject || together(document, parent, index, directiveLines)) continue;
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
        const below = subject.node === after;
        findings.push({
          start: below ? start : end,
          message: `Add a blank line ${below ? "before" : "after"} the ${subject.kind}.`,
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
