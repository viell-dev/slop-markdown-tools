import { githubDefinitionText } from "../syntax/github-definitions.js";
import { walk } from "../syntax/walk.js";
import type { Blockquote, Nodes, Root, RootContent } from "mdast";
import { directive } from "../core/directives.js";
import type { Document, Finding, Rule } from "../core/types.js";
import { blockIdentifier } from "../syntax/block-identifier.js";
import { tagLine } from "../syntax/github-protections.js";
import { rendererProtections } from "../syntax/renderer-protections.js";
import { continuesListBlock } from "../syntax/list-protections.js";
import { otherReading, range, startsWithMarker } from "../syntax/parse.js";
import { vitepressTokens } from "../syntax/vitepress/projection.js";
import { endsInOpenFence, takesLines } from "./blocks.js";
import { codeFence } from "../syntax/fences.js";
import { countBelow } from "../syntax/source.js";
import { type Range } from "./shared.js";
import { misreadTable } from "./protections.js";
import { lineBounds, lineEnd, lineEnding, lineStart } from "../syntax/source.js";
import { optionsSchema } from "./shared.js";

/** A line holding nothing but block quote markers and blank space. */
const blankLine = /^[ \t>]*$/;

const blockContainers = ["blockquote", "list", "listItem", "footnoteDefinition"];

/**
 * The lines of blank space and quote markers that end at the line break at
 * `at` and the ones directly above them, nearest first, as source ranges
 * without their line endings; at most `limit` of them.
 */
function separators(source: string, at: number, limit: number): Range[] {
  const lines: Range[] = [];
  while (lines.length < limit) {
    const from = lineStart(source, at);
    if (!blankLine.test(source.slice(from, at))) break;
    lines.push([from, at]);
    if (from === 0) break;
    at = from - (source.startsWith("\r\n", from - 2) ? 2 : 1);
  }
  return lines;
}

/** The blocks of another reading that a separator between their lines would split. */
const splitBlocks = new Set([
  "paragraph",
  "heading",
  "code",
  "math",
  "html",
  "table",
  "definition",
  "yaml",
  "toml",
]);
/** markdown-it's tokens for those blocks, as VitePress reads them. */
const splitTokens = new Set([
  "paragraph_open",
  "heading_open",
  "fence",
  "code_block",
  "html_block",
  "math_block",
  "table_open",
]);
/** The containers whose items a blank line would split or make loose. */
const listBlocks = new Set(["list", "footnoteDefinition"]);
const listTokens = new Set(["bullet_list_open", "ordered_list_open"]);
const quoteTokens = new Set(["blockquote_open", "vitepress_alert_open"]);

/**
 * Where the blocks of another reading continue below a line, by 1-based line:
 * whether a block that a separator would split continues onto the next line,
 * and how many block quotes do. A separator line keeps that reading only when
 * it holds one quote marker for each of those quotes.
 *
 * A list or footnote definition is split by a blank line at its own level,
 * but a line of quote markers inside a block quote that it holds continues
 * that quote, and with it the list and its item, which stays tight (#748). A
 * quote therefore takes back, over its own lines, the lists that hold it with
 * no other quote in between. Those lists continue wherever the quote does,
 * and such quotes in one list do not share lines, so a list still counts on
 * exactly the lines where no quote inside it continues.
 */
