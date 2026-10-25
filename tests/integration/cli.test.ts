import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../../src/workspace/files.js";
import { cli, fixture, manifest, run, tree } from "../support/cli.js";
import { parseExplanation, parseReport } from "../support/json.js";
describe("CLI", () => {
  it.each([undefined, { extends: ["recommended"] }])(
    "warns about missing block spacing, explains it, and formats it with configuration %j (#423)",
    async (config) => {
      const source = "# Setup\nInstall the package.\n- Run the command.\n";
      const root = await fixture({
        "note.md": source,
        ...(config ? { "mdrefine.config.json": JSON.stringify(config) } : {}),
      });
      const explained = run(root, ["config", "explain", "note.md"]);
      expect(explained.status, explained.stderr).toBe(0);
      expect(parseExplanation(explained.stdout).effective.rules["style/block-spacing"]).toBe(
        "warn",
      );
      const checked = run(root, ["lint", "--json", "."]);
      expect(checked.status, checked.stderr).toBe(0);
      expect(parseReport(checked.stdout).files[0]!.diagnostics).toMatchObject([
        { rule: "style/block-spacing", severity: "warn" },
        { rule: "style/block-spacing", severity: "warn" },
      ]);
      expect(run(root, ["lint", "--max-warnings", "0", "."]).status).toBe(1);
      expect(run(root, ["format", "--check", "."]).status).toBe(1);
      const applied = run(root, ["format", "--write", "."]);
      expect(applied.status, applied.stderr).toBe(0);
      expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(
        "# Setup\n\nInstall the package.\n\n- Run the command.\n",
      );
      expect(run(root, ["format", "--check", "."]).status).toBe(0);
      await writeFile(path.join(root, "note.md"), source);
      await writeFile(
        path.join(root, "mdrefine.config.json"),
        JSON.stringify({ ...config, rules: { "style/block-spacing": "off" } }),
      );
      expect(run(root, ["lint", "--max-warnings", "0", "."]).status).toBe(0);
      expect(run(root, ["format", "--check", "."]).status).toBe(0);
      expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(source);
    },
  );
  it("previews, writes, then verifies formatting without changing unrelated syntax", async () => {
    const root = await fixture({ "note.md": "A *small* note.\n" });
    const preview = run(root, ["format", "."]);
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain("+A _small_ note.");
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A *small* note.\n");
    expect(run(root, ["format", "--check", "."]).status).toBe(1);
    const applied = run(root, ["format", "--write", "."]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A _small_ note.\n");
    expect(run(root, ["format", "--check", "."]).status).toBe(0);
  });
  it("provides clean JSON diagnostics and meaningful exit statuses", async () => {
    const root = await fixture({ "note.md": "[bad](missing.md)\n" });
    const checked = run(root, ["lint", "--json", "."]);
    expect(checked.status).toBe(1);
    expect(parseReport(checked.stdout).files[0]!.diagnostics[0]!.rule).toBe("links/valid");
    expect(checked.stderr).toBe("");
    expect(run(root, ["lint", "--dialect", "typo", "."]).status).toBe(2);
  });
  it("accepts the Forgejo dialect and its Codeberg alias", async () => {
    const root = await fixture({
      "mdrefine.config.jsonc": '{ "extends": ["recommended", "codeberg"] }',
      "note.md": "# Test.0.1\n\n[link](#test-0-1)\n\nTerm\n: Definition\n",
    });
    const checked = run(root, ["lint", "--json", "."]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(run(root, ["format", "--check", "."]).status).toBe(0);
    expect(run(root, ["lint", "--dialect", "github", "."]).status).toBe(1);
    const explained = run(root, ["config", "explain", "note.md"]);
    expect(parseExplanation(explained.stdout).effective.dialect).toBe("forgejo");
    const aliased = run(root, ["lint", "--dialect", "codeberg", "--json", "."]);
    expect(aliased.status, aliased.stderr).toBe(0);
  });
  it("accepts the Gitea dialect", async () => {
    const root = await fixture({
      "mdrefine.config.jsonc": '{ "extends": ["recommended", "gitea"] }',
      "note.md": "# Test.0.1\n\n[link](#test01)\n\nTerm\n: Definition\n\nSee __init__.py.\n",
    });
    const checked = run(root, ["lint", "--json", "."]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(run(root, ["format", "--check", "."]).status).toBe(0);
    expect(run(root, ["lint", "--dialect", "forgejo", "."]).status).toBe(1);
    const explained = run(root, ["config", "explain", "note.md"]);
    expect(parseExplanation(explained.stdout).effective.dialect).toBe("gitea");
  });
  it("loads JSONC, applies path overrides, and explains configuration", async () => {
    const root = await fixture({
      "mdrefine.config.jsonc":
        '{ // comment\n "rules": {"style/emphasis": "off"}, "overrides": [{"files": ["vault/**"], "dialect": "obsidian"}], }',
      "vault/a.md": "*keep*\n",
    });
    expect(run(root, ["format", "--check", "vault"]).status).toBe(0);
    const explained = run(root, ["config", "explain", "vault/a.md"]);
    expect(explained.status, explained.stderr).toBe(0);
    expect(parseExplanation(explained.stdout).effective.dialect).toBe("obsidian");
  });
  it("loads a custom JavaScript rule and preset", async () => {
    const root = await fixture({
      "mdrefine.config.mjs":
        'export default {extends:["local/recommended"],plugins:["./plugin.mjs"]};',
      "plugin.mjs":
        'export default {name:"local",presets:{recommended:{rules:{"local/report":"error"}}},rules:{report:{kind:"problem",description:"Example",check:()=>[{start:0,message:"Custom diagnostic"}]}}};',
      "note.md": "A note.\n",
    });
    const checked = run(root, ["lint", "."]);
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain("local/report: Custom diagnostic");
  });
  it("supports stdin with source-path context and no stdout diagnostics", async () => {
    const root = await fixture({ "target.md": "# Target\n" });
    const checked = run(root, ["format", "-", "--stdin-filepath", "note.md"], "A *small* note.\n");
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toBe("A _small_ note.\n");
    expect(run(root, ["format", "-", "--write"], "text").status).toBe(2);
  });
  it("honors ignore patterns without removing ignored documents from the link index", async () => {
    const root = await fixture({
      "mdrefine.config.json": '{"ignore":["copied/**"]}',
      "note.md": "[copy](copied/file.md)\n",
      "copied/file.md": "*copied*\n",
      ".gitignore": "generated/\n",
      "generated/a.md": "*generated*\n",
      "child/.git/HEAD": "ref: refs/heads/main",
      "child/a.md": "*child*\n",
    });
    const result = run(root, ["lint", "--json", "."]);
    expect(result.status, result.stderr).toBe(0);
    expect(parseReport(result.stdout).files.map((file: { path: string }) => file.path)).toEqual([
      "note.md",
    ]);
  });
  it("matches configuration patterns with their letter case on every system", async () => {
    // .gitignore files and input patterns ignore case on Windows and macOS; a configuration,
    // which every system shares, selects the same files everywhere.
    const root = await fixture({
      "mdrefine.config.json": JSON.stringify({
        ignore: ["drafts/**", "skip/**"],
        overrides: [{ files: ["notes/**", "other/**"], rules: { "style/emphasis": "off" } }],
      }),
      "Drafts/a.md": "A note.\n",
      "skip/b.md": "A note.\n",
      "Notes/c.md": "A *note*.\n",
      "other/d.md": "A *note*.\n",
    });
    const result = run(root, ["lint", "--json"]);
    const report = parseReport(result.stdout) as {
      files: { path: string; diagnostics: { rule: string }[] }[];
    };
    expect(report.files.map((file) => file.path)).toEqual([
      "Drafts/a.md",
      "Notes/c.md",
      "other/d.md",
    ]);
    const rules = report.files.map((file) => [
      ...new Set(file.diagnostics.map(({ rule }) => rule)),
    ]);
    expect(rules).toEqual([[], ["style/emphasis"], []]);
  });
  it("indexes ignored and nested targets only when opted in, without selecting them", async () => {
    const root = await fixture({
      "mdrefine.config.json": JSON.stringify({
        extends: ["recommended", "obsidian"],
        resolve: { gitIgnored: true, nestedRepositories: true },
      }),
      ".obsidian/app.json": '{"strictLineBreaks":true}',
      ".gitignore": "Ignored/\n",
      "Doc.md":
        "[I](Ignored/Note.md#Heading) and [N](Nested/Note.md#^id) and [A](Ignored/image.png)\n",
      "Ignored/Note.md": "# Heading\n\n*untouched*\n",
      "Ignored/image.png": "image",
      "Nested/.git": "gitdir: elsewhere",
      "Nested/Note.md": "A block. ^id\n\n*untouched*\n",
    });
    const checked = run(root, ["lint", "--json", "Doc.md"]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(parseReport(checked.stdout).files.map((file: { path: string }) => file.path)).toEqual([
      "Doc.md",
    ]);
    const applied = run(root, ["format", "--write", "--json"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(parseReport(applied.stdout).files.map((file: { path: string }) => file.path)).toEqual([
      "Doc.md",
    ]);
    expect(await readFile(path.join(root, "Ignored/Note.md"), "utf8")).toContain("*untouched*");
    expect(await readFile(path.join(root, "Nested/Note.md"), "utf8")).toContain("*untouched*");
    const defaults = await discover(root, [path.join(root, "Doc.md")], []);
    expect(defaults.files["Ignored/Note.md"]).toBeUndefined();
    expect(defaults.files["Nested/Note.md"]).toBeUndefined();
    const ignoredOnly = await discover(root, [], [], { gitIgnored: true });
    expect(ignoredOnly.files["Ignored/Note.md"]).toBeDefined();
    expect(ignoredOnly.files["Nested/Note.md"]).toBeUndefined();
    const nestedOnly = await discover(root, [], [], { nestedRepositories: true });
    expect(nestedOnly.files["Nested/Note.md"]).toBeDefined();
    expect(nestedOnly.files["Ignored/Note.md"]).toBeUndefined();
  });
  it("diagnoses empty directories as directories in Obsidian", async () => {
    const root = await fixture({ "Doc.md": "[folder](Empty)\n" });
    await mkdir(path.join(root, "Empty"));
    const checked = run(root, ["lint", "--dialect", "obsidian", "Doc.md"]);
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain("Local target is a directory: Empty.");
  });
  it("checks Obsidian settings and resolves block references on disk", async () => {
    const root = await fixture({
      "mdrefine.config.json": '{"extends":["recommended","obsidian"]}',
      ".obsidian/app.json": '{"strictLineBreaks":true}',
      "note.md": "[[target#^id]]\n",
      "target.md": "A block. ^id\n",
    });
    expect(run(root, ["lint", "."]).status).toBe(0);
  });
  it("wraps a direct callout body on disk while retaining its header", async () => {
    const header =
      "> [!info]- A callout title that must remain entirely on its original physical line\n";
    const source = `${header}> A body line that is long enough to be reflowed by the wrapper, so it should wrap.\n`;
    const root = await fixture({
      "mdrefine.config.json": JSON.stringify({
        extends: ["recommended", "obsidian"],
        rules: {
          "style/wrap": ["warn", { width: 60, reportUnreflowed: true, reportUnbreakable: true }],
        },
      }),
      ".obsidian/app.json": '{"strictLineBreaks":true}',
      "note.md": source,
    });
    const preview = run(root, ["format", "--json", "note.md"]);
    expect(preview.status, preview.stderr).toBe(0);
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(source);
    const applied = run(root, ["format", "--write", "--json", "note.md"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(
      `${header}> A body line that is long enough to be reflowed by the\n> wrapper, so it should wrap.\n`,
    );
    const findings = parseReport(applied.stdout).files[0]!.diagnostics;
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(1);
    expect(findings[0]!.message).toContain("unbreakable atom");
    expect(run(root, ["format", "--check", "note.md"]).status).toBe(0);
  });
  it("writes the other documents, and the checked result of one, when a rule's edits are refused", async () => {
    const root = await fixture({
      "mdrefine.config.json": '{"plugins":["./plugin.mjs"],"rules":{"local/bad":"warn"}}',
      "plugin.mjs":
        'export default {name:"local",rules:{bad:{kind:"style",description:"Bad",check:({document})=>document.source.startsWith("bad")?[{start:0,message:"Bad",edit:{start:0,end:3,text:"different"}}]:[]}}};',
      "a.md": "*fine*\n",
      "b.md": "bad *word*\n",
    });
    const written = run(root, ["format", "--write", "."]);
    expect(written.status).toBe(2);
    expect(written.stderr).toContain(
      "b.md:1:1: error engine/unsafe-format: local/bad would change the parsed meaning at line 1; none of its edits were applied.\n",
    );
    expect(written.stderr).toContain("2 file(s) processed; 2 written.\n");
    // The refused rule's edit is left out; the other rules' edits are written.
    expect(await tree(root)).toMatchObject({ "a.md": "_fine_\n", "b.md": "bad _word_\n" });
  });
  it("refuses a blank line where the parser misreads a task item", async () => {
    // The parser gives the document the checked state of `[x]` below an empty
    // list item, and a blank line between them would change what it reads.
    // The unit tests cannot parse this: the development build of the parser
    // asserts that the state belongs to an item.
    const source = "-\n[x] item\n";
    const root = await fixture({
      "mdrefine.config.json": '{"dialect":"github","rules":{"style/block-spacing":"warn"}}',
      "a.md": source,
    });
    const written = run(root, ["format", "--write", "a.md"]);
    expect(written.status).toBe(2);
    expect(written.stderr).toContain(
      "a.md:1:1: error engine/unsafe-format: style/block-spacing would change the parsed meaning at line 1; none of its edits were applied.\n",
    );
    expect(await readFile(path.join(root, "a.md"), "utf8")).toBe(source);
  });
  it("reports a rule that fails for its file and writes every changed document", async () => {
    const root = await fixture({
      "mdrefine.config.json": '{"plugins":["./plugin.mjs"],"rules":{"local/fragile":"warn"}}',
      "plugin.mjs":
        'export default {name:"local",rules:{fragile:{kind:"problem",description:"Fragile",check:({document})=>{if(document.source.includes("boom"))throw new Error("boom");return[{start:0,message:"Checked"}];}}}};',
      "a.md": "boom *word*\n",
      "b.md": "*fine*\n",
    });
    const failure =
      "a.md:1:1: error engine/rule-error: Rule local/fragile failed (Error: boom); the rule was skipped for this document.\n";
    const linted = run(root, ["lint", "."]);
    expect(linted.status).toBe(2);
    expect(linted.stderr).toContain(failure);
    expect(linted.stderr).toContain("b.md:1:1: warn local/fragile: Checked\n");
    expect(linted.stderr).toContain("2 file(s) linted; 1 error(s), 5 warning(s).\n");
    const written = run(root, ["format", "--write", "--json", "."]);
    expect(written.status).toBe(2);
    const report = parseReport(written.stdout) as {
      written: string[];
      files: { path: string; changed: boolean; diagnostics: { rule: string }[] }[];
    };
    expect(report.written).toEqual(["a.md", "b.md"]);
    expect(
      report.files.map((file) => [file.path, file.changed, file.diagnostics[0]?.rule]),
    ).toEqual([
      ["a.md", true, "engine/rule-error"],
      ["b.md", true, "local/fragile"],
    ]);
    expect(await tree(root)).toMatchObject({ "a.md": "boom _word_\n", "b.md": "_fine_\n" });
  });
  it("stops at a plugin rule that does not have the shape of a rule", async () => {
    const root = await fixture({
      "mdrefine.config.json": '{"plugins":["./plugin.mjs"],"rules":{"local/case":"warn"}}',
      "plugin.mjs":
        'export default {name:"local",rules:{case:{kind:"style",phase:"Inline",description:"Case",check:()=>[{start:0,message:"Case",edit:{start:0,end:1,text:"T"}}]}}};',
      "a.md": "text\n",
    });
    const checked = run(root, ["format", "--check", "."]);
    expect(checked.status).toBe(2);
    expect(checked.stderr).toBe(
      'mdrefine: Invalid rule local/case: its phase is "Inline", not "inline", "block", or "document".\n',
    );
  });
  it("applies literal exclusions without removing link targets", async () => {
    const root = await fixture({
      "note.md": "[target](folder/target.md)\n",
      "folder/target.md": "*target*\n",
      "folder-extra.md": "Text.\n",
    });
    const selected = run(root, [
      "lint",
      "--json",
      "--exclude",
      "folder",
      "--exclude",
      "not-created/note.md",
    ]);
    expect(selected.status, selected.stderr).toBe(0);
    expect(parseReport(selected.stdout).files.map((file: { path: string }) => file.path)).toEqual([
      "folder-extra.md",
      "note.md",
    ]);
    expect(run(root, ["lint", "--exclude", "../outside"]).status).toBe(2);
    expect(run(root, ["lint", "--exclude", "note.md", "-"], "text").status).toBe(2);
  });
  it("fails when warnings exceed --max-warnings and rejects invalid counts", async () => {
    const root = await fixture({ "note.md": "A *small* note.\n" });
    expect(run(root, ["lint", "."]).status).toBe(0);
    expect(run(root, ["lint", "--max-warnings", "2", "."]).status).toBe(0);
    const exceeded = run(root, ["lint", "--max-warnings", "1", "."]);
    expect(exceeded.status).toBe(1);
    expect(exceeded.stderr).toContain("style/emphasis");
    expect(run(root, ["lint", "--max-warnings", "0", "."]).status).toBe(1);
    for (const value of ["-1", "1.5", "many"]) {
      const rejected = run(root, ["lint", "--max-warnings", value, "."]);
      expect(rejected.status, value).toBe(2);
      expect(rejected.stderr).toContain("--max-warnings must be a nonnegative integer.");
    }
  });
  it("refuses ambiguous configuration files unless one is chosen explicitly", async () => {
    const root = await fixture({
      "mdrefine.config.json": '{"rules":{"style/emphasis":"off"}}',
      "mdrefine.config.jsonc": '{"rules":{"style/emphasis":"warn"}}',
      "note.md": "*keep*\n",
    });
    const ambiguous = run(root, ["format", "--check", "."]);
    expect(ambiguous.status).toBe(2);
    expect(ambiguous.stderr).toContain("Multiple mdrefine configuration files");
    expect(run(root, ["format", "--check", "--config", "mdrefine.config.json", "."]).status).toBe(
      0,
    );
    expect(run(root, ["format", "--check", "--config", "mdrefine.config.jsonc", "."]).status).toBe(
      1,
    );
  });
  it("rejects inputs outside the workspace and paths that do not exist", async () => {
    const root = await fixture({ "note.md": "Text.\n", "sub/inner.md": "Text.\n" });
    const outside = run(root, ["lint", "--root", "sub", "note.md"]);
    expect(outside.status).toBe(2);
    expect(outside.stderr).toContain("Input is outside the workspace: note.md");
    const missing = run(root, ["lint", "absent.md"]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("absent.md");
    expect(run(root, ["lint", "--root", "sub", "sub/inner.md"]).status).toBe(0);
  });
  it("ships an executable CLI entry point", () => {
    expect(execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim()).toBe(
      manifest.version,
    );
  });
});
