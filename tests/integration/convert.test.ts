import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveConfig as prettierResolve, getFileInfo } from "prettier";
import { describe, expect, it } from "vitest";
import { competitorFiles } from "../../src/config/competitors.js";
import { exists } from "../../src/workspace/access.js";
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
    expect(run(scripted, ["config", "explain", "note.md"]).stderr).toContain(
      "not using .prettierrc.cjs: the fallback does not run JavaScript or TypeScript",
    );
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
    expect(printed.stderr).toContain("inline comments and pragmas apply during fallback only");
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
      if (script) expect(result.stderr).toContain("the fallback does not run JavaScript");
      if (json5) expect(result.stderr).toContain("JSON5 is not supported");
      if (toml) expect(result.stderr).toContain("TOML is not supported");
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
    expect(config.ignore).toEqual(["**/generated/**"]);
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
    // Without --root, the file goes to the workspace root that lint uses from
    // here (#788), so writing it changes neither the settings nor the selection,
    // from the subdirectory or from the root.
    const written = run(sub, ["config", "convert", "--write"]);
    expect(written.status, written.stderr).toBe(0);
    expect(written.stderr).toContain("mdrefine: created ../mdrefine.config.jsonc\n");
    expect(await exists(path.join(root, "mdrefine.config.jsonc"))).toBe(true);
    expect(await exists(path.join(sub, "mdrefine.config.jsonc"))).toBe(false);
    expect(
      parseExplanation(run(sub, ["config", "explain", "docs/a.md"]).stdout).effective.rules,
    ).toEqual(before);
    for (const directory of [sub, root]) {
      const after = run(directory, ["lint", "--json"]);
      expect(after.stderr).not.toContain("no mdrefine configuration");
      expect(parseReport(after.stdout).files.map((f) => f.path)).toEqual([
        "skip.md",
        "sub/docs/a.md",
      ]);
    }
    // An explicit --root still writes a configuration for that subtree.
    await rm(path.join(root, "mdrefine.config.jsonc"));
    const child = run(sub, ["config", "convert", "--write", "--root", "."]);
    expect(child.stderr).toContain("mdrefine: created mdrefine.config.jsonc\n");
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
  it("reads a cli2 file without config as markdownlint's defaults (#792)", async () => {
    for (const name of [".markdownlint-cli2.jsonc", ".markdownlint-cli2.yaml"]) {
      const root = await fixture({
        [name]: name.endsWith("yaml") ? "ignores:\n  - generated\n" : '{"ignores":["generated"]}',
        "generated/a.md": "text",
        "note.md": "text",
      });
      const result = run(root, ["lint", "--json"]);
      const files = parseReport(result.stdout).files;
      // markdownlint's defaults report the missing final line break (MD047).
      expect(files.map((f) => f.path)).toEqual(["note.md"]);
      expect(files[0]!.diagnostics.map((d) => d.rule)).toContain("style/final-newline");
      const rules = parseExplanation(run(root, ["config", "explain", "note.md"]).stdout).effective
        .rules;
      expect(Object.keys(rules).length).toBeGreaterThan(10);
    }
    // A `.markdownlint.*` file beside it still supplies the configuration.
    const root = await fixture({
      ".markdownlint-cli2.jsonc": '{"ignores":["generated"]}',
      ".markdownlint.json": '{"default":false,"MD047":true}',
      "note.md": "text",
    });
    const rules = parseExplanation(run(root, ["config", "explain", "note.md"]).stdout).effective
      .rules;
    expect(Object.keys(rules)).toEqual(["style/final-newline"]);
  });
  it("names an unconverted .markdownlintignore instead of checking its files silently", async () => {
    const root = await fixture({
      ".markdownlint.json": '{"default":true}',
      ".markdownlintignore": "docs/\n",
      "docs/a.md": "#Title\n",
      "b.md": "# B\n",
    });
    const conversion = (
      JSON.parse(run(root, ["config", "explain", "b.md"]).stdout) as {
        conversion: { sources: string[]; unused: { file: string; reason: string }[] };
      }
    ).conversion;
    expect(conversion.sources).toEqual([path.join(root, ".markdownlint.json")]);
    expect(conversion.unused).toEqual([
      {
        file: path.join(root, ".markdownlintignore"),
        reason:
          'it is not converted, so the documents it excludes are checked; list its patterns under "ignore" in an mdrefine configuration',
      },
    ]);
    const linted = run(root, ["lint"]);
    expect(linted.stderr).toContain("not using .markdownlintignore: it is not converted");
    expect(linted.stderr).toContain("docs/a.md");
    // Without a markdownlint configuration in use, the file is no fallback source.
    const prettierOnly = await fixture({
      ".prettierrc.json": "{}",
      ".markdownlintignore": "docs/\n",
      "b.md": "# B\n",
    });
    expect(run(prettierOnly, ["lint"]).stderr).not.toContain(".markdownlintignore");
  });
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
      const written = run(child, ["config", "convert", "--write", "--root", "."]);
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
          expect(run(child, ["config", "convert", "--write", "--root", "."]).status).toBe(0);
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

