import type { Root, RootContent, InlineCode, Nodes } from "mdast";
import type Token from "markdown-it/lib/token.mjs";
import type { Document, Finding } from "../../core/types.js";
import { lineStarts } from "../source.js";
import { attributed, blank, frontmatterEnd, readVitePress } from "./reader.js";
import { walk } from "../walk.js";
import { hasVueElementGap } from "./whitespace.js";

interface Projection {
  source: string;
  literals: RootContent[];
  protected: { start: number; end: number; wrapOnly: boolean; reason: string }[];
  tokens: Token[];
}
const readings = new WeakMap<Root, Projection>();
const codeTexts = new WeakMap<InlineCode, string>();
const hiddenLists = new WeakSet<RootContent>();
/**
 * Whether `node` is a block left opaque for a component that holds a list at
 * either end, which another marker on a list beside it would join (#769).
 */
export function hidesList(node: RootContent): boolean {
  return hiddenLists.has(node);
}
/** markdown-it keeps indentation in multiline spans that GitHub removes. */
export function vitepressCodeText(node: InlineCode): string | undefined {
  return codeTexts.get(node);
}

/** Keep source positions while separating VitePress's block boundaries for mdast. */
export function projectVitePress(document: Document): Projection {
  const { source } = document;
  const starts = lineStarts(source);
  const tokens = readVitePress(source, document.vitepress);
  const protectedParts: Projection["protected"] = [];
  const masked: { start: number; end: number; literal: boolean }[] = [];
  const boundary = (line: number) => Math.min(starts[line] ?? source.length, source.length);
  const matter = frontmatterEnd(source);
  if (matter) {
    masked.push({ start: 0, end: matter, literal: true });
    protectedParts.push({ start: 0, end: matter, wrapOnly: false, reason: "front matter" });
  }
  for (const token of tokens) {
    if (token.type.startsWith("container_") && token.nesting === 1 && token.map) {
      const start = boundary(token.map[0]);
      const end = boundary(token.map[0] + 1);
      masked.push({ start, end, literal: false });
      protectedParts.push({ start, end, wrapOnly: false, reason: "VitePress container" });
      const close = boundary(token.map[1]);
      if (/^[ \t>]*:{3,}[ \t]*(?:\r\n|\r|\n|$)/.test(source.slice(close))) {
        const to = boundary(token.map[1] + 1);
        masked.push({ start: close, end: to, literal: false });
        protectedParts.push({
          start: close,
          end: to,
          wrapOnly: false,
          reason: "VitePress container",
        });
      }
    }
    if (!token.map) continue;
    const start = boundary(token.map[0]);
    const end = boundary(token.map[1]);
    const written = source.slice(start, end);
    // Only attributes that the attribute syntax gave count: a link's address
    // or a task's checkbox is no reason to keep braces in a code span (#755).
    const hasAttrs = attributed(token) || token.children?.some(attributed);
    if (document.vitepress?.attrs !== false && hasAttrs) {
      let found = false;
      for (const match of written.matchAll(/\{[^}\r\n]*\}/g)) {
        found = true;
        protectedParts.push({
          start: start + match.index,
          end: start + match.index + match[0].length,
          wrapOnly: false,
          reason: "VitePress attribute syntax",
        });
      }
      if (found)
        protectedParts.push({ start, end, wrapOnly: true, reason: "VitePress attribute syntax" });
    }
    if (["math_block", "vitepress_snippet", "vitepress_toc"].includes(token.type)) {
      masked.push({ start, end, literal: true });
      protectedParts.push({ start, end, wrapOnly: false, reason: "VitePress block syntax" });
    }
    if (token.type === "html_block" || token.type === "code_block")
      protectedParts.push({
        start,
        end,
        wrapOnly: false,
        reason: token.type === "html_block" ? "VitePress HTML block" : "VitePress indented code",
      });
    if (token.type === "inline") {
      // Attribute placement, inline notes, and Vue's newline-only element gaps
      // are left intact. Other paragraphs still receive ordinary reflow. An
      // inline note's reference has no label, unlike `[^label]`, and `^[` in a
      // code span is code.
      const special =
        document.vitepress?.footnote !== false &&
        (token.children ?? []).some(
          (child) =>
            child.type === "footnote_ref" &&
            (child.meta as { label?: string } | null)?.label === undefined,
        );
      if (special)
        protectedParts.push({ start, end, wrapOnly: false, reason: "VitePress inline footnote" });
      else if (hasVueElementGap(token.children ?? []))
        protectedParts.push({
          start,
          end,
          wrapOnly: true,
          reason: "Vue whitespace between elements",
        });
    }
  }
  // Outer opaque blocks supersede their descendants. Blank each range once.
  masked.sort((a, b) => a.start - b.start || b.end - a.end);
  const disjoint: typeof masked = [];
  for (const part of masked) {
    const previous = disjoint.at(-1);
    if (!previous || part.start >= previous.end) disjoint.push({ ...part });
    else if (part.end > previous.end) {
      previous.end = part.end;
      previous.literal ||= part.literal;
    }
  }
  const literals: RootContent[] = [];
  let projected = "";
  let previous = 0;
  const point = (at: number) => {
    let line = 0;
    let high = starts.length - 1;
    while (line < high) {
      const middle = (line + high + 1) >> 1;
      if (starts[middle]! <= at) line = middle;
      else high = middle - 1;
    }
    return { line: line + 1, column: at - starts[line]! + 1, offset: at };
  };
  for (const part of disjoint) {
    projected += source.slice(previous, part.start) + blank(source.slice(part.start, part.end));
    previous = part.end;
    if (part.literal)
      literals.push({
        type: part.start === 0 && matter ? "yaml" : "html",
        value: source.slice(part.start, part.end),
        position: { start: point(part.start), end: point(part.end) },
      });
  }
  projected += source.slice(previous);
  return { source: projected, literals, protected: protectedParts, tokens };
}
/** markdown-it's container tokens, without `_open` or `_close`, by mdast's names. */
const containerKinds = new Map([
  ["blockquote", "blockquote"],
  ["vitepress_alert", "blockquote"],
  ["list_item", "listItem"],
  ["footnote", "footnoteDefinition"],
]);
const mdastContainers = new Set(containerKinds.values());
/**
 * The tables of a tree by the line they start on, each by the containers that
 * hold it, outermost first, as in `"listItem blockquote"`.
 */
