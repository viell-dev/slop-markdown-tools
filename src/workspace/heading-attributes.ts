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
 * goldmark nests arrays and attributes without a limit. A block nested deeper
 * than this stays heading text, so that it cannot exhaust the call stack.
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
  if (first === undefined || depth > MAX_DEPTH) return undefined;
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
  line = line.replace(/[ \t]+$/, "");
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
    const [start, end] = range(node);
    // An ATX heading is one line; the last line of a Setext heading is its underline.
    const breaks = [...source.slice(start, end).matchAll(/\r\n?|\n/g)];
    const underline = breaks.at(-1);
    const previous = breaks.at(-2);
    const lineStart = previous ? start + previous.index + previous[0].length : start;
    const lineEnd = underline ? start + underline.index : end;
    const block = headingAttributeBlock(source.slice(lineStart, lineEnd));
    if (!block) return;
    const blockStart = lineStart + block.start;
    blocks.set(node, { id: block.id, start: blockStart });
    stripped += source.slice(copied, blockStart);
    stripped += (underline ? "\u00A0" : " ").repeat(lineEnd - blockStart);
    copied = lineEnd;
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
