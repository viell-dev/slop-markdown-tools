import { createTwoFilesPatch } from "diff";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../../src/index.js";

/** The diff of the command, between two versions of `note.md`. */
const diff = (before: string, after: string) =>
  unifiedDiff("a/note.md", "b/note.md", before, after);
/** The diff of the whole texts by `createTwoFilesPatch`, which the command printed before. */
const whole = (before: string, after: string) =>
  createTwoFilesPatch("a/note.md", "b/note.md", before, after);
/** The headers of the diff. */
const header = `${"=".repeat(67)}\n--- a/note.md\n+++ b/note.md\n`;
/** The lines of `text`, each with its line break. */
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * The text that `patch` makes of `before`, applying each hunk exactly where its
 * header says. It checks what `git apply` and `patch` rely on, more strictly:
 * the headers, the line counts, that the removed and kept lines are there, and
 * that a hunk shows four kept lines before and after its changes, or as many
 * as there are, and takes in a change that follows within eight.
 */
function apply(before: string, patch: string): string {
  const source = lines(before);
  expect(patch.startsWith(header)).toBe(true);
  const rest = patch.slice(header.length).split("\n");
  expect(rest.pop()).toBe("");
  const output: string[] = [];
  let taken = 0;
  let first = true;
  for (let index = 0; index < rest.length;) {
    const range = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(rest[index++]!);
    expect(range, rest[index - 1]).not.toBeNull();
    const [oldStart, oldCount, newStart, newCount] = range!.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const old: string[] = [];
    const added: string[] = [];
    let kinds = "";
    for (; index < rest.length && !rest[index]!.startsWith("@@"); index++) {
      const line = rest[index]!;
      // The line before it has no line break.
      if (line === "\\ No newline at end of file") {
        if (!kinds.endsWith("+")) old.push(old.pop()!.slice(0, -1));
        if (!kinds.endsWith("-")) added.push(added.pop()!.slice(0, -1));
        continue;
      }
      const kind = line[0]!;
      expect(" -+").toContain(kind);
      kinds += kind;
      if (kind !== "+") old.push(`${line.slice(1)}\n`);
      if (kind !== "-") added.push(`${line.slice(1)}\n`);
    }
    expect([old.length, added.length]).toEqual([oldCount, newCount]);
    // A hunk without old or new lines names the line after which it applies.
    const at = oldCount === 0 ? oldStart : oldStart - 1;
    const end = at + oldCount;
    // Hunks whose contexts would touch are one, so a line lies between hunks.
    if (!first) expect(at).toBeGreaterThan(taken);
    first = false;
    const leading = /^ */.exec(kinds)![0].length;
    const trailing = / *$/.exec(kinds)![0].length;
    expect(leading).toBe(Math.min(4, at + leading));
    expect(trailing).toBe(Math.min(4, source.length - end + trailing));
    expect(kinds.slice(leading, kinds.length - trailing)).not.toMatch(/ {9}/);
    expect(source.slice(at, end)).toEqual(old);
    output.push(...source.slice(taken, at));
    expect(output.length).toBe(newCount === 0 ? newStart : newStart - 1);
    output.push(...added);
    taken = end;
  }
  return [...output, ...source.slice(taken)].join("");
}