describe("bounded file-pattern translation", () => {
  it("preserves hash residuals and omits extglobs without adding an OR exclusion leak", async () => {
    const pattern = "sub/**/!(skip).md";
    const root = await fixture({
      ".prettierrc": JSON.stringify({
        overrides: [
          {
            files: [pattern, "sub/deep/#README.md"],
            options: { proseWrap: "always", printWidth: 37 },
          },
        ],
      }),
      "sub/deep/skip.md": "text\n",
      "sub/deep/#README.md": "text\n",
    });
    const child = path.join(root, "sub/deep");
    const written = run(child, ["config", "convert", "--write", "--root", "."]);
    expect(written.status, written.stderr).toBe(0);
    expect(written.stderr).toContain(
      `${path.join(root, ".prettierrc")}: pattern ${pattern} not carried over`,
    );
    for (const file of ["skip.md", "#README.md"]) {
      const reference = await prettierResolve(path.join(child, file));
      const rules = parseExplanation(run(child, ["config", "explain", file]).stdout).effective
        .rules;
      expect(rules["style/wrap"]).toEqual([
        file === "skip.md" ? "off" : "warn",
        expect.objectContaining({ width: reference?.printWidth ?? 80 }),
      ]);
    }
  });
  it.each([
    "sub/[!a]*/**/*.md",
    "sub/[a-z]*/**/*.md",
    "sub/{1..3}/**/*.md",
    "/sub/deep/README.md",
    '"sub/deep/README.md"',
  ])("reports unsupported Prettier pattern %s instead of emitting it", async (pattern) => {
    const root = await fixture({
      ".prettierrc": JSON.stringify({
        overrides: [{ files: pattern, options: { proseWrap: "always", printWidth: 37 } }],
      }),
      "sub/deep/README.md": "text\n",
    });
    const child = path.join(root, "sub/deep");
    const written = run(child, ["config", "convert", "--write", "--root", "."]);
    expect(written.status, written.stderr).toBe(0);
    expect(written.stderr).toContain(
      `${path.join(root, ".prettierrc")}: pattern ${pattern} not carried over`,
    );
    expect(await readFile(path.join(child, "mdrefine.config.jsonc"), "utf8")).not.toContain(
      '"files"',
    );
    const ref = await prettierResolve(path.join(child, "README.md"));
    const wrap = parseExplanation(run(child, ["config", "explain", "README.md"]).stdout).effective
      .rules["style/wrap"];
    expect(wrap).toBeUndefined();
    if (pattern.includes("[!a]")) expect(ref?.printWidth).toBeUndefined();
  });
  it.each(["ignores", "globs"])(
    "expands ancestor %s directories before rebasing",
    async (family) => {
      for (const pattern of ["sub", "sub/deep", "other"]) {
        const root = await fixture({
          ".markdownlint-cli2.jsonc": JSON.stringify({
            config: { default: false },
            [family]: family === "globs" ? ["**/*.md", `!${pattern}`] : [pattern],
          }),
          "sub/deep/README.md": "text\n",
        });
        const child = path.join(root, "sub/deep");
        expect(run(child, ["config", "convert", "--write", "--root", "."]).status).toBe(0);
        // cli2 directory exclusions include all descendants, in source coordinates.
        const result = run(child, ["lint", "--json"]);
        expect(result.status, result.stderr).toBe(0);
        expect(parseReport(result.stdout).files.map((f) => f.path)).toEqual(
          pattern === "other" ? ["README.md"] : [],
        );
      }
    },
  );
  it.each(["sub/{deep,other}/", "sub/deep/", "sub/(deep)/", "sub/**/skip?.md", "sub/deep/a.md/"])(
    "preserves gitignore membership for %s after write and read",
    async (pattern) => {
      const root = await fixture({
        ".prettierrc": "{}",
        ".prettierignore": `${pattern}\n`,
        "sub/deep/a.md": "text\n",
        "sub/deep/skip1.md": "text\n",
        "sub/{deep,other}/a.md": "text\n",
        "sub/(deep)/a.md": "text\n",
      });
      for (const destination of ["deep", "{deep,other}", "(deep)"]) {
        const child = path.join(root, "sub", destination);
        expect(run(child, ["config", "convert", "--write", "--root", "."]).status).toBe(0);
        const expected: string[] = [];
        for (const file of destination === "deep" ? ["a.md", "skip1.md"] : ["a.md"]) {
          if (
            !(
              await getFileInfo(path.join(child, file), {
                ignorePath: path.join(root, ".prettierignore"),
              })
            ).ignored
          )
            expected.push(file);
        }
        const result = run(child, ["lint", "--json"]);
        expect(result.status, result.stderr).toBe(0);
        expect(parseReport(result.stdout).files.map((f) => f.path)).toEqual(expected);
      }
    },
  );
});

