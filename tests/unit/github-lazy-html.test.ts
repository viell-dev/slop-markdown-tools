import { describe, expect, it } from "vitest";
import { format, parse, range, semanticFingerprint } from "../../src/index.js";
import type { Config, Plugin, RuleSetting } from "../../src/index.js";
import { rendererProtections } from "../../src/syntax/renderer-protections.js";
import { commonFixtures } from "../fixtures/renderers/common.mjs";

const github = (rules: Record<string, RuleSetting>): Config => ({
  extends: [],
  dialect: "github",
  rules,
});
const configurations: Config[] = [
  { extends: ["recommended", "github"], dialect: "github" },
  github({ "style/emphasis": "warn", "style/strong": "warn" }),
  github({ "style/wrap": ["warn", { width: 20 }] }),
  github({ "style/lazy-continuation": "warn" }),
  github({ "style/ordered-list": ["warn", { numbering: "same" }] }),
  github({ "style/ordered-list": ["warn", { numbering: "ordered" }] }),
  github({ "style/block-spacing": "warn", "style/blank-lines": "warn" }),
  github({
    "style/list-marker": "warn",
    "style/list-indent": "warn",
    "style/quote-marker": "warn",
  }),
];
function checked(source: string, config: Config) {
  const result = format(source, { config });
  expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config }).output).toBe(result.output);
  expect(semanticFingerprint(parse(result.output, "github"))).toBe(
    semanticFingerprint(parse(source, "github")),
  );
  return result.output;
}
const regions = (source: string) =>
  [...rendererProtections(parse(source, "github")).boundaryText].map(range);
const crlf = (source: string) => source.replaceAll("\n", "\r\n");