class Continuations {
  private readonly split: Int32Array;
  private readonly quotes: Int32Array;
  constructor(lines: number) {
    this.split = new Int32Array(lines + 2);
    this.quotes = new Int32Array(lines + 2);
  }
  /**
   * A block from line `first` to line `last`, both 1-based and included, that
   * adds `count` blocks a separator would split, or one quote.
   */
  add(first: number, last: number, quote: boolean, count = 1): void {
    last = Math.min(last, this.split.length - 1);
    if (last <= first || count === 0) return;
    const counts = quote ? this.quotes : this.split;
    counts[first]! += count;
    counts[last]! -= count;
  }
  /** A block quote over these lines, inside `lists` lists that it continues. */
  quote(first: number, last: number, lists: number): void {
    this.add(first, last, true);
    this.add(first, last, false, -lists);
  }
  /** Sum the counts once all blocks are added. */
  finish(): this {
    for (const counts of [this.split, this.quotes])
      for (let line = 1; line < counts.length; line++) counts[line]! += counts[line - 1]!;
    return this;
  }
  /** Whether a separator line `line` below line `above` keeps this reading. */
  keeps(above: number, line: string): boolean {
    if (above < 1 || above >= this.split.length) return true;
    return this.split[above] === 0 && this.quotes[above] === (line.match(/>/g)?.length ?? 0);
  }
}

/**
 * The other readings that a separator has to keep: the reading without TOML
 * front matter, or with the front matter that the parser left out, where one
 * paragraph can continue through several blocks of the document's reading
 * (#426) and a block quote through the end of a list (#748); and VitePress's
 * own reading, where markdown-it continues a paragraph lazily over a line
 * that the parser starts a block with, or a table and an unclosed fence that
 * it reads before a list (#748).
 */
function otherContinuations(document: Document): Continuations[] {
  const lines = document.tree.position?.end.line ?? 1;
  const found: Continuations[] = [];
  const other = otherReading(document.tree);
  if (other) {
    const continuations = new Continuations(lines);
    // `lists` counts the lists around a node up to the nearest quote.
    const visit = (node: Nodes, lists: number): void => {
      const position = node.position;
      const quote = node.type === "blockquote";
      const list = listBlocks.has(node.type);
      if (position) {
        const { start, end } = position;
        if (quote) continuations.quote(start.line, end.line, lists);
        else if (list || splitBlocks.has(node.type)) continuations.add(start.line, end.line, false);
      }
      if ("children" in node) {
        const inner = quote ? 0 : list ? lists + 1 : lists;
        for (const child of node.children) visit(child, inner);
      }
    };
    visit(other, 0);
    found.push(continuations.finish());
  }
  if (document.dialect === "vitepress") {
    const continuations = new Continuations(lines);
    // The same count inside each open token: a list adds itself, and a quote
    // starts again from none.
    const lists = [0];
    for (const token of vitepressTokens(document)) {
      const around = lists.at(-1)!;
      const quote = quoteTokens.has(token.type);
      const list = listTokens.has(token.type);
      if (token.map) {
        const [first, last] = [token.map[0] + 1, token.map[1]];
        if (quote) continuations.quote(first, last, around);
        else if (list || splitTokens.has(token.type)) continuations.add(first, last, false);
      }
      if (token.nesting === 1) lists.push(quote ? 0 : list ? around + 1 : around);
      else if (token.nesting === -1 && lists.length > 1) lists.pop();
    }
    found.push(continuations.finish());
  }
  return found;
}

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
 * interrupts the paragraph that its lines start. The GitHub parse corrects
 * those definitions to prose; other dialects retain the definition nodes.
 * A blank line above the table would hide GitHub's visible text.
 */
function definitionAbove(parent: Root | Blockquote, index: number): boolean {
  const previous = parent.children[index - 1];
  if (previous && githubDefinitionText(previous)) return true;
  for (let at = index - 1; at > 0; at--) {
    const node = parent.children[at]!;
    const above = parent.children[at - 1]!;
    if (node.type !== "paragraph" && node.type !== "definition") return false;
    if (above.position?.end.line !== (node.position?.start.line ?? 0) - 1) return false;
    if (above.type === "definition" || githubDefinitionText(above)) return true;
  }
  return false;
}

/**
 * The blank lines that a heading needs above or below it: one count, or one
 * per heading level, where levels left out keep the default of one. `0` and
 * `-1`, which markdownlint's MD022 uses for any number, need none.
 */
