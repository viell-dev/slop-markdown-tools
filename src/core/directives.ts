import { walk } from "../syntax/walk.js";
import type { Document, Finding } from "./types.js";
import { range } from "../syntax/parse.js";
import { lineBreakMatcher } from "../syntax/source.js";

/** A suppression directive and the rules it names, `*` for all of them. */
export interface Directive {
  kind: "disable-next-line" | "disable" | "enable";
  rules: Set<string>;
}
/** The directive that an HTML node's value holds, if it is one. */
export function directive(value: string): Directive | undefined {
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
/** Directives are recognized only in parsed HTML comments, never in code examples. */
export function suppressions(document: Document): (rule: string, finding: Finding) => boolean {
  // Directives can only appear in HTML comments containing this prefix.
  if (!document.source.includes("mdrefine-")) return () => false;
  const events: (Directive & { start: number; end: number })[] = [];
  walk(document.tree, "html", (node) => {
    const found = directive(node.value);
    if (!found) return;
    const [start, end] = range(node);
    if (found.kind === "disable-next-line") {
      // The line after the directive's own, whichever of CommonMark's line endings ends each.
      const lineBreak = lineBreakMatcher();
      lineBreak.lastIndex = end;
      const first = lineBreak.exec(document.source);
      if (!first) return;
      const next = first.index + first[0].length;
      lineBreak.lastIndex = next;
      const last = lineBreak.exec(document.source);
      events.push({ ...found, start: next, end: last ? last.index : document.source.length });
    } else events.push({ ...found, start, end });
  });
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
