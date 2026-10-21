import { expect, it } from "vitest";
import { builtInRules, parse } from "../../src/index.js";
const rule = "links/undefined-reference";

it("scans in time linear in the length of the document", () => {
  // Timed apart from parsing, which takes quadratic time on some runs of brackets.
  const { check: scan } = builtInRules[rule]!;
  const documents = [
    parse(`${"Text.\n\n".repeat(20000)}[a][b]\n`, "github"),
    parse(`${`[a][${"b".repeat(990)}] `.repeat(200)}\n`, "github"),
    parse(`${`[${"a ".repeat(400)}][] `.repeat(100)}\n`, "github"),
    parse(`${`[^${"x".repeat(990)}`.repeat(200)}\n`, "github"),
    // A math opener without a closer, many times over.
    parse(`${"\\( ".repeat(20000)}[a][b]\n\n${"Text.\n\n".repeat(20000)}\\)\n`, "forgejo"),
  ];
  const started = performance.now();
  const counts = documents.map((document) => scan({ document, options: {} }).length);
  expect(counts).toEqual([1, 200, 100, 0, 1]);
  // The scans take some 50 milliseconds; quadratic ones would take many seconds.
  expect(performance.now() - started).toBeLessThan(3000);
}, 60_000);
