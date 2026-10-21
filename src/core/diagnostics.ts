import type { Diagnostic, Finding } from "./types.js";

/** Locate one finding with the source's physical line index. */
export function diagnostic(
  starts: number[],
  rule: string,
  severity: "warn" | "error",
  finding: Finding,
): Diagnostic {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= finding.start) low = middle;
    else high = middle - 1;
  }
  return { ...finding, rule, severity, line: low + 1, column: finding.start - starts[low]! + 1 };
}

/** Order tied rule IDs by UTF-16 code units, independent of locale. */
export const sortDiagnostics = (a: Diagnostic, b: Diagnostic) =>
  a.start - b.start || (a.rule === b.rule ? 0 : a.rule < b.rule ? -1 : 1);
