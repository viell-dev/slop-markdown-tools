import path from "node:path";
import { createRequire } from "node:module";
import { createMarkdownRenderer, disposeMdItInstance } from "vitepress";
import { afterEach, expect, it } from "vitest";
import { format, parse, semanticFingerprint, resolveConfig } from "../../src/index.js";
import type { Config, Plugin, VitePressOptions } from "../../src/index.js";
import { fixture } from "../support/cli.js";
import { createWorkspace } from "../../src/index.js";
import { formatWithCode } from "../../src/node.js";
import { block, setup } from "../support/code-format.js";
import { slug } from "github-slugger";

const require = createRequire(import.meta.resolve("vitepress"));
const { createSSRApp } = require("vue") as typeof import("vue");
const { renderToString } = require("vue/server-renderer") as typeof import("vue/server-renderer");
afterEach(() => disposeMdItInstance());

const fixtures = [
  'Read the notes [installation guide](./install.md){target="_blank" rel="noopener"} in a new tab.\n',
  "[a](#x)\n[b](#y)\n",
  "::: tip\n*open\n:::\nclose*\n",
  "::: tip\nThis is a *long paragraph* with ordinary content that should still be formatted and wrapped as usual without changing the rendered page.\n:::\n",
  "* one\n* two\n{.compact}\n",
  "The solutions are\n$$ x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a} $$\n",
  "Value a$x *y* z$b here.\n",
  "これは**テスト。**です。\n",
  "Footnote^[A *small* note, with **strong** text].\n",
  "> [!tip] Custom title\n> A *small* note.\n",
  "> [!tip]\n> A *small* note.\n",
  " -\n  -   - text\n    - text\n\n      text\n\ntext\n",
  "---yaml\ntitle: Hello\n---- closed\n\nA *small* note.\n",
  "---\ntitle: Hello\n",
  "A *small* note.\n<MyComponent />\n",
  "- [X] A *small* task.\n",
  "## A *small* heading {#custom}\n",
  '~~~js title="demo"\nconst x=1\n~~~\n',
  "~~~js{1,3} [Example]\nconst x=1\n~~~\n",
  "~~~ts:line-numbers=2 {1}\nconst x=1\n~~~\n",
  "A plain long paragraph with *emphasis* and normal content that should be wrapped into several short lines without affecting rendering at all.\n",
  ":::: details Outer\n::: tip Inner\nA *small* note.\n:::\n::::\n",
  "- ::: tip Nested\n  A *small* note.\n  :::\n",
  "> ::: tip Quoted\n> A *small* note.\n> :::\n",
  "- a {.red}\n- b\n{.compact}\n",
  "Image ![wide](./a.png){width=200 height=100} and text.\n",
];

it.each([false, true])(
  "wraps paragraphs whose braces and `^[` are code with math=%s (#755)",
  async (math) => {
    const render = await renderer({ math });
    const config = configured({ math });
    for (const source of [
      'Enable [`style/block-spacing`](rules.md#styleblock-spacing) with `"rules": { "style/block-spacing": "warn" }` to separate blocks.\n',
      "- [ ] A task with `{ a }` in its words that goes on past the width.\n",
      "Some words with `^[x]` in code that go on past the width here.\n",
    ]) {
      const result = format(source, { config, path: "page.md" });
      expect(result.diagnostics, source).toEqual([]);
      expect(result.output, source).not.toBe(source);
      expect(await render(result.output), source).toBe(await render(source));
      expect(format(result.output, { config }).output, source).toBe(result.output);
    }
  },
);

it("reads the blocks that style/block-spacing keeps together as VitePress does (#748)", async () => {
  const render = await renderer({});
  const config: Config = {
    extends: [],
    dialect: "vitepress",
    rules: { "style/block-spacing": "warn" },
  };
  for (const [source, line] of [
    ["- a | b\n  --|--\n  ```\n- * A\n> : Description\n", 4],
    ["text\n\n- a\n<b>\nmore\n", 4],
    ["- > a\n[^b]: note\n", 1],
  ] as const) {
    const result = format(source, { config, path: "page.md" });
    expect(result.diagnostics, source).toEqual([]);
    expect(result.output, source).toBe(source);
    // The separator that the parser's reading alone would call for changes
    // what VitePress shows.
    const lines = source.split("\n");
    lines.splice(line, 0, "");
    expect(await render(lines.join("\n")), source).not.toBe(await render(source));
  }
});

