import { describe, expect, it } from "vitest";
import { createWorkspace, format, lint, parse, semanticFingerprint } from "../src/index.js";
import type { Config } from "../src/index.js";

function wrap(options: Record<string, unknown> = {}): Config {
  return { extends: [], rules: { "style/wrap": ["warn", { width: 40, ...options }] } };
}
function verify(source: string, config: Config) {
  const result = format(source, { config });
  expect(result.diagnostics.some((item) => item.rule.startsWith("engine/"))).toBe(false);
  expect(semanticFingerprint(parse(result.output, config.dialect ?? "commonmark"))).toBe(
    semanticFingerprint(parse(source, config.dialect ?? "commonmark")),
  );
  expect(format(result.output, { config }).output).toBe(result.output);
  return result;
}
describe("wrapping controls", () => {
  it.each(["2015.", "-", "#", ">", "1)", "***"])("moves the preceding word with %s", (marker) => {
    const source = `aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb ${marker} Its move is Happy Hour.\n`;
    const result = verify(source, wrap());
    expect(result.output).toBe(
      `aaaa aaaa aaaa aaaa aaaa aaaa aaaa\nbbbb ${marker} Its move is Happy Hour.\n`,
    );
    expect(format(source, { config: { extends: [] } }).output).toBe(source);
  });
  it("groups consecutive protected markers", () => {
    const result = verify("aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb # > tail\n", wrap());
    expect(result.output).toContain("\nbbbb # > tail");
  });
  it("counts Unicode scalar values when requested", () => {
    const source = "aaaa aaaa aaaa aaaa aaaa 日本語 🙂 e\u0301 ending\n";
    expect(verify(source, wrap({ measure: "codepoints" })).output).toBe(source);
    expect(verify(source, wrap()).output).not.toBe(source);
    expect(
      lint(source, { config: wrap({ width: 30, measure: "codepoints" }) })[0]?.message,
    ).toContain("code points");
  });
  it.each([
    ["A long line with many words that will not be reflowed.  \nNext line.\n", "hard line break"],
    ["A long line with many words that will not be reflowed. ^id\n", "block identifier"],
    [
      "A long line with a `code span that crosses\na line` and more words than the configured width.\n",
      "multiline inline syntax",
    ],
    ["A long line with <b>inline HTML</b> and many more words.\n", "inline HTML"],
  ])("optionally reports protected over-width paragraphs", (source, reason) => {
    const result = verify(source!, wrap({ reportUnreflowed: true }));
    expect(result.output).toBe(source);
    expect(result.diagnostics[0]?.message).toContain(reason);
    expect(result.diagnostics[0]?.edit).toBeUndefined();
    expect(lint(source!, { config: wrap() })).toEqual([]);
  });
  it.each([
    "[a label](<https://example.test/a long path with protected spaces>)",
    "![an image](https://example.test/a-very-long-unbreakable-image)",
    "`a code span with spaces that cannot be split by wrapping`",
    "**an emphasized phrase that the wrapper preserves as one atom**",
    "an_indivisible_word_that_exceeds_the_configured_width",
  ])("classifies protected hard-break atoms independently: %s", (atom) => {
    for (const newline of ["\n", "\r\n"]) {
      for (const hardBreak of ["  ", "\\"]) {
        for (const [prefix, continuation] of [
          ["", ""],
          ["- ", "  "],
          ["> ", "> "],
          ["- [ ] ", "      "],
        ]) {
          const source = `${prefix}${atom}${hardBreak}${newline}${continuation}(source):${newline}`;
          for (const reportUnreflowed of [false, true]) {
            for (const reportUnbreakable of [false, true]) {
              const result = verify(source, {
                ...wrap({ reportUnreflowed, reportUnbreakable }),
                dialect: "github",
              });
              expect(result.output).toBe(source);
              expect(result.diagnostics).toHaveLength(reportUnbreakable ? 1 : 0);
              if (reportUnbreakable) {
                expect(result.diagnostics[0]?.message).toContain("unbreakable atom");
                expect(result.diagnostics[0]?.edit).toBeUndefined();
              }
            }
          }
        }
      }
    }
  });
  it("counts original text whitespace while keeping adjacent inline nodes together", () => {
    const spaced = "word" + " ".repeat(40) + "word  \nnext\n";
    expect(verify(spaced, wrap({ reportUnreflowed: true })).diagnostics[0]?.message).toContain(
      "hard line break",
    );
    const adjacent = `${"x".repeat(25)}[a label](target)  \nnext\n`;
    const result = verify(adjacent, wrap({ reportUnreflowed: true, reportUnbreakable: true }));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("unbreakable atom");
  });
  it("reports both causes in a mixed protected paragraph", () => {
    const source =
      "Many ordinary words on a line that could be made shorter.  \n" +
      "[label](https://example.test/a-very-long-unbreakable-link)\n";
    for (const reportUnreflowed of [false, true]) {
      for (const reportUnbreakable of [false, true]) {
        const result = verify(source, wrap({ reportUnreflowed, reportUnbreakable }));
        expect(result.output).toBe(source);
        expect(result.diagnostics.map((item) => item.message)).toEqual([
          ...(reportUnreflowed
            ? ["Paragraph not reflowed: hard line break (width 40 columns)."]
            : []),
          ...(reportUnbreakable
            ? ["Paragraph exceeds 40 columns because of an unbreakable atom."]
            : []),
        ]);
      }
    }
  });
  it("uses container width and excludes hard-break syntax from atom width", () => {
    for (const hardBreak of ["  ", "\\"]) {
      const options = { reportUnreflowed: true, reportUnbreakable: true };
      expect(verify(`${"x".repeat(40)}${hardBreak}\nnext\n`, wrap(options)).diagnostics).toEqual(
        [],
      );
      expect(
        verify(`- ${"x".repeat(40)}${hardBreak}\n  next\n`, wrap(options)).diagnostics[0]?.message,
      ).toContain("unbreakable atom");
    }
  });
  it("honors width measurement and the Obsidian strict-line-break gate", () => {
    const source = `- [${"界".repeat(12)}](x)  \n  next\n`;
    const workspace = createWorkspace(
      { "note.md": source },
      { dialect: "obsidian", strictLineBreaks: true },
    );
    for (const measure of ["columns", "codepoints"]) {
      const config: Config = {
        ...wrap({ width: 30, measure, reportUnreflowed: true, reportUnbreakable: true }),
        dialect: "obsidian",
      };
      expect(lint(source, { config })).toEqual([]);
      const result = format(source, { config, workspace });
      expect(result.output).toBe(source);
      expect(result.diagnostics).toHaveLength(measure === "columns" ? 1 : 0);
      expect(result.diagnostics.every((item) => item.message.includes("unbreakable atom"))).toBe(
        true,
      );
    }
  });
  it("optionally reports unbreakable overflow after formatting", () => {
    const source = "[label](https://example.test/a-very-long-unbreakable-link)\n";
    const result = verify(source, wrap({ reportUnbreakable: true }));
    expect(result.diagnostics[0]?.message).toContain("unbreakable atom");
    expect(result.diagnostics[0]?.edit).toBeUndefined();
    expect(lint(source, { config: wrap() })).toEqual([]);
  });
});
describe("multiline code spans", () => {
  const config: Config = {
    extends: [],
    rules: { "style/inline-code": "warn", "style/wrap": ["warn", { width: 40 }] },
  };
  it.each(["\n", "\r\n", "\r"])(
    "normalizes only code line endings in fingerprints (%j)",
    (newline) => {
      expect(semanticFingerprint(parse(`A \`one${newline}two\`.`, "commonmark"))).toBe(
        semanticFingerprint(parse("A `one two`.", "commonmark")),
      );
      expect(semanticFingerprint(parse("A `one  two`.", "commonmark"))).not.toBe(
        semanticFingerprint(parse("A `one two`.", "commonmark")),
      );
    },
  );
  it.each([
    ["A `one\ntwo` here.\n", "A `one two` here.\n"],
    ["> A `one\n> two` here.\n", "> A `one two` here.\n"],
    ["- A `one\n  two` here.\n", "- A `one two` here.\n"],
    ["A `` `one\ntwo` `` here.\n", "A `` `one two` `` here.\n"],
    ["A `  one\ntwo  ` here.\n", "A `  one two  ` here.\n"],
    ["A ` \n ` here.\n", "A `   ` here.\n"],
    ["A `one\r\ntwo` here.\r\n", "A `one two` here.\r\n"],
  ])("joins parsed code without deleting content or container syntax", (source, expected) => {
    expect(verify(source!, config).output).toBe(expected);
    expect(format(source!, { config: { extends: [] } }).output).toBe(source);
  });
});