type HeadingLines = number | readonly number[];
const headingLinesSchema = {
  anyOf: [
    { type: "integer", minimum: -1 },
    { type: "array", items: { type: "integer", minimum: -1 }, minItems: 1, maxItems: 6 },
  ],
};
function linesFor(setting: HeadingLines | undefined, depth: number): number {
  const lines = typeof setting === "object" ? setting[depth - 1] : setting;
  return lines ?? 1;
}

/**
 * The block that needs separating from its neighbor, with its name in
 * findings and the blank lines it needs. A heading takes the configured
 * counts; a list, fence, or table needs one.
 */
function subjectOf(
  document: Document,
  parent: Root | Blockquote,
  index: number,
  options: { linesAbove?: HeadingLines; linesBelow?: HeadingLines },
): { node: RootContent; kind: string; lines: number } | undefined {
  const before = parent.children[index - 1]!;
  const after = parent.children[index]!;
  const subjects: { node: RootContent; kind: string; lines: number }[] = [];
  for (const node of [after, before])
    if (node.type === "heading")
      subjects.push({
        node,
        kind: "heading",
        lines: linesFor(node === after ? options.linesAbove : options.linesBelow, node.depth),
      });
    else if (node.type === "list") subjects.push({ node, kind: "list", lines: 1 });
  // Fences can interrupt a paragraph, and the line after a closing fence
  // starts a block, so their neighbors keep their reading (#684).
  const fence = [after, before].find((node) => closedFence(document, node));
  if (fence) subjects.push({ node: fence, kind: "fenced code block", lines: 1 });
  // A table ends only before a block that interrupts it; text below it is
  // another row. Above it, the parser's reading decides (#697). A heading
  // ends a table and starts a block, as it always has as the subject.
  if (before.type === "table" && (after.type === "heading" || endsTable(document, after)))
    subjects.push({ node: before, kind: "table", lines: 1 });
  else if (
    after.type === "table" &&
    (before.type === "heading" || precedesTable(document, before)) &&
    !definitionAbove(parent, index)
  )
    subjects.push({ node: after, kind: "table", lines: 1 });
  // The neighbor that needs the most; on a tie, in the order above: a
  // heading or list below, then above, then a fence, then a table.
  let subject = subjects[0];
  for (const other of subjects) if (other.lines > subject!.lines) subject = other;
  return subject && subject.lines > 0 ? subject : undefined;
}

/**
 * What `style/blank-lines` would refuse in `style/block-spacing`'s options:
 * a heading count above its `maximum`, which would have one rule add the
 * blank lines that the other removes.
 */
