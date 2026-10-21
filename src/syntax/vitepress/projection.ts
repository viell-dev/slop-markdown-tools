import type { Root, RootContent, Nodes } from "mdast";
import type Token from "markdown-it/lib/token.mjs";
import type { Document, Finding } from "../../core/types.js";
import { lineStarts } from "../source.js";
import { blank, frontmatterEnd, readVitePress } from "./reader.js";

interface Projection {
  source: string;
  literals: RootContent[];
  protected: { start: number; end: number; wrapOnly: boolean }[];
  tokens: Token[];
}
const readings = new WeakMap<Root, Projection>();

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
    if (["math_block", "vitepress_snippet", "vitepress_toc", "html_block"].includes(token.type)) {
      masked.push({ start, end, literal: true });
      protectedParts.push({ start, end, wrapOnly: false });
    }
    if (token.type === "inline") {
      // Attribute placement, inline notes, and Vue's newline-only element gaps
      // are left intact. Other paragraphs still receive ordinary reflow.
      const special = document.vitepress?.footnote !== false && /\^\[/.test(token.content);
      const elements = token.children?.filter(
        (child) => child.type !== "text" || child.content.trim(),
      );
      const hasElements = elements?.some(
        (child) =>
          child.nesting ||
          ["image", "code_inline", "math_inline", "html_inline"].includes(child.type),
      );
      if (special || hasElements) protectedParts.push({ start, end, wrapOnly: !special });
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
export function recordVitePress(tree: Root, projection: Projection): void {
  tree.children.push(...projection.literals);
  tree.children.sort((a, b) => a.position!.start.offset! - b.position!.start.offset!);
  readings.set(tree, projection);
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
/** Code nodes at their positioned source lines, used only by the approved-code guard. */
export function codeLines(node: Nodes): [number, number] | undefined {
  if (node.type !== "code" || !node.position) return undefined;
  return [node.position.start.line - 1, node.position.end.line];
}
