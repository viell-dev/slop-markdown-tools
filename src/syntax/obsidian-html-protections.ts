import type { List, Nodes, Parents } from "mdast";
import type { Document } from "../core/types.js";
import type { ObsidianBlocks } from "./obsidian-protections.js";
import { labelEnd } from "./parse.js";
import { leaves } from "./protection-source.js";
import type { Point, ProtectionSource } from "./protection-source.js";
import { listMarker } from "./list-protections.js";
import { lineBreak as lineEndingPattern, lineBreaks } from "./source.js";

/** Reading-view HTML continuation, including raw physical root rows. */
export function collectBlockHtml(
  document: Document,
  { order }: ObsidianBlocks,
  positions: ProtectionSource,
  lines: readonly string[],
  htmlText: Set<Nodes>,
  blockHtmlText: Set<Nodes>,
  openFences: Set<Nodes>,
) {
  const { source } = document;
  const { stretch } = positions;
  let htmlCodeToEnd = false;
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
        const region = from === offset ? leaf : { ...leaf, position: { ...leaf.position, start } };
        htmlText.add(region);
        blockHtmlText.add(region);
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
        const region = stretch(leaf, leaf.position.start, end);
        htmlText.add(region);
        blockHtmlText.add(region);
      }
    }
  });
  return { topHtml, htmlCodeToEnd };
}

/** Union both views' escaping HTML, reusing one lazy code projection and monotonic source cursor. */
export function collectEscapingHtml(
  document: Document,
  { order, containerHtml }: ObsidianBlocks,
  topHtml: ReadonlySet<Nodes>,
  htmlText: Set<Nodes>,
  blockHtmlText: Set<Nodes>,
) {
  const { source } = document;
  let htmlCodeToEnd = false;
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
  const escapingHtmlEnds = new Map<Nodes, number>();
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
    escapingHtmlEnds.set(leaf, until);
    const region = {
      ...leaf,
      position: { ...leaf.position, end: pointAt(until) },
    };
    htmlText.add(region);
    if (block) blockHtmlText.add(region);
  }
  return { escapingHtmlEnds, htmlCodeToEnd };
}

/** Inline comment state crosses complete primary leaf blocks in Live Preview. */
export function collectCommentProtections(
  document: Document,
  { order }: ObsidianBlocks,
  positions: ProtectionSource,
): Set<Nodes> {
  const { source } = document;
  const { wholeLines } = positions;
  const commentText = new Set<Nodes>();
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
  return commentText;
}

/** Keep list markers whose native ownership depends on HTML continuation. */
export function collectHtmlListMarkers(
  document: Document,
  positions: ProtectionSource,
  escapingHtmlEnds: ReadonlyMap<Nodes, number>,
): Set<Nodes> {
  const { source } = document;
  const { lineAround, stretch, columnAt, lineOf, wholeLines } = positions;
  const itemHtml = new Set<Nodes>();
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
  // HTML opened inside a list can outlive the parsed list and keep a
  // later list marker raw (#428). Changing only the opening list's
  // markers can then split or merge Reading view's list (#399). Keep
  // those markers too; a closer before the later list still permits
  // both lists to format. This reverse pass visits each node once and
  // propagates the HTML endpoint without rescanning source or lists.
  let nextListStart = Infinity;
  const protectEscapingHtmlMarkers = (node: Nodes): number => {
    const following = nextListStart;
    let until = escapingHtmlEnds.get(node) ?? 0;
    if ("children" in node)
      for (let index = node.children.length - 1; index >= 0; index--)
        until = Math.max(until, protectEscapingHtmlMarkers(node.children[index]!));
    if (node.type === "list" && node.position) {
      if (until > following) for (const marker of markersOf(node)) itemHtml.add(marker);
      nextListStart = node.position.start.offset!;
    }
    return until;
  };
  if (escapingHtmlEnds.size) protectEscapingHtmlMarkers(document.tree);
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
        for (const marker of markersOf(continues, breakBeforeLine(continues))) itemHtml.add(marker);
    });
  visitHtml(document.tree);
  return itemHtml;
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
export const interruptingHtml =
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
    // Root-origin scans read physical HTML source beyond its parsed extent.
    // Keep the conservative multiline fallback for inline/contained entries,
    // whose source can include Markdown container prefixes.
    if (multiline && rootEnd === undefined) return source.length;
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
function lineBreak(source: string, from: number): number {
  for (let at = from; at < source.length; at++)
    if (source[at] === "\n" || source[at] === "\r") return at;
  return source.length;
}
