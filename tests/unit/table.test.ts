import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { normalizeHtml } from "../../scripts/rendering.mjs";
import { format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Dialect } from "../../src/index.js";

function check(source: string, options: Record<string, unknown>, dialect: Dialect = "github") {
  const config = { extends: [], dialect, rules: { "style/table": ["warn", options] } } as const;
  const result = format(source, { config });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config }).output).toBe(result.output);
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  expect(format(source, { config: { extends: [], dialect, rules: {} } }).output).toBe(source);
  return result.output;
}

const source = "| Alpha | Beta |\n| :-- | --: |\n| x | y |\n";
describe("table style options", () => {
  it.each(["github", "forgejo", "gitea", "obsidian", "vitepress", "commonmark"] as const)(
    "formats tight cells safely in %s",
    (dialect) => {
      for (const eol of ["\n", "\r\n"]) {
        const input = source.replaceAll("\n", eol);
        const expected =
          dialect === "commonmark"
            ? input
            : "|Alpha|Beta|\n|:--|--:|\n|x|y|\n".replaceAll("\n", eol);
        expect(check(input, { style: "tight" }, dialect)).toBe(expected);
      }
    },
  );
  it.each([
    ["leadingAndTrailing", "|Alpha|Beta|\n|:--|--:|\n|x|y|\n"],
    ["leadingOnly", "|Alpha|Beta\n|:--|--:\n|x|y\n"],
    ["trailingOnly", "Alpha|Beta|\n:--|--:|\nx|y|\n"],
    ["noLeadingOrTrailing", "Alpha|Beta\n:--|--:\nx|y\n"],
  ])("writes %s including the no-border form (#708)", (pipeStyle, expected) => {
    expect(check(source, { style: "tight", pipeStyle })).toBe(expected);
  });
  it("takes the first header for consistent and each header for perTable", () => {
    const first = "Alpha|Beta\n:--|--:\nx|y\n";
    const input = first + "\n" + source;
    expect(check(input, { style: "tight", pipeStyle: "consistent" })).toBe(first + "\n" + first);
    expect(check(input, { style: "tight", pipeStyle: "perTable" })).toBe(
      first + "\n|Alpha|Beta|\n|:--|--:|\n|x|y|\n",
    );
  });
  it.each(["compact", "tight"])("aligns %s delimiters to the header, not body widths", (style) => {
    const input = "| 長い名 | b |\n| :-- | --: |\n| longer body | z |\n";
    const gap = style === "tight" ? "" : " ";
    expect(check(input, { style, alignedDelimiter: true })).toBe(
      `|${gap}長い名${gap}|${gap}b  ${gap}|\n|${gap}:-----${gap}|${gap}--:${gap}|\n|${gap}longer body${gap}|${gap}z${gap}|\n`,
    );
  });
  it("pads right and centered columns using display widths, including emoji (#719)", () => {
    expect(
      check("| L | R | C |\n| :-- | --: | :-: |\n| 漢字 | 👩‍💻 | a |\n", { padding: "alignment" }),
    ).toBe("| L    |   R |  C  |\n| :--- | --: | :-: |\n| 漢字 |  👩‍💻 |  a  |\n");
  });
  it("retains inline source, empty cells and short rows", () => {
    expect(check("| **a** | b |\n| --- | --- |\n| x\\|y | |\n| z |\n", { style: "tight" })).toBe(
      "|**a**|b|\n|---|---|\n|x\\|y||\n|z|\n",
    );
  });
  it.each(["leadingOnly", "trailingOnly", "noLeadingOrTrailing", "consistent", "perTable"])(
    "keeps required one-column pipes with %s",
    (pipeStyle) => {
      const input = "| a |\n| --- |\n| b |\n";
      expect(check(input, { style: "tight", pipeStyle })).toMatch(/\|/);
      expect(check(input, { style: "tight", pipeStyle }, "obsidian")).toBe("|a|\n|---|\n|b|\n");
    },
  );
  it.each([
    ["| | b |\n| - | - |\n| c | d |\n", "leading"],
    ["| a | b |\n| - | - |\n| - x | d |\n", "leading"],
    ["| a | b |\n| - | - |\n| # x | d |\n", "leading"],
    ["| a | b |\n| - | - |\n| > x | d |\n", "leading"],
    ["| a | b |\n| - | - |\n| 1. x | d |\n", "leading"],
    ["| a | |\n| - | - |\n| c | |\n", "trailing"],
  ] as const)("keeps the border that a row of %j needs", (input, border) => {
    for (const pipeStyle of ["noLeadingOrTrailing", "leadingOnly", "trailingOnly"]) {
      const lines = check(input, { pipeStyle }).trimEnd().split("\n");
      if (border === "leading") expect(lines.every((line) => line.startsWith("|"))).toBe(true);
      else expect(lines.every((line) => line.endsWith("|"))).toBe(true);
      expect(lines.some((line) => /[ \t]$/.test(line))).toBe(false);
    }
  });
  it("leaves no padding after the last cell without a trailing pipe", () => {
    expect(
      check("| Alpha | Beta |\n| --- | --- |\n| x | y |\n", { pipeStyle: "noLeadingOrTrailing" }),
    ).toBe("Alpha | Beta\n----- | ----\nx     | y\n");
    expect(check("| 1 | b |\n| - | - |\n| 22 | d |\n", { pipeStyle: "noLeadingOrTrailing" })).toBe(
      "1   | b\n--- | ---\n22  | d\n",
    );
  });
  it("keeps Obsidian's leading borders and protected one-column forms", () => {
    expect(check(source, { style: "tight", pipeStyle: "trailingOnly" }, "obsidian")).toBe(
      "|Alpha|Beta|\n|:--|--:|\n|x|y|\n",
    );
    const input = "a |\n--- |\nb |\n";
    expect(check(input, { style: "tight" }, "obsidian")).toBe(input);
  });
  it.each(["compact", "tight", "aligned"])("keeps oversized tables with %s", (style) => {
    for (const input of [
      "| a | b |\n| --- | --- |\n| x | y | z |\n",
      "> | a | b |\n> | --- | --- |\n> | x | y | z |\n",
    ])
      expect(check(input, { style })).toBe(input);
  });
  it("allows an unbordered short body row without adding cells", () => {
    expect(
      check("| a | b |\n| --- | --- |\n| z |\n", {
        style: "tight",
        pipeStyle: "noLeadingOrTrailing",
      }),
    ).toBe("a|b\n---|---\nz\n");
  });
  it("does not mistake an escaped final content pipe for a trailing border", () => {
    const input = "a|b\\|\n---|---\nx|y\n";
    expect(check(input, { style: "tight", pipeStyle: "perTable" })).toBe(input);
  });
  it.each(["github", "forgejo", "gitea", "obsidian", "vitepress", "commonmark"] as const)(
    "preserves meaning across option combinations in %s",
    (dialect) => {
      for (const style of ["aligned", "compact", "tight"]) {
        for (const pipeStyle of [
          "leadingAndTrailing",
          "leadingOnly",
          "trailingOnly",
          "noLeadingOrTrailing",
          "consistent",
          "perTable",
        ]) {
          for (const alignedDelimiter of [false, true]) {
            check(source, { style, pipeStyle, alignedDelimiter, padding: "alignment" }, dialect);
          }
        }
      }
    },
  );
  it("validates all new option values", () => {
    for (const options of [
      { style: "any" },
      { pipeStyle: "no_leading_or_trailing" },
      { alignedDelimiter: "yes" },
      { padding: "left" },
    ]) {
      expect(() =>
        lint(source, { config: { extends: [], rules: { "style/table": ["warn", options] } } }),
      ).toThrow("Invalid options for style/table");
    }
  });
});