describe("GitHub's reading of a lazy line that starts a type 7 HTML block (#762)", () => {
  // GitHub ends the containers that the line does not continue and reads HTML
  // up to the next blank line, so the markers below the tag are literal text
  // there; the primary reading, as CommonMark's, keeps the line in the
  // paragraph. Each source's native rendering was compared with `gh api markdown`.
  it.each([
    "- a *words\n<b>\nmore* after\n",
    "- a\n<b>\n*words*\n",
    "> a\n<span>\n*words*\n",
    "- a\n</b>\n*words*\n",
    "- a\n</pre>\n*words*\n",
    "1. a\n<i>\n**strong** and `code` and [l](https://example.com)\n",
    "- > a\n<b>\n*w*\n",
    "> - a\n<b>\n*w*\n",
    "> - a\n> <b>\n> *w*\n",
    "- - a\n<b>\n*w*\n",
    "- [ ] task\n<b>\n*w*\n",
    "> [!NOTE]\n> a\n<b>\n*w*\n",
    "a[^1]\n\n[^1]: note\n<b>\n*w*\n",
    '- a\n<a href="https://example.com">\n*w*\n',
    "- a\n<b/> \t\n*w*\n",
    ">  a\n> b\n</b>\n*words*\n",
    // Blocks that interrupt the CommonMark paragraph are HTML on GitHub.
    "- a\n<b>\nmore\n# h *x*\n- c *y*\n",
    // Later items and blocks of the primary container are GitHub's own blocks.
    "1. x\n2. a\n<i>\n*w*\n\n3. y\n4. z\n",
    "- x\n- a\n<b>\nmore\n\n- y *z*\n",
    "*   a\n<b>\nmore\n\n    continued *x*\n",
    "> - a\n> <b>\n> *w*\n>\n> - b *c*\n",
  ])("leaves %j as written", (source) => {
    for (const input of [source, crlf(source)]) {
      for (const config of configurations) expect(checked(input, config)).toBe(input);
      expect(regions(input).length).toBeGreaterThan(0);
    }
  });

  // The lazy line extends the paragraph text, which CommonMark can then read as
  // a Setext heading or as link definitions before a paragraph or heading.
  it.each([
    "- a *words\n<b>\nmore* after\n  ---\n",
    "> a *words\n<b>\nmore* after\n> ===\n",
    "- > a *w\n<b>\nx* y\n  > ---\n",
    "- [x]: /url\n<b>\n*words*\n",
    "- [x]: /u\n[y]: /v\n<b>\n*w*\n",
    "> [x]: /u\n> [y]: /v\n<b>\n*w*\n",
    "- > [x]: /u\n<b>\n*w*\n",
    "> - [x]: /u\n<b>\n*w*\n",
    "- [x]: /u\n<b>\nmore *w*\n  ---\n",
    // The tag line is the definition's destination or inside its title.
    "- [x]:\n<b>\n*w*\n",
    '- [x]: /u "a\n<b>\nc"\n*w*\n',
    // A table's attempt leaves the tag line as HTML inside the item.
    '- a\n<b title="|">\n  |-|-|\n*w*\n',
  ])("leaves %j as written", (source) => {
    for (const input of [source, crlf(source)]) {
      for (const config of configurations) expect(checked(input, config)).toBe(input);
      expect(regions(input).length).toBeGreaterThan(0);
    }
  });

  it("protects the paragraph text's region after a heading or definitions", () => {
    for (const source of [
      "- a *words\n<b>\nmore* after\n  ---\n\nAfter *y*.\n",
      "- [x]: /u\n[y]: /v\n<b>\n*w*\n\nAfter *y*.\n",
    ])
      for (const input of [source, crlf(source)]) {
        const after = input.indexOf("After");
        expect(regions(input)).toEqual([[0, after]]);
        expect(checked(input, configurations[1]!)).toBe(
          `${input.slice(0, after)}After _y_.${input.slice(after + 10)}`,
        );
      }
  });

  it.each([
    // A blank line ends the paragraph text; the tag starts an ordinary block.
    ["- [x]: /url\n\n<b>\n*words*\n", "- [x]: /url\n\n<b>\n*words*\n"],
    ["- a *w\n  ---\n\n<b>\n*w*\n", "- a *w\n  ---\n\n<b>\n*w*\n"],
    // The tag line continues the item, as GitHub reads it too.
    ["- [x]: /url\n  <b>\n  *words*\n", "- [x]: /url\n  <b>\n  _words_\n"],
    ["- a *w\n  <b>\n  x* y\n  ---\n", "- a _w\n  <b>\n  x_ y\n  ---\n"],
    ["> [x]: /u\n> <b>\n> *w*\n", "> [x]: /u\n> <b>\n> _w_\n"],
    // An ATX heading takes no lazy line; the tag line is a block of its own.
    ["- # h *x*\n<b>\n*w*\n", "- # h _x_\n<b>\n*w*\n"],
    ["- # h\n  <b>\n  *w*\n", "- # h\n  <b>\n  *w*\n"],
  ])("formats %j after a heading or definition where GitHub reads alike", (source, expected) => {
    for (const [input, output] of [
      [source, expected],
      [crlf(source), crlf(expected)],
    ] as const) {
      expect(regions(input)).toEqual([]);
      expect(checked(input, configurations[1]!)).toBe(output);
    }
  });

  it("protects from GitHub's first ended container through the blank line", () => {
    const source = "Intro *x*.\n\n- a\n- b\n<b>\n*w*\n\nAfter *y*.\n\n> q\n</b>\n*w*\n";
    const list = source.indexOf("- a");
    const quote = source.indexOf("> q");
    expect(regions(source)).toEqual([
      [list, source.indexOf("After")],
      [quote, source.length],
    ]);
    expect(checked(source, configurations[0]!)).toBe(
      "Intro _x_.\n\n- a\n- b\n<b>\n*w*\n\nAfter _y_.\n\n> q\n</b>\n*w*\n",
    );
    // A matched quote stays outside; its list is the first ended container.
    const nested = "> Quote *x*.\n>\n> - a\n> <b>\n> *w*\n";
    expect(regions(nested)).toEqual([[nested.indexOf("- a"), nested.length]]);
    // A top-level block that starts before the blank line extends the range.
    const root = "> a\n<b>\n- x\n\n  more *x*\n\nAfter *y*.\n";
    expect(regions(root)).toEqual([[0, root.indexOf("\n\nAfter")]]);
  });

  it.each([
    // The line continues every container, so GitHub reads a paragraph too.
    ["- a\n  <b>\n  *w*\n", "- a\n  <b>\n  _w_\n"],
    ["> a\n> <b>\n> *w*\n", "> a\n> <b>\n> _w_\n"],
    // Text after the tag, or a tag indented as code, starts no HTML block.
    ["- a\n<b> c *w*\n", "- a\n<b> c _w_\n"],
    ["- a\n<b\n*w*\n", "- a\n<b\n_w_\n"],
    // A paragraph outside containers is read the same way by every renderer.
    ["a *words\n<b>\nmore* after\n", "a _words\n<b>\nmore_ after\n"],
  ])("formats %j where GitHub reads a paragraph", (source, expected) => {
    expect(regions(source)).toEqual([]);
    expect(checked(source, configurations[1]!)).toBe(expected);
  });

  it("retains the range for a custom rule", () => {
    const source = "- a\n<b>\n*w*\n";
    const plugin: Plugin = {
      name: "star",
      rules: {
        star: {
          kind: "style",
          description: "Replace the stars after the tag",
          check: ({ document }) => {
            const start = document.source.indexOf("*w*");
            return [{ start, message: "Replace", edit: { start, end: start + 3, text: "_w_" } }];
          },
        },
      },
    };
    const config: Config = { extends: [], dialect: "github", rules: { "star/star": "warn" } };
    expect(format(source, { config, plugins: [plugin] }).output).toBe(source);
    expect(
      format(source, { config: { ...config, dialect: "commonmark" }, plugins: [plugin] }).output,
    ).toBe("- a\n<b>\n_w_\n");
  });

  it("keeps the CommonMark reading's formatting in the other dialects", () => {
    for (const dialect of ["commonmark", "forgejo", "gitea", "obsidian", "vitepress"] as const) {
      const document = parse("- a\n<b>\n*w*\n", dialect);
      expect([...rendererProtections(document).boundaryText]).toEqual([]);
    }
    expect(
      format("- a\n<b>\n*w*\n", { config: { extends: ["recommended"], dialect: "forgejo" } })
        .output,
    ).toBe("- a\n<b>\n_w_\n");
    // Forgejo and Gitea keep the tag line after a definition in the item too;
    // markdown-it ends the item there, which VitePress's own reading keeps.
    const definition = "- [x]: /url\n<b>\n*words*\n";
    for (const dialect of ["commonmark", "forgejo", "gitea", "vitepress"] as const)
      expect([...rendererProtections(parse(definition, dialect)).boundaryText]).toEqual([]);
    for (const dialect of ["forgejo", "gitea"] as const)
      expect(format(definition, { config: { extends: ["recommended"], dialect } }).output).toBe(
        "- [x]: /url\n<b>\n  _words_\n",
      );
    expect(
      format(definition, { config: { extends: ["recommended"], dialect: "vitepress" } }).output,
    ).toBe(definition);
  });

  it("leaves the native fixtures' GitHub regions as written", () => {
    for (const name of [
      "lazy-html-line",
      "lazy-html-emphasis",
      "lazy-html-markers",
      "lazy-html-paragraph-text",
    ]) {
      const { source } = commonFixtures.find((fixture) => fixture.name === name)!;
      const output = checked(source, configurations[0]!);
      // Formatting changes the fixture outside the regions, so the native
      // comparison renders it, and leaves each region's source as written.
      expect(output, name).not.toBe(source);
      const found = regions(source);
      expect(found.length, name).toBeGreaterThan(0);
      for (const [start, end] of found) expect(output, name).toContain(source.slice(start, end));
    }
  });
});
