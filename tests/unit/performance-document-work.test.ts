import { expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { countDocumentReads } from "../performance/document-work.js";

const document = parse("first\n\nsecond\n", "github");
const reads = (run: Parameters<typeof countDocumentReads>[1]) =>
  countDocumentReads(document, run).reads;

it("counts each character read from the source", () => {
  expect(reads(({ source }) => [source[0], source[1], source[source.length - 1]])).toBe(3);
});

it("counts what native source searches pass over", () => {
  // Through the first `s` at offset 3, then to the end of the 14 characters.
  expect(reads(({ source }) => source.indexOf("s"))).toBe(4);
  expect(reads(({ source }) => source.indexOf("s", 2))).toBe(2);
  expect(reads(({ source }) => source.indexOf("missing"))).toBe(14);
  expect(reads(({ source }) => source.includes("missing", 4))).toBe(10);
  expect(reads(({ source }) => source.slice(7, 13))).toBe(6);
});

it("returns what the source itself returns", () => {
  const { source } = document;
  const { result } = countDocumentReads(document, ({ source: observed }) => [
    observed.length,
    observed[1],
    observed.indexOf("s", 4),
    observed.includes("missing"),
    observed.slice(0, 5),
  ]);
  expect(result).toEqual([
    source.length,
    source[1],
    source.indexOf("s", 4),
    false,
    source.slice(0, 5),
  ]);
});

it("counts what regular expressions pass over from where they start", () => {
  const blank = /\n\n/g;
  expect(
    reads(({ source }) => {
      blank.lastIndex = 2;
      return blank.exec(source);
    }),
  ).toBe(5);
  expect(blank.lastIndex).toBe(7);
  // A failed search reaches the end of its input, and `test` goes through `exec`.
  expect(reads(({ source }) => /missing/.exec(source))).toBe(14);
  expect(reads(() => /b/.test("abc"))).toBe(2);
});

it("counts tree reads, including those inside native array searches", () => {
  const scan = reads(({ tree }) => tree.children.indexOf(tree.children[1]!));
  // A native search reads `length` and each index that it compares.
  const lookup = reads(({ tree }) => tree.children[1]);
  expect(scan).toBeGreaterThan(lookup + 2);
  const { result } = countDocumentReads(document, ({ tree }) =>
    tree.children.indexOf(tree.children[1]!),
  );
  expect(result).toBe(1);
});

it("refuses a use of the source that it cannot count", () => {
  // Compared below, never called, to prove that a failure restores it.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const exec = RegExp.prototype.exec;
  expect(() => reads(({ source }) => source.lastIndexOf("s"))).toThrow(
    "Uncounted source use: lastIndexOf",
  );
  expect(() => reads(({ source }) => [...source])).toThrow("Uncounted source use");
  // `test` converts its input before `exec` could count the scan.
  expect(() => reads(({ source }) => /s/.test(source))).toThrow("Uncounted source use");
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(RegExp.prototype.exec).toBe(exec);
});
