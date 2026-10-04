import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse, semanticFingerprint } from "../../src/index.js";
import type { Diagnostic } from "../../src/index.js";
import { fixture, manifest, run, tree } from "./support.js";

interface Report {
  version: string;
  mode: string;
  written: boolean;
  files: { path: string; changed?: boolean; output?: string; diagnostics: Diagnostic[] }[];
}
const report = (stdout: string) => JSON.parse(stdout) as Report;

describe("a repository with an embedded vault", () => {
  const files = {
    "mdtools.config.jsonc": `{
      "extends": ["recommended", "github"],
      "overrides": [{ "files": ["vault/**"], "dialect": "obsidian", "rules": { "obsidian/callout-marker": "warn" } }],
    }`,
    "docs/guide.md":
      "# Guide\n\n> [!tip]\n> Read the [vault note](../vault/Note.md#a-heading) too.\n\n## Install Steps\n\nText.\n",
    "vault/Note.md":
      "# Note\n\n> [!TIP]\n> See [[guide#Install Steps]] and the *guide*.\n\n## A Heading\n\nA long line in the vault that goes past eighty columns and stays as written outside a verified vault.\n",
  };
  it("applies each dialect's rules to its own files and resolves links across them", async () => {
    const root = await fixture(files);
    const applied = run(root, ["format", "--write", "--json"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(report(applied.stdout).files.flatMap((file) => file.diagnostics)).toEqual([]);
    // GitHub alerts are uppercase and Obsidian callouts lowercase; each file gets its own.
    expect(await readFile(path.join(root, "docs/guide.md"), "utf8")).toBe(
      files["docs/guide.md"].replace("[!tip]", "[!TIP]"),
    );
    // Reflow needs Obsidian's strict line breaks, which only a vault root can verify.
    expect(await readFile(path.join(root, "vault/Note.md"), "utf8")).toBe(
      files["vault/Note.md"].replace("[!TIP]", "[!tip]").replace("*guide*", "_guide_"),
    );
    expect(run(root, ["lint", "--max-warnings", "0"]).status).toBe(0);
  });
  it("validates a fragment by the dialect of the document that links to it", async () => {
    const root = await fixture({
      ...files,
      // A GitHub document needs the slug; an Obsidian note needs the heading text.
      "docs/wrong.md": "[note](../vault/Note.md#A%20Heading)\n",
      "vault/Wrong.md": "[[guide#install-steps]]\n",
    });
    const checked = run(root, ["lint", "--json"]);
    expect(checked.status).toBe(1);
    expect(
      report(checked.stdout).files.flatMap((file) =>
        file.diagnostics.map((item) => `${file.path} ${item.rule}`),
      ),
    ).toEqual(expect.arrayContaining(["docs/wrong.md links/valid", "vault/Wrong.md links/valid"]));
  });
});

describe("line endings and file names", () => {
  it("keeps CRLF line endings through a write and stays stable afterwards", async () => {
    const source =
      "# Title\r\n\r\nA *small* paragraph that is long enough to need wrapping at the default width of eighty columns.\r\n\r\n| a | b |\r\n|---|---|\r\n| long cell | c |\r\n";
    const root = await fixture({
      "mdtools.config.jsonc": '{ "extends": ["recommended", "github"] }',
      "note.md": source,
    });
    const applied = run(root, ["format", "--write", "--json"]);
    expect(applied.status, applied.stderr).toBe(0);
    const output = await readFile(path.join(root, "note.md"), "utf8");
    expect(output).toBe(
      "# Title\r\n\r\nA _small_ paragraph that is long enough to need wrapping at the default width of\r\neighty columns.\r\n\r\n| a         | b   |\r\n| --------- | --- |\r\n| long cell | c   |\r\n",
    );
    expect(output.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    expect(semanticFingerprint(parse(output, "github"))).toBe(
      semanticFingerprint(parse(source, "github")),
    );
    expect(run(root, ["format", "--check"]).status).toBe(0);
  });
  it("resolves and rewrites links to files with spaces and non-ASCII names", async () => {
    const root = await fixture({
      "mdtools.config.jsonc": `{
        "extends": ["recommended", "github"],
        "rules": { "links/path": ["warn", { "style": "relative", "leadingDot": true }] },
      }`,
      "index.md":
        "[plan](<Résumé notes/Plan B.md#zeitplan-für-2026>) and [encoded](R%C3%A9sum%C3%A9%20notes/Plan%20B.md)\n",
      "Résumé notes/Plan B.md":
        "# Plan B\n\n## Zeitplan für 2026\n\nBack to the [index](../index.md).\n",
    });
    const checked = run(root, ["lint", "--json"]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(report(checked.stdout).files.map((file) => file.path)).toEqual([
      "Résumé notes/Plan B.md",
      "index.md",
    ]);
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(await readFile(path.join(root, "index.md"), "utf8")).toBe(
      // A rewritten destination is spelled with literal characters; only spaces are encoded.
      "[plan](<./Résumé notes/Plan B.md#zeitplan-für-2026>) and\n[encoded](./Résumé%20notes/Plan%20B.md)\n",
    );
    expect(run(root, ["lint", "--max-warnings", "0"]).status).toBe(0);
  });
});

describe("selecting files", () => {
  const files = {
    "mdtools.config.jsonc": '{ "extends": ["recommended", "github"] }',
    "README.md": "# Project\n\nSee the [guide](docs/guide.md).\n",
    "docs/guide.md": "# Guide\n\nBack to the [project](../README.md#project), *really*.\n",
    "docs/other.md": "An *unselected* file.\n",
    "-draft.md": "A *draft* whose name starts with a hyphen.\n",
  };
  it("finds the configuration and workspace from a subdirectory", async () => {
    const root = await fixture(files);
    const checked = run(path.join(root, "docs"), ["lint", "--json", "guide.md"]);
    expect(checked.status, checked.stderr).toBe(0);
    const [file, ...rest] = report(checked.stdout).files;
    expect(rest).toEqual([]);
    // Paths are relative to the workspace root, and the link to its README resolves.
    expect(file!.path).toBe("docs/guide.md");
    expect(file!.diagnostics.map((item) => item.rule)).toEqual([
      "style/emphasis",
      "style/emphasis",
    ]);
  });
  it("processes only the files a hook passes while resolving links in the whole workspace", async () => {
    const root = await fixture(files);
    const applied = run(root, [
      "format",
      "--write",
      "--json",
      "--root",
      ".",
      "--",
      "-draft.md",
      "docs/guide.md",
    ]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(report(applied.stdout).files.map((file) => [file.path, file.changed])).toEqual([
      ["-draft.md", true],
      ["docs/guide.md", true],
    ]);
    expect(await readFile(path.join(root, "docs/other.md"), "utf8")).toBe(files["docs/other.md"]);
    expect(await readFile(path.join(root, "docs/guide.md"), "utf8")).toContain("_really_");
  });
});

describe("reports for scripts and agents", () => {
  it("describes every diagnostic with a rule, a severity, and a position in the source", async () => {
    const source = "Text 😀 with *emphasis* and a [missing link](absent.md).\n";
    const root = await fixture({ "note.md": source });
    const linted = run(root, ["lint", "--json"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toBe("");
    const result = report(linted.stdout);
    expect(Object.keys(result)).toEqual(["version", "mode", "files", "written"]);
    expect(result).toMatchObject({ version: manifest.version, mode: "lint", written: false });
    expect(Object.keys(result.files[0]!)).toEqual(["path", "diagnostics"]);
    const [opening, closing, missing, ...rest] = result.files[0]!.diagnostics;
    expect(rest).toEqual([]);
    // Offsets and columns count UTF-16 units, so the emoji before the marker counts twice.
    expect(opening).toEqual({
      rule: "style/emphasis",
      severity: "warn",
      message: 'Use "_" for emphasis.',
      start: source.indexOf("*"),
      end: source.indexOf("*") + 1,
      line: 1,
      column: 14,
      edit: { start: 13, end: 14, text: "_" },
    });
    expect(closing).toMatchObject({ rule: "style/emphasis", column: 23 });
    expect(missing).toMatchObject({
      rule: "links/valid",
      severity: "error",
      message: "Missing local target: absent.md.",
      line: 1,
      column: source.indexOf("[missing") + 1,
    });
    expect(missing).not.toHaveProperty("edit");
  });
  it("marks changed files and whether a write happened in format reports", async () => {
    const root = await fixture({ "a.md": "A *note*.\n", "b.md": "A _note_.\n" });
    const previewed = report(run(root, ["format", "--json"]).stdout);
    expect(previewed).toMatchObject({ mode: "format", written: false });
    expect(previewed.files).toEqual([
      { path: "a.md", changed: true, diagnostics: [] },
      { path: "b.md", changed: false, diagnostics: [] },
    ]);
    expect(report(run(root, ["format", "--write", "--json"]).stdout).written).toBe(true);
    const stdin = report(run(root, ["format", "-", "--json"], "A *note*.\n").stdout);
    expect(stdin.files).toEqual([
      { path: "stdin.md", changed: true, diagnostics: [], output: "A _note_.\n" },
    ]);
  });
  it("keeps results on stdout and diagnostics on stderr without --json", async () => {
    const root = await fixture({ "note.md": "A *note* with a [missing link](absent.md).\n" });
    const linted = run(root, ["lint"]);
    expect(linted.stdout).toBe("");
    expect(linted.stderr).toBe(
      'note.md:1:3: warn style/emphasis: Use "_" for emphasis.\n' +
        'note.md:1:8: warn style/emphasis: Use "_" for emphasis.\n' +
        "note.md:1:17: error links/valid: Missing local target: absent.md.\n" +
        "1 file(s) linted; 0 would change.\n",
    );
    const previewed = run(root, ["format", "--diff"]);
    expect(previewed.stdout).toContain("--- a/note.md\n+++ b/note.md\n");
    expect(previewed.stdout).toContain(
      "-A *note* with a [missing link](absent.md).\n+A _note_ with",
    );
    expect(previewed.stderr).toBe(
      "note.md:1:17: error links/valid: Missing local target: absent.md.\n" +
        "1 file(s) processed; 1 would change.\n",
    );
    expect(run(root, ["format", "--check"]).stdout).toBe("");
  });
});

describe("plugins installed as packages", () => {
  const plugin = (name: string) =>
    `export default {name:"${name}",rules:{report:{kind:"problem",description:"Example",check:()=>[{start:0,message:"From ${name}"}]}}};`;
  const config = (specifier: string, name: string) =>
    JSON.stringify({ plugins: [specifier], rules: { [`${name}/report`]: "warn" } });
  it.each([
    ["a main field", "sample-plugin", { main: "index.js" }],
    ["a string exports field", "sample-plugin", { exports: "./index.js" }],
    ["a scoped name", "@scope/sample-plugin", { exports: { ".": { default: "./index.js" } } }],
  ])("loads a plugin package that declares %s", async (_label, specifier, fields) => {
    const root = await fixture({
      "mdtools.config.json": config(specifier, "sample"),
      [`node_modules/${specifier}/package.json`]: JSON.stringify({
        name: specifier,
        type: "module",
        ...fields,
      }),
      [`node_modules/${specifier}/index.js`]: plugin("sample"),
      "note.md": "A note.\n",
    });
    const checked = run(root, ["lint"]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stderr).toContain("note.md:1:1: warn sample/report: From sample\n");
  });
  // Known defect: the loader resolves package names with CommonJS conditions, so a
  // package that only declares an "import" condition is rejected with 'No "exports"
  // main defined'. Remove `.fails` when the loader resolves such packages.
  it.fails("loads a plugin package that only declares an import condition", async () => {
    const root = await fixture({
      "mdtools.config.json": config("sample-plugin", "sample"),
      "node_modules/sample-plugin/package.json": JSON.stringify({
        name: "sample-plugin",
        type: "module",
        exports: { ".": { import: "./index.js" } },
      }),
      "node_modules/sample-plugin/index.js": plugin("sample"),
      "note.md": "A note.\n",
    });
    expect(run(root, ["lint"]).status).toBe(0);
  });
});

describe("commands that must not write", () => {
  it("leave every file untouched, and a write leaves nothing but the formatted files", async () => {
    const files = {
      "mdtools.config.jsonc": '{ "extends": ["recommended", "github"] }',
      "a.md": "A *note*.\n",
      "nested/b.md": "- [X] done\n",
      "nested/data.json": "{}\n",
    };
    const root = await fixture(files);
    const before = await tree(root);
    for (const command of [
      ["lint"],
      ["lint", "--json"],
      ["format"],
      ["format", "--diff"],
      ["format", "--check"],
      ["format", "--json"],
      ["config", "explain", "a.md"],
    ])
      run(root, command);
    expect(run(root, ["format", "-", "--stdin-filepath", "a.md"], "B *note*.\n").stdout).toBe(
      "B _note_.\n",
    );
    expect(await tree(root)).toEqual(before);
    expect(run(root, ["format", "--write"]).status).toBe(0);
    expect(await tree(root)).toEqual({
      ...before,
      "a.md": "A _note_.\n",
      "nested/b.md": "- [x] done\n",
    });
    // A file that changes between reading and writing is reported, not overwritten.
    await writeFile(path.join(root, "a.md"), "A *note*.\n");
    expect(run(root, ["format", "--check"]).status).toBe(1);
  });
});
