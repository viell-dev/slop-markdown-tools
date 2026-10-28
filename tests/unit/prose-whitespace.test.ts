import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { normalizeHtml } from "../../scripts/rendering.mjs";
import { dialects, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

function check(source: string, expected: string, rule: string, dialect: Dialect, options = {}) {
  const config: Config = { extends: [], dialect, rules: { [rule]: ["warn", options] } };
  const result = format(source, { config });
  expect(result.output).toBe(expected);
  expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
  expect(format(expected, { config }).output).toBe(expected);
  expect(semanticFingerprint(parse(expected, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  // Compare displayed whitespace, while retaining literal pre/code content.
  const normalize = (s: string) => normalizeHtml(new MarkdownIt({ html: true }).render(s));
  expect(normalize(expected)).toBe(normalize(source));
  expect(format(source, { config: { extends: [], dialect, rules: {} } }).output).toBe(source);
  return lint(source, { config });
}

describe.each(dialects)("prose whitespace in %s", (dialect) => {
  it.each(["\n", "\r\n"])("collapses spaces without reflow with %j", (eol) => {
    check(
      `a.  b   c${eol}next  line  ${eol}last${eol}`,
      `a. b c${eol}next line  ${eol}last${eol}`,
      "style/prose-space",
      dialect,
    );
    check(
      `[some  text](<a  b> "a  title") and \`a  b\` with a\u00a0\u00a0b${eol}`,
      `[some text](<a  b> "a  title") and \`a  b\` with a\u00a0\u00a0b${eol}`,
      "style/prose-space",
      dialect,
    );
    check(`  a  b${eol}`, `  a b${eol}`, "style/prose-space", dialect);
  });
  it("keeps literal regions, tables and inline HTML contexts", () => {
    for (const source of [
      "```\na  b\n```\n",
      "    a  b\n",
      '<pre style="white-space: pre">a  b</pre>\n',
      'a <span style="white-space: pre">b  c</span> d  e\n',
      "---\ntitle: a  b\n---\n",
      "| a  b | c |\n| --- | --- |\n| d  e | f |\n",
    ]) {
      if (dialect === "commonmark" && source.startsWith("|")) continue;
      check(source, source, "style/prose-space", dialect);
    }
    if (dialect !== "commonmark" && dialect !== "vitepress")
      check("a $b  c$ d\n", "a $b  c$ d\n", "style/prose-space", dialect);
  });
  it("replaces prose tabs and preserves literal tabs", () => {
    check("a\tb\n", "a b\n", "style/no-tabs", dialect);
    check("a\tb\n", "a  b\n", "style/no-tabs", dialect, { spacesPerTab: 2 });
    for (const source of [
      "`a\tb`\n",
      "```js\n\tcode\n```\n",
      "---\nx: a\tb\n---\n",
      "<pre>a\tb</pre>\n",
    ]) {
      const findings = check(source, source, "style/no-tabs", dialect);
      expect(findings.every((d) => !d.edit)).toBe(true);
    }
  });
  it("can exclude all code blocks or selected languages", () => {
    for (const lang of ["make", "makefile", "go"]) {
      const source = `\`\`\`${lang}\n\tcommand\n\`\`\`\n`;
      expect(
        check(source, source, "style/no-tabs", dialect, { ignoredCodeLanguages: [lang] }),
      ).toEqual([]);
      expect(check(source, source, "style/no-tabs", dialect, { codeBlocks: false })).toEqual([]);
    }
    for (const [lang, ignored] of [
      ["Go", "go"],
      ["go", "GO"],
      ["MAKE", "make"],
    ]) {
      const source = `\`\`\`${lang}\n\tcommand\n\`\`\`\n`;
      expect(
        check(source, source, "style/no-tabs", dialect, {
          ignoredCodeLanguages: [ignored],
        }),
      ).toEqual([]);
    }
  });
  it.each(["\n", "\r\n"])("reports heading whitespace without editing anchors with %j", (eol) => {
    for (const [rule, gap] of [
      ["style/no-tabs", "\t"],
      ["style/prose-space", "  "],
    ]) {
      for (const source of [`# a${gap}b${eol}`, `a${gap}b${eol}===${eol}`]) {
        const findings = check(source, source, rule!, dialect);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.edit).toBeUndefined();
      }
    }
  });
  it("preserves tab stops and reports ambiguous container prefixes without edits", () => {
    for (const source of ["- one\n \t- two\n", "- one\n  \tcontinued\n", ">\ttext\n"]) {
      const expected = dialect === "obsidian" ? source : source.replace(/^ +\t/gm, "    ");
      check(source, expected, "style/no-tabs", dialect);
    }
  });
});

it.each(["\n", "\r\n"])("keeps VitePress syntax and Vue expressions literal with %j", (eol) => {
  for (const source of [
    "::: tip\tTitle\nx\n:::\n",
    "<<< @/example\tfile.js\n",
    "[[toc]]\t\n",
    "{{ s.split('a\tb') }}\n",
    "before {{ 'a\tb' }} after\n",
    "{{\n 'a\tb'\n}}\n",
    "text {.a\tb}\n",
  ]) {
    const input = source.replaceAll("\n", eol);
    const findings = check(input, input, "style/no-tabs", "vitepress");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.edit).toBeUndefined();
    const spaces = input.replaceAll("\t", "  ");
    expect(check(spaces, spaces, "style/prose-space", "vitepress")).toEqual([]);
  }
  check(
    "before  {{ s.split('  ') }}  after\n",
    "before {{ s.split('  ') }} after\n",
    "style/prose-space",
    "vitepress",
  );
});

it.each(["\t\tcode\n", "- a\n\n\t\tcode\n"])(
  "reports VitePress indented code tabs: %j",
  (source) => {
    const findings = check(source, source, "style/no-tabs", "vitepress");
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => !finding.edit)).toBe(true);
    expect(check(source, source, "style/no-tabs", "vitepress", { codeBlocks: false })).toEqual([]);
  },
);

