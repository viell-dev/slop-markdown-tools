import { describe, expect, it } from "vitest";
import { format, lint } from "../../src/index.js";
import type { Config, Plugin, ProcessOptions } from "../../src/index.js";

function settings(rule: string, options: Record<string, unknown>): ProcessOptions {
  return { config: { extends: [], rules: { [rule]: ["error", options] } } };
}
function check(source: string, rule: string, options: Record<string, unknown>) {
  const process = settings(rule, options);
  const diagnostics = lint(source, process);
  expect(format(source, process)).toMatchObject({ output: source, changed: false, diagnostics });
  expect(diagnostics.every((finding) => finding.edit === undefined)).toBe(true);
  return diagnostics;
}

it("validates regex formats in isolated plugin schemas too", () => {
  const plugin: Plugin = {
    name: "local",
    rules: {
      pattern: {
        description: "Accept a configured regular expression.",
        kind: "problem",
        schema: { type: "object", properties: { pattern: { type: "string", format: "regex" } } },
        check: () => [],
      },
    },
  };
  const options = (pattern: string) => ({
    ...settings("local/pattern", { pattern }),
    plugins: [plugin],
  });
  expect(lint("", options("^valid$"))).toEqual([]);
  expect(() => lint("", options("["))).toThrow("Invalid options for local/pattern");
});

describe("configurable title headings", () => {
  it.each([1, 2, 3, 4, 5, 6])("checks the configured title level %i", (level) => {
    const title = `${"#".repeat(level)} Title\n`;
    expect(check(title, "structure/initial-heading", { level })).toEqual([]);
    expect(check(`Body\n\n${title}`, "structure/initial-heading", { level })).toHaveLength(1);
    expect(check(`${title}\n${title}`, "structure/single-title", { level })).toMatchObject([
      { line: 3, message: `Use one level-${level} heading per document; the title is on line 1.` },
    ]);
    const other = `${"#".repeat(level === 1 ? 2 : 1)} Other\n`;
    expect(check(`${other}\n${other}`, "structure/single-title", { level })).toEqual([]);
  });
  it.each(["\n", "\r\n", "\r"])("allows a preamble with %j line breaks", (eol) => {
    const source = ["<!-- intro -->", "", "Prose.", "", "## Title", ""].join(eol);
    expect(check(source, "structure/initial-heading", { level: 2, allowPreamble: true })).toEqual(
      [],
    );
    expect(check(source, "structure/initial-heading", { allowPreamble: true })).toMatchObject([
      { line: 5, column: 1 },
    ]);
    expect(check("Prose only.", "structure/initial-heading", { allowPreamble: true })).toHaveLength(
      1,
    );
    expect(
      check("> ## Quoted\n", "structure/initial-heading", { level: 2, allowPreamble: true }),
    ).toHaveLength(1);
  });
  it("counts underlined headings at the chosen level", () => {
    expect(check("Page\n----\n", "structure/initial-heading", { level: 2 })).toEqual([]);
    expect(check("Page\n----\n\n## Again\n", "structure/single-title", { level: 2 })).toMatchObject(
      [{ line: 4 }],
    );
  });
  it.each([
    "---\ntitle: Page\n---\n",
    '---\n"title": Page\n---\n',
    "+++\ntitle = 'Page'\n+++\n",
    "+++\n  'title' = 'Page'\n+++\n",
  ])("recognizes a top-level metadata title when requested: %j", (front) => {
    expect(
      check(`${front}\n## Section\n`, "structure/initial-heading", { frontMatterTitle: true }),
    ).toEqual([]);
    expect(check(`${front}\n## Section\n`, "structure/initial-heading", {})).toHaveLength(1);
    expect(check(`${front}\n## Section\n`, "structure/single-title", { level: 2 })).toHaveLength(1);
    for (const disabled of [false, ""]) {
      expect(
        check(`${front}\n# Page\n`, "structure/single-title", { frontMatterTitle: disabled }),
      ).toEqual([]);
      expect(
        check(front, "structure/initial-heading", { frontMatterTitle: disabled }),
      ).toHaveLength(1);
    }
  });
  it.each([
    "---\npage:\n  title: Nested\n---\n",
    "---\nsubtitle: Other\n---\n",
    "+++\n[page]\ntitle = 'Nested'\n+++\n",
    "+++\nsubtitle = 'Other'\n+++\n",
  ])("does not mistake nested or longer keys for the default title: %j", (source) => {
    expect(check(source, "structure/initial-heading", { frontMatterTitle: true })).toHaveLength(1);
    expect(check(`${source}\n# Page\n`, "structure/single-title", {})).toEqual([]);
  });
  it.each([
    ["---\nother: value\npage_name: Example\n---\n", "^page_name:"],
    ["+++\nother = 1\npage_name = 'Example'\n+++\n", "^page_name\\s*="],
  ])("matches a custom metadata pattern in multiline mode: %j", (front, pattern) => {
    expect(check(front, "structure/initial-heading", { frontMatterTitle: pattern })).toEqual([]);
    expect(
      check(`${front}\n# Page\n`, "structure/single-title", { frontMatterTitle: pattern }),
    ).toHaveLength(1);
    expect(
      check(`${front}\n# Page\n`, "structure/single-title", { frontMatterTitle: "^missing:" }),
    ).toEqual([]);
    expect(
      check("page_name: Body text\n", "structure/initial-heading", { frontMatterTitle: pattern }),
    ).toHaveLength(1);
  });
  it("keeps metadata titles out of quoted and footnote outlines", () => {
    const source =
      "---\ntitle: Page\n---\n\n> ## Quoted\n>\n> ## Another\n\n[^n]: ## Footnote\n\n    ## Another\n";
    expect(check(source, "structure/single-title", { level: 2 })).toMatchObject([
      { line: 7, message: "Use one level-2 heading per document; the title is on line 5." },
      { line: 11, message: "Use one level-2 heading per document; the title is on line 9." },
    ]);
  });
  it("keeps the default literal title forms and allows other forms through a pattern", () => {
    const front = "---\n  title: Page\n---\n";
    expect(check(front, "structure/initial-heading", { frontMatterTitle: true })).toHaveLength(1);
    expect(check(`${front}\n# Page\n`, "structure/single-title", {})).toEqual([]);
    const frontMatterTitle = "^[ \\t]*title:";
    expect(check(front, "structure/initial-heading", { frontMatterTitle })).toEqual([]);
    expect(
      check(`${front}\n# Page\n`, "structure/single-title", { frontMatterTitle }),
    ).toHaveLength(1);
  });
  it.each(["structure/initial-heading", "structure/single-title"])(
    "rejects invalid %s options before execution",
    (rule) => {
      for (const level of [0, 7, 1.5, "2", null])
        expect(() => lint("# Page\n", settings(rule, { level }))).toThrow(
          `Invalid options for ${rule}`,
        );
      for (const frontMatterTitle of ["[", 42, null])
        expect(() => lint("# Page\n", settings(rule, { frontMatterTitle }))).toThrow(
          `Invalid options for ${rule}`,
        );
    },
  );
});

