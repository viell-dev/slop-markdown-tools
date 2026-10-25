import type { InlineCode, Nodes } from "mdast";
import { expect } from "vitest";
import { format, parse } from "../../src/index.js";
import type { Config, Dialect, RuleSetting } from "../../src/index.js";

export function only(rules: Record<string, RuleSetting>, dialect: Dialect = "commonmark"): Config {
  return { extends: [], dialect, rules };
}
/** Format, require no engine diagnostics, and require idempotence. */
export function formatted(source: string, config: Config, options: Record<string, unknown> = {}) {
  const result = format(source, { config, ...options });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config, ...options }).output).toBe(result.output);
  return result.output;
}
/** The engine's diagnostics of a formatting result; the refused rules' own findings stay too. */
export const refusals = (result: { diagnostics: { rule: string }[] }) =>
  result.diagnostics.filter((item) => item.rule.startsWith("engine/"));
/** The code spans of a document, in order. */
export function codeSpans(source: string, dialect: Dialect): InlineCode[] {
  const spans: InlineCode[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "inlineCode") spans.push(node);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(parse(source, dialect).tree);
  return spans;
}
