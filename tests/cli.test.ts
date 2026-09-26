import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { discover, writeAtomic } from "../src/workspace/files.js";
import { loadConfig } from "../src/config/load.js";

const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const temporary: string[] = [];
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "mdtools-test-"));
  temporary.push(root);
  // Keep discovery inside the fixture even when the host's temp directory is a repository.
  await mkdir(path.join(root, ".git"));
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), value);
  }
  return root;
}
afterEach(async () => {
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});
function run(root: string, args: string[], input?: string) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, input, encoding: "utf8" });
}
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
});
