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

it.each([false, true])(
  "preserves actual VitePress/Vue output with sentence wrapping and math=%s",
  async (math) => {
    const render = await renderer({ math });
    const config: Config = {
      extends: [],
      dialect: "vitepress",
      vitepress: { math },
      rules: { "style/wrap": ["warn", { mode: "sentences", width: 40 }] },
    };
    const sources = [
      "First **sentence.** Second sentence.\n",
      "Read [the guide.](https://example.com) Next sentence.\n",
      "- First sentence. Second sentence in a list.\n\n> First sentence. Second sentence in a quote.\n",
      "Use `First. Second.` carefully. Next sentence.\n",
      "Use `one` `two`. Next sentence.\n",
      "Math $x.y$ stays here. Next sentence.\n",
      "First sentence&#46; Next sentence.\n",
    ];
    for (const source of sources) {
      const result = format(source, { config });
      expect(
        result.diagnostics.filter((item) => item.rule.startsWith("engine/")),
        source,
      ).toEqual([]);
      expect(await render(result.output), source).toBe(await render(source));
      expect(format(result.output, { config }).output, source).toBe(result.output);
    }
    expect(format(sources[0]!, { config }).output).toBe("First **sentence.**\nSecond sentence.\n");
  },
);

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

it("preserves footnote lists while applying startIndented (#802)", async () => {
  const render = await renderer({});
  const config: Config = {
    extends: [],
    dialect: "vitepress",
    rules: { "style/list-indent": ["warn", { startIndented: true }] },
  };
  for (const [source, output] of [
    ["Note[^1].\n\n[^1]: - item\n", "Note[^1].\n\n[^1]: - item\n"],
    [
      "Note[^1].\n\n[^1]: -   first\n        continuation\n    -   second\n",
      "Note[^1].\n\n[^1]: - first\n      continuation\n    - second\n",
    ],
  ] as const) {
    const result = format(source, { config });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toBe(output);
    expect(await render(result.output)).toBe(await render(source));
    expect(format(result.output, { config }).output).toBe(result.output);
  }
});

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

it("keeps code-span continuation indentation while formatting other paragraphs (#782)", async () => {
  const render = await renderer({});
  const original =
    "grove ~*_~b_~b *b.x* _~ `a _ quarry\n   `yonder  cedar` *grove iris* __anchor__ `juniper  birch` fern kettle `delta pebble`\n";
  for (const eol of ["\n", "\r\n", "\r"]) {
    const source = (original + "\nLater *ordinary* words with `one\ntwo` here.\n").replaceAll(
      "\n",
      eol,
    );
    const config: Config = { extends: ["recommended", "vitepress"], dialect: "vitepress" };
    const result = format(source, { config, path: "page.md" });
    expect(result.diagnostics).toEqual([]);
    expect(result.output.startsWith(original.replaceAll("\n", eol))).toBe(true);
    expect(result.output).toContain("Later _ordinary_ words with `one two` here.");
    expect(await render(result.output)).toBe(await render(source));
    expect(semanticFingerprint(parse(result.output, "vitepress"))).toBe(
      semanticFingerprint(parse(source, "vitepress")),
    );
    expect(format(result.output, { config }).output).toBe(result.output);
  }
});

it("wraps plugin paragraphs without treating them as document front matter (#869)", async () => {
  const render = await renderer({});
  const plugin: Plugin = { name: "empty-syntax", syntax: { micromark: {}, mdast: {} } };
  const config: Config = {
    extends: [],
    dialect: "vitepress",
    rules: { "style/wrap": ["warn", { width: 48 }] },
  };
  const paragraph =
    "--- gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma";
  for (const prefix of ["", "> ", "- ", "- > "])
    for (const before of ["Intro.\n\n", "---\ntitle: Entry\n---\n\n"]) {
      const source = before + prefix + paragraph + "\n";
      const options = { config, plugins: [plugin] };
      const result = format(source, options);
      expect(result.output, before + prefix).not.toBe(source);
      expect(result.output).toBe(format(source, { config }).output);
      expect(result.diagnostics).toEqual([]);
      expect(await render(result.output)).toBe(await render(source));
      expect(semanticFingerprint(parse(result.output, "vitepress", "document.md", [plugin]))).toBe(
        semanticFingerprint(parse(source, "vitepress", "document.md", [plugin])),
      );
      expect(format(result.output, options).output).toBe(result.output);
    }
});

