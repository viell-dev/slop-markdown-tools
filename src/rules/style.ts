import { walk } from "../syntax/walk.js";
import stringWidth from "string-width";
import type { Blockquote, Nodes, Paragraph, Parents, Root, RootContent } from "mdast";
import { directive } from "../core/directives.js";
import type { Dialect, Document, Finding, Rule } from "../core/types.js";
import { blockIdentifier } from "../syntax/block-identifier.js";
import {
  codeSpanText,
  joinsTomlFrontMatter,
  labelEnd,
  lazyIndentation,
  parse,
  range,
  startsWithMarker,
} from "../syntax/parse.js";
import { changesForgeHeading, headingAttributeBlock } from "../workspace/heading-attributes.js";
import { takesFinalLineEnding, takesLines, underlinedHeadings, underlineEdit } from "./blocks.js";

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
 * Where a document's line breaks are, and where the strings that rules look
 * for on a line occur, all sorted. Rules ask about the line of every emphasis
 * or code span; searching the line itself each time took time that grows with
 * the square of a long line's length.
 */
interface LineIndex {
  breaks: number[];
  found: Map<string, number[]>;
}
const lineIndexes = new WeakMap<Document, LineIndex>();
function lineIndex(document: Document): LineIndex {
  let index = lineIndexes.get(document);
  if (!index) {
    const breaks: number[] = [];
    for (let at = 0; at < document.source.length; at++)
      if (document.source[at] === "\r" || document.source[at] === "\n") breaks.push(at);
    lineIndexes.set(document, (index = { breaks, found: new Map() }));
  }
  return index;
}
/** The number of values in the sorted `values` that are less than `limit`. */
function countBelow(values: number[], limit: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle]! < limit) low = middle + 1;
    else high = middle;
  }
  return low;
}
/** `lineBounds` for a document, from its line index. */
function indexedLineBounds(document: Document, start: number, end: number): [number, number] {
  const { breaks } = lineIndex(document);
  const before = countBelow(breaks, start);
  const after = countBelow(breaks, end);
  return [before ? breaks[before - 1]! + 1 : 0, breaks[after] ?? document.source.length];
}
/**
 * Where `text` occurs in the document between `from` and `to`, wholly: the
 * last occurrence, or -1 for none.
 */
function lastWithin(document: Document, text: string, from: number, to: number): number {
  const { found } = lineIndex(document);
  let positions = found.get(text);
  if (!positions) {
    positions = [];
    for (
      let at = document.source.indexOf(text);
      at >= 0;
      at = document.source.indexOf(text, at + 1)
    )
      positions.push(at);
    found.set(text, positions);
  }
  const last = positions[countBelow(positions, to - text.length + 1) - 1];
  return last !== undefined && last >= from ? last : -1;
}
/**
 * Gitea does not parse a `_` run as an emphasis delimiter when the next `_` on
 * its physical line starts `_.py`, or when the run itself does and no `_`
 * follows, so `__init__.py` stays literal. The outcome depends on everything
 * else on the line, code spans included: a line containing `_.py` before or
 * after an edit can gain or lose emphasis when markers change or lines join.
 */
export function giteaPyLine(document: Document, start: number, end: number): boolean {
  return lastWithin(document, "_.py", ...indexedLineBounds(document, start, end)) >= 0;
}
/** Forgejo and its upstream Gitea build on goldmark with shared extensions. */
const goldmarkForges: Partial<Record<Dialect, string>> = { forgejo: "Forgejo", gitea: "Gitea" };
/**
 * Whether a range lies between `\(` and `\)` on its line, which Forgejo, and
 * Gitea where enabled, render as math. GFM parses emphasis and code spans
 * there, and changing them would change the formula.
 */
