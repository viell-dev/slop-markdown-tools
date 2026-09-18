import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { discover, writeAtomic } from "../src/workspace/files.js";
import { loadConfig } from "../src/config/load.js";

const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const temporary: string[] = [];
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "mdtools-test-"));
  temporary.push(root);
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
  it("checks Obsidian settings and resolves block references on disk", async () => {
    const root = await fixture({
      "mdtools.config.json": '{"extends":["recommended","obsidian"]}',
      ".obsidian/app.json": '{"strictLineBreaks":true}',
      "note.md": "[[target#^id]]\n",
      "target.md": "A block. ^id\n",
    });
    expect(run(root, ["lint", "."]).status).toBe(0);
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
  it("ships an executable CLI entry point", () => {
    expect(execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" })).toMatch(
      /^0\.1\.0-alpha\.1/,
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
  it("finds the vault boundary when invoked from a subdirectory", async () => {
    const root = await fixture({ ".obsidian/app.json": "{}", "sub/note.md": "text" });
    expect((await loadConfig(path.join(root, "sub"))).root).toBe(root);
  });
});