it("wraps body entities with equal actual VitePress/Vue output (#863)", async () => {
  const render = await renderer({});
  const source =
    "- saddle needle __ember__ *zephyr amber* candle anchor basket \n" +
    "  * engine fern walnut [kettle signal](page.md) lantern ribbon\n" +
    "    __lantern__ &copy;\n";
  const config: Config = { extends: ["recommended", "vitepress"], dialect: "vitepress" };
  const result = format(source, { config });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toContain("**lantern**\n    &copy;");
  expect(await render(result.output)).toBe(await render(source));
  expect(format(result.output, { config }).output).toBe(result.output);
  for (const entity of [
    "&copy;",
    "&amp;",
    "\\&",
    "&#169;",
    "&#xA9;",
    "&#xD800;",
    "&#0;",
    "&NotEqualTilde;",
    "&#9;",
    "&#10;",
    "&#12;",
    "&#13;",
    "&#32;",
    "&#x20;",
    "&Tab;",
    "&NewLine;",
  ]) {
    const before = `**x** ${entity}\nTail\n`;
    const after = `**x**\n${entity}\nTail\n`;
    expect(await render(after), entity).toBe(await render(before));
    expect(semanticFingerprint(parse(after, "vitepress")), entity).toBe(
      semanticFingerprint(parse(before, "vitepress")),
    );
  }
  for (const [before, after] of [
    ["`a`\\\n&NewLine;`b`\n", "`a`\\\n&#32;`b`\n"],
    ["**a**  \n&NewLine;**b**\n", "**a**  \n&#32;**b**\n"],
  ]) {
    expect(await render(after!)).toBe(await render(before!));
    expect(semanticFingerprint(parse(after!, "vitepress"))).toBe(
      semanticFingerprint(parse(before!, "vitepress")),
    );
  }
});

it.each([false, true])(
  "wraps whitespace entities with equal actual Vue output and math=%s (#905)",
  async (math) => {
    const render = await renderer({ math });
    const sources = [
      "B%%\n&#32;\n",
      'x [a.](u "t. U") &#32; ',
      '> [a.](u "t. U") &#32;\n',
      "Read [the guide](guide.md). &#32; Follow the next step carefully.\n",
      "B%%\n&#32;\n\nThis is an ordinary paragraph that should wrap at twenty columns.\n",
    ];
    for (const source of sources)
      for (const mode of ["always", "sentences"])
        for (const eol of source.includes("\n") ? ["\n", "\r\n", "\r"] : ["\n"]) {
          const input = source.replaceAll("\n", eol);
          const config: Config = {
            extends: [],
            dialect: "vitepress",
            vitepress: { math },
            rules: { "style/wrap": ["warn", { mode, width: 20 }] },
          };
          const result = format(input, { config });
          expect(result.diagnostics, input).toEqual([]);
          expect(result.output, input).not.toBe(input);
          expect(await render(result.output), input).toBe(await render(input));
          expect(semanticFingerprint(parse(result.output, "vitepress"))).toBe(
            semanticFingerprint(parse(input, "vitepress")),
          );
          expect(format(result.output, { config }).output).toBe(result.output);
        }
  },
);