export function blankLinesConflict(
  spacing: Readonly<Record<string, unknown>>,
  blankLines: Readonly<Record<string, unknown>>,
): string | undefined {
  const maximum = typeof blankLines.maximum === "number" ? blankLines.maximum : 1;
  for (const name of ["linesAbove", "linesBelow"]) {
    const setting = spacing[name] as HeadingLines | undefined;
    for (let depth = 1; depth <= 6; depth++) {
      const lines = linesFor(setting, depth);
      if (lines > maximum)
        return `"${name}" asks for ${lines} blank lines${typeof setting === "object" ? ` at heading level ${depth}` : ""}, but style/blank-lines removes blank lines beyond ${maximum} in a row; set its "maximum" to at least ${lines}, or lower "${name}"`;
    }
  }
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
  includeFrontMatter: boolean,
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
  // Front matter is not part of the document's text, unless the heading
  // below it is configured to keep its distance from it too.
  if (["yaml", "toml"].includes(before.type) && !(includeFrontMatter && after.type === "heading"))
    return true;
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
  // A table can take a complete tag alone on its line, such as `<b title="|">`,
  // as its header row directly below text, but after a blank line that line
  // starts an HTML block in every reading (#770).
  if (
    after.type === "table" &&
    tagLine.test(source.slice(afterStart, lineEnd(source, afterStart)).trimStart())
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
  schema: optionsSchema({
    linesAbove: headingLinesSchema,
    linesBelow: headingLinesSchema,
    includeFrontMatter: { type: "boolean", default: false },
  }),
  check({ document, options }) {
    const { source } = document;
    const findings: Finding[] = [];
    const newline = lineEnding(source);
    const counts = options as { linesAbove?: HeadingLines; linesBelow?: HeadingLines };
    const includeFrontMatter = options.includeFrontMatter === true;
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
    // A separator has to keep the other readings too, where a block of the
    // document's reading can be part of a block above it (#426, #748).
    const others = otherContinuations(document);
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
        const subject = subjectOf(document, parent, index, counts);
        if (!subject || together(document, parent, index, directiveLines, includeFrontMatter))
          continue;
        let end = range(before)[1];
        // VitePress's front matter takes in the line ending of its closing
        // line, which stays as written: new lines go after it.
        const frontMatter = ["yaml", "toml"].includes(before.type);
        if (frontMatter && (source[end - 1] === "\n" || source[end - 1] === "\r"))
          end -= source.startsWith("\r\n", end - 2) ? 2 : 1;
        const start = range(after)[0];
        const lineStart = lineBounds(source, start, start)[0];
        const breakStart = lineStart - (source.startsWith("\r\n", lineStart - 2) ? 2 : 1);
        if (breakStart < end) continue;
        if (before.type === "heading" && paragraphHeadingEnds.has(breakStart)) continue;
        if (continuesAt(lineStart)) continue;
        // The block's own line holds the quote markers that the new line needs.
        const prefix = source.slice(lineStart, start);
        if (!blankLine.test(prefix)) continue;
        // A table's header row can be a lazy line, with fewer quote markers
        // than the quote's blocks have; a line of those would end the quote.
        if (parent.type === "blockquote") {
          const [from] = range(before);
          const markers = (text: string) => text.split(">").length - 1;
          if (markers(prefix) < markers(source.slice(lineBounds(source, from, from)[0], from)))
            continue;
        }
        const line = prefix.replace(/[ \t]+$/, "");
        const above = after.position!.start.line - 1;
        if (!others.every((other) => other.keeps(above, line))) continue;
        // In a block quote, the parser counts the lines below a list or
        // footnote toward it, and reads the list as loose when two or more
        // follow: one blank line is all that keeps its reading.
        const lines =
          parent.type === "blockquote" &&
          (before.type === "list" || before.type === "footnoteDefinition")
            ? 1
            : subject.lines;
        // Blank lines, or lines with only quote markers, that already separate them.
        const existing = separators(source, breakStart, lines);
        const missing = lines - existing.length;
        if (missing <= 0) continue;
        // More blank lines go only after plain ones of this block's own
        // quote: a line that the block above ends with, such as one that the
        // parser counts toward a list in a quote, decides whether that list
        // is loose; a line of other markers ends a quote; and Obsidian's views
        // read a line of blank space below HTML, or one with a tab, as text.
        if (
          existing.length &&
          ((before.type === "heading" && paragraphHeadingEnds.has(end)) ||
            existing.some(
              ([from, to]) =>
                from <= end ||
                (document.dialect === "obsidian"
                  ? source.slice(from, to) !== line
                  : source.slice(from, to).replace(/[ \t]+$/, "") !== line),
            ))
        )
          continue;
        const below = subject.node === after;
        const where = `${below ? "before" : "after"} the ${subject.kind}`;
        findings.push({
          start: below ? start : end,
          message:
            lines === 1
              ? `Add a blank line ${where}.`
              : `Use ${lines} blank lines ${where}; add ${missing}.`,
          edit: frontMatter
            ? { start: lineStart, end: lineStart, text: (line + newline).repeat(missing) }
            : {
                start: breakStart,
                end: lineStart,
                text: source.slice(breakStart, lineStart) + (line + newline).repeat(missing),
              },
        });
      }
    });
    return findings;
  },
};
export { blockSpacing };
