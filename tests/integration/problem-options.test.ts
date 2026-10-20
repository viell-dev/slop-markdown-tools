import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { lint } from "../../src/index.js";
import type { Config } from "../../src/index.js";
import { fixture, run } from "./support.js";
import { parseReport } from "./json.js";

it("uses configured problem rules identically in the API, CLI and path overrides", async () => {
  const config: Config = {
    extends: [],
    rules: {
      "structure/initial-heading": ["error", { level: 2, allowPreamble: true }],
      "structure/single-title": ["error", { level: 2, frontMatterTitle: false }],
      "structure/duplicate-heading": ["error", { siblingsOnly: false }],
      "content/code-language": ["error", { allowedLanguages: ["js"], languageOnly: true }],
    },
    overrides: [{ files: ["allowed/**"], rules: { "content/code-language": "off" } }],
  };
  const source =
    "Preamble.\n\n## Page\n\n### Setup\n\n## Other\n\n#### Setup\n\n```JS metadata\nx\n```\n";
  const root = await fixture({
    "mdtools.config.json": JSON.stringify(config),
    "note.md": source,
    "allowed/note.md": source,
  });
  for (const name of ["note.md", "allowed/note.md"]) {
    const expected = lint(source, { path: name, config });
    expect(expected).toHaveLength(name.startsWith("allowed/") ? 2 : 4);
    for (const mode of ["lint", "format"]) {
      const result = run(root, [mode, name, "--json", ...(mode === "format" ? ["--check"] : [])]);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toBe("");
      expect(parseReport(result.stdout).files).toEqual([
        { path: name, ...(mode === "format" ? { changed: false } : {}), diagnostics: expected },
      ]);
    }
    expect(await readFile(path.join(root, name), "utf8")).toBe(source);
  }
});

it("lets custom front-matter titles satisfy initial-heading and single-title together", async () => {
  const config: Config = {
    extends: [],
    rules: {
      "structure/initial-heading": ["error", { frontMatterTitle: "^page_name:" }],
      "structure/single-title": ["error", { frontMatterTitle: "^page_name:" }],
    },
  };
  const root = await fixture({ "mdtools.config.json": JSON.stringify(config) });
  const source = "---\npage_name: Example\n---\n\n## Section\n";
  const result = run(
    root,
    ["format", "-", "--stdin-filepath", "new.md", "--check", "--json"],
    source,
  );
  expect(result.status, result.stderr).toBe(0);
  expect(parseReport(result.stdout).files).toEqual([
    { path: "new.md", changed: false, diagnostics: [] },
  ]);
});

it("reports an invalid title pattern as a configuration error without writing", async () => {
  const source = "# Page\n";
  const root = await fixture({
    "mdtools.config.json": JSON.stringify({
      extends: [],
      rules: { "structure/initial-heading": ["error", { frontMatterTitle: "[" }] },
    }),
    "note.md": source,
  });
  const result = run(root, ["format", "note.md", "--write"]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Invalid options for structure/initial-heading");
  expect(result.stderr).toContain("regex");
  expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(source);
});
