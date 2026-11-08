import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { navigation } from "../../src/audit/navigation.js";
import { reachableFrom } from "../../src/audit/graph.js";

describe("source navigation", () => {
  it.each([
    "iframe",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
  ])("checks HTML exposed by GitHub filtering of %s", (tag) => {
    const source = (body: string) => `<${tag}>${body}</${tag}>`;
    expect(
      navigation(parse(source('<a href="guide.md">Go</a>'), "github")).limits.length,
    ).toBeGreaterThan(0);
    expect(
      navigation(parse(source('<a href="https://example.com">Web</a>'), "github")).limits,
    ).toEqual([]);
    expect(navigation(parse(source("Plain text"), "github")).limits).toEqual([]);
  });
  it.each([
    ["vitepress", '<a @click="go" href="guide.md">Go</a>'],
    ["vitepress", "<navigation />"],
    ["github", '> <a\n> href="guide.md">Go</a>'],
    ["github", 'See[^a].\n\n[^a]: See[^b].\n[^b]: <a href="guide.md">Go</a>'],
    ["obsidian", 'See^[note]. <a href="guide.md">Go</a>'],
  ] as const)(
    "records HTML coverage independently of display mapping for %s: %s",
    (dialect, source) => {
      expect(navigation(parse(source, dialect)).limits.length).toBeGreaterThan(0);
    },
  );
  it.each(["github", "obsidian", "vitepress"] as const)(
    "keeps opaque/code/comment/external-only HTML controls out of %s findings",
    (dialect) => {
      const source =
        '`<a @click="go" href="guide.md">`\n\n```html\n<navigation />\n<a href="guide.md">Go</a>\n```\n\n<!-- <a href="guide.md"> [Note](guide.md) -->\n\n<div><!-- [Comment](guide.md) --></div>\n\n<a href=" https://example.com?tags[]=one ">Web</a>\n\n[^unused]: <a href="guide.md">Go</a>\n';
      expect(navigation(parse(source, dialect)).limits).toEqual([]);
    },
  );
  it.each([
    "<pre>Plain code</pre>",
    "<style>.note { color: red; }</style>",
    '<area href="https://example.com">',
    "<nav>Navigation</nav>",
  ])("recognizes native VitePress HTML in %s", (source) => {
    expect(navigation(parse(source, "vitepress")).limits).toEqual([]);
  });
  it.each(["commonmark", "github", "obsidian"] as const)(
    "keeps VitePress include comments opaque in %s",
    (dialect) => {
      expect(navigation(parse("<!-- @include: guide.md -->", dialect)).limits).toEqual([]);
    },
  );
  it.each(['target="_blank"', "download"])(
    "does not normalize VitePress navigation with %s",
    (attribute) => {
      const source = `[Guide](guide){${attribute}}\n`;
      const result = navigation(parse(source, "vitepress"));
      expect(result).toMatchObject({
        links: [],
      });
      expect(result.limits).toHaveLength(1);
      expect(result.limits[0]!.message).toContain("bypass");
      expect(
        navigation(parse(source, "vitepress", "document.md", [], { attrs: false })),
      ).toMatchObject({ links: [{ destination: "guide" }], limits: [] });
      expect(
        navigation(parse(`[Web](https://example.com){${attribute}}\n`, "vitepress")).limits,
      ).toEqual([]);
    },
  );
  it("uses the first definition only when an actual link references it", () => {
    const source =
      "[Go][A]\n\n[A]: used.md\n[a]: duplicate.md\n[unused]: unused.md\n\n![Image][picture]\n\n[picture]: image.md\n";
    expect(navigation(parse(source, "github")).links.map((link) => link.destination)).toEqual([
      "used.md",
    ]);
  });
  it("does not count code, images, comments, or unused footnote definitions", () => {
    const source =
      "`[Code](code.md)`\n\n```md\n[Code](fence.md)\n```\n\n![Image](image.md)\n\n<!-- [Comment](comment.md) -->\n\n[^unused]: [Hidden](hidden.md)\n\nVisible[^one].\n\n[^one]: [Go](visible.md) and [^two].\n[^two]: [Next](next.md) and [^one].\n";
    const result = navigation(parse(source, "github"));
    expect(result.links.map((link) => link.destination).sort()).toEqual(["next.md", "visible.md"]);
    expect(result.limits).toEqual([]);
  });
  it("keeps wiki display labels separate and includes Markdown embeds", () => {
    const result = navigation(
      parse("[[Topic|Display label]]\n\n![[Embed#Heading]]\n\n%% [[Hidden]] %%\n", "obsidian"),
    );
    expect(result.links).toMatchObject([
      { destination: "Topic", wiki: true },
      { destination: "Embed#Heading", wiki: true },
    ]);
  });
  it.each([
    ["github", '<a href="guide.md">Guide</a>'],
    ["vitepress", '<a :href="page">Guide</a>'],
    ["vitepress", "<PageNavigation />"],
    ["vitepress", "<!-- @include: ./guide.md -->"],
    ["obsidian", "==[Guide](guide.md)=="],
  ] as const)("records a coverage limit for %s navigation in %s", (dialect, source) => {
    expect(navigation(parse(source, dialect)).limits.length).toBeGreaterThan(0);
  });
  it("does not turn external HTML links, anchors, code examples or comments into limits", () => {
    const source =
      '<a href="https://example.com">Web</a>\n\n<a href="#here">Here</a>\n\n<span id="here">Text</span>\n\n`<a href="local.md">`\n\n<!-- <a href="local.md"> -->\n';
    expect(navigation(parse(source, "github")).limits).toEqual([]);
  });
  it("locates HTML limits with CRLF and UTF-16 columns", () => {
    expect(
      navigation(parse('Text.\r\n\r\n😀 <a href="guide.md">Go</a>', "github")).limits,
    ).toMatchObject([{ line: 3, column: 4 }]);
  });
});

describe("directed reachability", () => {
  it("does not mistake incoming links within a disconnected cycle for reachability", () => {
    const graph = new Map([
      ["home", ["guide"]],
      ["guide", []],
      ["old", ["appendix"]],
      ["appendix", ["old"]],
    ]);
    expect([...reachableFrom(["home"], graph)]).toEqual(["home", "guide"]);
    expect(reachableFrom(["home", "old"], graph).size).toBe(4);
  });
  it("handles long chains without recursive stack growth", () => {
    const count = 30_000;
    const graph = new Map(
      Array.from({ length: count }, (_, index) => [
        String(index),
        index + 1 === count ? [] : [String(index + 1)],
      ]),
    );
    expect(reachableFrom(["0"], graph).size).toBe(count);
  });
});
