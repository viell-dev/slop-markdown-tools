import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverWorkspace } from "../../src/node.js";
import { discover } from "../../src/workspace/files.js";
import { fixture, linkDirectory, run } from "./support.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
/** Where letter case is ignored by default, by Git and by the file system. */
const foldsCase = process.platform === "win32" || process.platform === "darwin";
/** The paths of a report's files. */
const paths = (stdout: string) =>
  (JSON.parse(stdout) as { files: { path: string }[] }).files.map((file) => file.path);

/**
 * The paths among `names` that Git ignores in the repository at `root`, by its
 * own `.gitignore` files alone: without the user's and the system's settings
 * and without a global excludes file, which would differ between machines.
 */
async function gitIgnored(root: string, names: string[]): Promise<string[]> {
  const init = spawnSync("git", ["init", "-q", "."], { cwd: root, encoding: "utf8" });
  expect(init.status, init.stderr).toBe(0);
  const none = path.join(root, ".git", "no-settings");
  await writeFile(none, "");
  const checked = spawnSync(
    "git",
    ["-c", `core.excludesFile=${none}`, "check-ignore", "--no-index", "--stdin"],
    {
      cwd: root,
      input: names.join("\n") + "\n",
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: none, GIT_CONFIG_NOSYSTEM: "1" },
    },
  );
  // Status 1 means that nothing is ignored.
  expect([0, 1], checked.stderr).toContain(checked.status);
  return checked.stdout.split("\n").filter(Boolean);
}

describe(".gitignore files", () => {
  const files = {
    ".gitignore": [
      "/*.md",
      "!/index.md",
      "docs/*.md",
      "build/",
      "generated/",
      "draft.md",
      "Notes/",
      "logs/*",
      "!logs/keep/",
      "",
    ].join("\n"),
    // A deeper file overrides a higher one, also after a byte order mark.
    "docs/.gitignore": `${String.fromCharCode(0xfeff)}!keep.md\n`,
    // It can include a folder again that a higher file excludes...
    "src/.gitignore": "!build/\n",
    // ...but nothing below a folder that stays excluded.
    "generated/.gitignore": "!x.md\n",
    "index.md": "See [keep](docs/keep.md) and [built](src/build/b.md).\n",
    "top.md": "Top.\n",
    "docs/keep.md": "# Keep\n",
    "docs/other.md": "Other.\n",
    "docs/deep/inner.md": "Inner.\n",
    "build/out.md": "Out.\n",
    "src/build/b.md": "Built.\n",
    "src/build/sub/c.md": "Built.\n",
    "generated/x.md": "Generated.\n",
    "cases/Draft.md": "A draft.\n",
    "notes/n.md": "A note.\n",
    "logs/a.md": "A log.\n",
    "logs/keep/b.md": "A kept log.\n",
  };
  const documents = Object.keys(files).filter((name) => name.endsWith(".md"));

  it.skipIf(!hasGit)("leave out exactly the files that Git ignores", async () => {
    const root = await fixture(files);
    const ignored = await gitIgnored(root, documents);
    const set = await discover(root, [], []);
    expect(set.selected).toEqual(documents.filter((name) => !ignored.includes(name)).sort());
    // What Git decides here, so that the comparison covers each case.
    expect(set.selected).toEqual(
      expect.arrayContaining(["index.md", "docs/keep.md", "src/build/b.md", "logs/keep/b.md"]),
    );
    expect(set.selected).not.toContain("generated/x.md");
    expect(set.selected.includes("cases/Draft.md")).toBe(!foldsCase);
    expect(set.selected.includes("notes/n.md")).toBe(!foldsCase);
  });
  it("leave link targets that Git does not ignore in the index", async () => {
    const root = await fixture(files);
    const checked = run(root, ["lint", "--json", "index.md"]);
    expect(checked.status, checked.stdout).toBe(0);
  });
});