const markdownIt = new MarkdownIt({ html: true });
describe("tables in lists and block quotes (#710)", () => {
  const formatted = "| a   | b   |\n| --- | --- |\n| ccc | d   |";
  /** The table in `formatted`, written loosely, after the given prefixes. */
  const nested = (first: string, rest: string, table = "| a | b |\n|---|---|\n| ccc | d |") =>
    table
      .split("\n")
      .map((line, i) => (i ? rest : first) + line)
      .join("\n") + "\n";
  const shapes = [
    ["a block quote", "> ", "> "],
    ["a block quote without spaces", ">", ">"],
    ["a list item's marker line", "- ", "  "],
    ["an ordered item's marker line", "10. ", "    "],
    ["a quoted list item", "> - ", ">   "],
    ["a list item in a quote in a list", "1. > ", "   > "],
    ["nested block quotes", "> > ", "> > "],
    ["tab prefixes", ">\t", ">\t"],
  ] as const;
  it.each(["github", "forgejo", "gitea", "vitepress"] as const)(
    "formats each shape after its own prefixes in %s",
    (dialect) => {
      for (const [, first, rest] of shapes)
        for (const eol of ["\n", "\r\n"])
          expect(check(nested(first, rest).replaceAll("\n", eol), {}, dialect)).toBe(
            nested(first, rest, formatted).replaceAll("\n", eol),
          );
    },
  );
  it("formats the same shapes in Obsidian, except where its views read the rows otherwise", () => {
    for (const [name, first, rest] of shapes)
      expect(check(nested(first, rest), {}, "obsidian")).toBe(
        name === "tab prefixes" ? nested(first, rest) : nested(first, rest, formatted),
      );
  });
  it("leaves CommonMark's paragraphs as written", () => {
    for (const [, first, rest] of shapes)
      expect(check(nested(first, rest), {}, "commonmark")).toBe(nested(first, rest));
  });
  it("keeps each row's own markers and indentation, measuring widths after them", () => {
    expect(check("- x\n\n   | a | b |\n  |---|---|\n    | ccc | d |\n", {})).toBe(
      "- x\n\n   | a   | b   |\n  | --- | --- |\n    | ccc | d   |\n",
    );
    expect(check(">| a | b |\n> |---|---|\n>  | 漢字 | d |\n", {})).toBe(
      ">| a    | b   |\n> | ---- | --- |\n>  | 漢字 | d   |\n",
    );
  });
  it.each(["compact", "tight", "aligned"])(
    "applies every option inside a block quote with %s",
    (style) => {
      for (const pipeStyle of ["leadingAndTrailing", "leadingOnly", "trailingOnly"])
        for (const alignedDelimiter of [false, true])
          for (const padding of ["right", "alignment"]) {
            const options = { style, pipeStyle, alignedDelimiter, padding };
            const root = "| Alpha | Beta |\n| :-- | --: |\n| x | 漢字 |\n";
            const expected = check(root, options).trimEnd().split("\n");
            const quoted = root.trimEnd().replaceAll(/^/gm, "> ") + "\n";
            expect(check(quoted, options)).toBe(
              expected.map((line) => "> " + line).join("\n") + "\n",
            );
          }
    },
  );
  it("takes a nested header's borders for consistent pipes", () => {
    expect(
      check("> a | b\n> --|--\n\n| c | d |\n|---|---|\n", {
        style: "tight",
        pipeStyle: "consistent",
      }),
    ).toBe("> a|b\n> ---|---\n\nc|d\n---|---\n");
  });
  // Prettier formats an indented table differently on a second run (prettier/prettier#19847).
  it("formats idempotently with CRLF, escaped pipes, code spans and wide characters", () => {
    const input =
      "1. Step\r\n\r\n   | Name | Value |\r\n   |:-:|--:|\r\n   | `a \\| b` | 漢字 |\r\n   | \\| | 👩‍💻 `code` |\r\n";
    for (const style of ["aligned", "compact", "tight"])
      for (const padding of ["right", "alignment"]) {
        const config = {
          extends: [],
          dialect: "github",
          rules: { "style/table": ["warn", { style, padding }] },
        } as const;
        const once = check(input, { style, padding });
        expect(once).not.toBe(input);
        expect(once.split("\r\n").every((line) => line === "" || /^ {3}|^1\. /.test(line))).toBe(
          true,
        );
        expect(format(format(once, { config }).output, { config }).output).toBe(once);
      }
    expect(check(input, { padding: "alignment" })).toBe(
      "1. Step\r\n\r\n   |   Name   |     Value |\r\n   | :------: | --------: |\r\n   | `a \\| b` |      漢字 |\r\n   |    \\|    | 👩‍💻 `code` |\r\n",
    );
  });
  it("keeps the leading pipe of a header on its list item's marker line", () => {
    // markdown-it reads `- a | b` above an indented delimiter as a table outside the list.
    expect(check("- a | b\n  --|--\n  | c | d |\n", {}, "vitepress")).toBe(
      "- a   | b   |\n  --- | --- |\n  c   | d   |\n",
    );
    expect(
      check("- | a | b |\n  |--|--|\n", { pipeStyle: "noLeadingOrTrailing" }, "vitepress"),
    ).toBe("- | a   | b\n  | --- | ---\n");
    // A row that needs a leading pipe keeps the table as written.
    for (const dialect of ["github", "vitepress"] as const) {
      const input = "- a | b\n  --|--\n  | | d |\n";
      expect(check(input, {}, dialect)).toBe(input);
    }
    expect(check("1. a |\n   --|\n   b |\n", {}, "vitepress")).toBe(
      "1. a   |\n   --- |\n   b   |\n",
    );
  });
  it("leaves lazy lines, other containers and indented top-level tables as written", () => {
    expect(check("> | a | b |\n> |---|---|\nlazy text\n", {})).toBe(
      "> | a   | b   |\n> | --- | --- |\nlazy text\n",
    );
    for (const input of [
      "[^1]: | a | b |\n    |---|---|\n    | c | d |\n\nText[^1].\n",
      "  | a | b |\n  |---|---|\n  | c | d |\n",
      "> | a | b |\n> |---|---|\n> | ::: |\n> :::\n",
    ])
      expect(check(input, {})).toBe(input);
  });
  it("holds a whole table that an Obsidian protection holds, with one finding", () => {
    const input = "-\t| a | b |\n\t|---|---|\n\t| c | d |\n";
    const config = { extends: [], dialect: "obsidian", rules: { "style/table": "warn" } } as const;
    const result = format(input, { config });
    expect(result.output).toBe(input);
    expect(result.diagnostics.map((item) => [item.rule, item.line])).toEqual([["style/table", 1]]);
    expect(lint("> | a | b |\n> |---|---|\n> | c | d |\n", { config })).toHaveLength(1);
  });
  it.each(["github", "forgejo", "gitea", "obsidian", "vitepress", "commonmark"] as const)(
    "agrees with the recommended rules around nested tables in %s",
    (dialect) => {
      const config = { extends: ["recommended"], dialect } as const;
      for (const input of [
        "> Text above\n> | a | b |\n> |---|---|\n> | c | d |\n> Text below\n",
        "- Item with a long line that wraps at eighty columns because it is long enough to wrap.\n  | a | b |\n  |---|---|\n* | a | b |\n  |---|---|\n",
        "> [!NOTE]\n> Title\n>\n> | a | b |\n> |---|---|\n>Below.\n",
        "1. | a | b |\n   |---|---|\n   | ccc | d |\n10. Next\n",
      ]) {
        const result = format(input, { config });
        expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
        expect(format(result.output, { config }).output).toBe(result.output);
        expect(semanticFingerprint(parse(result.output, dialect))).toBe(
          semanticFingerprint(parse(input, dialect)),
        );
      }
    },
  );
  it("keeps markdown-it's reading of nested tables, as VitePress renders them", () => {
    const render = (text: string) => normalizeHtml(markdownIt.render(text));
    for (const input of [
      ...shapes.map(([, first, rest]) => nested(first, rest)),
      "- a | b\n  --|--\n  - x | d\n",
      "- a | b\n  --|--\n  c | d\n",
      "> | a | b |\n> |---|---|\nlazy | text\n",
    ])
      for (const pipeStyle of ["leadingAndTrailing", "noLeadingOrTrailing", "leadingOnly"])
        expect(render(check(input, { pipeStyle }, "vitepress"))).toBe(render(input));
  });
});
