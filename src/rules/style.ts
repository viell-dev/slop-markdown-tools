import { walk } from "../syntax/walk.js";
import stringWidth from "string-width";
import type { Blockquote, Nodes, Paragraph, Parents, Root, RootContent } from "mdast";
import { directive } from "../core/directives.js";
import type { Dialect, Document, Finding, Rule } from "../core/types.js";
import { labelEnd, parse, range } from "../syntax/parse.js";
import { changesForgeHeading, headingAttributeBlock } from "../workspace/heading-attributes.js";

export function optionsSchema(properties: Record<string, unknown>) {
  return { type: "object", properties, additionalProperties: false };
}
/** Any CommonMark line ending, including a lone carriage return. */
const lineBreak = /\r\n|\r|\n/;
/** The document's line ending, taken from its first line break. */
function lineEnding(source: string): string {
  return lineBreak.exec(source)?.[0] ?? "\n";
}
/** Start and end of the physical lines containing a source range. */
function lineBounds(source: string, start: number, end: number): [number, number] {
  let lineStart = start;
  while (lineStart > 0 && !/[\r\n]/.test(source[lineStart - 1]!)) lineStart--;
  let lineEnd = end;
  while (lineEnd < source.length && !/[\r\n]/.test(source[lineEnd]!)) lineEnd++;
  return [lineStart, lineEnd];
}
/**
 * Gitea does not parse a `_` run as an emphasis delimiter when the next `_` on
 * its physical line starts `_.py`, or when the run itself does and no `_`
 * follows, so `__init__.py` stays literal. The outcome depends on everything
 * else on the line, code spans included: a line containing `_.py` before or
 * after an edit can gain or lose emphasis when markers change or lines join.
 */
export function giteaPyLine(source: string, start: number, end: number): boolean {
  return source.slice(...lineBounds(source, start, end)).includes("_.py");
}
/** Forgejo and its upstream Gitea build on goldmark with shared extensions. */
const goldmarkForges: Partial<Record<Dialect, string>> = { forgejo: "Forgejo", gitea: "Gitea" };
/**
 * Whether a range lies between `\(` and `\)` on its line, which Forgejo, and
 * Gitea where enabled, render as math. GFM parses emphasis and code spans
 * there, and changing them would change the formula.
 */
function inForgeMath(source: string, start: number, end: number): boolean {
  const [lineStart, lineEnd] = lineBounds(source, start, end);
  const before = source.slice(lineStart, start);
  return (
    before.lastIndexOf("\\(") > before.lastIndexOf("\\)") &&
    source.slice(end, lineEnd).includes("\\)")
  );
}
function markerRule(type: "emphasis" | "strong", fallback: string): Rule {
  return {
    description: `Choose ${type} delimiters without reprinting their contents.`,
    kind: "style",
    phase: "inline",
    schema: optionsSchema({ marker: { enum: ["*", "_"] } }),
    check({ document, options }) {
      const findings: Finding[] = [];
      walk(document.tree, type, (node) => {
        const [start, end] = range(node);
        const size = type === "strong" ? 2 : 1;
        const marker = String(options.marker ?? fallback).repeat(size);
        const original = document.source.slice(start, end);
        if (original.startsWith(marker)) return;
        // Underscores cannot delimit intraword emphasis. Preserve these valid forms.
        if (
          marker.startsWith("_") &&
          (/\p{L}|\p{N}/u.test(document.source[start - 1] ?? "") ||
            /\p{L}|\p{N}/u.test(document.source[end] ?? ""))
        )
          return;
        // A new marker touching the same character, outside or inside the
        // node, would merge into one delimiter run and change the parse.
        const neighbours = [start - 1, end, start + size, end - size - 1].map(
          (index) => document.source[index],
        );
        if (neighbours.includes(marker[0]!)) return;
        if (goldmarkForges[document.dialect] && inForgeMath(document.source, start, end)) return;
        // Forgejo, and Gitea before 1.26, build a heading's anchor from its last
        // line as written, keeping `_` and dropping `*`, and both read a trailing
        // `{...}` block as attributes before they parse emphasis.
        if (changesForgeHeading(document, start, end)) return;
        if (
          document.dialect === "gitea" &&
          (giteaPyLine(document.source, start, end) ||
            document.source.startsWith(".py", end) ||
            document.source.startsWith(".py", start + size))
        )
          return;
        for (const [a, b] of [
          [start, start + size],
          [end - size, end],
        ] as const) {
          findings.push({
            start: a,
            end: b,
            message: `Use ${JSON.stringify(marker)} for ${type}.`,
            edit: { start: a, end: b, text: marker },
          });
        }
      });
      return findings;
    },
  };
}