describe("named inputs", () => {
  const files = {
    "mdtools.config.json": JSON.stringify({
      extends: ["recommended", "github"],
      ignore: ["drafts/**"],
    }),
    ".gitignore": "generated/\nskip.md\n",
    "guide.md": "# Guide\n\nSee [the readme](README.markdown#read-me).\n",
    "README.markdown": "# Read me\n\nSee [the notes](notes.txt#notes).\n",
    "notes.txt": "# Notes\n\nA *note*.\n",
    "generated/out.md": "Out.\n",
    "skip.md": "Skipped.\n",
    "drafts/draft.md": "A draft.\n",
    "node_modules/package/readme.md": "A package.\n",
    "vendor/.git/HEAD": "ref: refs/heads/main\n",
    "vendor/inner.md": "Inner.\n",
  };

  it("find .markdown files in folders, whose headings are link targets", async () => {
    const root = await fixture(files);
    const checked = run(root, ["lint", "--json"]);
    expect(paths(checked.stdout)).toEqual(["README.markdown", "guide.md"]);
    const reports = JSON.parse(checked.stdout).files as {
      path: string;
      diagnostics: { message: string }[];
    }[];
    // A text file's headings are no anchors, also when it is linted as Markdown.
    expect(reports.find((file) => file.path === "guide.md")!.diagnostics).toEqual([]);
    expect(reports.find((file) => file.path === "README.markdown")!.diagnostics).toEqual([
      expect.objectContaining({ message: "Missing fragment in notes.txt#notes." }),
    ]);
  });
  it("read a named file as Markdown whatever its name", async () => {
    const root = await fixture(files);
    const checked = run(root, ["lint", "--json", "notes.txt"]);
    expect(checked.status, checked.stderr).toBe(0);
    const emphasis = expect.objectContaining({ rule: "style/emphasis" });
    expect(JSON.parse(checked.stdout).files).toEqual([
      { path: "notes.txt", diagnostics: [emphasis, emphasis] },
    ]);
    expect(run(root, ["format", "--check", "notes.txt"]).status).toBe(1);
    const written = run(root, ["format", "--write", "notes.txt"]);
    expect(written.status, written.stderr).toBe(0);
    expect(written.stderr).toBe("1 file(s) processed; 1 written.\n");
  });
  it("say on stderr why an ignored one is skipped, without changing the exit code", async () => {
    const root = await fixture(files);
    const named = [
      "generated/out.md",
      "skip.md",
      "drafts/draft.md",
      "node_modules/package/readme.md",
      "vendor/inner.md",
      "vendor",
      "generated",
    ];
    const checked = run(root, ["lint", "guide.md", ...named]);
    expect(checked.status, checked.stderr).toBe(0);
    const note = (name: string, reason: string, folder = false) =>
      `mdtools: warning: Skipped ignored input: ${name} (${reason}). ${folder ? "Its files are" : "It is"} not processed.\n`;
    expect(checked.stderr).toBe(
      note("drafts/draft.md", `matched by the configuration's ignore pattern "drafts/**"`) +
        note("generated", `matched by "generated/" in .gitignore`, true) +
        note("generated/out.md", `in generated, which "generated/" in .gitignore matches`) +
        note(
          "node_modules/package/readme.md",
          "in node_modules, which discovery always leaves out",
        ) +
        note("skip.md", `matched by "skip.md" in .gitignore`) +
        note("vendor", "a nested repository", true) +
        note("vendor/inner.md", "in vendor, a nested repository") +
        "1 file(s) linted; 0 error(s), 0 warning(s).\n",
    );
    const reported = run(root, ["lint", "--json", "skip.md", "vendor"]);
    expect(reported.status, reported.stderr).toBe(0);
    expect(reported.stderr).toBe("");
    expect(JSON.parse(reported.stdout)).toMatchObject({
      files: [],
      skipped: [
        { path: "skip.md", type: "file", code: "IGNORED" },
        { path: "vendor", type: "directory", code: "IGNORED" },
      ],
    });
    // Still skipped when ignored files are link targets.
    const targets = await discover(root, [path.join(root, "generated/out.md")], [], {
      gitIgnored: true,
      nestedRepositories: true,
    });
    expect(targets.selected).toEqual([]);
    expect(targets.skipped).toEqual([expect.objectContaining({ code: "IGNORED" })]);
  });
  it("are reported the same way by mdrefine/node", async () => {
    const root = await fixture(files);
    const discovery = await discoverWorkspace({
      root,
      inputs: ["notes.txt", "skip.md"],
      config: { ignore: ["drafts/**"] },
    });
    expect(discovery.selected).toEqual(["notes.txt"]);
    expect(discovery.read("notes.txt")).toBe(files["notes.txt"]);
    expect(discovery.skipped).toEqual(
      JSON.parse(run(root, ["lint", "--json", "notes.txt", "skip.md"]).stdout).skipped,
    );
  });
});