it("still rejects entity changes with unequal actual VitePress/Vue output (#863)", async () => {
  const render = await renderer({});
  const pairs = [
    ...["&#x80;", "&#xFFFF;", "&#xFDD0;", "&#1;"].map((entity) => [
      `**x** ${entity}\nTail\n`,
      `**x**\n${entity}\nTail\n`,
    ]),
    ["**x** &copy;\nTail\n====\n", "**x**\n&copy;\nTail\n====\n"],
    ["![x &copy; tail](a.png)\n", "![x\n&copy; tail](a.png)\n"],
    ["&#123;&#123; 1 + 2 &#125;&#125;\n", "{{ 1 + 2 }}\n"],
    ["`a`&NewLine;`b`\n", "`a` `b`\n"],
    ["Before &amp;copy; after.\n", "Before &copy; after.\n"],
    ["Before \\&copy; after.\n", "Before &copy; after.\n"],
    ["Before \\&#32; after.\n", "Before &#32; after.\n"],
    ["Before &amp;#32; after.\n", "Before &#32; after.\n"],
    ["Before &#38;#32; after.\n", "Before &#32; after.\n"],
    ["Before &amp;NewLine; after.\n", "Before &NewLine; after.\n"],
    ["`a` &NewLine; `b`\n", "`a` `b`\n"],
    ["**a** &#13; **b**\n", "**a** **b**\n"],
    ["**a**&#13;![b](a.png)\n", "**a**&#32;![b](a.png)\n"],
    ["**a**&NewLine;**b**\n", "**a** **b**\n"],
    ...["", " "].flatMap((prefix) =>
      ["\\\n", "  \n"].map((hardbreak) => [
        `**a**${prefix}&NewLine;${hardbreak}**b**\n`,
        `**a**${prefix}&#32;${hardbreak}**b**\n`,
      ]),
    ),
  ];
  for (const [before, after] of pairs) {
    expect(await render(after!), before).not.toBe(await render(before!));
    expect(semanticFingerprint(parse(after!, "vitepress")), before).not.toBe(
      semanticFingerprint(parse(before!, "vitepress")),
    );
    const plugin: Plugin = {
      name: "unsafe",
      rules: {
        replace: {
          description: "Propose a rendered entity change",
          kind: "style",
          check: () => [
            { start: 0, message: "Replace", edit: { start: 0, end: before!.length, text: after! } },
          ],
        },
      },
    };
    const result = format(before!, {
      plugins: [plugin],
      config: { extends: [], dialect: "vitepress", rules: { "unsafe/replace": "warn" } },
    });
    expect(result.output, before).toBe(before);
    expect(result.diagnostics, before).toContainEqual(
      expect.objectContaining({ rule: "engine/unsafe-format" }),
    );
  }
});

it("keeps table text grouped with a component without refused spacing (#800)", async () => {
  const render = await renderer({});
  const original = "- item\n  |a|b|\n  |-|-|\n|a|b|\n|-|-|\n<MyComponent />\n";
  for (const eol of ["\n", "\r\n", "\r"]) {
    const source = original.replaceAll("\n", eol);
    const config: Config = { extends: ["recommended", "vitepress"], dialect: "vitepress" };
    const result = format(source, { config, path: "page.md" });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toBe(
      "- item\n  | a   | b   |\n  | --- | --- |\n|a|b|\n|-|-|\n<MyComponent />\n".replaceAll(
        "\n",
        eol,
      ),
    );
    expect(await render(result.output)).toBe(await render(source));
    expect(semanticFingerprint(parse(result.output, "vitepress"))).toBe(
      semanticFingerprint(parse(source, "vitepress")),
    );
    expect(format(result.output, { config }).output).toBe(result.output);
    // The separator preserves real rendering but changes the opaque primary
    // representation. Keep the engine's preservation check intact.
    const separated = source.replace(`  |-|-|${eol}`, `  |-|-|${eol}${eol}`);
    expect(await render(separated)).toBe(await render(source));
    expect(semanticFingerprint(parse(separated, "vitepress"))).not.toBe(
      semanticFingerprint(parse(source, "vitepress")),
    );
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

it("keeps unselected fences exact beside body entity and approved code fixes (#905)", async () => {
  const { root, config } = await setup();
  const source = "B%%\n&#32;\n\n" + block() + "\n" + block("kept", "txt");
  const configured: Config = {
    ...config(),
    dialect: "vitepress",
    extends: ["recommended", "vitepress"],
  };
  const result = await formatWithCode(source, { cwd: root, config: configured });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(source.replace("B%%\n&#32;", "B%% &#32;").replace("old", "formatted"));
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

it("keeps marker pairs across component block boundaries (#768)", async () => {
  const render = await renderer({});
  for (const [prefix, continuation] of [
    ["", ""],
    ["- ", "  "],
    ["- ", ""],
    ["> ", "> "],
    ["> ", ""],
  ]) {
    for (const marker of ["*", "__"]) {
      const source = `${prefix}Alpha ${marker}words\n${continuation}<custom-tag/>\n${continuation}more${marker} words after\n`;
      const config: Config = {
        extends: [],
        dialect: "vitepress",
        rules: { "style/emphasis": "warn", "style/strong": "warn" },
      };
      const result = format(source, { config });
      expect(result.diagnostics).toEqual([]);
      expect(await render(result.output)).toBe(await render(source));
      expect(format(result.output, { config }).output).toBe(result.output);
    }
  }
});
