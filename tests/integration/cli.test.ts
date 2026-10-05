import { execFileSync } from "node:child_process";
import { mkdir, readFile, symlink, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discover, isVault, writeAtomic } from "../../src/workspace/files.js";
import { loadConfig } from "../../src/config/load.js";
import { canRestrict, cli, fixture, manifest, restrict, run } from "./support.js";

describe("CLI", () => {
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
    expect(JSON.parse(checked.stdout).files[0].diagnostics[0].rule).toBe("links/valid");
    expect(checked.stderr).toBe("");
    expect(run(root, ["lint", "--dialect", "typo", "."]).status).toBe(2);
  });
  it("accepts the Forgejo dialect and its Codeberg alias", async () => {
    const root = await fixture({
      "mdtools.config.jsonc": '{ "extends": ["recommended", "codeberg"] }',
      "note.md": "# Test.0.1\n\n[link](#test-0-1)\n\nTerm\n: Definition\n",
    });
    const checked = run(root, ["lint", "--json", "."]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(run(root, ["format", "--check", "."]).status).toBe(0);
    expect(run(root, ["lint", "--dialect", "github", "."]).status).toBe(1);
    const explained = run(root, ["config", "explain", "note.md"]);
    expect(JSON.parse(explained.stdout).effective.dialect).toBe("forgejo");
    const aliased = run(root, ["lint", "--dialect", "codeberg", "--json", "."]);
    expect(aliased.status, aliased.stderr).toBe(0);
  });
  it("accepts the Gitea dialect", async () => {
    const root = await fixture({
      "mdtools.config.jsonc": '{ "extends": ["recommended", "gitea"] }',
      "note.md": "# Test.0.1\n\n[link](#test01)\n\nTerm\n: Definition\n\nSee __init__.py.\n",
    });
    const checked = run(root, ["lint", "--json", "."]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(run(root, ["format", "--check", "."]).status).toBe(0);
    expect(run(root, ["lint", "--dialect", "forgejo", "."]).status).toBe(1);
    const explained = run(root, ["config", "explain", "note.md"]);
    expect(JSON.parse(explained.stdout).effective.dialect).toBe("gitea");
  });
  it("loads JSONC, applies path overrides, and explains configuration", async () => {
    const root = await fixture({
      "mdtools.config.jsonc":
        '{ // comment\n "rules": {"style/emphasis": "off"}, "overrides": [{"files": ["vault/**"], "dialect": "obsidian"}], }',
      "vault/a.md": "*keep*\n",
    });
    expect(run(root, ["format", "--check", "vault"]).status).toBe(0);
    const explained = run(root, ["config", "explain", "vault/a.md"]);
    expect(explained.status, explained.stderr).toBe(0);
    expect(JSON.parse(explained.stdout).effective.dialect).toBe("obsidian");
  });
  it("loads a custom JavaScript rule and preset", async () => {
    const root = await fixture({
      "mdtools.config.mjs":
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
      "mdtools.config.json": '{"ignore":["copied/**"]}',
      "note.md": "[copy](copied/file.md)\n",
      "copied/file.md": "*copied*\n",
      ".gitignore": "generated/\n",
      "generated/a.md": "*generated*\n",
      "child/.git/HEAD": "ref: refs/heads/main",
      "child/a.md": "*child*\n",
    });
    const result = run(root, ["lint", "--json", "."]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).files.map((file: { path: string }) => file.path)).toEqual([
      "note.md",
    ]);
  });
  it("indexes ignored and nested targets only when opted in, without selecting them", async () => {
    const root = await fixture({
      "mdtools.config.json": JSON.stringify({
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
    expect(JSON.parse(checked.stdout).files.map((file: { path: string }) => file.path)).toEqual([
      "Doc.md",
    ]);
    const applied = run(root, ["format", "--write", "--json"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout).files.map((file: { path: string }) => file.path)).toEqual([
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
      "mdtools.config.json": '{"extends":["recommended","obsidian"]}',
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
      "mdtools.config.json": JSON.stringify({
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
    const findings = JSON.parse(applied.stdout).files[0].diagnostics;
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(1);
    expect(findings[0].message).toContain("unbreakable atom");
    expect(run(root, ["format", "--check", "note.md"]).status).toBe(0);
  });
  it("does not partially apply a batch when a formatter safety check fails", async () => {
    const root = await fixture({
      "mdtools.config.json": '{"plugins":["./plugin.mjs"],"rules":{"local/bad":"warn"}}',
      "plugin.mjs":
        'export default {name:"local",rules:{bad:{kind:"style",description:"Bad",check:({document})=>document.source.startsWith("bad")?[{start:0,message:"Bad",edit:{start:0,end:3,text:"different"}}]:[]}}};',
      "a.md": "*fine*\n",
      "b.md": "bad\n",
    });
    expect(run(root, ["format", "--write", "."]).status).toBe(2);
    expect(await readFile(path.join(root, "a.md"), "utf8")).toBe("*fine*\n");
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
    expect(JSON.parse(selected.stdout).files.map((file: { path: string }) => file.path)).toEqual([
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
      "mdtools.config.json": '{"rules":{"style/emphasis":"off"}}',
      "mdtools.config.jsonc": '{"rules":{"style/emphasis":"warn"}}',
      "note.md": "*keep*\n",
    });
    const ambiguous = run(root, ["format", "--check", "."]);
    expect(ambiguous.status).toBe(2);
    expect(ambiguous.stderr).toContain("Multiple mdtools configuration files");
    expect(run(root, ["format", "--check", "--config", "mdtools.config.json", "."]).status).toBe(0);
    expect(run(root, ["format", "--check", "--config", "mdtools.config.jsonc", "."]).status).toBe(
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
describe("without a named dialect", () => {
  // Tables and footnotes on GitHub, Forgejo, Gitea, and in Obsidian. CommonMark, which
  // was assumed up to 0.2.0-rc.1, reads the tables and the consecutive definitions as
  // paragraphs, which the default rules reflow, and a definition as a link to a file.
  const table = "| Sensor | Unit |\n|---|---|\n| Temperature | °C |\n";
  const files = {
    "outer-pipes.md": table,
    "no-outer-pipes.md": "Sensor | Unit\n---|---\nTemperature | °C\n",
    "wide.md":
      "| Sensor name in a long header cell | Unit of measurement in a long header cell | Notes |\n" +
      "|---|---|---|\n" +
      "| Temperature measured at the north wall | Degrees Celsius, to one decimal place | Calibrated yearly |\n",
    "footnotes.md": "Text with two notes.[^1][^2]\n\n[^1]: First note.\n[^2]: Second note.\n",
    "footnote.md": "Text with a note.[^1]\n\n[^1]: Text.\n",
  };
  const dialect = (root: string, file: string, ...flags: string[]) => {
    const explained = run(root, ["config", ...flags, "explain", file]);
    expect(explained.status, explained.stderr).toBe(0);
    return (JSON.parse(explained.stdout) as { effective: { dialect: string } }).effective.dialect;
  };
  it("assumes GitHub Markdown and says so", async () => {
    const root = await fixture(files);
    expect(dialect(root, "outer-pipes.md")).toBe("github");
    // Only the dialect is assumed: the rules are those of the recommended preset.
    const explained = JSON.parse(run(root, ["config", "explain", "outer-pipes.md"]).stdout);
    expect(explained.file).toBeNull();
    expect(Object.keys(explained.effective.rules)).not.toContain("style/table");
    // A configuration that names no dialect is read the same way.
    const configured = await fixture({
      ...files,
      "mdtools.config.jsonc": '{ "rules": { "style/emphasis": "off" } }',
    });
    expect(dialect(configured, "outer-pipes.md")).toBe("github");
    expect(run(configured, ["format", "--check"]).status).toBe(0);
  });
  it.each(Object.keys(files).filter((name) => name !== "footnote.md"))(
    "formats %s without changing it",
    async (name) => {
      const source = files[name as keyof typeof files];
      const root = await fixture({ [name]: source });
      const checked = run(root, ["format", "--check"]);
      expect(checked.status, checked.stderr).toBe(0);
      expect(checked.stderr).toBe("1 file(s) processed; 0 would change.\n");
      expect(run(root, ["format", "--write"]).status).toBe(0);
      expect(await readFile(path.join(root, name), "utf8")).toBe(source);
      const piped = run(root, ["format", "-"], source);
      expect(piped.status, piped.stderr).toBe(0);
      expect(piped.stdout).toBe(source);
    },
  );
  it("lints a footnote definition without reporting a missing file", async () => {
    const root = await fixture(files);
    const linted = run(root, ["lint"]);
    expect(linted.status, linted.stderr).toBe(0);
    expect(linted.stderr).toBe("5 file(s) linted; 0 would change.\n");
    const piped = run(root, ["lint", "-"], files["footnote.md"]);
    expect(piped.status, piped.stderr).toBe(0);
    expect(piped.stderr).toBe("");
  });
  it("still reads CommonMark when --dialect or the configuration names it", async () => {
    const joined = "| Sensor | Unit | |---|---| | Temperature | °C |\n";
    const root = await fixture(files);
    expect(dialect(root, "outer-pipes.md", "--dialect", "commonmark")).toBe("commonmark");
    expect(run(root, ["format", "-", "--dialect", "commonmark"], table).stdout).toBe(joined);
    const linted = run(root, ["lint", "--dialect", "commonmark", "footnote.md"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toContain(
      "footnote.md:3:1: error links/valid: Missing local target: Text..",
    );
    const configured = await fixture({
      ...files,
      "mdtools.config.jsonc": '{ "dialect": "commonmark" }',
    });
    expect(dialect(configured, "outer-pipes.md")).toBe("commonmark");
    expect(run(configured, ["format", "-"], table).stdout).toBe(joined);
    expect(run(configured, ["format", "--write", "outer-pipes.md"]).status).toBe(0);
    expect(await readFile(path.join(configured, "outer-pipes.md"), "utf8")).toBe(joined);
    // --dialect replaces the configuration's dialect, in this direction as well.
    expect(run(configured, ["format", "-", "--dialect", "github"], table).stdout).toBe(table);
  });
  it("leaves the choice to a preset or an override that names a dialect", async () => {
    const root = await fixture({
      "mdtools.config.jsonc": `{
        "extends": ["recommended", "forgejo"],
        "overrides": [{ "files": ["plain/**"], "dialect": "commonmark" }],
      }`,
      "docs/table.md": table,
      "plain/table.md": table,
    });
    expect(dialect(root, "docs/table.md")).toBe("forgejo");
    expect(dialect(root, "plain/table.md")).toBe("commonmark");
    const previewed = run(root, ["format", "--json"]);
    expect(previewed.status, previewed.stderr).toBe(0);
    const changed = (JSON.parse(previewed.stdout) as { files: { path: string }[] }).files;
    expect(changed).toMatchObject([
      // The forgejo preset aligns the table; CommonMark reflows its lines as prose.
      { path: "docs/table.md", changed: true },
      { path: "plain/table.md", changed: true },
    ]);
    expect(run(root, ["format", "--write"]).status).toBe(0);
    expect(await readFile(path.join(root, "docs/table.md"), "utf8")).toBe(
      "| Sensor      | Unit |\n| ----------- | ---- |\n| Temperature | °C   |\n",
    );
    expect(await readFile(path.join(root, "plain/table.md"), "utf8")).toBe(
      "| Sensor | Unit | |---|---| | Temperature | °C |\n",
    );
  });
});
describe("at the root of an Obsidian vault, without a named dialect", () => {
  // Obsidian shows the first two lines on separate lines unless the vault's "Strict
  // line breaks" setting is on, and a wikilink must stay on one line. Up to 0.2.0-rc.1
  // the note was read as CommonMark: the lines were joined and the wikilink was split.
  const link =
    "[[A fairly long note name that sits near the wrap column of this paragraph|alias text]]";
  const note = `Shopping list\nMilk and eggs\n\nSee ${link} here.\n`;
  const reflowed = `Shopping list Milk and eggs\n\nSee\n${link}\nhere.\n`;
  const asGithub =
    "Shopping list Milk and eggs\n\nSee [[A fairly long note name that sits near the wrap column of this\nparagraph|alias text]] here.\n";
  const files = {
    "Note.md": note,
    "A fairly long note name that sits near the wrap column of this paragraph.md": "# Target\n",
  };
  const dialect = (root: string, file: string, ...flags: string[]) => {
    const explained = run(root, ["config", ...flags, "explain", file]);
    expect(explained.status, explained.stderr).toBe(0);
    return (JSON.parse(explained.stdout) as { effective: { dialect: string } }).effective.dialect;
  };
  /** A vault: Obsidian creates `.obsidian/` at its root, with or without settings in `app.json`. */
  async function vault(settings: string | undefined, extra: Record<string, string> = {}) {
    const root = await fixture({
      ...files,
      ...(settings === undefined ? {} : { ".obsidian/app.json": settings }),
      ...extra,
    });
    await mkdir(path.join(root, ".obsidian"), { recursive: true });
    return root;
  }
  it.each([
    ["no settings file", undefined],
    ["a settings file without the setting", "{}"],
    ["strict line breaks off", '{"strictLineBreaks":false}'],
  ])("assumes the Obsidian dialect and reflows nothing with %s", async (_, settings) => {
    const root = await vault(settings);
    expect(dialect(root, "Note.md")).toBe("obsidian");
    const linted = run(root, ["lint"]);
    expect(linted.status, linted.stderr).toBe(0);
    expect(linted.stderr).toBe("2 file(s) linted; 0 would change.\n");
    const previewed = run(root, ["format", "--diff"]);
    expect(previewed.status, previewed.stderr).toBe(0);
    expect(previewed.stdout).toBe("");
    expect(run(root, ["format", "--write"]).status).toBe(0);
    expect(await readFile(path.join(root, "Note.md"), "utf8")).toBe(note);
    // The same holds for stdin, and from a folder of the vault.
    expect(run(root, ["format", "-"], note).stdout).toBe(note);
    await mkdir(path.join(root, "Folder"));
    expect(run(path.join(root, "Folder"), ["format", "-"], note).stdout).toBe(note);
    expect(run(root, ["format", "--check", "--dialect", "obsidian"]).status).toBe(0);
  });
  it("reflows as the Obsidian dialect does once strict line breaks are on", async () => {
    const root = await vault('{"strictLineBreaks":true}');
    expect(dialect(root, "Note.md")).toBe("obsidian");
    // Obsidian then shows the two lines as one, so joining them is safe; the wikilink stays whole.
    expect(run(root, ["format", "-", "--stdin-filepath", "Note.md"], note).stdout).toBe(reflowed);
    expect(
      run(root, ["format", "-", "--stdin-filepath", "Note.md", "--dialect", "obsidian"], note)
        .stdout,
    ).toBe(reflowed);
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(await readFile(path.join(root, "Note.md"), "utf8")).toBe(reflowed);
    expect(run(root, ["format", "--check"]).status).toBe(0);
    expect(run(root, ["lint", "--max-warnings", "0"]).status).toBe(0);
  });
  it("assumes the dialect only, so the rules of the obsidian preset still need the preset", async () => {
    const source = "> [!TIP] Title\n> Text.\n";
    const root = await vault(undefined, { "Callout.md": source });
    const explained = JSON.parse(run(root, ["config", "explain", "Callout.md"]).stdout);
    expect(explained.file).toBeNull();
    expect(explained.effective.dialect).toBe("obsidian");
    expect(Object.keys(explained.effective.rules)).not.toContain("obsidian/callout-marker");
    expect(run(root, ["format", "-"], source).stdout).toBe(source);
    const preset = await vault(undefined, {
      "Callout.md": source,
      "mdtools.config.jsonc": '{ "extends": ["recommended", "obsidian"] }',
    });
    expect(run(preset, ["format", "-"], source).stdout).toBe("> [!tip] Title\n> Text.\n");
  });
  it("gives way to --dialect and to a dialect named by a setting, a preset, or an override", async () => {
    const root = await vault(undefined);
    expect(dialect(root, "Note.md", "--dialect", "github")).toBe("github");
    expect(run(root, ["format", "-", "--dialect", "github"], note).stdout).toBe(asGithub);
    for (const [config, expected, output] of [
      ['{ "dialect": "commonmark" }', "commonmark", asGithub],
      ['{ "extends": ["recommended", "github"] }', "github", asGithub],
      // Gitea joins the lines too, and keeps a `[[...]]` shortlink on one line.
      ['{ "overrides": [{ "files": ["Note.md"], "dialect": "gitea" }] }', "gitea", reflowed],
    ] as const) {
      const configured = await vault(undefined, { "mdtools.config.jsonc": config });
      expect(dialect(configured, "Note.md"), config).toBe(expected);
      expect(
        run(configured, ["format", "-", "--stdin-filepath", "Note.md"], note).stdout,
        config,
      ).toBe(output);
    }
    // A configuration that names no dialect leaves the vault's in place, also for
    // the files that an override naming another dialect does not match.
    const unnamed = await vault(undefined, {
      "mdtools.config.jsonc":
        '{ "rules": { "style/emphasis": "off" }, "overrides": [{ "files": ["docs/**"], "dialect": "github" }] }',
      "docs/page.md": "A page.\n",
    });
    expect(dialect(unnamed, "Note.md")).toBe("obsidian");
    expect(dialect(unnamed, "docs/page.md")).toBe("github");
    expect(run(unnamed, ["format", "--check"]).status).toBe(0);
  });
  it("does not recognize a vault in a folder of a larger workspace", async () => {
    const root = await fixture({
      "README.md": "# Project\n",
      "vault/.obsidian/app.json": "{}",
      "vault/Note.md": note,
    });
    // The workspace root is the repository, whose documents are not Obsidian notes.
    expect(dialect(root, "vault/Note.md")).toBe("github");
    expect(run(root, ["format", "-", "--stdin-filepath", "vault/Note.md"], note).stdout).toBe(
      asGithub,
    );
    // Run on the vault itself, or with an override as documented, it is read as Obsidian.
    expect(dialect(root, "vault/Note.md", "--root", "vault")).toBe("obsidian");
    expect(dialect(path.join(root, "vault"), "Note.md")).toBe("obsidian");
    const overridden = await fixture({
      "mdtools.config.jsonc": '{ "overrides": [{ "files": ["vault/**"], "dialect": "obsidian" }] }',
      "vault/.obsidian/app.json": "{}",
      "vault/Note.md": note,
    });
    expect(dialect(overridden, "vault/Note.md")).toBe("obsidian");
    expect(run(overridden, ["format", "-", "--stdin-filepath", "vault/Note.md"], note).stdout).toBe(
      note,
    );
  });
});
describe("filesystem safeguards", () => {
  it("detects concurrent writes", async () => {
    const root = await fixture({ "note.md": "new content" });
    await expect(
      writeAtomic(path.join(root, "note.md"), "old content", "formatted"),
    ).rejects.toThrow("changed during");
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("new content");
  });
  it("refuses to replace anything but a regular file", async () => {
    const root = await fixture({});
    await mkdir(path.join(root, "folder.md"));
    await expect(writeAtomic(path.join(root, "folder.md"), "", "text")).rejects.toThrow(
      "Refusing non-regular file",
    );
  });
  it("preserves file permissions", async () => {
    const root = await fixture({ "note.md": "old" });
    const before = await stat(path.join(root, "note.md"));
    await writeAtomic(path.join(root, "note.md"), "old", "new");
    expect((await stat(path.join(root, "note.md"))).mode).toBe(before.mode);
  });
  it.skipIf(process.platform === "win32")(
    "refuses explicit symlinks and skips them during traversal",
    async () => {
      const root = await fixture({ "target.md": "*content*\n" });
      await symlink(path.join(root, "target.md"), path.join(root, "link.md"));
      await expect(discover(root, [path.join(root, "link.md")], [])).rejects.toThrow(
        "symbolic-link",
      );
      expect((await discover(root, [], [])).selected).toEqual(["target.md"]);
    },
  );
  it.skipIf(process.platform === "win32")(
    "canonicalizes exclusion paths through a workspace alias",
    async () => {
      const root = await fixture({ "note.md": "*note*\n", "other.md": "Text.\n" });
      const aliasParent = await fixture({});
      const alias = path.join(aliasParent, "workspace");
      await symlink(root, alias);
      const checked = run(root, [
        "lint",
        "--json",
        "--exclude",
        path.join(alias, "note.md"),
        "--exclude",
        path.join(alias, "not-created/note.md"),
      ]);
      expect(checked.status, checked.stderr).toBe(0);
      expect(JSON.parse(checked.stdout).files.map((file: { path: string }) => file.path)).toEqual([
        "other.md",
      ]);
    },
  );
  it("finds the vault boundary when invoked from a subdirectory", async () => {
    const root = await fixture({ ".obsidian/app.json": "{}", "sub/note.md": "text" });
    expect((await loadConfig(path.join(root, "sub"))).root).toBe(root);
  });
  it("recognizes a vault by a .obsidian folder at the root, and nowhere else", async () => {
    const root = await fixture({
      ".obsidian/app.json": "{}",
      "nested/vault/.obsidian/app.json": "{}",
      "plain/note.md": "text",
      "file/.obsidian": "not a folder",
    });
    expect(await isVault(root)).toBe(true);
    expect(await isVault(path.join(root, "nested/vault"))).toBe(true);
    expect(await isVault(path.join(root, "nested"))).toBe(false);
    expect(await isVault(path.join(root, "plain"))).toBe(false);
    expect(await isVault(path.join(root, "file"))).toBe(false);
  });
});
// Permissions cannot be taken away on Windows or from root, so these tests are skipped
// there; tests/unit/links.test.ts covers what the library does with an unreadable path.
describe.skipIf(!canRestrict)("directories that may not be read", () => {
  const skippedMessage = (directory: string, detail = "") =>
    `Skipped unreadable directory: ${directory} (EACCES: permission denied${detail}). Its files are not processed, and links into it cannot be checked.`;
  const warning = (directory: string, detail = "") =>
    `mdtools: warning: ${skippedMessage(directory, detail)}\n`;
  const files = { "note.md": "A *note*.\n", "locked/inner.md": "*inner*\n" };
  it("skips the directory with one warning and processes everything else", async () => {
    const root = await fixture(files);
    await restrict(path.join(root, "locked"));
    // A named file and stdin have nothing to do with the directory.
    const named = run(root, ["lint", "note.md"]);
    expect(named.status, named.stderr).toBe(0);
    expect(named.stderr).toBe(
      warning("locked") +
        'note.md:1:3: warn style/emphasis: Use "_" for emphasis.\n' +
        'note.md:1:8: warn style/emphasis: Use "_" for emphasis.\n' +
        "1 file(s) linted; 0 would change.\n",
    );
    const piped = run(root, ["format", "-"], "B *note*.\n");
    expect(piped.status, piped.stderr).toBe(0);
    expect(piped.stdout).toBe("B _note_.\n");
    expect(piped.stderr).toBe(warning("locked"));
    // The whole workspace is processed without the directory, and the warning fails nothing.
    expect(run(root, ["format", "--check"]).status).toBe(1);
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).toBe(warning("locked") + "1 file(s) processed; 1 written.\n");
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A _note_.\n");
    const strict = run(root, ["lint", "--max-warnings", "0"]);
    expect(strict.status, strict.stderr).toBe(0);
    expect(strict.stderr).toBe(warning("locked") + "1 file(s) linted; 0 would change.\n");
  });
  it("lists the directory in the JSON report and keeps stderr empty", async () => {
    const root = await fixture(files);
    await restrict(path.join(root, "locked"));
    const skipped = [
      { path: "locked", type: "directory", code: "EACCES", message: skippedMessage("locked") },
    ];
    const linted = run(root, ["lint", "--json"]);
    expect(linted.status).toBe(0);
    expect(linted.stderr).toBe("");
    expect(Object.keys(JSON.parse(linted.stdout))).toEqual([
      "version",
      "mode",
      "files",
      "written",
      "skipped",
    ]);
    expect(JSON.parse(linted.stdout)).toMatchObject({
      files: [{ path: "note.md" }],
      written: false,
      skipped,
    });
    const piped = run(root, ["format", "-", "--json"], "B *note*.\n");
    expect(piped.status, piped.stderr).toBe(0);
    expect(JSON.parse(piped.stdout)).toMatchObject({
      files: [{ path: "stdin.md", output: "B _note_.\n" }],
      skipped,
    });
    const applied = run(root, ["format", "--write", "--json"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({
      files: [{ path: "note.md", changed: true }],
      written: true,
      skipped,
    });
  });
  it("reports a link into the directory as unchecked, not as missing", async () => {
    const root = await fixture({
      ...files,
      "note.md": "[in](locked/inner.md#part), [dir](locked), and [gone](gone.md).\n",
    });
    await restrict(path.join(root, "locked"));
    const linted = run(root, ["lint"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toBe(
      warning("locked") +
        "note.md:1:1: error links/valid: Local target could not be checked: locked/inner.md#part (no readable match; cannot read locked).\n" +
        "note.md:1:48: error links/valid: Missing local target: gone.md.\n" +
        "1 file(s) linted; 0 would change.\n",
    );
    // The finding has the rule's severity, so a warning does not fail the run.
    const config = path.join(root, "mdtools.config.json");
    await writeFile(config, '{"extends":[],"rules":{"links/valid":"warn"}}');
    const warned = run(root, ["lint", "--json"]);
    expect(warned.status, warned.stderr).toBe(0);
    expect(JSON.parse(warned.stdout).files[0].diagnostics).toMatchObject([
      { rule: "links/valid", severity: "warn", column: 1 },
      { rule: "links/valid", severity: "warn", message: "Missing local target: gone.md." },
    ]);
    expect(run(root, ["lint", "--max-warnings", "1"]).status).toBe(1);
  });
  it("does not call an Obsidian note missing that may be in the directory", async () => {
    const root = await fixture({
      "mdtools.config.json": '{"extends":[],"dialect":"obsidian","rules":{"links/valid":"error"}}',
      "Home.md": "[[Diary]], [[Known]], [[./Diary]], and [[Locked/Diary|there]].\n",
      "Notes/Known.md": "A note.\n",
      "locked/Diary.md": "A note.\n",
    });
    await restrict(path.join(root, "locked"));
    const linted = run(root, ["lint", "--json"]);
    expect(linted.status).toBe(1);
    expect(
      JSON.parse(linted.stdout).files[0].diagnostics.map(
        (item: { message: string }) => item.message,
      ),
    ).toEqual([
      "Local target could not be checked: Diary (no readable match; cannot read locked).",
      "Missing local target: ./Diary.",
      "Local target could not be checked: Locked/Diary (no readable match; cannot read locked).",
    ]);
  });
  it("still fails when the directory, or a path inside it, is named as input", async () => {
    const root = await fixture(files);
    await restrict(path.join(root, "locked"));
    for (const command of [
      ["lint", "locked"],
      ["lint", "note.md", "locked"],
      ["format", "--write", "note.md", "locked"],
    ]) {
      const result = run(root, command);
      expect(result.status, command.join(" ")).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "mdtools: Input cannot be read: locked (EACCES: permission denied)\n",
      );
    }
    // Nothing is written when one of the inputs cannot be read.
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(files["note.md"]);
    const inside = run(root, ["lint", "locked/inner.md"]);
    expect(inside.status).toBe(2);
    expect(inside.stderr).toContain("EACCES");
    expect(inside.stderr).toContain("inner.md");
  });
  it.each([
    ["neither listed nor entered", 0o000],
    ["listed but not entered", 0o444],
    ["entered but not listed", 0o111],
  ])("skips a directory that can be %s", async (_label, mode) => {
    const root = await fixture({ ...files, "note.md": "[in](locked/inner.md)\n" });
    await restrict(path.join(root, "locked"), mode);
    const set = await discover(root, [], []);
    expect(set.selected).toEqual(["note.md"]);
    expect(Object.keys(set.files)).toEqual(["note.md"]);
    expect(set.directories).toEqual(["locked"]);
    expect(set.skipped).toEqual([
      { path: "locked", type: "directory", code: "EACCES", message: skippedMessage("locked") },
    ]);
    const linted = run(root, ["lint"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toContain(warning("locked"));
    expect(linted.stderr).toContain("Local target could not be checked: locked/inner.md");
    // A file in a directory that can be entered is reachable by name, but the tool
    // finds files by listing directories, so it remains an input that cannot be read.
    const inside = run(root, ["lint", "locked/inner.md"]);
    expect(inside.status).toBe(2);
    if (mode === 0o111)
      expect(inside.stderr).toBe(
        "mdtools: Input cannot be read: locked/inner.md (EACCES: permission denied for locked)\n",
      );
  });
  it("skips each unreadable directory once, wherever it is, and nothing below it", async () => {
    const root = await fixture({
      "docs/note.md": "A note.\n",
      "docs/private/deep/inner.md": "*inner*\n",
      "volume/data.md": "*data*\n",
    });
    await restrict(path.join(root, "docs/private"));
    await restrict(path.join(root, "volume"));
    // The directory is inside the named input, not the input itself.
    const linted = run(root, ["lint", "docs"]);
    expect(linted.status, linted.stderr).toBe(0);
    expect(linted.stderr).toBe(
      warning("docs/private") + warning("volume") + "1 file(s) linted; 0 would change.\n",
    );
  });
  it("keeps `ignore` and `--exclude` from pruning discovery, unlike `.gitignore`", async () => {
    const root = await fixture({
      ...files,
      "mdtools.config.json": '{"ignore":["locked/**"]}',
      "note.md": "[in](locked/inner.md)\n",
    });
    await restrict(path.join(root, "locked"));
    // Ignored documents stay link targets, so the directory is still visited.
    const ignored = run(root, ["lint", "--exclude", "locked"]);
    expect(ignored.status).toBe(1);
    expect(ignored.stderr).toContain(warning("locked"));
    expect(ignored.stderr).toContain("Local target could not be checked: locked/inner.md");
    // Git-ignored content is not indexed at all: no warning, and the link is not found.
    await writeFile(path.join(root, ".gitignore"), "locked/\n");
    const gitIgnored = run(root, ["lint"]);
    expect(gitIgnored.status).toBe(1);
    expect(gitIgnored.stderr).toBe(
      "note.md:1:1: error links/valid: Missing local target: locked/inner.md.\n" +
        "1 file(s) linted; 0 would change.\n",
    );
    // Unless it is indexed on request, which needs to read it.
    await writeFile(
      path.join(root, "mdtools.config.json"),
      '{"resolve":{"gitIgnored":true,"nestedRepositories":true}}',
    );
    const indexed = run(root, ["lint"]);
    expect(indexed.status).toBe(1);
    expect(indexed.stderr).toContain(warning("locked"));
    expect(indexed.stderr).toContain("Local target could not be checked: locked/inner.md");
  });
  it("skips a directory whose `.gitignore` may not be read, and writes nothing in it", async () => {
    const tree = {
      "note.md": "A *note* with a [link](sub/a.md).\n",
      "sub/.gitignore": "generated.md\n",
      "sub/a.md": "*a*\n",
      "sub/generated.md": "*generated*\n",
    };
    const root = await fixture(tree);
    await restrict(path.join(root, "sub/.gitignore"));
    // Without the rules, nothing tells which of the directory's files are ignored.
    const applied = run(root, ["format", "--write"]);
    expect(applied.status).toBe(1);
    expect(applied.stderr).toBe(
      warning("sub", " for sub/.gitignore") +
        "note.md:1:17: error links/valid: Local target could not be checked: sub/a.md (no readable match; cannot read sub).\n" +
        "1 file(s) processed; 1 written.\n",
    );
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(
      "A _note_ with a [link](sub/a.md).\n",
    );
    for (const name of ["sub/a.md", "sub/generated.md"] as const)
      expect(await readFile(path.join(root, name), "utf8")).toBe(tree[name]);
    const named = run(root, ["lint", "sub/a.md"]);
    expect(named.status).toBe(2);
    expect(named.stderr).toBe(
      "mdtools: Input cannot be read: sub/a.md (EACCES: permission denied for sub/.gitignore)\n",
    );
  });
  it("fails when the workspace root itself may not be read", async () => {
    const tree = { ".gitignore": "generated/\n", "note.md": "A *note*.\n" };
    const ignoring = await fixture(tree);
    await restrict(path.join(ignoring, ".gitignore"));
    const ignoreRules = run(ignoring, ["format", "--write"]);
    expect(ignoreRules.status).toBe(2);
    expect(ignoreRules.stderr).toBe(
      `mdtools: Workspace root cannot be read: ${ignoring} (EACCES: permission denied for .gitignore)\n`,
    );
    expect(await readFile(path.join(ignoring, "note.md"), "utf8")).toBe(tree["note.md"]);
    const unlisted = await fixture(tree);
    await restrict(unlisted, 0o111);
    const listing = run(unlisted, ["lint"]);
    expect(listing.status).toBe(2);
    expect(listing.stderr).toBe(
      `mdtools: Workspace root cannot be read: ${unlisted} (EACCES: permission denied)\n`,
    );
    const closed = await fixture(tree);
    await restrict(closed);
    await expect(discover(closed, [], [])).rejects.toThrow(
      `Workspace root cannot be read: ${closed} (EACCES: permission denied)`,
    );
    // From the command line, the search for a configuration file is refused first.
    const searching = run(path.dirname(closed), ["lint", "--root", closed]);
    expect(searching.status).toBe(2);
    expect(searching.stderr).toContain("EACCES");
    expect(searching.stderr).toContain("mdtools.config");
    // With a configuration named, the check for a vault is refused first, and says the same.
    const elsewhere = await fixture({ "mdtools.config.json": "{}" });
    const configured = run(elsewhere, [
      "lint",
      "--config",
      "mdtools.config.json",
      "--root",
      closed,
    ]);
    expect(configured.status).toBe(2);
    expect(configured.stderr).toBe(
      `mdtools: Workspace root cannot be read: ${closed} (EACCES: permission denied)\n`,
    );
  });
  it("treats Obsidian settings that may not be read as unverified", async () => {
    const paragraph = `${"A long line of prose in a vault. ".repeat(4).trim()}\n`;
    const root = await fixture({
      "mdtools.config.json": '{"extends":["recommended","obsidian"]}',
      ".obsidian/app.json": '{"strictLineBreaks":true}',
      "Note.md": paragraph,
    });
    expect(run(root, ["format", "--check"]).status).toBe(1);
    await restrict(path.join(root, ".obsidian/app.json"));
    const message =
      "Skipped unreadable settings file: .obsidian/app.json (EACCES: permission denied). Obsidian's strictLineBreaks setting is not verified, so Obsidian documents are not reflowed.";
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).toBe(
      `mdtools: warning: ${message}\n` +
        "Note.md:1:1: warn obsidian/strict-line-breaks: Obsidian strictLineBreaks is not verified true; paragraph reflow is disabled. Set it in Obsidian or supply workspace.strictLineBreaks to the library.\n" +
        "1 file(s) processed; 0 written.\n",
    );
    expect(await readFile(path.join(root, "Note.md"), "utf8")).toBe(paragraph);
    expect(JSON.parse(run(root, ["lint", "--json"]).stdout).skipped).toEqual([
      { path: ".obsidian/app.json", type: "file", code: "EACCES", message },
    ]);
    // The same when the settings directory cannot be entered.
    await restrict(path.join(root, ".obsidian"));
    expect((await discover(root, [], [])).skipped).toEqual([
      { path: ".obsidian/app.json", type: "file", code: "EACCES", message },
    ]);
  });
});

// Skipped on Windows and for root for the same reason as the directory tests above.
describe.skipIf(!canRestrict)("files that may not be read", () => {
  const files = {
    "linking.md": "See [the section](secret.md#section) of [the file](secret.md).\n",
    "note.md": "A *note*.\n",
    "secret.md": "# Section\n",
  };
  const unchecked =
    "linking.md:1:5: error links/valid: Fragment could not be checked: secret.md#section (cannot read secret.md).\n";
  const unread = (verb: string) =>
    `secret.md:1:1: error engine/unreadable-file: The file could not be read (EACCES: permission denied) and was not ${verb}.\n`;
  it("reports the file, processes the others, and ends with status 2", async () => {
    const root = await fixture(files);
    await restrict(path.join(root, "secret.md"));
    const linted = run(root, ["lint"]);
    expect(linted.status).toBe(2);
    expect(linted.stdout).toBe("");
    expect(linted.stderr).toBe(
      unchecked +
        'note.md:1:3: warn style/emphasis: Use "_" for emphasis.\n' +
        'note.md:1:8: warn style/emphasis: Use "_" for emphasis.\n' +
        unread("linted") +
        "2 file(s) linted; 0 would change; 1 could not be read.\n",
    );
    const checked = run(root, ["format", "--check"]);
    expect(checked.status).toBe(2);
    expect(checked.stderr).toBe(
      unchecked +
        unread("formatted") +
        "2 file(s) processed; 1 would change; 1 could not be read.\n",
    );
    const previewed = run(root, ["format"]);
    expect(previewed.status).toBe(2);
    expect(previewed.stdout).toContain("+A _note_.");
    // Naming the file is no different: it was to be processed.
    const named = run(root, ["lint", "secret.md"]);
    expect(named.status).toBe(2);
    expect(named.stderr).toBe(
      unread("linted") + "0 file(s) linted; 0 would change; 1 could not be read.\n",
    );
  });
  it("reports a link to a heading in the file as unchecked without stopping", async () => {
    const root = await fixture(files);
    await restrict(path.join(root, "secret.md"));
    // The run read every file it was asked to process, so the status is that of the findings.
    const linted = run(root, ["lint", "linking.md"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toBe(unchecked + "1 file(s) linted; 0 would change.\n");
    const checked = run(root, ["format", "--check", "linking.md"]);
    expect(checked.status).toBe(1);
    expect(checked.stderr).not.toContain("engine/");
    const piped = run(root, ["format", "-"], "A *link* to [it](secret.md#section).\n");
    expect(piped.status).toBe(1);
    expect(piped.stdout).toBe("A _link_ to [it](secret.md#section).\n");
    // Nothing leads the tool to open the file here.
    const other = run(root, ["lint", "note.md"]);
    expect(other.status, other.stderr).toBe(0);
    expect(run(root, ["lint", "--exclude", "secret.md", "--exclude", "linking.md"]).status).toBe(0);
  });
  it("describes the file in the JSON report like any other diagnostic", async () => {
    const root = await fixture(files);
    await restrict(path.join(root, "secret.md"));
    const linted = run(root, ["lint", "--json"]);
    expect(linted.status).toBe(2);
    expect(linted.stderr).toBe("");
    const report = JSON.parse(linted.stdout);
    expect(Object.keys(report)).toEqual(["version", "mode", "files", "written"]);
    expect(report.files.map((file: { path: string }) => file.path)).toEqual([
      "linking.md",
      "note.md",
      "secret.md",
    ]);
    expect(report.files[2]).toEqual({
      path: "secret.md",
      diagnostics: [
        {
          rule: "engine/unreadable-file",
          severity: "error",
          message: "The file could not be read (EACCES: permission denied) and was not linted.",
          start: 0,
          line: 1,
          column: 1,
        },
      ],
    });
    expect(report.files[0].diagnostics).toMatchObject([
      { rule: "links/valid", severity: "error", line: 1, column: 5 },
    ]);
  });
  it("writes nothing when a file of the batch could not be read", async () => {
    const root = await fixture(files);
    await restrict(path.join(root, "secret.md"));
    const applied = run(root, ["format", "--write", "--json"]);
    expect(applied.status).toBe(2);
    const report = JSON.parse(applied.stdout);
    expect(report.written).toBe(false);
    expect(report.files).toMatchObject([
      { path: "linking.md", changed: false },
      { path: "note.md", changed: true },
      { path: "secret.md", changed: false, diagnostics: [{ rule: "engine/unreadable-file" }] },
    ]);
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(files["note.md"]);
    const text = run(root, ["format", "--write"]);
    expect(text.status).toBe(2);
    expect(text.stderr).toContain("2 file(s) processed; 1 would change; 1 could not be read.\n");
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(files["note.md"]);
    // Leaving the file out of the selection makes the batch complete again.
    const excluded = run(root, ["format", "--write", "--exclude", "secret.md"]);
    expect(excluded.status).toBe(1);
    expect(excluded.stderr).toBe(unchecked + "2 file(s) processed; 1 written.\n");
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A _note_.\n");
  });
});
