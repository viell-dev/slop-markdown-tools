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
    expect(result.status, result.stderr).toBe(1);
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
    expect(parseConfig(result.stdout).rules).toEqual({ "style/final-newline": ["error", {}] });
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
    expect(printed.stderr).toContain(
      "inline comments and pragmas are not converted and have no effect",
    );
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
      const json5 = name.endsWith(".json5");
      const root = await fixture({
        [name]: script ? 'throw new Error("EXECUTED")' : toml ? 'proseWrap = "always"' : "{}",
        "note.md": "*text*\n",
      });
      const result = run(root, ["config", "explain", "note.md"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain(name);
      if (script) expect(result.stderr).toContain("not executed");
      if (json5) expect(result.stderr).toContain("JSON5 is unsupported");
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
      ".prettierrc": "{}",
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
  it.each([undefined, '{"default":false,"MD047":true}'])(
    "ignores editorconfig without Prettier (%s)",
    async (markdownlint) => {
      const root = await fixture({
        ".editorconfig": "[*]\nindent_size = 4\n",
        "note.md": "*text*\n",
        ...(markdownlint ? { ".markdownlint.json": markdownlint } : {}),
      });
      const result = run(root, ["config", "explain", "note.md"]);
      expect(result.stderr).not.toContain(".editorconfig");
      if (markdownlint)
        expect(parseExplanation(result.stdout).effective.rules).not.toHaveProperty(
          "style/list-indent",
        );
      else {
        expect(result.stdout).not.toContain('"conversion"');
        expect(Object.keys(parseExplanation(result.stdout).effective.rules).length).toBeGreaterThan(
          1,
        );
      }
    },
  );
  it.each(["json", "jsonc", "mjs", "js", "cjs"])(
    "refuses a second mdrefine configuration beside %s",
    async (extension) => {
      const root = await fixture({ ["mdrefine.config." + extension]: "{}", ".prettierrc": "{}" });
      expect(run(root, ["config", "convert", "--write"]).status).toBe(2);
    },
  );
  it("uses package precedence and filters sections for other languages", async () => {
    const root = await fixture({
      "package.json": '{"prettier":{"tabWidth":5}}',
      "package.yaml": "prettier: {tabWidth: 6}",
      ".prettierrc": '{"tabWidth":7}',
      "note.md": "text\n",
    });
    expect(
      parseConfig(run(root, ["config", "convert"]).stdout).rules?.["style/list-indent"],
    ).toEqual(["warn", expect.objectContaining({ nestedIndent: 5 })]);
    const other = await fixture({
      "package.yaml":
        "prettier:\n  tabWidth: 6\n  overrides:\n    - files: '*.{ts,tsx}'\n      options: {tabWidth: 9}\n    - files: '*.md'\n      options: {tabWidth: 3}",
      ".editorconfig":
        "[*.js]\nindent_size=8\n[*.{ts,tsx}]\nindent_size=7\n[*.md]\nindent_size=4\n",
      "note.md": "text\n",
    });
    const config = parseConfig(run(other, ["config", "convert"]).stdout);
    expect(config.rules?.["style/list-indent"]).toEqual([
      "warn",
      expect.objectContaining({ nestedIndent: 6 }),
    ]);
    expect(config.overrides).toHaveLength(2);
  });
  it("shares the fallback boundary when .obsidian is a file rather than a vault", async () => {
    const root = await fixture({
      ".prettierrc": '{"tabWidth":4}',
      "sub/.obsidian": "not a directory",
      "sub/note.md": "text\n",
    });
    const directory = path.join(root, "sub");
    const converted = parseConfig(run(directory, ["config", "convert"]).stdout);
    const effective = parseExplanation(
      run(directory, ["config", "explain", "note.md"]).stdout,
    ).effective;
    expect(converted.rules?.["style/list-indent"]).toEqual(effective.rules["style/list-indent"]);
    expect(converted.rules?.["style/list-indent"]).toEqual([
      "warn",
      expect.objectContaining({ nestedIndent: 4 }),
    ]);
  });
  it("uses Prettier's yml before yaml and js before cjs", async () => {
    const root = await fixture({
      ".prettierrc.yml": "tabWidth: 3",
      ".prettierrc.yaml": "tabWidth: 4",
    });
    expect(
      parseConfig(run(root, ["config", "convert"]).stdout).rules?.["style/list-indent"],
    ).toEqual(["warn", expect.objectContaining({ nestedIndent: 3 })]);
    const scripts = await fixture({
      ".prettierrc.cjs": "module.exports={tabWidth:3}",
      "prettier.config.js": "module.exports={tabWidth:4}",
    });
    expect(
      parseConfig(run(scripts, ["config", "convert"]).stdout).rules?.["style/list-indent"],
    ).toEqual(["warn", expect.objectContaining({ nestedIndent: 4 })]);
  });
});
