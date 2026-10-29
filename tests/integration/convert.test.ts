import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveConfig as prettierResolve, getFileInfo } from "prettier";
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
    expect(config.overrides?.[0]?.ruleUpdates?.["style/wrap"]?.options).toEqual({
      mode: "always",
      width: 70,
    });
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
    expect(
      parseConfig(result.stdout).overrides?.[0]?.ruleUpdates?.["style/list-indent"]?.options,
    ).toEqual(expect.objectContaining({ nestedIndent: 4 }));
  });
  it("carries an editorconfig line ending to style/line-ending, as Prettier reads it", async () => {
    const root = await fixture({
      ".prettierrc": "{}",
      ".editorconfig": "root = true\n[*.md]\nend_of_line = crlf\n",
      "note.md": "text\n",
    });
    const reference = await prettierResolve(path.join(root, "note.md"), { editorconfig: true });
    expect(reference?.endOfLine).toBe("crlf");
    const result = run(root, ["config", "explain", "note.md"]);
    expect(result.status, result.stderr).toBe(0);
    expect(parseExplanation(result.stdout).effective.rules["style/line-ending"]).toEqual([
      "warn",
      { endOfLine: "crlf" },
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
  it("accumulates matching overrides on editorconfig, including unset", async () => {
    const root = await fixture({
      ".prettierrc": JSON.stringify({
        proseWrap: "preserve",
        overrides: [
          { files: "*.md", options: { proseWrap: "always" } },
          { files: "README.md", options: { tabWidth: 4 } },
        ],
      }),
      ".editorconfig": "root=true\n[*]\nmax_line_length=40\n[README.md]\nmax_line_length=unset\n",
      "README.md": "text\n",
      "note.md": "text\n",
    });
    for (const name of ["README.md", "note.md"]) {
      const reference = await prettierResolve(path.join(root, name), { editorconfig: true });
      const result = run(root, ["config", "explain", name]);
      expect(result.status, result.stderr).toBe(0);
      const effective = parseExplanation(result.stdout).effective.rules;
      expect(effective["style/wrap"]).toEqual([
        "warn",
        { mode: "always", width: reference?.printWidth ?? 80 },
      ]);
      expect(effective["style/list-indent"]).toEqual([
        "warn",
        expect.objectContaining({ nestedIndent: reference?.tabWidth ?? 2 }),
      ]);
    }
  });
  it("rebases source patterns for fallback and written conversion", async () => {
    const root = await fixture({
      "sub/.prettierrc": JSON.stringify({
        overrides: [{ files: "docs/*.md", options: { proseWrap: "always", printWidth: 40 } }],
      }),
      "sub/.prettierignore": "/skip.md\n",
      "sub/docs/a.md": "text\n",
      "sub/skip.md": "text\n",
      "skip.md": "text\n",
    });
    const sub = path.join(root, "sub");
    expect(
      (
        await getFileInfo(path.join(sub, "skip.md"), {
          ignorePath: path.join(sub, ".prettierignore"),
        })
      ).ignored,
    ).toBe(true);
    const selected = run(sub, ["lint", "--json"]);
    expect(parseReport(selected.stdout).files.map((f) => f.path)).toEqual([
      "skip.md",
      "sub/docs/a.md",
    ]);
    const before = parseExplanation(run(sub, ["config", "explain", "docs/a.md"]).stdout).effective
      .rules;
    expect(before["style/wrap"]).toEqual(["warn", { mode: "always", width: 40 }]);
    expect(run(sub, ["config", "convert", "--write"]).status).toBe(0);
    expect(
      parseExplanation(run(sub, ["config", "explain", "docs/a.md"]).stdout).effective.rules,
    ).toEqual(before);
    expect(parseReport(run(sub, ["lint", "--json"]).stdout).files.map((f) => f.path)).toEqual([
      "docs/a.md",
    ]);
  });
  it("uses cli2 replacement precedence and relative inheritance", async () => {
    const root = await fixture({
      ".markdownlint.json": JSON.stringify({ extends: "base.json", MD049: { style: "asterisk" } }),
      "base.json": '{"default":false}',
      ".markdownlint-cli2.jsonc": JSON.stringify({
        config: { default: false, MD049: { style: "underscore" }, MD047: true },
      }),
      "note.md": "*text*\n",
    });
    const effective = parseExplanation(run(root, ["config", "explain", "note.md"]).stdout).effective
      .rules;
    expect(effective["style/emphasis"]).toEqual(["error", { marker: "*" }]);
    expect(effective).not.toHaveProperty("style/final-newline");
  });
  it("rebases cli2 globs and ignores directories through actual selection", async () => {
    const root = await fixture({
      "sub/.markdownlint-cli2.jsonc": JSON.stringify({
        config: { default: false, MD047: true },
        globs: ["**/*.md"],
        ignores: ["generated"],
      }),
      "sub/generated/a.md": "text",
      "sub/note.md": "text",
      "note.md": "text",
    });
    const result = run(path.join(root, "sub"), ["lint", "--json"]);
    expect(parseReport(result.stdout).files.map((f) => f.path)).toEqual(["sub/note.md"]);
  });
  it.each(["lint", "format", "rules", "config explain"])(
    "supports opt-out for %s with malformed package metadata",
    async (command) => {
      const root = await fixture({ "package.json": "{bad", "note.md": "text\n" });
      const args = command.split(" ");
      if (command === "config explain") args.push("note.md");
      expect(run(root, [...args, "--no-competitor-config"]).status).toBe(0);
      expect(run(root, args).status).not.toBe(2);
    },
  );
  it("replaces cli2 config instead of merging standalone settings", async () => {
    const root = await fixture({
      ".markdownlint.json": '{"default":false,"MD049":{"style":"asterisk"}}',
      ".markdownlint-cli2.jsonc":
        '{"config":{"default":false,"MD049":{"style":"underscore"},"MD047":true}}',
      "note.md": "*text*\n",
    });
    const rules = parseExplanation(run(root, ["config", "explain", "note.md"]).stdout).effective
      .rules;
    expect(rules["style/emphasis"]).toEqual(["error", { marker: "*" }]);
    expect(rules).not.toHaveProperty("style/final-newline");
  });
  it("excludes cli2 directory descendants at the source root", async () => {
    const root = await fixture({
      ".markdownlint-cli2.jsonc":
        '{"config":{"default":false,"MD047":true},"ignores":["generated"]}',
      "generated/a.md": "text",
      "note.md": "text",
    });
    expect(parseReport(run(root, ["lint", "--json"]).stdout).files.map((f) => f.path)).toEqual([
      "note.md",
    ]);
  });
  it("clears inherited EditorConfig width with unset", async () => {
    const root = await fixture({
      ".prettierrc": '{"proseWrap":"always"}',
      ".editorconfig": "root=true\n[*]\nmax_line_length=40\n[README.md]\nmax_line_length=unset\n",
      "README.md": "text\n",
    });
    const reference = await prettierResolve(path.join(root, "README.md"), { editorconfig: true });
    const rules = parseExplanation(run(root, ["config", "explain", "README.md"]).stdout).effective
      .rules;
    expect(rules["style/wrap"]).toEqual(["warn", { width: reference?.printWidth ?? 80 }]);
  });
});

describe("ancestor conversion and EditorConfig resolution", () => {
  it.each(["prettier", "editorconfig", "prettierignore", "globs", "ignores"])(
    "writes and reads ancestor %s patterns in a child",
    async (family) => {
      const files: Record<string, string> = {
        "sub/README.md": "text\n",
        "sub/skip.md": "text\n",
        "outside.md": "text\n",
      };
      if (family === "globs" || family === "ignores")
        files[".markdownlint-cli2.jsonc"] = JSON.stringify({
          config: { default: false },
          [family]: family === "globs" ? ["sub/**/*.md", "other/**/*.md"] : ["sub/skip.md"],
        });
      else {
        files[".prettierrc"] = JSON.stringify(
          family === "prettier"
            ? {
                overrides: [
                  { files: "*.md", options: { proseWrap: "always", printWidth: 37 } },
                  { files: "sub/README.md", options: { printWidth: 39 } },
                  { files: "other/*.md", options: { printWidth: 99 } },
                ],
              }
            : { proseWrap: "always" },
        );
        if (family === "editorconfig")
          files[".editorconfig"] =
            "root = true\n[*.md]\nmax_line_length = 37\n[sub/README.md]\nmax_line_length = 39\n";
        if (family === "prettierignore") files[".prettierignore"] = "/sub/skip.md\n/other.md\n";
      }
      const root = await fixture(files),
        child = path.join(root, "sub");
      const written = run(child, ["config", "convert", "--write"]);
      expect(written.status, written.stderr).toBe(0);
      expect(await readFile(path.join(child, "mdrefine.config.jsonc"), "utf8")).not.toContain(
        "../",
      );
      if (family === "prettier" || family === "editorconfig") {
        const explained = run(child, ["config", "explain", "README.md"]);
        expect(parseExplanation(explained.stdout).effective.rules["style/wrap"]).toEqual([
          "warn",
          expect.objectContaining({ width: 39 }),
        ]);
      } else {
        const selected = run(child, ["lint", "--json"]);
        expect(selected.status, selected.stderr).toBe(0);
        expect(parseReport(selected.stdout).files.map((f) => f.path)).toEqual(
          family === "globs" ? ["README.md", "skip.md"] : ["README.md"],
        );
      }
    },
  );
  it.each(["end_of_line", "max_line_length", "indent_style", "indent_size", "tab_width"])(
    "matches Prettier when unsetting %s in sections and nested files",
    async (key) => {
      for (const nested of [false, true])
        for (const reverse of [false, true]) {
          const initial = `indent_style = space\n${reverse ? "tab_width = 8\nindent_size = 4" : "indent_size = 4\ntab_width = 8"}\nend_of_line = crlf\nmax_line_length = 44\n`;
          const root = await fixture({
            ".prettierrc": '{"proseWrap":"always"}',
            ".editorconfig": `root = true\n[*]\n${initial}${nested ? "" : `[README.md]\n${key} = unset\n`}`,
            ...(nested ? { "sub/.editorconfig": `[README.md]\n${key} = unset\n` } : {}),
            [nested ? "sub/README.md" : "README.md"]: "text\n",
          });
          const child = nested ? path.join(root, "sub") : root;
          const reference = await prettierResolve(path.join(child, "README.md"), {
            editorconfig: true,
          });
          expect(run(child, ["config", "convert", "--write"]).status).toBe(0);
          const result = run(child, ["config", "explain", "README.md"]);
          const rules = parseExplanation(result.stdout).effective.rules;
          expect(rules["style/list-indent"]).toEqual([
            "warn",
            expect.objectContaining({ nestedIndent: reference?.tabWidth ?? 2 }),
          ]);
          expect(rules["style/line-ending"]).toEqual([
            "warn",
            { endOfLine: reference?.endOfLine ?? "lf" },
          ]);
          expect(rules["style/wrap"]).toEqual([
            "warn",
            expect.objectContaining({ width: reference?.printWidth ?? 80 }),
          ]);
        }
    },
  );
});

it("accumulates indentation removals across several overlapping EditorConfig sections", async () => {
  const root = await fixture({
    ".prettierrc": "{}",
    ".editorconfig":
      "root = true\n[*]\nindent_style = space\nindent_size = 4\ntab_width = 8\n[README.md]\nindent_size = unset\n[*.md]\ntab_width = 6\n[docs/**]\nindent_size = 3\n[**/README.md]\ntab_width = unset\n[docs/*.md]\nindent_style = unset\n",
    "README.md": "text\n",
    "docs/README.md": "text\n",
  });
  expect(run(root, ["config", "convert", "--write"]).status).toBe(0);
  for (const file of ["README.md", "docs/README.md"]) {
    const reference = await prettierResolve(path.join(root, file), { editorconfig: true });
    const result = run(root, ["config", "explain", file]);
    expect(parseExplanation(result.stdout).effective.rules["style/list-indent"]).toEqual([
      "warn",
      expect.objectContaining({ nestedIndent: reference?.tabWidth ?? 2 }),
    ]);
  }
});
