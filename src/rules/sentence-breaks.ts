import { decodeHTMLStrict } from "entities";
import type { Nodes, Paragraph } from "mdast";
import { split } from "sentence-splitter";
import type { Document } from "../core/types.js";
import { range, reread } from "../syntax/parse.js";
import { walk } from "../syntax/walk.js";

const containers = new Set(["emphasis", "strong", "delete", "link", "linkReference"]);
const references =
  /\\[!-/:-@[-`{-~]|&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g;
const terminal = /[.!?。！？]["'”’»)}\]]*$/;

/**
 * Detect a boundary using bounded neighboring words, not the whole paragraph.
 * The dependency retains abbreviation contexts and searches them on each character;
 * feeding an unbounded paragraph of abbreviations to it would be quadratic.
 * Long words cannot be abbreviations in its fixed English vocabulary. Keep their
 * edges for punctuation/case context, bounding even pathological quoted tokens.
 */
function startsSentence(prior: string, before: string, after: string): boolean {
  if (!terminal.test(before)) return false;
  const left = `${prior.slice(-256)} ${before.slice(-256)}`;
  const right = after.slice(0, 256);
  const boundary = left.length + 1;
  return split(`${left} ${right}`).some(
    (node) => node.type === "Sentence" && node.range[0] === boundary,
  );
}

/**
 * Preferred breaks before safe wrapping atoms. All offsets belong to the joined,
 * normalized inline source, never reconstructed detector output. One inline
 * reading per paragraph handles escapes and delimiters after multiline atoms
 * have joined. Reference labels retain their original reading through small,
 * local dummy definitions; the document is not rescanned for each paragraph.
 */
export function sentenceBreaks(
  document: Document,
  paragraph: Paragraph,
  atoms: string[],
): Set<number> {
  const source = `x ${atoms.join(" ")}`;
  const labels = new Set<string>();
  walk(paragraph, (node) => {
    if (node.type === "linkReference" || node.type === "imageReference")
      // `label` is decoded (for example a\]b becomes a]b), whereas the
      // identifier retains the escapes needed to form another valid definition.
      labels.add(node.identifier.replace(/[\r\n]+/g, " "));
  });
  const definitions = [...labels]
    .map((label) => `[${label}]: /mdrefine-sentence-reference`)
    .join("\n");
  const tree = reread(document, `${source}\n\n${definitions}`).tree;
  const body = tree.children[0];
  if (body?.type !== "paragraph") return new Set();

  const starts: number[] = [];
  let position = 2;
  for (const atom of atoms) {
    starts.push(position);
    position += atom.length + 1;
  }
  const projected: string[] = [];
  const points = new Map<number, number[]>();
  let cursor = 1;
  let length = 0;
  const remember = (offset: number) => {
    const indices = points.get(offset) ?? [];
    indices.push(cursor++);
    points.set(offset, indices);
  };
  const append = (from: number, to: number, text: string) => {
    while (cursor < starts.length && starts[cursor]! < from) remember(length);
    while (cursor < starts.length && starts[cursor]! < to) {
      const at = starts[cursor]!;
      // A boundary inside decoded syntax or an opaque node is not a source
      // whitespace boundary. Protected atoms normally exclude it already.
      if (to - from === text.length) remember(length + at - from);
      else if (at === from) remember(length);
      else cursor++;
    }
    projected.push(text);
    length += text.length;
  };
  const visit = (node: Nodes) => {
    if (!node.position) return;
    const [begin, end] = range(node);
    const from = Math.max(2, begin);
    const to = Math.min(source.length, end);
    if (to <= from) return;
    if (node.type === "text") {
      const raw = source.slice(from, to);
      let at = from;
      for (const match of raw.matchAll(references)) {
        const start = from + match.index;
        if (start > at) append(at, start, source.slice(at, start));
        const value = match[0].startsWith("\\") ? match[0].slice(1) : decodeHTMLStrict(match[0]);
        append(start, start + match[0].length, value);
        at = start + match[0].length;
      }
      if (at < to) append(at, to, source.slice(at, to));
    } else if ((node.type === "paragraph" || containers.has(node.type)) && "children" in node) {
      for (const child of node.children) visit(child);
    } else {
      // Code, math, images, comments and unknown inline constructs contribute
      // no sentence punctuation. Keep a word placeholder to avoid joining prose.
      append(from, to, "x");
    }
  };
  visit(body);
  const text = projected.join("");
  const breaks = new Set<number>();
  let previous = "";
  let prior = "";
  for (const match of text.matchAll(/[^ \t\r\n]+/g)) {
    const indices = points.get(match.index);
    if (indices && startsSentence(prior, previous, match[0]))
      for (const index of indices) breaks.add(index);
    prior = previous;
    previous = match[0];
  }
  return breaks;
}
