import { walk } from "../syntax/walk.js";
import type { Nodes, Root } from "mdast";
import type { Dialect, Document, Finding, Rule } from "../core/types.js";
import { parse, range } from "../syntax/parse.js";
import { changesForgeHeading } from "../workspace/heading-attributes.js";
import { escaped } from "../syntax/source.js";
import { inlineBlocks, located, type Range } from "./shared.js";
import { calloutTitles, goldmarkForges, inForgeMath, giteaPyLine } from "./protections.js";
import { optionsSchema } from "./shared.js";

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

/**
 * The paragraphs, headings, and table cells whose text holds a `*` or `_` that
 * is not a marker of emphasis, as in `snake_case` or `5 * 3`, unescaped and
 * outside code, math, and links' destinations. Obsidian's Reading view pairs
 * such a character with a later one, where CommonMark and Live Preview leave it
 * as text: `snake_case and _em_` shows `case and _em` as emphasis (issue #361).
 */
function blocksWithLooseMarkers(document: Document): Range[] {
  const { source } = document;
  const blocks: Range[] = [];
  walk(document.tree, (node) => {
    if (!inlineBlocks.has(node.type) || !located(node)) return;
    let found = false;
    walk(node, "text", (text) => {
      if (found || !located(text)) return;
      const [start, end] = range(text);
      for (let at = start; at < end && !found; at++)
        found = (source[at] === "*" || source[at] === "_") && !escaped(source, at);
    });
    if (found) blocks.push(range(node));
  });
  return blocks;
}

function markerRule(type: "emphasis" | "strong", fallback: string): Rule {
  return {
    description: `Choose ${type} delimiters without reprinting their contents.`,
    kind: "style",
    phase: "inline",
    schema: optionsSchema({ marker: { enum: ["*", "_", "consistent"] } }),
    check({ document, options }) {
      const findings: Finding[] = [];
      const { source } = document;
      const gfm = document.dialect !== "commonmark";
      const size = type === "strong" ? 2 : 1;
      const preference = (options.marker as string | undefined) ?? fallback;
      let selected: string | undefined;
      if (preference === "consistent") {
        // Pre-order traversal visits opening delimiters in source order. Even
        // protected or intraword nodes choose the document's marker; the guards
        // below still decide whether each later node can safely change.
        walk(document.tree, type, (node) => {
          selected ??= source[range(node)[0]];
        });
      }
      const marker = (selected ?? (preference === "consistent" ? fallback : preference)).repeat(
        size,
      );
      const labels = markerLabels(document.tree);
      const titles = calloutTitles(document);
      const loose = document.dialect === "obsidian" ? blocksWithLooseMarkers(document) : [];
      /** The ranges of the emphasis to change, by the scope that holds them. */
      const candidates = new Map<Nodes, Range[]>();
      eachInline(document.tree, type, (node, scope) => {
        const [start, end] = range(node);
        const original = source.slice(start, end);
        if (original.startsWith(marker)) return;
        // Obsidian's Reading view could pair a new marker with a `*` or `_`
        // that is text, or an old one that it paired with one, otherwise.
        if (loose.some(([a, b]) => start >= a && end <= b)) return;
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
        if (neighbours.includes(marker[0])) return;
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
export { markerRule };
