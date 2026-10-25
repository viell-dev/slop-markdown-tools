import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../../src/workspace/files.js";
import { loadConfig } from "../../src/config/load.js";
import { fixture, linkDirectory, run } from "../support/cli.js";
import { parseExplanation, parseReport } from "../support/json.js";
describe("in an Obsidian vault, without a named dialect", () => {
  // Obsidian shows the first two lines on separate lines unless the vault's "Strict
  // line breaks" setting is on, and a wikilink must stay on one line. Up to 0.2.0-rc.1
  // the note was read as CommonMark: the lines were joined and the wikilink was split.
  const link =
    "[[A fairly long note name that sits near the wrap column of this paragraph|alias text]]";
  const note = `Shopping list\nMilk and eggs\n\nSee ${link} here.\n`;
  const reflowed = `Shopping list Milk and eggs\n\nSee\n${link}\nhere.\n`;
  const asGithub =
    "Shopping list Milk and eggs\n\nSee [[A fairly long note name that sits near the wrap column of this\nparagraph|alias text]] here.\n";
  const target = "A fairly long note name that sits near the wrap column of this paragraph.md";
  const files = { "Note.md": note, [target]: "# Target\n" };
  const dialect = (root: string, file: string, ...flags: string[]) => {
    const explained = run(root, ["config", ...flags, "explain", file]);
    expect(explained.status, explained.stderr).toBe(0);
    return (parseExplanation(explained.stdout) as { effective: { dialect: string } }).effective
      .dialect;
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
    expect(linted.stderr).toBe("2 file(s) linted; 0 error(s), 0 warning(s).\n");
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
  it("reads a settings file that starts with a byte order mark", async () => {
    const root = await vault(`${String.fromCharCode(0xfeff)}{"strictLineBreaks":true}`);
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).not.toContain("warning");
    expect(await readFile(path.join(root, "Note.md"), "utf8")).toBe(reflowed);
  });
  it("assumes the dialect only, so the rules of the obsidian preset still need the preset", async () => {
    const source = "> [!TIP] Title\n> Text.\n";
    const root = await vault(undefined, { "Callout.md": source });
    const explained = parseExplanation(run(root, ["config", "explain", "Callout.md"]).stdout);
    expect(explained.config).toBeNull();
    expect(explained.effective.dialect).toBe("obsidian");
    expect(Object.keys(explained.effective.rules)).not.toContain("obsidian/callout-marker");
    expect(run(root, ["format", "-"], source).stdout).toBe(source);
    const preset = await vault(undefined, {
      "Callout.md": source,
      "mdrefine.config.jsonc": '{ "extends": ["recommended", "obsidian"] }',
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
      const configured = await vault(undefined, { "mdrefine.config.jsonc": config });
      expect(dialect(configured, "Note.md"), config).toBe(expected);
      expect(
        run(configured, ["format", "-", "--stdin-filepath", "Note.md"], note).stdout,
        config,
      ).toBe(output);
    }
    // A configuration that names no dialect leaves the vault's in place, also for
    // the files that an override naming another dialect does not match.
    const unnamed = await vault(undefined, {
      "mdrefine.config.jsonc":
        '{ "rules": { "style/emphasis": "off" }, "overrides": [{ "files": ["docs/**"], "dialect": "github" }] }',
      "docs/page.md": "A page.\n",
    });
    expect(dialect(unnamed, "Note.md")).toBe("obsidian");
    expect(dialect(unnamed, "docs/page.md")).toBe("github");
    expect(run(unnamed, ["format", "--check"]).status).toBe(0);
  });
  it("reads a vault in a folder of a larger workspace as Obsidian, and the rest as GitHub", async () => {
    const page = "A page\nof the project.\n";
    const tree = {
      "README.md": page,
      "vault/.obsidian/app.json": "{}",
      "vault/Note.md": note,
      "vault/Folder/Deep.md": note,
      [`vault/${target}`]: "# Target\n",
    };
    const root = await fixture(tree);
    expect(dialect(root, "README.md")).toBe("github");
    expect(dialect(root, "vault/Note.md")).toBe("obsidian");
    expect(dialect(root, "vault/Folder/Deep.md")).toBe("obsidian");
    // Also for a file that does not exist yet, and from the vault itself.
    expect(dialect(root, "vault/New/Later.md")).toBe("obsidian");
    expect(dialect(root, "vault")).toBe("obsidian");
    expect(dialect(root, ".")).toBe("github");
    expect(dialect(root, "vault/Note.md", "--root", "vault")).toBe("obsidian");
    expect(dialect(path.join(root, "vault"), "Note.md")).toBe("obsidian");
    expect(run(root, ["format", "-", "--stdin-filepath", "vault/Note.md"], note).stdout).toBe(note);
    expect(run(root, ["format", "-", "--stdin-filepath", "README.md"], page).stdout).toBe(
      "A page of the project.\n",
    );
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).toBe("4 file(s) processed; 1 written.\n");
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("A page of the project.\n");
    expect(await readFile(path.join(root, "vault/Note.md"), "utf8")).toBe(note);
    expect(await readFile(path.join(root, "vault/Folder/Deep.md"), "utf8")).toBe(note);
    // A dialect that the configuration names still takes the vault's place.
    const named = await fixture({ ...tree, "mdrefine.config.jsonc": '{ "dialect": "github" }' });
    expect(dialect(named, "vault/Note.md")).toBe("github");
    const overridden = await fixture({
      ...tree,
      "mdrefine.config.jsonc": '{ "overrides": [{ "files": ["vault/**"], "dialect": "gitea" }] }',
    });
    expect(dialect(overridden, "vault/Note.md")).toBe("gitea");
  });
  it("reflows the notes of each vault by that vault's own line-break setting", async () => {
    const root = await fixture({
      // Links are resolved within the whole workspace, where the notes of one vault
      // can match a link in another, so link checking is left out of this test.
      "mdrefine.config.jsonc": '{ "rules": { "links/valid": "off" } }',
      "strict/.obsidian/app.json": '{"strictLineBreaks":true}',
      "strict/Note.md": note,
      "loose/.obsidian/app.json": '{"strictLineBreaks":false}',
      "loose/Note.md": note,
      "unset/.obsidian/app.json": "{}",
      "unset/Note.md": note,
    });
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(await readFile(path.join(root, "strict/Note.md"), "utf8")).toBe(reflowed);
    expect(await readFile(path.join(root, "loose/Note.md"), "utf8")).toBe(note);
    expect(await readFile(path.join(root, "unset/Note.md"), "utf8")).toBe(note);
    expect(run(root, ["format", "--check"]).status).toBe(0);
    // A note of one vault in a folder of another vault belongs to the nearer one.
    const nested = await fixture({
      ".obsidian/app.json": '{"strictLineBreaks":true}',
      "Note.md": note,
      "inner/.obsidian/app.json": "{}",
      "inner/Note.md": note,
    });
    expect(run(nested, ["format", "-", "--stdin-filepath", "Note.md"], note).stdout).toBe(reflowed);
    expect(run(nested, ["format", "-", "--stdin-filepath", "inner/Note.md"], note).stdout).toBe(
      note,
    );
  });
  it("recognizes the vault above a workspace root that is one of its folders", async () => {
    const tree = {
      "vault/.obsidian/app.json": "{}",
      "vault/Folder/Note.md": note,
      [`vault/Folder/${target}`]: "# Target\n",
    };
    const root = await fixture(tree);
    // Named as the root, found from a configuration that names no dialect, and for stdin.
    expect(dialect(root, "vault/Folder/Note.md", "--root", "vault/Folder")).toBe("obsidian");
    const previewed = run(root, ["format", "--root", "vault/Folder", "--diff"]);
    expect(previewed.status, previewed.stderr).toBe(0);
    expect(previewed.stdout).toBe("");
    expect(run(root, ["format", "--root", "vault/Folder", "-"], note).stdout).toBe(note);
    const configured = await fixture({
      ...tree,
      "vault/Folder/mdrefine.config.jsonc": '{ "rules": { "style/emphasis": "off" } }',
    });
    const inside = path.join(configured, "vault/Folder");
    expect(parseExplanation(run(inside, ["config", "explain", "Note.md"]).stdout)).toMatchObject({
      root: inside,
      effective: { dialect: "obsidian" },
    });
    expect(run(inside, ["format", "--write"]).status).toBe(0);
    expect(await readFile(path.join(inside, "Note.md"), "utf8")).toBe(note);
    // The line-break setting is the vault's, read above the root.
    const strict = await fixture({
      ...tree,
      "vault/.obsidian/app.json": '{"strictLineBreaks":true}',
    });
    const applied = run(strict, ["format", "--root", "vault/Folder", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(await readFile(path.join(strict, "vault/Folder/Note.md"), "utf8")).toBe(reflowed);
  });
  it("does not judge or rewrite links in a folder of a vault as if it were the whole vault", async () => {
    // Two notes named `Note`: in Obsidian the bare name reaches the one at the top.
    const index = "See [the deep note](Sub/Note.md) and [[Sub/Note|again]] and [[Elsewhere]].\n";
    const tree = {
      "vault/.obsidian/app.json": "{}",
      "vault/mdrefine.config.jsonc":
        '{ "extends": ["recommended", "obsidian"], "rules": { "obsidian/strict-line-breaks": "off", "links/path": ["warn", { "style": "shortest" }] } }',
      "vault/Note.md": "# Top\n",
      "vault/Elsewhere.md": "# Elsewhere\n",
      "vault/Folder/Index.md": index,
      "vault/Folder/Sub/Note.md": "# Deep\n",
    };
    const root = await fixture(tree);
    expect((await discover(path.join(root, "vault/Folder"), [], [])).vaults).toEqual([
      { path: "", strictLineBreaks: false, rootInVault: "Folder" },
    ]);
    expect((await discover(path.join(root, "vault"), [], [])).vaults).toEqual([
      { path: "", strictLineBreaks: false },
    ]);
    // Up to 0.2.0-rc.1 both links were shortened to `Note`, and `Elsewhere` was called missing.
    const part = run(root, ["format", "--write", "--root", "vault/Folder"]);
    expect(part.status).toBe(1);
    expect(part.stderr).toBe(
      "vault/Folder/Index.md:1:61: error links/valid: Local target could not be checked: Elsewhere (no readable match; the workspace root is only a part of the vault).\n" +
        "2 file(s) processed; 0 written.\n",
    );
    expect(await readFile(path.join(root, "vault/Folder/Index.md"), "utf8")).toBe(index);
    // With the whole vault in sight every link is certain: the short name would reach
    // the other note, so the path from the vault's folder is written.
    const whole = run(root, ["format", "--write", "--root", "vault"]);
    expect(whole.status, whole.stderr).toBe(0);
    expect(whole.stderr).toBe("4 file(s) processed; 1 written.\n");
    expect(await readFile(path.join(root, "vault/Folder/Index.md"), "utf8")).toBe(
      "See [the deep note](Folder/Sub/Note.md) and [[Folder/Sub/Note|again]] and [[Elsewhere]].\n",
    );
    // The folder then accepts those paths, which lead through it from the vault's folder.
    const again = run(root, ["format", "--check", "--root", "vault/Folder"]);
    expect(again.stderr).toBe(
      "vault/Folder/Index.md:1:75: error links/valid: Local target could not be checked: Elsewhere (no readable match; the workspace root is only a part of the vault).\n" +
        "2 file(s) processed; 0 would change.\n",
    );
  });
  it("does not read a repository inside a vault as that vault's notes", async () => {
    const page = "A page\nof the project.\n";
    const root = await fixture({
      ...files,
      ".obsidian/app.json": "{}",
      "project/README.md": page,
      "project/docs/guide.md": page,
    });
    await mkdir(path.join(root, "project/.git"));
    const project = path.join(root, "project");
    // Run in the repository, from its root or from a folder of it.
    expect(dialect(project, "README.md")).toBe("github");
    expect(dialect(project, "docs/guide.md")).toBe("github");
    expect(dialect(root, "project/docs/guide.md", "--root", "project/docs")).toBe("github");
    expect(run(project, ["format", "-"], page).stdout).toBe("A page of the project.\n");
    // Run in the vault, the repository's documents are left alone, as before; text
    // from stdin that is named into the repository is read as the repository's.
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).toBe("2 file(s) processed; 0 written.\n");
    expect(await readFile(path.join(project, "README.md"), "utf8")).toBe(page);
    expect(dialect(root, "project/README.md")).toBe("github");
    expect(run(root, ["format", "-", "--stdin-filepath", "project/README.md"], page).stdout).toBe(
      "A page of the project.\n",
    );
    expect(run(root, ["format", "-", "--stdin-filepath", "Note.md"], note).stdout).toBe(note);
  });
  it("finds the vault of text from stdin that is named into a folder left out of the run", async () => {
    const root = await fixture({
      ".gitignore": "private/\n",
      "README.md": "# Project\n",
      "private/.obsidian/app.json": "{}",
      "private/Note.md": note,
    });
    expect(run(root, ["lint"]).stderr).toBe("1 file(s) linted; 0 error(s), 0 warning(s).\n");
    expect(dialect(root, "private/Note.md")).toBe("obsidian");
    expect(run(root, ["format", "-", "--stdin-filepath", "private/Note.md"], note).stdout).toBe(
      note,
    );
  });
  it("takes a file named .obsidian for no vault", async () => {
    const root = await fixture({ ".obsidian": "", "note.md": "A *note*\nof two lines.\n" });
    expect(dialect(root, "note.md")).toBe("github");
    const linted = run(root, ["lint", "--json"]);
    expect(linted.status, linted.stderr).toBe(0);
    expect(parseReport(linted.stdout).skipped).toBeUndefined();
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).toBe("1 file(s) processed; 1 written.\n");
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A _note_ of two lines.\n");
    // Such a file does not end the search for the workspace root either.
    const outer = await fixture({ "docs/.obsidian": "", "docs/guide/page.md": "A page.\n" });
    expect((await loadConfig(path.join(outer, "docs/guide"))).root).toBe(outer);
  });
  it.each([
    ["cut short", '{ "strictLineBreaks": tru', "not valid JSON"],
    ["empty", "", "not valid JSON"],
  ])("treats a settings file that is %s as unverified", async (_, settings, reason) => {
    const paragraph = `${"A long line of prose in a vault. ".repeat(4).trim()}\n`;
    const root = await fixture({
      "mdrefine.config.json": '{"extends":["recommended","obsidian"]}',
      ".obsidian/app.json": settings,
      "Note.md": paragraph,
    });
    const message = `Skipped unusable settings file: .obsidian/app.json (${reason}). Obsidian's strictLineBreaks setting is not verified for that vault, so its documents are not reflowed.`;
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).toBe(
      `mdrefine: warning: ${message}\n` +
        "Note.md:1:1: warn obsidian/strict-line-breaks: Obsidian's \"Strict line breaks\" setting is not known to be on, so paragraphs are not reflowed. Turn it on in the vault's settings, which keep it in .obsidian/app.json; a program that calls the library passes strictLineBreaks to createWorkspace.\n" +
        "1 file(s) processed; 0 written.\n",
    );
    expect(await readFile(path.join(root, "Note.md"), "utf8")).toBe(paragraph);
    expect(parseReport(run(root, ["lint", "--json"]).stdout).skipped).toEqual([
      { path: ".obsidian/app.json", type: "file", code: "INVALID", message },
    ]);
  });
  it("names the settings file of the vault it belongs to", async () => {
    // A folder in place of the file, in a vault below the root and in one above it.
    const root = await fixture({
      "docs/vault/Folder/Note.md": "A note.\n",
      "README.md": "# Project\n",
    });
    await mkdir(path.join(root, "docs/vault/.obsidian/app.json"), { recursive: true });
    const text = (file: string) =>
      `Skipped unusable settings file: ${file} (not a file). Obsidian's strictLineBreaks setting is not verified for that vault, so its documents are not reflowed.`;
    const below = run(root, ["lint", "--json"]);
    expect(below.status, below.stderr).toBe(0);
    expect(parseReport(below.stdout).skipped).toEqual([
      {
        path: "docs/vault/.obsidian/app.json",
        type: "file",
        code: "INVALID",
        message: text("docs/vault/.obsidian/app.json"),
      },
    ]);
    // The report names it from the root, which lies in the vault; the text from here.
    const above = run(root, ["lint", "--root", "docs/vault/Folder"]);
    expect(above.status, above.stderr).toBe(0);
    expect(above.stderr).toBe(
      `mdrefine: warning: ${text("docs/vault/.obsidian/app.json")}\n1 file(s) linted; 0 error(s), 0 warning(s).\n`,
    );
    const report = run(root, ["lint", "--root", "docs/vault/Folder", "--json"]);
    expect(parseReport(report.stdout).skipped).toMatchObject([
      { path: "../.obsidian/app.json", message: text("../.obsidian/app.json") },
    ]);
    const inside = run(path.join(root, "docs/vault/Folder"), ["lint"]);
    expect(inside.stderr).toBe(
      `mdrefine: warning: ${text("../.obsidian/app.json")}\n1 file(s) linted; 0 error(s), 0 warning(s).\n`,
    );
  });
  it("recognizes a vault whose settings folder is a link to a shared one", async () => {
    const root = await fixture({
      "shared/app.json": '{"strictLineBreaks":true}',
      "vault/Note.md": note,
      [`vault/${target}`]: "# Target\n",
      "broken/Note.md": note,
    });
    await linkDirectory(path.join(root, "shared"), path.join(root, "vault/.obsidian"));
    await linkDirectory(path.join(root, "nowhere"), path.join(root, "broken/.obsidian"));
    expect(dialect(root, "vault/Note.md")).toBe("obsidian");
    expect(run(root, ["format", "-", "--stdin-filepath", "vault/Note.md"], note).stdout).toBe(
      reflowed,
    );
    const applied = run(root, ["format", "--write", "vault"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(await readFile(path.join(root, "vault/Note.md"), "utf8")).toBe(reflowed);
    // A link that leads nowhere is no settings folder.
    expect(dialect(root, "broken/Note.md")).toBe("github");
  });
});
