import { expect, it } from "vitest";
import { builtInRules, createWorkspace, format, parse } from "../../src/index.js";
import type { Config, Dialect, RuleSetting } from "../../src/index.js";
const markers = { "style/emphasis": "warn", "style/strong": "warn" } as const;

function only(rules: Record<string, RuleSetting>, dialect: Dialect = "commonmark"): Config {
  return { extends: [], dialect, rules };
}

/** Format, require no engine diagnostics, and require idempotence. */
function formatted(source: string, config: Config, options: Record<string, unknown> = {}) {
  const result = format(source, { config, ...options });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config, ...options }).output).toBe(result.output);
  return result.output;
}
it.each(["forgejo", "gitea"] as const)(
  "check many emphases on one line in linear time on %s",
  (dialect) => {
    const rule = builtInRules["style/emphasis"]!;
    const count = 3000;
    const oneLine = parse(`${"word _emphasis_ ".repeat(count).trim()}\n`, dialect);
    const manyLines = parse("word _emphasis_\n".repeat(count), dialect);
    const check = (document: ReturnType<typeof parse>) =>
      rule.check({ document, options: { marker: "*" } });
    expect(check(oneLine)).toHaveLength(2 * count);
    expect(check(manyLines)).toHaveLength(2 * count);
    const fastest = (document: ReturnType<typeof parse>) => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        check(document);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    // The same emphases on short lines are the baseline. Searching the line
    // of each emphasis took hundreds of times as long on one line.
    expect(fastest(oneLine) / fastest(manyLines)).toBeLessThan(5);
  },
);

it("finds heading lines in time proportional to the document", () => {
  // Every heading used to be searched for a `{` up to the end of the document.
  const source = `${"## Heading\n\n".repeat(20000)}*x*\n`;
  const start = performance.now();
  expect(formatted(source, only(markers, "forgejo"))).toBe(source.replace("*x*", "_x_"));
  expect(performance.now() - start).toBeLessThan(10000);
});

it("checks a heading with many links in time proportional to its length", () => {
  const source = `## ${"[x](y.md) ".repeat(10000)}{#h}\n`;
  const workspace = createWorkspace({ "Doc.md": source, "y.md": "" });
  const start = performance.now();
  const result = format(source, {
    config: only({ "links/path": ["warn", { style: "relative", leadingDot: true }] }, "forgejo"),
    path: "Doc.md",
    workspace,
  });
  expect(result.output).toBe(source.replaceAll("(y.md)", "(./y.md)"));
  expect(performance.now() - start).toBeLessThan(10000);
});
