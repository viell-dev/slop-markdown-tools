import { readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { dialects, lint } from "../../src/index.js";
import type { Diagnostic, Plugin } from "../../src/index.js";
import { copyOf, fixture, node, repository, run, tree } from "./support.js";

interface Report {
  files: { path: string; changed?: boolean; diagnostics: Diagnostic[] }[];
  written: boolean;
}
const examples = path.join(repository, "examples");
/** `path:line:column severity rule` for each diagnostic, in report order. */
function summary(stdout: string): string[] {
  return (JSON.parse(stdout) as Report).files.flatMap((file) =>
    file.diagnostics.map(
      (item) => `${file.path}:${item.line}:${item.column} ${item.severity} ${item.rule}`,
    ),
  );
}

// New files in these folders are picked up automatically and must meet the same contract.
const configurations = readdirSync(examples)
  .filter((name) => name.endsWith(".jsonc"))
  .sort();
const workspaces = readdirSync(path.join(examples, "workspaces")).sort();

describe("starting configurations", () => {
  it("exist for every dialect that names a hosting profile", () => {
    for (const dialect of dialects)
      if (dialect !== "commonmark") expect(configurations).toContain(`${dialect}.jsonc`);
  });
  it.each(configurations)("%s loads and selects the dialect it is named after", async (name) => {
    const root = await fixture({
      ".obsidian/app.json": '{"strictLineBreaks":true}',
      "note.md": "# Note\n\nA formatted note with a [link](./other.md).\n",
      "other.md": "# Other\n",
    });
    const config = path.join(examples, name);
    const explained = run(root, [
      "config",
      "--root",
      ".",
      "--config",
      config,
      "explain",
      "note.md",
    ]);
    expect(explained.status, explained.stderr).toBe(0);
    expect(JSON.parse(explained.stdout).effective.dialect).toBe(path.basename(name, ".jsonc"));
    // The Obsidian configuration asks for vault-root paths, the others for ./relative ones.
    const source = name === "obsidian.jsonc" ? "[link](./other.md)" : "[link](other.md)";
    const formatted = run(
      root,
      ["format", "-", "--root", ".", "--config", config, "--stdin-filepath", "new.md"],
      `A *new* note with a ${source}.\n`,
    );
    expect(formatted.status, formatted.stderr).toBe(0);
    expect(formatted.stdout).toBe(
      `A _new_ note with a [link](${name === "obsidian.jsonc" ? "<other.md>" : "./other.md"}).\n`,
    );
  });
});

describe.each(workspaces)("workspaces/%s", (name) => {
  const before = `examples/workspaces/${name}/before`;
  const after = `examples/workspaces/${name}/after`;
  it("formats before/ into exactly after/", async () => {
    const root = await copyOf(before);
    const applied = run(root, ["format", "--write", "--json"]);
    expect(applied.stderr).toBe("");
    const report = JSON.parse(applied.stdout) as Report;
    expect(report.written).toBe(true);
    expect(report.files.filter((file) => file.changed)).not.toHaveLength(0);
    expect(await tree(root)).toEqual(await tree(path.join(repository, after)));
  });
  it("keeps after/ unchanged, so formatting it again does nothing", () => {
    const checked = run(path.join(repository, after), ["format", "--check", "--json"]);
    const report = JSON.parse(checked.stdout) as Report;
    expect(report.files.filter((file) => file.changed)).toEqual([]);
    // Whatever formatting leaves behind is a problem to fix by hand, never a style finding.
    for (const item of report.files.flatMap((file) => file.diagnostics))
      expect(item.edit, item.rule).toBeUndefined();
  });
});

describe("workspaces/repository-docs", () => {
  it("reports each kind of finding once before formatting and one broken link after", () => {
    const before = run(path.join(examples, "workspaces/repository-docs/before"), [
      "lint",
      "--json",
    ]);
    expect(before.status).toBe(1);
    expect(new Set(summary(before.stdout).map((line) => line.split(" ").pop()))).toEqual(
      new Set([
        "style/wrap",
        "style/emphasis",
        "style/strong",
        "style/heading",
        "style/table",
        "style/final-newline",
        "links/path",
        "links/valid",
        "github/alert-marker",
        "github/task-marker",
      ]),
    );
    const after = run(path.join(examples, "workspaces/repository-docs/after"), ["lint", "--json"]);
    expect(after.status).toBe(1);
    expect(summary(after.stdout)).toEqual(["README.md:13:1 error links/valid"]);
  });
});

describe("workspaces/obsidian-vault", () => {
  const vault = path.join(examples, "workspaces/obsidian-vault");
  it("leaves the ignored template folder alone but resolves links into it", async () => {
    const report = JSON.parse(run(path.join(vault, "before"), ["lint", "--json"]).stdout) as Report;
    expect(report.files.map((file) => file.path)).toEqual([
      "Garden/Tomatoes.md",
      "Garden/Watering schedule.md",
      "Home.md",
    ]);
    expect(await readFile(path.join(vault, "after/Templates/Plant.md"), "utf8")).toBe(
      await readFile(path.join(vault, "before/Templates/Plant.md"), "utf8"),
    );
    expect(await readFile(path.join(vault, "after/Home.md"), "utf8")).toContain(
      "[plant template](<Templates/Plant.md>)",
    );
  });
  it("reports one missing note after formatting", () => {
    const after = run(path.join(vault, "after"), ["lint", "--json"]);
    expect(after.status).toBe(1);
    expect(summary(after.stdout)).toEqual(["Garden/Watering schedule.md:11:1 error links/valid"]);
  });
  it("does not reflow prose when the vault does not use strict line breaks", async () => {
    const root = await copyOf("examples/workspaces/obsidian-vault/before");
    const settings = path.join(root, ".obsidian/app.json");
    expect(JSON.parse(await readFile(settings, "utf8"))).toEqual({ strictLineBreaks: true });
    await writeFile(settings, "{}\n");
    const report = JSON.parse(run(root, ["format", "--write", "--json"]).stdout) as Report;
    const rules = report.files.flatMap((file) => file.diagnostics.map((item) => item.rule));
    expect(rules).toContain("obsidian/strict-line-breaks");
    const home = await readFile(path.join(root, "Home.md"), "utf8");
    expect(home).toContain(
      "This vault tracks the kitchen garden. Start with [[Tomatoes]] or jump straight to the [[Garden/Watering schedule#Summer|summer watering plan]].\n",
    );
  });
});

describe("plugin", () => {
  const root = path.join(examples, "plugin");
  it("reports both custom rules next to the built-in ones", () => {
    const checked = run(root, ["lint", "--json"]);
    expect(checked.status, checked.stderr).toBe(1);
    expect(summary(checked.stdout)).toEqual([
      "notes/release-checklist.md:3:25 error house/no-placeholder",
      "notes/release-checklist.md:7:1 warn house/thematic-break",
    ]);
  });
  it("applies the style rule's edit and leaves the problem for a person", () => {
    const preview = run(root, ["format", "--diff"]);
    expect(preview.stdout).toContain("-***\n+---\n");
    expect(preview.stdout).toContain(" Draft the announcement. TODO: add the download link.\n");
    expect(preview.stderr).toContain("house/no-placeholder");
    expect(preview.stderr).not.toContain("engine/");
  });
  it("proposes no edit where three hyphens would change the document's meaning", () => {
    const format = (source: string) => {
      const formatted = run(
        root,
        ["format", "-", "--stdin-filepath", path.join(root, "notes/draft.md"), "--json"],
        source,
      );
      expect(formatted.status, formatted.stderr).toBe(0);
      const file = (
        JSON.parse(formatted.stdout) as { files: (Report["files"][0] & { output: string })[] }
      ).files[0]!;
      return [file.output, ...file.diagnostics.map((item) => `${item.line} ${item.rule}`)];
    };
    // At the start of a document, and directly below a paragraph, which "---" would
    // turn into a heading: reported, not edited. After a blank line: edited.
    expect(format("***\n\nA paragraph\n***\n\nMore prose.\n\n* * *\n")).toEqual([
      "***\n\nA paragraph\n***\n\nMore prose.\n\n---\n",
      "1 house/thematic-break",
      "4 house/thematic-break",
    ]);
    // Below a first line of "---", another "---" would turn the lines between into front matter.
    expect(format("---\n\nText\n\n***\n")).toEqual([
      "---\n\nText\n\n***\n",
      "5 house/thematic-break",
    ]);
    // Real front matter is already closed, so a later break is safe to rewrite.
    expect(format("---\ntitle: Draft\n---\n\nText\n\n***\n")).toEqual([
      "---\ntitle: Draft\n---\n\nText\n\n---\n",
    ]);
  });
  it("validates options against the schema the rule declares", async () => {
    const plugin = (
      (await import(pathToFileURL(path.join(root, "rules.mjs")).href)) as { default: Plugin }
    ).default;
    const config = (words: unknown) => ({
      extends: [],
      rules: { "house/no-placeholder": ["error", { words }] as ["error", { words: unknown }] },
    });
    const ranges = (source: string, words: string[]) =>
      lint(source, { config: config(words), plugins: [plugin] }).map((item) => [
        item.start,
        item.end,
      ]);
    expect(ranges("Still TBD, see `TBD`. TBD\n", ["TBD"])).toEqual([
      [6, 9],
      [22, 25],
    ]);
    // The rule searches the text a reader sees: a character reference can spell a
    // word, and the name of one is not a word. Such a finding covers the whole text.
    expect(ranges("&#84;BD &amp; done\n", ["TBD", "amp"])).toEqual([[0, 18]]);
    for (const words of ["TBD", [], [""]])
      expect(() => lint("Text.\n", { config: config(words), plugins: [plugin] })).toThrow(
        "Invalid options for house/no-placeholder",
      );
  });
});

describe("library scripts", () => {
  it("format-string.mjs formats through the package's public entry point", () => {
    const result = node("examples/library/format-string.mjs");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "A _short_ note with **strong** words and\nno final newline.\n\nchanged: true; remaining diagnostics: 0\n",
    );
  });
  it("lint-folder.mjs builds a workspace from files it read itself", () => {
    const result = node("examples/library/lint-folder.mjs");
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toBe(
      "README.md:13:1 error links/valid: Missing local target: docs/calibration.md.\n1 error(s)\n",
    );
    const other = node("examples/library/lint-folder.mjs", [
      "examples/workspaces/repository-docs/before",
    ]);
    expect(other.stdout).toContain("docs/guide.md:4:1 warn style/wrap");
    expect(other.stdout).toContain("\n1 error(s)\n");
  });
  it("lint-folder.mjs treats any spelling of the .md extension as Markdown", async () => {
    const root = await fixture({
      "README.MD": "A *note* with a [link](other.Md#title).\n",
      "other.Md": "# Title\n",
    });
    const result = node("examples/library/lint-folder.mjs", [root]);
    expect(result.stdout).toBe(
      'README.MD:1:3 warn style/emphasis: Use "_" for emphasis.\n' +
        'README.MD:1:8 warn style/emphasis: Use "_" for emphasis.\n' +
        "0 error(s)\n",
    );
  });
});

