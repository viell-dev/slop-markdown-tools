import type { Nodes, Root } from "mdast";
import type { Document, Edit, Finding, Rule } from "../core/types.js";
import { protectedEdit } from "../core/protection-edits.js";
import { codeSpanContent, codeSpanText, labelEnd, range, reread } from "../syntax/parse.js";
import { countBelow, escaped, lineEnd, lineStarts } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { giteaPyLine, goldmarkForges, inForgeMath } from "./protections.js";
import { inlineBlocks, optionsSchema } from "./shared.js";

/** A run of `*` or `_` that the parser left as text, on its physical line. */
interface Run {
  start: number;
  end: number;
  line: number;
  /**
   * Whether the run lies in the label of a collapsed or shortcut reference,
   * which names the definition that the reference uses.
   */
  label: boolean;
}

/** HTML elements without an end tag. */
const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
/**
 * The runs of `*` and `_` in an inline block that the parser read as text:
 * whole runs, none of whose characters it paired or a backslash escapes, and
 * none in an autolink or in the content of an inline HTML element such as
 * `<code>` or `<kbd>`, which readers take for literal text even where
 * renderers read Markdown inside it. Also where the block's other inline
 * nodes, such as code spans and links, start and end.
 */
function textRuns(document: Document, block: Nodes, starts: number[]) {
  const { source } = document;
  const runs: Run[] = [];
  const nodeStarts = new Set<number>();
  const nodeEnds = new Set<number>();
  const elements: string[] = [];
  let autolinkEnd = -1;
  let labelEnd = -1;
  walk(block, (node) => {
    if (node !== block && node.type !== "text") {
      nodeStarts.add(range(node)[0]);
      nodeEnds.add(range(node)[1]);
    }
    if (
      (node.type === "linkReference" || node.type === "imageReference") &&
      node.referenceType !== "full"
    )
      labelEnd = range(node)[1];
    if (node.type === "html") {
      const close = /^<\/([A-Za-z][\w-]*)\s*>$/.exec(node.value);
      const open = /^<([A-Za-z][\w-]*)(?:\s[^]*)?>$/.exec(node.value);
      if (close) {
        const at = elements.lastIndexOf(close[1]!.toLowerCase());
        if (at >= 0) elements.length = at;
      } else if (open && !node.value.endsWith("/>") && !voidElements.has(open[1]!.toLowerCase()))
        elements.push(open[1]!.toLowerCase());
      return;
    }
    if (node.type === "link" && source[range(node)[0]] !== "[") autolinkEnd = range(node)[1];
    if (node.type !== "text" || elements.length) return;
    const [start, end] = range(node);
    if (start < autolinkEnd) return;
    for (const match of source.slice(start, end).matchAll(/\*+|_+/g)) {
      const from = start + match.index;
      const to = from + match[0].length;
      const marker = match[0][0];
      if (source[from - 1] === marker || source[to] === marker || escaped(source, from)) continue;
      runs.push({
        start: from,
        end: to,
        line: countBelow(starts, from + 1) - 1,
        label: from < labelEnd,
      });
    }
  });
  return { runs, nodeStarts, nodeEnds };
}

/**
 * What may stand just outside a marker of emphasis that was meant: blank
 * space, the edge of a line, brackets and quotation marks, and the
 * punctuation that ends a clause. A letter or digit there puts the marker
 * inside a word, and other symbols, such as the slash that starts a JSX
 * comment, belong to other notations.
 */
