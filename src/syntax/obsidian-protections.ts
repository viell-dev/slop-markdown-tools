import type { Heading, List, ListItem, Nodes, Parents } from "mdast";
import type { Document } from "../core/types.js";
import { range } from "./parse.js";
import { listMarker, continuesListBlock } from "./list-protections.js";
import { codeFence } from "./fences.js";
import { leaves } from "./protection-source.js";
import type { ProtectionSource } from "./protection-source.js";
import {
  capturedLineBreak,
  lineBreak as lineEndingPattern,
  lineStart as startOfLine,
  escaped,
} from "./source.js";
import {
  collectContainerFences,
  collectUnclosedCode,
  collectTaskFences,
} from "./obsidian-code-protections.js";
import {
  collectBlockHtml,
  collectEscapingHtml,
  collectCommentProtections,
  collectHtmlListMarkers,
  interruptingHtml,
} from "./obsidian-html-protections.js";

/**
 * A line that Obsidian's Live Preview styles as a link reference definition
 * where it starts at the first column (issue #391): `[`, a label, in which `[`
 * and an escaped `]` may stand, and `]:`, whatever follows. It styles neither
 * `[[x]]: y` nor `[r][s]: x` nor `[r] : x` so. After indentation or quote
 * markers it hides the destination too, without that line class (issue #411).
 */
export const definitionLike = /^\[(?:\\.|[^\\\]])*\]:/;

/** Widgets whose typography or placement can change between ATX and Setext in Live Preview. */
export function obsidianWidgetHeading(source: string, heading: Heading): boolean {
  const only = heading.children.length === 1 ? heading.children[0] : undefined;
  if (
    only?.type === "image" ||
    only?.type === "imageReference" ||
    (only?.type === "wikiLink" && only.embed)
  )
    return true;
  const start = heading.children[0]?.position?.start.offset;
  if (start === undefined) return false;
  // Inspect only the first direct math node on each physical line, keeping
  // prefix scans bounded in a long title with many inline formulas.
  let mathLine = 0;
  return heading.children.some((node) => {
    if (node.type !== "inlineMath" || !node.position || node.position.start.line === mathLine)
      return false;
    mathLine = node.position.start.line;
    const at = node.position.start.offset!;
    return /^[ \t>]*$/.test(source.slice(Math.max(start, startOfLine(source, at)), at));
  });
}

export interface ObsidianBlocks {
  order: [Nodes, boolean][];
  footnotes: [Nodes, number][];
  inFootnotes: Map<Nodes, Nodes>;
  openers: Map<Nodes, Parents>;
  containerHtml: Set<Nodes>;
  quotedLeaves: Set<Nodes>;
  quotedItems: Set<Nodes>;
}

/** The one positioned leaf projection reused by all Obsidian boundary passes. */
function obsidianBlocks(document: Document): ObsidianBlocks {
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

  return { order, footnotes, inFootnotes, openers, containerHtml, quotedLeaves, quotedItems };
}

