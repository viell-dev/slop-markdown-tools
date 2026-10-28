import { describe, expect, it } from "vitest";
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
  it.each(["compact", "tight", "aligned"])("keeps nested and oversized tables with %s", (style) => {
    for (const prefix of ["> ", "- "]) {
      const input =
        source
          .split("\n")
          .slice(0, -1)
          .map((line, i) => (prefix === "- " && i ? "  " : prefix) + line)
          .join("\n") + "\n";
      expect(check(input, { style, pipeStyle: "noLeadingOrTrailing" })).toBe(input);
    }
    const input = "| a | b |\n| --- | --- |\n| x | y | z |\n";
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
