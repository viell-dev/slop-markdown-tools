import { expect, it } from "vitest";
import { createWorkspace, lint, format, validateConfig } from "../../src/index.js";
import type { VitePressOptions } from "../../src/index.js";
import { stringContaining } from "../support/assertions.js";

const files = {
  "docs/.vitepress/config.mts": null,
  "docs/page.md":
    "## 1. Introduction\n\n## Café au lait\n\n## test.0.1\n\n## Getting Started {#start}\n\n## Same\n\n## Same\n",
  "docs/guide/index.md": "## Guide\n",
  "docs/guide/install.md": "## Install\n",
  "docs/public/logo.svg": null,
  "docs/guide/example.js": null,
  "docs/unknown.ext.md": "# Unknown suffix\n",
};
const workspace = (vitepress: VitePressOptions = {}) =>
  createWorkspace(files, { dialect: "vitepress", vitepress });

it("uses the core's encoding-mark policy for target and included headings", () => {
  for (const count of [1, 2]) {
    const mark = String.fromCharCode(0xfeff).repeat(count);
    const ws = createWorkspace(
      {
        "page.md": mark + "# Heading\n\n<!-- @include: ./part.md -->\n",
        "part.md": mark + "## Included\n",
      },
      { dialect: "vitepress" },
    );
    for (const fragment of ["heading", "included"])
      expect(ws.resolve("page.md", "#" + fragment, "vitepress")).toMatchObject({
        fragmentExists: true,
      });
  }
});

it("resolves source-root pages, extensionless/HTML routes, directories and public assets", () => {
  const ws = workspace();
  for (const [url, target] of [
    ["./install", "docs/guide/install.md"],
    ["./install.html?view=full#Install", "docs/guide/install.md"],
    ["/guide/install.md", "docs/guide/install.md"],
    ["/guide/", "docs/guide/index.md"],
    ["/page.html#café-au-lait", "docs/page.md"],
    ["/logo.svg", "docs/public/logo.svg"],
    ["./example.js", "docs/guide/example.js"],
    ["/unknown.ext", "docs/unknown.ext.md"],
  ])
    expect(ws.resolve("docs/guide/source.md", url!, "vitepress"), url).toMatchObject({
      status: "resolved",
      target,
      fragmentExists: true,
    });
  expect(ws.resolve("docs/guide/source.md", "/missing", "vitepress")).toMatchObject({
    status: "missing",
  });
  expect(ws.resolve("docs/guide/source.md", "/logo.svg", "github")).toEqual({
    status: "unavailable",
  });
});

it("checks normalized fragments, explicit IDs and collisions in document order", () => {
  const ws = workspace();
  for (const fragment of [
    "_1-introduction",
    "1-introduction",
    "Café au lait",
    "cafe-au-lait",
    "test-0-1",
    "start",
    "same",
    "same-1",
  ])
    expect(ws.resolve("docs/page.md", "#" + fragment, "vitepress"), fragment).toMatchObject({
      status: "resolved",
      fragmentExists: true,
    });
  for (const fragment of ["test01", "getting-started-start", "same-2"])
    expect(ws.resolve("docs/page.md", "#" + fragment, "vitepress"), fragment).toMatchObject({
      status: "resolved",
      fragmentExists: false,
    });
  const github = workspace({ anchor: "github" });
  expect(github.resolve("docs/page.md", "#café-au-lait", "vitepress")).toMatchObject({
    fragmentExists: true,
  });
  expect(github.resolve("docs/page.md", "#cafe-au-lait", "vitepress")).toMatchObject({
    fragmentExists: false,
  });
});

it("accepts an explicit source directory and rejects a root outside the workspace", () => {
  const ws = createWorkspace(
    { "site/src/note.md": "# Title\n" },
    { dialect: "vitepress", vitepress: { srcDir: "site\\src" } },
  );
  expect(ws.resolve("site/src/source.md", "/note", "vitepress")).toMatchObject({
    target: "site/src/note.md",
  });
  for (const srcDir of ["../docs", "C:\\docs", "/docs", "docs/../../other"])
    expect(() => validateConfig({ vitepress: { srcDir } })).toThrow("workspace root");
});