describe("the diff that format prints", () => {
  // Twenty numbered lines, with the lines named in `changed` replaced.
  const numbered = (...changed: number[]) =>
    Array.from({ length: 20 }, (_, index) =>
      changed.includes(index + 1) ? `changed ${index + 1}\n` : `${index + 1}\n`,
    ).join("");
  it.each([
    ["a line added", "a\nb\n", "a\nnew\nb\n"],
    ["a line removed", "a\nold\nb\n", "a\nb\n"],
    ["a line replaced", "a\nold\nb\n", "a\nnew\nb\n"],
    ["lines replaced by more lines", "a\nold\nb\n", "a\nnew\nlines\nb\n"],
    ["a change at the start", numbered(), numbered(1)],
    ["a change at the end", numbered(), numbered(20)],
    ["the final line break removed", "a\nb\n", "a\nb"],
    ["a final line break added", "a\nb", "a\nb\n"],
    ["a last line without a line break changed", "a\nb", "a\nc"],
    ["a last line without a line break kept", "a\nb\nc", "x\nb\nc"],
    ["CRLF line endings", "a\r\nold\r\nb\r\n", "a\r\nnew\r\nb\r\n"],
    ["changes whose contexts touch", numbered(), numbered(5, 14)],
    ["changes whose contexts do not touch", numbered(), numbered(5, 15)],
    ["a document that changes completely", "a\nb\n", "c\nd\ne\n"],
    ["an empty document", "", "a\n"],
    ["a document emptied", "a\n", ""],
  ])("shows %s as a diff of the whole texts does", (_, before, after) => {
    expect(diff(before, after)).toBe(whole(before, after));
    expect(apply(before, diff(before, after))).toBe(after);
  });
  it("merges hunks whose contexts touch and keeps the others apart", () => {
    const context = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, index) => ` ${from + index}\n`).join("");
    expect(diff(numbered(), numbered(5, 14))).toBe(
      `${header}@@ -1,18 +1,18 @@\n${context(1, 4)}-5\n+changed 5\n${context(6, 13)}` +
        `-14\n+changed 14\n${context(15, 18)}`,
    );
    expect(diff(numbered(), numbered(5, 15))).toBe(
      `${header}@@ -1,9 +1,9 @@\n${context(1, 4)}-5\n+changed 5\n${context(6, 9)}` +
        `@@ -11,9 +11,9 @@\n${context(11, 14)}-15\n+changed 15\n${context(16, 19)}`,
    );
  });
  it("marks a last line without a line break and keeps carriage returns", () => {
    expect(diff("a\nb", "a\nc\n")).toBe(
      `${header}@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n`,
    );
    expect(diff("a\r\nb\r\n", "a\r\nc\r\n")).toBe(`${header}@@ -1,2 +1,2 @@\n a\r\n-b\r\n+c\r\n`);
  });
  // Lines from a small set, which repeat as blank lines and markers do, and a
  // version changed by removing, replacing, and adding a few lines at a time.
  const line = fc.oneof(
    fc.constantFrom("", "", "a", "b", "# Heading", "- item", "---", "```"),
    fc.nat({ max: 400 }).map((number) => `Line ${number}`),
  );
  const versions = (length: number) =>
    fc
      .tuple(
        fc.array(line, { maxLength: length }),
        fc.array(fc.tuple(fc.nat(), fc.nat({ max: 3 }), fc.array(line, { maxLength: 4 })), {
          maxLength: Math.ceil(length / 10),
        }),
        fc.constantFrom("\n", "\r\n"),
        fc.boolean(),
        fc.boolean(),
      )
      .map(([original, edits, ending, oldEnd, newEnd]) => {
        const changed = [...original];
        for (const [at, removed, added] of edits)
          changed.splice(at % (changed.length + 1), removed, ...added);
        const text = (lines: string[], final: boolean) =>
          lines.join(ending) + (final && lines.length ? ending : "");
        return [text(original, oldEnd), text(changed, newEnd)] as const;
      })
      .filter(([before, after]) => before !== after);
  it("matches a diff of the whole texts on small documents", () => {
    // Both versions together have fewer lines than one run of the line diff compares.
    fc.assert(
      fc.property(versions(30), ([before, after]) => {
        expect(diff(before, after)).toBe(whole(before, after));
      }),
      { numRuns: 500, seed: 20261018 },
    );
  });
  it("turns long documents into their new version", () => {
    fc.assert(
      fc.property(versions(600), ([before, after]) => {
        expect(apply(before, diff(before, after))).toBe(after);
      }),
      { numRuns: 200, seed: 20261018 },
    );
  });
  it("matches a diff of the whole texts on long documents that change throughout", () => {
    const numbers = Array.from({ length: 300 }, (_, index) => index);
    const pairs: [string, string][] = [
      // Every paragraph rewrapped, as in issue #310.
      [
        numbers
          .map((n) => `Paragraph ${n} is one long line that the formatter wraps.\n\n`)
          .join(""),
        numbers
          .map((n) => `Paragraph ${n} is one long line\nthat the formatter wraps.\n\n`)
          .join(""),
      ],
      // A table whose rows all change, one region larger than the line diff compares.
      [
        `# Table\n\n${numbers.map((n) => `| ${n} | x |\n`).join("")}\nEnd.\n`,
        `# Table\n\n${numbers.map((n) => `| ${n}   | x   |\n`).join("")}\nEnd.\n`,
      ],
      [
        numbers.map((n) => `Line ${n}\r\n`).join(""),
        `New\r\n\r\n${numbers
          .map((n) => `Line ${n}\r\n`)
          .join("")
          .slice(0, -2)}`,
      ],
    ];
    for (const [before, after] of pairs) {
      expect(diff(before, after)).toBe(whole(before, after));
      expect(apply(before, diff(before, after))).toBe(after);
    }
  });
  it("keeps unchanged paragraphs as context when the blank lines around changes move", () => {
    const blocks = Array.from({ length: 40 }, (_, index) => index);
    const before = blocks.map((n) => `* Item ${n}\n\n\nParagraph ${n} stays.\n\n`).join("");
    const after = blocks.map((n) => `- Item ${n}\n\nParagraph ${n} stays.\n\n`).join("");
    const printed = diff(before, after);
    expect(apply(before, printed)).toBe(after);
    // Pairing the blank lines alone would show the paragraphs as removed and added again.
    expect(printed).not.toMatch(/^[-+]Paragraph/m);
    // As many lines change as in a diff of the whole texts.
    const changed = (patch: string) =>
      patch
        .slice(header.length)
        .split("\n")
        .filter((line) => /^[-+]/.test(line)).length;
    expect(changed(printed)).toBe(changed(whole(before, after)));
  });
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
});
