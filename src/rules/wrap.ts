import type { Document, RuleContext } from "../core/types.js";
import { walk } from "../syntax/walk.js";
import stringWidth from "string-width";
import type { Paragraph, Parents } from "mdast";
import type { Dialect, Finding, Rule } from "../core/types.js";
import { blockIdentifier } from "../syntax/block-identifier.js";
import { definitionLike } from "../syntax/misread-lists.js";
import { labelEnd, lazyIndentation, parse, range, startsWithMarker } from "../syntax/parse.js";
import { type Range, located, holds } from "./shared.js";
import { obsidianOpaque, obsidianTabBreak, goldmarkForges, misreadTable } from "./protections.js";
import { capturedLineBreak, lineBounds, lineBreak, lineEnding } from "../syntax/source.js";
import { optionsSchema } from "./shared.js";

/**
 * Where dollar math could begin or end at the edge of a line although it does
 * not at a space: `start` when a dollar at the start of a line can end math
 * that a dollar before it began, and `end` for the words whose last dollar can
 * begin math at the end of a line, which a dollar after it could end.
 */
interface DollarEdges {
  start: boolean;
  end?: (atom: string) => boolean;
}

/**
 * Join words into the atoms that reflow puts on lines. Whitespace-only words
 * separate atoms; whitespace inside a word, such as in a code span, does not.
 */
function wrappingAtoms(words: string[], openers: RegExp[], dollars?: DollarEdges): string[] {
  const separated: string[] = [];
  let current = "";
  for (const word of words) {
    if (/^[ \t]+$/.test(word)) {
      if (current) separated.push(current);
      current = "";
    } else current += word;
  }
  if (current) separated.push(current);
  // Keep atoms that would open a block or underline a Setext heading at the
  // start of a line attached to the preceding atom, and so a dollar that
  // could end math there.
  const joined: string[] = [];
  let dollarBefore = false;
  for (const atom of separated) {
    if (
      joined.length &&
      (openers.some((opener) => opener.test(atom)) ||
        (dollars?.start && dollarBefore && atom.startsWith("$")))
    )
      joined[joined.length - 1] += ` ${atom}`;
    else joined.push(atom);
    if (atom.includes("$")) dollarBefore = true;
  }
  // An atom ending in an unescaped backslash would become a hard break at the
  // end of a line; keep it attached to the following atom, and so one ending
  // in a dollar that could begin math there.
  let lastDollar = -1;
  joined.forEach((atom, index) => {
    if (atom.includes("$")) lastDollar = index;
  });
  const atoms: string[] = [];
  for (let i = 0; i < joined.length; i++) {
    let atom = joined[i]!;
    while (
      i < joined.length - 1 &&
      (/(?:^|[^\\])(?:\\\\)*\\$/.test(atom) || (i < lastDollar && dollars?.end?.(atom)))
    )
      atom += ` ${joined[++i]}`;
    atoms.push(atom);
  }
  return atoms;
}

/**
 * Words that open a block or underline a heading at the start of a line, the
 * way CommonMark does with them: as a whole word only. These are list markers,
 * ATX heading markers, and runs of the character of a thematic break or a
 * Setext underline, which a line of such words alone forms. A word that only
 * starts with those characters, such as `--config`, `*delta*`, `#tag`, or
 * `-5`, opens nothing.
 */
const wordOpener = /^(?:[-+*]|\d{1,9}[.)]|#{1,6}|\*+|-+|_+|=+)$/;

/**
 * The words of a GFM table's delimiter row, which a line of them alone forms
 * below a line that then becomes the table's header row.
 */
const delimiterRowWord = /^[|:-]*[|-][|:-]*$/;

/**
 * Word starts that open a block whatever follows them on the line: block
 * quotes, fences, math, Obsidian comments, HTML blocks, and footnote
 * definitions.
 */
const prefixOpener = /^(?:>|~{3,}|`{3,}|\$\$|%%|<[!?/A-Za-z]|\[\^[^\]]+\]:)/;

/** A word that ends in an unescaped dollar, which can begin dollar math at the end of a line. */
const dollarEnd = /(?:^|[^\\])(?:\\\\)*\$$/;

/**
 * A paragraph's first word that would open a thematic break or TOML front
 * matter alone on the first line. The paragraph's first line holds more than
 * this word, so it opened neither there.
 */
const firstWordAlone = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|\+\+\+)$/;

/**
 * The start of a fence or of display math, which the first line of a
 * paragraph can start with when what follows on the line, such as a backtick
 * after a backtick fence, keeps it from opening one.
 */
const fenceStart = /^(?:`{3,}|~{3,}|\$\$)/;

/** A link reference definition's label and colon, which a paragraph can start with. */
const definitionStart = /^\[(?:[^[\]\\]|\\[^])+\]:/;

