import { walk } from "../syntax/walk.js";
import stringWidth from "string-width";
import type { Blockquote, Nodes, Paragraph, Root, RootContent } from "mdast";
import { directive } from "../core/directives.js";
import type { Dialect, Document, Finding, Rule } from "../core/types.js";
import { blockIdentifier } from "../syntax/block-identifier.js";
import { range } from "../syntax/parse.js";
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
/** The blocks whose inline content the parser reads, and pairs delimiters in, as a whole. */
const inlineBlocks = new Set(["paragraph", "heading", "tableCell"]);
/** Whether the character at `index` is escaped by an odd number of backslashes before it. */
function escaped(source: string, index: number): boolean {
  let count = 0;
  while (source[index - count - 1] === "\\") count++;
  return count % 2 === 1;
}
/**
 * How micromark classifies a character next to a delimiter run: 1 for
 * whitespace and for the start or end of the text, 2 for punctuation and
 * symbols, and 0 for anything else. It looks at UTF-16 code units, so half of
 * a surrogate pair counts as anything else.
 */
function characterGroup(character: string | undefined): 0 | 1 | 2 {
  if (character === undefined || /\s/.test(character)) return 1;
  return /\p{P}|\p{S}/u.test(character) ? 2 : 0;
}
/** A run of `*` or `_` that micromark reads as one delimiter sequence. */
interface DelimiterRun {
  marker: string;
  /** The part of the run that has not paired yet. */
  start: number;
  end: number;
  open: boolean;
  close: boolean;
}
/**
 * The delimiter runs at `positions`, sorted, with the characters that `at`
 * gives. Whether a run can open or close follows micromark, which also lets a
 * run next to another `*` or `_`, or to a `~` in GFM, do both. Container
 * markers such as `>` count as punctuation here, while micromark sees the line
 * ending before them; the caller compares the result with the parse.
 */
function delimiterRuns(
  positions: number[],
  at: (index: number) => string | undefined,
  gfm: boolean,
): DelimiterRun[] {
  const runs: DelimiterRun[] = [];
  for (const position of positions) {
    const last = runs.at(-1);
    if (last && last.end === position && at(position) === last.marker) last.end++;
    else
      runs.push({
        marker: at(position)!,
        start: position,
        end: position + 1,
        open: false,
        close: false,
      });
  }
  const attention = (character: string | undefined) =>
    character === "*" || character === "_" || (gfm && character === "~");
  for (const run of runs) {
    const previous = at(run.start - 1);
    const next = at(run.end);
    const before = characterGroup(previous);
    const after = characterGroup(next);
    const open = after === 0 || (after === 2 && before !== 0) || attention(next);
    const close = before === 0 || (before === 2 && after !== 0) || attention(previous);
    run.open = run.marker === "*" ? open : open && (before !== 0 || !close);
    run.close = run.marker === "*" ? close : close && (after !== 0 || !open);
  }
  return runs;
}
/**
 * The emphasis and strong emphasis that micromark makes of `runs`, as
 * `start:end:size` strings: each closing run, in order, pairs with the nearest
 * opening run of its marker before it, except where the rule of three forbids
 * it, and the runs between them become text.
 */
function pairings(runs: DelimiterRun[]): string[] {
  const left = runs.map((run) => ({ ...run }));
  const pairs: string[] = [];
  for (let index = 0; index < left.length; index++) {
    const closer = left[index]!;
    while (closer.close && closer.end > closer.start) {
      const closeSize = closer.end - closer.start;
      let found = index - 1;
      for (; found >= 0; found--) {
        const opener = left[found]!;
        const openSize = opener.end - opener.start;
        if (!opener.open || !openSize || opener.marker !== closer.marker) continue;
        if ((opener.close || closer.open) && closeSize % 3 && !((openSize + closeSize) % 3))
          continue;
        break;
      }
      if (found < 0) break;
      const opener = left[found]!;
      const use = opener.end - opener.start > 1 && closeSize > 1 ? 2 : 1;
      opener.end -= use;
      closer.start += use;
      pairs.push(`${opener.end}:${closer.start}:${use}`);
      for (let between = found + 1; between < index; between++)
        left[between]!.end = left[between]!.start;
    }
  }
  return pairs.sort();
}
/**
 * The `*` and `_` characters that micromark reads as delimiters in the text of
 * `scope`, a block or a link whose text it pairs delimiters in on its own: the
 * markers of emphasis, and unescaped characters left as text. Also the
 * emphasis there, as `start:end:size` strings, and whether changing markers
 * could change how they pair: when a character left as text could open or
 * close emphasis, as in `*a _b* c_`, or when one run holds the markers of two
 * emphases, or a marker and text, as in `***a***` or `*****a***`.
 */
