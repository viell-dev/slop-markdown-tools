import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { lint } from "../../../dist/index.js";
import { discoverWorkspace } from "../../../dist/node.js";

const scenario = process.argv[2];
const root = await mkdtemp(path.join(tmpdir(), "mdtools-skipped-case-"));
const outside = await mkdtemp(path.join(tmpdir(), "mdtools-outside-case-"));
const config = { extends: [], dialect: "obsidian", rules: { "links/valid": "error" } };
const write = async (name, text = "# Target\n") => {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), text);
};
const link = (target, name) => symlink(target, path.join(root, name), "junction");
const discovery = () => discoverWorkspace({ root, inputs: ["note.md"], config });
const resolve = (workspace, destination, dialect = "obsidian") =>
  workspace.options("note.md").workspace.resolve("note.md", destination, dialect, true);
try {
  await mkdir(path.join(root, ".git"));
  await write("note.md", "[[dist/foo.md#Target]]\n");
  if (scenario === "basic") {
    for (const name of [
      "dist/Foo.md",
      "dist/Nested/Leaf.md",
      "dist/Étage/Écho.md",
      "normal/Foo.md",
    ])
      await write(name);
    await write("dist/Images/Icon.PNG", Uint8Array.of(255));
    const workspace = await discovery();
    assert.deepEqual(workspace.selected, ["note.md"]);
    const cases = [
      ["dist/foo.md#Target", "dist/Foo.md"],
      ["DIST/FOO#Target", "dist/Foo.md"],
      ["dist/nested/leaf.md#Target", "dist/Nested/Leaf.md"],
      ["DiSt/NeStEd/LeAf#Target", "dist/Nested/Leaf.md"],
      ["dist/étage/écho#Target", "dist/Étage/Écho.md"],
      ["normal/foo.md#Target", "normal/Foo.md"],
      ["dist/images/icon.png", "dist/Images/Icon.PNG"],
    ];
    for (const [destination, expected] of cases) {
      const found = resolve(workspace, destination);
      assert.equal(found.status, "resolved", destination);
      assert.equal(found.target, expected, destination);
      assert.equal(found.fragmentExists, true, destination);
    }
    assert.deepEqual(lint(workspace.read("note.md"), workspace.options("note.md")), []);
    assert.equal(resolve(workspace, "dist/Foo.md#target", "github").status, "resolved");
    if (process.platform === "linux") {
      for (const dialect of ["github", "commonmark", "forgejo", "gitea"]) {
        assert.equal(resolve(workspace, "dist/foo.md", dialect).status, "missing");
      }
    }
    assert.equal(resolve(workspace, "dist/nested/missing.md").status, "missing");
    // Searching by name still covers indexed files only.
    assert.equal(resolve(workspace, "Leaf").status, "missing");
    await write("mdtools.config.json", JSON.stringify(config));
    const cli = fileURLToPath(new URL("../../../dist/cli/main.js", import.meta.url));
    const checked = spawnSync(process.execPath, [cli, "lint", "note.md", "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(JSON.parse(checked.stdout).files, [{ path: "note.md", diagnostics: [] }]);
    assert.equal(await readFile(path.join(root, "note.md"), "utf8"), "[[dist/foo.md#Target]]\n");
  } else if (scenario === "ambiguous") {
    for (const name of [
      "dist/Twin.md",
      "dist/TWIN.md",
      "dist/Sub/Leaf.md",
      "dist/SUB/LEAF.md",
      "dist/Part/Only.md",
      "dist/PART/Else.md",
      "one/Target.md",
      "two/Target.md",
    ])
      await write(name);
    await link(path.join(root, "one"), "Jump");
    await link(path.join(root, "two"), "JUMP");
    const workspace = await discovery();
    for (const destination of [
      "dist/twin.md#Target",
      "dist/Twin.md#Target",
      "dist/sub/leaf.md",
      "jump/target.md",
    ]) {
      assert.equal(resolve(workspace, destination).status, "ambiguous", destination);
    }
    const unique = resolve(workspace, "dist/part/only.md#Target");
    assert.equal(unique.status, "resolved");
    assert.equal(unique.target, "dist/Part/Only.md");
    assert.deepEqual(workspace.selected, ["note.md"]);
  } else if (scenario === "security") {
    await write("real/Contained/Foo.md");
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(outside, "Hidden.md"), "# Outside\n");
    await link(path.join(root, "real/Contained"), "dist/Link");
    await link(outside, "dist/Exit");
    await link(path.join(root, "real"), "Jump");
    await link(outside, "Out");
    const workspace = await discovery();
    for (const destination of ["dist/link/foo.md#Target", "JUMP/contained/foo.md#Target"]) {
      assert.equal(resolve(workspace, destination).status, "resolved", destination);
    }
    for (const [destination, through] of [
      ["dist/exit/hidden.md#Outside", "dist/Exit"],
      ["OUT/hidden.md#Outside", "Out"],
    ]) {
      const found = resolve(workspace, destination);
      assert.equal(found.status, "unreadable", destination);
      assert.equal(found.leavesRoot, through, destination);
    }
    assert.equal(resolve(workspace, "dist/Exit/Hidden.md", "github").status, "unreadable");
    assert.deepEqual(workspace.selected, ["note.md"]);
  } else if (scenario === "unreadable") {
    assert.notEqual(process.platform, "win32");
    assert.notEqual(process.getuid?.(), 0);
    await write("dist/Hidden/Foo.md");
    await chmod(path.join(root, "dist/Hidden"), 0);
    try {
      const workspace = await discovery();
      const found = resolve(workspace, "dist/hidden/foo.md#Target");
      assert.equal(found.status, "unreadable");
      assert.deepEqual(found.unreadable, ["dist/Hidden"]);
    } finally {
      await chmod(path.join(root, "dist/Hidden"), 0o700);
    }
  } else throw new Error(`Unknown scenario: ${scenario}`);
  process.stdout.write(JSON.stringify({ scenario, ok: true }));
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
}