describe("round-six pattern boundaries", () => {
  it("reports gitignore case approximation once and preserves exact case", async () => {
    const root = await fixture({
      ".prettierrc": "{}",
      ".prettierignore": "README.md\nother.md\n",
      "readme.md": "text\n",
    });
    expect(
      (
        await getFileInfo(path.join(root, "readme.md"), {
          ignorePath: path.join(root, ".prettierignore"),
        })
      ).ignored,
    ).toBe(true);
    const written = run(root, ["config", "convert", "--write"]);
    expect(written.status).toBe(0);
    expect(
      written.stderr.match(/Prettier matches its patterns without regard to letter case/g),
    ).toHaveLength(1);
    expect(written.stderr).toContain("mdrefine: .prettierignore: Prettier matches");
    expect(parseReport(run(root, ["lint", "--json"]).stdout).files.map((f) => f.path)).toEqual([
      "readme.md",
    ]);
  });
  it.each(["{a,b}.md", "a.md/**", "{a,b}.md/**", "sub/{a,b}.md/**"])(
    "preserves Prettier literal and zero-component matches for %s",
    async (pattern) => {
      const names = ["a.md", "b.md", "{a,b}.md", "sub/a.md", "sub/{a,b}.md", "other.md"];
      const root = await fixture({
        ".prettierrc": JSON.stringify({
          overrides: [{ files: pattern, options: { proseWrap: "always", printWidth: 37 } }],
        }),
        ...Object.fromEntries(names.map((name) => [name, "text\n"])),
      });
      for (const destination of [root, path.join(root, "sub")]) {
        expect(run(destination, ["config", "convert", "--write", "--root", "."]).status).toBe(0);
        for (const name of names.filter(
          (name) => destination === root || name.startsWith("sub/"),
        )) {
          const reference = await prettierResolve(path.join(root, name));
          const relative = path.relative(destination, path.join(root, name));
          const wrap = parseExplanation(run(destination, ["config", "explain", relative]).stdout)
            .effective.rules["style/wrap"];
          if (reference?.printWidth === 37)
            expect(wrap).toEqual(["warn", expect.objectContaining({ width: 37 })]);
          else
            expect(
              Array.isArray(wrap) ? wrap[0] : wrap,
              JSON.stringify({ pattern, name, destination, reference, wrap }),
            ).not.toBe("warn");
        }
      }
    },
  );
  it.each(["prettier", "gitignore", "editorconfig", "cli2"])(
    "reports empty components in %s",
    async (dialect) => {
      const pattern = "x//*.md";
      const root = await fixture({
        ".prettierrc":
          dialect === "prettier"
            ? JSON.stringify({
                overrides: [{ files: pattern, options: { proseWrap: "always", printWidth: 37 } }],
              })
            : "{}",
        ...(dialect === "gitignore" ? { ".prettierignore": pattern + "\n" } : {}),
        ...(dialect === "editorconfig"
          ? { ".editorconfig": `[${pattern}]\nmax_line_length=37\n` }
          : {}),
        ...(dialect === "cli2"
          ? {
              ".markdownlint-cli2.jsonc": JSON.stringify({
                config: { default: false },
                globs: [pattern],
              }),
            }
          : {}),
        "x/a.md": "text\n",
      });
      const written = run(root, ["config", "convert", "--write"]);
      expect(written.status).toBe(0);
      expect(written.stderr).toContain(`pattern ${pattern} not carried over`);
      expect((await prettierResolve(path.join(root, "x/a.md")))?.printWidth).toBeUndefined();
      if (dialect === "gitignore")
        expect(
          (
            await getFileInfo(path.join(root, "x/a.md"), {
              ignorePath: path.join(root, ".prettierignore"),
            })
          ).ignored,
        ).toBe(false);
      expect(parseReport(run(root, ["lint", "--json"]).stdout).files.map((f) => f.path)).toEqual([
        "x/a.md",
      ]);
    },
  );
  it.each([["a,b.md", "c.md"], ["{a,b}.md", "c.md"], ["a,b.md"]])(
    "handles cli2 union boundaries %j",
    async (...globs) => {
      const names = ["a,b.md", "a.md", "b.md", "c.md"];
      const root = await fixture({
        ".markdownlint-cli2.jsonc": JSON.stringify({ config: { default: false }, globs }),
        ...Object.fromEntries(names.map((name) => [name, "text\n"])),
      });
      const written = run(root, ["config", "convert", "--write"]);
      expect(written.status).toBe(0);
      if (globs.length > 1)
        expect(written.stderr).toContain(
          `pattern ${globs[0]} not carried over: unrepresentable combined selection`,
        );
      else expect(written.stderr).not.toContain("unrepresentable combined selection");
      // cli2's documented globby contract selects the literal comma for one branch.
      // An unrepresentable union is omitted as a whole instead of narrowing selection.
      expect(parseReport(run(root, ["lint", "--json"]).stdout).files.map((f) => f.path)).toEqual(
        globs.length > 1 ? names : ["a,b.md"],
      );
    },
  );
  it.each(["C:/x/a.md", "C:\\x\\a.md", "//server/share/a.md"])(
    "reports portable absolute-path rejection for %s",
    async (pattern) => {
      const root = await fixture({
        ".prettierrc": JSON.stringify({
          overrides: [{ files: pattern, options: { printWidth: 37, proseWrap: "always" } }],
        }),
        ".markdownlint-cli2.jsonc": JSON.stringify({
          config: { default: false },
          globs: [pattern],
        }),
        "a.md": "text\n",
      });
      const written = run(root, ["config", "convert", "--write"]);
      expect(written.status).toBe(0);
      for (const source of [".prettierrc", ".markdownlint-cli2.jsonc"])
        expect(written.stderr).toContain(
          `mdrefine: ${source}: pattern ${pattern} not carried over`,
        );
      expect(parseReport(run(root, ["lint", "--json"]).stdout).files.map((f) => f.path)).toEqual([
        "a.md",
      ]);
    },
  );
});

