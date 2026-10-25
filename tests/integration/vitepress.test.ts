import path from "node:path";
import { createRequire } from "node:module";
import { createMarkdownRenderer } from "vitepress";
import { expect, it } from "vitest";
import { format } from "../../src/index.js";
import { fixture } from "../support/cli.js";

// Compare the Vue-compiled page, including its whitespace handling, with the Vue
// version belonging to VitePress rather than a separately selected renderer.
const require = createRequire(import.meta.resolve("vitepress"));
const { createSSRApp } = require("vue") as typeof import("vue");
const { renderToString } = require("vue/server-renderer") as typeof import("vue/server-renderer");

it("preserves VitePress containers, snippet imports, and literal table-of-contents markers", async () => {
  const root = await fixture({ "a.js": "const a = 1;\n", "b.js": "const b = 2;\n" });
  const renderer = await createMarkdownRenderer(root, { cache: false });
  const documents = [
    "::: details Table\n| a | b |\n|---|---|\n| 1 | 2 |\n:::\n",
    "::: details Table\n| a | b |\n|---|---|\n| 1 | 2 |\n:::: \t\n",
    "<<< ./a.js\n<<< ./b.js\n",
    "<<<./b.js{1 js:line-numbers} [a title that is long enough to pass eighty columns when the snippet is included]\n",
    ...["[[toc]]", "[[TOC]]", "[[ToC]]"].map(
      (marker) => `${"word ".repeat(15)}${marker} and more words follow here.\n`,
    ),
  ];
  for (const source of documents) {
    const render = async (text: string) => {
      const html = await renderer.renderAsync(text, {
        path: path.join(root, "page.md"),
        realPath: path.join(root, "page.md"),
        relativePath: "page.md",
        includes: [],
      });
      return renderToString(createSSRApp({ template: `<div>${html}</div>` }));
    };
    const before = await render(source);
    const result = format(source, {
      config: { extends: ["recommended", "github"] },
      path: "page.md",
    });
    expect(
      result.diagnostics.filter((item) => item.rule.startsWith("engine/")),
      source,
    ).toEqual([]);
    expect(await render(result.output), source).toBe(before);
    expect(format(result.output, { config: { extends: ["recommended", "github"] } }).output).toBe(
      result.output,
    );
  }
});
