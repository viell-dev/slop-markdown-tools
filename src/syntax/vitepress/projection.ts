import type { Root, RootContent, InlineCode } from "mdast";
import type Token from "markdown-it/lib/token.mjs";
import type { Document, Finding } from "../../core/types.js";
import { lineStarts } from "../source.js";
import { blank, frontmatterEnd, readVitePress } from "./reader.js";
import { walk } from "../walk.js";
import { hasVueElementGap } from "./whitespace.js";

interface Projection {
  source: string;
  literals: RootContent[];
  protected: { start: number; end: number; wrapOnly: boolean }[];
  tokens: Token[];
}
const readings = new WeakMap<Root, Projection>();
const codeTexts = new WeakMap<InlineCode, string>();
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
    protectedParts.push({ start: 0, end: matter, wrapOnly: false });
  }
  for (const token of tokens) {
    if (token.type.startsWith("container_") && token.nesting === 1 && token.map) {
      const start = boundary(token.map[0]);
      const end = boundary(token.map[0] + 1);
      masked.push({ start, end, literal: false });
      protectedParts.push({ start, end, wrapOnly: false });
      const close = boundary(token.map[1]);
      if (/^[ \t>]*:{3,}[ \t]*(?:\r\n|\r|\n|$)/.test(source.slice(close))) {
        const to = boundary(token.map[1] + 1);
        masked.push({ start: close, end: to, literal: false });
        protectedParts.push({ start: close, end: to, wrapOnly: false });
      }
    }
    if (!token.map) continue;
    const start = boundary(token.map[0]);
    const end = boundary(token.map[1]);
    const written = source.slice(start, end);
    const hasAttrs = token.attrs?.length || token.children?.some((child) => child.attrs?.length);
    if (document.vitepress?.attrs !== false && hasAttrs) {
      let found = false;
      for (const match of written.matchAll(/\{[^}\r\n]*\}/g)) {
        found = true;
        protectedParts.push({
          start: start + match.index,
          end: start + match.index + match[0].length,
          wrapOnly: false,
        });
      }
      if (found) protectedParts.push({ start, end, wrapOnly: true });
    }
    if (["math_block", "vitepress_snippet", "vitepress_toc"].includes(token.type)) {
      masked.push({ start, end, literal: true });
      protectedParts.push({ start, end, wrapOnly: false });
    }
    if (token.type === "html_block" || token.type === "code_block")
      protectedParts.push({ start, end, wrapOnly: false });
    if (token.type === "inline") {
      // Attribute placement, inline notes, and Vue's newline-only element gaps
      // are left intact. Other paragraphs still receive ordinary reflow.
      const special = document.vitepress?.footnote !== false && /\^\[/.test(token.content);
      if (special || hasVueElementGap(token.children ?? []))
        protectedParts.push({ start, end, wrapOnly: !special });
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
  for (const token of projection.tokens) {
    if (
      token.type !== "html_block" ||
      !token.map ||
      html.get(token.map[0])?.has(normalize(token.content))
    )
      continue;
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
    if (first < low) opaque.push({ first, last: low - 1 });
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
    children.push({
      type: "html",
      value: source.slice(start.offset, end.offset),
      position: { start, end },
    });
    projection.protected.push({ start: start.offset!, end: end.offset!, wrapOnly: false });
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
/** Whether a finding targets syntax deliberately kept opaque to ordinary rules. */
export function protectedVitePress(document: Document, name: string, finding: Finding): boolean {
  if (document.dialect !== "vitepress") return false;
  const start = finding.edit?.start ?? finding.start;
  const end = finding.edit?.end ?? finding.end ?? start;
  return (readings.get(document.tree)?.protected ?? []).some(
    (part) =>
      (!part.wrapOnly || name === "style/wrap") &&
      (start === end
        ? start >= part.start && start <= part.end
        : start < part.end && end > part.start),
  );
}
