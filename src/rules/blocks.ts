import type { Code, Nodes } from "mdast";
import type { Document, Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
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
 * marker and the offset from which it is searched: CommonMark's kinds 1 to 5.
 * The other kinds end at a blank line.
 */
const htmlEnds: [RegExp, RegExp, number][] = [
  [/^<(?:pre|script|style|textarea)(?:[\t\n\r >]|$)/i, /<\/(?:pre|script|style|textarea)>/i, 1],
  [/^<!--/, /-->/, 2],
  [/^<\?/, /\?>/, 1],
  [/^<!\[CDATA\[/, /\]\]>/, 9],
  [/^<![A-Za-z]/, />/, 2],
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
  for (const [opening, end, from] of htmlEnds)
    if (opening.test(value)) return !end.test(value.slice(from));
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
  schema: schema({ marker: { enum: ["```", "~~~"] } }),
  check({ document, options }) {
    const { source } = document;
    const marker = options.marker === "~~~" ? "~" : "`";
    const findings: Finding[] = [];
    walk(document.tree, "code", (node) => {
      if (!located(node)) return;
      const fence = codeFence(source, node);
      if (!fence) return;
      // The info string of a backtick fence cannot contain a backtick.
      if (
        marker === "`" &&
        source.slice(fence.open[1], lineEnd(source, fence.open[1])).includes("`")
      )
        return;
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
    });
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
  schema: schema({ marker: { enum: ["---", "***", "___"] } }),
  check({ document, options }) {
    const { source } = document;
    const marker = typeof options.marker === "string" ? options.marker : "---";
    const findings: Finding[] = [];
    walk(document.tree, "thematicBreak", (node, index, parent) => {
      if (!located(node)) return;
      const [start, last] = range(node);
      // The break's range includes blank space after its markers.
      const end = start + source.slice(start, last).replace(/[ \t]+$/, "").length;
      if (source.slice(start, end) === marker) return;
      // At the start of the document, `---` is tried as front matter, and when
      // that fails the parser reads the document after it differently.
      if (start === 0 && (marker === "---" || source.startsWith("---"))) return;
      // On the line of list items whose markers are the new marker's character,
      // the items and the break would become one thematic break, as `- ---`,
      // `1. - ---`, and `* ***` are.
      const items = new RegExp(`[ \\t${marker[0] === "-" ? "\\-" : marker[0]}]*$`);
      const prefix = source.slice(lineStart(source, start), start);
      if (items.exec(prefix)![0].includes(marker[0]!)) return;
      if (marker === "---") {
        // Directly below a paragraph or a link reference definition, `---`
        // would underline it as a heading.
        const above = index && parent ? lastBlock(parent.children[index - 1]!) : undefined;
        if (
          above &&
          (above.type === "paragraph" || above.type === "definition") &&
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
  description: "Collapse repeated blank lines and remove those around the document.",
  kind: "style",
  phase: "document",
  schema: schema({}),
  check({ document }) {
    const { source } = document;
    const lines = physicalLines(source);
    const text = (line: Line) => source.slice(line.start, line.end);
    const empty = (line: Line) => /^[ \t]*$/.test(text(line));
    // A line of blank space and block quote markers is blank inside its quotes.
    const blank = (line: Line) => /^[ \t>]*$/.test(text(line));
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
    // Of blank lines in a row, those that repeat the line above them, with the
    // same block quote markers and indentation, add nothing.
    const trimmed = (line: Line) => text(line).replace(/[ \t]+$/, "");
    for (let index = first + 1; index < last; index++) {
      const line = lines[index]!;
      const above = lines[index - 1]!;
      if (
        !blank(line) ||
        !blank(above) ||
        inBlock[index] ||
        inBlock[index - 1] ||
        trimmed(line) !== trimmed(above)
      )
        continue;
      let end = index + 1;
      while (
        end < last &&
        blank(lines[end]!) &&
        !inBlock[end] &&
        trimmed(lines[end]!) === trimmed(line)
      )
        end++;
      remove(line.start, lines[end - 1]!.next, "Remove the repeated blank line.");
      index = end - 1;
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
    /** Hard line breaks, with the paragraph or heading each one is in. */
    const breaks: { start: number; end: number; block: [number, number] }[] = [];
    const links: [number, number][] = [];
    let block: [number, number] = [0, 0];
    walk(document.tree, (node, _, parent) => {
      if (!located(node)) {
        // A plugin's node without a position keeps whatever its parent spans.
        if (parent && located(parent)) kept.push(range(parent));
        return;
      }
      const [start, end] = range(node);
      if (node.type === "paragraph" || node.type === "heading") block = [start, end];
      if (node.type === "link") links.push([start, end]);
      if (node.type === "break") breaks.push({ start, end, block });
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
     * an alert or callout would end with it. On Forgejo and Gitea, a backslash
     * inside `\(...\)` math would be part of the formula.
     */
    const backslashSafe = (start: number, paragraph: [number, number]) => {
      if (source[start - 1] === "\\") return false;
      let word = start;
      while (word > paragraph[0] && !/[ \t\r\n]/.test(source[word - 1]!)) word--;
      while (link < links.length && links[link]![1] <= word) link++;
      if (link < links.length && links[link]![0] < start) return false;
      const before = source.slice(paragraph[0], start);
      if (/^\[[^]*\]:/.test(before) || /^\[![^\r\n]*$/.test(before)) return false;
      return !(forge && source.slice(...paragraph).includes("\\("));
    };
    const findings: Finding[] = [];
    for (const line of physicalLines(source)) {
      const space = /[ \t]+$/.exec(source.slice(line.start, line.end));
      if (!space) continue;
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
      if (!backslash || brk.start !== start || !backslashSafe(start, brk.block)) continue;
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
