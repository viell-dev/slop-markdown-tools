import { walk } from "../syntax/walk.js";
import type { Document, Finding } from "./types.js";
import { range } from "../syntax/parse.js";

/** Directives are recognized only in parsed HTML comments, never in code examples. */
export function suppressions(document: Document): (rule: string, finding: Finding) => boolean {
  // Directives can only appear in HTML comments containing this prefix.
  if (!document.source.includes("mdtools-")) return () => false;
  const intervals: { start: number; end: number; rules: Set<string> }[] = [];
  const active = new Map<string, number>();
  walk(document.tree, "html", (node) => {
    const match = /^<!--\s*mdtools-(disable-next-line|disable|enable)(?:\s+([^]*?))?\s*-->$/.exec(
      node.value.trim(),
    );
    if (!match) return;
    const names = match[2]
      ?.trim()
      .split(/[\s,]+/)
      .filter(Boolean) ?? ["*"];
    const rules = new Set(names.length ? names : ["*"]);
    const [start, end] = range(node);
    if (match[1] === "disable-next-line") {
      const next = document.source.indexOf("\n", end);
      if (next < 0) return;
      const last = document.source.indexOf("\n", next + 1);
      intervals.push({ start: next + 1, end: last < 0 ? document.source.length : last, rules });
    } else if (match[1] === "disable") {
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