function tablePlacements(tree: Root): Map<number, Set<string>> {
  const placements = new Map<number, Set<string>>();
  const containers: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "table") {
      const line = node.position!.start.line;
      const found = placements.get(line) ?? new Set<string>();
      found.add(containers.join(" "));
      placements.set(line, found);
      return;
    }
    if (!("children" in node)) return;
    const container = mdastContainers.has(node.type);
    if (container) containers.push(node.type);
    for (const child of node.children) visit(child);
    if (container) containers.pop();
  };
  visit(tree);
  return placements;
}
/** Attach the secondary reading to the finished, positioned tree. */
export function recordVitePress(tree: Root, projection: Projection, source: string): void {
  // Keep ordinary HTML's list/quote parents. A component mdast reads inline
  // makes its containing top-level block opaque instead of masking markers.
  const html = new Map<number, Set<string>>();
  const normalize = (value: string) => value.replace(/\r\n|\r/g, "\n").replace(/\n$/, "");
  walk(tree, "html", (node, _index, parent) => {
    if (
      !parent ||
      ["paragraph", "heading", "emphasis", "strong", "link", "tableCell"].includes(parent.type)
    )
      return;
    const line = node.position!.start.line - 1;
    const values = html.get(line) ?? new Set<string>();
    values.add(normalize(node.value));
    html.set(line, values);
  });
  const starts = lineStarts(source);
  const opaque: { first: number; last: number }[] = [];
  const tables = tablePlacements(tree);
  // markdown-it's containers around each block token: its list items, block
  // quotes and footnote definitions, as mdast names them.
  const containers: string[] = [];
  for (const token of projection.tokens) {
    const kind = containerKinds.get(token.type.replace(/_(?:open|close)$/, ""));
    if (kind && token.nesting === 1) containers.push(kind);
    else if (kind && token.nesting === -1) containers.pop();
    if (!token.map) continue;
    let table: boolean;
    // A component that the component plugin reads as a block, alone on its
    // line, also as a line that interrupts a paragraph and ends it, which
    // mdast reads as a paragraph's inline HTML (#769).
    if (token.type === "html_block" || token.type === "html_inline") {
      if (html.get(token.map[0])?.has(normalize(token.content))) continue;
      table = false;
    } else if (token.type === "table_open") {
      // markdown-it tries a table before a list or block quote, so it reads
      // `* a | b` above `  --|--` as a table whose first cell holds the
      // marker, where mdast reads a list item holding a table (#763).
      if (tables.get(token.map[0] + 1)?.has(containers.join(" "))) continue;
      table = true;
    } else continue;
    const start = starts[token.map[0]] ?? source.length;
    const end = starts[token.map[1]] ?? source.length;
    let low = 0;
    let high = tree.children.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tree.children[middle]!.position!.end.offset! <= start) low = middle + 1;
      else high = middle;
    }
    const first = low;
    while (low < tree.children.length && tree.children[low]!.position!.start.offset! < end) low++;
    if (first === low) continue;
    // The blocks stay in the tree, so that the list rules still see the lists
    // beside them, which another marker would join to them, and keep those
    // as written too (vitepress/lists.ts).
    if (table)
      projection.protected.push({
        start: tree.children[first]!.position!.start.offset!,
        end: tree.children[low - 1]!.position!.end.offset!,
        wrapOnly: false,
        reason: "VitePress table",
      });
    else opaque.push({ first, last: low - 1 });
  }
  opaque.sort((a, b) => a.first - b.first || a.last - b.last);
  const merged: typeof opaque = [];
  for (const part of opaque) {
    const previous = merged.at(-1);
    if (previous && part.first <= previous.last) previous.last = Math.max(previous.last, part.last);
    else merged.push({ ...part });
  }
  const original = tree.children;
  const children: RootContent[] = [];
  let previous = 0;
  for (const part of merged) {
    while (previous < part.first) children.push(original[previous++]!);
    const start = original[part.first]!.position!.start;
    const end = original[part.last]!.position!.end;
    const replacement: RootContent = {
      type: "html",
      value: source.slice(start.offset, end.offset),
      position: { start, end },
    };
    children.push(replacement);
    if (original[part.first]!.type === "list" || original[part.last]!.type === "list")
      hiddenLists.add(replacement);
    projection.protected.push({
      start: start.offset!,
      end: end.offset!,
      wrapOnly: false,
      reason: "Vue component",
    });
    previous = part.last + 1;
  }
  while (previous < original.length) children.push(original[previous++]!);
  tree.children = children;
  for (const literal of projection.literals) tree.children.push(literal);
  tree.children.sort((a, b) => a.position!.start.offset! - b.position!.start.offset!);
  readings.set(tree, projection);
  const fences = new Map(
    projection.tokens
      .filter((token) => token.type === "fence" && token.map)
      .map((token) => [token.map![0], token]),
  );
  walk(tree, "code", (node) => {
    const token = fences.get(node.position!.start.line - 1);
    if (!token) return;
    // Keep the written alias, separating highlight/line-number/title suffixes.
    const info = token.info.trimStart();
    const language = /^[a-zA-Z0-9_-]+/.exec(info)?.[0] ?? "";
    node.lang = language || null;
    node.meta = info.slice(language.length).trim() || null;
  });
  const lines = new Map<number, InlineCode[]>();
  walk(tree, "inlineCode", (node) => {
    const line = node.position!.start.line - 1;
    const found = lines.get(line) ?? [];
    found.push(node);
    lines.set(line, found);
  });
  for (const token of projection.tokens) {
    if (token.type !== "inline" || !token.map) continue;
    const spans: InlineCode[] = [];
    for (let line = token.map[0]; line < token.map[1]; line++)
      for (const span of lines.get(line) ?? []) spans.push(span);
    const read = token.children?.filter((child) => child.type === "code_inline") ?? [];
    if (spans.length === read.length)
      spans.forEach((node, index) => codeTexts.set(node, read[index]!.content));
  }
}
export function vitepressTokens(document: Document): Token[] {
  return readings.get(document.tree)?.tokens ?? readVitePress(document.source, document.vitepress);
}
/** Whitespace rules must keep projection syntax and Vue expressions literal.
 * The projection has no positioned Vue expression tokens; conservatively keep
 * mustaches, including unfinished expressions, through their closing delimiter.
 */