it("collects included headings, nested includes, ranges, selected sections and non-Markdown text", () => {
  const ws = createWorkspace(
    {
      "docs/page.md":
        "# Main\n\n<!-- @include: @/part.md -->\n<!-- @include: ./lines.md{2,2} -->\n<!-- @include: ./section.md#chosen -->\n<!-- @include: ./text.txt -->\n",
      "docs/part.md": "---\ntitle: Metadata\n---\n## Part\n\n<!-- @include: ./nested.md -->\n",
      "docs/nested.md": "### Nested\n",
      "docs/lines.md": "# Excluded\n## Included line\n# Excluded again\n",
      "docs/section.md": "# Chosen\n\n## Included child\n\n# Other\n\n## Excluded child\n",
      "docs/text.txt": "## Text heading\n",
    },
    { dialect: "vitepress", vitepress: { srcDir: "docs" } },
  );
  for (const fragment of [
    "main",
    "part",
    "nested",
    "included-line",
    "included-child",
    "text-heading",
  ])
    expect(ws.resolve("docs/page.md", "#" + fragment, "vitepress"), fragment).toMatchObject({
      fragmentExists: true,
    });
  for (const fragment of ["excluded", "excluded-child", "chosen"])
    expect(ws.resolve("docs/page.md", "#" + fragment, "vitepress"), fragment).toMatchObject({
      fragmentExists: false,
    });
});

it("extracts named regions and leaves include cycles as comments", () => {
  const ws = createWorkspace(
    {
      "page.md": "# Main\n\n<!-- @include: ./part.md#region -->\n<!-- @include: ./page.md -->\n",
      "part.md": "<!-- #region region -->\n## Included\n<!-- #endregion -->\n## Excluded\n",
    },
    { dialect: "vitepress" },
  );
  expect(ws.resolve("page.md", "#included", "vitepress")).toMatchObject({ fragmentExists: true });
  expect(ws.resolve("page.md", "#excluded", "vitepress")).toMatchObject({ fragmentExists: false });
});

it("reports incomplete includes as unchecked rather than known missing fragments", () => {
  const source = "[unknown](#unknown)\n\n<!-- @include: ../outside.md -->\n";
  const ws = createWorkspace({ "page.md": source }, { dialect: "vitepress" });
  expect(ws.resolve("page.md", "#unknown", "vitepress")).toMatchObject({ status: "unreadable" });
  const findings = lint(source, {
    path: "page.md",
    workspace: ws,
    config: { extends: ["recommended", "vitepress"] },
  });
  expect(findings.filter((item) => item.rule === "links/valid")).toEqual([
    expect.objectContaining({ message: stringContaining("fully checked") }),
  ]);
});

it("leaves target/download links and shared definitions out of page rewriting", () => {
  const source =
    '[direct](./missing.md){target="_blank"}\n\n[download](./absent.zip){download}\n\n[reference][x]{target="_blank"}\n\n[x]: ./missing-reference.md\n';
  const ws = createWorkspace({ "page.md": source }, { dialect: "vitepress" });
  const config = {
    extends: ["recommended", "vitepress"],
    rules: { "links/path": ["warn", { style: "relative" }] },
  } as const;
  expect(
    lint(source, { workspace: ws, path: "page.md", config }).filter((item) =>
      item.rule.startsWith("links/"),
    ),
  ).toEqual([]);
  expect(format(source, { workspace: ws, path: "page.md", config }).output).toBe(source);
  const mixed = source + "\n[ordinary][x]\n";
  expect(
    lint(mixed, { workspace: ws, path: "page.md", config }).filter(
      (item) => item.rule === "links/valid",
    ),
  ).toHaveLength(1);
});
