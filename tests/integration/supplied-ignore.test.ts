import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { discoverWorkspace } from "../../src/node.js";
import { fixture, run, tree } from "./support.js";

const git = (root: string, args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
const source = "A *word*.\n";
const snapshot = async (root: string) => ({
  files: await tree(root),
  paths: (await readdir(root, { recursive: true })).sort(),
});
const scenarios = [
  { label: "file pattern", rules: "*.md\n", name: "new/sub/note.md", ignored: true },
  {
    label: "markdown extension",
    rules: "*.markdown\n",
    name: "new/sub/note.markdown",
    ignored: true,
  },
  { label: "ignored parent", rules: "new/\n", name: "new/sub/note.md", ignored: true },
  {
    label: "negation below ignored parent",
    rules: "new/\n!new/sub/keep.md\n",
    name: "new/sub/keep.md",
    ignored: true,
  },
  { label: "file negation", rules: "*.md\n!keep.md\n", name: "new/sub/keep.md", ignored: false },
  {
    label: "parent negation",
    rules: "new/*\n!new/sub/\nnew/sub/*\n!new/sub/keep.md\n",
    name: "new/sub/keep.md",
    ignored: false,
  },
];

it.each(scenarios)(
  "applies $label to a missing supplied path as Git does (#453)",
  async ({ rules, name, ignored }) => {
    const root = await fixture({ ".gitignore": rules });
    git(root, ["init", "-q"]);
    const reference = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", name], {
      cwd: root,
    });
    expect(reference.status).toBe(ignored ? 0 : 1);
    const options = { root, inputs: [], documents: { [name]: source } };
    const before = await snapshot(root);
    const absent = await discoverWorkspace(options);
    expect(absent.selected).toEqual(ignored ? [] : [name]);
    expect(absent.skipped).toEqual(
      ignored ? [expect.objectContaining({ path: name, code: "IGNORED" })] : [],
    );
    const targets = await discoverWorkspace({
      ...options,
      config: { resolve: { gitIgnored: true } },
    });
    expect(targets.selected).toEqual(absent.selected);
    expect(targets.skipped).toEqual(absent.skipped);
    expect(await snapshot(root)).toEqual(before);
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    const present = await discoverWorkspace(options);
    expect(present.selected).toEqual(absent.selected);
    expect(present.skipped).toEqual(absent.skipped);
  },
);

it("compares virtual paths with the repository's case setting", async () => {
  const root = await fixture({ ".gitignore": "NEW/**\n" });
  git(root, ["init", "-q"]);
  const name = "new/sub/note.md";
  for (const folded of [true, false]) {
    git(root, ["config", "core.ignoreCase", String(folded)]);
    const reference = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", name], {
      cwd: root,
    });
    expect(reference.status).toBe(folded ? 0 : 1);
    const before = await snapshot(root);
    const result = await discoverWorkspace({ root, inputs: [], documents: { [name]: source } });
    expect(result.selected).toEqual(folded ? [] : [name]);
    expect(await snapshot(root)).toEqual(before);
  }
});

it("uses the nearest existing ancestor's rules for multiple supplied branches", async () => {
  const root = await fixture({
    ".gitignore": "*.md\n",
    "existing/.gitignore": "!keep.md\n*.markdown\n",
  });
  const documents = {
    "existing/new/sub/keep.md": source,
    "existing/new/sub/note.md": source,
    "existing/other/note.markdown": source,
    "outside/new/keep.md": source,
  };
  const before = await snapshot(root);
  const result = await discoverWorkspace({ root, inputs: [], documents });
  expect(result.selected).toEqual(["existing/new/sub/keep.md"]);
  expect(result.skipped.map((item) => [item.path, item.code])).toEqual([
    ["existing/new/sub/note.md", "IGNORED"],
    ["existing/other/note.markdown", "IGNORED"],
    ["outside/new/keep.md", "IGNORED"],
  ]);
  expect(await snapshot(root)).toEqual(before);
});

