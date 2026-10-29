import { expect, it } from "vitest";
import { applyEdits, builtInRules, createWorkspace, format, parse } from "../../src/index.js";
import type { Config, Dialect, RuleSetting } from "../../src/index.js";
import { scaling } from "./scaling.js";
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

function headingWorkload(count: number) {
  const source = `${"## Heading\n\n".repeat(count)}*x*\n`;
  return { source, expected: source.replace("*x*", "_x_") };
}
const headingConfig = only(markers, "forgejo");
it("finds the text line of every heading before formatting emphasis", () => {
  // Every heading used to be searched for a `{` up to the end of the document.
  const { source, expected } = headingWorkload(20000);
  expect(formatted(source, headingConfig)).toBe(expected);
});

it("finds heading lines with linear scaling", () => {
  // Isolate the rule's heading scan so parsing cannot mask a quadratic search.
  const { check } = builtInRules["style/emphasis"]!;
  expect(
    scaling(
      [2000, 8000],
      (count) => {
        // Longer brace-free lines make the suffix search dominate its linear
        // traversal overhead in the recovered quadratic implementation.
        const source = `## ${"Heading ".repeat(16)}\n\n`.repeat(count) + "*x*\n";
        const input = { source, expected: source.replace("*x*", "_x_") };
        return { ...input, document: parse(input.source, "forgejo") };
      },
      ({ document }) => check({ document, options: { marker: "_" } }),
      (findings, { source, expected }) => {
        expect(findings).toHaveLength(2);
        expect(
          applyEdits(
            source,
            findings.map((finding) => finding.edit!),
          ),
        ).toBe(expected);
      },
      // Each large parsed tree is costly to prepare; its scan is measurable
      // on its own, without multiplying preparation into a suite bottleneck.
      1,
    ),
  ).toBeLessThan(10);
});

function linkedHeading(count: number) {
  const source = `## ${"[x](y.md) ".repeat(count)}{#h}\n`;
  const workspace = createWorkspace({ "Doc.md": source, "y.md": "" });
  return { source, workspace, expected: source.replaceAll("(y.md)", "(./y.md)") };
}
const pathConfig = only(
  { "links/path": ["warn", { style: "relative", leadingDot: true }] },
  "forgejo",
);
it("updates every link in a large heading while preserving its attribute", () => {
  const { source, workspace, expected } = linkedHeading(10000);
  const result = format(source, {
    config: pathConfig,
    path: "Doc.md",
    workspace,
  });
  expect(result.output).toBe(expected);
});

it("checks heading link attributes with linear scaling", () => {
  expect(
    scaling(
      [1000, 4000],
      linkedHeading,
      ({ source, workspace }) => format(source, { config: pathConfig, path: "Doc.md", workspace }),
      (result, { expected }) => {
        expect(result.output).toBe(expected);
        expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
      },
    ),
  ).toBeLessThan(10);
});

it("verifies spaced emphasis in one paragraph with linear scaling", () => {
  // Reading the paragraph again for each pair of markers took time that grew
  // with the square of their number; one reading checks them all.
  const { check } = builtInRules["content/emphasis-spacing"]!;
  expect(
    scaling(
      [250, 1000],
      (count) => {
        const source = `${Array.from({ length: count }, (_, line) => `Line ${line} has ** bold ** text.`).join("\n")}\n`;
        return { count, document: parse(source, "github") };
      },
      ({ document }) => check({ document, options: {} }),
      (findings, { count }) => expect(findings).toHaveLength(count),
      1,
    ),
  ).toBeLessThan(10);
});

it("verifies spaced emphasis in paragraphs that use a nested definition with linear scaling", () => {
  // A definition in a list item is not root-level, so a paragraph that uses
  // it reads differently on its own. Reading the whole document again for
  // each such paragraph took time that grew with the square of their number.
  const { check } = builtInRules["content/emphasis-spacing"]!;
  expect(
    scaling(
      [100, 400],
      (count) => {
        const paragraphs = Array.from(
          { length: count },
          (_, index) => `See [x] and ** b${index} ** here.`,
        );
        const source = `- [x]: https://example.com\n\n${paragraphs.join("\n\n")}\n`;
        return { count, source, document: parse(source, "github") };
      },
      ({ document }) => check({ document, options: {} }),
      (findings, { count, source }) => {
        expect(findings).toHaveLength(count);
        expect(source.slice(findings.at(-1)!.start, findings.at(-1)!.end)).toBe(
          `** b${count - 1} **`,
        );
      },
      1,
    ),
  ).toBeLessThan(10);
});
