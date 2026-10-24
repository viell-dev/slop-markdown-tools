import { describe, expect, it } from "vitest";
import { format, lint, presets } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

/**
 * The findings of one problem rule, which formatting reports too without
 * changing the document, and which no other rule makes.
 */
function check(source: string, rule: string, dialect: Dialect = "github") {
  const config: Config = { extends: [], dialect, rules: { [rule]: "warn" } };
  const diagnostics = lint(source, { config });
  const result = format(source, { config });
  expect(result.output).toBe(source);
  expect(result.diagnostics).toEqual(diagnostics);
  expect(diagnostics.every((item) => item.edit === undefined)).toBe(true);
  expect(lint(source, { config: { extends: [], dialect } })).toEqual([]);
  return diagnostics;
}
/** The source that each finding covers. */
const spans = (source: string, findings: { start: number; end?: number }[]) =>
  findings.map((item) => source.slice(item.start, item.end));

describe("content/image-alt", () => {
  const rule = "content/image-alt";
  it.each([
    ["![](chart.png)\n", "github"],
    ["Text ![ ](chart.png) text.\n", "github"],
    ["![][chart]\n\n[chart]: chart.png\n", "github"],
    ["![](chart.png)\n", "commonmark"],
    // In Obsidian, `|100` after the text sets the image's width.
    ["![|100](chart.png)\n", "obsidian"],
    ["![ |100x50](chart.png)\n", "obsidian"],
  ] as const)("reports an image without alternative text: %j in %s", (source, dialect) => {
    const findings = check(source, rule, dialect);
    expect(findings).toHaveLength(1);
    expect(spans(source, findings)[0]).toMatch(/^!\[.*\]/);
    expect(findings[0]?.message).toBe(
      "Add alternative text to the image, for readers who cannot see it.",
    );
  });
  it.each([
    ["![Sales by month](chart.png)\n", "github"],
    ["![Sales][chart]\n\n[chart]: chart.png\n", "github"],
    ["[![Build status](badge.svg)](https://example.com/ci)\n", "github"],
    ["`![](chart.png)`\n\n```md\n![](chart.png)\n```\n", "github"],
    ['<img src="chart.png">\n', "github"],
    // Outside Obsidian, `|100` is text.
    ["![|100](chart.png)\n", "github"],
    ["![Sales|100](chart.png)\n", "obsidian"],
    // An embed has no place for the text.
    ["![[chart.png]]\n", "obsidian"],
  ] as const)("accepts %j in %s", (source, dialect) => {
    expect(check(source, rule, dialect)).toEqual([]);
  });
});

describe("content/table-columns", () => {
  const rule = "content/table-columns";
  it("reports rows with more or fewer cells than the header", () => {
    const source = [
      "| Name | Size |",
      "| ---- | ---- |",
      "| a    | 1    | extra |",
      "| b    |",
      "| c    | 3    |",
      "| d | 4 | x | y |",
      "",
    ].join("\n");
    const findings = check(source, rule);
    expect(findings.map((item) => [item.line, item.message])).toEqual([
      [3, "Row has 3 cells and the header 2; the extra cell is not shown."],
      [4, "Row has 1 cell and the header 2; the row is shown with an empty cell added."],
      [6, "Row has 4 cells and the header 2; the extra cells are not shown."],
    ]);
    expect(spans(source, findings)).toEqual([
      "| a    | 1    | extra |",
      "| b    |",
      "| d | 4 | x | y |",
    ]);
  });
  it("counts cells as GFM does", () => {
    expect(
      check(
        "Name | Size\n--- | ---\na | 1\n`a\\|b` \\| c | 2\n\n> | x |\n> | - |\n> | y |\n",
        rule,
      ),
    ).toEqual([]);
    expect(check("| a | b |\n| - | - |\n| 1 | 2 |   |\n", rule)).toHaveLength(1);
    // GFM splits cells at a pipe in a code span too, unless it is escaped.
    expect(check("| a | b |\n| - | - |\n| `x|y` | z |\n", rule)).toHaveLength(1);
    expect(check("| a | b |\n| - | - |\n|\n", rule)[0]?.message).toBe(
      "Row has 1 cell and the header 2; the row is shown with an empty cell added.",
    );
  });
  it("leaves CommonMark, which has no tables, alone", () => {
    expect(check("| a | b |\n| - | - |\n| 1 | 2 | 3 |\n", rule, "commonmark")).toEqual([]);
  });
});

describe("content/code-language", () => {
  const rule = "content/code-language";
  it.each([
    ["```\nnpm test\n```\n", "```"],
    ["~~~~\nnpm test\n~~~~\n", "~~~~"],
    ["- Run:\n\n  ```\n  npm test\n  ```\n", "```"],
    ["> ```\n> npm test\n> ```\n", "```"],
    ["```   \nnpm test\n```\n", "```"],
  ])("reports a fenced code block without a language: %j", (source, fence) => {
    const findings = check(source, rule);
    expect(spans(source, findings)).toEqual([fence]);
    expect(findings[0]?.message).toBe(
      `Name the code block's language after its opening fence, such as ${fence}sh, or ${fence}text for plain text.`,
    );
  });
  it.each([
    "```sh\nnpm test\n```\n",
    "~~~text\nplain\n~~~\n",
    "```{.python}\nprint()\n```\n",
    // An indented code block has no place for a language.
    "    npm test\n",
    "- Item\n\n      npm test\n",
    "$$\nx^2\n$$\n",
    "Inline `code` only.\n",
  ])("accepts %j", (source) => {
    expect(check(source, rule)).toEqual([]);
  });
});

describe("content rules in presets", () => {
  it("enable image text and table columns in recommended as warnings, code languages nowhere", () => {
    const recommended = presets.recommended!.rules!;
    expect(recommended["content/image-alt"]).toBe("warn");
    expect(recommended["content/table-columns"]).toBe("warn");
    for (const preset of Object.values(presets))
      expect(preset.rules?.["content/code-language"]).toBeUndefined();
  });
  it("respect suppression comments", () => {
    const source =
      "<!-- mdrefine-disable-next-line content/image-alt -->\n![](a.png)\n\n![](b.png)\n";
    expect(check(source, "content/image-alt").map((item) => item.line)).toEqual([4]);
  });
});
