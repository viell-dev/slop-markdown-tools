import type { Nodes, RootContent } from "mdast";
import type { Document, Edit, Finding, Rule } from "../core/types.js";
import { protectedEdit } from "../core/protection-edits.js";
import { codeSpanContent, labelEnd, parse, range } from "../syntax/parse.js";
import { countBelow, escaped, lineEnd, lineStart, lineStarts } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { giteaPyLine, goldmarkForges, inForgeMath } from "./protections.js";
import { inlineBlocks, optionsSchema } from "./shared.js";

/** A run of `*` or `_` that the parser left as text, on its physical line. */
interface Run {
  start: number;
  end: number;
  line: number;
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
 * renderers read Markdown inside it.
 */
function textRuns(document: Document, block: Nodes, starts: number[]): Run[] {
  const { source } = document;
  const runs: Run[] = [];
  const elements: string[] = [];
  let autolinkEnd = -1;
  walk(block, (node) => {
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
      runs.push({ start: from, end: to, line: countBelow(starts, from + 1) - 1 });
    }
  });
  return runs;
}

/**
 * What may stand just outside a marker of emphasis that was meant: blank
 * space, the edge of a line, brackets and quotation marks, and the
 * punctuation that ends a clause. A letter or digit there puts the marker
 * inside a word, and other symbols, such as the slash that starts a JSX
 * comment, belong to other notations.
 */
const outside = /[\s\p{Ps}\p{Pe}\p{Pi}\p{Pf}"'.,;:!?、。，：；！？]/u;
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
}
/**
 * Which candidates of a root-level block the parser reads as emphasis once
 * all their spaces are taken out: a node of one of their types from the start
 * of the opening marker to the end of the closing one. The candidates are in
 * order and do not overlap. The block is read again on its own, with the
 * root-level definitions that its references use; where that reading of the
 * block differs from the document's, the whole document is read again instead.
 */
function inlineReading(document: Document) {
  const { source, tree } = document;
  const read = (text: string) =>
    parse(text, document.dialect, document.path, [], document.vitepress).tree;
  // Root-level definitions by the kind of reference and identifier.
  const definitions = new Map<string, string>();
  for (const node of tree.children)
    if (node.type === "definition" || node.type === "footnoteDefinition")
      definitions.set(
        `${node.type} ${node.identifier}`,
        `\n\n${source.slice(lineStart(source, range(node)[0]), range(node)[1])}`,
      );
  /** The definitions that the references in a block use. */
  const used = (block: Nodes) => {
    const keys = new Set<string>();
    walk(block, (node) => {
      if (node.type === "linkReference" || node.type === "imageReference")
        keys.add(`definition ${node.identifier}`);
      else if (node.type === "footnoteReference") keys.add(`footnoteDefinition ${node.identifier}`);
    });
    return [...keys].map((key) => definitions.get(key) ?? "").join("");
  };
  /** The shape of a subtree, with offsets from `base`. */
  const shape = (node: Nodes, base: number) => {
    const parts: string[] = [];
    walk(node, (child) => {
      const [start, end] = range(child);
      parts.push(`${child.type}:${start - base}:${end - base}`);
    });
    return parts.join(" ");
  };
  return (block: RootContent, candidates: Candidate[]): boolean[] => {
    let from = lineStart(source, range(block)[0]);
    let to = lineEnd(source, range(block)[1]);
    let suffix = used(block);
    const first = read(source.slice(from, to) + suffix).children[0];
    if (!first || shape(first, 0) !== shape(block, from)) {
      from = 0;
      to = source.length;
      suffix = "";
    }
    // Where each candidate lies in the edited text.
    const expected = new Map<string, Candidate>();
    let edited = "";
    let cursor = from;
    let shift = from;
    for (const candidate of candidates) {
      const { edit } = candidate;
      edited += source.slice(cursor, edit.start) + edit.text;
      cursor = edit.end;
      const removed = edit.end - edit.start - edit.text.length;
      expected.set(`${candidate.start - shift} ${candidate.end - shift - removed}`, candidate);
      shift += removed;
    }
    edited += source.slice(cursor, to) + suffix;
    const found = new Set<Candidate>();
    walk(read(edited), (node) => {
      const candidate = expected.get(`${node.position?.start.offset} ${node.position?.end.offset}`);
      if (candidate?.types.includes(node.type)) found.add(candidate);
    });
    return candidates.map((candidate) => found.has(candidate));
  };
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
    description: "Report spaces just inside emphasis or strong markers, which then show as text.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const { source } = document;
      const findings: Finding[] = [];
      const starts = lineStarts(source);
      const misread = protectedEdit(document);
      const reading = inlineReading(document);
      for (const block of document.tree.children) {
        const candidates: (Candidate & { message: string })[] = [];
        walk(block, (node) => {
          if (!inlineBlocks.has(node.type)) return;
          const runs = textRuns(document, node, starts);
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
        if (!candidates.length) continue;
        const read = reading(block, candidates);
        for (const [index, { start, end, message }] of candidates.entries())
          if (read[index]) findings.push({ start, end, message });
      }
      return findings;
    },
  },
  "content/inline-code-spacing": {
    description: "Report blank space at the ends of code spans that renderers show as code.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      const misread = protectedEdit(document);
      walk(document.tree, "inlineCode", (node) => {
        const content = codeSpanContent(node);
        // A span of blank space only keeps all of it.
        if (!/[^ \t]/.test(content)) return;
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
        const end = padded(trailing, /[\p{L}\p{N}]$/u.test(code));
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
    description: "Report blank space at the ends of link text, which becomes part of the link.",
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