// Forgejo and Gitea additionally open display math with `\[` and definition
// descriptions with `:` followed by at least one space or tab, so only a bare
// `:` atom could open one at the start of a reflowed line.
const forgeLineOpener = /^(?::$|\\\[)/;

/**
 * Site-generator syntax at the start of a line: a container such as
 * Docusaurus's `:::note`, or a template tag such as Liquid's `{% tab %}` or
 * `{{ title }}`, or a literal `[[toc]]`. Site generators read it by line, and
 * no dialect gives it meaning, so a paragraph with a line that starts with it keeps its lines, and
 * a word that starts with it stays on the line before it (issue #296).
 */
const siteSyntax = /^(?::::|\{%|\{\{|\[\[toc\]\](?=[ \t]|$))/i;

/**
 * The template tags in `text`, which starts at offset `base`, that each lie on
 * one line, such as Liquid's `{% data x %}` or `{{ page.title }}`: wrapping
 * keeps them whole.
 */
function templateTags(text: string, base: number): Range[] {
  const ranges: Range[] = [];
  if (!text.includes("{%") && !text.includes("{{")) return ranges;
  let at = base;
  for (const line of text.split(/(?<=\n|\r(?!\n))/)) {
    for (const [open, close] of [
      ["{%", "%}"],
      ["{{", "}}"],
    ] as const)
      for (let from = 0; ;) {
        const opener = line.indexOf(open, from);
        const closer = opener < 0 ? -1 : line.indexOf(close, opener + open.length);
        if (closer < 0) break;
        ranges.push([at + opener, at + closer + close.length]);
        from = closer + close.length;
      }
    at += line.length;
  }
  return ranges;
}

/**
 * Obsidian's inline footnotes, `^[…]`, in the paragraph from `start` to `end`.
 * The parser reads them as text, and Live Preview shows one whose text spans
 * lines as Markdown source (issue #363), so one on a line is kept whole, and a
 * paragraph that holds one across lines keeps its lines. Brackets inside, as
 * of a wikilink, are counted to find the footnote's end.
 */
function inlineFootnotes(
  source: string,
  start: number,
  end: number,
  code: Range[],
): { ranges: Range[]; reason?: string } {
  const ranges: Range[] = [];
  /** The end of the code span that holds `at`, or `at` itself. */
  const pastCode = (at: number) => code.find(([a, b]) => at >= a && at < b)?.[1] ?? at;
  for (let opener = source.indexOf("^[", start); opener >= 0 && opener < end;) {
    // `^[` in a code span is code.
    if (pastCode(opener) !== opener) {
      opener = source.indexOf("^[", pastCode(opener));
      continue;
    }
    // The scan starts at the `[` of `^[`, which opens the first level.
    let depth = 0;
    let at = opener + 1;
    for (; at < end; at++) {
      if (pastCode(at) !== at) at = pastCode(at) - 1;
      else if (source[at] === "\\") at++;
      else if (source[at] === "[") depth++;
      else if (source[at] === "]" && --depth === 0) break;
    }
    // An opener that nothing closes is text; a later one can still be a footnote.
    if (at >= end) {
      opener = source.indexOf("^[", opener + 2);
      continue;
    }
    if (lineBreak.test(source.slice(opener, at)))
      return { ranges, reason: "Obsidian inline footnote spanning lines" };
    ranges.push([opener, at + 1]);
    opener = source.indexOf("^[", at + 1);
  }
  return { ranges };
}

/** Whether a line of a paragraph, after its container markers, starts with `siteSyntax`. */
function startsSiteSyntax(text: string): boolean {
  return text
    .split(lineBreak)
    .some((line, index) => siteSyntax.test(index ? line.replace(/^[ \t>]+/, "") : line));
}

/**
 * A list, heading, or block quote marker as the whole first word of a
 * paragraph, with more words after it. Directly below text, the parser reads
 * a marker that would open an empty list item there, such as the second `-` of
 * `- -`, as text, and the paragraph can continue on the next line. Joining the
 * next word to the marker would open the block. On Forgejo and Gitea, a bare
 * `:` joined to the next word would turn a paragraph above it into the term of
 * a definition list.
 */
const leadingMarker = /^(?:[-+*]|\d{1,9}[.)]|#{1,6}|>)[ \t\r\n]/;

/**
 * A word that Obsidian's Live Preview reads as a tag after blank space or at
 * the start of a line's content, but not directly after a block quote's `>`
 * (issue #409): `#` and the characters Obsidian allows in a tag, letters,
 * digits, `_`, `-`, and `/`, among them one that is not a digit.
 */
const obsidianTag = /^#[\p{L}\p{N}_/-]*[\p{L}_/-]/u;

/**
 * Keep an atom that opens a definition-like label attached to the preceding
 * atom. The label may span atoms and contain `[` or escaped `]`, as
 * `definitionLike` allows. Scan once: retrying the fill for each unsafe line
 * becomes quadratic when many consecutive atoms are labels.
 */
function keepDefinitionStarts(atoms: string[]): string[] {
  const joined = new Uint8Array(atoms.length);
  let pending: number[] = [];
  for (const [index, atom] of atoms.entries()) {
    if (atom.startsWith("[")) pending.push(index);
    for (let at = 0; at < atom.length; at++) {
      if (atom[at] === "\\") {
        if (atom[at + 1] === "\r" || atom[at + 1] === "\n") pending = [];
        at++;
      } else if (atom[at] === "]") {
        // Keep the complete label on one line as well: splitting it changes
        // Live Preview's link styling even when its start stays inline (#411).
        if (atom[at + 1] === ":" && pending.length) joined.fill(1, pending[0], index + 1);
        pending = [];
      }
    }
  }
  const result: string[] = [];
  let group: string[] = [];
  for (const [index, atom] of atoms.entries()) {
    if (!joined[index] && group.length) {
      result.push(group.join(" "));
      group = [];
    }
    group.push(atom);
  }
  if (group.length) result.push(group.join(" "));
  return result;
}

/** Why a definition-like label's source must keep its Live Preview link styling. */
function definitionWrapReason(
  source: string,
  start: number,
  end: number,
  code: Range[],
): string | undefined {
  let label = false;
  let multiline = false;
  let nested = false;
  let span = 0;
  for (let at = start; at < end; at++) {
    while (span < code.length && code[span]![1] <= at) span++;
    if (span < code.length && code[span]![0] <= at) {
      at = code[span]![1] - 1;
      label = false;
    } else if (source[at] === "\\") {
      if (source[at + 1] === "\r" || source[at + 1] === "\n") label = false;
      at++;
    } else if (source[at] === "[") {
      if (!label) multiline = nested = false;
      else nested = true;
      label = true;
    } else if (source[at] === "]") {
      if (label && source[at + 1] === ":") {
        if (multiline) return "definition-like label spanning lines";
        if (nested) return "definition-like label with a nested opening bracket";
        for (let after = at + 2; source[after] === " " || source[after] === "\t"; after++)
          if (source[after] === "\t") return "tab after a definition-like label";
      }
      label = false;
    } else if (source[at] === "\r" || source[at] === "\n") multiline = true;
  }
  return undefined;
}

/**
 * The positions of a paragraph's source where whitespace is not a wrapping
 * opportunity: those strictly inside a protected source range.
 */
class Protection {
  private readonly mask: Uint8Array;
  constructor(
    private readonly start: number,
    end: number,
  ) {
    this.mask = new Uint8Array(Math.max(0, end - start));
  }
  add(from: number, to: number) {
    this.mask.fill(1, Math.max(0, from + 1 - this.start), Math.max(0, to - this.start));
  }
  has(at: number): boolean {
    return this.mask[at - this.start] === 1;
  }
  /** Split text that starts at offset `base` at whitespace outside protected ranges. */
  split(text: string, base: number): string[] {
    const words: string[] = [];
    let cursor = 0;
    for (const match of text.matchAll(/[ \t]+/g)) {
      if (this.has(base + match.index)) continue;
      if (match.index > cursor) words.push(text.slice(cursor, match.index));
      words.push(match[0]);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) words.push(text.slice(cursor));
    return words;
  }
}

/**
 * What reflow does with a line ending inside an inline node that it keeps
 * whole: in a code span it becomes the space that it renders as, and so it
 * does in an image description; elsewhere it keeps the paragraph as written,
 * for the reason given. In the text of a link kept whole, it does what the
 * atom `within` it there does, and otherwise what it does in a description.
 */
type Joining = "code" | "description" | { reason: string } | { within: InlineAtom[] };

interface InlineAtom {
  from: number;
  to: number;
  joining: Joining;
}

/**
 * Inline containers whose text reflow wraps like the paragraph's own: a line
 * ending in them renders as a space, like one between words. Their delimiters,
 * and a link's destination, title, or reference label, stay attached to the
 * neighboring words.
 */
const wrappable = new Set<string>(["emphasis", "strong", "delete", "link", "linkReference"]);

const lineBreakIn: Record<string, string> = {
  html: "inline HTML",
  inlineMath: "math",
  obsidianComment: "an Obsidian comment",
};

/**
 * The inline nodes of a paragraph, from `start` on, that reflow keeps whole,
 * sorted by position, and the hard line breaks anywhere in it. A container
 * that holds inline HTML is kept whole too, because HTML can make the
 * whitespace inside it significant. With `wholeLinks`, the text of a link is
 * kept whole as an image's description is: Obsidian's Live Preview shows a
 * link whose text spans lines as Markdown source (issue #306).
 */
function inlineAtoms(
  paragraph: Paragraph,
  start: number,
  wholeLinks: boolean,
  source: string,
): { atoms: InlineAtom[]; breaks: Range[]; unlocated: boolean } {
  const atoms: InlineAtom[] = [];
  const breaks: Range[] = [];
  let unlocated = false;
  const destination = { reason: "line break in a link destination or title" };
  const visit = (parent: Parents) => {
    for (const child of parent.children) {
      if (child.type === "text") continue;
      if (!located(child)) {
        unlocated = true;
        continue;
      }
      const [a, b] = range(child);
      if (b <= start) continue;
      if (child.type === "break") breaks.push([a, b]);
      else if (
        wholeLinks &&
        (child.type === "link" || child.type === "linkReference") &&
        child.children.length &&
        labelEnd(child) &&
        !holds(child, "html")
      ) {
        // The code spans, images, and other atoms in the text keep their own
        // joining; between them, a line ending joins with the space that it
        // renders as, as in an image's description.
        const close = labelEnd(child)!;
        const inner = atoms.length;
        visit(child);
        const within = atoms.splice(inner).sort((x, y) => x.from - y.from);
        atoms.push({ from: a, to: close, joining: { within } });
        atoms.push({ from: close, to: b, joining: destination });
      } else if (
        wrappable.has(child.type) &&
        "children" in child &&
        child.children.length &&
        !holds(child, "html")
      ) {
        if (child.type === "link" || child.type === "linkReference") {
          const close = labelEnd(child) ?? range(child.children.at(-1)!)[1];
          atoms.push({ from: close, to: b, joining: destination });
        }
        visit(child);
      } else if (child.type === "inlineCode")
        atoms.push({
          from: a,
          to: b,
          // The spaces that start a lazy continuation line stay in the span,
          // which joining would drop, as after `>* ` with no space (issue #339).
          joining: lazyIndentation(child)
            ? { reason: "code span continuing on an indented lazy line" }
            : "code",
        });
      else if ((child.type === "image" || child.type === "imageReference") && labelEnd(child)) {
        const close = labelEnd(child)!;
        atoms.push({
          from: a,
          to: close,
          // Joining raw image text with backticks can turn Live Preview's
          // displayed source into an embed, even for long paired runs (#566).
          joining:
            wholeLinks && source.slice(a, close).includes("`")
              ? { reason: "line break in an image description with backticks" }
              : "description",
        });
        atoms.push({ from: close, to: b, joining: destination });
      } else {
        const name = lineBreakIn[child.type] ?? (holds(child, "html") ? "inline HTML" : undefined);
        const reason = `line break in ${name ?? "inline syntax"}`;
        atoms.push({ from: a, to: b, joining: { reason } });
      }
    }
  };
  visit(paragraph);
  atoms.sort((x, y) => x.from - y.from);
  return { atoms, breaks, unlocated };
}

/** The atom whose source holds `at`, among atoms sorted by position. */
function atomAt(atoms: InlineAtom[], at: number): InlineAtom | undefined {
  let low = 0;
  let high = atoms.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const atom = atoms[middle]!;
    if (at <= atom.from) high = middle - 1;
    else if (at >= atom.to) low = middle + 1;
    else return atom;
  }
  return undefined;
}

/**
 * The width of a line or line prefix, with a tab advancing to the next
 * multiple of four columns, the tab stop that CommonMark uses for indentation.
 */
function lineWidth(text: string, measure: (text: string) => number): number {
  if (!text.includes("\t")) return measure(text);
  let width = 0;
  for (const part of text.split(/(\t)/)) width += part === "\t" ? 4 - (width % 4) : measure(part);
  return width;
}

/** Whether text parses as a single paragraph. */
function oneParagraph(text: string, dialect: Dialect): boolean {
  const { children } = parse(text, dialect).tree;
  return children.length === 1 && children[0]!.type === "paragraph";
}

/**
 * Syntax that Forgejo and Gitea render but GFM parses as prose. A line starting
 * with `:` and a space turns the preceding lines into a definition list and `\[`
 * opens display math, so such paragraphs keep their lines. `\(...\)` math and
 * `[[...]]` shortlinks are recognized within one physical line: a pair on one
 * line becomes an unbreakable atom, and a pair split across lines, which reflow
 * could join, protects the whole paragraph. Gitea parses the backslash math
 * delimiters only where an administrator enables them, which a document does
 * not reveal, so they are protected there too.
 */
function forgeProtections(
  source: string,
  start: number,
  end: number,
  forge: string,
): { ranges: Range[]; reason?: string } {
  const ranges: Range[] = [];
  for (const line of source.slice(start, end).split(lineBreak)) {
    const content = line.replace(/^[ \t>]+/, "");
    if (/^:[ \t]/.test(content)) return { ranges, reason: `${forge} definition list` };
    if (content.startsWith("\\[")) return { ranges, reason: `${forge} display math` };
  }
  for (const [open, close] of [
    ["\\(", "\\)"],
    ["[[", "]]"],
  ] as const) {
    let from = start;
    for (;;) {
      const opener = source.indexOf(open, from);
      if (opener < 0 || opener >= end) break;
      const closer = source.indexOf(close, opener + open.length);
      if (closer < 0 || closer >= end) break;
      if (lineBreak.test(source.slice(opener, closer)))
        return { ranges, reason: `${forge} ${open}...${close} syntax spanning lines` };
      ranges.push([opener, closer + close.length]);
      from = closer + close.length;
    }
  }
  return { ranges };
}

/**
 * Whether reflow could change Gitea emphasis under its `_.py` exception: the
 * paragraph contains `_.py` and an underscore that Gitea's parser could treat
 * as a delimiter. Underscores inside code spans are safe only without `$` or
 * `\(` math, which can consume a backtick that GFM reads as opening a code span.
 */
function giteaPyParagraph(source: string, node: Paragraph, start: number, end: number): boolean {
  const text = source.slice(start, end);
  if (!text.includes("_.py")) return false;
  if (/\$|\\\(/.test(text)) return true;
  const code: Range[] = [];
  walk(node, "inlineCode", (child) => {
    code.push(range(child));
  });
  for (let at = text.indexOf("_"); at >= 0; at = text.indexOf("_", at + 1)) {
    if (!code.some(([a, b]) => start + at >= a && start + at < b)) return true;
  }
  return false;
}

/**
 * Whether joining an Obsidian paragraph's lines could create a highlight or a
 * wikilink. The parser reads neither across a line break, so `==` and `[[` or
 * `]]` that it left as text, outside code, math, and the highlights and links
 * that it did read, could pair up once two lines become one.
 */
function obsidianMarkers(source: string, node: Paragraph, start: number, end: number): boolean {
  if (!/==|\[\[|\]\]/.test(source.slice(start, end))) return false;
  const opaque: Range[] = [];
  walk(node, (child) => {
    if (obsidianOpaque.has(child.type)) opaque.push(range(child));
  });
  let text = "";
  let cursor = start;
  for (const [a, b] of opaque.sort((x, y) => x[0] - y[0])) {
    if (b <= cursor) continue;
    // A space keeps the text on both sides from forming a marker.
    text += source.slice(cursor, Math.max(cursor, a)) + " ";
    cursor = Math.min(Math.max(cursor, b), end);
  }
  text += source.slice(cursor, end);
  return /==|\[\[|\]\]/.test(text);
}

/** A line's container prefix, with list item markers and checkboxes made blank. */
function continuationOf(prefix: string): string {
  return prefix.replace(/(?:[-+*]|\d+[.)]|\[[xX ]\])(?=\s)/g, (value) => " ".repeat(value.length));
}
/**
 * A failed flow comment can be plain paragraphs when blank lines split its
 * inline reading and text follows its closing marker. Reflowing that marker
 * onto a line of its own would accept the complete flow comment instead.
 */
function blankLineComments(document: Document): ReadonlySet<Paragraph> {
  const protectedParagraphs = new Set<Paragraph>();
  const { source } = document;
  if (document.dialect !== "obsidian" || !source.includes("%%")) return protectedParagraphs;
  let through = 0;
  walk(document.tree, "paragraph", (node) => {
    const [start, end] = range(node);
    if (start < through) {
      protectedParagraphs.add(node);
      return;
    }
    if (node.children[0]?.type !== "text" || !source.startsWith("%%", start)) return;
    const close = source.indexOf("%%", start + 2);
    if (close < end) return;
    if (!/(?:\r\n|\r|\n)[ \t>]*(?:\r\n|\r|\n)/.test(source.slice(end, close))) return;
    through = close + 2;
    protectedParagraphs.add(node);
  });
  return protectedParagraphs;
}

interface WrapContext extends Pick<RuleContext, "document" | "options"> {
  blankCommentParagraphs: ReadonlySet<Paragraph>;
  width: number;
  measure: (text: string) => number;
  unit: string;
  newline: string;
}
interface PreparedParagraph {
  node: Paragraph;
  index: number | undefined;
  parent: Parents | undefined;

  start: number;
  end: number;
  children: Paragraph["children"];
  original: string;
  forge: string | undefined;
  calloutHeader: boolean;
  belowHeader: boolean;
  prefix: string;
  continuation: string;
  lazyStart: boolean;
}
/** Locate the paragraph body and retain any callout header as written. */
function prepareParagraph(
  node: Paragraph,
  index: number | undefined,
  parent: Parents | undefined,
  context: WrapContext,
  findings: Finding[],
): PreparedParagraph | undefined {
  const { document, options, width, measure, unit } = context;

  const paragraphStart = range(node)[0];
  let end = range(node)[1];
  // Obsidian's Reading view shows the blank space at the end of a footnote
  // definition's last paragraph before the footnote's backreference (issue
  // #405). It stays as written, outside the text that is reflowed.
  if (
    document.dialect === "obsidian" &&
    parent?.type === "footnoteDefinition" &&
    index === parent.children.length - 1
  )
    while (end > paragraphStart && /[ \t]/.test(document.source[end - 1]!)) end--;
  // The parser ends this paragraph before a Tab-only line, but Obsidian's
  // continuation can still give its terminal separator meaning (#563).
  const tabBreak =
    document.dialect === "obsidian" ? obsidianTabBreak(node, document.source) : undefined;
  if (tabBreak) end = tabBreak[0];
  let start = paragraphStart;
  let children = node.children;
  // A task item's paragraph range can begin at the checkbox, and its first
  // text node can begin with the separator. Wrap only the content after them.
  if (children[0]) {
    start = Math.max(start, range(children[0])[0]);
    while (start < end && /[ \t]/.test(document.source[start]!)) start++;
  }
  let original = document.source.slice(start, end);
  const forge = goldmarkForges[document.dialect];
  // An Obsidian callout or a GitHub, Forgejo, or Gitea alert keeps the line
  // with its marker, and its title in Obsidian, as written. On Forgejo and
  // Gitea, a marker written as `\[!NOTE]` starts like display math, and
  // its paragraph stays as written.
  let calloutHeader =
    document.dialect !== "commonmark" &&
    parent?.type === "blockquote" &&
    index === 0 &&
    startsWithMarker(original, node) &&
    !(forge && original.startsWith("\\["));
  /** Whether the lines to wrap are the body below that line, in the same paragraph. */
  let belowHeader = false;
  let lineStart = start;
  while (lineStart > 0 && !/[\r\n]/.test(document.source[lineStart - 1]!)) lineStart--;
  let prefix = document.source.slice(lineStart, start);
  const continuation = continuationOf(prefix);
  // Directly below a link reference definition, a paragraph can start with
  // a lazy continuation line, which lacks some of the container markers of
  // the lines around it. The later lines' prefixes cannot be told from it.
  const above = index ? parent?.children[index - 1] : undefined;
  let lazyStart = false;
  if (above?.type === "definition" && above.position!.end.line === node.position!.start.line - 1) {
    const [definitionStart] = range(above);
    const definitionLine = lineBounds(document.source, definitionStart, definitionStart)[0];
    lazyStart =
      continuationOf(document.source.slice(definitionLine, definitionStart)) !== continuation;
  }
  if (calloutHeader) {
    const headerBreak = lineBreak.exec(original);
    const headerEnd = headerBreak ? start + headerBreak.index : end;
    const header = document.source.slice(start, headerEnd);
    const bodyStart = headerEnd + (headerBreak?.[0].length ?? 0) + continuation.length;
    const bodyLines = headerBreak
      ? original.slice(headerBreak.index + headerBreak[0].length).split(lineBreak)
      : [];
    const supported =
      bodyLines.every((line) => line.startsWith(continuation)) &&
      !children.some((child) => {
        const [a, b] = range(child);
        return child.type !== "text" && a < bodyStart && b > bodyStart;
      });
    // Keep unusual continuations and inline syntax spanning the boundary untouched.
    if (supported) {
      if (options.reportUnbreakable === true && lineWidth(prefix + header, measure) > width)
        findings.push({
          start,
          end: start + header.length,
          message: `Paragraph exceeds ${width} ${unit} because of an unbreakable atom.`,
        });
      if (!headerBreak) return;
      start = bodyStart;
      original = document.source.slice(start, end);
      children = children.filter((child) => range(child)[1] > start);
      prefix = continuation;
      calloutHeader = false;
      belowHeader = true;
    }
  }
  return {
    node,
    index,
    parent,
    start,
    end,
    children,
    original,
    forge,
    calloutHeader,
    belowHeader,
    prefix,
    continuation,
    lazyStart,
  };
}
/** Join physical lines into words, preserving protected atoms and their rendered spaces. */
function readWords(
  document: Document,
  original: string,
  start: number,
  continuation: string,
  protection: Protection,
  inline: ReturnType<typeof inlineAtoms>,
): { words: string[]; failure: string | undefined } {
  const { source } = document;

  // Collect the words line by line, without the container prefixes. A line
  // ending between words, or in the text of emphasis or a link, separates
  // words like a space. One inside an atom joins its lines with the space
  // that it renders as, or keeps the paragraph as written.
  const words: string[] = [];
  let failure: string | undefined;
  const pieces = original.split(capturedLineBreak);
  let at = start;
  let lineEnd = start;
  for (let i = 0; i < pieces.length && !failure; i += 2) {
    let line = pieces[i]!;
    let lineAt = at;
    at += line.length + (pieces[i + 1]?.length ?? 0);
    if (i > 0) {
      if (continuation && line.startsWith(continuation)) {
        line = line.slice(continuation.length);
        lineAt += continuation.length;
      } else if (continuation && /^[\s>]/.test(line)) {
        failure = "unsupported continuation";
        break;
      }
      // Directly after a bare quote marker, Live Preview reads a tag as
      // text. Joining that line would put it after a space and create a
      // tag (issue #414). Inline atoms keep their own reading of `#`.
      if (
        document.dialect === "obsidian" &&
        source[lineAt - 1] === ">" &&
        obsidianTag.test(line) &&
        !protection.has(lineAt)
      ) {
        failure = "tag-like text directly after a block quote marker";
        break;
      }
      const last = words.at(-1);
      let joining = protection.has(lineEnd)
        ? (atomAt(inline.atoms, lineEnd)?.joining ?? { reason: "line break in inline syntax" })
        : undefined;
      if (joining && typeof joining === "object" && "within" in joining)
        joining = atomAt(joining.within, lineEnd)?.joining ?? "description";
      // A Tab before two final spaces hides this native hard break from the
      // primary tree (#562). Opaque atoms keep their own joining rules.
      if (!joining && source.endsWith("  ", lineEnd)) {
        failure = "hard line break";
        break;
      }
      if (!joining) words.push(" ");
      else if (last === undefined || /^[ \t]+$/.test(last)) failure = "line break in inline syntax";
      else if (joining === "code" || joining === "description") {
        // In an image description, two spaces or a backslash before the
        // line ending make a hard break, and other spaces collapse; in a
        // code span, the spaces before it are code. The spaces and tabs
        // after it go, as `codeSpanText` reads the span, also the
        // indentation below a task item's checkbox, which the parser
        // keeps. A lazy line, which keeps them, is not supported above.
        if (joining === "description" && /(?: {2}|\\)$/.test(last)) failure = "hard line break";
        // In a code span, two spaces or a backslash before a line end make a hard
        // break wherever the backticks do not pair, as on GitHub after an
        // unpaired longer run (issue #335).
        if (joining === "code" && /(?: {2}|\\)$/.test(last))
          failure = "hard line break in a code span";
        const trimmed = line.replace(/^[ \t]+/, "");
        lineAt += line.length - trimmed.length;
        line = trimmed;
        words[words.length - 1] = `${joining === "code" ? last : last.trimEnd()} `;
      } else failure = "reason" in joining ? joining.reason : "line break in inline syntax";
    }
    for (const word of protection.split(line, lineAt)) words.push(word);
    lineEnd = lineAt + line.length;
  }
  return { words, failure };
}
/** Greedily fill lines, with the first selected atoms kept together. */
function fillLines(
  atoms: string[],
  first: number,
  prefix: string,
  continuation: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let line = atoms.slice(0, first).join(" ");
  let linePrefix = prefix;
  for (let i = first; i < atoms.length; i++) {
    const candidate = `${line} ${atoms[i]}`;
    if (lineWidth(linePrefix + candidate, measure) > width) {
      lines.push(line);
      line = atoms[i]!;
      linePrefix = continuation;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}
/** Why the paragraph must stay as written, independently of overflow reporting. */
function paragraphSkipReason(
  document: Document,
  prepared: PreparedParagraph,
  inline: ReturnType<typeof inlineAtoms>,
  protectedReason: string | undefined,
): string | undefined {
  const {
    node,
    index,
    parent,
    start,
    end,
    children,
    original,
    forge,
    belowHeader,
    prefix,
    continuation,
    lazyStart,
  } = prepared;
  const { source } = document;

  // Only the first paragraph of a block quote can be a callout, so a
  // paragraph elsewhere that starts with a linked image, `[![`, is wrapped.
  // Below the line of a marker, the paragraph's text no longer starts the
  // lines to wrap.
  const markerLike = /^\[![^\]]+\]/;
  const startsLikeMarker =
    parent?.type === "blockquote" &&
    index === 0 &&
    (belowHeader ? markerLike.test(original) : startsWithMarker(original, node, markerLike));
  const reason = inline.breaks.length
    ? "hard line break"
    : children.some((child) => child.type === "html")
      ? "inline HTML"
      : startsLikeMarker
        ? "callout header"
        : blockIdentifier(document.source, node)
          ? "block identifier"
          : leadingMarker.test(original) || (forge && /^:(?:\r|\n)/.test(original))
            ? "leading block marker"
            : document.dialect !== "commonmark" && misreadTable(original)
              ? "table delimiter row as its second line"
              : original.startsWith("<<<")
                ? "site-generator snippet import"
                : startsSiteSyntax(original)
                  ? "site-generator syntax at the start of a line"
                  : lazyStart
                    ? "lazy first line"
                    : !/^[\s>\-*+\d.[\]xX)]*$/.test(prefix)
                      ? "unsupported container prefix"
                      : document.dialect === "obsidian" && obsidianMarkers(source, node, start, end)
                        ? "Obsidian `==`, `[[`, or `]]` outside highlights and links"
                        : inline.unlocated
                          ? "inline syntax without a source position"
                          : undefined;
  const skipped =
    reason ??
    protectedReason ??
    (document.dialect === "obsidian" &&
    parent?.type === "blockquote" &&
    node.position?.start.line === parent.position?.start.line &&
    prefix !== continuation
      ? "block quote on a list marker line"
      : undefined) ??
    (document.dialect === "obsidian"
      ? definitionWrapReason(
          source,
          start,
          end,
          inline.atoms.filter((atom) => atom.joining === "code").map(({ from, to }) => [from, to]),
        )
      : undefined) ??
    (document.dialect === "gitea" && giteaPyParagraph(source, node, start, end)
      ? "Gitea `_.py` emphasis exception"
      : undefined);
  return skipped;
}

/** Propose wrapping and overflow findings for one located paragraph. */
function wrapParagraph(
  node: Paragraph,
  index: number | undefined,
  parent: Parents | undefined,
  context: WrapContext,
  findings: Finding[],
): void {
  const { document, options, width, measure, unit, newline } = context;

  const prepared = prepareParagraph(node, index, parent, context, findings);
  if (!prepared) return;
  const { start, end, original, forge, calloutHeader, belowHeader, prefix, continuation } =
    prepared;

  const openers = [wordOpener, prefixOpener, siteSyntax];
  if (document.dialect !== "commonmark") openers.push(delimiterRowWord);
  if (forge) openers.push(forgeLineOpener);
  // Live Preview reads a tag after blank space or at the start of a line's
  // content, not directly after a quote marker, so where the lines below
  // the first start with markers written without a space after them, a
  // tag stays on the line before it (issue #409).
  if (document.dialect === "obsidian" && continuation.endsWith(">")) openers.push(obsidianTag);
  const { source } = document;
  // GitHub and Obsidian end dollar math at a single dollar after a line
  // ending, but not after a space, so a word that starts with `$` stays on
  // the line of the word before it when a dollar comes before it. Obsidian
  // also begins math at a single dollar before a line ending, but not
  // before a space, so a word that ends in a dollar of its text, such as a
  // lone `$`, stays on the line of the word after it when a dollar comes
  // after it. Forgejo and Gitea have neither condition.
  const maths: string[] = [];
  if (document.dialect === "obsidian")
    walk(node, "inlineMath", (math) => {
      maths.push(source.slice(...range(math)));
    });
  const dollars: DollarEdges = {
    start: document.dialect === "github" || document.dialect === "obsidian",
    ...(document.dialect === "obsidian"
      ? {
          end: (atom: string) => dollarEnd.test(atom) && !maths.some((math) => atom.endsWith(math)),
        }
      : {}),
  };
  const inline = inlineAtoms(node, start, document.dialect === "obsidian", source);
  const protection = new Protection(start, end);
  for (const atom of inline.atoms) protection.add(atom.from, atom.to);
  // Forgejo and Gitea protections apply before paragraphs are skipped, so
  // that diagnostics still count one-line math and shortlinks as atoms.
  const protections = forge
    ? forgeProtections(source, start, end, forge)
    : document.dialect === "obsidian"
      ? inlineFootnotes(
          source,
          start,
          end,
          inline.atoms.filter((atom) => atom.joining === "code").map(({ from, to }) => [from, to]),
        )
      : { ranges: [] as Range[] };
  for (const [from, to] of protections.ranges) protection.add(from, to);
  for (const [from, to] of templateTags(source.slice(start, end), start)) protection.add(from, to);
  const reportUnbreakable = () =>
    findings.push({
      start,
      end,
      message: `Paragraph exceeds ${width} ${unit} because of an unbreakable atom.`,
    });
  const reportSkipped = (reason: string) => {
    if (options.reportUnreflowed !== true && options.reportUnbreakable !== true) return;
    let breakable = false;
    let unbreakable = false;
    let offset = start;
    for (const line of original.split(/(?<=\n|\r(?!\n))/)) {
      const content = line.replace(/(?:\r\n|\r|\n)$/, "");
      const container =
        offset === start
          ? ""
          : continuation && content.startsWith(continuation)
            ? continuation
            : (content.match(/^[ \t>]+/)?.[0] ?? "");
      const linePrefix = offset === start ? prefix : container;
      // An Obsidian title occupies one physical line, even when it contains spaces.
      if (calloutHeader && offset === start) {
        if (lineWidth(prefix + content, measure) > width) unbreakable = true;
        offset += line.length;
        continue;
      }
      // Hard-break markers do not count toward the width.
      let contentEnd = offset + content.length;
      for (const [a] of inline.breaks) if (a >= offset && a < contentEnd) contentEnd = a;
      const from = offset + container.length;
      const words = protection.split(source.slice(from, contentEnd), from);
      const atoms = wrappingAtoms(words, openers, dollars);
      const available = width - lineWidth(linePrefix, measure);
      if (measure(words.join("").trimEnd()) > available) {
        if (atoms.length > 1) breakable = true;
        if (atoms.some((atom) => measure(atom) > available)) unbreakable = true;
      }
      offset += line.length;
    }
    if (options.reportUnreflowed === true && breakable)
      findings.push({
        start,
        end,
        message: `Paragraph not reflowed: ${reason} (width ${width} ${unit}).`,
      });
    if (options.reportUnbreakable === true && unbreakable) reportUnbreakable();
  };
  const skipped = context.blankCommentParagraphs.has(node)
    ? "Obsidian comment crossing a blank line"
    : paragraphSkipReason(document, prepared, inline, protections.reason);
  if (skipped) {
    reportSkipped(skipped);
    return;
  }
  const { words, failure } = readWords(document, original, start, continuation, protection, inline);

  if (failure) {
    reportSkipped(failure);
    return;
  }
  const definitions = document.dialect === "obsidian";
  const wrapped = wrappingAtoms(words, openers, dollars);
  const atoms = definitions ? keepDefinitionStarts(wrapped) : wrapped;
  if (!atoms.length) return;
  // A leading inline comment alone on the first output line becomes a
  // standalone comment block. Keep its following atom with it, including
  // an over-width badge; comments elsewhere retain ordinary wrapping.
  const first = node.children[0];
  const leadingComment =
    document.dialect === "obsidian" &&
    first?.type === "obsidianComment" &&
    range(first)[0] === start
      ? source.slice(...range(first))
      : undefined;
  // The first line keeps the words after a first word that would open a
  // block alone on the line, until the line can no longer open one, and
  // below an alert's or callout's marker line, after a run of `=` or `-`
  // that would underline that line as a heading.
  while (
    atoms.length > 1 &&
    (firstWordAlone.test(atoms[0]!) ||
      (leadingComment !== undefined && atoms[0] === leadingComment) ||
      (belowHeader && /^(?:=+|-+)$/.test(atoms[0]!)) ||
      (fenceStart.test(atoms[0]!) && !oneParagraph(atoms[0]!, document.dialect)))
  )
    atoms.splice(0, 2, `${atoms[0]} ${atoms[1]}`);
  let output = fillLines(atoms, 1, prefix, continuation, width, measure);
  // A paragraph that starts like a link reference definition becomes one
  // when a line ends after the definition's destination or title. Keep
  // words on the first line until the lines read as one paragraph again.
  if (output.length > 1 && atoms[0]!.startsWith("[") && definitionStart.test(atoms.join(" "))) {
    let first = atoms.findIndex((atom) => atom.includes("]:")) + 1;
    while (output.length > 1 && !oneParagraph(output.join("\n"), document.dialect))
      output = fillLines(atoms, ++first, prefix, continuation, width, measure);
  }
  // Live Preview hides the destination after `[`, a label, and `]:` at a
  // line's content start, including container continuations, so no reflowed line
  // starts so: the word that opens the label, which may hold blank space,
  // stays on the line before it (issue #411). The first line has no line
  // before it, and a paragraph whose first line would start so, as `[a`
  // and `b]: c d` below it joined, stays as written.
  // A list's marker line shows its destination as text; ordinary wrapping
  // there keeps the label on that first line and remains possible (#411).
  if (definitions && prefix === continuation && definitionLike.test(output[0]!)) {
    reportSkipped("first line that Obsidian styles as a link reference definition");
    return;
  }
  const replacement = output.join(newline + continuation);
  if (replacement !== original)
    findings.push({
      start,
      end,
      message: `Reflow paragraph to ${width} ${unit}.`,
      edit: { start, end, text: replacement },
    });
  if (
    options.reportUnbreakable === true &&
    (prefix + replacement).split(lineBreak).some((line) => lineWidth(line, measure) > width)
  )
    reportUnbreakable();
}

const wrap: Rule = {
  description: "Reflow paragraphs using configurable width and protected inline atoms.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({
    width: { type: "integer", minimum: 20, maximum: 500 },
    measure: { enum: ["columns", "codepoints"] },
    reportUnreflowed: { type: "boolean" },
    reportUnbreakable: { type: "boolean" },
  }),
  check({ document, options, workspace }) {
    if (document.dialect === "obsidian" && workspace?.strictLineBreaks !== true) return [];
    const findings: Finding[] = [];
    const width = Number(options.width ?? 80);
    const measure =
      options.measure === "codepoints" ? (text: string) => [...text].length : stringWidth;
    const unit = options.measure === "codepoints" ? "code points" : "columns";
    // Detect the line ending once; scanning the whole source per paragraph is quadratic.
    const newline = lineEnding(document.source);
    const context: WrapContext = {
      document,
      options,
      width,
      measure,
      unit,
      newline,
      blankCommentParagraphs: blankLineComments(document),
    };
    walk(document.tree, "paragraph", (node, index, parent) =>
      wrapParagraph(node, index, parent, context, findings),
    );
    return findings;
  },
};
export { wrap };
