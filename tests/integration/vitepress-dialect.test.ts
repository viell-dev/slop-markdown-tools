import path from "node:path";
import { createRequire } from "node:module";
import { createMarkdownRenderer, disposeMdItInstance } from "vitepress";
import { afterEach, expect, it } from "vitest";
import { format, parse, semanticFingerprint, resolveConfig } from "../../src/index.js";
import type { Config, Plugin, VitePressOptions } from "../../src/index.js";
import { fixture } from "./support.js";

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
  "---yaml\ntitle: Hello\n---- closed\n\nA *small* note.\n",
  "---\ntitle: Hello\n",
  "A *small* note.\n<MyComponent />\n",
  "- [X] A *small* task.\n",
  "## A *small* heading {#custom}\n",
  '~~~js title="demo"\nconst x=1\n~~~\n',
  "A plain long paragraph with *emphasis* and normal content that should be wrapped into several short lines without affecting rendering at all.\n",
  ":::: details Outer\n::: tip Inner\nA *small* note.\n:::\n::::\n",
  "- ::: tip Nested\n  A *small* note.\n  :::\n",
  "> ::: tip Quoted\n> A *small* note.\n> :::\n",
  "- a {.red}\n- b\n{.compact}\n",
  "Image ![wide](./a.png){width=200 height=100} and text.\n",
];

async function renderer(options: VitePressOptions) {
  const root = await fixture({ "a.png": "synthetic" });
  const md = await createMarkdownRenderer(root, {
    cache: false,
    math: options.math === true,
    attrs: options.attrs !== false,
    footnote: options.footnote !== false,
    tasklist: options.tasklist !== false,
    cjkFriendlyEmphasis: options.cjkFriendlyEmphasis !== false,
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
