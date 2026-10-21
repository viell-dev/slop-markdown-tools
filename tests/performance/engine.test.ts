import { expect, it } from "vitest";
import { applyEdits, format, lint, parse, resolveConfig } from "../../src/index.js";
import type { Config, Document, Plugin, ProcessOptions } from "../../src/index.js";
import { misreadLists } from "../../src/syntax/misread-lists.js";
const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };

function formatted(source: string, options: ProcessOptions = {}) {
  const result = format(source, options);
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  return result.output;
}
it("locates many findings without rescanning the source for each one", () => {
  const source = Array.from({ length: 30000 }, (_, i) => `Paragraph ${i}.`).join("\n\n") + "\n";
  const plugin: Plugin = {
    name: "probe",
    rules: {
      lines: {
        kind: "problem",
        description: "Report every line start and the final offset",
        check: ({ document }) => {
          const findings = [{ start: 0, message: "line" }];
          for (
            let at = document.source.indexOf("\n");
            at >= 0;
            at = document.source.indexOf("\n", at + 1)
          )
            findings.push({ start: at + 1, message: "line" });
          findings.push({ start: document.source.length, message: "end" });
          return findings;
        },
      },
    },
  };
  const started = performance.now();
  const diagnostics = lint(source, {
    config: { extends: [], rules: { "probe/lines": "warn" } },
    plugins: [plugin],
  });
  // Generous for slow CI runners; the previous prefix-scanning code needed minutes here.
  expect(performance.now() - started).toBeLessThan(12000);
  expect(diagnostics).toHaveLength(60001);
  for (const item of diagnostics.filter((_, index) => index % 997 === 0 || index > 59998)) {
    const prefix = source.slice(0, item.start);
    expect([item.line, item.column]).toEqual([
      prefix.split("\n").length,
      item.start - prefix.lastIndexOf("\n"),
    ]);
  }
});

it("skips nested comment openers in time proportional to their number", () => {
  // #418: every nested opener searched the same suffix for the same closer.
  // Time only range discovery, on distinct trees so the cache cannot hide it.
  const sizes = [4000, 16000];
  const prepare = (count: number) => parse(`==${"a <!-- ".repeat(count)}b -->==\n`, "obsidian");
  // Warm both workloads on other documents, so the first large sample is
  // not also a cold compilation sample. Every timed call still has a fresh tree.
  for (let round = 0; round < 5; round++)
    for (const size of sizes) expect(misreadLists(prepare(size)).commentText.size).toBe(0);
  const elapsed = (documents: Document[]) => {
    const results = [];
    const started = performance.now();
    for (const document of documents) results.push(misreadLists(document));
    const duration = performance.now() - started;
    for (const result of results) expect(result.commentText.size).toBe(0);
    return duration;
  };
  const calibration = Math.min(...Array.from({ length: 3 }, () => elapsed([prepare(sizes[0]!)])));
  // Use the same bounded batch size for both inputs. Parsing is outside the
  // timed section; the cap bounds the cost of constructing distinct trees.
  const calls = Math.max(1, Math.min(32, Math.ceil(25 / calibration)));
  const fastest = [Infinity, Infinity];
  for (let round = 0; round < 4; round++) {
    const documents = sizes.map((size) => Array.from({ length: calls }, () => prepare(size)));
    for (const index of round % 2 ? [1, 0] : [0, 1])
      fastest[index] = Math.min(fastest[index]!, elapsed(documents[index]!));
  }
  // Four times the input should take about four times the work, not sixteen.
  // Paired batches alternate their order and keep the existing scaling bound.
  expect(fastest[1]! / fastest[0]!).toBeLessThan(10);
}, 120_000);

it("pairs the runs below such a run in time linear in their number", () => {
  // A line each, so that no run of one closes another, in an HTML block,
  // which the parser reads without inline syntax (issue #151).
  const source = `a \`\`\` b\n\n<div>\nc \`\`\` ${"d ` e\n".repeat(20_000)}</div>\n\nf *g*\n`;
  const started = performance.now();
  const output = formatted(source, { config });
  expect(performance.now() - started).toBeLessThan(10_000);
  expect(output.endsWith("\nf _g_\n")).toBe(true);
});

it("matches override patterns without compiling them for every document", () => {
  const paths = Array.from({ length: 5000 }, (_, index) => `docs/part-${index % 50}/${index}.md`);
  // Patterns that match none of the paths, so that each is tried for each.
  const files = Array.from({ length: 8 }, (_, index) => `drafts-${index}/**/*.md`);
  const overridden: Config = { overrides: [{ files, rules: { "style/wrap": "off" } }] };
  const fastest = (config: Config) => {
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      for (const path of paths) resolveConfig({ config, path });
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  expect(resolveConfig({ config: overridden, path: "drafts-3/a/b.md" }).rules["style/wrap"]).toBe(
    "off",
  );
  // Resolving without overrides is the baseline. Compiling the patterns for
  // each document took about fifteen times as long as that.
  expect(fastest(overridden) / fastest({})).toBeLessThan(6);
});

it("applies many edits in linear time", () => {
  const source = Array.from({ length: 20000 }, (_, i) => `Paragraph ${i} with *emphasis*.`).join(
    "\n\n",
  );
  const edits = [];
  for (let at = source.indexOf("*"); at >= 0; at = source.indexOf("*", at + 1))
    edits.push({ start: at, end: at + 1, text: "_" });
  edits.push(
    { start: 0, end: 0, text: "# Title\n\n" },
    { start: source.length, end: source.length, text: "\n" },
  );
  // The reference is linear on purpose: sequential splicing is the behaviour under test.
  const expected = `# Title\n\n${source.replaceAll("*", "_")}\n`;
  const started = performance.now();
  const output = applyEdits(source, edits);
  expect(performance.now() - started).toBeLessThan(5000);
  expect(output).toBe(expected);
  expect(applyEdits(source, [])).toBe(source);
});