describe("duplicate heading scope", () => {
  it("can compare headings across parents and depths", () => {
    const source = "# Linux\n\n## *Setup*\n\n# Windows\n\n### Setup\n";
    expect(check(source, "structure/duplicate-heading", {})).toEqual([]);
    expect(check(source, "structure/duplicate-heading", { siblingsOnly: false })).toMatchObject([
      {
        line: 7,
        message:
          'Heading "Setup" repeats the heading on line 3 in this outline; give it a distinct name.',
      },
    ]);
  });
  it("keeps quotes and footnotes independent and comparison case-sensitive", () => {
    const source = "## Setup\n\n> ## Setup\n\n[^n]: ## Setup\n\n## setup\n";
    expect(check(source, "structure/duplicate-heading", { siblingsOnly: false })).toEqual([]);
  });
});

describe("code language policy", () => {
  it.each(["\n", "\r\n", "\r"])("checks names and raw info-string whitespace with %j", (eol) => {
    const source = ["```js", "const a = 1;", "```", "", "~~~ JS title", "x", "~~~", ""].join(eol);
    const findings = check(source, "content/code-language", {
      allowedLanguages: ["js"],
      languageOnly: true,
    });
    expect(findings).toHaveLength(2);
    expect(findings.map((item) => source.slice(item.start, item.end))).toEqual([" JS title", "JS"]);
    expect(findings.every((item) => item.line === 5)).toBe(true);
  });
  it.each([
    ["```js\nx\n```\n", 0],
    ["``` js\nx\n```\n", 1],
    ["```js \nx\n```\n", 1],
    ["```js\ttitle\nx\n```\n", 1],
    ["- Item\n\n  ```js extra\n  x\n  ```\n", 1],
    ["> ```js extra\n> x\n> ```\n", 1],
    ["    indented code\n", 0],
  ])("checks only fenced headers: %j", (source, count) => {
    expect(check(source, "content/code-language", { languageOnly: true })).toHaveLength(count);
    expect(check(source, "content/code-language", {})).toEqual([]);
  });
  it("uses decoded, case-sensitive language names but reports the original token", () => {
    const source = "```j&#115;\nx\n```\n";
    expect(
      check(source, "content/code-language", { allowedLanguages: ["js"], languageOnly: true }),
    ).toEqual([]);
    const [finding] = check(source, "content/code-language", { allowedLanguages: ["JS"] });
    expect(source.slice(finding!.start, finding!.end)).toBe("j&#115;");
    expect(
      check("```anything metadata\nx\n```\n", "content/code-language", { allowedLanguages: [] }),
    ).toEqual([]);
    expect(
      check("```\nx\n```\n", "content/code-language", {
        allowedLanguages: ["js"],
        languageOnly: true,
      }),
    ).toHaveLength(1);
  });
  it.each([
    { allowedLanguages: "js" },
    { allowedLanguages: [""] },
    { allowedLanguages: [1] },
    { languageOnly: 1 },
  ])("rejects invalid options %j", (options) => {
    expect(() => lint("", settings("content/code-language", options))).toThrow(
      "Invalid options for content/code-language",
    );
  });
});

it("preserves suppression and range selection with configured rules", () => {
  const rule = "structure/duplicate-heading";
  const source =
    "# First\n\n## Repeated\n\n# Second\n\n<!-- mdtools-disable-next-line structure/duplicate-heading -->\n## Repeated\n\n# Repeated\n";
  const options = settings(rule, { siblingsOnly: false });
  expect(lint(source, options)).toMatchObject([{ line: 10 }]);
  expect(lint(source, { ...options, ranges: [{ start: 0, end: 7 }] })).toEqual([]);
  const start = source.lastIndexOf("# Repeated");
  expect(lint(source, { ...options, ranges: [{ start, end: start + 10 }] })).toMatchObject([
    { line: 10 },
  ]);
  const config: Config = {
    extends: [],
    rules: { [rule]: ["error", { siblingsOnly: false }] },
    overrides: [{ files: ["local/**"], rules: { [rule]: ["error", { siblingsOnly: true }] } }],
  };
  expect(lint(source, { path: "local/a.md", config })).toEqual([]);
});
