import { describe, expect, it } from "vitest";
import { dialects, format, lint } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

/**
 * The findings of one problem rule, which formatting reports too without
 * changing the document, and which no other rule makes.
 */
function check(
  source: string,
  rule: string,
  dialect: Dialect = "github",
  options?: Record<string, unknown>,
) {
  const config: Config = {
    extends: [],
    dialect,
    rules: { [rule]: options ? ["warn", options] : "warn" },
  };
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
/** The dialects that render HTML blocks; VitePress keeps them, Vue templates, opaque. */
const rendering = dialects.filter((name) => name !== "vitepress");
/** The dialects that render HTML blocks and read them as the parser does. */
const reading = rendering.filter((name) => name !== "obsidian");

describe("content/image-alt with HTML images", () => {
  const rule = "content/image-alt";
  const image = (source: string, dialect: Dialect = "github") =>
    spans(source, check(source, rule, dialect));
  const message =
    'Add an alt attribute to the HTML image, for readers who cannot see it, or alt="" if it is decorative.';
  it.each([
    ['<img src="chart.png">\n', '<img src="chart.png">'],
    ['Text <img src="chart.png"> text.\n', '<img src="chart.png">'],
    ['<IMG SRC="chart.png" />\n', '<IMG SRC="chart.png" />'],
    [
      '<p align="center">\n  <img src="logo.svg" width="80">\n</p>\n',
      '<img src="logo.svg" width="80">',
    ],
    ['<img\n  src="chart.png"\n  title="alt">\n', '<img\n  src="chart.png"\n  title="alt">'],
    // An `alt` in another attribute's value, or on another element, gives none.
    ['<img src="x.png" title="alt=\'a\'">\n', '<img src="x.png" title="alt=\'a\'">'],
    ['<span alt="a"><img src="x.png"></span>\n', '<img src="x.png">'],
    ['<img src="x.png" aria-hidden="false">\n', '<img src="x.png" aria-hidden="false">'],
    ['[<img src="badge.svg">](https://example.com/ci)\n', '<img src="badge.svg">'],
    ['| <img src="x.png"> |\n| --- |\n', '<img src="x.png">'],
    ["## Logo <img src='x.png'>\n", "<img src='x.png'>"],
    ['<picture>\n<source srcset="x.webp">\n<img src="x.png">\n</picture>\n', '<img src="x.png">'],
    // A closed raw-text element or comment ends where its end tag does.
    ['<style>p { color: red }</style>\n<img src="x.png">\n', '<img src="x.png">'],
    ['Text <textarea>a</textarea> <img src="x.png">\n', '<img src="x.png">'],
    ['<div>\n<!-- note --> <img src="x.png">\n</div>\n', '<img src="x.png">'],
  ])("reports an HTML image without alt: %j", (source, span) => {
    for (const dialect of rendering) {
      const findings = check(source, rule, dialect);
      expect(spans(source, findings), dialect).toEqual([span]);
      expect(findings[0]?.message).toBe(message);
    }
  });
  it("locates HTML images inside block quotes and list items", () => {
    for (const newline of ["\n", "\r\n"]) {
      const source = [
        "> <div>",
        '> <p><img src="a.png"></p>',
        "> </div>",
        "",
        "- <div>",
        '  <img src="b.png" alt="B"><img src="c.png">',
        "  </div>",
        "",
        '> Quoted <img src="d.png"> text.',
        "",
      ].join(newline);
      for (const dialect of rendering) {
        const findings = check(source, rule, dialect);
        expect(spans(source, findings), dialect).toEqual([
          '<img src="a.png">',
          '<img src="c.png">',
          '<img src="d.png">',
        ]);
        expect(findings.map((item) => item.line)).toEqual([2, 6, 9]);
      }
    }
  });
  it.each([
    // `alt=""` marks a decorative image in HTML, as blank Markdown text cannot.
    ['<img src="divider.png" alt="">\n', "github"],
    ['<img src="divider.png" alt>\n', "github"],
    ["<img src=chart.png alt=Sales>\n", "github"],
    ['<img src="chart.png" ALT="Sales">\n', "github"],
    ['<img src="x.png" aria-hidden="true">\n', "forgejo"],
    ['<img src="x.png" aria-hidden="true">\n', "gitea"],
    ['<img src="x.png" aria-hidden="true">\n', "obsidian"],
    ['<img src="x.png" aria-hidden=" TRUE ">\n', "commonmark"],
    ['<img src="x.png" hidden>\n', "obsidian"],
    ['<img src="x.png" style="display: none">\n', "forgejo"],
    // Not an image element: comments, code, and other text.
    ['<!-- <img src="x.png"> -->\n', "github"],
    ['Text <!-- <img src="x.png"> --> text.\n', "github"],
    ['`<img src="x.png">`\n\n```html\n<img src="x.png">\n```\n', "github"],
    ['\\<img src="x.png">\n', "github"],
    ['<imgx src="x.png"> <picture><source srcset="x.png"></picture>\n', "github"],
    ["<div>\n</p title=\"<img src='b.png'>\">\n</div>\n", "commonmark"],
    ["<div>\n<!x <img src='c.png'>\n</div>\n", "commonmark"],
    // Raw-text elements hold text.
    ['<textarea>\n<img src="x.png">\n</textarea>\n', "forgejo"],
    ['Text <textarea><img src="x.png"></textarea> text.\n', "gitea"],
    ["<script>let a = '<img src=\"x.png\">';</script>\n", "obsidian"],
    // Content that renderers do not certainly show.
    ['<template><img src="x.png"></template>\n', "commonmark"],
    ['<video controls>\n<img src="poster.png">\n</video>\n', "github"],
    ['<div hidden>\n<div></div>\n<img src="x.png">\n</div>\n', "forgejo"],
    ['<span aria-hidden="true"><img src="x.png"></span>\n', "obsidian"],
  ] as const)("accepts HTML %j in %s", (source, dialect) => {
    expect(check(source, rule, dialect)).toEqual([]);
  });
  it("reports images that GitHub's sanitizer exposes", () => {
    // GitHub's Markdown API removed `aria-hidden` and `hidden` here on
    // 2026-10-28 and 2026-10-29, and kept the image.
    for (const [source, span] of [
      ['Text <img src="x.png" aria-hidden="true"> text.\n', '<img src="x.png" aria-hidden="true">'],
      ['<div hidden><img src="x.png"></div>\n', '<img src="x.png">'],
      ['<span aria-hidden="true"><img src="x.png"></span>\n', '<img src="x.png">'],
    ]) {
      expect(image(source!), source).toEqual([span]);
      expect(check(source!, rule, "forgejo"), source).toEqual([]);
    }
  });
  it("reports only after the matching end of a hiding element", () => {
    const source =
      '<object data="x.svg">\n<object></object>\n<img src="a.png">\n</object>\n<img src="b.png">\n';
    for (const dialect of rendering)
      expect(image(source, dialect), dialect).toEqual(['<img src="b.png">']);
  });
  it.each([
    // An unclosed comment or raw-text element holds the rest of the page
    // where renderers read it as one, but Obsidian renders each block alone.
    'Text <textarea>\n\n<img src="x.png">\n\n</textarea>\n',
    'Text <textarea>\n\nNote </textarea>\n\n<img src="x.png">\n',
    '<div>\n<!-- start\n</div>\n\n<img src="x.png">\n',
    '<div title="a\n\n<img src="x.png">\n',
    '<plaintext>\n\n<img src="x.png">\n',
    // Comments inside raw text, abrupt comments and CDATA, which renderers may read apart.
    'Text <textarea><!-- </textarea> --><img src="x.png"> text.\n',
    '<script>\n<!--<script>\n</script>\n<img src="d.png">\n</script>\n',
    '<script>\n<!-- -->\n</script>\n<img src="e.png">\n',
    '<div>\n<!--> <img src="a.png">\n</div>\n',
    '<div>\n<![CDATA[ x ]]>\n<img src="a.png">\n</div>\n',
    // Footnotes are shown at the page's end, after the image written below them.
    'Text[^1] <textarea>\n\n[^1]: Note </textarea>\n\n<img src="x.png">\n',
    // A tag split across a container's lines.
    '> <img\n> src="x.png">\n',
    '- <div>\n  <img\n  src="x.png">\n  </div>\n',
    '> Text <img\n> src="x.png"> text.\n',
    // Only a longer name follows the end tag.
    'Text <textarea></textareas><img src="x.png"></textarea> text.\n',
  ])("leaves HTML whose reading is uncertain unreported: %j", (source) => {
    for (const dialect of dialects) expect(check(source, rule, dialect), dialect).toEqual([]);
  });
  it.each([
    // A browser ignores an end tag in a table, a `<select>` or a `<template>`
    // of an element opened outside it.
    '<div hidden><table></div><img src="x">\n',
    '<div hidden><select></div></select><img src="x">\n',
    '<div hidden><template></div></template><img src="x">\n',
    '<div hidden><table><tr><td></div></td></tr></table><img src="x">\n',
    // An end tag of an element outside a block that the renderer writes, such
    // as `<p>`, `<li>` or `<td>`.
    '<span hidden>\n\nText </span> <img src="x.png">\n',
    '<span hidden>\n\n- Item </span> <img src="x.png">\n',
    '<div hidden>\n\n| a |\n| --- |\n| </div> <img src="x.png"> |\n',
    // An element that a start tag closed: `<li>` closes the `<p>`, so the
    // browser ignores `</p>` and keeps the `<li>`, which `</span>` cannot close.
    '<span hidden><p><li></p></span><img src="x">\n',
    '<span hidden><p></span><img src="x">\n',
    // A formatting element that an end tag closed comes back around what follows.
    '<p><b hidden>x</p><img src="x">\n',
    'Text <b hidden>bold\n\n<img src="x.png">\n',
    // Whether `<html>` or `<body>` applies depends on how the page embeds the
    // HTML: parsed as a document, the image stays inside the hidden body.
    '<body hidden></body><img src="x">\n',
    '<html hidden></html><img src="x">\n',
  ])("keeps hiding after an end tag that a browser may ignore: %j", (source) => {
    // GitHub's sanitizer removes `hidden`.
    for (const dialect of dialects.filter((name) => name !== "github"))
      expect(check(source, rule, dialect), dialect).toEqual([]);
    // The tags are still elements, after the uncertain end tag too. Obsidian
    // reads some of these blocks otherwise, and its reading stops before them.
    const img = source.match(/<img[^>]*>/)![0];
    for (const dialect of reading)
      expect(spans(source, check(source, "content/html-element", dialect)), dialect).toContain(img);
  });
  it("reports images after uncertain end tags where nothing hides", () => {
    for (const source of [
      '<div><table></div><img src="x">\n',
      '<div><p>Text</div>\n<img src="x.png">\n',
      '<span>\n\nText </span> <img src="x.png">\n',
      '<div hidden><span></span></div><img src="x">\n',
      '<div hidden>\n\nText\n\n</div>\n\n<img src="x.png">\n',
    ])
      for (const dialect of reading)
        expect(image(source, dialect), `${dialect}: ${source}`).toEqual([
          source.match(/<img[^>]*>/)![0],
        ]);
  });
  it("reads footnote definitions after the rest of the page, when they are used", () => {
    const used = 'Text[^1]\n\n[^1]: Note <img src="f.png">\n\n[^2]: <img src="u.png">\n';
    // The footnote's unclosed textarea follows the body's image on the page.
    const after = 'Text[^1]\n\n[^1]: <textarea>\n\n<img src="b.png">\n';
    const duplicate = 'Text[^1]\n\n[^1]: Note\n\n[^1]: <img src="d.png">\n';
    const nested = 'Text[^1]\n\n[^1]: Note[^2]\n\n[^2]: <img src="n.png">\n';
    // A definition that leaves an element open hides those shown after it.
    const open = 'Text[^1][^2]\n\n[^1]: <span hidden>\n\n[^2]: <img src="h.png">\n';
    for (const dialect of ["github", "forgejo", "gitea", "obsidian"] as const) {
      expect(image(used, dialect), dialect).toEqual(['<img src="f.png">']);
      expect(image(after, dialect), dialect).toEqual(['<img src="b.png">']);
      expect(image(duplicate, dialect), dialect).toEqual([]);
      expect(image(nested, dialect), dialect).toEqual([]);
    }
    expect(image(open, "forgejo")).toEqual([]);
    expect(image(open, "github")).toEqual(['<img src="h.png">']);
    // So does one with an end tag that a browser may ignore, and one that
    // closes an element left open before the footnotes.
    const ignored =
      'Text[^1][^2]\n\n[^1]: <span hidden><p></span></p></span>\n\n[^2]: <img src="i.png">\n';
    const closing = '<div>\n\nText[^1][^2]\n\n[^1]: Note </div><span>\n\n[^2]: <img src="c.png">\n';
    for (const dialect of ["forgejo", "gitea", "obsidian"] as const) {
      expect(image(ignored, dialect), dialect).toEqual([]);
      expect(image(closing, dialect), dialect).toEqual([]);
    }
    expect(image(ignored, "github")).toEqual(['<img src="i.png">']);
  });
  it("stops at a region that Obsidian reads otherwise than the parser", () => {
    // A blank-space line continues the HTML block in Reading view, which then
    // reads the code span's `<!--` as a comment.
    const source = '<div>\n \nText `<!--` here\n\n<img src="x.png">\n';
    expect(image(source, "obsidian")).toEqual([]);
    expect(image(source, "github")).toEqual(['<img src="x.png">']);
    // Inline footnotes move to the end of the page.
    const note = 'Text ^[note <img src="x.png">] more.\n';
    expect(image(note, "obsidian")).toEqual([]);
    expect(image(note, "github")).toEqual(['<img src="x.png">']);
  });
  it("checks inline HTML in VitePress and leaves its HTML blocks to Vue", () => {
    const vitepress = (source: string) => image(source, "vitepress");
    expect(vitepress('Text <img src="chart.png"> text.\n')).toEqual(['<img src="chart.png">']);
    expect(vitepress('<img src="chart.png">\n')).toEqual([]);
    // A self-closed component shows nothing of what follows it.
    expect(vitepress('Text <Badge text="new"/> and <img src="x.png"> text.\n')).toEqual([
      '<img src="x.png">',
    ]);
  });
  it.each([
    // Vue's attributes can bind alt, hide or repeat the image.
    'Text <img src="/logo.svg" :alt="title"> text.\n',
    'Text <img src="/logo.svg" v-bind:alt.attr="title"> text.\n',
    'Text <img src="/logo.svg" v-bind="image"> text.\n',
    'Text <img src="/logo.svg" :title="title"> text.\n',
    'Text <img src="/logo.svg" v-if="show"> text.\n',
    // A component or Vue's attributes on an element around it.
    'Text <Badge><img src="x.png"></Badge> text.\n',
    '<div v-if="show">\n\nText <img src="y.png"> text.\n\n</div>\n',
    '<MyCard>\n\nText <img src="y.png"> text.\n\n</MyCard>\n',
    // Tags that only VitePress reads as HTML, and interpolations.
    'Text <img src="x.png" @click="go"> text.\n',
    'Text <span @click="go"></span> and <img src="x.png"> text.\n',
    "Text {{ '<img src=\"x.png\">' }} text.\n",
    'Text <img #default src="x.png"> text.\n',
  ])("leaves VitePress HTML that Vue may read otherwise unreported: %j", (source) => {
    expect(check(source, rule, "vitepress")).toEqual([]);
  });
  it("reads Vue's attributes as plain attributes outside VitePress", () => {
    const source = 'Text <img src="/logo.svg" :alt="title"> text.\n';
    expect(image(source)).toEqual(['<img src="/logo.svg" :alt="title">']);
  });
});

describe("content/html-element", () => {
  const rule = "content/html-element";
  const elements = (
    source: string,
    dialect: Dialect = "github",
    options?: Record<string, unknown>,
  ) => spans(source, check(source, rule, dialect, options));
  it("reports each element once, at its opening tag", () => {
    const source =
      '<div align="center">\n<b>Bold</b><br><hr/>\n</div>\n\nText <span>x</span> and <kbd>K</kbd>.\n';
    for (const dialect of rendering) {
      const findings = check(source, rule, dialect);
      expect(spans(source, findings), dialect).toEqual([
        '<div align="center">',
        "<b>",
        "<br>",
        "<hr/>",
        "<span>",
        "<kbd>",
      ]);
      expect(findings[0]?.message).toBe(
        'Write the HTML element <div> in Markdown, or allow "div" in allowedElements.',
      );
    }
  });
  it("locates elements inside block quotes and list items", () => {
    for (const newline of ["\n", "\r\n"]) {
      const source = ["> <p>", "> <b>x</b>", "> </p>", "", "- Item <sub>2</sub>", ""].join(newline);
      const findings = check(source, rule);
      expect(spans(source, findings)).toEqual(["<p>", "<b>", "<sub>"]);
      expect(findings.map((item) => item.line)).toEqual([1, 2, 5]);
    }
  });
  it.each([
    // Comments, mdrefine's suppression comments included, are not elements.
    "Text <!-- note --> text.\n\n<!--\nblock\n-->\n",
    "<!-- mdrefine-disable-next-line style/wrap -->\nText.\n",
    // Autolinks are links, not HTML.
    "<user@example.com> and <https://example.com>\n",
    "<mailto:user@example.com>\n",
    // Code and escapes are text.
    "`<b>`\n\n```html\n<b>x</b>\n```\n\n    <i>indented</i>\n",
    "\\<b>not bold\\</b>\n",
    // Declarations and processing instructions.
    "<!DOCTYPE html>\n\n<?php echo 1; ?>\n",
    // Text that is not a tag.
    "a < b and 1<2, <3>, < b>\n",
  ])("does not report what is not an element: %j", (source) => {
    for (const dialect of dialects) expect(check(source, rule, dialect), dialect).toEqual([]);
  });
  it("leaves the content of raw-text elements and anything after uncertain HTML unreported", () => {
    expect(elements("<script>\nlet b = '<b>';\n</script>\n")).toEqual(["<script>"]);
    expect(elements("Text <textarea><b>x</b></textarea> <i>y</i>\n")).toEqual([
      "<textarea>",
      "<i>",
    ]);
    expect(elements("<div>\n<!-- start\n</div>\n\n<b>x</b>\n")).toEqual(["<div>"]);
    expect(elements('> <div\n> class="x">\n')).toEqual([]);
  });
  it("finds a raw-text element's end tag in any ASCII letter case, after any text", () => {
    // `İ` lowercases to two code units; searching a lowercased copy would put
    // the end tag past the image that follows it.
    const text = "İ".repeat(10);
    expect(elements(`<script>${text}</sCRipt><img src="a.png">\n`)).toEqual([
      "<script>",
      '<img src="a.png">',
    ]);
    expect(elements(`<style>${text}</STYLE> <b>x</b>\n`)).toEqual(["<style>", "<b>"]);
    // Only ASCII letters match: `ſ` uppercases to `S`, but a browser does not
    // read `</ſcript>` as an end tag.
    expect(elements("<script>a</ſcript><b>x</b>\n")).toEqual(["<script>"]);
  });
  it("follows suppression comments, which it does not report", () => {
    const source =
      "<!-- mdrefine-disable-next-line content/html-element -->\n<b>x</b>\n\n<i>y</i>\n";
    expect(elements(source)).toEqual(["<i>"]);
  });
  it("allows elements by name, compared without letter case", () => {
    const source = "<DIV>\n<Br>\n</DIV>\n\n<span>x</span>\n";
    expect(elements(source, "github", { allowedElements: ["div", "BR"] })).toEqual(["<span>"]);
  });
  it("checks table cells against tableAllowedElements, or allowedElements without it", () => {
    const source = "| a<br>b | <b>c</b> |\n| - | - |\n\n<br>\n";
    expect(elements(source, "github", { allowedElements: ["br"] })).toEqual(["<b>"]);
    const findings = check(source, rule, "github", { tableAllowedElements: ["br"] });
    expect(spans(source, findings)).toEqual(["<b>", "<br>"]);
    expect(findings[0]?.message).toBe(
      'Write the HTML element <b> in Markdown, or allow "b" in tableAllowedElements.',
    );
    expect(findings[1]?.message).toBe(
      'Write the HTML element <br> in Markdown, or allow "br" in allowedElements.',
    );
    // In tables, tableAllowedElements replaces allowedElements.
    expect(
      elements(source, "github", { allowedElements: ["b", "br"], tableAllowedElements: [] }),
    ).toEqual(["<br>", "<b>"]);
    // CommonMark has no tables: the rows are a paragraph.
    expect(elements(source, "commonmark", { tableAllowedElements: ["br", "b"] })).toEqual([
      "<br>",
      "<b>",
      "<br>",
    ]);
  });
  it("reports components and Vue's attributes as VitePress's Markdown reads them", () => {
    const source =
      'Text <Badge type="tip" text="new"/> and <span :title="t">x</span>.\n\n<div>\nblock\n</div>\n';
    expect(elements(source, "vitepress")).toEqual([
      '<Badge type="tip" text="new"/>',
      '<span :title="t">',
    ]);
    expect(elements(source, "vitepress", { allowedElements: ["badge"] })).toEqual([
      '<span :title="t">',
    ]);
    // HTML in an interpolation is Vue's expression, and a tag with `@click` stops the reading.
    expect(elements("Text {{ '<b>' }} and <i>x</i>.\n", "vitepress")).toEqual([]);
    expect(elements('Text <b @click="go">x</b> and <i>y</i>.\n', "vitepress")).toEqual([]);
  });
  it.each([
    { allowedElements: "div" },
    { allowedElements: [""] },
    { tableAllowedElements: [1] },
    { allowed_elements: ["div"] },
  ])("rejects invalid options %j", (options) => {
    expect(() =>
      lint("", { config: { extends: [], rules: { [rule]: ["warn", options] } } }),
    ).toThrow(`Invalid options for ${rule}`);
  });
});
