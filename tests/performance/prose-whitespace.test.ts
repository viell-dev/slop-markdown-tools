import { expect, it } from "vitest";
import { applyEdits, builtInRules, parse } from "../../src/index.js";
import { scaling } from "./scaling.js";

it("checks tabs across many literal and prose ranges with near-linear scaling", () => {
  const ratio = scaling(
    [1000, 4000],
    (count) => {
      const source =
        Array.from(
          { length: count },
          (_, i) => `Word *e${i}*\tmore \`c${i}\`\ttext  here [l](u${i})`,
        ).join("\n\n") + "\n";
      return { source, count, document: parse(source, "github") };
    },
    ({ document }) => builtInRules["style/no-tabs"]!.check({ document, options: {} }),
    (findings, { count, source }) => {
      expect(findings).toHaveLength(count * 2);
      expect(
        applyEdits(
          source,
          findings.map((finding) => finding.edit!),
        ),
      ).toBe(source.replaceAll("\t", " "));
    },
    1,
  );
  // Four times the paragraphs measured 2.6x after indexing versus 15.8x with
  // the original scans. Ten allows runner noise while rejecting that regression.
  expect(ratio).toBeLessThan(10);
});

it("collapses many space runs on one long line with near-linear scaling", () => {
  const ratio = scaling(
    [2000, 8000],
    (count) => {
      const source = `${Array.from({ length: count }, (_, i) => `w${i}`).join("  ")}\n`;
      return { source, count, document: parse(source, "github") };
    },
    ({ document }) => builtInRules["style/prose-space"]!.check({ document, options: {} }),
    (findings, { count, source }) => {
      expect(findings).toHaveLength(count - 1);
      expect(
        applyEdits(
          source,
          findings.map((finding) => finding.edit!),
        ),
      ).toBe(source.replaceAll("  ", " "));
    },
    1,
  );
  // Slicing the line for each run grew with the square of the line's length.
  expect(ratio).toBeLessThan(10);
});
