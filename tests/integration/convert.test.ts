import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { competitorFiles } from "../../src/config/competitors.js";
import { fixture, run } from "../support/cli.js";
import { parseConfig, parseExplanation, parseReport } from "../support/json.js";

describe("competitor configuration CLI (#669)", () => {
  it("combines cli2 inheritance and globs, and preserves ignore selection", async () => {
    const root = await fixture({
      ".markdownlint-cli2.jsonc": JSON.stringify({
        config: { extends: "./base.yaml" },
        globs: ["docs/**/*.md", "!docs/generated/**"],
        ignores: ["docs/ignored/**"],
      }),
      "base.yaml": "default: false\nMD047: true\n",
      ".markdownlint.json": '{"default":false,"MD049":{"style":"asterisk"}}',
      "docs/note.md": "text",
      "docs/generated/note.md": "text",
      "docs/ignored/note.md": "text",
      "other.md": "text",
    });
    const result = run(root, ["lint", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(parseReport(result.stdout).files.map((file) => file.path)).toEqual(["docs/note.md"]);
    expect(result.stderr).toContain("base.yaml");
  });
  it("gives a nearer package key precedence and only executes scripts for the explicit command", async () => {
    const root = await fixture({
      ".prettierrc": '{"tabWidth": 2}',
      "sub/package.json": '{"prettier": {"tabWidth":4}}',
      "sub/note.md": "text\n",
    });
    const near = run(path.join(root, "sub"), ["config", "explain", "note.md"]);
    expect(parseExplanation(near.stdout).effective.rules["style/list-indent"]).toEqual([
      "warn",
      expect.objectContaining({ nestedIndent: 4 }),
    ]);
    const scripted = await fixture({
      ".prettierrc.cjs": 'module.exports = { proseWrap: "always", printWidth: 91 };',
      "note.md": "text\n",
    });
    expect(run(scripted, ["config", "explain", "note.md"]).stderr).toContain("not executed");
    expect(parseConfig(run(scripted, ["config", "convert"]).stdout).rules?.["style/wrap"]).toEqual([
      "warn",
      { width: 91 },
    ]);
    await writeFile(path.join(scripted, "mdrefine.config.json"), '{"extends":[]}');
    expect(run(scripted, ["config", "explain", "note.md"]).stderr).toBe("");
  });
  it("converts explicit script inheritance and empty YAML configurations", async () => {
    const root = await fixture({
      ".markdownlint.cjs": 'module.exports = { extends: "./base.yaml" };',
      "base.yaml": "default: false\nMD047: true\n",
      "note.md": "text\n",
    });
    const result = run(root, ["config", "convert"]);
    expect(result.status, result.stderr).toBe(0);
    expect(parseConfig(result.stdout).rules).toEqual({ "style/final-newline": ["warn", {}] });
    const empty = await fixture({ ".prettierrc.yaml": "", "note.md": "text\n" });
    const converted = run(empty, ["config", "convert"]);
    expect(converted.status, converted.stderr).toBe(0);
    expect(parseConfig(converted.stdout).rules).toHaveProperty("style/emphasis");
  });
  it("prints, writes exclusively, and explains conversion", async () => {
    const root = await fixture({
      ".prettierrc": "proseWrap: always\nprintWidth: 90",
      "note.md": "*text*\n",
    });
    const printed = run(root, ["config", "convert"]);
    expect(printed.status, printed.stderr).toBe(0);
    expect(parseConfig(printed.stdout).rules?.["style/wrap"]).toEqual(["warn", { width: 90 }]);
    expect(printed.stderr).toContain("inline comments and pragmas are not converted");
    expect(run(root, ["config", "explain", "note.md"]).stdout).toContain('"conversion"');
    const write = run(root, ["config", "convert", "--write"]);
    expect(write.status, write.stderr).toBe(0);
    const file = path.join(root, "mdrefine.config.jsonc");
    const before = await readFile(file, "utf8");
    expect(run(root, ["config", "convert", "--write"]).status).toBe(2);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(run(root, ["config", "explain", "note.md"]).stdout).not.toContain('"conversion"');
  });
  it.each(Object.values(competitorFiles).flat())(
    "discovers %s without implicitly executing code",
    async (name) => {
      const script = /\.[cm]?[jt]s$/.test(name);
      const toml = name.endsWith(".toml");
      const root = await fixture({
        [name]: script ? 'throw new Error("EXECUTED")' : toml ? 'proseWrap = "always"' : "{}",
        "note.md": "*text*\n",
      });
      const result = run(root, ["config", "explain", "note.md"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain(name);
      if (script) expect(result.stderr).toContain("not executed");
      if (toml) expect(result.stderr).toContain("TOML is unsupported");
      expect(run(root, ["config", "explain", "note.md", "--no-competitor-config"]).stderr).toBe("");
    },
  );
  it("reads extends, package settings, ignores, and Markdown overrides", async () => {
    const root = await fixture({
      ".markdownlint.json": '{"extends":"./base.yaml", "MD049":{"style":"asterisk"}}',
      "base.yaml": "default: false\nMD047: true\n",
      "package.json": JSON.stringify({
        prettier: {
          overrides: [{ files: "*.md", options: { proseWrap: "always", printWidth: 70 } }],
        },
      }),
      ".prettierignore": "generated/\n",
      "note.md": "*text*\n",
    });
    const result = run(root, ["config", "convert"]);
    expect(result.status, result.stderr).toBe(0);
    const config = parseConfig(result.stdout);
    expect(config.ignore).toEqual(["**/generated", "**/generated/**"]);
    expect(config.overrides?.[0]?.rules?.["style/wrap"]).toEqual(["warn", { width: 70 }]);
    expect(result.stderr).toContain("base.yaml");
    await writeFile(path.join(root, "base.yaml"), 'extends: "./.markdownlint.json"');
    expect(run(root, ["config", "convert"]).stderr).toContain("Cyclic");
  });
  it("reads editorconfig indentation without executing script configs", async () => {
    const root = await fixture({
      ".editorconfig": "root = true\n[*.md]\nindent_size = 4\n",
      "note.md": "text\n",
    });
    const result = run(root, ["config", "convert"]);
    expect(result.status, result.stderr).toBe(0);
    expect(parseConfig(result.stdout).overrides?.[0]?.rules?.["style/list-indent"]).toEqual([
      "warn",
      expect.objectContaining({ nestedIndent: 4 }),
    ]);
  });
});