it("honors repository-top rules, info/exclude, and the configured global excludes file", async () => {
  const root = await fixture({
    ".gitignore": "workspace/**/*.md\n",
    "workspace/.keep": "",
    ".git/info/exclude": "workspace/**/*.markdown\n",
    ".git/global-ignore": "workspace/**/global.txt\n",
  });
  git(root, ["init", "-q"]);
  // Windows CI may give TEMP through an 8.3 alias. Discovery uses canonical
  // repository paths, so configure this file by the same spelling.
  git(root, ["config", "core.excludesFile", await realpath(path.join(root, ".git/global-ignore"))]);
  const before = await snapshot(root);
  const result = await discoverWorkspace({
    root: path.join(root, "workspace"),
    inputs: [],
    documents: {
      "new/a.md": source,
      "new/b.markdown": source,
      "new/global.txt": source,
      "new/visible.txt": source,
    },
  });
  expect(result.selected).toEqual(["new/visible.txt"]);
  expect(result.skipped.map((item) => item.path)).toEqual([
    "new/a.md",
    "new/b.markdown",
    "new/global.txt",
  ]);
  expect(result.skipped.map((item) => item.message).join("\n")).toContain("../.git/info/exclude");
  expect(result.skipped.map((item) => item.message).join("\n")).toContain("../.git/global-ignore");
  expect(await snapshot(root)).toEqual(before);
});

it("keeps a tracked supplied file selected after its ignored parent disappears", async () => {
  const name = "new/sub/note.md";
  const root = await fixture({ ".gitignore": "new/\n", [name]: source });
  git(root, ["init", "-q"]);
  git(root, ["add", "-f", "--", name]);
  await rm(path.join(root, "new"), { recursive: true });
  const before = await snapshot(root);
  const result = await discoverWorkspace({
    root,
    inputs: [],
    documents: { [name]: source, "new/sub/other.md": source },
  });
  expect(result.selected).toEqual([name]);
  expect(result.read(name)).toBe(source);
  expect(result.skipped).toEqual([
    expect.objectContaining({ path: "new/sub/other.md", code: "IGNORED" }),
  ]);
  expect(await snapshot(root)).toEqual(before);
});

it("uses a nested repository's own rules without scanning unrelated nested paths", async () => {
  const root = await fixture({
    ".gitignore": "*.md\n",
    "nested/.gitignore": "*.md\n!keep.md\n",
    "nested/unrelated/other.md": "# Target\n",
  });
  git(root, ["init", "-q"]);
  git(path.join(root, "nested"), ["init", "-q"]);
  const before = await snapshot(root);
  const result = await discoverWorkspace({
    root,
    inputs: [],
    documents: { "nested/new/keep.md": source, "nested/new/note.md": source },
  });
  expect(result.selected).toEqual(["nested/new/keep.md"]);
  expect(result.skipped).toEqual([
    expect.objectContaining({ path: "nested/new/note.md", code: "IGNORED" }),
  ]);
  expect(
    result
      .options("nested/new/keep.md")
      .workspace?.resolve("nested/new/keep.md", "../unrelated/other.md", "github").status,
  ).toBe("missing");
  expect(await snapshot(root)).toEqual(before);
});

it("keeps ignored stdin text unchanged in formatting and reporting modes", async () => {
  const root = await fixture({
    ".gitignore": "*.md\n",
    "mdrefine.config.json": '{"extends":[],"rules":{"style/emphasis":"warn"}}',
  });
  const before = await snapshot(root);
  const filepath = ["-", "--stdin-filepath", "new/sub/note.md"];
  for (const args of [
    ["format", ...filepath],
    ["format", ...filepath, "--no-warn-ignored"],
  ]) {
    const result = run(root, args, source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(source);
  }
  for (const args of [["lint"], ["format", "--check"], ["format", "--diff"]]) {
    const result = run(root, [...args, ...filepath], source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Skipped ignored input: new/sub/note.md");
    const json = run(root, [...args, ...filepath, "--json"], source);
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      files: [],
      skipped: [{ path: "new/sub/note.md", code: "IGNORED" }],
    });
    expect(json.stderr).toBe("");
  }
  expect(await snapshot(root)).toEqual(before);
});
