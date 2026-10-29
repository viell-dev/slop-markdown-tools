import { describe, expect, it } from "vitest";
import { format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect, Workspace } from "../../src/index.js";

const dialects: Dialect[] = ["commonmark", "github", "forgejo", "gitea", "obsidian", "vitepress"];
const workspace: Workspace = { strictLineBreaks: true, resolve: () => ({ status: "missing" }) };
function unwrap(source: string, dialect: Dialect = "github", options = {}) {
  const config: Config = {
    extends: [],
    dialect,
    rules: { "style/wrap": ["warn", { mode: "never", ...options }] },
  };
  const result = format(source, { config, workspace });
  expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  expect(format(result.output, { config, workspace }).output).toBe(result.output);
  return result;
}
function lengths(source: string, options = {}, dialect: Dialect = "github") {
  const config: Config = {
    extends: [],
    dialect,
    rules: { "content/line-length": ["warn", { lineLength: 20, ...options }] },
  };
  expect(format(source, { config }).output).toBe(source);
  return lint(source, { config });
}

describe("paragraph unwrapping", () => {
  it.each(dialects)("joins prose and keeps structure in %s", (dialect) => {
    for (const newline of ["\n", "\r\n"]) {
      const source =
        "First [linked](https://example.com) line\nsecond *emphasized* line.\n\n> One\n> two\n\n- First\n  second\n".replaceAll(
          "\n",
          newline,
        );
      expect(unwrap(source, dialect).output).toBe(
        "First [linked](https://example.com) line second *emphasized* line.\n\n> One two\n\n- First second\n".replaceAll(
          "\n",
          newline,
        ),
      );
    }
  });
  it.each(dialects)("keeps protected paragraphs in %s", (dialect) => {
    for (const source of [
      "One  \ntwo\n",
      "One\\\ntwo\n",
      "One <b>bold</b>\ntwo\n",
      "-\nfollowing text\n",
      "#\nfollowing text\n",
      "{{ value }}\ntext\n",
      "Text\n---\n",
      "```js\na b\nc d\n```\n",
      "[ref]: /a\n\nText\n",
    ])
      expect(unwrap(source, dialect).output).toBe(source);
  });
  it("keeps Obsidian lines without strict line breaks", () => {
    expect(
      format("one\ntwo\n", {
        config: {
          extends: [],
          dialect: "obsidian",
          rules: { "style/wrap": ["warn", { mode: "never" }] },
        },
      }).output,
    ).toBe("one\ntwo\n");
  });
  it.each(dialects.filter((dialect) => dialect !== "vitepress"))(
    "keeps ambiguous front matter in %s",
    (dialect) => {
      const source = "---\ntitle: first\ntitle: |\n  ```js\n---\n# Body\n";
      expect(unwrap(source, dialect).output).toBe(source);
    },
  );
  it("ignores width and overflow reports", () => {
    const source = `${"word ".repeat(30).trim()}\nnext line\n`;
    const result = unwrap(source, "github", {
      width: 20,
      reportUnreflowed: true,
      reportUnbreakable: true,
    });
    expect(result.output).toBe(source.trim().replace("\n", " ") + "\n");
    expect(result.diagnostics.every((d) => d.edit)).toBe(true);
  });
  it("keeps distinct quote paragraphs and inline link destinations", () => {
    expect(unwrap("> [one](https://example.com)\n>\n> [two](https://example.org)\n").output).toBe(
      "> [one](https://example.com)\n>\n> [two](https://example.org)\n",
    );
    expect(unwrap('[one](https://example.com\n "title")\nmore text\n').output).toBe(
      '[one](https://example.com\n "title")\nmore text\n',
    );
  });
});

describe("literal block line length", () => {
  const source =
    "# heading with many many words\n\n```js\nconst longName = 'many words here';\n```\n\n| heading with many words | b |\n| --- | --- |\n| many many many words | b |\n\nProse with many many many words here.\n";
  it.each(dialects)("reports only named blocks in %s", (dialect) => {
    const found = lengths(source, {}, dialect);
    expect(found.map((d) => d.line)).toEqual(dialect === "commonmark" ? [1, 4] : [1, 4, 7, 9]);
    expect(found.every((d) => !d.edit)).toBe(true);
    expect(lengths(source.replaceAll("\n", "\r\n"), {}, dialect).map((d) => d.line)).toEqual(
      found.map((d) => d.line),
    );
  });
  it("supports per-kind limits, switches and zero", () => {
    expect(
      lengths(source, { headingLineLength: 100, codeBlockLineLength: 100, tables: false }),
    ).toEqual([]);
    expect(lengths(source, { headings: false, codeBlocks: false }).map((d) => d.line)).toEqual([
      7, 9,
    ]);
    expect(lengths(source, { lineLength: 0 })).toEqual([]);
  });
  it("distinguishes default, stern and strict", () => {
    const source = "# short aaaaaaaaaaaaaaaaaaaaaaaaaa\n\n# aaaaaaaaaaaaaaaaaaaaaaaaaa\n";
    expect(lengths(source)).toEqual([]);
    expect(lengths(source, { stern: true }).map((d) => d.line)).toEqual([1]);
    expect(lengths(source, { strict: true, stern: true }).map((d) => d.line)).toEqual([1, 3]);
  });
  it("measures wide characters, combining marks and tab stops", () => {
    expect(lengths(`# ${"漢".repeat(10)}\n`, { strict: true })).toHaveLength(1);
    expect(lengths(`# ${"漢".repeat(10)}\n`, { strict: true, measure: "codepoints" })).toEqual([]);
    expect(lengths(`# ${"e\u0301".repeat(10)}\n`, { strict: true })).toEqual([]);
    expect(lengths(`\t${"x".repeat(17)}\n`, { strict: true })).toHaveLength(1);
  });
  it("excludes unnamed blocks and handles Setext and fence lines", () => {
    expect(
      lengths(
        "---\ntitle: long long long long long\n---\n\n<div>long long long long long long</div>\n\n$$\nlong long long long long long\n$$\n\n[ref]: /long/long/long/long/long\n",
        { strict: true },
      ),
    ).toEqual([]);
    expect(
      lengths("long long long long long\n========================\n", { strict: true }),
    ).toHaveLength(2);
    expect(lengths("```a-very-long-language-name\n```\n", { strict: true })).toHaveLength(1);
  });
  it("validates new options", () => {
    expect(() => lengths("", { lineLength: -1 })).toThrow();
    expect(() => unwrap("", "github", { mode: "other" })).toThrow();
  });
});