describe("automation", () => {
  it("summarize-report.mjs counts the diagnostics of a JSON report per rule", () => {
    const summarize = (report: string) => {
      const summarized = node("examples/automation/summarize-report.mjs", [], report);
      expect(summarized.status, summarized.stderr).toBe(0);
      return summarized.stdout;
    };
    expect(summarize(run(path.join(examples, "plugin"), ["lint", "--json"]).stdout)).toBe(
      "lint: 1 file(s), 2 diagnostic(s)\n" +
        "1 error house/no-placeholder in 1 file(s)\n" +
        "1 warn house/thematic-break in 1 file(s)\n",
    );
    const checked = run(path.join(examples, "plugin"), ["format", "--check", "--json"]);
    expect(summarize(checked.stdout)).toBe(
      "format: 1 file(s), 1 diagnostic(s)\n" +
        "1 file(s) need formatting\n" +
        "1 error house/no-placeholder in 1 file(s)\n",
    );
  });
  it("summarize-report.mjs keeps severities apart and knows a write from a preview", async () => {
    // An override makes the same rule an error in one folder and a warning elsewhere.
    const root = await fixture({
      "mdtools.config.jsonc": `{
        "overrides": [{ "files": ["strict/**"], "rules": { "style/emphasis": "error" } }],
      }`,
      "a.md": "An *emphasized* word.\n",
      "strict/b.md": "An *emphasized* word.\n",
    });
    const written = run(root, ["format", "--write", "--json"]);
    expect(written.status, written.stderr).toBe(0);
    expect(node("examples/automation/summarize-report.mjs", [], written.stdout).stdout).toBe(
      "format: 2 file(s), 0 diagnostic(s)\n2 file(s) were formatted\n",
    );
    await writeFile(path.join(root, "a.md"), "An *emphasized* word.\n");
    await writeFile(path.join(root, "strict/b.md"), "An *emphasized* word.\n");
    const linted = run(root, ["lint", "--json"]);
    expect(linted.status).toBe(1);
    expect(node("examples/automation/summarize-report.mjs", [], linted.stdout).stdout).toBe(
      "lint: 2 file(s), 4 diagnostic(s)\n" +
        "2 warn style/emphasis in 1 file(s)\n" +
        "2 error style/emphasis in 1 file(s)\n",
    );
  });
  it("github-actions.yml runs commands that pass on clean documents and fail otherwise", async () => {
    const workflow = await readFile(path.join(examples, "automation/github-actions.yml"), "utf8");
    const commands = [...workflow.matchAll(/^\s*- run: npx --no-install mdtools (.+)$/gm)].map(
      (match) => match[1]!.split(" "),
    );
    expect(commands).toEqual([
      ["lint", "--max-warnings", "0"],
      ["format", "--check"],
    ]);
    const clean = await fixture({ "README.md": "# Project\n\nA formatted _note_.\n" });
    const unformatted = await fixture({ "README.md": "# Project\n\nAn unformatted *note*.\n" });
    for (const command of commands) {
      const passed = run(clean, command);
      expect(passed.status, passed.stderr).toBe(0);
      expect(run(unformatted, command).status).toBe(1);
    }
  });
});