const outside = /[\s\p{Ps}\p{Pe}\p{Pi}\p{Pf}"'.,;:!?、。，：；！？]/u;
/**
 * What may start and end text that was meant as emphasis: a letter or digit,
 * the brackets and quotation marks that open or close a phrase, and the
 * punctuation that ends a sentence. Other text, such as the `.md` of the
 * pattern `*.md *`, is a wildcard or another notation.
 */
const textFirst = /^[\p{L}\p{N}\p{Ps}\p{Pi}"'¿¡]/u;
const textLast = /^[\p{L}\p{N}\p{M}\p{Pe}\p{Pf}"'.!?…。！？]/u;
/**
 * The last character of `text`, whole when it is a surrogate pair. Test it with a
 * start-anchored pattern: on Node.js 26, a `u` pattern with a character class
 * right before `$` misses a surrogate pair there (#743).
 */
const lastCharacter = (text: string) => [...text.slice(-2)].at(-1) ?? "";
/** A number or a single letter, such as the operands of `a * b` or `2 * 3`. */
const operand = /^[+\-−]?(?:\p{L}|\p{N}+(?:[.,]\p{N}+)*)$/u;
/** An operator between operands. */
const operator = /^[+\-−±×÷*/=≠<>≤≥^%·]$/u;
/** A word with the brackets and clause punctuation around it taken off. */
const bare = (word: string) => word.replace(/^[([{]+/, "").replace(/[)\]},.;:!?]+$/, "");
/** Whether `text` is arithmetic: operands and operators only, between blank space. */
const arithmetic = (text: string | undefined) =>
  text !== undefined &&
  text.split(/[ \t]+/).every((word) => operand.test(bare(word)) || operator.test(word));

/** Markers whose inner spaces may keep them from making emphasis. */
interface Candidate {
  start: number;
  end: number;
  /** The edit that takes the spaces out. */
  edit: Edit;
  /** The node types that the markers would make without the spaces. */
  types: string[];
  /** The root-level block that holds the markers. */
  block: number;
}
/** A block, or an inline block without its content. */
interface Shape {
  /** Its type, start, end, and identifier, with the offsets given. */
  key: string;
  type: string;
  /** Where it lies in its tree's own text. */
  start: number;
  end: number;
}
/** The blocks of a tree, and its inline blocks, with the offsets that `offset` gives. */
function blockShape(tree: Root, offset: (at: number) => number): Shape[] {
  const parts: Shape[] = [];
  const step = (node: Nodes, task: boolean) => {
    const [start, end] = range(node);
    const identifier = "identifier" in node ? node.identifier : "";
    // A task list item's paragraph starts after the task marker where its
    // first node is text, and at the marker where it is emphasis.
    const from = task && node.type === "paragraph" ? "" : offset(start);
    const key = `${node.type}:${from}:${offset(end)}:${identifier}`;
    parts.push({ key, type: node.type, start, end });
    if (!inlineBlocks.has(node.type) && "children" in node)
      for (const child of node.children)
        step(child, node.type === "listItem" && typeof node.checked === "boolean");
  };
  step(tree, false);
  return parts;
}
/**
 * Which candidates the parser reads as emphasis once the spaces of all of them
 * are taken out: a node of one of their types from the start of the opening
 * marker to the end of the closing one. The candidates are in order and do not
 * overlap, and none takes spaces out of a reference's label, which would change
 * the definition it matches.
 *
 * The whole document is read once with every edit. Each edit lies within one
 * line of an inline block and takes out only blank space next to a marker, so
 * it changes neither a line's start nor a line's end, and the blocks mostly
 * stay as they were. A paragraph whose text becomes a definition, as in `[a]:`
 * followed by `** b **` on the next line, does not, and a new definition can
 * change how references in other blocks read. A block holds the same inline
 * reading whatever the other blocks hold, as long as the definitions stay the
 * same, so a reading in which every block and definition is where it was reads
 * each block as its own edits alone would. Where the reading has a definition
 * that the document lacks, the candidates whose edits lie in it are dropped;
 * where a block moved or changed otherwise, the candidates of the root-level
 * block that holds the change are. The document is then read again without
 * them.
 */
function inlineReading(document: Document, candidates: Candidate[]): boolean[] {
  const { source, tree } = document;
  const blockStarts = tree.children.map((child) => range(child)[0]);
  const found = new Set<Candidate>();
  let remaining = candidates;
  while (remaining.length) {
    // Where each edit ends, in the source and in the edited text, and how
    // many characters the edits up to it have taken out.
    const sourceEnds: number[] = [];
    const editedEnds: number[] = [];
    const removed: number[] = [];
    const expected = new Map<string, Candidate>();
    let edited = "";
    let cursor = 0;
    let shift = 0;
    for (const candidate of remaining) {
      const { edit } = candidate;
      edited += source.slice(cursor, edit.start) + edit.text;
      cursor = edit.end;
      const count = edit.end - edit.start - edit.text.length;
      expected.set(`${candidate.start - shift} ${candidate.end - shift - count}`, candidate);
      shift += count;
      sourceEnds.push(edit.end);
      editedEnds.push(edit.end - shift);
      removed.push(shift);
    }
    edited += source.slice(cursor);
    const reading = reread(document, edited).tree;
    // Offsets of the source in the edited text, and back; no block starts
    // or ends inside the spaces taken out.
    const forward = (offset: number) =>
      offset - (removed[countBelow(sourceEnds, offset + 1) - 1] ?? 0);
    const back = (offset: number) =>
      offset + (removed[countBelow(editedEnds, offset + 1) - 1] ?? 0);
    // The blocks of either reading that the other lacks, by count.
    const unmatched = new Map<string, number[]>();
    for (const { key, start } of blockShape(tree, forward)) {
      const starts = unmatched.get(key);
      if (starts) starts.push(start);
      else unmatched.set(key, [start]);
    }
    const changed = new Set<number>();
    const blame = (offset: number) => changed.add(countBelow(blockStarts, offset + 1) - 1);
    // New definitions, by where they lie in the source.
    const defined: [number, number][] = [];
    for (const { key, type, start, end } of blockShape(reading, (offset) => offset)) {
      const starts = unmatched.get(key);
      if (starts?.length) starts.pop();
      else {
        blame(back(start));
        if (type === "definition" || type === "footnoteDefinition")
          defined.push([back(start), back(end)]);
      }
    }
    for (const starts of unmatched.values()) for (const start of starts) blame(start);
    if (!changed.size) {
      walk(reading, (node) => {
        const candidate = expected.get(
          `${node.position?.start.offset} ${node.position?.end.offset}`,
        );
        if (candidate?.types.includes(node.type)) found.add(candidate);
      });
      break;
    }
    const definedStarts = defined.sort((a, b) => a[0] - b[0]).map(([start]) => start);
    let kept = remaining.filter(({ edit }) => {
      const [, end] = defined[countBelow(definedStarts, edit.end) - 1] ?? [];
      return end === undefined || edit.start >= end;
    });
    if (kept.length === remaining.length)
      kept = remaining.filter((candidate) => !changed.has(candidate.block));
    // A change outside every block that holds a candidate leaves nothing to
    // blame, and nothing is reported.
    remaining = kept.length < remaining.length ? kept : [];
  }
  return candidates.map((candidate) => found.has(candidate));
}

/** What a marker of each length makes, and what the text would then be. */
const kinds = [
  undefined,
  { types: ["emphasis"], name: "emphasis", text: "emphasized" },
  { types: ["strong"], name: "strong text", text: "strong" },
  { types: ["emphasis", "strong"], name: "strong emphasis", text: "strong and emphasized" },
];

/** Where blank space lies at the ends of something, for a message. */
const ends = (start: boolean, end: boolean) =>
  start && end ? "starts and ends" : start ? "starts" : "ends";

export const spacingRules: Record<string, Rule> = {
  "content/emphasis-spacing": {
    description:
      "Reports spaces just inside emphasis markers, which make renderers show the markers as text.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const { source } = document;
      const findings: Finding[] = [];
      const starts = lineStarts(source);
      const misread = protectedEdit(document);
      const candidates: (Candidate & { message: string })[] = [];
      for (const [index, block] of document.tree.children.entries()) {
        walk(block, (node) => {
          if (!inlineBlocks.has(node.type)) return;
          const { runs, nodeStarts, nodeEnds } = textRuns(document, node, starts);
          // The next run of the same marker on the line, by run.
          const next = new Map<Run, Run>();
          const last = new Map<string, Run>();
          for (const run of runs) {
            const key = `${run.line} ${source.slice(run.start, run.end)}`;
            const previous = last.get(key);
            if (previous) next.set(previous, run);
            last.set(key, run);
          }
          // Runs pair in order: a run that would close the run before it opens
          // nothing, also where that pair is not reported.
          const closings = new Set<Run>();
          const found: (Candidate & { message: string })[] = [];
          for (const opening of runs) {
            const closing = next.get(opening);
            const size = opening.end - opening.start;
            if (!closing || closings.has(opening)) continue;
            closings.add(closing);
            if (size > 3) continue;
            const inner = source.slice(opening.end, closing.start);
            const before = /^[ \t]*/.exec(inner)![0];
            const after = /[ \t]*$/.exec(inner)![0];
            const text = inner.slice(before.length, inner.length - after.length);
            if ((!before && !after) || !/[\p{L}\p{N}]/u.test(text)) continue;
            // Text that starts or ends with another inline node, such as a
            // code span or a link, starts or ends as that node does.
            const textStart = opening.end + before.length;
            const textEnd = closing.start - after.length;
            if (!nodeStarts.has(textStart) && !textFirst.test(text)) continue;
            if (!nodeEnds.has(textEnd) && !textLast.test(lastCharacter(text))) continue;
            // Taking spaces out of a reference's label would change the
            // definition that it names.
            if ((opening.label && before) || (closing.label && after)) continue;
            // Text with as long a run of the marker, such as one that the
            // parser paired with another, leaves open which markers belong
            // together, as in `"** a **" b, (** c **)`.
            if (text.includes(source.slice(opening.start, opening.end))) continue;
            // A single marker with blank space on both sides at both ends, as
            // in `a * b * c`, is how multiplication, wildcards, and asterisks
            // standing for themselves are written.
            if (size === 1 && before && after) continue;
            const outer = [source[opening.start - 1], source[closing.end]];
            if (outer.some((character) => character !== undefined && !outside.test(character)))
              continue;
            // Arithmetic with uneven spaces, such as `2 *3 * 4` or `a ** b ** c`.
            const lineFrom = starts[opening.line]!;
            const left = /(\S+)[ \t]*$/.exec(source.slice(lineFrom, opening.start))?.[1];
            const right = /^[ \t]*(\S+)/.exec(
              source.slice(closing.end, lineEnd(source, closing.end)),
            )?.[1];
            if (arithmetic(text) && arithmetic(left) && arithmetic(right)) continue;
            if (
              goldmarkForges[document.dialect] &&
              [opening, closing].some((run) => inForgeMath(document, run.start, run.end))
            )
              continue;
            if (
              document.dialect === "gitea" &&
              source[opening.start] === "_" &&
              giteaPyLine(document, opening.start, closing.end)
            )
              continue;
            const edit = { start: opening.end, end: closing.start, text };
            if (misread(edit)) continue;
            const kind = kinds[size]!;
            const marker = source.slice(opening.start, opening.end);
            found.push({
              start: opening.start,
              end: closing.end,
              edit,
              types: kind.types,
              block: index,
              message: `Spaces just inside the "${marker}" markers keep them from making ${kind.name}, so they show as text; remove the spaces if the text should be ${kind.text}.`,
            });
          }
          // Markers of different kinds can interleave, as in `** a _b ** c _`;
          // which pair was meant is not known.
          found.sort((a, b) => a.start - b.start);
          let reach = -1;
          for (const [index, candidate] of found.entries()) {
            if (reach <= candidate.start && (found[index + 1]?.start ?? Infinity) >= candidate.end)
              candidates.push(candidate);
            reach = Math.max(reach, candidate.end);
          }
        });
      }
      const read = inlineReading(document, candidates);
      for (const [index, { start, end, message }] of candidates.entries())
        if (read[index]) findings.push({ start, end, message });
      return findings;
    },
  },
  "content/inline-code-spacing": {
    description:
      "Reports spaces at the ends of code spans that renderers show as part of the code.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      const misread = protectedEdit(document);
      walk(document.tree, "inlineCode", (node) => {
        const content = codeSpanContent(node);
        // A span of blank space only keeps all of it.
        if (!/[^ \t]/.test(content)) return;
        // VitePress renders markdown-it's reading, which keeps the indentation of
        // a span's continuation lines; report only where the two readings agree.
        const shown = /^ [^]* $/.test(content) ? content.slice(1, -1) : content;
        if (codeSpanText(node) !== shown) return;
        const leading = /^[ \t]*/.exec(content)![0];
        const trailing = /[ \t]*$/.exec(content)![0];
        const code = content.slice(leading.length, content.length - trailing.length);
        // Renderers take one space off each end when both ends have one.
        const removed = /^ [^]* $/.test(content) ? 1 : 0;
        // Blank space that renderers show counts where it lies next to a
        // letter or digit. Next to another character it usually shows syntax,
        // as in `- ` or `: `, or keeps a backtick apart from the span's own;
        // more than one space at one end only, as in `    Text`, shows
        // indentation.
        const padded = (blank: string, edge: boolean) =>
          blank.length > removed && edge && (removed > 0 || blank === " ");
        const start = padded(leading, /^[\p{L}\p{N}]/u.test(code));
        const end = padded(trailing, /^[\p{L}\p{N}]/u.test(lastCharacter(code)));
        if (!start && !end) return;
        const [from, to] = range(node);
        if (misread({ start: from, end: to, text: "" })) return;
        findings.push({
          start: from,
          end: to,
          message: `The code span ${ends(start, end)} with blank space that renderers show as part of the code, because they take off only one space at each end, and only when both ends have one; remove it unless the code needs it.`,
        });
      });
      return findings;
    },
  },
  "links/text-spacing": {
    description: "Reports spaces at the ends of link text, which become part of the link.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const { source } = document;
      const findings: Finding[] = [];
      const misread = protectedEdit(document);
      walk(document.tree, (node) => {
        if (node.type !== "link" && node.type !== "linkReference") return;
        const [from, to] = range(node);
        const last = node.children.at(-1);
        // An autolink shows its destination, which has no blank space.
        if (source[from] !== "[" || !last) return;
        const close = node.type === "link" ? labelEnd(node) : range(last)[1];
        if (close === undefined || source[close] !== "]") return;
        const text = source.slice(from + 1, close);
        const leading = /^[ \t\r\n]*/.exec(text)![0].length;
        const trailing = /[ \t\r\n]*$/.exec(text)![0].length;
        if (leading === text.length || (!leading && !trailing)) return;
        if (misread({ start: from, end: to, text: "" })) return;
        findings.push({
          start: from,
          end: to,
          message: `The link text ${ends(leading > 0, trailing > 0)} with blank space, which renders as part of the link; move it outside the brackets.`,
        });
      });
      return findings;
    },
  },
};