describe("input patterns", () => {
  const files = {
    "mdtools.config.json": '{"ignore":["docs/drafts/**"]}',
    ".gitignore": "generated/\n",
    "docs/a.md": "A.\n",
    "docs/sub/b.md": "B.\n",
    "docs/sub/c.markdown": "C.\n",
    "docs/sub/notes.txt": "Notes.\n",
    "docs/drafts/d.md": "D.\n",
    "generated/g.md": "G.\n",
    "other/o.md": "O.\n",
    ".github/t.md": "T.\n",
    "[x].md": "X.\n",
  };
  const selects = (root: string, args: string[], expected: string[], cwd = root) => {
    const checked = run(cwd, ["lint", "--json", ...args]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(paths(checked.stdout), args.join(" ")).toEqual(expected);
  };
  const fails = (root: string, args: string[], message: string) => {
    const checked = run(root, ["lint", ...args]);
    expect(checked.status, args.join(" ")).toBe(2);
    expect(checked.stderr, args.join(" ")).toBe(`mdtools: ${message}\n`);
  };

  it("select the documents that discovery finds and that they match", async () => {
    const root = await fixture(files);
    selects(root, ["docs/**/*.md"], ["docs/a.md", "docs/sub/b.md"]);
    selects(root, ["docs/**"], ["docs/a.md", "docs/sub/b.md", "docs/sub/c.markdown"]);
    selects(root, ["docs/*"], ["docs/a.md"]);
    selects(
      root,
      ["**/*.md"],
      [".github/t.md", "[x].md", "docs/a.md", "docs/sub/b.md", "other/o.md"],
    );
    selects(root, ["{docs,other}/*.md"], ["docs/a.md", "other/o.md"]);
    selects(root, ["docs/sub/?.*"], ["docs/sub/b.md", "docs/sub/c.markdown"]);
    // A path that exists is a path, also when it holds pattern characters.
    selects(root, ["[x].md"], ["[x].md"]);
    // Relative to the current directory, as paths are.
    selects(root, ["--root", "..", "*.md"], ["docs/a.md"], path.join(root, "docs"));
    selects(root, [`${root.split(path.sep).join("/")}/other/*.md`], ["other/o.md"]);
    if (foldsCase) selects(root, ["DOCS/*.MD"], ["docs/a.md"]);
  });
  it("that match no document are an error", async () => {
    const root = await fixture(files);
    fails(root, ["generated/*.md"], "Input pattern matches no document: generated/*.md");
    fails(root, ["docs/drafts/*.md"], "Input pattern matches no document: docs/drafts/*.md");
    fails(root, ["absent/**/*.md"], "Input pattern matches no document: absent/**/*.md");
    fails(root, ["docs/*.txt"], "Input pattern matches no document: docs/*.txt");
    fails(
      root,
      ["docs\\*.md"],
      "Input pattern matches no document: docs\\*.md (patterns separate folders with /)",
    );
    fails(root, ["--root", "docs", "*.md"], "Input is outside the workspace: *.md");
    if (!foldsCase) fails(root, ["DOCS/*.MD"], "Input pattern matches no document: DOCS/*.MD");
  });
  it("are matched from the root by mdrefine/node", async () => {
    const root = await fixture(files);
    const discovery = await discoverWorkspace({ root, inputs: ["docs/sub/*"] });
    expect(discovery.selected).toEqual(["docs/sub/b.md", "docs/sub/c.markdown"]);
  });
});

describe("link targets in folders that discovery does not enter", () => {
  const files = {
    "mdtools.config.json": '{"extends":["recommended","github"]}',
    "index.md": [
      "[Guide](dist/guide.md#guide), [report](docs/coverage/report.md),",
      "[package](node_modules/package/readme.md), [folder](dist/),",
      "[cache](.npm-cache/notes.md), and [linked](linked/note.md#note).",
      "",
    ].join("\n"),
    "dist/guide.md": "# Guide\n\n*untouched*\n",
    "docs/coverage/report.md": "# Report\n",
    "node_modules/package/readme.md": "# Package\n",
    ".npm-cache/notes.md": "# Notes\n",
    "notes/note.md": "# Note\n",
  };
  const findings = (stdout: string) =>
    (JSON.parse(stdout) as { files: { path: string; diagnostics: { message: string }[] }[] }).files
      .flatMap((file) => file.diagnostics.map((item) => `${file.path}: ${item.message}`))
      .filter((message) => !message.includes("Reflow"));

  it("are found on disk when a link names them, and are still not processed", async () => {
    const root = await fixture(files);
    await linkDirectory(path.join(root, "notes"), path.join(root, "linked"));
    const checked = run(root, ["lint", "--json"]);
    expect(checked.status, checked.stdout).toBe(0);
    expect(findings(checked.stdout)).toEqual([]);
    // .npm-cache is an ordinary folder now; dist, coverage, and node_modules are not processed.
    expect(paths(checked.stdout)).toEqual([".npm-cache/notes.md", "index.md", "notes/note.md"]);
    const written = run(root, ["format", "--write"]);
    expect(written.status, written.stderr).toBe(0);
    expect(await readFile(path.join(root, "dist/guide.md"), "utf8")).toBe(files["dist/guide.md"]);
  });
  it("are missing when nothing is there, and keep their fragments", async () => {
    const root = await fixture({
      ...files,
      "index.md": "[a](dist/absent.md), [b](dist/guide.md#nope), [c](dist/guide.md/), [d](dist)\n",
    });
    const checked = run(root, ["lint", "--json"]);
    expect(findings(checked.stdout)).toEqual([
      "index.md: Missing local target: dist/absent.md.",
      "index.md: Missing fragment in dist/guide.md#nope.",
      "index.md: Missing local target: dist/guide.md/.",
    ]);
  });
  it("cannot be checked where a link leads outside the workspace root", async () => {
    const root = await fixture({ ...files, "index.md": "[a](out/thing.md) and [[out/thing]]\n" });
    const elsewhere = await fixture({ "thing.md": "# Thing\n" });
    await linkDirectory(elsewhere, path.join(root, "out"));
    const checked = run(root, ["lint", "--json"]);
    expect(findings(checked.stdout)).toEqual([
      "index.md: Local target could not be checked: out/thing.md (out leads outside the workspace root, which the tool does not read).",
    ]);
    const note = run(root, ["lint", "--json", "--dialect", "obsidian"]);
    expect(findings(note.stdout)).toEqual([
      "index.md: Local target could not be checked: out/thing.md (out leads outside the workspace root, which the tool does not read).",
      "index.md: Local target could not be checked: out/thing (out leads outside the workspace root, which the tool does not read).",
    ]);
  });
  it("are found by Obsidian paths without regard to case", async () => {
    const root = await fixture({
      ...files,
      "index.md": "[[dist/guide#Guide]], [[DIST/Guide.md]], and [[linked/note#Note]]\n",
    });
    await linkDirectory(path.join(root, "notes"), path.join(root, "linked"));
    const checked = run(root, ["lint", "--json", "--dialect", "obsidian"]);
    expect(findings(checked.stdout)).toEqual(
      foldsCase ? [] : ["index.md: Missing local target: DIST/Guide.md."],
    );
  });
  it("stay missing in a folder that Git ignores, unless ignored files are link targets", async () => {
    const root = await fixture({ ...files, ".gitignore": "dist/\n" });
    await linkDirectory(path.join(root, "notes"), path.join(root, "linked"));
    // On GitHub, files that Git ignores are not there.
    const checked = run(root, ["lint", "--json", "index.md"]);
    expect(findings(checked.stdout)).toEqual([
      "index.md: Missing local target: dist/guide.md#guide.",
      "index.md: Missing local target: dist/.",
    ]);
    await writeFile(
      path.join(root, "mdtools.config.json"),
      '{"extends":["recommended","github"],"resolve":{"gitIgnored":true}}',
    );
    expect(findings(run(root, ["lint", "--json", "index.md"]).stdout)).toEqual([]);
  });
  it("are found the same way by mdrefine/node", async () => {
    const root = await fixture(files);
    const discovery = await discoverWorkspace({ root, inputs: ["index.md"] });
    const resolved = discovery
      .options("index.md")
      .workspace!.resolve("index.md", "dist/guide.md#guide", "github");
    expect(resolved).toMatchObject({
      status: "resolved",
      target: "dist/guide.md",
      fragmentExists: true,
    });
  });
});