it("leaves the lists and lazy lines that VitePress reads otherwise as written (#763, #769)", async () => {
  const render = await renderer({});
  const config: Config = { extends: ["recommended", "vitepress"], dialect: "vitepress" };
  // Each source, with the edit that a rule would make there by mdast's reading.
  for (const [source, edited] of [
    // A table whose first cell holds the marker, not a list.
    ["* a | b\n  --|--\n", "- a | b\n  --|--\n"],
    ["+ a | b\n  --|--\n+ c\n", "- a | b\n  --|--\n- c\n"],
    ["- outer\n  * a | b\n    --|--\n", "- outer\n  - a   | b   |\n    --- | --- |\n"],
    // Another marker joins the lists, and the table moves into the item.
    ["+ x\n- a | b\n  --|--\n", "- x\n- a | b\n  --|--\n"],
    // Less indentation makes the item's table a table outside the list.
    ["*   a | b\n    :-|-:\n    c | d\n", "* a | b\n  :-|-:\n  c | d\n"],
    // The component ends the item's paragraph; an indented line continues the item.
    [
      "- Alpha words\n    <MyComponent />\nmore words after\n",
      "- Alpha words\n    <MyComponent />\n  more words after\n",
    ],
    [
      "- Alpha words\n\t<MyComponent />\nmore words after\n",
      "- Alpha words\n\t<MyComponent />\n  more words after\n",
    ],
  ] as const) {
    const result = format(source, { config, path: "page.md" });
    expect(
      result.diagnostics.filter((item) => item.rule.startsWith("engine/")),
      source,
    ).toEqual([]);
    expect(await render(result.output), source).toBe(await render(source));
    expect(format(result.output, { config }).output, source).toBe(result.output);
    expect(await render(edited), source).not.toBe(await render(source));
  }
  // Ordinary lists, tables and lazy lines are still formatted.
  for (const [source, output] of [
    ["* one\n* two\n", "- one\n- two\n"],
    ["- x\n\n  a | b\n  --|--\n", "- x\n\n  | a   | b   |\n  | --- | --- |\n"],
    ["- Alpha\n  <span>x</span>\nlazy\n", "- Alpha\n  <span>x</span>\n  lazy\n"],
  ] as const) {
    const result = format(source, {
      config: { ...config, rules: { "style/wrap": "off" } },
      path: "page.md",
    });
    expect(result.output, source).toBe(output);
    expect(await render(result.output), source).toBe(await render(source));
  }
});

it("preserves actual VitePress heading IDs when bracketing literal addresses", async () => {
  const render = await renderer({});
  const config: Config = {
    extends: [],
    dialect: "vitepress",
    rules: { "links/bare-url": "warn" },
  };
  for (const source of ["# https://e.com\n", "https://e.com\n===\n", "# *https://e.com*\n"]) {
    const result = format(source, { config });
    expect(result.output).toBe(source.replace("https://e.com", "<https://e.com>"));
    expect(await render(result.output)).toBe(await render(source));
    expect(format(result.output, { config }).output).toBe(result.output);
  }
});

async function renderer(options: VitePressOptions) {
  const root = await fixture({ "a.png": "synthetic" });
  const md = await createMarkdownRenderer(root, {
    cache: false,
    math: options.math === true,
    attrs: options.attrs !== false,
    footnote: options.footnote !== false,
    tasklist: options.tasklist !== false,
    cjkFriendlyEmphasis: options.cjkFriendlyEmphasis !== false,
    anchor: options.anchor === "github" ? { slugify: slug } : {},
    container: {
      customContainers: Object.fromEntries(
        (options.customContainers ?? []).map((name) => [name, name]),
      ),
    },
  });
  return async (source: string) => {
    const html = await md.renderAsync(source, {
      path: path.join(root, "page.md"),
      realPath: path.join(root, "page.md"),
      relativePath: "page.md",
      includes: [],
    });
    return renderToString(
      createSSRApp({
        components: { MyComponent: { template: "<span>component</span>" } },
        template: `<div>${html}</div>`,
      }),
    );
  };
}
const configured = (vitepress: VitePressOptions): Config => ({
  extends: ["recommended", "vitepress"],
  vitepress,
  rules: { "style/wrap": ["warn", { width: 40 }] },
});