/** Ordered Obsidian boundary passes share one leaf projection and reading-paragraph state. */
export function collectObsidianProtections(
  document: Document,
  positions: ProtectionSource,
  text: ReadonlySet<Nodes>,
  boundaryText: Set<Nodes>,
) {
  const { source } = document;
  const {
    columnAt,
    isSetextHeading,
    textStart,
    lineStart,
    stretch,
    lineOf,
    lineAround,
    laterLines,
    breakBefore,
    wholeLines,
  } = positions;
  const htmlText = new Set<Nodes>();
  const blockHtmlText = new Set<Nodes>();
  const tableText = new Set<Nodes>();
  let unclosedCode = new Set<Nodes>();
  let htmlCodeToEnd = false;
  const underlines = new Set<Nodes>();
  const widgetHeadings = new Set<Nodes>();
  const headingLazyLines = new Set<number>();
  const lazyItems = new Set<Nodes>();
  const footnoteText = new Set<Nodes>();
  const definitionCode = new Set<Nodes>();
  const definitionLines = new Set<Nodes>();
  const openFences = new Set<Nodes>();
  const tabText = new Set<Nodes>();
  let itemHtml = new Set<Nodes>();
  let commentText = new Set<Nodes>();
  const boundaryLists = new Set<List>();
  const indentLists = new Set<List>();
  if (document.dialect === "obsidian") {
    const blocks = obsidianBlocks(document);
    const { order, footnotes, inFootnotes, openers, quotedLeaves } = blocks;
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
    collectContainerFences(document, blocks, positions, openFences);
    const blockHtml = collectBlockHtml(
      document,
      blocks,
      positions,
      lines,
      htmlText,
      blockHtmlText,
      openFences,
    );
    const { topHtml } = blockHtml;
    htmlCodeToEnd = blockHtml.htmlCodeToEnd;
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
    // Compute Reading paragraph/title state before Tab continuation needs it.
    // Only adjacent siblings carry it; a blank or a hyphen thematic break ends
    // the chain. An adjacent standalone comment shares the native paragraph
    // (#383); widget-only protection does not seed one (#583).
    const readingParagraphHeadings = new Set<Heading>();
    const continuedTitleHeadings = new Set<Heading>();
    const classifySetextReadings = (parent: Parents) =>
      parent.children.forEach((child, index) => {
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        if (isSetextHeading(child) && start !== undefined && end !== undefined) {
          const [from, to] = lineAround(end);
          const underline = source.slice(from, to);
          const prefix = /^[ \t>]*/.exec(underline)![0].length;
          const text = textStart(child) ?? start;
          // A heading's range can overlap definitions preceding its own title.
          const textLine = child.children[0]?.position?.start.line ?? child.position!.start.line;
          const previous = parent.children[index - 1];
          const continuedTitle =
            (previous?.type === "obsidianComment" ||
              (previous?.type === "heading" && readingParagraphHeadings.has(previous))) &&
            previous.position?.end.line === child.position!.start.line - 1;
          if (continuedTitle) continuedTitleHeadings.add(child);
          const literalUnderline = child.depth === 1 || /^-{1,2}$/.test(underline.slice(prefix));
          if (
            /[ \t]$/.test(underline) ||
            columnAt(from + prefix) > columnAt(text) ||
            (literalUnderline && (child.position!.end.line > textLine + 1 || continuedTitle))
          )
            readingParagraphHeadings.add(child);
        }
        if ("children" in child && !leaves.has(child.type)) classifySetextReadings(child);
      });
    classifySetextReadings(document.tree);
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
          return !isSetextHeading(leaf);
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
    const oneColumnTable = (leaf: Nodes) =>
      leaf.type === "table" && leaf.children[0]?.children.length === 1;
    /** A one-column table that Reading view reads as paragraph text (#359, #398, #568). */
    const paragraphTable = (leaf: Nodes) => {
      if (!oneColumnTable(leaf)) return false;
      const header = lines[leaf.position!.start.line - 1]!;
      const delimiter = lines[leaf.position!.start.line]!;
      return (
        !/\|[ \t]*$/.test(header) ||
        !/\|[ \t]*$/.test(delimiter) ||
        (source[leaf.position!.start.offset!] === "|") !== /^[ \t>]*\|/.test(delimiter)
      );
    };
    const paragraphLike = (leaf: Nodes) =>
      leaf.type === "paragraph" ||
      paragraphTable(leaf) ||
      (leaf.type === "heading" && readingParagraphHeadings.has(leaf));
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
    unclosedCode = collectUnclosedCode(document, blocks, positions, lines, text, openFences);
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
    collectTaskFences(document, blocks, positions, boundaryText);
    /** Whether a source line holds a pipe that no backslash escapes. */
    const piped = (line: string) => /(?:^|[^\\])(?:\\\\)*\|/.test(line);
    const collectStructuralBoundaries = () => {
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
        let list: List | undefined;
        let bridge = false;
        parent.children.forEach((child, index) => {
          const previous = parent.children[index - 1];
          // This native indentation relationship survives empty source rows,
          // but not another intervening block. Hold both atomic indentation
          // units while leaving their marker-only preferences available (#596).
          if (
            parent.type === "root" &&
            previous?.type === "list" &&
            previous.children.at(-1)?.children.at(-1)?.type === "list" &&
            child.type === "blockquote" &&
            child.position
          ) {
            const first = child.children[0];
            if (
              first?.type === "list" &&
              first.position?.start.line === child.position.start.line &&
              source.slice(child.position.start.offset, first.position.start.offset) === ">  "
            ) {
              indentLists.add(previous);
              indentLists.add(first);
            }
          }
          // Reading keeps an immediately following quote, table or display math
          // inside the earlier item. A later list can join it across that region,
          // even with blank lines after the bridge (#582, #586). Keep both
          // structural units; their inline content remains editable.
          if (child.type === "list") {
            if (list && bridge) {
              boundaryLists.add(list);
              boundaryLists.add(child);
              if (
                previous?.position &&
                child.position &&
                previous.position.end.line === child.position.start.line - 1
              ) {
                // A new blank makes even a same-marker list loose. Include the
                // next marker so insertion at its line start is protected too.
                const marker = listMarker.exec(
                  source.slice(child.position.start.offset, child.position.start.offset! + 11),
                );
                const length = marker?.[0].length ?? 1;
                boundaryText.add(
                  stretch(child, previous.position.end, {
                    ...child.position.start,
                    offset: child.position.start.offset! + length,
                    column: child.position.start.column + length,
                  }),
                );
              }
            }
            list = child;
            bridge = false;
          } else if (
            list &&
            child.position !== undefined &&
            (child.type === "blockquote" || child.type === "table" || child.type === "math") &&
            (bridge ||
              (previous?.position !== undefined &&
                previous.position.end.offset! <= child.position.start.offset! &&
                previous.position.end.line >= child.position.start.line - 1))
          )
            bridge = true;
          else {
            list = undefined;
            bridge = false;
          }
          if (
            previous?.position &&
            child.position &&
            previous.position.end.line === child.position.start.line - 1
          ) {
            // A new blank splits Live Preview's paragraph after a secondary
            // list paragraph or indented code. Keep only the separator (#598).
            if (continuesListBlock(source, previous, child))
              boundaryText.add(stretch(child, previous.position.end, child.position.start));
            // Reading keeps these adjacent blocks in the last item, including
            // after its heading or code. Protect the first separator against
            // plugin edits too, while retaining inline/cell formatting (#582, #586).
            if (
              previous.type === "list" &&
              (child.type === "blockquote" || child.type === "table" || child.type === "math")
            )
              boundaryText.add(
                stretch(child, previous.position.end, {
                  ...child.position.start,
                  offset: child.position.start.offset! + (child.type === "math" ? 2 : 1),
                  column: child.position.start.column + (child.type === "math" ? 2 : 1),
                }),
              );
            // Live Preview keeps an immediately following table's rows as
            // literal text after a list item's closing code fence (#582).
            // A heading, indented code, root fence or real blank still allows
            // ordinary table formatting.
            if (previous.type === "list" && child.type === "table") {
              let last: Nodes | undefined = previous.children.at(-1)?.children.at(-1);
              while (last?.type === "list") last = last.children.at(-1)?.children.at(-1);
              if (last?.type === "code" && codeFence(source, last)?.close) tableText.add(child);
            }
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
            if (
              previous.type === "list" &&
              endsWithHeading(previous) &&
              child.type === "paragraph"
            ) {
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
    };
    collectStructuralBoundaries();
    const escapingHtml = collectEscapingHtml(document, blocks, topHtml, htmlText, blockHtmlText);
    const { escapingHtmlEnds } = escapingHtml;
    htmlCodeToEnd ||= escapingHtml.htmlCodeToEnd;
    commentText = collectCommentProtections(document, blocks, positions);
    const collectLineBoundaries = () => {
      // Items enclosing the current parent; a nested paragraph can leave later
      // blocks in an outer item even when its immediate item ends there.
      const enclosingItems: ListItem[] = [];
      const visitLines = (parent: Parents) => {
        let quotedCode: Nodes | undefined;
        parent.children.forEach((child, index) => {
          const start = child.position?.start.offset;
          const end = child.position?.end.offset;
          if (start === undefined || end === undefined) {
            quotedCode = undefined;
            return;
          }
          if (parent.type === "blockquote") {
            const prefix = source.slice(lineAround(start)[0], start);
            const marker = prefix.lastIndexOf(">");
            if (marker >= 0 && /^ ?\t[ \t]*$/.test(prefix.slice(marker + 1))) {
              // Adjacent primary children can be one native code block. Scan
              // only their disjoint gap, then let the range union join the runs;
              // repeated blank quote rows are literal code content too (#597).
              const first =
                quotedCode?.position &&
                quotedCode.position.end.offset! <= start &&
                /^[ \t>\r\n]*$/.test(source.slice(quotedCode.position.end.offset, start))
                  ? quotedCode
                  : child;
              boundaryText.add(wholeLines(first, child));
              quotedCode = child;
            } else quotedCode = undefined;
          }
          if (isSetextHeading(child)) {
            // The underline: blank space after it, or before it beyond the
            // heading's text, makes Reading view read text, and a lone `-` makes
            // Live Preview read text (issue #383). It stays on its own line, as
            // written.
            const [from, to] = lineAround(end);
            const underline = source.slice(from, to);
            const text = textStart(child) ?? start;
            // A reference-like first line can make Live Preview read a one-line
            // heading's underline as text, also after indentation/quote markers.
            // Reading view reads multiline level-1 headings as paragraph text,
            // including their underline (#434), regardless of reference labels.
            // Both need their underline and following boundary.
            const [textFrom, textTo] = lineAround(text);
            const definitionText =
              /^[ \t>]*$/.test(source.slice(textFrom, text)) &&
              definitionLike.test(source.slice(text, textTo));
            const continuedTitle = continuedTitleHeadings.has(child);
            const readingParagraph = readingParagraphHeadings.has(child);
            // ATX can give an unwrapped math widget the line's heading font,
            // or put a standalone image inside a heading. Keep the source (#383).
            if (obsidianWidgetHeading(source, child))
              widgetHeadings.add(stretch(child, lineOf(child)));
            if (
              from > start &&
              (readingParagraph ||
                continuedTitle ||
                /^[ \t>]*-[ \t]*$/.test(underline) ||
                definitionText)
            ) {
              const boundary = breakBefore(child, from, to);
              let ending = from;
              if (source[ending - 1] === "\n") ending--;
              if (source[ending - 1] === "\r") ending--;
              let separator = ending;
              while (source[separator - 1] === " " || source[separator - 1] === "\t") separator--;
              // Reading view can keep this underline in the paragraph. Retain
              // a suffix whose cleanup would change its preceding break (#383).
              if (
                readingParagraph &&
                separator < ending &&
                (source.endsWith("  ", ending) || escaped(source, separator))
              )
                boundary.position!.start.offset = separator;
              underlines.add(boundary);
            }
          }
          if (child.type === "paragraph") {
            // A standalone double-dollar formula is a display widget in Live
            // Preview even when the primary tree calls it inline math. Its line
            // and adjacent breaks must survive joining by rules/plugins (#587).
            let mathLine = 0;
            for (const inline of child.children) {
              if (
                inline.type !== "inlineMath" ||
                !inline.position ||
                inline.position.start.line === mathLine
              )
                continue;
              mathLine = inline.position.start.line;
              const from = inline.position.start.offset!;
              const to = inline.position.end.offset!;
              if (
                !source.startsWith("$", from) ||
                inline.position.start.line !== inline.position.end.line
              )
                continue;
              const [lineFrom, lineTo] = lineAround(from);
              if (
                !/^[ \t>]*$/.test(source.slice(lineFrom, from)) ||
                !/^[ \t]*$/.test(source.slice(to, lineTo))
              )
                continue;
              let before = lineFrom;
              if (source[before - 1] === "\n") before--;
              if (source[before - 1] === "\r") before--;
              boundaryText.add(
                stretch(
                  inline,
                  {
                    ...inline.position.start,
                    offset: before,
                  },
                  {
                    ...inline.position.end,
                    offset: Math.min(
                      source.length,
                      lineTo + (source.startsWith("\r\n", lineTo) ? 2 : 1),
                    ),
                  },
                ),
              );
            }
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
            // A lazy line, left of an item's content, ends its Live Preview
            // state for later blocks (#376). Those blocks can belong to an
            // enclosing item while the immediate inner item ends at this paragraph.
            if (parent.type === "listItem" && later.length > 0) {
              let lazyColumn = Infinity;
              for (const [from, to] of later) {
                let at = from;
                while (at < to && (source[at] === " " || source[at] === "\t" || source[at] === ">"))
                  at++;
                lazyColumn = Math.min(lazyColumn, columnAt(at));
              }
              const retains = (item: ListItem) => {
                const content = item.children[0]?.position?.start.offset;
                const last = item.children.at(-1)?.position?.end.offset;
                return (
                  content !== undefined &&
                  last !== undefined &&
                  last > end &&
                  lazyColumn < columnAt(content)
                );
              };
              const item = enclosingItems.find(retains) ?? (retains(parent) ? parent : undefined);
              if (item) lazyItems.add(wholeLines(child, item.children.at(-1)));
            }
          }
          if ("children" in child && !leaves.has(child.type)) {
            if (parent.type === "listItem") enclosingItems.push(parent);
            visitLines(child);
            if (parent.type === "listItem") enclosingItems.pop();
          }
        });
      };
      visitLines(document.tree);
    };
    collectLineBoundaries();
    itemHtml = collectHtmlListMarkers(document, positions, escapingHtmlEnds);
    const collectTables = () => {
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
      const paragraphHeadingEnds = new Set(
        [...underlines].map((node) => node.position!.end.offset),
      );
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
          } else if (
            paragraphTable(leaf) ||
            // Reading accepts matching trailing-only borders, but Live Preview
            // needs both outer pipes on the header and delimiter (#568).
            (oneColumnTable(leaf) && source[start] !== "|")
          )
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
    };
    collectTables();
  }
  return {
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
  };
}
