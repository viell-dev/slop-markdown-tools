import { expect, it } from "vitest";
import { unifiedDiff } from "../../src/index.js";
const diff = (before: string, after: string) =>
  unifiedDiff("a/note.md", "b/note.md", before, after);

it("takes time in proportion to the document's length when every paragraph changes", () => {
  const document = (count: number, separator: string) =>
    Array.from(
      { length: count },
      (_, n) =>
        `Paragraph ${n} has a sentence that runs past the limit,${separator}so it wraps.\n\n`,
    ).join("");
  const fastest = (count: number) => {
    const before = document(count, " ");
    const after = document(count, "\n");
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      diff(before, after);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  // Four times the paragraphs should cost about four times as much. The diff
  // of the whole texts cost about sixteen times as much, and some 30 seconds
  // for 8,000 paragraphs; the bound leaves room for noisy CI runners.
  expect(fastest(4000) / fastest(1000)).toBeLessThan(10);
}, 60_000);