export function vitepressWhitespaceLiterals(document: Document): [number, number][] {
  if (document.dialect !== "vitepress") return [];
  return [
    ...(readings.get(document.tree)?.protected ?? [])
      .filter((part) => !part.wrapOnly)
      .map((part): [number, number] => [part.start, part.end]),
    ...Array.from(
      document.source.matchAll(/\{\{[\s\S]*?(?:\}\}|$)/g),
      (match): [number, number] => [match.index, match.index + match[0].length],
    ),
    // The container plugin requires a space after its name. Replacing a tab
    // can turn a paragraph into a container, so protect candidates too. Each
    // repetition starts with a marker, so blank space has one way to match;
    // accepting a list marker without its space only protects more lines.
    ...Array.from(
      document.source.matchAll(/^[ \t]*(?:(?:>|[-+*]|\d+[.)])[ \t]*)*:{3,}[^\r\n]*/gm),
      (match): [number, number] => [match.index, match.index + match[0].length],
    ),
  ];
}
export type Part = Projection["protected"][number];
/**
 * Protected parts sorted by start, in the order recorded on a tie, with the
 * greatest end among each part and those before it.
 */
interface PartIndex {
  parts: Part[];
  reach: number[];
}
const indexes = new WeakMap<
  Projection["protected"],
  { size: number; all: PartIndex; kept: PartIndex }