/**
 * Join words into the atoms that reflow puts on lines. Whitespace-only words
 * separate atoms; whitespace inside a word, such as in a code span, does not.
 */
function wrappingAtoms(words: string[], openers: RegExp[]): string[] {
  const atoms: string[] = [];
  let current = "";
  for (const word of words) {
    if (/^[ \t]+$/.test(word)) {
      if (current) atoms.push(current);
      current = "";
    } else current += word;
  }
  if (current) atoms.push(current);
  // Keep atoms that would open a block or underline a Setext heading at the
  // start of a line attached to the preceding atom.
  for (let i = 1; i < atoms.length; i++) {
    const atom = atoms[i]!;
    if (openers.some((opener) => opener.test(atom))) {
      atoms.splice(i - 1, 2, `${atoms[i - 1]} ${atom}`);
      i--;
    }
  }
  // An atom ending in an unescaped backslash would become a hard break at the
  // end of a line; keep it attached to the following atom.
  for (let i = 0; i < atoms.length - 1; i++) {
    if (/(?:^|[^\\])(?:\\\\)*\\$/.test(atoms[i]!)) {
      atoms.splice(i, 2, `${atoms[i]} ${atoms[i + 1]}`);
      i--;
    }
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
/**
 * A paragraph's first word that would open a block alone on the first line:
 * a thematic break, TOML front matter, a fence, or display math. The
 * paragraph's first line holds more than this word, so it opened none there.
 */
const firstWordOpener =
  /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|\+\+\+)$|^(?:`{3,}|~{3,}|\$\$)/;
/** A link reference definition's label and colon, which a paragraph can start with. */
const definitionStart = /^\[(?:[^[\]\\]|\\[^])+\]:/;
// Forgejo and Gitea additionally open display math with `\[` and definition
// descriptions with `:` followed by at least one space or tab, so only a bare
// `:` atom could open one at the start of a reflowed line.
const forgeLineOpener = /^(?::$|\\\[)/;
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

type Range = [number, number];
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
 * for the reason given.
 */
type Joining = "code" | "description" | { reason: string };
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
function located(node: Nodes): boolean {
  return node.position?.start.offset !== undefined && node.position.end.offset !== undefined;
}
function holds(node: Nodes, type: string): boolean {
  let found = false;
  walk(node, (child) => {
    if (child.type === type) found = true;
  });
  return found;
}
/**
 * The inline nodes of a paragraph, from `start` on, that reflow keeps whole,
 * sorted by position, and the hard line breaks anywhere in it. A container
 * that holds inline HTML is kept whole too, because HTML can make the
 * whitespace inside it significant.
 */
function inlineAtoms(
  paragraph: Paragraph,
  start: number,
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
      } else if (child.type === "inlineCode") atoms.push({ from: a, to: b, joining: "code" });
      else if ((child.type === "image" || child.type === "imageReference") && labelEnd(child)) {
        const close = labelEnd(child)!;
        atoms.push({ from: a, to: close, joining: "description" });
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
/** Inline nodes whose source joined lines cannot change. */
const obsidianOpaque = new Set(["inlineCode", "inlineMath", "wikiLink", "obsidianHighlight"]);
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
    walk(document.tree, "paragraph", (node, index, parent) => {
      const [paragraphStart, end] = range(node);
      let start = paragraphStart;
      let children = node.children;
      // A task item's paragraph range can begin at the checkbox, and its first
      // text node can begin with the separator. Wrap only the content after them.
      if (children[0]) {
        start = Math.max(start, range(children[0])[0]);
        while (start < end && /[ \t]/.test(document.source[start]!)) start++;
      }
      let original = document.source.slice(start, end);
      // An Obsidian callout or a GitHub, Forgejo, or Gitea alert keeps the line
      // with its marker, and its title in Obsidian, as written.
      let calloutHeader =
        document.dialect !== "commonmark" &&
        parent?.type === "blockquote" &&
        index === 0 &&
        /^\[![\w-]+\]/.test(original);
      let lineStart = start;
      while (lineStart > 0 && !/[\r\n]/.test(document.source[lineStart - 1]!)) lineStart--;
      let prefix = document.source.slice(lineStart, start);
      const continuation = continuationOf(prefix);
      // Directly below a link reference definition, a paragraph can start with
      // a lazy continuation line, which lacks some of the container markers of
      // the lines around it. The later lines' prefixes cannot be told from it.
      const above = index ? parent?.children[index - 1] : undefined;
      let lazyStart = false;
      if (
        above?.type === "definition" &&
        above.position!.end.line === node.position!.start.line - 1
      ) {
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
        }
      }
      const forge = goldmarkForges[document.dialect];
      const openers = [wordOpener, prefixOpener];
      if (document.dialect !== "commonmark") openers.push(delimiterRowWord);
      if (forge) openers.push(forgeLineOpener);
      const { source } = document;
      const inline = inlineAtoms(node, start);
      const protection = new Protection(start, end);
      for (const atom of inline.atoms) protection.add(atom.from, atom.to);
      // Forgejo and Gitea protections apply before paragraphs are skipped, so
      // that diagnostics still count one-line math and shortlinks as atoms.
      const protections = forge
        ? forgeProtections(source, start, end, forge)
        : { ranges: [] as Range[] };
      for (const [from, to] of protections.ranges) protection.add(from, to);
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
          const atoms = wrappingAtoms(words, openers);
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
      const reason = inline.breaks.length
        ? "hard line break"
        : children.some((child) => child.type === "html")
          ? "inline HTML"
          : /^\[![^\]]+\]/.test(original)
            ? "callout header"
            : /(?:^|\s)\^[\w-]+\s*$/.test(original)
              ? "block identifier"
              : leadingMarker.test(original) || (forge && /^:(?:\r|\n)/.test(original))
                ? "leading block marker"
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
        protections.reason ??
        (document.dialect === "gitea" && giteaPyParagraph(source, node, start, end)
          ? "Gitea `_.py` emphasis exception"
          : undefined);
      if (skipped) {
        reportSkipped(skipped);
        return;
      }
      // Collect the words line by line, without the container prefixes. A line
      // ending between words, or in the text of emphasis or a link, separates
      // words like a space. One inside an atom joins its lines with the space
      // that it renders as, or keeps the paragraph as written.
      const words: string[] = [];
      let failure: string | undefined;
      const pieces = original.split(/(\r\n|\r|\n)/);
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
          const last = words.at(-1);
          const joining = protection.has(lineEnd)
            ? (atomAt(inline.atoms, lineEnd)?.joining ?? { reason: "line break in inline syntax" })
            : undefined;
          if (!joining) words.push(" ");
          else if (last === undefined || /^[ \t]+$/.test(last))
            failure = "line break in inline syntax";
          else if (joining === "code") {
            // Micromark keeps a space or tab at the start of a code span's next
            // line, while CommonMark renderers such as GitHub's drop it.
            if (/^[ \t]/.test(line)) failure = "line break in a code span before a space or tab";
            else words[words.length - 1] = `${last} `;
          } else if (joining === "description") {
            // Two spaces or a backslash before the line ending make a hard break.
            if (/(?: {2}|\\)$/.test(last)) failure = "hard line break";
            const trimmed = line.replace(/^[ \t]+/, "");
            lineAt += line.length - trimmed.length;
            line = trimmed;
            words[words.length - 1] = `${last.trimEnd()} `;
          } else failure = joining.reason;
        }
        words.push(...protection.split(line, lineAt));
        lineEnd = lineAt + line.length;
      }
      if (failure) {
        reportSkipped(failure);
        return;
      }
      const atoms = wrappingAtoms(words, openers);
      // A first word that would open a block alone on the first line keeps the
      // word after it there too.
      while (atoms.length > 1 && firstWordOpener.test(atoms[0]!))
        atoms.splice(0, 2, `${atoms[0]} ${atoms[1]}`);
      /** Fill lines greedily, with the first `first` atoms on the first line. */
      const fill = (first: number): string[] => {
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
      };
      let output = fill(1);
      // A paragraph that starts like a link reference definition becomes one
      // when a line ends after the definition's destination or title. Keep
      // words on the first line until the lines read as one paragraph again.
      if (output.length > 1 && atoms[0]!.startsWith("[") && definitionStart.test(atoms.join(" "))) {
        let first = atoms.findIndex((atom) => atom.includes("]:")) + 1;
        while (output.length > 1 && !oneParagraph(output.join("\n"), document.dialect))
          output = fill(++first);
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
    });
    return findings;
  },
};

const table: Rule = {
  description: "Align GFM table cells while preserving their inline source.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({}),
  check({ document }) {
    const findings: Finding[] = [];
    const newline = lineEnding(document.source);
    walk(document.tree, "table", (node) => {
      const [start, end] = range(node);
      // Nested tables retain container prefixes until a dedicated container printer handles them.
      if (node.position!.start.column !== 1) return;
      const rows = node.children.map((row) =>
        row.children.map((cell) => {
          if (!cell.children.length) return "";
          const first = range(cell.children[0]!)[0];
          const last = range(cell.children.at(-1)!)[1];
          return document.source.slice(first, last);
        }),
      );
      const count = node.align?.length ?? rows[0]?.length ?? 0;
      if (rows.some((row) => row.length > count)) return;
      const widths = Array.from({ length: count }, (_, i) =>
        Math.max(3, ...rows.map((row) => stringWidth(row[i] ?? ""))),
      );
      // Keep each row's own cell count: adding cells to a short row changes the parsed table.
      const rendered = rows.map(
        (row) =>
          `| ${row.map((cell, i) => cell + " ".repeat(widths[i]! - stringWidth(cell))).join(" | ")} |`,
      );
      rendered.splice(
        1,
        0,
        `| ${widths
          .map((width, i) => {
            const align = node.align?.[i];
            return (
              (align === "left" || align === "center" ? ":" : "-") +
              "-".repeat(width - 2) +
              (align === "right" || align === "center" ? ":" : "-")
            );
          })
          .join(" | ")} |`,
      );
      const replacement = rendered.join(newline);
      if (replacement !== document.source.slice(start, end))
        findings.push({
          start,
          end,
          message: "Align table cells.",
          edit: { start, end, text: replacement },
        });
    });
    return findings;
  },
};

/** A line holding nothing but block quote markers and blank space. */
const blankLine = /^[ \t>]*$/;
/**
 * A list item or quote marker followed by another list marker on its line,
 * including the ones that cannot open a list there, such as `* * *`.
 */
const nestedListStart = /^[ \t]*(?:[-+*]|\d{1,9}[.)]|>)[ \t>]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
/** The innermost last block of a container, where its text ends. */
function lastBlock(node: RootContent): RootContent {
  while (
    ["blockquote", "list", "listItem", "footnoteDefinition"].includes(node.type) &&
    "children" in node &&
    node.children.length
  )
    node = node.children.at(-1) as RootContent;
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
  // Front matter is not part of the document's text.
  if (["yaml", "toml"].includes(before.type)) return true;
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
    /^\[![\w-]+\]/.test(source.slice(beforeStart, beforeEnd))
  )
    return true;
  // Obsidian may attach a block identifier on its own line to the block above.
  if (
    document.dialect === "obsidian" &&
    after.type === "paragraph" &&
    /^\^[A-Za-z0-9-]+[ \t]*$/.test(source.slice(afterStart, afterEnd))
  )
    return true;
  // Directly below text or a link reference definition, the parser does not
  // start a list that would be empty or not start at 1, though it does below
  // a blank line: there, `- -` is a list item holding the text `-`, and `-`
  // underlined with `---` is a heading. Such a list could start on the first
  // line of a list or quote, and such a line could begin an underlined heading.
  if (!["paragraph", "definition"].includes(lastBlock(before).type)) return false;
  const firstLine = source.slice(afterStart, lineBounds(source, afterStart, afterStart)[1]);
  if (after.type === "heading") return !/^[ \t]*#/.test(firstLine);
  return (after.type === "list" || after.type === "blockquote") && nestedListStart.test(firstLine);
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

export const styleRules: Record<string, Rule> = {
  "style/wrap": wrap,
  "style/inline-code": {
    description: "Join multiline code spans using their CommonMark rendered value.",
    kind: "style",
    phase: "inline",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      const forge = goldmarkForges[document.dialect] !== undefined;
      let headingEnd = 0;
      walk(document.tree, (node) => {
        if (node.type === "heading" && forge) headingEnd = range(node)[1];
        if (node.type !== "inlineCode") return;
        const [start, end] = range(node);
        if (!/[\r\n]/.test(document.source.slice(start, end))) return;
        // Forgejo and Gitea look for a heading's attribute block on its last
        // text line, and Forgejo also builds the anchor from that line alone.
        // Joining lines would change what that line holds.
        if (start < headingEnd) return;
        if (document.dialect === "gitea" && giteaPyLine(document.source, start, end)) return;
        // Joining lines could put a `\(` and `\)` on one line and turn them into math.
        if (forge) {
          const lines = document.source.slice(...lineBounds(document.source, start, end));
          if (lines.includes("\\(") && lines.includes("\\)")) return;
        }
        const value = node.value.replace(/\r\n|\r|\n/g, " ");
        const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
        const marker = "`".repeat(longest + 1);
        const pad = /^`|`$/.test(value) || (/^ .* $/.test(value) && /[^ ]/.test(value)) ? " " : "";
        findings.push({
          start,
          end,
          message: "Join the code span onto one line.",
          edit: { start, end, text: `${marker}${pad}${value}${pad}${marker}` },
        });
      });
      return findings;
    },
  },
  "style/emphasis": markerRule("emphasis", "_"),
  "style/strong": markerRule("strong", "*"),
  "style/table": table,
  "style/final-newline": {
    description: "End nonempty documents with a newline.",
    kind: "style",
    phase: "document",
    schema: optionsSchema({}),
    check({ document: { source } }) {
      if (!source || /[\r\n]$/.test(source)) return [];
      return [
        {
          start: source.length,
          message: "Add a final newline.",
          edit: { start: source.length, end: source.length, text: lineEnding(source) },
        },
      ];
    },
  },
  "style/heading": {
    description: "Use ATX headings.",
    kind: "style",
    phase: "block",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      walk(document.tree, "heading", (node) => {
        const [start, end] = range(node);
        if (document.source[start] === "#" || node.position!.start.column !== 1) return;
        const first = node.children[0];
        const last = node.children.at(-1);
        if (!first || !last) return;
        let text = document.source.slice(range(first)[0], range(last)[1]);
        if (/[\r\n]/.test(text)) return;
        // A trailing run of # after whitespace would become an ATX closing
        // sequence and disappear from the heading; escape its first character.
        text = text.replace(/(^|\s)(#+)$/, "$1\\$2");
        // Forgejo and Gitea also take such a run for a closing sequence when
        // their attribute block follows it, and would drop it from the heading.
        const block = goldmarkForges[document.dialect] ? headingAttributeBlock(text) : undefined;
        if (block)
          text =
            text.slice(0, block.start).replace(/(^|\s)(#+)(\s*)$/, "$1\\$2$3") +
            text.slice(block.start);
        findings.push({
          start,
          end,
          message: "Use an ATX heading.",
          edit: { start, end, text: `${"#".repeat(node.depth)} ${text}` },
        });
      });
      return findings;
    },
  },
  "style/block-spacing": blockSpacing,
};

/** Collect source-positioned nodes for rule/plugin consumers. */
export function nodesOfType(
  document: { tree: import("mdast").Root },
  type: Nodes["type"],
): Nodes[] {
  const result: Nodes[] = [];
  walk(document.tree, (node) => {
    if (node.type === type) result.push(node);
  });
  return result;
}
