import type { Nodes } from "mdast";
import { expect, it } from "vitest";
import { applyEdits, format, lint, parse, resolveConfig } from "../../src/index.js";
import type { Config, Document, Plugin, ProcessOptions } from "../../src/index.js";
import { rendererProtections } from "../../src/syntax/renderer-protections.js";
import { collectGithubLazyHtmlProtections } from "../../src/syntax/github-protections.js";
import { scaling } from "./scaling.js";
const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };

it("scans a comment's long marker line without quadratic backtracking (#492)", () => {
  expect(
    scaling(
      [10000, 40000],
      (count) => parse(`- a\n<!--\n- ${" ".repeat(count)}x\n`, "obsidian"),
      (document) => rendererProtections(document),
      (result, document) => {
        expect([...result.itemHtml].map((node) => node.position)).toEqual([
          {
            start: { line: 1, column: 4, offset: 3 },
            end: { line: 4, column: 1, offset: document.source.length },
          },
        ]);
      },
      1,
    ),
  ).toBeLessThan(10);
}, 120_000);

it("scans a shared Obsidian table-row region once (#505)", () => {
  expect(
    scaling(
      [800, 3200],
      (count) => parse("a | b\n-- | --\n# row | b\n".repeat(count), "obsidian"),
      (document) => rendererProtections(document),
      (result, document) => {
        expect(
          [...result.tableText].some(
            (node) =>
              node.position!.start.offset! < document.source.indexOf("# row") &&
              node.position!.end.offset === document.source.length - 1,
          ),
        ).toBe(true);
      },
      4,
    ),
  ).toBeLessThan(10);
});

it.each([
  { name: "independent", shared: false },
  { name: "shared", shared: true },
])("scans $name top-level HTML continuations proportionally (#546)", ({ shared }) => {
  // Many roots exercise constant-time identity lookup; a single continuation
  // must visit each gap once. Parse distinct trees before timing so neither
  // the parser's work nor the range cache hides the continuation scan.
  const raw = "<div></div>\n \n> first\n>\n> *literal*\n";
  const unit = shared ? `${raw} \n` : `${raw}\nAfter *safe*.\n\n`;
  const shown = [
    [raw.indexOf("\n>\n") + 1, 1],
    [raw.indexOf("*literal*"), "*literal*".length],
  ] as const;
  const sizes = [800, 3200] as const;
  // Parse each real fixture once. These HTML/text/emphasis trees carry all
  // guard inputs in their own fields; cloning preserves their source positions.
  // Every timed call still gets a fresh tree, so the range cache cannot hide work.
  const templates = new Map<number, Document>(
    sizes.map((count) => {
      const source = unit.repeat(count) + (shared ? "\nAfter *safe*.\n" : "");
      return [count, parse(source, "obsidian")] as const;
    }),
  );
  expect(
    scaling(
      sizes,
      (count) => {
        const template = templates.get(count)!;
        return { document: { ...template, tree: structuredClone(template.tree) }, count };
      },
      ({ document }) => rendererProtections(document),
      (result, { document, count }) => {
        const ranges = [...result.htmlText]
          .map((node) => [node.position!.start.offset!, node.position!.end.offset!] as const)
          .sort(([a], [b]) => a - b);
        let next = 0;
        let end = 0;
        let allProtected = true;
        // Bare quote-only gaps have no parsed leaf, but are literal HTML text too.
        for (let index = 0; index < count; index++)
          for (const [relative, length] of shown) {
            const start = index * unit.length + relative;
            while (next < ranges.length && ranges[next]![0] <= start)
              end = Math.max(end, ranges[next++]![1]);
            if (end < start + length) allProtected = false;
          }
        expect(allProtected).toBe(true);
        expect(result.htmlCodeToEnd).toBe(false);
        const outside = document.source.lastIndexOf("After *safe*.");
        expect(outside).toBeGreaterThan(0);
        expect(
          [...result.htmlText].some(
            (node) =>
              node.position!.start.offset! <= outside && outside < node.position!.end.offset!,
          ),
        ).toBe(false);
      },
      4,
    ),
  ).toBeLessThan(10);
  // This fixture has no ticks: each native lookup searches its whole remaining
  // receiver. Observe the real guard after timing to reject the former unbounded
  // suffix search even when native search is too fast to dominate elapsed time.
  const work = sizes.map((count) => {
    const template = templates.get(count)!;
    const document = { ...template, tree: structuredClone(template.tree) };
    // Called with an explicit receiver below, then restored in finally.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const native = String.prototype.indexOf;
    let volume = 0;
    let unexpected = false;
    let result: ReturnType<typeof rendererProtections> | undefined;
    try {
      String.prototype.indexOf = function (this: string, needle: string, from = 0) {
        const found = native.call(this, needle, from);
        if (needle === "\u0060") {
          unexpected ||= found !== -1 || !Number.isInteger(from) || from < 0;
          volume += Math.max(0, this.length - Math.min(this.length, from));
        }
        return found;
      };
      result = rendererProtections(document);
    } finally {
      String.prototype.indexOf = native;
    }
    // Restore before assertions or the comparison guard can make other calls.
    expect(unexpected).toBe(false);
    const expected = rendererProtections(template);
    // Both traversals preserve insertion order. Comparing arrays retains every
    // node field without unordered Set equality revisiting all pairs of nodes.
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      const actualValue = result[key];
      const expectedValue = expected[key];
      expect(typeof actualValue === "boolean" ? actualValue : [...actualValue]).toEqual(
        typeof expectedValue === "boolean" ? expectedValue : [...expectedValue],
      );
    }
    expect(volume).toBeGreaterThan(0);
    return volume;
  });
  expect(work[1]! / work[0]!).toBeLessThan(6);
});

