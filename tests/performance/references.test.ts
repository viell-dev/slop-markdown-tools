import { expect, it } from "vitest";
import { builtInRules, parse } from "../../src/index.js";
import { scaling } from "./scaling.js";
const rule = "links/undefined-reference";
const { check: scan } = builtInRules[rule]!;

function referenceWorkload(count: number) {
  const documents = [
    parse(`${"Text.\n\n".repeat(count)}[a][b]\n`, "github"),
    parse(`${`[a][${"b".repeat(990)}] `.repeat(count / 100)}\n`, "github"),
    parse(`${`[${"a ".repeat(400)}][] `.repeat(count / 200)}\n`, "github"),
    parse(`${`[^${"x".repeat(990)}`.repeat(count / 100)}\n`, "github"),
    // A math opener without a closer, many times over.
    parse(`${"\\( ".repeat(count)}[a][b]\n\n${"Text.\n\n".repeat(count)}\\)\n`, "forgejo"),
  ];
  return { documents, expected: [1, count / 100, count / 200, 0, 1] };
}
it("finds references in large documents with adversarial bracket and math sequences", () => {
  const { documents } = referenceWorkload(20000);
  const counts = documents.map((document) => scan({ document, options: {} }).length);
  expect(counts).toEqual([1, 200, 100, 0, 1]);
}, 60_000);

it("scans references with linear scaling", () => {
  // Parsing is excluded: some adversarial bracket runs cost the parser quadratic time.
  expect(
    scaling(
      [1000, 4000],
      referenceWorkload,
      ({ documents }) => documents.map((document) => scan({ document, options: {} }).length),
      (counts, { expected }) => expect(counts).toEqual(expected),
    ),
  ).toBeLessThan(10);
});