it.each([false, true])("matches actual heading IDs with math=%s", async (math) => {
  const source =
    [
      "## 1. Introduction",
      "## Café au lait",
      "## test.0.1",
      "## A &amp; B",
      "## Hello :tada: there",
      "## Image ![Alt text](./a.png) end",
      "## Math $x^2$ end",
      "## Ref[^1] end",
      "## Tag <span>inner</span> end",
      "## Version {{ 1 + 1 }}",
      "## Getting Started {#start}",
      "## Same",
      "## Same",
      "[^1]: note",
    ].join("\n\n") + "\n";
  const render = await renderer({ math });
  const html = await render(source);
  const ids = [...html.matchAll(/<h[1-6]\b[^>]*\bid="([^"]*)"/g)].map((match) => match[1]!);
  expect(ids).toHaveLength(13);
  const workspace = createWorkspace(
    { "page.md": source },
    { dialect: "vitepress", vitepress: { math } },
  );
  for (const id of ids)
    expect(workspace.resolve("page.md", "#" + id, "vitepress"), id).toMatchObject({
      status: "resolved",
      fragmentExists: true,
    });
  expect(workspace.resolve("page.md", "#nonexistent", "vitepress")).toMatchObject({
    fragmentExists: false,
  });
});

it("matches actual heading IDs when the site chooses github-slugger", async () => {
  const source = "## Café au lait\n\n## Café au lait\n\n## A &amp; B\n";
  const render = await renderer({ anchor: "github" });
  const ids = [...(await render(source)).matchAll(/<h[1-6]\b[^>]*\bid="([^"]*)"/g)].map(
    (match) => match[1]!,
  );
  const workspace = createWorkspace(
    { "page.md": source },
    { dialect: "vitepress", vitepress: { anchor: "github" } },
  );
  expect(ids).toHaveLength(3);
  for (const id of ids)
    expect(workspace.resolve("page.md", "#" + id, "vitepress"), id).toMatchObject({
      fragmentExists: true,
    });
});

it("leaves metadata-interpolated headings unchecked unless they have static IDs", async () => {
  const source = "---\ntitle: Café\n---\n\n## {{ $frontmatter.title }}\n";
  const render = await renderer({});
  expect(await render(source)).toContain('id="cafe"');
  const workspace = createWorkspace({ "page.md": source }, { dialect: "vitepress" });
  expect(workspace.resolve("page.md", "#cafe", "vitepress")).toMatchObject({
    status: "unreadable",
  });
  const explicit = source.replace("title }}", "title }} {#fixed}");
  const staticWorkspace = createWorkspace({ "page.md": explicit }, { dialect: "vitepress" });
  expect(staticWorkspace.resolve("page.md", "#fixed", "vitepress")).toMatchObject({
    fragmentExists: true,
  });
});

it("keeps approved embedded-code formatting available in the second reading", async () => {
  const { root, config } = await setup();
  const source = "::: tip Example\n\n" + block() + "\n:::\n";
  const configured: Config = {
    ...config(),
    dialect: "vitepress",
    extends: ["recommended", "vitepress"],
  };
  const result = await formatWithCode(source, { cwd: root, config: configured });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(source.replace("old", "formatted"));
  expect((await formatWithCode(result.output, { cwd: root, config: configured })).output).toBe(
    result.output,
  );
});

it("routes decorated VitePress fences by their written language alias", async () => {
  const { root, config } = await setup();
  for (const info of ["js{1,3} [Example]", "js:line-numbers=2 {1}"]) {
    const source = block("old", info);
    const configured: Config = {
      ...config(),
      dialect: "vitepress",
      extends: ["recommended", "vitepress"],
    };
    const result = await formatWithCode(source, { cwd: root, config: configured });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toBe(source.replace("old", "formatted"));
  }
  expect(parse(block("old", "js-vue{1}"), "vitepress").tree.children[0]).toMatchObject({
    type: "code",
    lang: "js-vue",
    meta: "{1}",
  });
});

