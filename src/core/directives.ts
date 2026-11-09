import { walk } from "../syntax/walk.js";
import type { Document, Finding } from "./types.js";
import { range } from "../syntax/parse.js";
import { countBelow, lineEnd, lineStarts } from "../syntax/source.js";
import { htmlComments } from "../syntax/html-comments.js";
import { isComponentBlock, isProjectedLiteral } from "../syntax/vitepress/projection.js";

/** A suppression directive and the rules it names, `*` for all of them. */
export interface Directive {
  kind: "disable-next-line" | "disable" | "enable";
  rules: Set<string>;
}
/** The directive that a single complete HTML comment holds, if it is one. */
function directive(value: string): Directive | undefined {
  const match = /^<!--\s*mdrefine-(disable-next-line|disable|enable)(?:\s+([^]*?))?\s*-->$/.exec(
    value.trim(),
  );
  if (!match) return undefined;
  const names = match[2]
    ?.trim()
    .split(/[\s,]+/)
    .filter(Boolean) ?? ["*"];
  return { kind: match[1] as Directive["kind"], rules: new Set(names.length ? names : ["*"]) };
}

/** Individual directives in source order, with original source offsets. */
export function directives(document: Document): (Directive & { start: number; end: number })[] {
  if (!document.source.includes("mdrefine-")) return [];
  const nodes: { value: string; start: number; end: number }[] = [];
  walk(document.tree, "html", (node) => {
    if (node.position?.start.offset === undefined || node.position.end.offset === undefined) return;
    // Projected blocks contain raw Markdown, including code examples, rather
    // than only the HTML comments/tags that this scan can interpret.
    if (isComponentBlock(node) || isProjectedLiteral(node)) return;
    const [start, end] = range(node);
    nodes.push({ value: node.value, start, end });
  });
  nodes.sort((a, b) => a.start - b.start);
  return nodes.flatMap(({ value, start, end }) => {
    const raw = document.source.slice(start, end);
    const identical = raw === value;
    const valueLines = identical ? [] : lineStarts(value);
    const valueEnds = valueLines.map((at) => lineEnd(value, at));
    const rawLines = identical ? [] : lineStarts(raw);
    const rawEnds = rawLines.map((at) => lineEnd(raw, at));
    if (
      valueLines.length !== rawLines.length ||
      valueLines.some(
        (from, line) =>
          !raw.slice(rawLines[line], rawEnds[line]).endsWith(value.slice(from, valueEnds[line])),
      )
    )
      return [];
    // Parsed values omit container prefixes; map each endpoint by its line's
    // unchanged suffix, also when the parser normalizes physical line endings.
    const offset = (at: number) => {
      if (identical) return start + at;
      const line = countBelow(valueLines, at + 1) - 1;
      return start + rawEnds[line]! - (valueEnds[line]! - at);
    };
    return htmlComments(value).flatMap((comment) => {
      const found = directive(comment.value);
      return found ? [{ ...found, start: offset(comment.start), end: offset(comment.end) }] : [];
    });
  });
}
/** Directives are recognized only in parsed HTML comments, never in code examples. */
export function suppressions(document: Document): (rule: string, finding: Finding) => boolean {
  // Directives can only appear in HTML comments containing this prefix.
  if (!document.source.includes("mdrefine-")) return () => false;
  const events: (Directive & { start: number; end: number })[] = [];
  let starts: number[] | undefined;
  let ends: number[] | undefined;
  for (const found of directives(document)) {
    const { start, end } = found;
    if (found.kind === "disable-next-line") {
      // The line after the directive's own, whichever of CommonMark's line endings ends each.
      starts ??= lineStarts(document.source);
      ends ??= starts.map((at) => lineEnd(document.source, at));
      const line = countBelow(starts, end + 1);
      const next = starts[line];
      if (next === undefined) continue;
      events.push({ ...found, start: next, end: ends[line]! });
    } else events.push({ ...found, start, end });
  }
  // Apply all-rule and named transitions to the same state for each rule.
  // Build its regions only when it reports a finding, and reuse them thereafter.
  const cache = new Map<string, { start: number; end: number }[]>();
  return (rule, finding) => {
    let intervals = cache.get(rule);
    if (!intervals) {
      intervals = [];
      let active: number | undefined;
      for (const event of events) {
        if (!event.rules.has("*") && !event.rules.has(rule)) continue;
        if (event.kind === "disable-next-line") intervals.push(event);
        else if (event.kind === "disable") active ??= event.end;
        else if (active !== undefined) {
          intervals.push({ start: active, end: event.start });
          active = undefined;
        }
      }
      if (active !== undefined) intervals.push({ start: active, end: document.source.length });
      cache.set(rule, intervals);
    }
    const start = finding.edit?.start ?? finding.start;
    const end = finding.edit?.end ?? finding.end ?? finding.start;
    return intervals.some((interval) => start <= interval.end && end >= interval.start);
  };
}
