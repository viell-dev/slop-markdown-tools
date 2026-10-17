import { walk } from "../syntax/walk.js";
import type { Document, Finding } from "./types.js";
import { range } from "../syntax/parse.js";

/** A suppression directive and the rules it names, `*` for all of them. */
export interface Directive {
  kind: "disable-next-line" | "disable" | "enable";
  rules: Set<string>;
}
/** The directive that an HTML node's value holds, if it is one. */
export function directive(value: string): Directive | undefined {
  const match = /^<!--\s*mdtools-(disable-next-line|disable|enable)(?:\s+([^]*?))?\s*-->$/.exec(
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
  if (!document.source.includes("mdtools-")) return () => false;
  const intervals: { start: number; end: number; rules: Set<string> }[] = [];
  const active = new Map<string, number>();
  walk(document.tree, "html", (node) => {
    const found = directive(node.value);
    if (!found) return;
    const { rules } = found;
    const [start, end] = range(node);
    if (found.kind === "disable-next-line") {
      // The line after the directive's own, whichever of CommonMark's line endings ends each.
      const lineBreak = /\r\n|\r|\n/g;
      lineBreak.lastIndex = end;
      const first = lineBreak.exec(document.source);
      if (!first) return;
      const next = first.index + first[0].length;
      lineBreak.lastIndex = next;
      const last = lineBreak.exec(document.source);
      intervals.push({ start: next, end: last ? last.index : document.source.length, rules });
    } else if (found.kind === "disable") {
      for (const rule of rules) if (!active.has(rule)) active.set(rule, end);
    } else {
      for (const rule of rules.has("*") ? active.keys() : rules) {
        const from = active.get(rule);
        if (from !== undefined) intervals.push({ start: from, end: start, rules: new Set([rule]) });
        active.delete(rule);
      }
    }
  });
  for (const [rule, start] of active)
    intervals.push({ start, end: document.source.length, rules: new Set([rule]) });
  return (rule, finding) =>
    intervals.some((interval) => {
      const start = finding.edit?.start ?? finding.start;
      const end = finding.edit?.end ?? finding.end ?? finding.start;
      return (
        (interval.rules.has("*") || interval.rules.has(rule)) &&
        start <= interval.end &&
        end >= interval.start
      );
    });
}