export function inForgeMath(document: Document, start: number, end: number): boolean {
  const [lineStart, lineEnd] = indexedLineBounds(document, start, end);
  return (
    lastWithin(document, "\\(", lineStart, start) > lastWithin(document, "\\)", lineStart, start) &&
    lastWithin(document, "\\)", end, lineEnd) >= 0
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
 * Whether the installed micromark lets a run of `*` or `_` next to the other
 * marker open and close whatever else surrounds it, as
 * micromark-core-commonmark did before 2.0.4. It is read from the parse of
 * `*_c_*a`, whose last `*` then closes emphasis.
 */
let markersLoosen: boolean | undefined;
function markersLoosenRuns(): boolean {
  markersLoosen ??= parse("*_c_*a", "commonmark").tree.children.some(
    (block) => block.type === "paragraph" && block.children[0]?.type === "emphasis",
  );
  return markersLoosen;
}
/**
 * The delimiter runs at `positions`, sorted, with the characters that `at`
 * gives. Whether a run can open or close follows micromark, which also lets a
 * run next to a `~` in GFM do both, and in some versions one next to another
 * `*` or `_`; with `commonmark`, it follows CommonMark, where those characters
 * are punctuation. Container markers such as `>` count as punctuation here,
 * while micromark sees the line ending before them; the caller compares the
 * result with the parse.
 */
function delimiterRuns(
  positions: number[],
  at: (index: number) => string | undefined,
  gfm: boolean,
  commonmark = false,
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
  const loosen = !commonmark && markersLoosenRuns();
  const attention = (character: string | undefined) =>
    (!commonmark && gfm && character === "~") ||
    (loosen && (character === "*" || character === "_"));
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
 * it, and the runs between them become text. micromark applies the rule to the
 * parts of two runs that are left; with `whole`, it counts the whole runs, as
 * CommonMark, GitHub, and the reference parsers do (issue #323).
 */
function pairings(runs: DelimiterRun[], whole = false): string[] {
  const left = runs.map((run) => ({ ...run, size: run.end - run.start }));
  const pairs: string[] = [];
  for (let index = 0; index < left.length; index++) {
    const closer = left[index]!;
    while (closer.close && closer.end > closer.start) {
      const closeSize = whole ? closer.size : closer.end - closer.start;
      let found = index - 1;
      for (; found >= 0; found--) {
        const opener = left[found]!;
        if (!opener.open || opener.end === opener.start || opener.marker !== closer.marker)
          continue;
        const openSize = whole ? opener.size : opener.end - opener.start;
        if ((opener.close || closer.open) && closeSize % 3 && !((openSize + closeSize) % 3))
          continue;
        break;
      }
      if (found < 0) break;
      const opener = left[found]!;
      const use = opener.end - opener.start > 1 && closer.end - closer.start > 1 ? 2 : 1;
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
 * The first lines of the document's Obsidian callouts and GitHub, Forgejo, or
 * Gitea alerts, from the marker on, which hold an Obsidian callout's title and
 * an alert's marker on its own.
 */
function calloutTitles(document: Document): Range[] {
  const titles: Range[] = [];
  if (document.dialect !== "commonmark")
    walk(document.tree, "blockquote", (quote) => {
      const first = quote.children[0];
      if (first?.type !== "paragraph") return;
      const [start] = range(first);
      const end = lineBounds(document.source, start, start)[1];
      if (startsWithMarker(document.source.slice(start, end), first)) titles.push([start, end]);
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
/**
 * Whether the text in `node`, outside code and other literal nodes, holds an
 * unescaped run of tildes that could mark strikethrough in `dialect`, one or
 * two tildes or in Obsidian two, while `scope`, where such runs pair, holds
 * another.
 */
function holdsStrikethroughRun(
  node: Nodes,
  scope: Nodes,
  source: string,
  dialect: Dialect,
): boolean {
  const pattern = dialect === "obsidian" ? "(?<![\\\\~])~~(?!~)" : "(?<![\\\\~])~{1,2}(?!~)";
  const runs = located(scope) ? source.slice(...range(scope)).match(new RegExp(pattern, "g")) : [];
  if (located(scope) && (runs?.length ?? 0) < 2) return false;
  const run = new RegExp(pattern);
  let found = false;
  walk(node, "text", (text) => {
    if (!found && located(text) && run.test(source.slice(...range(text)))) found = true;
  });
  return found;
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
        if (goldmarkForges[document.dialect] && inForgeMath(document, start, end)) return;
        // Forgejo, and Gitea before 1.26, build a heading's anchor from its last
        // line as written, keeping `_` and dropping `*`, and both read a trailing
        // `{...}` block as attributes before they parse emphasis.
        if (changesForgeHeading(document, start, end)) return;
        if (
          document.dialect === "gitea" &&
          (giteaPyLine(document, start, end) ||
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
        // Emphasis that begins on the line of a callout's or alert's marker
        // and ends below it is text on that line, whose markers would change.
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
        // micromark pairs emphasis and strikethrough in separate passes, in the
        // order that their first delimiters appear in the paragraph, while
        // GitHub pairs whichever closes first. So emphasis whose text holds a
        // run of tildes that could mark strikethrough may be strikethrough and
        // text there, and its markers what GitHub shows (issue #320).
        if (gfm && holdsStrikethroughRun(node, scope, source, document.dialect)) return;
        // GitHub reads a `_` that a run of tildes separates from a letter or
        // digit as inside a word, where it neither opens nor closes, while the
        // parser reads emphasis there (issue #322).
        const tildesToWord = (index: number, step: number) => {
          if (source[index] !== "~") return false;
          while (source[index] === "~") index += step;
          return /[\p{L}\p{N}]/u.test(source[index] ?? "");
        };
        if (
          gfm &&
          (marker[0] === "_" || original[0] === "_") &&
          (tildesToWord(start - 1, -1) || tildesToWord(end, 1))
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
        // micromark's pairing, or with `commonmark` CommonMark's.
        const pairing = (changed: Set<number>, commonmark = false) =>
          pairings(
            delimiterRuns(
              positions,
              (at) => (changed.has(at) ? marker[0] : source[at]),
              gfm,
              commonmark,
            ),
            commonmark,
          ).join(" ");
        // Both micromark's pairing and CommonMark's, which renderers follow,
        // have to stay the same with the new markers.
        const kept = (changed: Set<number>) =>
          pairing(changed) === expected && pairing(changed, true) === expected;
        // micromark pairs `~` in a pass of its own, which can come first, and
        // lets a run next to a `~` pair with one of the new marker, as in `_f~*a*e_`.
        const tilde = gfm && source.slice(...range(scope)).includes("~");
        const modelled = !tilde && positions.length <= 500 && pairing(new Set()) === expected;
        if (!modelled)
          accepted =
            suspicious || (tilde && positions.some((at) => source[at] === marker[0])) ? [] : list;
        // Where CommonMark pairs the text as written differently, the parser
        // misread it, and renderers show other emphasis (issue #323).
        else if (pairing(new Set(), true) !== expected) accepted = [];
        else if (!kept(markers(list))) {
          accepted = [];
          let changed = new Set<number>();
          for (const item of list) {
            const trial = new Set([...changed, ...markers([item])]);
            if (!kept(trial)) continue;
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
/** A GFM table's delimiter row, such as `| --- | :-: |`, after any container markers. */
const delimiterRow = /^[ \t>]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/**
 * Whether text that the parser read as a paragraph or a heading's text has a
 * table delimiter row as its second line. GitHub reads a table there, and so
 * does the parser, except directly below a table that ends in a list item or
 * block quote, where it reads the lines as text (issue #283). Joining the lines
 * or adding a blank line above them would change what GitHub or the parser
 * reads.
 */
function misreadTable(text: string): boolean {
  const second = text.split(lineBreak, 2)[1];
  return second !== undefined && second.includes("|") && delimiterRow.test(second);
}
// Forgejo and Gitea additionally open display math with `\[` and definition
// descriptions with `:` followed by at least one space or tab, so only a bare
// `:` atom could open one at the start of a reflowed line.
const forgeLineOpener = /^(?::$|\\\[)/;
/**
 * Site-generator syntax at the start of a line: a container such as
 * Docusaurus's `:::note`, or a template tag such as Liquid's `{% tab %}` or
 * `{{ title }}`. Site generators read it by line, and no dialect gives it
 * meaning, so a paragraph with a line that starts with it keeps its lines, and
 * a word that starts with it stays on the line before it (issue #296).
 */
const siteSyntax = /^(?::::|\{%|\{\{)/;
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
 * whitespace inside it significant. With `wholeLinks`, the text of a link is
 * kept whole as an image's description is: Obsidian's Live Preview shows a
 * link whose text spans lines as Markdown source (issue #306).
 */
function inlineAtoms(
  paragraph: Paragraph,
  start: number,
  wholeLinks: boolean,
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
          belowHeader = true;
        }
      }
      const openers = [wordOpener, prefixOpener, siteSyntax];
      if (document.dialect !== "commonmark") openers.push(delimiterRowWord);
      if (forge) openers.push(forgeLineOpener);
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
              end: (atom: string) =>
                dollarEnd.test(atom) && !maths.some((math) => atom.endsWith(math)),
            }
          : {}),
      };
      const inline = inlineAtoms(node, start, document.dialect === "obsidian");
      const protection = new Protection(start, end);
      for (const atom of inline.atoms) protection.add(atom.from, atom.to);
      // Forgejo and Gitea protections apply before paragraphs are skipped, so
      // that diagnostics still count one-line math and shortlinks as atoms.
      const protections = forge
        ? forgeProtections(source, start, end, forge)
        : { ranges: [] as Range[] };
      for (const [from, to] of protections.ranges) protection.add(from, to);
      for (const [from, to] of templateTags(source.slice(start, end), start))
        protection.add(from, to);
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
                  : startsSiteSyntax(original)
                    ? "site-generator syntax at the start of a line"
                    : lazyStart
                      ? "lazy first line"
                      : !/^[\s>\-*+\d.[\]xX)]*$/.test(prefix)
                        ? "unsupported container prefix"
                        : document.dialect === "obsidian" &&
                            obsidianMarkers(source, node, start, end)
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
          let joining = protection.has(lineEnd)
            ? (atomAt(inline.atoms, lineEnd)?.joining ?? { reason: "line break in inline syntax" })
            : undefined;
          if (joining && typeof joining === "object" && "within" in joining)
            joining = atomAt(joining.within, lineEnd)?.joining ?? "description";
          if (!joining) words.push(" ");
          else if (last === undefined || /^[ \t]+$/.test(last))
            failure = "line break in inline syntax";
          else if (joining === "code" || joining === "description") {
            // In an image description, two spaces or a backslash before the
            // line ending make a hard break, and other spaces collapse; in a
            // code span, the spaces before it are code. The spaces and tabs
            // after it go, as `codeSpanText` reads the span, also the
            // indentation below a task item's checkbox, which the parser
            // keeps. A lazy line, which keeps them, is not supported above.
            if (joining === "description" && /(?: {2}|\\)$/.test(last)) failure = "hard line break";
            const trimmed = line.replace(/^[ \t]+/, "");
            lineAt += line.length - trimmed.length;
            line = trimmed;
            words[words.length - 1] = `${joining === "code" ? last : last.trimEnd()} `;
          } else failure = "reason" in joining ? joining.reason : "line break in inline syntax";
        }
        words.push(...protection.split(line, lineAt));
        lineEnd = lineAt + line.length;
      }
      if (failure) {
        reportSkipped(failure);
        return;
      }
      const atoms = wrappingAtoms(words, openers, dollars);
      if (!atoms.length) return;
      // The first line keeps the words after a first word that would open a
      // block alone on the line, until the line can no longer open one, and
      // below an alert's or callout's marker line, after a run of `=` or `-`
      // that would underline that line as a heading.
      while (
        atoms.length > 1 &&
        (firstWordAlone.test(atoms[0]!) ||
          (belowHeader && /^(?:=+|-+)$/.test(atoms[0]!)) ||
          (fenceStart.test(atoms[0]!) && !oneParagraph(atoms[0]!, document.dialect)))
      )
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
  description: "Align or compact GFM table cells while preserving their inline source.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({ style: { enum: ["aligned", "compact"] } }),
  check({ document, options }) {
    const findings: Finding[] = [];
    // A compact table has one space around each cell and the shortest delimiters.
    const compact = options.style === "compact";
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
        compact ? 3 : Math.max(3, ...rows.map((row) => stringWidth(row[i] ?? ""))),
      );
      const pad = (cell: string, i: number) =>
        compact ? cell : cell + " ".repeat(widths[i]! - stringWidth(cell));
      // Keep each row's own cell count: adding cells to a short row changes the parsed table.
      const rendered = rows.map((row) => `| ${row.map(pad).join(" | ")} |`);
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
          message: compact ? "Write the table compactly." : "Align table cells.",
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
  // An unclosed HTML comment or block at the end of a list would take in the blank line.
  if (takesLines(before)) return true;
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
        // Joining keeps the spaces and tabs that start a lazy continuation line,
        // as GitHub shows them; commonmark.js drops them, and the other
        // dialects' renderers were not observed there.
        if (document.dialect !== "github" && lazyIndentation(node)) return;
        if (document.dialect === "gitea" && giteaPyLine(document, start, end)) return;
        // Joining lines could put a `\(` and `\)` on one line and turn them into math.
        if (forge) {
          const lines = document.source.slice(...lineBounds(document.source, start, end));
          if (lines.includes("\\(") && lines.includes("\\)")) return;
        }
        // Joining would move text onto the line of a callout's or alert's
        // marker, which holds an Obsidian callout's title.
        if (titles.some(([a, b]) => start >= a && start < b)) return;
        if (document.dialect === "obsidian") {
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
        // The joined span holds the text that GitHub shows. A space at each end
        // keeps a backtick there from joining the fence, or spaces there from
        // being taken off.
        const value = codeSpanText(node);
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
    check({ document }) {
      const { source } = document;
      // An unclosed block at the end, such as an HTML comment, would take in the line ending.
      if (!source || /[\r\n]$/.test(source) || takesFinalLineEnding(document)) return [];
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
    description: "Use ATX or Setext headings, without closing sequences.",
    kind: "style",
    phase: "block",
    schema: optionsSchema({
      style: { enum: ["atx", "setext", "consistent"] },
      closing: { enum: ["remove", "keep"] },
    }),
    check({ document, options }) {
      const findings: Finding[] = [];
      const { source } = document;
      // Only levels 1 and 2 can be underlined; deeper headings keep their `#`.
      const underlined = underlinedHeadings(document, options.style);
      walk(document.tree, "heading", (node) => {
        const [headingStart, end] = range(node);
        const first = node.children[0];
        const last = node.children.at(-1);
        // An ATX heading is one line, a Setext heading also has its underline.
        if (!/[\r\n]/.test(source.slice(headingStart, end))) {
          const edit = underlined ? underlineEdit(document, node) : undefined;
          if (edit) {
            findings.push({
              start: edit.start,
              end: edit.end,
              message: "Use an underlined heading.",
              edit,
            });
            return;
          }
          if (options.closing === "keep") return;
          const textEnd = last
            ? range(last)[1]
            : headingStart + /^#*/.exec(source.slice(headingStart))![0].length;
          const lineEnd = lineBounds(source, textEnd, textEnd)[1];
          if (!/^[ \t]+#+[ \t]*$/.test(source.slice(textEnd, lineEnd))) return;
          // Gitea before 1.26 reads an attribute block that a closing sequence
          // follows, and Forgejo and later Gitea versions do not.
          if (
            goldmarkForges[document.dialect] &&
            first &&
            headingAttributeBlock(source.slice(range(first)[0], textEnd))
          )
            return;
          findings.push({
            start: textEnd,
            end: lineEnd,
            message: "Remove the closing # sequence.",
            edit: { start: textEnd, end: lineEnd, text: "" },
          });
          return;
        }
        if (underlined || !first || !last) return;
        // Renderers without TOML front matter read its lines as part of a
        // heading underlined directly below it (issue #333).
        if (joinsTomlFrontMatter(document.tree, node)) return;
        // Below link reference definitions, the heading's position starts at
        // the first definition; its own text starts on a later line. Headings
        // that are indented or inside lists or block quotes are left as written.
        const start = range(first)[0];
        if (lineBounds(source, start, start)[0] !== start) return;
        let text = source.slice(start, range(last)[1]);
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