function scopeDelimiters(
  source: string,
  scope: Nodes,
): { positions: number[]; emphasis: string[]; suspicious: boolean } {
  const positions: number[] = [];
  const markers = new Set<string>();
  const emphasis: string[] = [];
  const literal = new Set<number>();
  const visit = (node: Nodes) => {
    if (node !== scope && (node.type === "link" || node.type === "linkReference")) return;
    if (node.type === "emphasis" || node.type === "strong") {
      const [a, b] = range(node);
      const size = node.type === "strong" ? 2 : 1;
      emphasis.push(`${a}:${b}:${size}`);
      markers.add(`${a}:${a + size}`).add(`${b - size}:${b}`);
      for (let i = 0; i < size; i++) positions.push(a + i, b - size + i);
    } else if (node.type === "text") {
      const [a, b] = range(node);
      for (let i = a; i < b; i++)
        if ((source[i] === "*" || source[i] === "_") && !escaped(source, i)) {
          positions.push(i);
          literal.add(i);
        }
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(scope);
  positions.sort((a, b) => a - b);
  const suspicious = delimiterRuns(positions, (index) => source[index], true).some((run) => {
    if (markers.has(`${run.start}:${run.end}`)) return false;
    for (let index = run.start; index < run.end; index++)
      if (literal.has(index)) return run.open || run.close;
    return true;
  });
  return { positions, emphasis: emphasis.sort(), suspicious };
}
/** A link label as CommonMark compares labels: whitespace collapsed and case folded. */
const normalizedLabel = (label: string) =>
  label
    .replace(/[\t\n\r ]+/g, " ")
    .trim()
    .toLowerCase()
    .toUpperCase();
/** The labels of the document's definitions and footnotes that hold `*` or `_`, normalized. */
function markerLabels(tree: Root): string[] {
  const labels: string[] = [];
  walk(tree, (node) => {
    if (
      (node.type === "definition" || node.type === "footnoteDefinition") &&
      node.label &&
      /[*_]/.test(node.label)
    )
      labels.push(normalizedLabel(node.label));
  });
  return labels;
}
/**
 * The first lines of the document's Obsidian callouts, which Obsidian reads
 * on their own as the callouts' titles, from the `[!` on.
 */
function calloutTitles(document: Document): Range[] {
  const titles: Range[] = [];
  if (document.dialect === "obsidian")
    walk(document.tree, "blockquote", (quote) => {
      const first = quote.children[0];
      if (first?.type !== "paragraph") return;
      const [start] = range(first);
      const end = lineBounds(document.source, start, start)[1];
      if (/^\[![\w-]+\]/.test(document.source.slice(start, end))) titles.push([start, end]);
    });
  return titles;
}
/**
 * Visit the nodes of `type` with their scope: the innermost link, whose text
 * micromark pairs delimiters in on its own, or else the block that holds them.
 */
function eachInline<T extends "emphasis" | "strong">(
  tree: Root,
  type: T,
  visitor: (node: Extract<Nodes, { type: T }>, scope: Nodes) => void,
): void {
  const step = (node: Nodes, scope: Nodes) => {
    if (inlineBlocks.has(node.type) || node.type === "link" || node.type === "linkReference")
      scope = node;
    if (node.type === type) visitor(node as Extract<Nodes, { type: T }>, scope);
    if ("children" in node) for (const child of node.children) step(child, scope);
  };
  step(tree, tree);
}
function markerRule(type: "emphasis" | "strong", fallback: string): Rule {
  return {
    description: `Choose ${type} delimiters without reprinting their contents.`,
    kind: "style",
    phase: "inline",
    schema: optionsSchema({ marker: { enum: ["*", "_"] } }),
    check({ document, options }) {
      const findings: Finding[] = [];
      const { source } = document;
      const gfm = document.dialect !== "commonmark";
      const size = type === "strong" ? 2 : 1;
      const marker = String(options.marker ?? fallback).repeat(size);
      const labels = markerLabels(document.tree);
      const titles = calloutTitles(document);
      /** The ranges of the emphasis to change, by the scope that holds them. */
      const candidates = new Map<Nodes, Range[]>();
      eachInline(document.tree, type, (node, scope) => {
        const [start, end] = range(node);
        const original = source.slice(start, end);
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
        // GitHub, Forgejo, and Gitea end dollar math only at dollars that no
        // `_` follows, so a marker after a `$` can decide where math ends.
        if (
          gfm &&
          document.dialect !== "obsidian" &&
          (source[start - 1] === "$" || source[end - size - 1] === "$")
        )
          return;
        // Emphasis that begins in an Obsidian callout's title and ends below it
        // is text in the title, whose markers would change.
        if (
          titles.length &&
          /[\r\n]/.test(original) &&
          titles.some(([a, b]) => start >= a && start < b && end > b)
        )
          return;
        // The text of a collapsed or shortcut reference, such as `[*Title*][]`
        // or `[*Title*]`, is also its label, which would no longer match the
        // definition's.
        if (scope.type === "linkReference" && scope.referenceType !== "full") return;
        // Text in brackets that would match a definition with the new markers
        // would become a reference.
        if (labels.length) {
          const rewritten = normalizedLabel(marker + original.slice(size, -size) + marker);
          if (labels.some((label) => label.includes(rewritten))) return;
        }
        // micromark lets a run next to a `~` open and close, so a new marker
        // that a `~` separates from another `*` or `_` like it could pair with it.
        const reaches = (index: number, step: number) => {
          while (source[index] === "~") index += step;
          return source[index] === marker[0];
        };
        if (
          gfm &&
          (reaches(start - 1, -1) ||
            reaches(end, 1) ||
            reaches(start + size, 1) ||
            reaches(end - size - 1, -1))
        )
          return;
        const list = candidates.get(scope) ?? [];
        list.push([start, end]);
        candidates.set(scope, list);
      });
      /** The positions of the markers of the emphasis in `ranges`. */
      const markers = (ranges: Range[]) => {
        const set = new Set<number>();
        for (const [start, end] of ranges)
          for (let i = 0; i < size; i++) set.add(start + i).add(end - size + i);
        return set;
      };
      for (const [scope, list] of candidates) {
        let accepted = list;
        // The parser's pairing of delimiter runs is modelled, and the markers
        // change where the model, which has to reproduce the parse, pairs the
        // same runs with the new markers: all of them, or else those that can
        // be added one at a time. Where the model cannot be used, markers
        // change only when no run could pair differently, which it could when
        // a `*` or `_` in the same text did not pair, or when two emphases
        // share a run of markers, as in `***a***` or `*a****c***`.
        const { positions, emphasis, suspicious } = scopeDelimiters(source, scope);
        const expected = emphasis.join(" ");
        const pairing = (changed: Set<number>) =>
          pairings(
            delimiterRuns(positions, (at) => (changed.has(at) ? marker[0] : source[at]), gfm),
          ).join(" ");
        // micromark pairs `~` in a pass of its own, which can come first, and
        // lets a run next to a `~` pair with one of the new marker, as in `_f~*a*e_`.
        const tilde = gfm && source.slice(...range(scope)).includes("~");
        const modelled = !tilde && positions.length <= 500 && pairing(new Set()) === expected;
        if (!modelled)
          accepted =
            suspicious || (tilde && positions.some((at) => source[at] === marker[0])) ? [] : list;
        else if (pairing(markers(list)) !== expected) {
          accepted = [];
          let changed = new Set<number>();
          for (const item of list) {
            const trial = new Set([...changed, ...markers([item])]);
            if (pairing(trial) !== expected) continue;
            changed = trial;
            accepted.push(item);
          }
        }
        for (const [start, end] of accepted)
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
      }
      return findings.sort((a, b) => a.start - b.start);
    },
  };
}

// Whitespace inside an inline node is protected; only text-node whitespace can wrap.
function wrappingAtoms(words: string[], extraOpener?: RegExp): string[] {
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
    if (lineOpener.test(atoms[i]!) || extraOpener?.test(atoms[i]!)) {
      atoms.splice(i - 1, 2, `${atoms[i - 1]} ${atoms[i]}`);
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
// List markers, ATX and Setext heading markers, block quotes, thematic breaks,
// fences, math, Obsidian comments, HTML blocks, and footnote definitions.
const lineOpener =
  /^(?:[-+*]|\d+[.)]|#{1,6}|>|[-*_]{3,}|-{2,}|=+|~{3,}|`{3,}|\$\$|%%|<[!?/A-Za-z]|\[\^[^\]]+\]:)/;
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
/** Split text at source whitespace, except inside protected source ranges. */
function splitWords(text: string, base: number, ranges: Range[]): string[] {
  if (!ranges.length) return text.split(/([ \t]+)/).filter(Boolean);
  const words: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/[ \t]+/g)) {
    const at = base + match.index;
    if (ranges.some(([from, to]) => at > from && at < to)) continue;
    if (match.index > cursor) words.push(text.slice(cursor, match.index));
    words.push(match[0]);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) words.push(text.slice(cursor));
  return words;
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
      let calloutHeader =
        document.dialect === "obsidian" &&
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
          if (options.reportUnbreakable === true && measure(prefix + header) > width)
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
      const extraOpener = forge ? forgeLineOpener : undefined;
      let protectedRanges: Range[] = [];
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
        let childIndex = 0;
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
            if (measure(prefix + content) > width) unbreakable = true;
            offset += line.length;
            continue;
          }
          const words: string[] = [];
          while (childIndex < children.length && range(children[childIndex]!)[1] <= offset)
            childIndex++;
          for (let i = childIndex; i < children.length; i++) {
            const child = children[i]!;
            const [a, b] = range(child);
            if (a >= offset + content.length) break;
            if (child.type === "break") continue;
            const from = Math.max(a, offset + container.length);
            const raw = document.source.slice(from, Math.min(b, offset + content.length));
            if (!raw) continue;
            words.push(...(child.type === "text" ? splitWords(raw, from, protectedRanges) : [raw]));
          }
          const atoms = wrappingAtoms(words, extraOpener);
          const available = width - measure(linePrefix);
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
      const reason = children.some((child) => child.type === "break")
        ? "hard line break"
        : children.some((child) => child.type === "html")
          ? "inline HTML"
          : /^\[![^\]]+\]/.test(original)
            ? "callout header"
            : blockIdentifier(document.source, node)
              ? "block identifier"
              : leadingMarker.test(original) || (forge && /^:(?:\r|\n)/.test(original))
                ? "leading block marker"
                : lazyStart
                  ? "lazy first line"
                  : !/^[\s>\-*+\d.[\]xX)]*$/.test(prefix)
                    ? "unsupported container prefix"
                    : document.dialect === "obsidian" &&
                        obsidianMarkers(document.source, node, start, end)
                      ? "Obsidian `==`, `[[`, or `]]` outside highlights and links"
                      : undefined;
      // Protections are computed first so that skipped paragraphs still
      // classify one-line math and shortlinks as single atoms in diagnostics.
      const protections = forge
        ? forgeProtections(document.source, start, end, forge)
        : { ranges: [] as Range[] };
      protectedRanges = protections.ranges;
      const skipped =
        reason ??
        protections.reason ??
        (document.dialect === "gitea" && giteaPyParagraph(document.source, node, start, end)
          ? "Gitea `_.py` emphasis exception"
          : undefined);
      if (skipped) {
        reportSkipped(skipped);
        return;
      }
      const words: string[] = [];
      let unsupported = false;
      for (const child of children) {
        const [a, b] = range(child);
        const from = Math.max(a, start);
        const raw = document.source.slice(from, b);
        // Odd pieces are the line breaks, so each line's source offset is known.
        const pieces = raw.split(/(\r\n|\r|\n)/);
        const lines: string[] = [];
        let at = from;
        for (let i = 0; i < pieces.length; i += 2) {
          let line = pieces[i]!;
          let lineAt = at;
          at += line.length + (pieces[i + 1]?.length ?? 0);
          if (i > 0 && continuation && line.startsWith(continuation)) {
            line = line.slice(continuation.length);
            lineAt += continuation.length;
          } else if (i > 0 && continuation && /^[\s>]/.test(line)) unsupported = true;
          if (child.type !== "text") {
            lines.push(line);
            continue;
          }
          // Preserve escaping and entities. Split only ordinary source whitespace.
          if (i > 0) words.push(" ");
          words.push(...splitWords(line, lineAt, protectedRanges));
        }
        if (child.type !== "text") {
          if (/[\r\n]/.test(raw)) unsupported = true;
          words.push(lines.join(" "));
        }
      }
      if (unsupported) {
        reportSkipped("multiline inline syntax or unsupported continuation");
        return;
      }
      const atoms = wrappingAtoms(words, extraOpener);
      const output: string[] = [];
      let line = "";
      let available = width - measure(prefix);
      for (const atom of atoms) {
        const candidate = line ? `${line} ${atom}` : atom;
        if (line && measure(candidate) > available) {
          output.push(line);
          line = atom;
          available = width - measure(continuation);
        } else line = candidate;
      }
      if (line) output.push(line);
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
        (prefix + replacement).split(lineBreak).some((line) => measure(line) > width)
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
  const alone = document.dialect === "obsidian" ? blockIdentifier(source, after) : undefined;
  if (alone && source.slice(afterStart, afterEnd).trimEnd() === `^${alone.id}`) return true;
  // Directly below a table that ends inside a list or block quote, the parser
  // reads the next table as a paragraph, or as the text of a heading
  // underlined below it, while GitHub reads a table, and a blank line would
  // make it a table there as well. Text whose second line holds a `|` could be
  // such a table.
  if (
    lastBlock(before).type === "table" &&
    (after.type === "paragraph" || after.type === "heading") &&
    source.slice(afterStart, afterEnd).split(lineBreak)[1]?.includes("|")
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
      const { source } = document;
      const forge = goldmarkForges[document.dialect] !== undefined;
      // In Obsidian, the inline nodes whose source joined lines cannot change.
      const opaque: Range[] = [];
      if (document.dialect === "obsidian")
        walk(document.tree, (node) => {
          if (obsidianOpaque.has(node.type) || node.type === "obsidianComment")
            opaque.push(range(node));
        });
      const titles = calloutTitles(document);
      let headingEnd = 0;
      let blockStart = 0;
      walk(document.tree, (node) => {
        if (node.type === "heading" && forge) headingEnd = range(node)[1];
        if (inlineBlocks.has(node.type)) blockStart = range(node)[0];
        if (node.type !== "inlineCode") return;
        const [start, end] = range(node);
        if (!/[\r\n]/.test(source.slice(start, end))) return;
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
        if (document.dialect === "obsidian") {
          // Joining would move text into a callout's title.
          if (titles.some(([a, b]) => start >= a && start < b)) return;
          // Obsidian reads highlights and wikilinks only within a line. Once
          // the lines are one, an `==` or `[[` left as text could open one that
          // runs to the next `==` or `]]`, even inside this or another span.
          const [from, to] = lineBounds(source, start, end);
          const lines = source.slice(from, to);
          let text = "";
          let cursor = from;
          for (const [a, b] of opaque) {
            if (b <= cursor || a >= to) continue;
            // A space keeps the text on both sides from forming a marker.
            text += source.slice(cursor, Math.max(cursor, a)) + " ";
            cursor = Math.min(b, to);
          }
          text += source.slice(cursor, to);
          if (
            (text.includes("==") && (lines.match(/==/g) ?? []).length > 1) ||
            (text.includes("[[") && lines.includes("]]"))
          )
            return;
        }
        const value = node.value.replace(/\r\n|\r|\n/g, " ");
        const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
        const marker = "`".repeat(longest + 1);
        // An earlier run of the new backticks that the parser left as text, or
        // that lies in a link destination, would pair with the new opening one.
        // The span's own backticks cannot have such a run before them.
        if (marker.length !== /^`+/.exec(source.slice(start, end))![0].length) {
          const before = source.slice(blockStart, start);
          for (const run of before.matchAll(/`+/g)) {
            const length = run[0].length;
            if (
              length === marker.length ||
              (escaped(before, run.index) && length - 1 === marker.length)
            )
              return;
          }
        }
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
