import type { Nodes } from "mdast";
import { afterAll, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { collectGithubLazyHtmlProtections } from "../../src/syntax/github-protections.js";
import { blockCounter, countDocumentReads } from "./document-work.js";
import { lazyHtmlCases } from "./lazy-html-cases.js";

// Nothing else in this file may call the collector: V8 counts its blocks only if
// it is first compiled after this starts, which is why this file is separate.
const counter = blockCounter("src/syntax/");
afterAll(() => counter.stop());

// Counted work repeats exactly, so small documents are enough, and quadratic
// variants finish quickly rather than running for minutes under observation.
const sizes = [200, 800] as const;

function expectProportionalWork({ prefix, unit, regions }: (typeof lazyHtmlCases)[number]) {
  const [small, large] = sizes.map((count) => {
    const document = parse(prefix + unit.repeat(count), "github");
    const {
      result: { result: found, reads },
      blocks,
    } = counter.measure(() =>
      countDocumentReads(document, (observed) => {
        const found = new Set<Nodes>();
        collectGithubLazyHtmlProtections(observed, found);
        return found;
      }),
    );
    expect(found.size).toBe(regions(count));
    for (const node of found)
      expect(node.position!.end.offset).toBeLessThanOrEqual(document.source.length);
    return { reads, blocks };
  });
  // Four times the units should take four times the work, a growth of 1. Binary
  // searches add a logarithm: at most log(1600) / log(400), or 1.23, here. Counts
  // do not vary, so the bound can sit just above that: at 1.25, a quadratic term
  // fails once it is about 9% of the work at the smaller size. Each count alone
  // misses some quadratic variants: reads cannot see loops over local data, and
  // blocks cannot see inside a native search.
  const growth = (work: number, base: number) => work / ((sizes[1] / sizes[0]) * base);
  const evidence = JSON.stringify({ sizes, small, large });
  expect(growth(large!.reads, small!.reads), evidence).toBeLessThan(1.25);
  expect(growth(large!.blocks, small!.blocks), evidence).toBeLessThan(1.25);
}

it.each(lazyHtmlCases)(
  "does work in proportion to the document for GitHub's lazy HTML in $name (#762, #826)",
  expectProportionalWork,
);

// Every region here shares a distant blank line, so each walks the top-level
// blocks up to it.
it.fails("does work in proportion to regions that share a distant blank line (#889)", () => {
  expectProportionalWork({
    name: "alternating containers",
    prefix: "",
    unit: "- a\n<b>\n> q\n<b>\n",
    regions: (count) => 2 * count,
  });
});