it("honors inline comments only through fallback, including the Node loading path", async () => {
  const source = "<!-- markdownlint-disable -->\n\n*one*\n";
  const root = await fixture({
    ".markdownlint.json": '{"default":false,"MD049":{"style":"underscore"}}',
    "note.md": source,
  });
  expect(run(root, ["format", "--check"]).status).toBe(0);
  const { loadConfig } = await import("../../src/config/load.js");
  const { format } = await import("../../src/index.js");
  expect(format(source, await loadConfig(root)).output).toBe(source);
  expect(run(root, ["format", "--check", "--no-competitor-config"]).status).toBe(1);
  expect(run(root, ["config", "convert", "--write"]).status).toBe(0);
  expect(run(root, ["format", "--check"]).status).toBe(1);
  await writeFile(
    path.join(root, "mdrefine.config.jsonc"),
    '{"extends":[],"rules":{"style/emphasis":"warn"}}',
  );
  expect(run(root, ["format", "--check"]).status).toBe(1);
});
it("honors Prettier ignores and pragma overrides and deduplicates comment notices", async () => {
  const root = await fixture({
    ".prettierrc":
      '{"requirePragma":true,"overrides":[{"files":"marked.md","options":{"requirePragma":false}}]}',
    "note.md": "*one*\n",
    "marked.md": "*two*\n",
  });
  expect(run(root, ["format", "note.md", "--check"]).status).toBe(0);
  expect(run(root, ["format", "marked.md", "--check"]).status).toBe(1);
  await writeFile(
    path.join(root, "note.md"),
    "<!-- @format -->\n\n<!-- prettier-ignore -->\n\n*one*\n",
  );
  expect(run(root, ["format", "note.md", "--check"]).status).toBe(0);
});

it("reports a repeated unknown comment name only once across files", async () => {
  const source = "<!-- markdownlint-disable UNKNOWN -->\n\n*one*\n";
  const root = await fixture({
    ".markdownlint.json": '{"default":false,"MD049":{"style":"underscore"}}',
    "a.md": source,
    "b.md": source,
  });
  const result = run(root, ["lint", "--json"]);
  expect(result.status).toBe(1);
  expect(result.stderr.match(/markdownlint comment UNKNOWN:/g)).toHaveLength(1);
});

