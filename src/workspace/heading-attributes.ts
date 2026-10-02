import type { Heading } from "mdast";
import type { Document } from "../core/types.js";
import { parse, range } from "../syntax/parse.js";
import { walk } from "../syntax/walk.js";

/** An attribute value; `null` stands for every value that is not a string. */
type Value = string | null;
interface Parsed<T> {
  value: T;
  end: number;
}

const PUNCTUATION = /[!-/:-@[-`{-~]/;
/** An id or class: no blank space and no ASCII punctuation other than `_`, `-`, `:`, and `.`. */
const SHORTHAND = /[^ \t!-,/;-@[-^`{-~]*/y;
const NAME = /[A-Za-z_:][\w:.-]*/y;
const NUMBER = /[-+]?\d+(?:\.\d*)?(?:[eE][-+]?\d*)?/y;
const ESCAPES: Record<string, string> = {
  '"': '"',
  "/": "/",
  "\\": "\\",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};
/**
 * goldmark nests arrays and attributes in values without a limit. A block with
 * more levels than this stays heading text, so that it cannot exhaust the call
 * stack.
 */
const MAX_DEPTH = 64;

function match(pattern: RegExp, line: string, at: number): string | undefined {
  pattern.lastIndex = at;
  return pattern.exec(line)?.[0];
}
function skipSpaces(line: string, at: number): number {
  while (line[at] === " " || line[at] === "\t") at++;
  return at;
}

/**
 * goldmark's `parseAttributeValue`: a quoted string with JSON-like escapes, a
 * number, a bare word, an array, or nested attributes. `true`, `false`, and
 * `null` are not strings.
 */
function parseValue(line: string, at: number, depth: number): Parsed<Value> | undefined {
  const first = line[at];
  if (first === undefined) return undefined;
  if ((first === "{" || first === "[") && depth === MAX_DEPTH) return undefined;
  if (first === "{") {
    const nested = parseAttributes(line, at, depth + 1);
    return nested && { value: null, end: nested.end };
  }
  if (first === "[") {
    let end = at + 1;
    for (let item = 0; ; item++) {
      if (item > 0 && line[end] === ",") end++;
      else if (line[end] === "]") return { value: null, end: end + 1 };
      const value = parseValue(line, skipSpaces(line, end), depth + 1);
      if (!value) return undefined;
      end = skipSpaces(line, value.end);
    }
  }
  if (first === '"') {
    let value = "";
    for (let i = at + 1; i < line.length; i++) {
      const character = line[i]!;
      if (character === "\\" && i !== line.length - 1) {
        const escaped = ESCAPES[line[i + 1]!];
        if (escaped !== undefined) i++;
        value += escaped ?? "\\";
      } else if (character === '"') return { value, end: i + 1 };
      else value += character;
    }
    return undefined;
  }
  if (/[-+\d]/.test(first)) {
    const number = match(NUMBER, line, at);
    // Go's `strconv.ParseFloat` rejects an exponent without digits and overflow.
    if (number === undefined || !Number.isFinite(Number(number.replace(/^[-+]/, ""))))
      return undefined;
    return { value: null, end: at + number.length };
  }
  const word = match(NAME, line, at);
  if (word === undefined) return undefined;
  return { value: /^(?:true|false|null)$/.test(word) ? null : word, end: at + word.length };
}

/** goldmark's `parseAttribute`: `#id`, `.class`, or `name=value`. */
function parseAttribute(
  line: string,
  at: number,
  depth: number,
): (Parsed<Value> & { name: string }) | undefined {
  const marker = line[at];
  if (marker === "#" || marker === ".") {
    const value = match(SHORTHAND, line, at + 1)!;
    return { name: marker === "#" ? "id" : "class", value, end: at + 1 + value.length };
  }
  const name = match(NAME, line, at);
  if (name === undefined) return undefined;
  const equals = skipSpaces(line, at + name.length);
  if (line[equals] !== "=") return undefined;
  const value = parseValue(line, skipSpaces(line, equals + 1), depth);
  if (!value || (name === "class" && value.value === null)) return undefined;
  return { name, ...value };
}

/**
 * goldmark's `ParseAttributes`: `{`, attributes separated by blank space or one
 * comma, then `}`. Only `id` matters for anchors; a later one replaces an
 * earlier one, and the name is case-sensitive.
 */
function parseAttributes(
  line: string,
  at: number,
  depth = 0,
): Parsed<Value | undefined> | undefined {
  if (line[at] !== "{") return undefined;
  let id: Value | undefined;
  for (at++; line[at] !== "}";) {
    const attribute = parseAttribute(line, skipSpaces(line, at), depth);
    if (!attribute) return undefined;
    if (attribute.name === "id") id = attribute.value;
    at = skipSpaces(line, attribute.end);
    if (line[at] === ",") at = skipSpaces(line, at + 1);
  }
  return { value: id, end: at + 1 };
}

/**
 * goldmark's `parseLastLineAttributes`: the first `{`, not escaped by a
 * backslash, from which valid attributes run to the end of the line. A
 * backslash also skips any other ASCII punctuation, so `\\{#id}` is a block.
 * Returns where the block starts and its `id`: `undefined` without one, and
 * `""` for an empty or non-string one, which leaves the heading no anchor.
 */
export function headingAttributeBlock(
  line: string,
): { start: number; id: string | undefined } | undefined {
  let length = line.length;
  while (line[length - 1] === " " || line[length - 1] === "\t") length--;
  line = line.slice(0, length);
  for (let at = 0; at < line.length; at++) {
    if (line[at] === "\\") {
      if (PUNCTUATION.test(line[at + 1] ?? "")) at++;
    } else if (line[at] === "{") {
      const attributes = parseAttributes(line, at);
      if (attributes?.end === line.length)
        return { start: at, id: attributes.value === null ? "" : attributes.value };
    }
  }
  return undefined;
}

export interface HeadingAttributes {
  /** The custom `id`; `""` when the heading has neither it nor a generated anchor. */
  id: string | undefined;
  /**
   * The heading as it parses without the block, whose text generates the anchor.
   * The text of a Setext heading ends with no-break spaces in place of the block.
   */
  heading: Heading;
  /** The source offset at which the block starts. */
  start: number;
}

/** The source range of the line that can end in a block, without trailing blank space. */
function lastTextLine(
  source: string,
  node: Heading,
): { start: number; end: number; setext: boolean } {
  const [start, end] = range(node);
  // An ATX heading is one line; the last line of a Setext heading is its underline.
  const breaks = [...source.slice(start, end).matchAll(/\r\n?|\n/g)];
  const underline = breaks.at(-1);
  const previous = breaks.at(-2);
  let lineEnd = underline ? start + underline.index : end;
  while (source[lineEnd - 1] === " " || source[lineEnd - 1] === "\t") lineEnd--;
  return {
    start: previous ? start + previous.index + previous[0].length : start,
    end: lineEnd,
    setext: underline !== undefined,
  };
}

/**
 * Trailing `{#id .class name=value}` blocks that Forgejo and Gitea, which
 * enable goldmark's `parser.WithAttribute()`, remove from heading text. The
 * rules are goldmark 1.8's, as pinned by Forgejo 16 and Gitea 1.26 and later:
 * the block ends the line of an ATX heading, after any closing `#` sequence, or
 * the last text line of a Setext heading. An invalid block stays heading text.
 *
 * goldmark removes the block before it parses inline content, so
 * `## _Install {#setup_}` has no emphasis there. The remaining heading text is
 * therefore taken from a second parse of the document with every block blanked
 * out, which keeps offsets, link reference definitions, and containers intact.
 *
 * goldmark removes the block after it has settled which lines form the heading.
 * An ATX heading stays one whatever follows its opening sequence, and spaces
 * let a closing sequence before the block end the heading. Lines above a Setext
 * underline could read as another block without the block's text
 * (`[ref]: /url {.note}` is no link reference definition, `[ref]: /url` is one),
 * so there the block becomes no-break spaces: text that keeps the line a
 * paragraph, delimits emphasis like the end of the line, and adds nothing to a
 * Forgejo or Gitea anchor at the end of a heading.
 */
export function headingAttributes(document: Document): Map<Heading, HeadingAttributes> {
  const { source } = document;
  const blocks = new Map<Heading, { id: string | undefined; start: number }>();
  let stripped = "";
  let copied = 0;
  walk(document.tree, "heading", (node) => {
    const line = lastTextLine(source, node);
    const block = headingAttributeBlock(source.slice(line.start, line.end));
    if (!block) return;
    const blockStart = line.start + block.start;
    blocks.set(node, { id: block.id, start: blockStart });
    stripped += source.slice(copied, blockStart);
    stripped += (line.setext ? "\u00A0" : " ").repeat(line.end - blockStart);
    copied = line.end;
  });
  const result = new Map<Heading, HeadingAttributes>();
  if (blocks.size === 0) return result;
  const headings = new Map<number, Heading>();
  walk(
    parse(stripped + source.slice(copied), document.dialect, document.path).tree,
    "heading",
    (node) => headings.set(range(node)[0], node),
  );
  for (const [node, block] of blocks) {
    // Rarely, a blanked block opens another construct that takes in a heading.
    const heading = headings.get(range(node)[0]) ?? { ...node, children: [] };
    result.set(node, { ...block, heading });
  }
  return result;
}

/**
 * Where a heading line's attribute block lies for Forgejo or for some Gitea
 * version. Besides the block of `headingAttributeBlock`, that is a block
 * followed by a closing `#` sequence (`## Title {#id} ##`), which the older
 * goldmark of Gitea before 1.26 also reads as attributes.
 */
function protectedBlock(line: string, setext: boolean): [number, number] | undefined {
  let block = headingAttributeBlock(line);
  if (!block && !setext) {
    let closing = line.length;
    while (line[closing - 1] === "#") closing--;
    let end = closing;
    while (line[end - 1] === " " || line[end - 1] === "\t") end--;
    if (closing === line.length || end === closing) return undefined;
    line = line.slice(0, end);
    block = headingAttributeBlock(line);
  }
  return block && [block.start, line.length];
}

interface HeadingLine {
  start: number;
  end: number;
  setext: boolean;
  /** The source offset of the line's first `{`, or -1. */
  brace: number;
}
interface HeadingLines {
  byHeading: Map<Heading, HeadingLine>;
  /** In document order, so sorted and disjoint. */
  lines: HeadingLine[];
}
const headingLines = new WeakMap<Document, HeadingLines>();
/** The lines on which Forgejo and Gitea look for attribute blocks; none for other dialects. */
function forgeHeadingLines(document: Document): HeadingLines {
  const cached = headingLines.get(document);
  if (cached) return cached;
  const result: HeadingLines = { byHeading: new Map(), lines: [] };
  headingLines.set(document, result);
  if (document.dialect === "forgejo" || document.dialect === "gitea")
    walk(document.tree, "heading", (node) => {
      const line = lastTextLine(document.source, node);
      const brace = document.source.indexOf("{", line.start);
      const found = { ...line, brace: brace < line.end ? brace : -1 };
      result.byHeading.set(node, found);
      result.lines.push(found);
    });
  return result;
}

/**
 * A Forgejo or Gitea heading's attribute block as written, if it has one. The
 * renderers read it character for character before they parse inline content,
 * so the block is part of what the heading means there.
 */
export function headingAttributeSource(document: Document, heading: Heading): string | undefined {
  const line = forgeHeadingLines(document).byHeading.get(heading);
  if (!line || line.brace < 0) return undefined;
  const text = document.source.slice(line.start, line.end);
  const block = protectedBlock(text, line.setext);
  return block && text.slice(...block);
}

/**
 * Whether a source range reaches the part of a Forgejo or Gitea heading where
 * the renderers may read attributes instead of Markdown: the heading's last
 * text line from its first `{` on. Whether that line ends in a valid block, and
 * what the block says, depends on every character from there on. A rewritten
 * `*` or `_` can change an attribute value, make a block invalid, which shows
 * it as heading text and drops its anchor, or make text a valid block:
 * `## *Mode {.a*}` has none, and `## _Mode {.a_}` has one.
 */
export function inHeadingAttributeText(document: Document, start: number, end: number): boolean {
  const { lines } = forgeHeadingLines(document);
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lines[middle]!.end <= start) low = middle + 1;
    else high = middle;
  }
  const line = lines[low];
  return line !== undefined && line.brace >= 0 && end > line.brace;
}
