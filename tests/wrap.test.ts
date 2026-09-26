import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  builtInRules,
  canonicalDialect,
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
  const dialect = canonicalDialect(config.dialect ?? "commonmark");
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
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
  it.each(["~~~", "```", "$$", "<!--", "<div", "[^1]:", "--", "==", "="])(
    "keeps %s attached to the preceding word instead of opening a block",
    (atom) => {
      const source = `aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb ${atom} more words follow here.\n`;
      const result = verify(source, { ...wrap(), dialect: "github" });
      expect(result.output).toBe(
        `aaaa aaaa aaaa aaaa aaaa aaaa aaaa\nbbbb ${atom} more words follow here.\n`,
      );
    },
  );
  it("keeps an Obsidian comment opener attached to the preceding word", () => {
    const config: Config = { ...wrap(), dialect: "obsidian" };
    const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
    const source = "aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb %% more words follow here.\n";
    const result = format(source, { config, workspace });
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
    expect(result.output).toBe(
      "aaaa aaaa aaaa aaaa aaaa aaaa aaaa\nbbbb %% more words follow here.\n",
    );
  });
  it("keeps a trailing backslash away from the end of a line", () => {
    const source = "aaaa aaaa aaaa aaaa aaaa aaaa aaaa C:\\ more words follow here.\n";
    expect(verify(source, wrap()).output).toBe(
      "aaaa aaaa aaaa aaaa aaaa aaaa aaaa\nC:\\ more words follow here.\n",
    );
    const escaped = "aaaa aaaa aaaa aaaa aaaa aaaa aaaa C:\\\\ more words follow here.\n";
    expect(verify(escaped, wrap()).output).toBe(
      "aaaa aaaa aaaa aaaa aaaa aaaa aaaa C:\\\\\nmore words follow here.\n",
    );
  });
  it("reflows randomly generated paragraphs with block-like atoms without rejection", () => {
    const atoms = fc.constantFrom(
      "word",
      "longer-word",
      "--",
      "-",
      "=",
      "==",
      "***",
      "~~~",
      "```",
      "$$",
      "<!--",
      "<div",
      "[^1]:",
      "#",
      ">",
      "1.",
      "2)",
      "C:\\",
      "\\",
      "\\\\",
      "*em*",
      "`code`",
      "[x]",
    );
    const prefixes = fc.constantFrom("", "- ", "* [x] ", "- [ ]  ", "1. ", "> ");
    fc.assert(
      fc.property(
        prefixes,
        fc.array(atoms, { minLength: 1, maxLength: 25 }),
        fc.integer({ min: 20, max: 60 }),
        (prefix, words, width) => {
          const source = `${prefix}${words.join(" ")}\n`;
          const config: Config = { ...wrap({ width }), dialect: "github" };
          const result = format(source, { config });
          expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
          expect(format(result.output, { config }).output).toBe(result.output);
          expect(semanticFingerprint(parse(result.output, "github"))).toBe(
            semanticFingerprint(parse(source, "github")),
          );
        },
      ),
      { numRuns: 400, seed: 20260921 },
    );
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
    // per-paragraph CRLF scan cost about twelve times as much on LF sources;
    // the bound leaves room for noisy CI runners on both sides.
    const fastest = (source: string) => {
      const document = parse(source, "commonmark");
      let best = Infinity;
      for (let run = 0; run < 5; run++) {
        const started = performance.now();
        rule.check({ document, options: { width: 40 } });
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    expect(fastest(build(32000)) / fastest(lf)).toBeLessThan(10);
  });
  it("keeps carriage-return line endings consistent across rules and passes", () => {
    const config: Config = {
      extends: ["recommended", "github"],
      dialect: "github",
      rules: { "style/wrap": ["warn", { width: 20 }] },
    };
    expect(verify("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii\rjjjj\r", config).output).toBe(
      "aaaa bbbb cccc dddd\reeee ffff gggg hhhh\riiii jjjj\r",
    );
    expect(verify("# Title\r\r| a | b |\r|---|---|\r| 1 | 2 |\r\rone two", config).output).toBe(
      "# Title\r\r| a   | b   |\r| --- | --- |\r| 1   | 2   |\r\rone two\r",
    );
    // The first line ending decides for documents that mix endings.
    expect(verify("one\r\ntwo\nthree four five six seven eight nine\n", config).output).toBe(
      "one two three four\r\nfive six seven eight\r\nnine\n",
    );
    expect(verify("one\rtwo\r\nthree four five six seven eight nine", config).output).toBe(
      "one two three four\rfive six seven eight\rnine\r",
    );
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
describe("Forgejo syntax", () => {
  const forgejo: Config = { ...wrap(), dialect: "forgejo" };
  const github: Config = { ...wrap(), dialect: "github" };
  const reporting: Config = {
    ...wrap({ reportUnreflowed: true }),
    dialect: "forgejo",
  };
  it("keeps a definition list's lines and reports why", () => {
    const source =
      "Term\n: A definition that is long enough to reflow at forty columns.\n\nNext.\n";
    expect(verify(source, forgejo).output).toBe(source);
    expect(format(source, { config: github }).output).not.toBe(source);
    expect(lint(source, { config: reporting })[0]?.message).toContain("Forgejo definition list");
  });
  it("keeps a list item's definition list intact", () => {
    const source = "- Term\n  : A definition that is long enough to reflow at forty.\n";
    expect(verify(source, forgejo).output).toBe(source);
  });
  it("keeps display math lines", () => {
    const source = "\\[\na + b + a sum that is long enough to reflow\n\\]\n";
    expect(verify(source, forgejo).output).toBe(source);
    expect(format(source, { config: github }).output).toBe(
      "\\[ a + b + a sum that is long enough to\nreflow \\]\n",
    );
    expect(lint(source, { config: reporting })[0]?.message).toContain("Forgejo display math");
  });
  it.each([":", "\\[", "\\[x\\]"])(
    "keeps %s attached to the preceding word instead of opening a block",
    (atom) => {
      const source = `aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb ${atom} more words follow here.\n`;
      expect(verify(source, forgejo).output).toBe(
        `aaaa aaaa aaaa aaaa aaaa aaaa aaaa\nbbbb ${atom} more words follow here.\n`,
      );
      expect(verify(source, github).output).toBe(
        `aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb\n${atom} more words follow here.\n`,
      );
    },
  );
  it("treats `:` without following whitespace as prose", () => {
    const source = "aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb :emoji: more words follow here.\n";
    const output = "aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb\n:emoji: more words follow here.\n";
    expect(verify(source, forgejo).output).toBe(output);
    expect(verify(source, github).output).toBe(output);
    const lines = "Term\n:emoji: is not a definition, so this paragraph reflows at forty.\n";
    expect(verify(lines, forgejo).output).toBe(verify(lines, github).output);
    expect(verify(lines, forgejo).output).not.toBe(lines);
  });
  it("counts one-line pairs as single atoms in skipped paragraphs", () => {
    const source = "Text \\(a formula with spaces that is wider than forty columns\\)  \nnext\n";
    const config: Config = { ...wrap({ reportUnbreakable: true }), dialect: "forgejo" };
    const messages = lint(source, { config }).map((item) => item.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("unbreakable atom");
    expect(lint(source, { config: { ...config, dialect: "github" } })).toEqual([]);
    expect(lint(source, { config: reporting })[0]?.message).toContain("hard line break");
  });
  it("keeps inline math and shortlinks on one physical line", () => {
    const source = "Some words \\(a + b\\) and [[This is a link|https://codeberg.org]] end here.\n";
    expect(verify(source, forgejo).output).toBe(
      "Some words \\(a + b\\) and\n[[This is a link|https://codeberg.org]]\nend here.\n",
    );
    const lines = verify(source, github).output.split("\n");
    expect(lines.some((line) => line.includes("[[") && !line.includes("]]"))).toBe(true);
  });
  it("protects spans that cross inline markup and container continuations", () => {
    expect(verify("aaaa aaaa aaaa aaaa aaaa aaaa \\(a **b c** d\\) more\n", forgejo).output).toBe(
      "aaaa aaaa aaaa aaaa aaaa aaaa\n\\(a **b c** d\\) more\n",
    );
    expect(verify("- aaaa aaaa\n  aaaa aaaa aaaa aaaa \\(a b\\) cccc\n", forgejo).output).toBe(
      "- aaaa aaaa aaaa aaaa aaaa aaaa \\(a b\\)\n  cccc\n",
    );
  });
  it("leaves a paragraph alone when a pair spans lines", () => {
    const source = "Text \\(a\nb\\) more words that would otherwise reflow onto one line.\n";
    expect(verify(source, forgejo).output).toBe(source);
    expect(lint(source, { config: reporting })[0]?.message).toContain("spanning lines");
    const shortlink = "Text [[a\nb]] more words that would otherwise reflow onto one line.\n";
    expect(verify(shortlink, forgejo).output).toBe(shortlink);
  });
  it.each([
    "Some words [[This is a link|https://codeberg.org]] end here.\n",
    "Some words x|www.example.com and [www.example.com] end here.\n",
  ])(
    "wraps %j, which only GitHub's transform-time pass linkifies, in every GFM dialect",
    (source) => {
      for (const config of [github, forgejo, { ...wrap(), dialect: "obsidian" as const }]) {
        const workspace = createWorkspace({}, { strictLineBreaks: true });
        const result = format(source, { config, workspace });
        expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
        expect(result.output.split("\n").length).toBeGreaterThan(2);
      }
      expect(
        verify("A plain https://example.com/path link and a@b.co mail.\n", github).output,
      ).toBe("A plain https://example.com/path link\nand a@b.co mail.\n");
    },
  );
  it("still reflows unpaired markers", () => {
    const source = "Text \\(a b and [[c d more words that would otherwise reflow onto one line.\n";
    expect(verify(source, forgejo).output).toBe(
      "Text \\(a b and [[c d more words that\nwould otherwise reflow onto one line.\n",
    );
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