function formatted(source: string, options: ProcessOptions = {}) {
  const result = format(source, options);
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  return result.output;
}
function findingWorkload(count: number) {
  return {
    count,
    source: Array.from({ length: count }, (_, i) => `Paragraph ${i}.`).join("\n\n") + "\n",
  };
}
const linePlugin: Plugin = {
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
const lineOptions: ProcessOptions = {
  config: { extends: [], rules: { "probe/lines": "warn" } },
  plugins: [linePlugin],
};
it("locates many findings at their source positions", () => {
  const { source } = findingWorkload(30000);
  const diagnostics = lint(source, lineOptions);
  expect(diagnostics).toHaveLength(60001);
  for (const item of diagnostics.filter((_, index) => index % 997 === 0 || index > 59998)) {
    const prefix = source.slice(0, item.start);
    expect([item.line, item.column]).toEqual([
      prefix.split("\n").length,
      item.start - prefix.lastIndexOf("\n"),
    ]);
  }
});

it("locates findings with linear scaling", () => {
  expect(
    scaling(
      [3000, 12000],
      findingWorkload,
      ({ source }) => lint(source, lineOptions),
      (diagnostics, { source, count }) => {
        expect(diagnostics).toHaveLength(2 * count + 1);
        expect(diagnostics.at(-1)).toMatchObject({
          start: source.length,
          line: 2 * count,
          column: 1,
        });
      },
    ),
  ).toBeLessThan(10);
});

it("skips nested comment openers in time proportional to their number", () => {
  // #418: every nested opener searched the same suffix for the same closer.
  // Time only range discovery, on distinct trees so the cache cannot hide it.
  const sizes = [4000, 16000];
  const prepare = (count: number) => parse(`==${"a <!-- ".repeat(count)}b -->==\n`, "obsidian");
  // Warm both workloads on other documents, so the first large sample is
  // not also a cold compilation sample. Every timed call still has a fresh tree.
  for (let round = 0; round < 5; round++)
    for (const size of sizes) expect(rendererProtections(prepare(size)).commentText.size).toBe(0);
  const elapsed = (documents: Document[]) => {
    const results = [];
    const started = performance.now();
    for (const document of documents) results.push(rendererProtections(document));
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

function carriedRuns(count: number): string {
  return "a ``` b\n\n<div>\nc ``` " + "d ` e\n".repeat(count) + "</div>\n\nf *g*\n";
}
it("pairs carried backtick runs without changing the following emphasis", () => {
  // A line each, so that no run of one closes another, in an HTML block,
  // which the parser reads without inline syntax (issue #151).
  const source = carriedRuns(20_000);
  const output = formatted(source, { config });
  expect(output.endsWith("\nf _g_\n")).toBe(true);
});

it("pairs carried backtick runs with linear scaling", () => {
  expect(
    scaling(
      [2000, 8000],
      carriedRuns,
      (source) => format(source, { config }),
      (result) => {
        expect(result.output.endsWith("\nf _g_\n")).toBe(true);
        expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
      },
    ),
  ).toBeLessThan(10);
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

function editWorkload(count: number) {
  const source = Array.from({ length: count }, (_, i) => `Paragraph ${i} with *emphasis*.`).join(
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
  return { source, edits, expected };
}
it("applies many edits with insertions at both ends", () => {
  const { source, edits, expected } = editWorkload(20000);
  const output = applyEdits(source, edits);
  expect(output).toBe(expected);
  expect(applyEdits(source, [])).toBe(source);
});

it("applies edits with linear scaling", () => {
  expect(
    scaling(
      // The smaller pair varied from 5x to 11x on Node 26 despite more warm-up.
      // This larger pair keeps the same bound and rejects the former assembler.
      [8000, 32000],
      editWorkload,
      ({ source, edits }) => applyEdits(source, edits),
      (output, { expected }) => expect(output).toBe(expected),
    ),
  ).toBeLessThan(10);
});

it.each([
  {
    name: "separate containers",
    prefix: "",
    unit: "- item *a*\n<b>\n*w*\n\n> quote\n</b>\n*w*\n\nText.\n\n",
    regions: (count: number) => 2 * count,
  },
  { name: "one paragraph", prefix: "- a\n", unit: "<b>\nwords *a*\n", regions: () => 1 },
  { name: "lines without tags", prefix: "- a <i>\n", unit: "words and more\n", regions: () => 0 },
  {
    name: "headings and definitions",
    prefix: "",
    unit: "- [x]: /u\n[y]: /v\n<b>\n*w*\n\n> a *w\n<i>\nx* y\n> ===\n\nText.\n\n",
    regions: (count: number) => 2 * count,
  },
  { name: "one item's definitions", prefix: "- [a]: /u\n", unit: "[b]: </v>\n", regions: () => 0 },
])(
  "finds GitHub's lazy HTML ranges in $name proportionally (#762)",
  ({ prefix, unit, regions }) => {
    // Each paragraph line is read once; a stretch's lines share one search for
    // the next blank line, and one forward search finds each `<`.
    // One 8,000-unit document is timed against four separately parsed
    // 2,000-unit documents: the same work when it is linear, so both timed
    // windows last about as long. A window four times longer than the other is
    // likelier to lose time to collection or to other processes, and that
    // inflated the growth past the bound (#774). The bound still allows 2.5
    // times linear growth, as 10 did for four times the size.
    const sizes: [number, number] = [2000, 8000];
    const documents = new Map(
      sizes.map(
        (count) =>
          [
            count,
            Array.from({ length: sizes[1] / count }, () =>
              parse(prefix + unit.repeat(count), "github"),
            ),
          ] as const,
      ),
    );
    expect(
      scaling(
        sizes,
        (count) => ({ documents: documents.get(count)!, count }),
        ({ documents }) =>
          documents.map((document) => {
            const found = new Set<Nodes>();
            collectGithubLazyHtmlProtections(document, found);
            return found;
          }),
        (results, { documents, count }) => {
          expect(results).toHaveLength(documents.length);
          results.forEach((found, index) => {
            expect(found.size).toBe(regions(count));
            for (const node of found)
              expect(node.position!.end.offset).toBeLessThanOrEqual(
                documents[index]!.source.length,
              );
          });
        },
      ),
    ).toBeLessThan(2.5);
  },
  // Parsing the documents takes most of the time.
  120_000,
);