it.each([false, true])("preserves actual VitePress/Vue rendering with math=%s", async (math) => {
  const render = await renderer({ math });
  const config = configured({ math });
  for (const source of fixtures) {
    const result = format(source, { config, path: "page.md" });
    expect(
      result.diagnostics.filter((item) => item.rule.startsWith("engine/")),
      source,
    ).toEqual([]);
    expect(await render(result.output), source).toBe(await render(source));
    expect(format(result.output, { config }).output, source).toBe(result.output);
  }
});

it("models disabled syntax options explicitly, without changing other dialects", async () => {
  const options = { attrs: false, footnote: false, tasklist: false, cjkFriendlyEmphasis: false };
  const render = await renderer(options);
  for (const source of fixtures.filter((text) => !text.includes("<MyComponent"))) {
    const result = format(source, { config: configured(options) });
    expect(
      result.diagnostics.filter((item) => item.rule.startsWith("engine/")),
      source,
    ).toEqual([]);
    expect(await render(result.output), source).toBe(await render(source));
  }
  expect(
    resolveConfig({
      config: {
        extends: ["vitepress"],
        overrides: [{ files: ["plain/**"], vitepress: { math: true } }],
      },
      path: "plain/page.md",
    }).vitepress.math,
  ).toBe(true);
  expect(parse("~text~", "vitepress").tree.children[0]).toMatchObject({
    children: [{ type: "text", value: "~text~" }],
  });
});

it("compares Vue whitespace, attributes, and container boundaries in its guard", () => {
  const pairs = [
    ["[a](#x)\n[b](#y)\n", "[a](#x) [b](#y)\n"],
    [
      '[a](./a.md){target="_blank" rel="noopener"}\n',
      '[a](./a.md){target="_blank"\nrel="noopener"}\n',
    ],
    ["::: tip\n*open\n:::\nclose*\n", "::: tip\n_open\n:::\nclose_\n"],
  ];
  for (const [before, after] of pairs)
    expect(semanticFingerprint(parse(before!, "vitepress"))).not.toBe(
      semanticFingerprint(parse(after!, "vitepress")),
    );
  const plugin: Plugin = {
    name: "unsafe",
    rules: {
      join: {
        description: "Propose a join whose mdast reading is unchanged",
        kind: "style",
        check({ document }) {
          const at = document.source.indexOf("\n");
          return [{ start: at, message: "Join", edit: { start: at, end: at + 1, text: " " } }];
        },
      },
    },
  };
  const source = "[a](#x)\n[b](#y)\n";
  const result = format(source, {
    plugins: [plugin],
    config: { extends: ["vitepress"], rules: { "unsafe/join": "warn" } },
  });
  expect(result.output).toBe(source);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ rule: "engine/unsafe-format" }),
  );
});

it.each(["keep", "backslash"] as const)(
  "keeps actual VitePress mixed-whitespace hard breaks with %s (#562)",
  async (hardBreak) => {
    const render = await renderer({});
    const config: Config = {
      extends: [],
      dialect: "vitepress",
      rules: { "style/trailing-space": ["warn", { hardBreak }] },
    };
    for (const [source, output] of [
      ["a\t  \nb\n", "a\t  \nb\n"],
      ["a\\\\\t  \nb\n", "a\\\\\t  \nb\n"],
      ["> - a\t  \n>   b \n", "> - a\t  \n>   b\n"],
      ["a\t  \nb\n===\n", "a\t  \nb\n===\n"],
      ["a\t \nb\n", "a\nb\n"],
      ["a\t  \n", "a\n"],
    ]) {
      const result = format(source!, { config, path: "page.md" });
      expect(
        result.diagnostics.filter(({ rule }) => rule.startsWith("engine/")),
        source,
      ).toEqual([]);
      expect(result.output, source).toBe(output);
      expect(format(result.output, { config }).output, source).toBe(output);
      expect(await render(result.output), source).toBe(await render(source!));
    }
    // The two-space suffix requires a real native break, not source-text equality.
    expect(await render("a\t  \nb\n")).not.toBe(await render("a\nb\n"));
  },
);
