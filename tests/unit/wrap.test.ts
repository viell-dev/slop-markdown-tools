import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  dialects,
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
  const { dialect } = resolveConfig({ config });
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  expect(format(result.output, options).output).toBe(result.output);
  return result;
}
describe("wrapping controls", () => {
  it("preserves reference rendering above a break after a quoted list", () => {
    const source = `>10) ${"word ".repeat(18)}end\n---\n`;
    const output = verify(source, { extends: ["recommended"], dialect: "commonmark" }).output;
    const parser = new Parser();
    const renderer = new HtmlRenderer();
    const markdownIt = new MarkdownIt("commonmark");
    for (const render of [
      (text: string) => renderer.render(parser.parse(text)),
      (text: string) => markdownIt.render(text),
    ]) {
      expect(render(output).replace(/\s+/g, " ")).toBe(render(source).replace(/\s+/g, " "));
      expect(render(output)).toContain("<hr");
      expect(render(output)).not.toContain("<h2");
    }
  });
  it.each(dialects)("keeps quoted list continuation indentation stable in %s", (dialect) => {
    const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
    const config: Config = { extends: ["recommended"], dialect };
    const reported =
      ">10) [ember](page.md) `orchard delta` **birch** engine birch https://example.com/walnut iris `orchardharbor`\n---\n";
    for (const source of [reported, `>10) ${"word ".repeat(18)}end\n---\n`]) {
      const result = verify(source, config, workspace);
      expect(result.changed).toBe(true);
      if (dialect !== "vitepress" || source !== reported)
        expect(result.output).toContain("\n>     ");
      expect(verify(result.output, config, workspace).changed).toBe(false);
    }
    for (const prefix of [">1) ", ">- ", ">>10) ", "> 10) ", "- >10) "]) {
      const source = `${prefix}${"word ".repeat(18)}end\n`;
      expect(verify(source, config, workspace).changed).toBe(true);
    }
    for (const suffix of ["---", "***"]) {
      const source = `${"word ".repeat(18)}end\n${suffix}\n`;
      expect(verify(source, config, workspace).changed).toBe(true);
    }
    const isolated = { extends: [], dialect, rules: { "style/wrap": "warn" } } satisfies Config;
    expect(verify(`>10) ${"word ".repeat(18)}end\n---\n`, isolated, workspace).output).toContain(
      "\n>     ",
    );
    expect(format(reported, { config: { extends: [], dialect }, workspace }).output).toBe(reported);
  });
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
  it.each([
    // Obsidian begins math at a lone `$` before a line ending, though not before a space.
    ["commonmark", "aaaa the price $\ncccccccccccccccc and\n$x$ more\n"],
    ["github", "aaaa the price $\ncccccccccccccccc\nand $x$ more\n"],
    ["forgejo", "aaaa the price $\ncccccccccccccccc and\n$x$ more\n"],
    ["gitea", "aaaa the price $\ncccccccccccccccc and\n$x$ more\n"],
    ["obsidian", "aaaa the price\n$ cccccccccccccccc\nand $x$ more\n"],
  ] as const)(
    "ends no line with a dollar that could begin math in the %s dialect",
    (dialect, output) => {
      const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
      const source = "aaaa the price $ cccccccccccccccc and $x$ more\n";
      expect(verify(source, { ...wrap({ width: 20 }), dialect }, workspace).output).toBe(output);
      const priced = "It costs about five US$ cccccccccc and $x$.\n";
      const result = verify(priced, { ...wrap({ width: 20 }), dialect }, workspace).output;
      if (dialect === "obsidian")
        expect(result).toBe("It costs about five\nUS$ cccccccccc\nand $x$.\n");
    },
  );
  it.each([
    // GitHub and Obsidian end math at a `$` after a line ending, though not after a space.
    ["commonmark", "$a\nbbbbbbbbbbbbbbbbbbb\n$ c\n"],
    ["github", "$a\nbbbbbbbbbbbbbbbbbbb $\nc\n"],
    ["forgejo", "$a bbbbbbbbbbbbbbbbbbb $\nc\n"],
    ["gitea", "$a bbbbbbbbbbbbbbbbbbb $\nc\n"],
    ["obsidian", "$a\nbbbbbbbbbbbbbbbbbbb $\nc\n"],
  ] as const)(
    "starts no line with a dollar that could end math in the %s dialect",
    (dialect, output) => {
      const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
      const source = "$a bbbbbbbbbbbbbbbbbbb $ c\n";
      expect(verify(source, { ...wrap({ width: 20 }), dialect }, workspace).output).toBe(output);
    },
  );
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
    const result = verify(source, wrap({ reportUnreflowed: true }));
    expect(result.output).toBe(source);
    expect(result.diagnostics[0]?.message).toContain(reason);
    expect(result.diagnostics[0]?.edit).toBeUndefined();
    expect(lint(source, { config: wrap() })).toEqual([]);
  });
  it("reflows a paragraph that ends in what an Obsidian block identifier cannot be", () => {
    // Obsidian allows letters, digits, and hyphens in a block identifier.
    const source = "A long line with many words that can be reflowed. ^not_an_id\n";
    expect(verify(source, wrap()).output).not.toBe(source);
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
  const sources = [
    `[Note]: see ${url} for details.\n`,
    `[A longer note]: see ${url} for details.\n`,
    `[Note]:\nsee ${url} for details.\n`,
    `[Note]: see "a quoted title" and ${url} for details.\n`,
    `[Note]: see 'a quoted title' ${url}\nfor details.\n`,
  ];
  const quoted = `> [Note]: see ${url} for details.\n`;
  it.each(["commonmark", "github", "forgejo", "gitea"] as const)(
    "keeps a link reference definition from forming in the %s dialect",
    (dialect) => {
      const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
      for (const width of [20, 40, 80]) {
        const config: Config = { ...wrap({ width }), dialect };
        for (const source of [...sources, quoted]) {
          const output = verify(source, config, workspace).output;
          expect(output.split("\n").length, JSON.stringify(source)).toBeGreaterThan(2);
        }
      }
    },
  );
  it("leaves such a paragraph as written in the obsidian dialect", () => {
    // Live Preview styles a line that starts at the first column with `[`, a
    // label, and `]:` as a definition, so the line stays whole (issue #391),
    // and after a quote marker its destination is hidden too (#411).
    const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
    for (const width of [20, 40, 80]) {
      const config: Config = { ...wrap({ width }), dialect: "obsidian" };
      for (const source of sources)
        expect(verify(source, config, workspace).output, JSON.stringify(source)).toBe(source);
      expect(verify(quoted, config, workspace).output).toBe(quoted);
    }
  });
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
        // In Obsidian, a run of backticks that nothing closes keeps the
        // paragraph as written (issue #362).
        if (word === "```js" && dialect === "obsidian") {
          expect(output, dialect).toBe(source);
          continue;
        }
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
describe("site-generator syntax at the start of a line", () => {
  // Site generators read Docusaurus containers and Liquid or other template
  // tags by line, though no dialect gives them meaning (issue #296).
  const emphasis: Config = { ...wrap(), rules: { ...wrap().rules, "style/emphasis": "warn" } };
  const long = "that is long enough to be wrapped at forty columns";
  it.each(["commonmark", "github", "forgejo", "gitea", "obsidian"] as const)(
    "keeps the paragraph as written and still formats the rest in the %s dialect",
    (dialect) => {
      const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
      for (const newline of ["\n", "\r\n", "\r"])
        for (const lines of [
          [":::note", `An admonition with *text* ${long}.`, ":::"],
          ["{% tabs %}", '{% tab title="One" %}', `Content of the *first* tab ${long}.`],
          [`Text with *emphasis* ${long}`, "{{ site.title }} ends it."],
          [`> Quoted *text* ${long}`, "> {% raw %}"],
          [`- Item *text* ${long}`, "  {{ variable }}"],
          [`Indented *text* ${long}`, "   :::"],
        ]) {
          const source = [...lines, ""].join(newline);
          expect(verify(source, { ...emphasis, dialect }, workspace).output).toBe(
            source.replace(/\*(\w+)\*/, "_$1_"),
          );
        }
    },
  );
  it("reports such a paragraph as not reflowed on request", () => {
    expect(
      lint(`{% tabs %}\nText ${long}.\n`, { config: wrap({ reportUnreflowed: true }) }),
    ).toMatchObject([
      {
        message:
          "Paragraph not reflowed: site-generator syntax at the start of a line (width 40 columns).",
      },
    ]);
  });
  it.each([":::", ":::note", "{%", "{%raw%}", "{{", "{{title}}"])(
    "keeps %s on the line of the word before it",
    (atom) => {
      const source = `aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb ${atom} more words follow here.\n`;
      expect(verify(source, { ...wrap(), dialect: "github" }).output).toBe(
        `aaaa aaaa aaaa aaaa aaaa aaaa aaaa\nbbbb ${atom} more words follow here.\n`,
      );
    },
  );
  it.each(["::", "{x}", "{ {", "a:::", "x{%", "x{{"])(
    "still reflows a paragraph with %s",
    (atom) => {
      const [first, second] = [
        "aaaa aaaa aaaa aaaa aaaa aaaa aaaa",
        `${atom} more words follow here.`,
      ];
      expect(
        verify(`${first}\n${second}\n`, { ...wrap({ width: 80 }), dialect: "github" }).output,
      ).toBe(`${first} ${second}\n`);
    },
  );
  it.each(["\n", "\r\n", "\r"])("keeps a template tag on one line whole (%j)", (newline) => {
    // Not every site generator reads a tag split across lines, such as the
    // issue's `{% data … %}` tags. A `{%` or `{{` that its line does not close
    // is wrapped like any word.
    const source = `Words before {% data reusables.a.b %} and {{ page.title }} here,${newline}then words {% unclosed and {{ more.${newline}`;
    const { output } = verify(source, { ...wrap({ width: 20 }), dialect: "github" });
    expect(output.split(newline)).toEqual([
      "Words",
      "before {% data reusables.a.b %}",
      "and {{ page.title }}",
      "here, then words {%",
      "unclosed and {{",
      "more.",
      "",
    ]);
  });
});
describe("a paragraph that starts with a linked image", () => {
  // `[![Build](…)](…)` starts like a callout's `[!type]`, but only the first
  // paragraph of a block quote can be a callout.
  const badge = "[![Build](https://example.com/b.svg)](https://example.com/ci)";
  const text = "A paragraph that starts with a badge and is long enough to wrap.";
  it.each(["commonmark", "github", "obsidian"] as const)(
    "is wrapped outside a block quote in the %s dialect",
    (dialect) => {
      const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
      for (const [before, after] of [
        [
          `${badge} ${text}\n`,
          `${badge}\nA paragraph that starts with a badge and\nis long enough to wrap.\n`,
        ],
        [
          `- ${badge} ${text}\n`,
          `- ${badge}\n  A paragraph that starts with a badge\n  and is long enough to wrap.\n`,
        ],
        [
          `> First.\n>\n> ${badge} ${text}\n`,
          `> First.\n>\n> ${badge}\n> A paragraph that starts with a badge\n> and is long enough to wrap.\n`,
        ],
      ] as const)
        expect(verify(before, { ...wrap(), dialect }, workspace).output).toBe(after);
    },
  );
  it("is kept as written as the first paragraph of a block quote", () => {
    const source = `> ${badge} ${text}\n`;
    expect(lint(source, { config: wrap({ reportUnreflowed: true }) })).toMatchObject([
      { message: "Paragraph not reflowed: callout header (width 40 columns)." },
    ]);
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
        // Live Preview resets short code at each physical newline (#565).
        if (dialect === "obsidian" && construct.includes("`")) {
          expect(result.output).toBe(source);
          continue;
        }
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
  // Issue #285: the parser keeps the spaces and tabs that start a code span's
  // next line, which CommonMark and GitHub leave out, so a span is joined
  // without them, as `style/inline-code` joins it.
  it.each([
    ["", ""],
    ["> ", "> "],
    ["> > ", "> > "],
    ["- ", "  "],
    ["1. ", "   "],
    ["> - ", ">   "],
    ["- > ", "  > "],
    // The indentation that lines up with a task item's text is such a space too.
    ["- [ ] ", "      "],
  ])(
    "joins a code span whose next line is indented as on one line (%j)",
    (prefix, continuation) => {
      for (const dialect of dialects)
        for (const indentation of ["   ", "\t", " \t "])
          for (const width of [20, 30, 40, 80]) {
            const config: Config = { ...wrap({ width, reportUnreflowed: true }), dialect };
            const text = (separator: string) =>
              `${prefix}Run \`npm run${separator}build\` now, and then more words so that it wraps.\n`;
            const source = text(`\n${continuation}${indentation}`);
            const result = verify(source, config, workspace);
            if (dialect === "obsidian") {
              // #565: short code resets at the physical newline in Live Preview.
              // #429 also protects a quote opening on the list's marker line.
              expect(result.output).toBe(source);
              expect(lint(source, { config, workspace }).every((item) => !item.edit)).toBe(true);
              continue;
            }
            expect(result.output, JSON.stringify([source, dialect, width])).toBe(
              verify(text(" "), config, workspace).output,
            );
            expect(result.output).toContain("`npm run build`");
            expect(lint(source, { config, workspace }).map((item) => item.message)).toEqual([
              `Reflow paragraph to ${width} columns.`,
            ]);
          }
    },
  );
  it("lines up a task item's continuation lines with its text", () => {
    const config: Config = { ...wrap({ width: 30 }), dialect: "github" };
    const linked = "- [ ] Item with words and [a\n      link](u) and more words after it.\n";
    expect(verify(linked, config).output).toBe(
      "- [ ] Item with words and [a\n      link](u) and more words\n      after it.\n",
    );
  });
  it("joins a code span whose next line is indented also beside earlier backticks", () => {
    // Wrapping keeps each span's own backticks, and joining makes no run of
    // backticks longer, so a span cannot pair differently with an earlier run.
    for (const before of ["A `` stray run,", "An escaped \\` run,", "A ``code`` span,"]) {
      const source = `${before} then \`npm run\n   build\` and more words to wrap.\n`;
      const config: Config = { ...wrap({ width: 30 }), dialect: "github" };
      expect(verify(source, config).output).toBe(
        verify(source.replace("\n   ", " "), config).output,
      );
    }
  });
  // Issue #290: CommonMark drops the indentation and turns line endings into
  // spaces before it takes a space off each end of a code span, so each of
  // these reads as GitHub showed it: ` foo`, `foo `, `foo`, `code`, `code`.
  it.each([
    ["` \n   foo `", "`  foo `"],
    ["` foo \n   `", "` foo  `"],
    ["`\n   foo\n   `", "` foo `"],
    ["`\n code `", "` code `"],
    ["` code\n\t`", "` code `"],
  ])("joins %j, with a space or line break at both edges, as %j", (inline, joined) => {
    for (const [prefix, continuation] of [
      ["", ""],
      ["> ", "> "],
      ["- ", "  "],
    ] as const)
      for (const dialect of dialects) {
        const span = inline.replace(/\n/g, `\n${continuation}`);
        const source = `${prefix}Some text with ${span} and more words that run past the width.\n`;
        const config: Config = { ...wrap({ width: 30 }), dialect };
        expect(verify(source, config, workspace).output).toContain(
          dialect === "obsidian" ? span : joined,
        );
      }
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
        "`code|  span`",
        "``co`de|\tspan``",
        "` code|  `",
        "`|  code `",
        "` |code `",
        "` code |`",
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
describe("link text in the Obsidian dialect", () => {
  // Obsidian's Live Preview shows a link whose text spans lines as Markdown
  // source, so the text of a link stays on one line there, as an image's
  // description does (issue #306).
  const workspace = createWorkspace({}, { strictLineBreaks: true });
  const obsidian = (width: number): Config => ({ ...wrap({ width }), dialect: "obsidian" });
  it("moves a link whole to the next line instead of breaking its text", () => {
    const source =
      "A paragraph that links to [the target note in this vault](<Target.md>) here.\n\nA paragraph with a reference link [the target note in this vault][t] here.\n\n[t]: <Target.md>\n";
    expect(verify(source, obsidian(40), workspace).output).toBe(
      "A paragraph that links to\n[the target note in this vault](<Target.md>)\nhere.\n\nA paragraph with a reference link\n[the target note in this vault][t] here.\n\n[t]: <Target.md>\n",
    );
    // Elsewhere, link text wraps like the paragraph's own.
    expect(verify(source, { ...obsidian(40), dialect: "github" }).output).toBe(
      "A paragraph that links to [the target\nnote in this vault](<Target.md>) here.\n\nA paragraph with a reference link [the\ntarget note in this vault][t] here.\n\n[t]: <Target.md>\n",
    );
  });
  it.each([
    ["", ""],
    ["- ", "  "],
    ["> ", "> "],
    ["> [!note]\n> ", "> "],
  ])("joins link text written across lines (%j)", (prefix, continuation) => {
    const definitions = "\n\n[shortcut text]: /a\n[ref]: /b\n";
    for (const newline of ["\n", "\r\n", "\r"])
      for (const link of [
        "[the text|of a link](https://example.com/guide)",
        "[a *link* whose|text has emphasis](u 'and a title')",
        "[a link with `code`|after it](u)",
        "[a link `with|code` inside](u)",
        "[a link with ![an|image](i.png) inside](u)",
        "[full|text][ref]",
        "[shortcut|text][]",
        "[shortcut|text]",
      ]) {
        const paragraph = (separator: string) =>
          `${prefix}Some words ${link.replaceAll("|", separator)} and more words after it.`;
        const source = (paragraph(`\n${continuation}`) + definitions).replaceAll("\n", newline);
        const joined = (paragraph(" ") + definitions).replaceAll("\n", newline);
        for (const width of [20, 40, 80]) {
          const result = verify(source, obsidian(width), workspace);
          if (link === "[a link `with|code` inside](u)") {
            // A short multiline code span also resets inside link text (#565).
            expect(result.output).toBe(source);
            continue;
          }
          expect(result.output, JSON.stringify([source, width])).toBe(
            verify(joined, obsidian(width), workspace).output,
          );
          // The link's text is on one line.
          expect(result.output).toContain(link.slice(0, link.indexOf("]")).replaceAll("|", " "));
        }
      }
  });
  it("keeps a paragraph as written where a line break in link text is inline HTML", () => {
    const source = "Some words [a link <b>with\nHTML</b> inside](u) and more words after it.\n";
    expect(verify(source, obsidian(30), workspace).output).toBe(source);
  });
});

describe("Obsidian inline footnotes", () => {
  // Live Preview shows an inline footnote whose text spans lines as Markdown
  // source, while Reading view shows the footnote either way (issue #363).
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  const obsidian = (width: number): Config => ({ ...wrap({ width }), dialect: "obsidian" });
  it("keeps an inline footnote's text on one line", () => {
    const source =
      "Some words with a footnote^[with several words inside it] and words after it.\n";
    expect(verify(source, obsidian(30), workspace).output).toBe(
      "Some words with a\nfootnote^[with several words inside it]\nand words after it.\n",
    );
    expect(
      verify("A note^[see [[Some Note|its alias]] there] ends.\n", obsidian(20), workspace).output,
    ).toBe("A\nnote^[see [[Some Note|its alias]] there]\nends.\n");
  });
  it("finds a footnote after an opener that nothing closes, and none in code", () => {
    expect(
      verify("Words ^[open and a note^[with several words] at the end.\n", obsidian(20), workspace)
        .output,
    ).toBe("Words ^[open and a\nnote^[with several words]\nat the end.\n");
    // Reading view keeps `^[` in code, but Live Preview resets short code at
    // the newline, so the span and its following source stay as written (#565).
    expect(
      verify("Some words and `code ^[x\ny] here` and more words.\n", obsidian(80), workspace)
        .output,
    ).toBe("Some words and `code ^[x\ny] here` and more words.\n");
  });
  it("keeps a paragraph with an inline footnote across lines as written", () => {
    const source =
      "Some words with a footnote^[with several\nwords inside it] and words after it.\n";
    expect(verify(source, obsidian(80), workspace).output).toBe(source);
  });
  it("wraps an unclosed ^[ and footnotes in other dialects as text", () => {
    expect(verify("Words ^[and more words here to wrap\n", obsidian(20), workspace).output).toBe(
      "Words ^[and more\nwords here to wrap\n",
    );
    const github = createWorkspace({}, { dialect: "github" });
    const config: Config = { ...wrap({ width: 20 }), dialect: "github" };
    expect(verify("Some text^[with several words] and more.\n", config, github).output).toBe(
      "Some text^[with\nseveral words] and\nmore.\n",
    );
  });
});

describe("VitePress syntax that keeps a paragraph (#755)", () => {
  const vitepress = (options: Record<string, unknown> = {}): Config => ({
    ...wrap(options),
    dialect: "vitepress",
  });
  const wide =
    "`recommended` enables [`style/block-spacing`](rules.md#styleblock-spacing) at\n" +
    "`warn`, separating headings, lists, and tables from adjacent blocks with a blank line where safe.\n" +
    'To keep compact spacing, set `"rules": { "style/block-spacing": "off" }`.\n';
  it.each([
    ["a link and braces in a code span", wide],
    ["a link without a fragment", wide.replace("#styleblock-spacing", "")],
    [
      "a task item with braces in a code span",
      "- [ ] A task with `{ a }` in its words that goes on past the width.\n",
    ],
    ["`^[` in a code span", "Some words with `^[x]` in code that go on past the width here.\n"],
  ])("wraps a paragraph with %s as in other dialects", (_name, body) => {
    for (const newline of ["\n", "\r\n"]) {
      const source = body.replaceAll("\n", newline);
      const output = verify(source, vitepress()).output;
      expect(output).not.toBe(source);
      expect(output).toBe(verify(source, { ...wrap(), dialect: "github" }).output);
      expect(lint(output, { config: vitepress({ reportUnreflowed: true }) })).toEqual([]);
    }
  });
  it.each([
    [
      "VitePress attribute syntax",
      "Some words in a paragraph that goes on past the width {.note}\n",
    ],
    [
      "VitePress attribute syntax",
      "A [link](u.md){target=_blank} in words that go on past the width.\n",
    ],
    [
      "VitePress inline footnote",
      "Some words with a note^[a note] that go on past the width here.\n",
    ],
    [
      "Vue whitespace between elements",
      "Some words with `a` `b` in code that go on past the width here.\n",
    ],
  ])("keeps a paragraph with %s and reports it", (reason, body) => {
    for (const newline of ["\n", "\r\n"]) {
      const source = body.replaceAll("\n", newline);
      expect(verify(source, vitepress()).output).toBe(source);
      expect(lint(source, { config: vitepress() })).toEqual([]);
      expect(lint(source, { config: vitepress({ reportUnreflowed: true }) })).toMatchObject([
        {
          rule: "style/wrap",
          line: 1,
          message: `Paragraph not reflowed: ${reason} (width 40 columns).`,
        },
      ]);
      // A paragraph that fits needs no report.
      expect(lint(source, { config: vitepress({ width: 200, reportUnreflowed: true }) })).toEqual(
        [],
      );
    }
  });
  it("reports each kept paragraph of a long document with its own reason", () => {
    const kept = [
      "Some words in a paragraph that goes on past the width {.note}",
      "Some words with a note^[a note] that go on past the width here.",
      "Some words with `a` `b` in code that go on past the width here.",
      "Plain words in a paragraph that go on past the width here.",
    ];
    const reasons = [
      "VitePress attribute syntax",
      "VitePress inline footnote",
      "Vue whitespace between elements",
    ];
    const blocks = Array.from({ length: 300 }, (_, index) => kept[index % 4]!);
    const source = blocks.join("\n\n") + "\n";
    const findings = lint(source, { config: vitepress({ reportUnreflowed: true }) });
    expect(
      findings.filter(({ message }) => message.startsWith("Paragraph not reflowed")),
    ).toMatchObject(
      blocks.flatMap((_, index) =>
        index % 4 === 3
          ? []
          : [
              {
                line: 2 * index + 1,
                message: `Paragraph not reflowed: ${reasons[index % 4]} (width 40 columns).`,
              },
            ],
      ),
    );
    expect(findings).toHaveLength(300);
    const output = verify(source, vitepress()).output.split("\n\n");
    output.forEach((block, index) =>
      index % 4 === 3 ? expect(block).toContain("\n") : expect(block).toBe(blocks[index]),
    );
  });
  it("wraps an attribute block as text with VitePress's attrs off", () => {
    const config: Config = {
      ...vitepress({ reportUnreflowed: true }),
      vitepress: { attrs: false },
    };
    const source = "Some words in a paragraph that goes on past the width {.note}\n";
    expect(verify(source, config).output).toBe(
      "Some words in a paragraph that goes on\npast the width {.note}\n",
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
    // The space that starts the second line goes, as GitHub renders it.
    ["A ` \n ` here.\n", "A `  ` here.\n"],
    ["A `one\r\ntwo` here.\r\n", "A `one two` here.\r\n"],
  ])("joins parsed code without deleting content or container syntax", (source, expected) => {
    expect(verify(source, config).output).toBe(expected);
    expect(format(source, { config: { extends: [] } }).output).toBe(source);
  });
  it.each(["commonmark", "github", "forgejo", "gitea", "obsidian"] as const)(
    "leaves a code span on an indented lazy line as written, without a refusal, in %s",
    (dialect) => {
      // Without a space after `>`, the next line does not reach the list item's
      // content and is lazy; the parser keeps its spaces in the span, which
      // joining would drop (issue #339).
      const workspace = createWorkspace({}, { strictLineBreaks: true });
      const rules: Config = { extends: [], dialect, rules: { "style/wrap": "warn" } };
      for (const source of [">* `\n>  `\n", ">3) `\n>   `\n", ">* `a\n>  b`\n"])
        expect(verify(source, rules, workspace).output).toBe(source);
      // With the space, the line continues the item. Obsidian still retains
      // the short span's physical newline for Live Preview (#565).
      expect(verify("> * `a\n>   b`\n", rules, workspace).output).toBe(
        dialect === "obsidian" ? "> * `a\n>   b`\n" : "> * `a b`\n",
      );
    },
  );
  it.each(["\n", "\r\n", "\r"])(
    "leaves a code span with a backslash at a line end as written (%j)",
    (newline) => {
      // After an unpaired longer run, GitHub does not pair the backticks, and
      // the backslash is a hard line break there (issue #335).
      const source = `A \`\` run, \`one\` and \`two\\${newline}three\` end.${newline}`;
      for (const rules of [
        config,
        { extends: [], rules: { "style/wrap": ["warn", { width: 80 }] } } satisfies Config,
        { extends: [], rules: { "style/inline-code": "warn" } } satisfies Config,
      ])
        expect(verify(source, rules).output).toBe(source);
      // Without the backslash the span is still joined.
      expect(verify(source.replaceAll("\\", ""), config).output).toBe(
        `A \`\` run, \`one\` and \`two three\` end.${newline}`,
      );
    },
  );
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
    // Only the first paragraph of a block quote can be a callout, so the others
    // are wrapped like any paragraph (issue #299).
    for (const [source, dialect, message] of [
      [`${title}\n`, "obsidian", "Reflow paragraph to 60 columns."],
      [`> Earlier paragraph.\n>\n> ${title}\n`, "obsidian", "Reflow paragraph to 60 columns."],
      [`> ${title}\n`, "commonmark", "Paragraph not reflowed: callout header"],
      [
        "An ordinary paragraph with many breakable words and a trailing block identifier. ^block\n",
        "obsidian",
        "Paragraph not reflowed: block identifier",
      ],
    ] as const) {
      const config: Config = {
        ...wrap({ width: 60, reportUnreflowed: true, reportUnbreakable: true }),
        dialect,
      };
      const diagnostics = lint(source, { config, workspace });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain(message);
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

describe("a table that the parser reads as text", () => {
  // Directly below a table that ends in a list item or block quote, the parser
  // reads the next table as a paragraph, and GitHub reads a table (#283).
  const layouts = [
    "- | a |\n  | - |\n| b | and more words in the cell |\n| - | - |\n",
    "> | a |\n> | - |\n| b | and more words in the cell |\n| - | - |\n",
  ];
  it.each(["github", "forgejo", "gitea", "obsidian"] as const)(
    "keeps its lines in the %s dialect",
    (dialect) => {
      const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
      const config: Config = { ...wrap({ width: 20, reportUnreflowed: true }), dialect };
      for (const source of layouts) {
        const result = verify(source, config, workspace);
        expect(result.output).toBe(source);
        expect(result.diagnostics.map((item) => item.message)).toEqual([
          "Paragraph not reflowed: table delimiter row as its second line (width 20 columns).",
        ]);
      }
    },
  );
  it("wraps the same lines in CommonMark, which has no tables", () => {
    const output = verify(layouts[0]!, { ...wrap({ width: 20 }), dialect: "commonmark" }).output;
    expect(output).not.toBe(layouts[0]);
  });
});

describe("a run of `=` or `-` below the line of an alert's or callout's marker", () => {
  // Alone on the body's first line, it would underline that line as a heading.
  it.each([
    ["github", "> [!NOTE]\n", "=="],
    ["github", "> [!NOTE]\n", "--"],
    ["forgejo", "> [!NOTE]\n", "=="],
    ["gitea", "> [!WARNING]\n", "--"],
    ["obsidian", "> [!note] Title\n", "--"],
    ["obsidian", "> [!note]\n", "---"],
  ] as const)("stays with the next word in the %s dialect (%j, %j)", (dialect, marker, run) => {
    const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
    const config: Config = { ...wrap({ width: 20 }), dialect };
    const long = `${marker}> ${run} aaaaaaaaaaaaaaaaaaaa\n`;
    expect(verify(long, config, workspace).output).toBe(long);
    const words = `${marker}> ${run} aaaa bbbb cccc dddd eeee ffff\n`;
    expect(verify(words, config, workspace).output).toBe(
      `${marker}> ${run} aaaa bbbb cccc\n> dddd eeee ffff\n`,
    );
  });
});

describe("a reflowed line that Live Preview would style as a link reference definition", () => {
  // Live Preview styles a line that starts at the first column with `[`, a
  // label, and `]:` as a definition (issue #391), so no reflowed line starts
  // so in the Obsidian dialect: the word that opens the label stays on the
  // line before it (issue #411).
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  const obsidian = (width: number): Config => ({ ...wrap({ width }), dialect: "obsidian" });
  it.each([
    [
      "Some words before the label [a]: tail words after it.\n",
      "Some words before the\nlabel [a]: tail words after\nit.\n",
    ],
    [
      "Some words before the label [a]:x tail words after it.\n",
      "Some words before the\nlabel [a]:x tail words after\nit.\n",
    ],
    // A label with blank space in it, or with `[` inside, counts too.
    [
      "Some words before the label x [a b]: tail words after it.\n",
      "Some words before the label\nx [a b]: tail words after it.\n",
    ],
    [
      "Some words before the label x [a [b]: tail words after it.\n",
      "Some words before the label x [a [b]: tail words after it.\n",
    ],
    // A label already written across lines keeps its link styling as written.
    [
      "Some words before the label x\n[a\nb]: tail words after it.\n",
      "Some words before the label x\n[a\nb]: tail words after it.\n",
    ],
    [
      "Some words before the label x\n[a b\n]: tail words after it.\n",
      "Some words before the label x\n[a b\n]: tail words after it.\n",
    ],
  ])("keeps definition-like label styling in %j", (source, output) => {
    expect(verify(source, obsidian(30), workspace).output).toBe(output);
    expect(format(source, { config: { extends: [] }, workspace }).output).toBe(source);
  });
  it("leaves a paragraph as written whose first line would start so", () => {
    const source = "[a\nb]: c d and more words after it.\n";
    const config: Config = { ...wrap({ width: 20, reportUnreflowed: true }), dialect: "obsidian" };
    const result = verify(source, config, workspace);
    expect(result.output).toBe(source);
    expect(result.diagnostics.map((item) => item.message)).toEqual([
      "Paragraph not reflowed: definition-like label spanning lines (width 20 columns).",
    ]);
  });
  it.each([
    String.raw`[a\]b]:x`,
    String.raw`[a\\]:x`,
    String.raw`[a\\\]b]:x`,
    String.raw`[a\\\\]:x`,
    String.raw`[a\ b]:x`,
    "[a [b]:x",
  ])("keeps escaped and nested label %s off a new line", (label) => {
    const source = `Some words before the label x ${label} tail words after it.\n`;
    const output = verify(source, obsidian(30), workspace).output;
    if (label === "[a [b]:x") expect(output).toBe(source);
    else expect(output).toContain(`\nx ${label}`);
    expect(output).not.toMatch(/^\[/m);
  });
  it("allows a word whose first unescaped closing bracket is not followed by a colon", () => {
    const source = "Some words before the label [a]b]:x tail words after it.\n";
    expect(verify(source, obsidian(30), workspace).output).toBe(
      "Some words before the label\n[a]b]:x tail words after it.\n",
    );
  });

  it.each([
    // Container continuations hide the destination too, without a definition line class.
    [
      "> Some words before the label [a]: tail words after it.\n",
      "> Some words before the\n> label [a]: tail words after\n> it.\n",
    ],
    [
      "- Some words before the label [a]: tail words after it.\n",
      "- Some words before the\n  label [a]: tail words after\n  it.\n",
    ],
    [
      "  Some words before the label [a]: tail words after it.\n",
      "  Some words before the\n  label [a]: tail words after\n  it.\n",
    ],
  ])("keeps the label off a new container line in %j", (source, output) => {
    expect(verify(source, obsidian(30), workspace).output).toBe(output);
  });
  it("starts a line with the label in the other dialects", () => {
    for (const dialect of ["commonmark", "github", "forgejo", "gitea"] as const) {
      const config: Config = { ...wrap({ width: 30 }), dialect };
      expect(
        verify("Some words before the label [a]: tail words after it.\n", config).output,
        dialect,
      ).toBe("Some words before the label\n[a]: tail words after it.\n");
      expect(
        verify("Some words before the label x\n[a\nb]: tail words after it.\n", config).output,
        dialect,
      ).toBe("Some words before the label x\n[a b]: tail words after it.\n");
    }
  });
});

describe("a tag directly after a block quote marker written without a space", () => {
  // Live Preview reads a tag after blank space or at the start of a line's
  // content, and text directly after `>`, so in such a quote the tag stays on
  // the line before it (issue #409).
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  const obsidian = (width: number): Config => ({ ...wrap({ width }), dialect: "obsidian" });
  it.each([
    [
      ">Some words with a long line x #glacier and more words after it.\n",
      30,
      ">Some words with a long line\n>x #glacier and more words\n>after it.\n",
    ],
    [
      ">>Some words with a long line x #glacier and more words after it.\n",
      31,
      ">>Some words with a long line\n>>x #glacier and more words\n>>after it.\n",
    ],
    [
      "- >Some words with a long line x #glacier and more words after it.\n",
      32,
      "- >Some words with a long line x #glacier and more words after it.\n",
    ],
    // After `> `, the tag can start a line.
    [
      "> Some words with a long line x #glacier and more words after it.\n",
      31,
      "> Some words with a long line x\n> #glacier and more words after\n> it.\n",
    ],
    // A word of digits alone is no tag.
    [
      ">Some words with a long line x #1984 and more words after it.\n",
      30,
      ">Some words with a long line x\n>#1984 and more words after\n>it.\n",
    ],
  ])("wraps %j at %i as %j", (source, width, output) => {
    expect(verify(source, obsidian(width), workspace).output).toBe(output);
    expect(format(source, { config: { extends: [] }, workspace }).output).toBe(source);
  });
  it.each(["#tag/nested", "#tag-name", "#tag_1", "#é", "#tag,"])(
    "keeps %s on the line before it",
    (tag) => {
      const source = `>Some words with a long line x ${tag} and more words after it.\n`;
      const output = verify(source, obsidian(30), workspace).output;
      expect(output.startsWith(`>Some words with a long line\n>x ${tag} `)).toBe(true);
    },
  );
  it("starts a line with the tag in the other dialects", () => {
    for (const dialect of ["commonmark", "github", "forgejo", "gitea"] as const)
      expect(
        verify(">Some words with a long line x #glacier and more words after it.\n", {
          ...wrap({ width: 30 }),
          dialect,
        }).output,
        dialect,
      ).toBe(">Some words with a long line x\n>#glacier and more words after\n>it.\n");
  });
});

describe("tag-like text on a continuation line directly after a bare quote marker (#414)", () => {
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  const obsidian = (width: number): Config => ({ ...wrap({ width }), dialect: "obsidian" });
  it.each([
    ">a\n>#b c\n",
    ">>a\n>>#b c\n",
    "- >a\n  >#b c\n",
    ">[!note] Title\n>a\n>#b c\n",
    ">a\n>#tag/nested c\n",
    ">a\n>#tag-name c\n",
    ">a\n>#é c\n",
    ">a\n>#tag, c\n",
    ">a\r\n>#b c\r\n",
    ">a\r>#b c\r",
    ">a\n>#b c",
    ">Some longer words before the next line that could otherwise reflow.\n>#b c\n>More words.\n",
  ])("keeps %j as written in Obsidian", (source) => {
    expect(verify(source, obsidian(30), workspace).output).toBe(source);
    expect(format(source, { config: { extends: [] }, workspace }).output).toBe(source);
  });
  it.each([
    [">#b c\n>more words\n", ">#b c more words\n"],
    [">a\n> #b c\n", ">a #b c\n"],
    [">a\n>#1984 c\n", ">a #1984 c\n"],
    [">a\n>\\#b c\n", ">a \\#b c\n"],
    // The tag is code in Reading view, but short code resets in Live Preview (#565).
    [">a `code\n>#b` c\n", ">a `code\n>#b` c\n"],
    [">a [link\n>#b](page) c\n", ">a [link #b](page) c\n"],
  ])("still reflows %j in Obsidian", (source, output) => {
    expect(verify(source, obsidian(80), workspace).output).toBe(output);
  });
  it("reports the reason when requested", () => {
    const source = ">Some longer words before the next line that could otherwise reflow.\n>#b c\n";
    const config: Config = {
      ...wrap({ width: 30, reportUnreflowed: true }),
      dialect: "obsidian",
    };
    expect(verify(source, config, workspace).diagnostics.map((item) => item.message)).toEqual([
      "Paragraph not reflowed: tag-like text directly after a block quote marker (width 30 columns).",
    ]);
  });
  it("joins the line in the other dialects", () => {
    for (const dialect of ["commonmark", "github", "forgejo", "gitea"] as const)
      expect(verify(">a\n>#b c\n", { ...wrap({ width: 80 }), dialect }).output, dialect).toBe(
        ">a #b c\n",
      );
  });
});

describe("blank space at the end of a footnote definition's text", () => {
  // Obsidian's Reading view shows it before the footnote's backreference
  // (issue #405), so it stays outside the reflowed text.
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  const source =
    "Text[^1]\n\n[^1]: Note\n\n    Some words of the footnote, enough of them to be reflowed. \n";
  it("keeps it in the Obsidian dialect", () => {
    expect(verify(source, { ...wrap(), dialect: "obsidian" }, workspace).output).toBe(
      "Text[^1]\n\n[^1]: Note\n\n    Some words of the footnote, enough\n    of them to be reflowed. \n",
    );
    expect(
      verify(source.replaceAll(". \n", ".\t\n"), { ...wrap(), dialect: "obsidian" }, workspace)
        .output,
    ).toBe(
      "Text[^1]\n\n[^1]: Note\n\n    Some words of the footnote, enough\n    of them to be reflowed.\t\n",
    );
  });
  it("removes it in the other dialects", () => {
    expect(verify(source, { ...wrap(), dialect: "github" }).output).toBe(
      "Text[^1]\n\n[^1]: Note\n\n    Some words of the footnote, enough\n    of them to be reflowed.\n",
    );
  });
});

describe("leading Obsidian comments when wrapping (#557)", () => {
  it.each([
    {
      name: "root leading comment",
      source: "%%c%% aaaaaaaaaaaaaaaaaaaa\n",
      dialect: "obsidian",
      expected: "%%c%% aaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      name: "list leading comment",
      source: "- %%c%% aaaaaaaaaaaaaaaaaaaa\n",
      dialect: "obsidian",
      expected: "- %%c%% aaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      name: "quote leading comment",
      source: "> %%c%% aaaaaaaaaaaaaaaaaaaa\n",
      dialect: "obsidian",
      expected: "> %%c%% aaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      name: "callout body leading comment",
      source: "> [!NOTE]\n> %%c%% aaaaaaaaaaaaaaaaaaaa tail words follow\n",
      dialect: "obsidian",
      expected: "> [!NOTE]\n> %%c%%\n> aaaaaaaaaaaaaaaaaaaa\n> tail words follow\n",
    },
    {
      name: "titled callout body leading comment",
      source: "> [!NOTE] Preserve This Title\n> %%c%% aaaaaaaaaaaaaaaaaaaa tail words follow\n",
      dialect: "obsidian",
      expected:
        "> [!NOTE] Preserve This Title\n> %%c%%\n> aaaaaaaaaaaaaaaaaaaa\n> tail words follow\n",
    },
    {
      name: "callout body visible prefix control",
      source: "> [!NOTE]\n> text %%c%% aaaaaaaaaaaaaaaaaaaa tail words follow\n",
      dialect: "obsidian",
      expected: "> [!NOTE]\n> text %%c%%\n> aaaaaaaaaaaaaaaaaaaa\n> tail words follow\n",
    },
    {
      name: "leading comment and wrapping tail",
      source: "%%c%% aaaaaaaaaaaaaaaaaaaa tail words remain eligible for normal wrapping here\n",
      dialect: "obsidian",
      expected:
        "%%c%% aaaaaaaaaaaaaaaaaaaa\ntail words remain\neligible for normal\nwrapping here\n",
    },
    {
      name: "visible prefix control",
      source: "text %%c%% aaaaaaaaaaaaaaaaaaaa\n",
      dialect: "obsidian",
      expected: "text %%c%%\naaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      name: "consecutive comments control",
      source: "%%c%% %%d%% aaaaaaaaaaaaaaaaaaaa\n",
      dialect: "obsidian",
      expected: "%%c%% %%d%%\naaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      name: "inline code control",
      source: "`%%c%%` aaaaaaaaaaaaaaaaaaaa\n",
      dialect: "obsidian",
      expected: "`%%c%%`\naaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      name: "visible text after comment control",
      source: "%%c%% short aaaaaaaaaaaaaaaaaaaa\n",
      dialect: "obsidian",
      expected: "%%c%% short\naaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      name: "escaped marker control",
      source: "\\%%c%% aaaaaaaaaaaaaaaaaaaa\n",
      dialect: "obsidian",
      expected: "\\%%c%%\naaaaaaaaaaaaaaaaaaaa\n",
    },
    {
      name: "other dialect control",
      source: "%%c%% aaaaaaaaaaaaaaaaaaaa\n",
      dialect: "github",
      expected: "%%c%%\naaaaaaaaaaaaaaaaaaaa\n",
    },
  ] as const)("$name", ({ source, dialect, expected }) => {
    const config: Config = { ...wrap({ width: 20 }), dialect };
    const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"]) {
        const result = verify(bom + source.replaceAll("\n", newline), config, workspace);
        expect(result.output).toBe(bom + expected.replaceAll("\n", newline));
      }
  });
});

describe("potential Obsidian flow comments across a blank line (#559)", () => {
  it.each([
    {
      name: "multiline inline comment with blank line",
      source: "%%one\n\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
    {
      name: "list blank-inside comment",
      source: "- %%one\n\n  two%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
    {
      name: "quote blank-inside comment",
      source: "> %%one\n>\n> two%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
    {
      name: "complete middle paragraph stays opaque",
      source:
        "%%one\n\ncomment middle words remain exactly as written though this line is long\n\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
    {
      name: "list opener with outer closer",
      source: "- %%one\n\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
  ])("retains complete source for $name", ({ source }) => {
    const config: Config = { ...wrap({ width: 20, reportUnreflowed: true }), dialect: "obsidian" };
    const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"]) {
        const original = bom + source.replaceAll("\n", newline);
        const result = verify(original, config, workspace);
        expect(result.output).toBe(original);
        expect(
          result.diagnostics.some(
            ({ message }) =>
              message ===
              "Paragraph not reflowed: Obsidian comment crossing a blank line (width 20 columns).",
          ),
        ).toBe(true);
      }
  });
  it.each([
    {
      name: "spaces within leading comment",
      source: "%%one two three%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
      dialect: "obsidian",
      expected: "%%one two three%% aaaaaaaaaaaaaaaaaaaa\ntail words follow\nhere\n",
    },
    {
      name: "two consecutive leading comments",
      source: "%%one two%% %%three four%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
      dialect: "obsidian",
      expected: "%%one two%% %%three four%%\naaaaaaaaaaaaaaaaaaaa\ntail words follow\nhere\n",
    },
    {
      name: "multiline inline comment",
      source: "%%one\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
      dialect: "obsidian",
      expected: "%%one\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
    {
      name: "visible prefix before pending opener",
      source: "visible %%one\n\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
      dialect: "obsidian",
      expected: "visible %%one\n\ntwo%%\naaaaaaaaaaaaaaaaaaaa\ntail words follow\nhere\n",
    },
    {
      name: "callout header before blank-inside comment",
      source: "> [!NOTE] Title\n> %%one\n>\n> two%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
      dialect: "obsidian",
      expected:
        "> [!NOTE] Title\n> %%one\n>\n> two%%\n> aaaaaaaaaaaaaaaaaaaa\n> tail words follow\n> here\n",
    },
    {
      name: "escaped opener control",
      source: "\\%%one\n\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
      dialect: "obsidian",
      expected: "\\%%one\n\ntwo%%\naaaaaaaaaaaaaaaaaaaa\ntail words follow\nhere\n",
    },
    {
      name: "closed flow comment control",
      source: "%%one\n\ntwo%%\naaaaaaaaaaaaaaaaaaaa tail words follow here\n",
      dialect: "obsidian",
      expected: "%%one\n\ntwo%%\naaaaaaaaaaaaaaaaaaaa\ntail words follow\nhere\n",
    },
    {
      name: "other dialect control",
      source: "%%one\n\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
      dialect: "github",
      expected: "%%one\n\ntwo%%\naaaaaaaaaaaaaaaaaaaa\ntail words follow\nhere\n",
    },
  ] as const)("retains existing behavior for $name", ({ source, dialect, expected }) => {
    const config: Config = { ...wrap({ width: 20, reportUnreflowed: true }), dialect };
    const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
    expect(verify(source, config, workspace).output).toBe(expected);
  });
});

describe("mixed-whitespace hard breaks (#562)", () => {
  it.each(dialects)("preserves native line endings in %s", (dialect) => {
    const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
    const config: Config = { ...wrap({ width: 20 }), dialect };
    for (const source of [
      "a\t  \nb\n",
      "a\\\\\t  \nb\n",
      "- alpha\t  \n  beta\n",
      "> alpha\t  \n> beta\n",
    ])
      for (const eol of ["\n", "\r\n", "\r"])
        for (const bom of ["", "\uFEFF"])
          expect(verify(bom + source.replaceAll("\n", eol), config, workspace).output).toBe(
            bom + source.replaceAll("\n", eol),
          );
  });
});

describe("terminal separators before Obsidian Tab-only continuations (#563)", () => {
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  const config: Config = { ...wrap({ width: 20 }), dialect: "obsidian" };

  it.each([
    ["a\n    b   \n\t\n# c\n", "a b   \n\t\n# c\n"],
    [
      "alpha beta gamma delta epsilon zeta   \n\t\n# tail\n",
      "alpha beta gamma\ndelta epsilon zeta   \n\t\n# tail\n",
    ],
    ["a\\ \n\t\n# c\n", "a\\ \n\t\n# c\n"],
    ["a\\\t\n\t\n# c\n", "a\\\t\n\t\n# c\n"],
    // An actual terminal backslash stays a marker, including while earlier lines join.
    ["alpha\nbeta\\\n\t\n# c\n", "alpha beta\\\n\t\n# c\n"],
  ])("preserves the terminal separator while wrapping %j", (source, output) => {
    for (const eol of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"])
        expect(verify(bom + source.replaceAll("\n", eol), config, workspace).output).toBe(
          bom + output.replaceAll("\n", eol),
        );
  });

  it.each([
    ["a \n\t\n# c\n", "a\n\t\n# c\n"],
    ["a\\\\ \n\t\n# c\n", "a\\\\\n\t\n# c\n"],
    ["a\\ \n\n# c\n", "a\\\n\n# c\n"],
    ["a   \n \n# c\n", "a\n \n# c\n"],
    ["- alpha  \n\t\n# c\n", "- alpha\n\t\n# c\n"],
    ["-    alpha  \n\t\n# c\n", "-    alpha\n\t\n# c\n"],
    ["1000. alpha  \n\t\t\n# c\n", "1000. alpha\n\t\t\n# c\n"],
  ])("still trims an ordinary terminal separator in %j", (source, output) => {
    expect(verify(source, config, workspace).output).toBe(output);
  });
});

describe("code-span source hard breaks (#335)", () => {
  const configs: Config[] = [
    { extends: ["recommended", "github"], dialect: "github" },
    { extends: [], dialect: "github", rules: { "style/wrap": ["warn", { width: 80 }] } },
    { extends: [], dialect: "github", rules: { "style/inline-code": "warn" } },
  ];

  it("retains the generated 1169742916/7 boundary while formatting independent source", () => {
    const source = readFileSync(
      new URL("../fixtures/renderers/github-code-hardbreak-1169742916.md", import.meta.url),
      "utf8",
    );
    const expected = readFileSync(
      new URL(
        "../fixtures/renderers/github-code-hardbreak-1169742916.expected.md",
        import.meta.url,
      ),
      "utf8",
    );
    expect(verify(source, configs[0]!).output).toBe(expected);
    expect(expected).not.toBe(source);
  });

  it.each(["  ", "   ", "\t  ", "\\"])("keeps %j before a physical code-span newline", (ending) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"])
        for (const config of configs) {
          const source = `${bom}A \`\` run, \`one\` and \`two${ending}${newline}three\` end.${newline}`;
          expect(verify(source, config).output).toBe(source);
          expect(format(source, { config: { extends: [], dialect: "github" } }).output).toBe(
            source,
          );
        }
  });

  it("keeps the source boundary under quote and ordered-item prefixes", () => {
    const source = "> > 1. A `` run, `one` and `two  \n> >    three` end.\n";
    for (const config of configs) expect(verify(source, config).output).toBe(source);
  });

  it("retains two-space code source conservatively even without an unmatched longer run", () => {
    const source = "A `two  \nthree` end.\n";
    for (const config of configs) expect(verify(source, config).output).toBe(source);
  });

  it.each([
    ["A `two\nthree` end.\n", "A `two three` end.\n"],
    ["A `` run, `one` and `two \nthree` end.\n", "A `` run, `one` and `two  three` end.\n"],
  ])("still joins an ordinary soft code boundary in %j", (source, output) => {
    for (const config of configs) expect(verify(source, config).output).toBe(output);
  });
});
