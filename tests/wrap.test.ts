import { describe, expect, it } from "vitest";
import {
  builtInRules,
  createWorkspace,
  format,
  lint,
  parse,
  semanticFingerprint,
} from "../src/index.js";
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
  it.each([
    ["* [x]  done\n", "* [x]  done\n"],
    ["- [x]\tdone\n", "- [x]\tdone\n"],
    [
      "- [x] `code` word word word word word word word word word\n",
      "- [x] `code` word word word word word\n      word word word word\n",
    ],
    [
      "1. [ ] *em* text that is long enough to need wrapping at forty\n",
      "1. [ ] *em* text that is long enough to\n       need wrapping at forty\n",
    ],
    [
      "- [x] plain text that is long enough to need wrapping at forty\n",
      "- [x] plain text that is long enough to\n      need wrapping at forty\n",
    ],
  ])("keeps the checkbox and separator of task items (%j)", (source, output) => {
    expect(verify(source, { ...wrap(), dialect: "github" }).output).toBe(output);
  });
  it("reflows many paragraphs in linear time regardless of the line ending", () => {
    // Exercise the rule directly: the edit application and diagnostic positioning
    // costs of format() are measured separately.
    const paragraph = "word ".repeat(30).trim();
    const rule = builtInRules["style/wrap"]!;
    const build = (count: number) =>
      Array.from({ length: count }, () => paragraph).join("\n\n") + "\n";
    const check = (source: string) =>
      rule.check({ document: parse(source, "commonmark"), options: { width: 40 } });
    const lf = build(8000);
    const lfFindings = check(lf);
    expect(lfFindings).toHaveLength(8000);
    expect(check(lf.replaceAll("\n", "\r\n")).map((item) => item.edit?.text)).toEqual(
      lfFindings.map((item) => item.edit?.text.replaceAll("\n", "\r\n")),
    );
    expect(lfFindings[0]?.edit?.text.split("\n").every((line) => line.length <= 40)).toBe(true);
    // Quadrupling the input should cost about four times as much. The former
    // per-paragraph CRLF scan cost about twelve times as much on LF sources.
    const fastest = (source: string) => {
      const document = parse(source, "commonmark");
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        rule.check({ document, options: { width: 40 } });
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    expect(fastest(build(32000)) / fastest(lf)).toBeLessThan(8);
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

describe("Obsidian callout overflow", () => {
  const workspace = createWorkspace({}, { strictLineBreaks: true });
  const title =
    "[!custom-type]- A long title with ordinary words that must stay on one physical line";

  it("classifies the title independently of its spaces and inline markup", () => {
    for (const newline of ["\n", "\r\n"]) {
      for (const prefix of ["> ", "> > ", "- > "]) {
        for (const measure of ["columns", "codepoints"]) {
          for (const reportUnreflowed of [false, true]) {
            for (const reportUnbreakable of [false, true]) {
              const source = `${prefix}${title} **marked** 日本語${newline}`;
              const config: Config = {
                ...wrap({ width: 60, measure, reportUnreflowed, reportUnbreakable }),
                dialect: "obsidian",
              };
              const options = { config, workspace };
              const diagnostics = lint(source, options);
              expect(diagnostics).toHaveLength(reportUnbreakable ? 1 : 0);
              if (reportUnbreakable) {
                expect(diagnostics[0]?.message).toContain("unbreakable atom");
                expect(diagnostics[0]?.edit).toBeUndefined();
              }
              const result = format(source, options);
              expect(result.output).toBe(source);
              expect(result.diagnostics).toEqual(diagnostics);
              expect(format(result.output, options).output).toBe(source);
              expect(
                format(source, { config: { extends: [], dialect: "obsidian" }, workspace }).output,
              ).toBe(source);
            }
          }
        }
      }
    }
  });

  it("keeps body overflow separate from title overflow", () => {
    for (const reportUnreflowed of [false, true]) {
      for (const reportUnbreakable of [false, true]) {
        const source = `> ${title}\n> A long body with ordinary words that remains protected by a hard line break.  \n> Next line.\n`;
        const options = {
          config: {
            ...wrap({ width: 60, reportUnreflowed, reportUnbreakable }),
            dialect: "obsidian" as const,
          },
          workspace,
        };
        const diagnostics = lint(source, options);
        expect(diagnostics.map((item) => item.message)).toEqual([
          ...(reportUnbreakable
            ? ["Paragraph exceeds 60 columns because of an unbreakable atom."]
            : []),
          ...(reportUnreflowed
            ? ["Paragraph not reflowed: hard line break (width 60 columns)."]
            : []),
        ]);
        expect(format(source, options).output).toBe(source);
      }
    }
  });

  it("does not reclassify ordinary paragraphs, other dialects, or later quote paragraphs", () => {
    for (const [source, dialect] of [
      [`${title}\n`, "obsidian"],
      [`> Earlier paragraph.\n>\n> ${title}\n`, "obsidian"],
      [`> ${title}\n`, "commonmark"],
      [`> ${title}\n`, "github"],
      [
        "An ordinary paragraph with many breakable words and a trailing block identifier. ^block\n",
        "obsidian",
      ],
    ] as const) {
      const config: Config = {
        ...wrap({ width: 60, reportUnreflowed: true, reportUnbreakable: true }),
        dialect,
      };
      const diagnostics = lint(source, { config, workspace });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain("Paragraph not reflowed");
    }
  });

  it("does not report short titles or bypass strict line breaks", () => {
    const config: Config = {
      ...wrap({ reportUnreflowed: true, reportUnbreakable: true }),
      dialect: "obsidian",
    };
    expect(lint("> [!info] Short title\n", { config, workspace })).toEqual([]);
    expect(lint(`> ${title}\n`, { config })).toEqual([]);
  });
});
