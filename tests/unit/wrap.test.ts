import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  builtInRules,
  createWorkspace,
  format,
  lint,
  parse,
  resolveConfig,
  semanticFingerprint,
} from "../../src/index.js";
import type { Config, Workspace } from "../../src/index.js";

function wrap(options: Record<string, unknown> = {}): Config {
  return { extends: [], rules: { "style/wrap": ["warn", { width: 40, ...options }] } };
}
function verify(source: string, config: Config, workspace?: Workspace) {
  const options = { config, ...(workspace ? { workspace } : {}) };
  const result = format(source, options);
  expect(result.diagnostics.some((item) => item.rule.startsWith("engine/"))).toBe(false);
  const { dialect } = resolveConfig(config);
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  expect(format(result.output, options).output).toBe(result.output);
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
    // The performance assertion is the ratio above, not a duration, so slow
    // runners get a longer limit than the 15-second default. Windows CI runners
    // have needed 6 to 15 seconds.
  }, 60_000);
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
      "A long line with $math that crosses\na line$ and more words than the configured width.\n",
      "line break in math",
    ],
    [
      "A long line with [a link](https://example.test\n'and its title') and more words than the width.\n",
      "line break in a link destination or title",
    ],
    [
      "- A list item with more words than the configured width.\n one space short\n",
      "unsupported continuation",
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
    "[label](<https://example.test/a long path with protected spaces>)",
    "![an image](https://example.test/a-very-long-unbreakable-image)",
    "`a code span with spaces that cannot be split by wrapping`",
    "$a formula with spaces that the wrapper preserves as one atom$",
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
    const adjacent = `${"x".repeat(25)}[a_label](target)  \nnext\n`;
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
describe("a block marker as a paragraph's first word", () => {
  // Directly below text, the parser reads a marker that would open an empty
  // list item, or one not starting at 1, as text, and the text continues on
  // the next line. Joining the lines would open a list there.
  const config: Config = {
    ...wrap(),
    dialect: "github",
    rules: { ...wrap().rules, "style/emphasis": "warn" },
  };
  it.each([
    ["Sub *a*\n- -\nmore\n", "Sub _a_\n- -\nmore\n"],
    ["Sub *a*\n> - -\nmore\n", "Sub _a_\n> - -\nmore\n"],
    [
      "*A*\n\n1. [b]: /u\n   - -\n       indented code\n",
      "_A_\n\n1. [b]: /u\n   - -\n       indented code\n",
    ],
  ])("keeps %j as written and still formats the rest", (source, output) => {
    expect(verify(source, config).output).toBe(output);
    // The default configuration refused all three documents before.
    const engine = format(source).diagnostics.filter((item) => item.rule.startsWith("engine/"));
    expect(engine).toEqual([]);
  });
  it.each(["-", "+", "*", "1.", "1)", "2."])("keeps `- %s` and the line below it", (marker) => {
    const source = `Sub\n- ${marker}\nmore words\n`;
    expect(verify(source, config).output).toBe(source);
  });
  it("keeps the body of an Obsidian callout that starts with a marker", () => {
    const source = "> [!note] Title\n> 1.\n> more words\n";
    const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
    const result = format(source, { config: { ...wrap(), dialect: "obsidian" }, workspace });
    expect(result.output).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });
  it("keeps a bare colon on Forgejo and Gitea, where it could start a definition", () => {
    const source = "Term\n\n:\nDefinition text\n";
    expect(verify(source, { ...wrap(), dialect: "forgejo" }).output).toBe(source);
    expect(verify(source, { ...wrap(), dialect: "gitea" }).output).toBe(source);
    expect(verify(source, { ...wrap(), dialect: "github" }).output).toBe(
      "Term\n\n: Definition text\n",
    );
  });
  it("reports such a paragraph as not reflowed on request", () => {
    const source = "Sub\n- 1.\nmore words that make this paragraph longer than forty columns\n";
    const result = verify(source, wrap({ reportUnreflowed: true }));
    expect(result.output).toBe(source);
    expect(result.diagnostics.map((item) => item.message)).toEqual([
      "Paragraph not reflowed: leading block marker (width 40 columns).",
    ]);
    expect(lint(source, { config: wrap() })).toEqual([]);
  });
  it.each([
    "-5 degrees",
    "#hashtag",
    "*emphasis*",
    "1.5 litres",
    "1234567890. ten digits",
    "2024 was",
  ])("still reflows a paragraph that starts with %j", (start) => {
    const source = `${start} and many more words than forty columns allow here.\n`;
    const output = verify(source, wrap()).output;
    expect(output).not.toBe(source);
    expect(output.replace(/\n(?!$)/g, " ")).toBe(source);
  });
});
describe("words that could open a block at the start of a line", () => {
  it.each(["--config", "*delta*", "#tag", "#123", "-5", "+1", "1.5", "***bold***", "=>", "|x|"])(
    "lets the ordinary word %s start a line",
    (word) => {
      const source = `aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb ${word} more words follow here.\n`;
      expect(verify(source, { ...wrap(), dialect: "github" }).output).toBe(
        `aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb\n${word} more words follow here.\n`,
      );
    },
  );
  it("keeps a sentence of command-line options within the width", () => {
    const source =
      "Pass --config, --root, --dialect, --width, --max-warnings, --fix, --check, and --diff to the command when you need them.\n";
    expect(verify(source, { ...wrap({ width: 30 }), dialect: "github" }).output).toBe(
      "Pass --config, --root,\n--dialect, --width,\n--max-warnings, --fix,\n--check, and --diff to the\ncommand when you need them.\n",
    );
  });
  it.each([
    ["* * *", true],
    ["- - -", true],
    ["_ _ _", true],
    ["** *", true],
    ["__ _", true],
    ["-- -", true],
    ["= =", true],
    // CommonMark has no tables.
    ["| --- | --- |", false],
    [":-- --:", false],
  ] as const)(
    "keeps the words of %j off the start of a line, which they would make a block",
    (words, everywhere) => {
      for (const width of [20, 25, 30, 40]) {
        for (const dialect of ["commonmark", "github", "obsidian"] as const) {
          if (dialect === "commonmark" && !everywhere) continue;
          const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
          const source = `Header a | b and more words ${words} and words after them ${words}\n`;
          const output = verify(source, { ...wrap({ width }), dialect }, workspace).output;
          for (const line of output.split("\n").slice(1))
            expect(line.startsWith(words.slice(0, 2)), JSON.stringify(output)).toBe(false);
        }
      }
    },
  );
  it("keeps a table delimiter row from starting a line", () => {
    const source = "Columns a | b |---|---|\n";
    for (const dialect of ["github", "forgejo", "gitea", "obsidian"] as const) {
      const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
      expect(verify(source, { ...wrap({ width: 20 }), dialect }, workspace).output).toBe(
        "Columns a |\nb |---|---|\n",
      );
    }
    // CommonMark has no tables, so a delimiter row is a word like any other.
    expect(
      verify("Columns a | b and |---|---| rows\n", {
        ...wrap({ width: 20 }),
        dialect: "commonmark",
      }).output,
    ).toBe("Columns a | b and\n|---|---| rows\n");
  });
});
describe("a tab in a container prefix", () => {
  /** A line's width, with a tab advancing to the next multiple of four columns. */
  function columns(line: string): number {
    let width = 0;
    for (const character of line) width = character === "\t" ? width + 4 - (width % 4) : width + 1;
    return width;
  }
  const words = "word ".repeat(20).trim();
  it.each(["-\t", "1.\t", "- [ ]\t", ">\t", "-\t-\t", "> -\t"])(
    "counts the tab of %j to the next tab stop",
    (prefix) => {
      for (const measure of ["columns", "codepoints"]) {
        const output = verify(`${prefix}${words}\n`, {
          ...wrap({ measure }),
          dialect: "github",
        }).output;
        const lines = output.trimEnd().split("\n");
        expect(lines.length).toBeGreaterThan(2);
        expect(
          lines.every((line) => columns(line) <= 40),
          JSON.stringify(output),
        ).toBe(true);
        expect(
          lines.some((line) => columns(line) > 35),
          JSON.stringify(output),
        ).toBe(true);
      }
    },
  );
  it("measures the issue's list item at 40 columns", () => {
    expect(verify(`-\t${words}\n`, { ...wrap(), dialect: "github" }).output).toBe(
      "-\tword word word word word word word\n \tword word word word word word word\n \tword word word word word word\n",
    );
  });
});
describe("a paragraph's first word that would be a block on its own", () => {
  const url = "https://example.com/a/very/long/address/that/does/not/fit/on/a/line";
  it.each(["commonmark", "github", "forgejo", "gitea", "obsidian"] as const)(
    "keeps a link reference definition from forming in the %s dialect",
    (dialect) => {
      const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
      for (const width of [20, 40, 80]) {
        const config: Config = { ...wrap({ width }), dialect };
        for (const source of [
          `[Note]: see ${url} for details.\n`,
          `[A longer note]: see ${url} for details.\n`,
          `[Note]:\nsee ${url} for details.\n`,
          `[Note]: see "a quoted title" and ${url} for details.\n`,
          `[Note]: see 'a quoted title' ${url}\nfor details.\n`,
          `> [Note]: see ${url} for details.\n`,
        ]) {
          const output = verify(source, config, workspace).output;
          expect(output.split("\n").length, JSON.stringify(source)).toBeGreaterThan(2);
        }
      }
    },
  );
  it("keeps the issue's example a paragraph", () => {
    const source =
      "[Note]: see https://example.com/a/very/long/address/that/does/not/fit/on/the/first/line for details.\n";
    expect(verify(source, { ...wrap({ width: 80 }), dialect: "github" }).output).toBe(
      "[Note]: see https://example.com/a/very/long/address/that/does/not/fit/on/the/first/line\nfor details.\n",
    );
  });
  it.each(["***", "---", "___", "+++", "$$", "```js"])(
    "keeps the next word on the first line after %j",
    (word) => {
      for (const dialect of ["commonmark", "github", "obsidian"] as const) {
        const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
        // A backtick or a `$` on the line keeps a fence or math from opening.
        const source = `${word} ${url} \`c\` and more words here, a$ b.\n`;
        const output = verify(source, { ...wrap(), dialect }, workspace).output;
        expect(output, dialect).not.toBe(source);
        // CommonMark has no math.
        if (word !== "$$" || dialect !== "commonmark")
          expect(output.startsWith(`${word} ${url}`), dialect).toBe(true);
      }
    },
  );
  it("keeps the words of a fence's line together up to the one that stops it opening", () => {
    const source = "```js a b c d e f g h `y` more words here\n";
    expect(verify(source, { ...wrap({ width: 20 }), dialect: "github" }).output).toBe(
      "```js a b c d e f g h `y`\nmore words here\n",
    );
  });
});
describe("a lazy first line", () => {
  // Directly below a link reference definition, a paragraph can start with a
  // line that lacks the container markers of the lines around it.
  const emphasis: Config = { ...wrap(), rules: { ...wrap().rules, "style/emphasis": "warn" } };
  it("keeps the document from the issue as written and still formats the rest", () => {
    // In CommonMark, `[^1]: Footnote.` is a link reference definition.
    const source = "*A*\r\n\r\n> [^1]: Footnote.\r\nof text.\r\n> quoted\r\n";
    expect(verify(source, { ...emphasis, dialect: "commonmark" }).output).toBe(
      source.replace("*A*", "_A_"),
    );
  });
  it.each(["commonmark", "github", "forgejo", "gitea", "obsidian"] as const)(
    "keeps the paragraph as written in the %s dialect",
    (dialect) => {
      const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
      for (const newline of ["\n", "\r\n", "\r"]) {
        const source = ["*A*", "", "> [a]: /u", "of text.", "> quoted", ""].join(newline);
        expect(verify(source, { ...emphasis, dialect }, workspace).output).toBe(
          source.replace("*A*", "_A_"),
        );
      }
    },
  );
  it.each([
    "> > [a]: /u\n> lazy\n> > more\n",
    "> - [a]: /u\nlazy\n>   more\n",
    "- [a]: /u\nlazy\n  more\n",
    "- > [a]: /u\n  lazy\n  > more\n",
    "[^1]: [a]: /u\nlazy\n    more\n",
  ])("keeps %j as written", (source) => {
    expect(verify(source, { ...wrap({ width: 20 }), dialect: "github" }).output).toBe(source);
  });
  it("reports such a paragraph as not reflowed on request", () => {
    const source =
      "> [a]: /u\nlazy words that make this paragraph longer than forty columns\n> more\n";
    expect(lint(source, { config: wrap({ reportUnreflowed: true }) })).toMatchObject([
      { message: "Paragraph not reflowed: lazy first line (width 40 columns)." },
    ]);
  });
  it.each([
    ["[a]: /u\nA paragraph below a definition, long enough to wrap.\n", ""],
    ["> [a]: /u\n> A paragraph below a definition, long enough to wrap.\n", "> "],
    ["- [a]: /u\n  A paragraph below a definition, long enough to wrap.\n", "  "],
  ])("still reflows a paragraph below a definition with its markers (%j)", (source, prefix) => {
    expect(verify(source, wrap()).output).toBe(source.replace(" enough", `\n${prefix}enough`));
  });
});
describe("Obsidian markers that joined lines could pair", () => {
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  const obsidian: Config = {
    ...wrap(),
    dialect: "obsidian",
    rules: { ...wrap().rules, "style/emphasis": "warn" },
  };
  it.each([
    "Some ==highlighted\ntext== *here*.\n",
    "Some [[Note\nName]] *here*.\n",
    "> - *item*\n=====\n=====\n",
    "A comparison a == b\nnext *line*.\n",
  ])("keeps %j as written and still formats the rest", (source) => {
    expect(verify(source, obsidian, workspace).output).toBe(source.replace(/\*(\w+)\*/, "_$1_"));
  });
  it("reflows the same paragraphs in other dialects", () => {
    expect(
      verify("Some ==highlighted\ntext== here.\n", { ...wrap(), dialect: "github" }).output,
    ).toBe("Some ==highlighted text== here.\n");
  });
  it("reports such a paragraph as not reflowed on request", () => {
    const source = "Some ==highlighted\ntext and enough words to go past the width of forty.\n";
    const config: Config = { ...wrap({ reportUnreflowed: true }), dialect: "obsidian" };
    expect(lint(source, { config, workspace })).toMatchObject([
      {
        message:
          "Paragraph not reflowed: Obsidian `==`, `[[`, or `]]` outside highlights and links (width 40 columns).",
      },
    ]);
  });
  it.each([
    "Words with ==a highlight== and [[Note|a link]] and ![[Image.png]]\nand ==more== [[Other]] on a second line.\n",
    "Code `a == b` and math $x==y$ and `[[` and `]]`\nare not markers, so this paragraph wraps.\n",
    "Single = signs,\n[brackets], and [ [ ] ] are not markers either.\n",
  ])("still reflows %j", (source) => {
    const output = verify(source, obsidian, workspace).output;
    expect(output).not.toBe(source);
    expect(output.replace(/\n(?!$)/g, " ")).toBe(source.replace(/\n(?!$)/, " "));
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
describe("Gitea syntax", () => {
  const gitea: Config = { ...wrap(), dialect: "gitea" };
  const forgejo: Config = { ...wrap(), dialect: "forgejo" };
  const reporting: Config = { ...wrap({ reportUnreflowed: true }), dialect: "gitea" };
  it.each([
    ["Term\n: A definition that is long enough to reflow at forty columns.\n", "definition list"],
    ["\\[\na + b + a sum that is long enough to reflow\n\\]\n", "display math"],
    ["Text \\(a\nb\\) more words that would otherwise reflow onto one line.\n", "\\(...\\) syntax"],
    ["Text [[a\nb]] more words that would otherwise reflow onto one line.\n", "[[...]] syntax"],
  ])("keeps the lines of %j like Forgejo and reports Gitea", (source, reason) => {
    expect(verify(source, gitea).output).toBe(source);
    expect(lint(source, { config: reporting })[0]?.message).toContain(`Gitea ${reason}`);
  });
  it("keeps one-line math, shortlinks, and block openers like Forgejo", () => {
    for (const source of [
      "Some words \\(a + b\\) and [[This is a link|https://gitea.com]] end here.\n",
      "aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb : more words follow here.\n",
      "aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb \\[x\\] more words follow here.\n",
    ])
      expect(verify(source, gitea).output).toBe(verify(source, forgejo).output);
  });
  it("leaves paragraphs alone where reflow could change the `_.py` exception", () => {
    const source = "Some words that wrap around __init__.py and my_var in this paragraph.\n";
    expect(verify(source, gitea).output).toBe(source);
    expect(lint(source, { config: reporting })[0]?.message).toContain("Gitea `_.py` emphasis");
    expect(verify(source, forgejo).output).not.toBe(source);
  });
  it.each([
    "\\( ` \\) _a_ ` filler words here `_.py` and trailing words.\n",
    "$x$ and `__init__.py` with more words that would otherwise reflow.\n",
  ])("does not trust code spans in %j, which Gitea math could consume", (source) => {
    expect(verify(source, gitea).output).toBe(source);
    expect(lint(source, { config: reporting })[0]?.message).toContain("Gitea `_.py` emphasis");
  });
  it("reflows `_.py` paragraphs whose underscores are all in code spans", () => {
    const source = "Some words that wrap around `__init__.py` and `my_var` in this paragraph.\n";
    expect(verify(source, gitea).output).toBe(verify(source, forgejo).output);
    expect(verify(source, gitea).output).not.toBe(source);
  });
});
describe("inline syntax that spans lines", () => {
  // Issue #201: with CR line endings the line break inside the link went unnoticed.
  it.each(["\n", "\r\n", "\r"])("leaves the paragraph as written with %j", (newline) => {
    const config: Config = { extends: [], rules: { "style/wrap": ["warn", { width: 30 }] } };
    for (const inline of [`[link](https://example.com${newline}"title")`, `$a${newline}b$`]) {
      const source = `Some text with ${inline} and more words here to wrap.${newline}`;
      expect(format(source, { config }).output, JSON.stringify(source)).toBe(source);
    }
  });
});
describe("line breaks inside link text, emphasis, and code spans", () => {
  const dialects = ["commonmark", "github", "forgejo", "gitea", "obsidian"] as const;
  const workspace = createWorkspace({}, { strictLineBreaks: true });
  const definitions = "\n\n[shortcut text]: /a\n[ref]: /b\n";
  // Each construct, written across a line break as `|`.
  const constructs = [
    "[the text|of a link](https://example.com/guide)",
    "![an image|description](image.png)",
    "![an image|description](image.png 'with a title')",
    "*an emphasized|phrase*",
    "_an emphasized|phrase_",
    "**strong|text**",
    "***strong and|emphasized***",
    "`a code|span`",
    "``a `code`|span``",
    "[shortcut|text]",
    "[shortcut|text][]",
    "[full|text][ref]",
    "![shortcut|text]",
    "[`code in|link text`](u)",
  ];
  const gfmConstructs = ["~~struck|out~~", "~struck|out~"];
  it.each(dialects)("reflows across them like across a space in the %s dialect", (dialect) => {
    const config: Config = { ...wrap({ width: 20 }), dialect };
    for (const newline of ["\n", "\r\n", "\r"]) {
      for (const construct of [...constructs, ...(dialect === "commonmark" ? [] : gfmConstructs)]) {
        const paragraph = (separator: string) =>
          `Some words ${construct.replace("|", separator)} and more words after it.`;
        const definitionLines = definitions.replaceAll("\n", newline);
        const source = paragraph(newline) + definitionLines;
        const result = verify(source, config, workspace);
        expect(result.output, JSON.stringify(source)).toBe(
          verify(paragraph(" ") + definitionLines, config, workspace).output,
        );
        expect(result.output).not.toBe(source);
      }
    }
  });
  it("reflows a paragraph that another formatter wrapped at a smaller width", () => {
    const source =
      "Text that another formatter wrapped at sixty columns breaks\nlines inside [the text of a\nlink](https://example.com/guide), inside _an emphasized\nphrase_, inside **strong\ntext**, and inside ~~struck\nout words~~, all of which render as spaces.\n";
    expect(verify(source, { ...wrap({ width: 80 }), dialect: "github" }).output).toBe(
      "Text that another formatter wrapped at sixty columns breaks lines inside [the\ntext of a link](https://example.com/guide), inside _an emphasized phrase_,\ninside **strong text**, and inside ~~struck out words~~, all of which render as\nspaces.\n",
    );
  });
  it.each([
    ["- ", "  "],
    ["> ", "> "],
    ["> - ", ">   "],
    ["1. > ", "   > "],
    ["> > ", "> > "],
  ])("joins the lines of each construct in containers (%j)", (prefix, continuation) => {
    const source = `${prefix}Item with **bold [link\n${continuation}text](u) more** and \`code\n${continuation}span\` and ![an\n${continuation}image](i.png) at its end.\n`;
    const output = verify(source, { ...wrap({ width: 30 }), dialect: "github" }).output;
    expect(output).toContain("`code span`");
    expect(output).toContain("![an image](i.png)");
    const lines = output.trimEnd().split("\n");
    expect(lines.slice(1).every((line) => line.startsWith(continuation))).toBe(true);
  });
  it("keeps a task item's code span whose next line is indented below the checkbox", () => {
    // The item's content starts after `- `, so the parser reads the indentation
    // below the checkbox as part of the code span, and GitHub does not.
    const source = "- [ ] Item with words and `code\n      span` and more words after it.\n";
    const config: Config = { ...wrap({ width: 30, reportUnreflowed: true }), dialect: "github" };
    expect(verify(source, config).diagnostics.map((item) => item.message)).toEqual([
      "Paragraph not reflowed: line break in a code span followed by a space or tab (width 30 columns).",
    ]);
    const linked = "- [ ] Item with words and [a\n      link](u) and more words after it.\n";
    expect(verify(linked, config).output).toBe(
      "- [ ] Item with words and [a\n      link](u) and more words\n      after it.\n",
    );
  });
  it.each([
    "**bold [link\ntext](u) more bold words**",
    "[**strong\ntext** and more link text](u)",
    "[![image\nalt](i.png)](u)",
    "*em `code\nspan` em and more emphasized words*",
    "~~struck *em\nphrase* and more struck words~~",
    "[link text with `code\nspan` inside](u)",
  ])("reflows nested constructs: %j", (inline) => {
    const source = `Text with ${inline} and words after it.\n`;
    for (const width of [20, 30, 40, 60]) {
      const config: Config = { ...wrap({ width }), dialect: "github" };
      expect(verify(source, config).output).toBe(verify(source.replace("\n", " "), config).output);
    }
  });
  it("wraps inside link text and emphasis but keeps code spans, images, and destinations whole", () => {
    const source =
      "A **long phrase in strong text** and [a link with long text](https://example.com/a-long-destination) and `a code span` and ![an image description](i.png).\n";
    expect(verify(source, { ...wrap({ width: 30 }), dialect: "github" }).output).toBe(
      "A **long phrase in strong\ntext** and [a link with long\ntext](https://example.com/a-long-destination)\nand `a code span` and\n![an image description](i.png).\n",
    );
  });
  it("keeps whole a container that holds inline HTML, whose whitespace can matter", () => {
    const source =
      "Some words *with <span>inline HTML</span> inside an emphasized phrase* and more words.\n";
    expect(verify(source, { ...wrap({ width: 30 }), dialect: "github" }).output).toBe(
      "Some words\n*with <span>inline HTML</span> inside an emphasized phrase*\nand more words.\n",
    );
  });
  it("keeps Obsidian highlights and wikilinks whole inside emphasis", () => {
    const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
    const source =
      "Note with *emphasis around ==a highlight here== and [[A wiki link|its alias]]\nand more* words.\n";
    const output = verify(source, { ...wrap({ width: 20 }), dialect: "obsidian" }, workspace);
    expect(output.output).toContain("==a highlight here==");
    expect(output.output).toContain("[[A wiki link|its alias]]");
  });
  it.each([
    ["[a link](https://example.com\n'title')", "line break in a link destination or title"],
    ["[a link](\nhttps://example.com)", "line break in a link destination or title"],
    ["![an image](i.png\n'title')", "line break in a link destination or title"],
    ["[full text][long\nref]", "line break in a link destination or title"],
    ["$a\nb$", "line break in math"],
    ["*em <b>html\nb</b> em*", "line break in inline HTML"],
    ["`code\n continued`", "line break in a code span followed by a space or tab"],
    ["`code\n\tcontinued`", "line break in a code span followed by a space or tab"],
    ["![image  \ndescription](i.png)", "hard line break"],
    ["![image\\\ndescription](i.png)", "hard line break"],
    ["*em  \nphrase*", "hard line break"],
  ])("keeps %j as written, where the line ending is content", (inline, reason) => {
    const source = `Some text with ${inline} and more words that run past the width.\n\n[long ref]: /u\n`;
    const config: Config = { ...wrap({ width: 30, reportUnreflowed: true }), dialect: "github" };
    const result = verify(source, config);
    expect(result.output).toBe(source);
    expect(result.diagnostics.map((item) => item.message)).toEqual([
      `Paragraph not reflowed: ${reason} (width 30 columns).`,
    ]);
  });
  it("keeps an Obsidian comment that spans lines as written", () => {
    const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
    const source = "Some text with %%a comment\nacross lines%% and more words past the width.\n";
    const config: Config = { ...wrap({ reportUnreflowed: true }), dialect: "obsidian" };
    expect(verify(source, config, workspace).diagnostics.map((item) => item.message)).toEqual([
      "Paragraph not reflowed: line break in an Obsidian comment (width 40 columns).",
    ]);
  });
  it("reflows generated paragraphs of links, emphasis, and code without changing them", () => {
    const words = fc.constantFrom("word", "longer-word", "a", "x.", "--flag", "#tag", "-5", "*");
    const inline = fc.oneof(
      words,
      fc.constantFrom(
        "*em|phrase*",
        "**strong|words here**",
        "_under|score_",
        "[link|text](https://example.com/path)",
        "[a|b][ref]",
        "[shortcut|text]",
        "`code|span`",
        "``co`de|span``",
        "![image|alt](i.png)",
        "~~struck|out~~",
        "[**bold|link** text](u)",
        "*em [link|in em](u) em*",
        "[`code|in link`](u)",
      ),
    );
    const pieces = fc.array(fc.tuple(inline, fc.constantFrom(" ", "\n", "\n", "\r\n")), {
      minLength: 1,
      maxLength: 16,
    });
    const containers = fc.constantFrom(["", ""], ["- ", "  "], ["> ", "> "], ["- [x] ", "      "]);
    fc.assert(
      fc.property(
        containers,
        pieces,
        fc.integer({ min: 20, max: 50 }),
        fc.constantFrom(...dialects),
        ([prefix, continuation], parts, width, dialect) => {
          // The separator after each piece also replaces the `|` inside it.
          const content = parts
            .map(([piece, separator]) => `${piece.replace("|", separator)}${separator}`)
            .join("")
            .trimEnd();
          const lines = content.replace(/\r\n|\n/g, (ending) => ending + continuation);
          const source = `${prefix}${lines}\n\n[ref]: /u\n[shortcut text]: /v\n`;
          const config: Config = { ...wrap({ width }), dialect };
          const result = format(source, { config, workspace });
          expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
          expect(format(result.output, { config, workspace }).output).toBe(result.output);
          expect(semanticFingerprint(parse(result.output, dialect))).toBe(
            semanticFingerprint(parse(source, dialect)),
          );
        },
      ),
      { numRuns: 400, seed: 20261017 },
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