describe("competitor fallback and conversion after the CLI review (#788)", () => {
  const messy = "# Title\n\nSome *emphasis*.  \n\n\n* item\n";
  /** The effective rules for a document without any fallback: the defaults. */
  const defaults = (root: string, file = "a.md") =>
    parseExplanation(run(root, ["config", "explain", file, "--no-competitor-config"]).stdout)
      .effective.rules;
  const explained = (root: string, file = "a.md") => {
    const result = run(root, ["config", "explain", file]);
    expect(result.status, result.stderr).toBe(0);
    return parseExplanation(result.stdout);
  };

  it.each([
    "**/*.md\n**/*.markdown\n",
    "*.md\n*.markdown\n",
    "*\n",
    "# Markdown is mdrefine's\n**/*.MD\n**/*.Markdown\n",
  ])(
    "does not take Prettier settings from a workspace whose .prettierignore is %j",
    async (text) => {
      const root = await fixture({
        ".prettierrc.json": '{ "proseWrap": "never" }',
        ".prettierignore": text,
        "a.md": messy,
        "docs/b.markdown": messy,
      });
      // Prettier itself leaves these documents alone.
      for (const file of ["a.md", "docs/b.markdown"])
        expect(
          (
            await getFileInfo(path.join(root, file), {
              ignorePath: path.join(root, ".prettierignore"),
            })
          ).ignored,
        ).toBe(true);
      const linted = run(root, ["lint", "--json"]);
      expect(linted.status, linted.stderr).toBe(0);
      expect(parseReport(linted.stdout).files.map((file) => file.path)).toEqual([
        "a.md",
        "docs/b.markdown",
      ]);
      expect(linted.stderr).toBe(
        "mdrefine: not using .prettierrc.json: .prettierignore excludes all Markdown, so Prettier does not format Markdown here\n" +
          "mdrefine: no mdrefine configuration and no usable markdownlint or Prettier configuration, so the defaults apply (opt out of the search: --no-competitor-config)\n",
      );
      expect(explained(root).effective.rules).toEqual(defaults(root));
      expect(run(root, ["format", "--check"]).status).toBe(1);
      const converted = run(root, ["config", "convert"]);
      expect(converted.status).toBe(2);
      expect(converted.stderr).toContain(
        "No usable markdownlint or Prettier configuration: not using .prettierrc.json: .prettierignore excludes all Markdown",
      );
    },
  );
  it.each(["*.md\n", "**/*.md\n"])(
    "takes %j alone as leaving Markdown to mdrefine",
    async (text) => {
      const root = await fixture({
        ".prettierrc.json": '{ "proseWrap": "never" }',
        ".prettierignore": text,
        "a.md": messy,
        "docs/b.md": messy,
      });
      const linted = run(root, ["lint", "--json"]);
      expect(parseReport(linted.stdout).files.map((file) => file.path)).toEqual([
        "a.md",
        "docs/b.md",
      ]);
      expect(linted.stderr).toContain(
        "not using .prettierrc.json: .prettierignore excludes all Markdown",
      );
      expect(explained(root).effective.rules).toEqual(defaults(root));
    },
  );
  it("keeps markdownlint settings beside a Prettier configuration that leaves Markdown alone", async () => {
    const root = await fixture({
      ".markdownlint.json": '{ "default": false, "MD049": { "style": "asterisk" } }',
      ".prettierrc.json": '{ "proseWrap": "always" }',
      ".prettierignore": "**/*.md\n**/*.markdown\n",
      "a.md": "_text_\n",
    });
    const explanation = explained(root);
    expect(explanation.effective.rules["style/emphasis"]).toEqual(["error", { marker: "*" }]);
    expect(explanation.effective.rules).not.toHaveProperty("style/wrap");
    expect(explanation.effective.ignore).toEqual([]);
    const linted = run(root, ["lint"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toContain(
      "mdrefine: not using .prettierrc.json: .prettierignore excludes all Markdown",
    );
    expect(linted.stderr).toContain(
      "mdrefine: no mdrefine configuration; using markdownlint settings from .markdownlint.json (",
    );
    const converted = run(root, ["config", "convert"]);
    expect(converted.status, converted.stderr).toBe(0);
    expect(parseConfig(converted.stdout).rules).toEqual({
      "style/emphasis": ["error", { marker: "*" }],
    });
  });
  it.each([
    ["docs/*.md\n", ["docs/b.md"]],
    ["/*.md\n", ["a.md", "README.md"]],
    // Each entry ignores the sample names at some depths, and neither ignores README.md.
    ["?.md\n*-*.md\n", ["a.md", "docs/b.md"]],
  ])("still converts Prettier where %j leaves it some Markdown", async (text, ignored) => {
    const root = await fixture({
      ".prettierrc.json": '{ "proseWrap": "always" }',
      ".prettierignore": text,
      "a.md": "text\n",
      "README.md": "text\n",
      "docs/b.md": "text\n",
    });
    // Prettier formats at least one of the documents.
    const handled = [];
    for (const file of ["a.md", "README.md", "docs/b.md"])
      if (
        !(
          await getFileInfo(path.join(root, file), {
            ignorePath: path.join(root, ".prettierignore"),
          })
        ).ignored
      )
        handled.push(file);
    expect(handled.length).toBeGreaterThan(0);
    const explanation = explained(root, "docs/b.md");
    expect(explanation.effective.rules["style/wrap"]).toEqual(["warn", { width: 80 }]);
    const linted = run(root, ["lint", "--json"]);
    expect(linted.stderr).not.toContain("not using");
    expect(linted.stderr).toContain(
      "using Prettier settings from .prettierrc.json, .prettierignore",
    );
    // Without a negated entry, the ignore is converted as before.
    expect(
      parseReport(linted.stdout)
        .files.map((file) => file.path)
        .sort(),
    ).toEqual(["a.md", "docs/b.md", "README.md"].filter((file) => !ignored.includes(file)).sort());
  });
  it.each([
    ["**/*.md\n!docs/**/*.md\ndocs/*/*.md\n", "docs/README.md", "!docs/**/*.md"],
    ["**/*.md\n!**/README.md\n*/README.md\n", "README.md", "!**/README.md"],
    ["**/*.md\n!README.md\n", "README.md", "!README.md"],
    ["**/*.md\n!docs/\n", "docs/README.md", "!docs/"],
  ])(
    "keeps Prettier's settings, and checks every document, with the exception in %j",
    async (text, document, negated) => {
      const root = await fixture({
        ".prettierrc.json": '{ "proseWrap": "always", "printWidth": 60 }',
        ".prettierignore": text,
        [document]: "text",
        "other.md": "text\n",
      });
      const reference = await prettierResolve(path.join(root, document), { editorconfig: false });
      expect(reference).toEqual({ proseWrap: "always", printWidth: 60 });
      // Prettier applies the settings to the document, except where an exception has no effect.
      const info = await getFileInfo(path.join(root, document), {
        ignorePath: path.join(root, ".prettierignore"),
      });
      expect(info.ignored).toBe(negated === "!docs/");
      const explanation = explained(root, document);
      expect(explanation.effective.rules["style/wrap"]).toEqual(["warn", { width: 60 }]);
      expect(explanation.effective.ignore).toEqual([]);
      const conversion = (
        JSON.parse(run(root, ["config", "explain", document]).stdout) as {
          conversion: { sources: string[]; unused: unknown[] };
        }
      ).conversion;
      expect(conversion.sources).toEqual([path.join(root, ".prettierrc.json")]);
      const notice = `its negated entries (${negated}) cannot be converted, so none of its patterns apply and the documents it excludes are checked; "mdrefine config convert" reports them for manual migration`;
      expect(conversion.unused).toEqual([
        { file: path.join(root, ".prettierignore"), reason: notice },
      ]);
      // The fallback checks the documents and says why, also with --json.
      const linted = run(root, ["lint", "--json"]);
      expect(linted.status, linted.stderr).toBe(0);
      expect(
        parseReport(linted.stdout)
          .files.map((file) => file.path)
          .sort(),
      ).toEqual([document, "other.md"].sort());
      expect(linted.stderr.split("\n").filter(Boolean)).toEqual([
        `mdrefine: not using .prettierignore: ${notice}`,
        "mdrefine: no mdrefine configuration; using Prettier settings from .prettierrc.json (2 conversion note(s): mdrefine config explain <file>; opt out: --no-competitor-config)",
      ]);
      const checked = run(root, ["format", "--check"]);
      expect(checked.status).toBe(1);
      expect(checked.stderr).toContain(`\n${document}\n2 file(s) processed; 1 would change.\n`);
      // config convert still converts the other patterns and reports the negated entries.
      const converted = run(root, ["config", "convert"]);
      expect(converted.status, converted.stderr).toBe(0);
      expect(parseConfig(converted.stdout).ignore).toContain("**/*.md");
      expect(converted.stderr).toContain("mdrefine: converted .prettierignore\n");
      expect(converted.stderr).toContain(
        `mdrefine: .prettierignore: negated pattern ${negated} cannot be represented by independent ignore globs.\n`,
      );
      expect(converted.stderr).not.toContain("not using");
    },
  );
  it.each([
    [
      "a package key",
      {
        "package.json": '{ "prettier": "./shared.json" }',
        "shared.json": '{ "overrides": [{ "files": 7, "options": { "proseWrap": "always" } }] }',
      },
      "Invalid files in Prettier overrides[0] in shared.json (reached from package.json)",
    ],
    [
      "extends",
      {
        ".prettierrc.json": '{ "extends": "./base.json", "printWidth": 70 }',
        "base.json": '{ "overrides": [{ "files": "*.md", "options": 7 }] }',
      },
      "Expected a configuration object in the options of Prettier overrides[0] in base.json (reached from .prettierrc.json)",
    ],
    [
      "an extends chain from a package key",
      {
        "package.yaml": "prettier: ./shared.json\n",
        "shared.json": '{ "extends": "./base.json" }',
        "base.json": '{ "overrides": [7] }',
      },
      "Expected a configuration object in Prettier overrides[0] in base.json (reached from package.yaml)",
    ],
    [
      "the file itself",
      {
        ".prettierrc.json": '{ "extends": "./base.json", "overrides": [{ "files": [7] }] }',
        "base.json": '{ "overrides": [{ "files": "*.md", "options": {} }] }',
      },
      "Invalid files in Prettier overrides[0] in .prettierrc.json",
    ],
    [
      "a package key object",
      { "package.json": '{ "prettier": { "overrides": [{ "files": 7 }] } }' },
      "Invalid files in Prettier overrides[0] in package.json",
    ],
    [
      "markdownlint extends",
      {
        ".markdownlint.json": '{ "extends": "./base.json" }',
        "base.json": '{ "extends": "./deeper.yaml" }',
        "deeper.yaml": "- MD013\n",
      },
      "Expected a configuration object in deeper.yaml",
    ],
  ])(
    "names the file that holds an invalid setting reached through %s",
    async (_kind, files, message) => {
      const root = await fixture({ ...files, "a.md": "text\n" });
      for (const args of [["config", "convert"], ["lint"]]) {
        const result = run(root, args);
        expect(result.status).toBe(2);
        expect(result.stderr).toBe(`mdrefine: ${message}\n`);
      }
    },
  );
  it.each([
    ["prettier.config.mjs", "export default { proseWrap: 'never' };", "does not run JavaScript"],
    [".prettierrc.cjs", "module.exports = { proseWrap: 'never' };", "does not run JavaScript"],
    [".markdownlint.cjs", "module.exports = { default: false };", "does not run JavaScript"],
    [
      ".markdownlint-cli2.mjs",
      "export default { config: { default: false } };",
      "does not run JavaScript",
    ],
    [".prettierrc.toml", 'proseWrap = "never"\n', "TOML is not supported"],
    [".prettierrc.json5", "{ proseWrap: 'never' }", "JSON5 is not supported"],
  ])(
    "applies the defaults when %s is the only competitor configuration",
    async (name, text, why) => {
      const root = await fixture({ [name]: text, "a.md": messy });
      expect(explained(root).effective.rules).toEqual(defaults(root));
      const linted = run(root, ["lint", "--json"]);
      expect(linted.status, linted.stderr).toBe(0);
      // The recommended preset reports the trailing spaces, emphasis and list markers.
      expect(parseReport(linted.stdout).files[0]!.diagnostics.length).toBeGreaterThan(2);
      const notices = linted.stderr.split("\n").filter(Boolean);
      expect(notices).toHaveLength(2);
      expect(notices[0]).toMatch(
        new RegExp(`^mdrefine: not using ${name.replace(".", "\\.")}: .*${why}`),
      );
      if (why.includes("JavaScript"))
        expect(notices[0]).toContain('"mdrefine config convert" can convert it');
      expect(notices[1]).toContain(
        "the defaults apply (opt out of the search: --no-competitor-config)",
      );
      expect(run(root, ["lint", "--no-competitor-config"]).stderr).not.toContain("mdrefine:");
    },
  );
  it("applies a readable source next to an unreadable one, with the notice", async () => {
    const root = await fixture({
      ".markdownlint.json": '{ "default": false, "MD049": { "style": "asterisk" } }',
      "prettier.config.mjs": "export default { proseWrap: 'always' };",
      "a.md": "_text_\n",
    });
    const rules = explained(root).effective.rules;
    expect(rules["style/emphasis"]).toEqual(["error", { marker: "*" }]);
    expect(rules).not.toHaveProperty("style/wrap");
    const linted = run(root, ["lint"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toContain(
      "mdrefine: not using prettier.config.mjs: the fallback does not run",
    );
    expect(linted.stderr).toContain("using markdownlint settings from .markdownlint.json (");
    // The explicit command runs the script, and so converts both.
    const converted = parseConfig(run(root, ["config", "convert"]).stdout);
    expect(converted.rules?.["style/wrap"]).toEqual(["warn", { width: 80 }]);
  });
  it("does not let a package key that names a script turn on Prettier's choices", async () => {
    const root = await fixture({
      "package.json": '{ "prettier": "./shared.cjs" }',
      "shared.cjs": "module.exports = { proseWrap: 'always', printWidth: 60 };",
      "a.md": messy,
    });
    expect(explained(root).effective.rules).toEqual(defaults(root));
    expect(run(root, ["lint"]).stderr).toContain(
      "mdrefine: not using shared.cjs: the fallback does not run",
    );
    const converted = run(root, ["config", "convert"]);
    expect(converted.status, converted.stderr).toBe(0);
    expect(parseConfig(converted.stdout).rules?.["style/wrap"]).toEqual(["warn", { width: 60 }]);
  });
  it.each([
    [["config", "--config", "absent.json", "convert"], "--config"],
    [["config", "convert", "--config", "absent.json"], "--config"],
    [["config", "--dialect", "obsidian", "convert"], "--dialect"],
    [["config", "convert", "--dialect", "obsidian"], "--dialect"],
    [["config", "--no-competitor-config", "convert"], "--no-competitor-config"],
    [["config", "convert", "--no-competitor-config", "--write"], "--no-competitor-config"],
  ])("refuses %j as a usage error", async (args, option) => {
    const root = await fixture({
      ".prettierrc.json": '{ "proseWrap": "always" }',
      "a.md": "text\n",
    });
    const result = run(root, args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `mdrefine: config convert does not take ${option}: it reads only markdownlint and Prettier configurations. --config, --dialect, and --no-competitor-config are options of config explain.\n`,
    );
    expect(await exists(path.join(root, "mdrefine.config.jsonc"))).toBe(false);
  });
  it("keeps --config, --dialect and --no-competitor-config for config explain", async () => {
    const root = await fixture({
      ".prettierrc.json": '{ "proseWrap": "always" }',
      "own.json": '{ "extends": [], "rules": {} }',
      "a.md": "text\n",
    });
    for (const args of [
      ["config", "--config", "own.json", "explain", "a.md"],
      ["config", "explain", "a.md", "--config", "own.json"],
    ]) {
      const result = run(root, args);
      expect(result.status, result.stderr).toBe(0);
      expect(parseExplanation(result.stdout).effective.rules).toEqual({});
    }
    expect(explained(root).effective.dialect).toBe("github");
    expect(
      parseExplanation(run(root, ["config", "explain", "a.md", "--dialect", "obsidian"]).stdout)
        .effective.dialect,
    ).toBe("obsidian");

    expect(explained(root).effective.rules["style/wrap"]).toEqual(["warn", { width: 80 }]);
  });
  it.each([
    ["absent", "Workspace root does not exist"],
    [".prettierrc.json", "Workspace root is not a directory"],
  ])("validates config convert --root %s", async (given, message) => {
    const root = await fixture({ ".prettierrc.json": '{ "proseWrap": "always" }' });
    for (const args of [
      ["config", "convert", "--root", given],
      ["config", "convert", "--root", given, "--write"],
    ]) {
      const result = run(root, args);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`mdrefine: ${message}: ${path.join(root, given)}\n`);
    }
  });
  it.each([
    ["JSON", '{ "proseWrap": "always", "printWidth": 70 }'],
    ["JSON with a trailing comma", '{ "proseWrap": "always", "printWidth": 70, }'],
    ["JSON with comments", '{\n  // wrap\n  "proseWrap": "always",\n  "printWidth": 70\n}'],
    ["JSON with a block comment", '{\n  /* wrap */ "proseWrap": "always"\n}'],
    ["YAML", "proseWrap: always\nprintWidth: 70\n"],
  ])("reads an extensionless .prettierrc of %s as Prettier does", async (_kind, text) => {
    const root = await fixture({ ".prettierrc": text, "a.md": "text\n" });
    const reference = await prettierResolve(path.join(root, "a.md"), { editorconfig: false });
    const converted = run(root, ["config", "convert"]);
    expect(converted.status, converted.stderr).toBe(0);
    const wrap = parseConfig(converted.stdout).rules?.["style/wrap"];
    if (reference?.proseWrap === "always")
      expect(wrap).toEqual(["warn", { width: reference.printWidth ?? 80 }]);
    else expect(wrap).toBeUndefined();
    // A comment that Prettier's YAML reading joins to a key is named as such, with the file.
    const joined = Object.keys(reference ?? {}).filter((key) => /^\s*\/[/*]/.test(key));
    for (const key of joined)
      expect(converted.stderr).toContain(
        `mdrefine: .prettierrc: ${JSON.stringify(key)} is not a Prettier option: Prettier reads this file as YAML`,
      );
    expect(converted.stderr).not.toContain("no Markdown mapping");
  });
  it("names the competitor file that cannot be read", async () => {
    const yamlError = await fixture({ ".prettierrc": "proseWrap: [always\n", "a.md": "text\n" });
    await expect(prettierResolve(path.join(yamlError, "a.md"))).rejects.toThrow("YAML Error");
    const result = run(yamlError, ["lint"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      /^mdrefine: Invalid competitor YAML in \.prettierrc: .*; use --no-competitor-config to bypass conversion\.\n$/,
    );
    expect(run(yamlError, ["lint", "--no-competitor-config"]).status).toBe(0);
    const scalar = await fixture({ ".markdownlint.yaml": "true\n", "a.md": "text\n" });
    expect(run(scalar, ["lint"]).stderr).toBe(
      "mdrefine: Expected a configuration object in .markdownlint.yaml\n",
    );
    const missing = await fixture({ ".markdownlint.json": '{ "extends": "absent-package" }' });
    expect(run(missing, ["lint"]).stderr).toBe(
      'mdrefine: Cannot resolve "absent-package" named in .markdownlint.json; use --no-competitor-config to bypass conversion.\n',
    );
  });
  it("names the configuration file of a rule setting that cannot be used", async () => {
    const own = await fixture({
      "mdrefine.config.json": '{ "rules": { "style/wrap": ["warn", { "width": "wide" }] } }',
      "a.md": "text\n",
    });
    const result = run(own, ["lint"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      `mdrefine: Invalid configuration in ${path.join(own, "mdrefine.config.json")}: Invalid options for style/wrap: "width" must be an integer, not "wide"\n`,
    );
    const override = await fixture({
      "mdrefine.config.json":
        '{ "overrides": [{ "files": ["docs/**"], "rules": { "style/nope": "warn" } }] }',
      "docs/a.md": "text\n",
    });
    const named = run(override, [
      "config",
      "--config",
      "mdrefine.config.json",
      "explain",
      "docs/a.md",
    ]);
    expect(named.status).toBe(0);
    expect(run(override, ["lint", "--config", "mdrefine.config.json"]).stderr).toBe(
      "mdrefine: Invalid configuration in mdrefine.config.json: Unknown rule: style/nope\n",
    );
    // Other errors are not attributed to the configuration.
    expect(run(override, ["lint", "absent.md"]).stderr).toBe(
      "mdrefine: Input does not exist: absent.md\n",
    );
  });
  it("prints one concise notice per source, relative to the workspace, and none with --quiet", async () => {
    const root = await fixture({
      ".markdownlint.json": '{ "default": false, "MD049": { "style": "asterisk" }, "MD999": true }',
      ".prettierrc.json": '{ "semi": false }',
      ".prettierignore": "generated/\n",
      "prettier.config.cjs": "module.exports = {};",
      "docs/a.md": "_text_\n",
    });
    const docs = path.join(root, "docs");
    const linted = run(docs, ["lint", "--json"]);
    const lines = linted.stderr.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^mdrefine: no mdrefine configuration; using markdownlint and Prettier settings from \.markdownlint\.json, \.prettierrc\.json, \.prettierignore \(\d+ conversion note\(s\): mdrefine config explain <file>; opt out: --no-competitor-config\)$/,
    );
    expect(linted.stderr).not.toContain(root);
    parseReport(linted.stdout);
    const quiet = run(docs, ["lint", "--json", "--quiet"]);
    expect(quiet.stderr).toBe("");
    expect(parseReport(quiet.stdout).files).toHaveLength(1);
    expect(run(docs, ["format", "--check", "--quiet"]).stderr).not.toContain("mdrefine:");
    // The details are in config explain.
    const conversion = (
      JSON.parse(run(docs, ["config", "explain", "a.md"]).stdout) as {
        conversion: { sources: string[]; unused: unknown[]; omitted: string[] };
      }
    ).conversion;
    expect(conversion.sources).toEqual(
      [".markdownlint.json", ".prettierrc.json", ".prettierignore"].map((name) =>
        path.join(root, name),
      ),
    );
    expect(conversion.unused).toEqual([]);
    expect(conversion.omitted).toEqual(
      expect.arrayContaining([
        "markdownlint md999: unknown rule or option; requires manual migration.",
        ".prettierignore: Prettier matches its patterns without regard to letter case; the converted patterns match case exactly.",
      ]),
    );
  });
  it("creates the configuration where lint finds it and prints its path", async () => {
    const root = await fixture({
      ".prettierrc.json": '{ "proseWrap": "always", "printWidth": 60 }',
      "docs/deep/a.md": "text\n",
    });
    const deep = path.join(root, "docs", "deep");
    const before = explained(deep);
    const written = run(deep, ["config", "convert", "--write"]);
    expect(written.status, written.stderr).toBe(0);
    expect(written.stdout).toBe("");
    expect(written.stderr.split("\n").filter(Boolean).at(-1)).toBe(
      "mdrefine: created ../../mdrefine.config.jsonc",
    );
    expect(written.stderr).toContain("mdrefine: converted .prettierrc.json\n");
    const after = explained(deep);
    expect(after.config).toBe(path.join(root, "mdrefine.config.jsonc"));
    expect(after.root).toBe(before.root);
    expect(after.effective).toEqual(before.effective);
    expect(run(root, ["lint"]).stderr).not.toContain("no mdrefine configuration");
    // A second run finds the configuration that it created, from any directory.
    for (const directory of [deep, root]) {
      const again = run(directory, ["config", "convert", "--write"]);
      expect(again.status).toBe(2);
      expect(again.stderr).toContain("Existing mdrefine configuration:");
    }
    // Printing still works, so a configuration can be compared with a new conversion.
    expect(run(deep, ["config", "convert"]).status).toBe(0);
  });
});
