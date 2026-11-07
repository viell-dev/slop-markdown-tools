import { expect, it, vi } from "vitest";
import { builtInRules, parse } from "../../src/index.js";
import { scaling } from "./scaling.js";

const work = vi.hoisted(() => ({ longest: 0, characters: 0 }));
vi.mock("sentence-splitter", async (importOriginal) => {
  const original = await importOriginal<typeof import("sentence-splitter")>();
  return {
    ...original,
    split(...args: Parameters<typeof original.split>) {
      work.longest = Math.max(work.longest, args[0].length);
      work.characters += args[0].length;
      return original.split(...args);
    },
  };
});

const rule = builtInRules["style/wrap"]!;
it("bounds recognizer input for repeated abbreviations in a large paragraph", () => {
  // An unbounded split() retains abbreviation ranges and searches that growing
  // list for every character. Count the actual detector input, alongside output
  // assertions, so replacing local detection with a whole-paragraph call fails.
  const count = 4000;
  const source = "Dr. Smith stays. ".repeat(count).trimEnd();
  work.longest = work.characters = 0;
  const findings = rule.check({
    document: parse(source, "github"),
    options: { mode: "sentences", width: 80 },
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.edit?.text).toBe(Array(count).fill("Dr. Smith stays.").join("\n"));
  expect(work.longest).toBeLessThanOrEqual(770);
  expect(work.characters).toBeLessThan(source.length * 10);
});

it("bounds unbreakable word context without losing its source", () => {
  const word = "a".repeat(50000) + ".";
  work.longest = 0;
  const findings = rule.check({
    document: parse(`${word} Next sentence.`, "github"),
    options: { mode: "sentences", width: 80 },
  });
  expect(findings[0]?.edit?.text).toBe(`${word}\nNext sentence.`);
  expect(work.longest).toBeLessThanOrEqual(770);
});

it.each(["one paragraph", "many paragraphs"])(
  "keeps sentence wrapping growth bounded for %s",
  (shape) => {
    const growth = scaling(
      [200, 800],
      (count) => ({
        count,
        document: parse(
          Array(count)
            .fill("Dr. Smith stays. Next sentence.")
            .join(shape === "one paragraph" ? " " : "\n\n"),
          "github",
        ),
      }),
      ({ document }) => rule.check({ document, options: { mode: "sentences", width: 80 } }),
      (findings, { count }) => {
        expect(findings).toHaveLength(shape === "one paragraph" ? 1 : count);
        expect(
          findings.every((finding) =>
            finding.edit?.text.includes("Dr. Smith stays.\nNext sentence."),
          ),
        ).toBe(true);
      },
      1,
    );
    expect(growth).toBeLessThan(10);
  },
);