>();
export function partIndex(parts: Part[]): PartIndex {
  const sorted = parts.slice().sort((a, b) => a.start - b.start);
  const reach: number[] = [];
  let furthest = -Infinity;
  for (const part of sorted) reach.push((furthest = Math.max(furthest, part.end)));
  return { parts: sorted, reach };
}
/**
 * The indexes of a document's protected parts, all of them and those outside
 * wrapping alone, built once the reading is complete: a query then takes two
 * binary searches instead of a pass over every part (#755).
 */
function protectedIndex(document: Document) {
  const parts = readings.get(document.tree)?.protected;
  if (!parts) return undefined;
  let index = indexes.get(parts);
  if (index?.size !== parts.length) {
    index = {
      size: parts.length,
      all: partIndex(parts),
      kept: partIndex(parts.filter((part) => !part.wrapOnly)),
    };
    indexes.set(parts, index);
  }
  return index;
}
/**
 * The first part, by start, that overlaps `start` to `end`, or with `touching`
 * that contains the point `start` = `end`, its ends included. Parts before the
 * one found end before the query starts, as their greatest end shows.
 */
export function overlapping(
  { parts, reach }: PartIndex,
  start: number,
  end: number,
  touching: boolean,
): Part | undefined {
  let low = 0;
  let high = parts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const from = parts[middle]!.start;
    if (touching ? from <= end : from < end) low = middle + 1;
    else high = middle;
  }
  const before = low;
  low = 0;
  high = before;
  while (low < high) {
    const middle = (low + high) >> 1;
    const to = reach[middle]!;
    if (touching ? to >= start : to > start) high = middle;
    else low = middle + 1;
  }
  return low < before ? parts[low] : undefined;
}
/**
 * Why wrapping must keep the source from `start` to `end` as written, when
 * VitePress syntax that the projection protects overlaps it, so that
 * `style/wrap` can report the paragraph rather than lose it silently (#755).
 * Of several such parts, the reason is that of the one that starts first.
 */
export function vitepressProtection(
  document: Document,
  start: number,
  end: number,
): string | undefined {
  if (document.dialect !== "vitepress") return undefined;
  const index = protectedIndex(document);
  return index && overlapping(index.all, start, end, false)?.reason;
}
/** Whether a finding targets syntax deliberately kept opaque to ordinary rules. */
export function protectedVitePress(document: Document, name: string, finding: Finding): boolean {
  if (document.dialect !== "vitepress") return false;
  // Report-only tab, code-form, and wrapping findings cannot alter protected
  // syntax; `style/wrap` reports the paragraphs that it keeps for it.
  if (
    (name === "style/no-tabs" || name === "style/code-block" || name === "style/wrap") &&
    !finding.edit
  )
    return false;
  const start = finding.edit?.start ?? finding.start;
  const end = finding.edit?.end ?? finding.end ?? start;
  const index = protectedIndex(document);
  if (!index) return false;
  return (
    overlapping(name === "style/wrap" ? index.all : index.kept, start, end, start === end) !==
    undefined
  );
}
