import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createMarkdownRenderer } from "vitepress";
import { expect, it } from "vitest";
import { format } from "../../src/index.js";
import type { Config } from "../../src/index.js";
import { fixture, run } from "../support/cli.js";

const config: Config = {
  extends: [],
  dialect: "commonmark",
  rules: { "links/allowed-notation": ["warn", { inline: false, fixTo: "full" }] },
};

it("previews, writes and checks the conversion through the built CLI workflow", async () => {
  const source = 'Read [the guide](https://example.com/setup "Setup").\n';
  const root = await fixture({
    "README.md": source,
    "mdrefine.config.jsonc": JSON.stringify(config),
  });
  const preview = run(root, ["format", "--diff"]);
  expect(preview.status, preview.stderr).toBe(0);
  expect(preview.stdout).toContain("[the guide][mdrefine-link-1]");
  expect(await readFile(path.join(root, "README.md"), "utf8")).toBe(source);
  const written = run(root, ["format", "--write"]);
  expect(written.status, written.stderr).toBe(0);
  expect(await readFile(path.join(root, "README.md"), "utf8")).toContain(
    '[mdrefine-link-1]: https://example.com/setup "Setup"',
  );
  expect(run(root, ["format", "--check"]).status).toBe(0);
  expect(run(root, ["lint"]).status).toBe(0);
});

it("preserves actual VitePress/Vue output for links, attributes, headings and images", async () => {
  const root = await fixture({ "guide.md": "# Guide\n" });
  const renderer = await createMarkdownRenderer(root, { cache: false });
  const require = createRequire(import.meta.resolve("vitepress"));
  const { createSSRApp } = require("vue") as typeof import("vue");
  const { renderToString } = require("vue/server-renderer") as typeof import("vue/server-renderer");
  const source =
    '# [The guide](./guide.md "Guide")\n\nRead [the guide](./guide.md?view=one#guide "Guide"){target="_blank"} and ![a *picture*](https://example.com/p.png "Picture").\n';
  const render = async (text: string) =>
    renderToString(
      createSSRApp({
        template: `<div>${await renderer.renderAsync(text, { path: path.join(root, "page.md"), realPath: path.join(root, "page.md"), relativePath: "page.md", includes: [] })}</div>`,
      }),
    );
  const result = format(source, {
    path: "page.md",
    config: { ...config, dialect: "vitepress" },
  });
  expect(result.output).not.toBe(source);
  expect(result.diagnostics).toEqual([]);
  expect(await render(result.output)).toBe(await render(source));
});
