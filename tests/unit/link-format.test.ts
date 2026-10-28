import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { dialects, lint } from "../../src/index.js";
import { formatted, only } from "../support/rules.js";

const rules = { "style/link-title": "warn", "style/definition-spacing": "warn" } as const;
const parser = new Parser();
const renderer = new HtmlRenderer();
const markdown = new MarkdownIt();

function preserved(source: string, output: string) {
  expect(renderer.render(parser.parse(output))).toBe(renderer.render(parser.parse(source)));
  expect(markdown.render(output)).toBe(markdown.render(source));
}

describe("link titles and reference definition spacing", () => {
  it.each(dialects)("normalizes titles and same-line separators in %s", (dialect) => {
    const source = `[a](https://example.com/a(b) 'A &amp; B') ![b](<b.png> (Image))

[ref]:   <https://example.com>   'Title'

[ref]
`;
    const output = formatted(source, only(rules, dialect));
    expect(output).toBe(`[a](https://example.com/a(b) "A &amp; B") ![b](<b.png> "Image")

[ref]:${dialect === "obsidian" ? "   " : " "}<https://example.com>${dialect === "obsidian" ? "   " : " "}"Title"

[ref]
`);
    preserved(source, output);
    expect(formatted(source, only({}, dialect))).toBe(source);
  });

  it.each(dialects)("keeps escapes, collisions, line endings and containers in %s", (dialect) => {
    for (const newline of ["\n", "\r\n"]) {
      const source = String.raw`[a](u 'a "quote"') [b](v 'back\\slash &quot; \"')

[c](w 'first
second')

> [d](u 'Title')

- [e](u 'Title')

[ref]:
  <url>
  'first
  second'

[ref]

    [a](u 'code')

<div>[a](u 'html')</div>
`.replaceAll("\n", newline);
      const output = formatted(source, only(rules, dialect));
      expect(output).toContain(`[a](u 'a "quote"')`);
      expect(output).toContain('"first' + newline + 'second"');
      expect(output).toContain("[ref]:" + newline + "  <url>" + newline);
      preserved(source, output);
    }
  });

  it.each(["double", "single", "parentheses", "consistent"])("supports %s titles", (delimiter) => {
    const source = `[a](u 'first') [b](v "second") ![c](w (third))\n`;
    const output = formatted(source, only({ "style/link-title": ["warn", { delimiter }] }));
    const marker = delimiter === "double" ? '"' : delimiter === "parentheses" ? "(" : "'";
    const close = marker === "(" ? ")" : marker;
    expect(output).toBe(
      `[a](u ${marker}first${close}) [b](v ${marker}second${close}) ![c](w ${marker}third${close})\n`,
    );
    preserved(source, output);
  });

  it("retains the current delimiter to avoid escapes and keeps empty titles", () => {
    const source = `[a](u 'a(b)') [b](v '"quoted"') [c](w '')\n`;
    expect(
      formatted(source, only({ "style/link-title": ["warn", { delimiter: "parentheses" }] })),
    ).toBe(`[a](u 'a(b)') [b](v ("quoted")) [c](w ())\n`);
  });

  it.each(dialects)("preserves multiline definitions and unrelated syntax in %s", (dialect) => {
    const source = `[multi
label]:   url   "title"

[x]:
  url
  "title"

> [y]:  url
>   "title"

[[note]] ![[embed]]

[^note]:   text
`;
    const output = formatted(source, only({ "style/definition-spacing": "warn" }, dialect));
    expect(output).toBe(source);
  });

  it("preserves definitions without whitespace that renderers read differently", () => {
    const source = String.raw`[a\]:b]:<url>		"title"
[a\]:b]
`;
    const output = formatted(source, only(rules));
    expect(output).toBe(String.raw`[a\]:b]:<url>		"title"
[a\]:b]
`);
    preserved(source, output);
  });

  it.each(["[a]: ()\n\n[a]\n", "[a]: ''\n\n[a]\n", "[a]( '')\n", "[a]( () )\n"])(
    "keeps a destination that resembles an empty title: %s",
    (source) => {
      const output = formatted(source, only(rules));
      expect(output).toBe(source);
      preserved(source, output);
    },
  );

  it("normalizes explicit empty titles and their separators", () => {
    const source = "[a](u '') ![b](v ())\n\n[r]:   url   ''\n\n[r]\n";
    const output = formatted(source, only(rules));
    expect(output).toBe('[a](u "") ![b](v "")\n\n[r]: url ""\n\n[r]\n');
    preserved(source, output);
  });

  it("normalizes spaces on ordinary definitions", () => {
    const source = '[a]:   <url>   "Title"\n\n[a]\n';
    const output = formatted(source, only(rules));
    expect(output).toBe('[a]: <url> "Title"\n\n[a]\n');
    preserved(source, output);
  });

  it.each(["[a]:<url>   'Title'", "[a]:   <url>\t\t'Title'", "[a]:\turl 'Title'"])(
    "preserves reference parser disagreement: %s",
    (line) => {
      const source = line + "\n\n[a]\n";
      const output = formatted(source, only(rules));
      expect(output).toBe(source);
      preserved(source, output);
    },
  );

  it("leaves forge heading source and wikilinks intact", () => {
    const source = `# [a](u 'title')\n`;
    for (const dialect of ["forgejo", "gitea"] as const)
      expect(formatted(source, only(rules, dialect))).toBe(source);
    expect(lint("[[note]] ![[image]]", { config: only(rules, "obsidian") })).toEqual([]);
  });

  it("validates the delimiter option and keeps the new rules opt-in", () => {
    expect(() =>
      lint("", { config: only({ "style/link-title": ["warn", { delimiter: "invalid" }] }) }),
    ).toThrow();
    expect(lint(`[a](https://example.com 'title')\n`).filter((item) => item.rule in rules)).toEqual(
      [],
    );
  });
});