it("retains Obsidian tab-only separators and list nesting", () => {
  for (const source of ["- parent\n\t- child\n\t\t- grandchild\n", "before\n\t\nafter\n"]) {
    check(source, source, "style/no-tabs", "obsidian");
  }
});

it("agrees with wrapping and validates tab options", () => {
  const config: Config = {
    extends: [],
    rules: { "style/no-tabs": "warn", "style/prose-space": "warn", "style/wrap": "warn" },
  };
  const result = format("a\tb   c\n", { config });
  expect(result.output).toBe("a b c\n");
  expect(format(result.output, { config }).output).toBe(result.output);
  for (const options of [
    { spacesPerTab: -1 },
    { spacesPerTab: 1.5 },
    { codeBlocks: "yes" },
    { ignoredCodeLanguages: [1] },
    { unknown: true },
  ]) {
    expect(() => lint("", { config: { rules: { "style/no-tabs": ["warn", options] } } })).toThrow();
  }
});

it.each(dialects)("keeps multiline container prefixes in %s", (dialect) => {
  check("> first\n>\tsecond\n", "> first\n>\tsecond\n", "style/no-tabs", dialect);
  check("> first\n>   second  word\n", "> first\n>   second word\n", "style/prose-space", dialect);
  check("a\t \nb\n", "a\t \nb\n", "style/no-tabs", dialect);
});

it.each(dialects)("reports headings and tables and handles CRLF tabs in %s", (dialect) => {
  const config: Config = { extends: [], dialect, rules: { "style/no-tabs": "warn" } };
  expect(lint("# a\tb\n", { config }).some((d) => d.rule === "style/no-tabs")).toBe(true);
  expect(
    lint("| a\tb | c |\n| --- | --- |\n", { config }).some((d) => d.rule === "style/no-tabs"),
  ).toBe(true);
  check("a\tb\r\nnext\tword\r\n", "a b\r\nnext word\r\n", "style/no-tabs", dialect);
  check(
    "- one\r\n \t- two\r\n",
    dialect === "obsidian" ? "- one\r\n \t- two\r\n" : "- one\r\n    - two\r\n",
    "style/no-tabs",
    dialect,
    { spacesPerTab: 1 },
  );
  const code = lint("```js\n\tcode\n```\n", { config });
  expect(code).toHaveLength(1);
  expect(code[0]?.edit).toBeUndefined();
});

it.each(dialects)("accepts zero width safely and excludes spans in %s", (dialect) => {
  check("a \tb\n", "a b\n", "style/no-tabs", dialect, { spacesPerTab: 0 });
  const findings = check("a\tb\n", "a\tb\n", "style/no-tabs", dialect, { spacesPerTab: 0 });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.edit).toBeUndefined();
  expect(check("`a\tb`\n", "`a\tb`\n", "style/no-tabs", dialect, { codeBlocks: false })).toEqual(
    [],
  );
});
