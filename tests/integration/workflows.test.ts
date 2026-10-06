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
        "1 file(s) linted; 1 error(s), 2 warning(s).\n",
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

describe("plugins named in a configuration", () => {
  // A plugin whose rule reports `message` on every document, as an ES module or as CommonJS.
  const plugin = (message: string) =>
    `{name:"sample",rules:{report:{kind:"problem",description:"Example",check:()=>[{start:0,message:"${message}"}]}}}`;
  const esm = (message = "Loaded") => `export default ${plugin(message)};`;
  const cjs = (message = "Loaded") => `module.exports = ${plugin(message)};`;
  const config = (specifier: string) =>
    JSON.stringify({ plugins: [specifier], rules: { "sample/report": "warn" } });
  /** Files of a package installed in `directory`, with its `package.json` built from `fields`. */
  const installed = (
    name: string,
    fields: object,
    files: Record<string, string>,
    directory = "",
  ) => ({
    [`${directory}node_modules/${name}/package.json`]: JSON.stringify({ name, ...fields }),
    ...Object.fromEntries(
      Object.entries(files).map(([file, value]) => [
        `${directory}node_modules/${name}/${file}`,
        value,
      ]),
    ),
  });
  /** What the plugin's rule reported for the note, once the run succeeded. */
  const reported = (checked: ReturnType<typeof run>) => {
    expect(checked.status, checked.stderr).toBe(0);
    return /^note\.md:1:1: warn sample\/report: (.*)$/m.exec(checked.stderr)?.[1];
  };

  it.each([
    ["a main field", "sample-plugin", { type: "module", main: "index.js" }, esm()],
    ["a main field and CommonJS code", "sample-plugin", { main: "index.js" }, cjs()],
    ["a string exports field", "sample-plugin", { type: "module", exports: "./index.js" }, esm()],
    [
      "a default condition and a scoped name",
      "@scope/sample-plugin",
      { type: "module", exports: { ".": { default: "./index.js" } } },
      esm(),
    ],
    // Issue 112: only the CommonJS conditions were followed, so this entry was not found.
    [
      "only an import condition",
      "sample-plugin",
      { type: "module", exports: { ".": { import: "./index.js" } } },
      esm(),
    ],
    [
      "only an import condition and a scoped name",
      "@scope/sample-plugin",
      { type: "module", exports: { ".": { import: "./index.js" } } },
      esm(),
    ],
    // No import can find this entry; the CommonJS lookup does.
    [
      "only a require condition",
      "sample-plugin",
      { exports: { ".": { require: "./index.js" } } },
      cjs(),
    ],
  ])("loads a plugin package that declares %s", async (_label, name, fields, code) => {
    const root = await fixture({
      "mdtools.config.json": config(name),
      ...installed(name, fields, { "index.js": code }),
      "note.md": "A note.\n",
    });
    expect(reported(run(root, ["lint"]))).toBe("Loaded");
  });
  it.each([
    [{ import: "./index.mjs", require: "./index.cjs" }],
    [{ require: "./index.cjs", import: "./index.mjs" }],
    [{ require: "./index.cjs", default: "./index.mjs" }],
  ])(
    "loads what an import finds in a package that also has a require entry: %j",
    async (entries) => {
      const root = await fixture({
        "mdtools.config.json": config("sample-plugin"),
        ...installed(
          "sample-plugin",
          { exports: { ".": entries } },
          { "index.mjs": esm("From the import entry"), "index.cjs": cjs("From the require entry") },
        ),
        "note.md": "A note.\n",
      });
      expect(reported(run(root, ["lint"]))).toBe("From the import entry");
    },
  );
  it.each([
    [
      "an exported subpath with only an import condition",
      "sample-plugin/rules",
      "sample-plugin",
      { type: "module", exports: { "./rules": { import: "./lib/rules.js" } } },
      { "lib/rules.js": esm() },
    ],
    [
      "an exported subpath of a scoped package",
      "@scope/sample-plugin/rules",
      "@scope/sample-plugin",
      { type: "module", exports: { "./rules": "./lib/rules.js" } },
      { "lib/rules.js": esm() },
    ],
    [
      "a file of a package without exports",
      "sample-plugin/lib/rules.js",
      "sample-plugin",
      {},
      { "lib/rules.js": cjs() },
    ],
    // An import needs the extension and cannot name a directory; the CommonJS lookup adds both.
    [
      "a file named without its extension",
      "sample-plugin/lib/rules",
      "sample-plugin",
      {},
      { "lib/rules.js": cjs() },
    ],
    [
      "a directory with an index file",
      "sample-plugin/lib",
      "sample-plugin",
      {},
      { "lib/index.js": cjs() },
    ],
  ])(
    "loads a plugin named by a package subpath: %s",
    async (_label, specifier, name, fields, files) => {
      const root = await fixture({
        "mdtools.config.json": config(specifier),
        ...installed(name, fields, files),
        "note.md": "A note.\n",
      });
      expect(reported(run(root, ["lint"]))).toBe("Loaded");
    },
  );
  it("looks a package up from the configuration file, not from the workspace root", async () => {
    const root = await fixture({
      "settings/mdtools.config.json": config("sample-plugin"),
      ...installed("sample-plugin", { main: "index.js" }, { "index.js": cjs("From the root") }),
      ...installed(
        "sample-plugin",
        { type: "module", exports: { ".": { import: "./index.js" } } },
        { "index.js": esm("From beside the configuration") },
        "settings/",
      ),
      "note.md": "A note.\n",
    });
    const checked = run(root, ["lint", "--config", "settings/mdtools.config.json", "--root", "."]);
    expect(reported(checked)).toBe("From beside the configuration");
  });
  it("loads a plugin named by a relative path, taking the path literally", async () => {
    // As a URL, "%20" would mean a space and "#" would start a fragment.
    const root = await fixture({
      "mdtools.config.json": config("./local rules/100%20 #1.mjs"),
      "local rules/100%20 #1.mjs": esm(),
      "note.md": "A note.\n",
    });
    expect(reported(run(root, ["lint"]))).toBe("Loaded");
  });
  it("loads a plugin named by an absolute path", async () => {
    const root = await fixture({ "rules.mjs": esm(), "note.md": "A note.\n" });
    // On Windows this path has a drive letter and backslashes.
    await writeFile(path.join(root, "mdtools.config.json"), config(path.join(root, "rules.mjs")));
    expect(reported(run(root, ["lint"]))).toBe("Loaded");
  });

  /**
   * Run with a plugin that cannot be used and return the reason given, after checking that
   * the message names the plugin as written and the configuration file.
   */
  const refused = async (
    specifier: string,
    files: Record<string, string>,
    start = "Cannot load plugin",
  ) => {
    const root = await fixture({ ...files, "note.md": "A note.\n" });
    // Naming the file makes its path in the message the one written here on every platform.
    const file = path.join(root, "mdtools.config.json");
    await writeFile(file, config(specifier));
    const checked = run(root, ["lint", "--config", file]);
    expect(checked.status).toBe(2);
    expect(checked.stdout).toBe("");
    const prefix = `mdtools: ${start} "${specifier}" named in ${file}: `;
    expect(checked.stderr.slice(0, prefix.length)).toBe(prefix);
    return checked.stderr.slice(prefix.length);
  };
  it("names the plugin and the configuration file when a package is not installed", async () => {
    expect(await refused("missing-plugin", {})).toContain("Cannot find package 'missing-plugin'");
    expect(await refused("@scope/missing-plugin/rules", {})).toContain(
      "Cannot find package '@scope/missing-plugin'",
    );
  });
  it("names the plugin and the configuration file when a file does not exist", async () => {
    expect(await refused("./missing.mjs", {})).toContain("Cannot find module");
  });
  it("gives the reason an import fails when a package has no entry to load", async () => {
    const types = installed("sample-plugin", { exports: { ".": { types: "./index.d.ts" } } }, {});
    expect(await refused("sample-plugin", types)).toContain('No "exports" main defined');
    const subpaths = installed(
      "sample-plugin",
      { exports: { ".": "./index.js" } },
      { "index.js": cjs() },
    );
    expect(await refused("sample-plugin/rules", subpaths)).toContain(
      "Package subpath './rules' is not defined by \"exports\"",
    );
  });
  it("gives the plugin's own error when its module fails to load", async () => {
    // The require entry would load, but a package with both entries is loaded by import.
    const files = installed(
      "sample-plugin",
      { exports: { ".": { import: "./index.mjs", require: "./index.cjs" } } },
      { "index.mjs": 'throw new Error("Setup failed in the plugin");', "index.cjs": cjs() },
    );
    expect(await refused("sample-plugin", files)).toBe("Setup failed in the plugin\n");
    expect(
      await refused("./rules.mjs", { "rules.mjs": 'import "not-installed-package";' }),
    ).toContain("Cannot find package 'not-installed-package'");
  });
  it.each([
    ["no default export", 'export const name = "sample";'],
    ["a default export without a name", "export default { rules: {} };"],
    ["a default export that is not an object", 'export default "sample";'],
  ])("rejects a plugin module with %s", async (_label, code) => {
    expect(await refused("./rules.mjs", { "rules.mjs": code }, "Invalid plugin")).toBe(
      'its default export must be an object with a string "name".\n',
    );
    const files = installed(
      "sample-plugin",
      { type: "module", exports: "./index.js" },
      { "index.js": code },
    );
    expect(await refused("sample-plugin", files, "Invalid plugin")).toBe(
      'its default export must be an object with a string "name".\n',
    );
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
    // Each command has to do its work for an unchanged tree to mean anything.
    for (const [command, status, stream, printed] of [
      [["lint"], 0, "stderr", "a.md:1:3: warn style/emphasis"],
      [["lint", "--json"], 0, "stdout", '"mode": "lint"'],
      [["format"], 0, "stdout", "+A _note_."],
      [["format", "--diff"], 0, "stdout", "+- [x] done"],
      [["format", "--check"], 1, "stderr", "2 file(s) processed; 2 would change."],
      [["format", "--json"], 0, "stdout", '"changed": true'],
      [["config", "explain", "a.md"], 0, "stdout", '"dialect": "github"'],
    ] as const) {
      const result = run(root, [...command]);
      expect(result.status, command.join(" ")).toBe(status);
      expect(result[stream], command.join(" ")).toContain(printed);
    }
    expect(run(root, ["format", "-", "--stdin-filepath", "a.md"], "B *note*.\n").stdout).toBe(
      "B _note_.\n",
    );
    expect(await tree(root)).toEqual(before);
    // A write changes the two documents and leaves no temporary file behind.
    expect(run(root, ["format", "--write"]).status).toBe(0);
    expect(await tree(root)).toEqual({
      ...before,
      "a.md": "A _note_.\n",
      "nested/b.md": "- [x] done\n",
    });
    expect(run(root, ["format", "--check"]).status).toBe(0);
  });
});
