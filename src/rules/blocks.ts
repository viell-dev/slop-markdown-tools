import type { Code, Heading, Nodes } from "mdast";
import stringWidth from "string-width";
import type { Document, Edit, Finding, Rule } from "../core/types.js";
import {
  belowTomlFrontMatter,
  frontMatterReading,
  joinsTomlFrontMatter,
  range,
  startsWithMarker,
  unclosedFrontMatter,
} from "../syntax/parse.js";
import { walk } from "../syntax/walk.js";

/** A JSON Schema for an options object with these properties and no others. */
function schema(properties: Record<string, unknown>) {
  return { type: "object", properties, additionalProperties: false };
}
/** Any CommonMark line ending, including a lone carriage return. */
const lineBreak = /\r\n|\r|\n/;
function lineStart(source: string, at: number): number {
  while (at > 0 && source[at - 1] !== "\n" && source[at - 1] !== "\r") at--;
  return at;
}
function lineEnd(source: string, at: number): number {
  while (at < source.length && source[at] !== "\n" && source[at] !== "\r") at++;
  return at;
}
/** A physical line: where it starts, where its content ends, and where the next line starts. */
interface Line {
  start: number;
  end: number;
  next: number;
}
function physicalLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    lines.push({ start, end: match.index, next: match.index + match[0].length });
    start = match.index + match[0].length;
  }
  if (start < source.length) lines.push({ start, end: source.length, next: source.length });
  return lines;
}
/** Whether the parser gave a node, perhaps one of a plugin's syntax, a source position. */
function located(node: Nodes): boolean {
  return node.position?.start.offset !== undefined && node.position.end.offset !== undefined;
}
/** Blocks whose lines hold other blocks, and blank lines between them. */
const containers = new Set(["root", "blockquote", "list", "listItem", "footnoteDefinition"]);
/** Sort ranges and merge those that overlap or touch. */
function merged(ranges: [number, number][]): [number, number][] {
  const result: [number, number][] = [];
  for (const [start, end] of ranges.filter(([a, b]) => a < b).sort((x, y) => x[0] - y[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

/**
 * HTML blocks that end only at an end marker, by what starts them, with the
 * markers that end them, in lowercase, and the offset from which they are
 * searched: CommonMark's kinds 1 to 5. The other kinds end at a blank line.
 * These are CommonMark's markers, not HTML's: a comment's block ends only at
 * `-->`, not at `--!>`.
 */
const htmlEnds: [RegExp, string[], number][] = [
  [
    /^<(?:pre|script|style|textarea)(?:[\t\n\r >]|$)/i,
    ["</pre>", "</script>", "</style>", "</textarea>"],
    1,
  ],
  [/^<!--/, ["-->"], 2],
  [/^<\?/, ["?>"], 1],
  [/^<!\[CDATA\[/, ["]]>"], 9],
  [/^<![A-Za-z]/, [">"], 2],
];
/**
 * Whether a block is an HTML block of a kind that ends only at its end marker,
 * or an Obsidian comment, and lacks that marker. Such a block runs to the end
 * of its container and takes in every line ending and blank line up to there.
 */
function unclosed(node: Nodes): boolean {
  if (node.type === "obsidianComment") return node.value.indexOf("%%", 2) < 0;
  if (node.type !== "html") return false;
  // The value keeps the block's indentation.
  const value = node.value.replace(/^[ \t]+/, "");
  for (const [opening, ends, from] of htmlEnds) {
    if (!opening.test(value)) continue;
    const rest = value.slice(from).toLowerCase();
    return !ends.some((end) => rest.includes(end));
  }
  return false;
}
/**
 * Whether a line added directly below `node`, at its own level, would become
 * part of an HTML block or Obsidian comment that `node` ends with and that has
 * no end marker. The parser lets such an HTML block run on through the blank
 * lines of a list item or footnote, and through a final line ending, but a
 * block quote ends it. An Obsidian comment runs on to the end of the document,
 * whatever contains it.
 */
export function takesLines(node: Nodes): boolean {
  let quoted = false;
  while (containers.has(node.type) && "children" in node && node.children.length) {
    if (node.type === "blockquote") quoted = true;
    node = node.children.at(-1)!;
  }
  return unclosed(node) && (node.type === "obsidianComment" || !quoted);
}
/**
 * Whether a blank line added directly below `node`, at its own level, would be
 * read by renderers as part of a fenced code block that ends a list item in
 * `node` and has no closing fence. Such a block runs to the end of the item,
 * and renderers count the item's last blank lines as its content, while the
 * parser does not (issue #350). A block quote ends at a blank line, and so
 * does the code in it.
 */
export function endsInOpenFence(source: string, node: Nodes): boolean {
  let item = false;
  while (containers.has(node.type) && "children" in node && node.children.length) {
    if (node.type === "blockquote") return false;
    if (node.type === "listItem") item = true;
    node = node.children.at(-1)!;
  }
  if (!item || node.type !== "code" || !located(node)) return false;
  const fence = codeFence(source, node);
  return fence !== undefined && !fence.close;
}
/**
 * Whether a line ending added at the end of the document would change its
 * last block. Besides the blocks of `takesLines`, the parser counts a last
 * line of blank space in a code or math block that has no closing fence only
 * when a line ending follows it.
 */
export function takesFinalLineEnding(document: Document): boolean {
  if (takesLines(document.tree)) return true;
  if (!/(?:^|[\r\n])[ \t]+$/.test(document.source)) return false;
  const last = lastBlock(document.tree);
  if ((last.type !== "code" && last.type !== "math") || !located(last)) return false;
  const fence = codeFence(document.source, last);
  return fence !== undefined && !fence.close;
}

/**
 * Whether `style/heading` writes headings of levels 1 and 2 underlined: with
 * `setext`, or with `consistent` when the document's first heading is.
 */
export function underlinedHeadings(document: Document, style: unknown): boolean {
  if (style !== "consistent") return style === "setext";
  let first: Heading | undefined;
  walk(document.tree, "heading", (node) => {
    if (!first && located(node)) first = node;
  });
  return first !== undefined && /[\r\n]/.test(document.source.slice(...range(first)));
}
/**
 * The start of a line that would not begin a paragraph after a blank line: a
 * list item, heading, block quote, thematic break, fence, HTML, math, or
 * Obsidian comment, a link reference definition, or a table row, which `---`
 * below it could make a table.
 */
const notParagraph =
  /^(?:[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|>|([-*_])[ \t]*(?:\1[ \t]*){2,}$|`{3,}|~{3,}|<|\$\$|%%|\[[^]*\]:)|\|/;
/**
 * The edit that writes the `#` heading `node`, of level 1 or 2, underlined
 * with `===` or `---`, or undefined where its text could not stand on a line
 * of its own as the same heading. Only headings at the start of a line of the
 * document itself, below a blank line or at the start, are underlined:
 * directly below text, the heading's line would continue a paragraph. On
 * Forgejo and Gitea, a heading with a `{` keeps its form, because their
 * attribute blocks depend on it.
 */
export function underlineEdit(document: Document, node: Heading): Edit | undefined {
  const { source } = document;
  const first = node.children[0];
  const last = node.children.at(-1);
  if (node.depth > 2 || !first || !last || !located(first) || !located(last)) return undefined;
  const [start] = range(node);
  if (lineStart(source, start) !== start) return undefined;
  if (start > 0) {
    const above = lineStart(source, start - (source.startsWith("\r\n", start - 2) ? 2 : 1));
    if (!/^[ \t]*$/.test(source.slice(above, lineEnd(source, above)))) return undefined;
  }
  const text = source.slice(range(first)[0], range(last)[1]);
  if (notParagraph.test(text) || text.endsWith("\\")) return undefined;
  if ((document.dialect === "forgejo" || document.dialect === "gitea") && text.includes("{"))
    return undefined;
  // Forgejo and Gitea open a definition or display math with these.
  if (/^(?::[ \t]|\\\[)/.test(text)) return undefined;
  const newline = /\r\n|\r|\n/.exec(source)?.[0] ?? "\n";
  // Below a first line of `---` that opens no front matter, an underline of
  // `---` alone would close it (issue #278).
  const shortest = node.depth === 2 && unclosedFrontMatter(source) === "---" ? 4 : 3;
  const underline = (node.depth === 1 ? "=" : "-").repeat(Math.max(shortest, stringWidth(text)));
  return { start, end: lineEnd(source, start), text: `${text}${newline}${underline}` };
}

/** The fences of a fenced code or math block: the marker runs, as source ranges. */
interface Fence {
  marker: "`" | "~" | "$";
  open: [number, number];
  /** Absent when the block runs to the end of its container without a closing fence. */
  close?: [number, number];
}
/** The fences of a code or math block, or undefined for an indented code block. */
function codeFence(
  source: string,
  node: Code | Extract<Nodes, { type: "math" }>,
): Fence | undefined {
  const [start, end] = range(node);
  // A fenced block starts at its fence; an indented one at its indentation.
  const opening = /^(?:`{3,}|~{3,}|\${2,})/.exec(source.slice(start, lineEnd(source, start)));
  if (!opening) return undefined;
  const marker = opening[0][0] as Fence["marker"];
  const fence: Fence = { marker, open: [start, start + opening[0].length] };
  // The block's lines are the opening fence, the content, and the closing
  // fence if there is one. An empty value is no line or one blank line, and a
  // closing fence is never blank.
  const lines = source.slice(start, end).split(lineBreak);
  const last = lines.at(-1)!;
  const closing = new RegExp(
    `(?:${marker === "$" ? "\\$" : marker}){${opening[0].length},}(?=[ \\t]*$)`,
  ).exec(last);
  const content = node.value === "" ? undefined : node.value.split(lineBreak).length;
  if (closing && lines.length > 1 && (content === undefined || lines.length === content + 2)) {
    const at = end - last.length + closing.index;
    fence.close = [at, at + closing[0].length];
  }
  return fence;
}

const codeFenceRule: Rule = {
  description: "Write code fences with one marker and the length their content needs.",
  kind: "style",
  phase: "block",
  schema: schema({ marker: { enum: ["```", "~~~", "consistent"] } }),
  check({ document, options }) {
    const { source } = document;
    const fences: { node: Code; fence: Fence }[] = [];
    walk(document.tree, "code", (node) => {
      const fence = located(node) ? codeFence(source, node) : undefined;
      if (fence) fences.push({ node, fence });
    });
    // `consistent` takes the marker of the first fence in the document.
    const marker =
      options.marker === "~~~"
        ? "~"
        : options.marker === "consistent"
          ? (fences[0]?.fence.marker ?? "`")
          : "`";
    const findings: Finding[] = [];
    for (const { node, fence } of fences) {
      // The info string of a backtick fence cannot contain a backtick.
      if (
        marker === "`" &&
        source.slice(fence.open[1], lineEnd(source, fence.open[1])).includes("`")
      )
        continue;
      // A content line of the marker alone, at any indentation, could close a
      // fence that is not longer than it.
      let longest = 0;
      for (const line of node.value.split(lineBreak)) {
        const run = /^[ \t]*(`+|~+)[ \t]*$/.exec(line)?.[1];
        if (run?.[0] === marker) longest = Math.max(longest, run.length);
      }
      const text = marker.repeat(Math.max(3, longest + 1));
      for (const [start, end] of fence.close ? [fence.open, fence.close] : [fence.open])
        if (source.slice(start, end) !== text)
          findings.push({
            start,
            end,
            message: `Use ${text} for the code fence.`,
            edit: { start, end, text },
          });
    }
    return findings;
  },
};

/** The innermost last block of a container, where its text ends. */
function lastBlock(node: Nodes): Nodes {
  while (containers.has(node.type) && "children" in node && node.children.length)
    node = node.children.at(-1)!;
  return node;
}
const thematicBreak: Rule = {
  description: "Write thematic breaks with one marker.",
  kind: "style",
  phase: "block",
  schema: schema({ marker: { enum: ["---", "***", "___", "consistent"] } }),
  check({ document, options }) {
    const { source } = document;
    let marker = typeof options.marker === "string" ? options.marker : "---";
    // `consistent` takes the character of the first thematic break in the document.
    if (marker === "consistent") {
      let first: string | undefined;
      walk(document.tree, "thematicBreak", (node) => {
        if (first === undefined && located(node)) first = source[range(node)[0]];
      });
      marker = (first ?? "-").repeat(3);
    }
    const findings: Finding[] = [];
    walk(document.tree, "thematicBreak", (node, index, parent) => {
      if (!located(node)) return;
      const [start, last] = range(node);
      // The break's range includes blank space after its markers.
      const end = start + source.slice(start, last).replace(/[ \t]+$/, "").length;
      if (source.slice(start, end) === marker) return;
      // At the start of the document, a break written `---` would open front
      // matter if a later line closed it, as a line of `---` alone does, also
      // one that this rule writes. A first-line `---` that the parser reads as a
      // break and site generators as front matter stays (issue #295).
      if (
        start === 0 &&
        (marker === "---" || (source.startsWith("---") && frontMatterReading(document.tree)))
      )
        return;
      // Below a first line of `---` that opens no front matter, a line of `---`
      // alone would close it (issue #278).
      if (
        marker === "---" &&
        lineStart(source, start) === start &&
        unclosedFrontMatter(source) === "---"
      )
        return;
      // Renderers without TOML front matter read its lines as a paragraph,
      // which a line of `---` directly below underlines as a heading, as one
      // written there already does (issue #333).
      if (
        (marker === "---" && belowTomlFrontMatter(document.tree, node)) ||
        joinsTomlFrontMatter(document.tree, node)
      )
        return;
      // On the line of list items whose markers are the new marker's character,
      // the items and the break would become one thematic break, as `- ---`,
      // `1. - ---`, and `* ***` are.
      const items = new RegExp(`[ \\t${marker[0] === "-" ? "\\-" : marker[0]}]*$`);
      const prefix = source.slice(lineStart(source, start), start);
      if (items.exec(prefix)![0].includes(marker[0]!)) return;
      if (marker === "---") {
        // Directly below a paragraph or a link reference definition, `---`
        // would underline it as a heading, and so it would display math,
        // which GitHub builds from a paragraph (issue #336).
        const above = index && parent ? lastBlock(parent.children[index - 1]!) : undefined;
        if (
          above &&
          (above.type === "paragraph" || above.type === "definition" || above.type === "math") &&
          above.position?.end.line === node.position!.start.line - 1
        )
          return;
      }
      findings.push({
        start,
        end,
        message: `Write the thematic break as ${marker}.`,
        edit: { start, end, text: marker },
      });
    });
    return findings;
  },
};

/**
 * In the Obsidian dialect, the indices of the lines of blank space that
 * Obsidian's Reading view reads as more of the block above them, where
 * CommonMark and the parser read a blank line: one that holds a tab, which
 * continues a paragraph, and one directly below an HTML block, which continues
 * the block (issue #358). Emptying such a line would end the block there.
 */
function obsidianShownBlanks(document: Document, lines: Line[]): Set<number> {
  const shown = new Set<number>();
  if (document.dialect !== "obsidian") return shown;
  const below = new Set<number>();
  walk(document.tree, "html", (node, _, parent) => {
    // An HTML block, not inline HTML: its parent holds blocks.
    if (parent && containers.has(parent.type) && node.position) below.add(node.position.end.line);
  });
  lines.forEach((line, index) => {
    const text = document.source.slice(line.start, line.end);
    if (/^[ \t>]*$/.test(text) && /[^>]/.test(text) && (text.includes("\t") || below.has(index)))
      shown.add(index);
  });
  return shown;
}
/** Where blank lines are content, or their number counts, as source ranges. */
function contentBlocks(document: Document): [number, number][] {
  const blocks: [number, number][] = [];
  walk(document.tree, (node, _, parent) => {
    if (!located(node)) return;
    if (parent && containers.has(parent.type) && !containers.has(node.type))
      blocks.push(range(node));
    // In a block quote, a list, list item, or footnote can extend over the
    // blank lines below its last block. The parser then reads a list as loose,
    // or a list item as tight, by how many there are.
    const last =
      node.type === "list" || node.type === "listItem" || node.type === "footnoteDefinition"
        ? node.children.at(-1)
        : undefined;
    if (last && located(last) && range(last)[1] < range(node)[1])
      blocks.push([range(last)[1], range(node)[1]]);
  });
  return merged(blocks);
}
const blankLines: Rule = {
  description: "Limit blank lines in a row and remove those around the document.",
  kind: "style",
  phase: "document",
  // Fewer than one blank line would join the blocks that it separates.
  schema: schema({ maximum: { type: "integer", minimum: 1 } }),
  check({ document, options }) {
    const { source } = document;
    const maximum = typeof options.maximum === "number" ? options.maximum : 1;
    const lines = physicalLines(source);
    const text = (line: Line) => source.slice(line.start, line.end);
    // Obsidian reads some lines of blank space as text, which stay as written.
    const shown = new Set([...obsidianShownBlanks(document, lines)].map((index) => lines[index]));
    const empty = (line: Line) => !shown.has(line) && /^[ \t]*$/.test(text(line));
    // A line of blank space and block quote markers is blank inside its quotes.
    const blank = (line: Line) => !shown.has(line) && /^[ \t>]*$/.test(text(line));
    const blocks = contentBlocks(document);
    let block = 0;
    /** Whether a line lies inside a block that began above it; asked in document order. */
    const inside = (line: Line) => {
      while (block < blocks.length && blocks[block]![1] < line.end) block++;
      return block < blocks.length && blocks[block]![0] < line.start;
    };
    const findings: Finding[] = [];
    const remove = (from: number, to: number, message: string) =>
      findings.push({ start: from, end: to, message, edit: { start: from, end: to, text: "" } });
    let first = 0;
    while (first < lines.length && empty(lines[first]!)) first++;
    if (first === lines.length) {
      if (source) remove(0, source.length, "Remove the blank lines.");
      return findings;
    }
    let last = lines.length;
    // A block without its end, such as an unclosed fence, takes in the blank lines at the end.
    const inBlock = lines.map((line) => blank(line) && inside(line));
    while (empty(lines[last - 1]!) && !inBlock[last - 1]) last--;
    // Below blank lines, `---` or `+++` on the first line would open front matter.
    if (first > 0 && !/^(?:-{3}|\+{3})/.test(text(lines[first]!)))
      remove(0, lines[first]!.start, "Remove the blank lines at the start of the document.");
    // Blank lines in a row with the same block quote markers and indentation
    // are one separation, however many there are.
    const trimmed = (line: Line) => text(line).replace(/[ \t]+$/, "");
    const message =
      maximum === 1
        ? "Remove the repeated blank line."
        : `Remove the blank lines beyond ${maximum} in a row.`;
    for (let index = first; index < last;) {
      const line = lines[index]!;
      let end = index + 1;
      if (blank(line) && !inBlock[index])
        while (
          end < last &&
          blank(lines[end]!) &&
          !inBlock[end] &&
          trimmed(lines[end]!) === trimmed(line)
        )
          end++;
      if (end - index > maximum)
        remove(lines[index + maximum]!.start, lines[end - 1]!.next, message);
      index = end;
    }
    if (last < lines.length)
      remove(
        lines[last]!.start,
        source.length,
        "Remove the blank lines at the end of the document.",
      );
    return findings;
  },
};

/** Nodes whose source between the lines of their text is ordinary prose. */
const prose = new Set([
  ...containers,
  "paragraph",
  "heading",
  "thematicBreak",
  "table",
  "tableRow",
  "tableCell",
  "text",
  "emphasis",
  "strong",
  "delete",
]);
const trailingSpace: Rule = {
  description: "Remove spaces and tabs at the end of lines outside code and HTML.",
  kind: "style",
  phase: "document",
  schema: schema({ hardBreak: { enum: ["keep", "backslash"] } }),
  check({ document, options }) {
    const { source } = document;
    if (!/[ \t](?:\r|\n|$)/.test(source)) return [];
    const backslash = options.hardBreak === "backslash";
    const forge = document.dialect === "forgejo" || document.dialect === "gitea";
    /** Source in which blank space at the end of a line is content. */
    const kept: [number, number][] = [];
    /**
     * Hard line breaks, with the paragraph or heading each one is in, and
     * whether that block starts like an alert's or callout's marker, `[!`.
     */
    const breaks: { start: number; end: number; block: [number, number]; marker: boolean }[] = [];
    const links: [number, number][] = [];
    let block: [number, number] = [0, 0];
    let marker = false;
    walk(document.tree, (node, _, parent) => {
      if (!located(node)) {
        // A plugin's node without a position keeps whatever its parent spans.
        if (parent && located(parent)) kept.push(range(parent));
        return;
      }
      const [start, end] = range(node);
      if (node.type === "paragraph" || node.type === "heading") {
        block = [start, end];
        const written = source.slice(start, end);
        marker =
          node.type === "paragraph"
            ? startsWithMarker(written, node, /^\[!/)
            : written.startsWith("[!");
      }
      if (node.type === "link") links.push([start, end]);
      if (node.type === "break") breaks.push({ start, end, block, marker });
      else if (node.type === "link" || node.type === "linkReference") {
        // The link text is prose; a title or label that spans lines is not.
        let at = start;
        for (const child of node.children) {
          if (!located(child)) continue;
          kept.push([at, range(child)[0]]);
          at = range(child)[1];
        }
        kept.push([at, end]);
      } else if (node.type === "code") {
        const fence = codeFence(source, node);
        // A fence line ends in syntax, unless an info string's text runs to its end.
        const from = fence && !node.meta ? lineEnd(source, start) : start;
        kept.push([from, fence?.close ? lineStart(source, fence.close[0]) : end]);
      } else if (!prose.has(node.type)) kept.push([start, end]);
    });
    const ranges = merged(kept);
    let next = 0;
    let following = 0;
    let link = 0;
    /**
     * Whether a backslash in place of the blank space of a hard line break,
     * which starts at `start`, would mean the same. One after another
     * backslash would be escaped. A literal autolink such as `www.example.com`
     * runs on to the next blank space, so it would take the backslash in. A
     * paragraph that starts like `[label]:` could become a link reference
     * definition with the backslash as its destination, and the title line of
     * an alert or callout, also one written as `\[!NOTE]`, would end with it.
     * On Forgejo and Gitea, a backslash inside `\(...\)` math would be part of
     * the formula.
     */
    const backslashSafe = (start: number, paragraph: [number, number], marker: boolean) => {
      if (source[start - 1] === "\\") return false;
      let word = start;
      while (word > paragraph[0] && !/[ \t\r\n]/.test(source[word - 1]!)) word--;
      while (link < links.length && links[link]![1] <= word) link++;
      if (link < links.length && links[link]![0] < start) return false;
      const before = source.slice(paragraph[0], start);
      if (/^\[[^]*\]:/.test(before) || (marker && !/[\r\n]/.test(before))) return false;
      return !(forge && source.slice(...paragraph).includes("\\("));
    };
    const findings: Finding[] = [];
    const lines = physicalLines(source);
    const shown = obsidianShownBlanks(document, lines);
    for (const [index, line] of lines.entries()) {
      const space = /[ \t]+$/.exec(source.slice(line.start, line.end));
      // Obsidian reads some lines of blank space as text, which stay as written.
      if (!space || shown.has(index)) continue;
      const start = line.start + space.index;
      const end = line.end;
      while (next < ranges.length && ranges[next]![1] <= start) next++;
      if (next < ranges.length && ranges[next]![0] < end) continue;
      // Breaks are in document order, as lines are.
      while (following < breaks.length && breaks[following]!.end <= start) following++;
      const hard = breaks[following]?.start !== undefined && breaks[following]!.start < end;
      if (!hard) {
        findings.push({
          start,
          end,
          message: "Remove the spaces and tabs at the end of the line.",
          edit: { start, end, text: "" },
        });
        continue;
      }
      const brk = breaks[following]!;
      if (!backslash || brk.start !== start || !backslashSafe(start, brk.block, brk.marker))
        continue;
      findings.push({
        start,
        end,
        message: "Write the hard line break as a backslash.",
        edit: { start, end, text: "\\" },
      });
    }
    return findings;
  },
};

export const blockRules: Record<string, Rule> = {
  "style/blank-lines": blankLines,
  "style/code-fence": codeFenceRule,
  "style/thematic-break": thematicBreak,
  "style/trailing-space": trailingSpace,
};
