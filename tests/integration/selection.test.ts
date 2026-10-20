import { spawnSync } from "node:child_process";
import { appendFile, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverWorkspace } from "../../src/node.js";
import { discover } from "../../src/workspace/files.js";
import { canRestrict, denyRead, fixture, linkDirectory, restrict, run } from "./support.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
/** Where letter case is ignored by default, by Git and by the file system. */
const foldsCase = process.platform === "win32" || process.platform === "darwin";
/** The paths of a report's files. */
const paths = (stdout: string) =>
  (JSON.parse(stdout) as { files: { path: string }[] }).files.map((file) => file.path);

afterEach(() => {
  vi.unstubAllEnvs();
});
/** Run Git in `cwd` and fail the test if it fails. */
function git(cwd: string, args: string[]): void {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(done.status, done.stderr).toBe(0);
}
/**
 * The paths among `names`, relative to `directory`, that Git ignores there,
 * where they are not tracked. Git reads the settings that discovery reads: the
 * test run names no user or system settings, and so no global excludes file,
 * unless a test names one.
 */
function gitIgnored(directory: string, names: string[]): string[] {
  const checked = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: directory,
    input: names.join("\n") + "\n",
    encoding: "utf8",
  });
  // Status 1 means that nothing is ignored.
  expect([0, 1], checked.stderr).toContain(checked.status);
  return checked.stdout.split("\n").filter(Boolean);
}
/** Make a repository of the folder `directory`, which may hold an empty `.git` folder. */
function gitInit(directory: string): void {
  git(directory, ["init", "-q", "."]);
}
/** Name `file` as the global excludes file in Git's user settings, until the test ends. */
async function globalExcludes(settings: string, file: string): Promise<void> {
  const config = path.join(settings, "gitconfig");
  // Git reads a backslash in its settings as an escape.
  await writeFile(config, `[core]\n\texcludesFile = ${file.split(path.sep).join("/")}\n`);
  vi.stubEnv("GIT_CONFIG_GLOBAL", config);
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
    gitInit(root);
    const ignored = gitIgnored(root, documents);
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

describe("Git's ignore rules at the workspace's boundaries", () => {
  it.skipIf(!hasGit)(
    "apply from the repository's top level, its info/exclude, and the global excludes file",
    async () => {
      const settings = await fixture({ ignore: "global.md\nglobal-kept.md\n*.tmp.md\n" });
      const names = [
        "generated/x.md",
        "top.md",
        "sub/top.md",
        "over.md",
        "kept.md",
        "excluded.md",
        "global.md",
        "global-kept.md",
        "a.tmp.md",
        "plain.md",
      ];
      const root = await fixture({
        // Above the workspace root.
        ".gitignore": "docs/generated/\n/docs/top.md\nover.md\n",
        // The root's own, which outranks the repository's and the global files.
        "docs/.gitignore": "!kept.md\n",
        ...Object.fromEntries(names.map((name) => [`docs/${name}`, "Text.\n"])),
      });
      gitInit(root);
      // A .gitignore outranks info/exclude, which outranks the global file.
      await writeFile(
        path.join(root, ".git/info/exclude"),
        "docs/excluded.md\nkept.md\n!global-kept.md\n!over.md\n",
      );
      await globalExcludes(settings, path.join(settings, "ignore"));
      const docs = path.join(root, "docs");
      const ignored = gitIgnored(docs, names);
      const set = await discover(docs, [], []);
      expect(set.selected).toEqual(names.filter((name) => !ignored.includes(name)).sort());
      // What Git decides here, so that the comparison covers each case.
      expect(set.selected).toEqual(["global-kept.md", "kept.md", "plain.md", "sub/top.md"]);
      expect(paths(run(root, ["lint", "--json", "--root", "docs"]).stdout)).toEqual(set.selected);
      // A named input that these rules leave out says which file's pattern does.
      const named = ["excluded.md", "generated/x.md", "global.md", "over.md"];
      const skipped = await discover(
        docs,
        named.map((name) => path.join(docs, name)),
        [],
      );
      expect(skipped.skipped.map((item) => item.message)).toEqual([
        'Skipped ignored input: excluded.md (matched by "docs/excluded.md" in ../.git/info/exclude). It is not processed.',
        'Skipped ignored input: generated/x.md (in generated, which "docs/generated/" in ../.gitignore matches). It is not processed.',
        `Skipped ignored input: global.md (matched by "global.md" in ${path.join(settings, "ignore")}). It is not processed.`,
        'Skipped ignored input: over.md (matched by "over.md" in ../.gitignore). It is not processed.',
      ]);
    },
  );
  it.skipIf(!hasGit)("leave in what Git tracks, also in a folder that it ignores", async () => {
    // A global excludes file can name a file that a repository tracks.
    const settings = await fixture({ ignore: "AGENTS.md\n" });
    const root = await fixture({
      ".gitignore": "generated/\n",
      "AGENTS.md": "# Agents\n",
      "generated/kept.md": "# Kept\n",
      "generated/other.md": "Other.\n",
      "generated/deep/kept.md": "Deep.\n",
      "generated/deep/other.md": "Other.\n",
      "index.md": "See [the agents](AGENTS.md) and [the kept file](generated/kept.md#kept).\n",
    });
    gitInit(root);
    await globalExcludes(settings, path.join(settings, "ignore"));
    git(root, ["add", "-f", "AGENTS.md", "generated/kept.md", "generated/deep/kept.md"]);
    const names = [
      "AGENTS.md",
      "generated/deep/kept.md",
      "generated/deep/other.md",
      "generated/kept.md",
      "generated/other.md",
      "index.md",
    ];
    const ignored = gitIgnored(root, names);
    const set = await discover(root, [], []);
    expect(set.selected).toEqual(names.filter((name) => !ignored.includes(name)));
    expect(set.selected).toEqual([
      "AGENTS.md",
      "generated/deep/kept.md",
      "generated/kept.md",
      "index.md",
    ]);
    // The files that Git tracks are link targets.
    const checked = run(root, ["lint", "--json", "index.md"]);
    expect(checked.status, checked.stdout).toBe(0);
    // Of the named inputs in the folder, only the one that Git ignores is skipped.
    const inputs = ["generated/kept.md", "generated/other.md"];
    const skipped = await discover(
      root,
      inputs.map((name) => path.join(root, name)),
      [],
    );
    expect(skipped.selected).toEqual(["generated/kept.md"]);
    expect(skipped.skipped.map((item) => item.message)).toEqual([
      'Skipped ignored input: generated/other.md (in generated, which "generated/" in .gitignore matches). It is not processed.',
    ]);
    // The same in a root that Git ignores.
    const generated = await discover(path.join(root, "generated"), [], []);
    expect(generated.selected).toEqual(["deep/kept.md", "kept.md"]);
    expect(generated.skipped).toEqual([]);
  });
  it.skipIf(!hasGit)("never run a file system monitor that the repository names", async () => {
    // Git runs `core.fsmonitor` when it reads the index, as `git ls-files` does,
    // so a repository that the tool lints could otherwise run a program of its own.
    const root = await fixture({
      "index.md": "# Index\n",
      "monitor.sh": '#!/bin/sh\necho ran > "$(dirname "$0")/marker"\nexit 1\n',
    });
    // On Linux and macOS, Git runs only an executable monitor.
    await chmod(path.join(root, "monitor.sh"), 0o755);
    gitInit(root);
    git(root, ["add", "index.md"]);
    git(root, [
      "config",
      "core.fsmonitor",
      path.join(root, "monitor.sh").split(path.sep).join("/"),
    ]);
    const set = await discover(root, [], []);
    expect(set.selected).toEqual(["index.md"]);
    await expect(readFile(path.join(root, "marker"), "utf8")).rejects.toThrow();
  });
  it.skipIf(!hasGit)(
    "read info/exclude where a .git file leads, as in a linked worktree or a submodule",
    async () => {
      const names = ["excluded.md", "kept.md"];
      const root = await fixture({});
      const main = path.join(root, "main");
      await mkdir(main);
      gitInit(main);
      git(main, [
        "-c",
        "user.name=mdtools",
        "-c",
        "user.email=mdtools@example.invalid",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "Start",
      ]);
      // A linked worktree shares the main repository's info/exclude.
      const worktree = path.join(root, "worktree");
      git(main, ["worktree", "add", "-q", worktree]);
      await writeFile(path.join(main, ".git/info/exclude"), "excluded.md\n");
      // A submodule's .git file names its Git folder relative to the submodule.
      const submodule = path.join(root, "submodule");
      await mkdir(path.join(root, "modules"));
      git(root, ["init", "-q", "--separate-git-dir", path.join(root, "modules/sub"), submodule]);
      // Git for Windows hides the file, and Windows refuses to replace a hidden file.
      await rm(path.join(submodule, ".git"));
      await writeFile(path.join(submodule, ".git"), "gitdir: ../modules/sub\n");
      await writeFile(path.join(root, "modules/sub/info/exclude"), "excluded.md\n");
      for (const directory of [worktree, submodule]) {
        for (const name of names) await writeFile(path.join(directory, name), "Text.\n");
        expect(gitIgnored(directory, names)).toEqual(["excluded.md"]);
        expect((await discover(directory, [], [])).selected).toEqual(["kept.md"]);
      }
    },
  );
  it.skipIf(!hasGit)("apply only a nested repository's own rules inside it", async () => {
    const settings = await fixture({ ignore: "global.md\n" });
    const names = ["a.draft.md", "b.md", "c.md", "d.md", "e.md", "global.md"];
    const root = await fixture({
      ".gitignore": "*.draft.md\nb.md\n",
      "inner/.gitignore": "c.md\n",
      ...Object.fromEntries(names.map((name) => [`inner/${name}`, "Text.\n"])),
    });
    const inner = path.join(root, "inner");
    gitInit(inner);
    await writeFile(path.join(inner, ".git/info/exclude"), "d.md\n");
    await globalExcludes(settings, path.join(settings, "ignore"));
    const ignored = gitIgnored(inner, names);
    // Files of a nested repository are only link targets.
    const set = await discover(root, [], [], { nestedRepositories: true });
    const targets = names.filter((name) => set.files[`inner/${name}`] !== undefined);
    expect(targets).toEqual(names.filter((name) => !ignored.includes(name)));
    expect(targets).toEqual(["a.draft.md", "b.md", "e.md"]);
  });
  it.skipIf(!hasGit)("match letter case as the repository's core.ignorecase says", async () => {
    const settings = await fixture({ ignore: "global.md\n" });
    const names = [
      "a/NOTES.md",
      "b/notes.md",
      "Drafts/x.md",
      "excluded.md",
      "Global.md",
      "kept.md",
    ];
    const root = await fixture({
      ".gitignore": "notes.md\ndrafts/\n",
      ...Object.fromEntries(names.map((name) => [name, "Text.\n"])),
    });
    gitInit(root);
    await writeFile(path.join(root, ".git/info/exclude"), "EXCLUDED.md\n");
    await globalExcludes(settings, path.join(settings, "ignore"));
    // Each value, whatever Git sets when it creates a repository here, also in
    // the other forms that Git reads: `on`, the name without a value, which
    // means true, and no setting, which means false.
    for (const value of ["true", "false", "on", "", undefined]) {
      if (value) git(root, ["config", "--replace-all", "core.ignorecase", value]);
      else git(root, ["config", "--unset-all", "core.ignorecase"]);
      if (value === "") await appendFile(path.join(root, ".git/config"), "[core]\n\tignorecase\n");
      const ignored = gitIgnored(root, names);
      const set = await discover(root, [], []);
      expect(set.selected).toEqual(names.filter((name) => !ignored.includes(name)).sort());
      // What Git decides here, so that the comparison covers each case.
      expect(set.selected).toEqual(
        value === "false" || value === undefined
          ? ["Drafts/x.md", "Global.md", "a/NOTES.md", "excluded.md", "kept.md"]
          : ["kept.md"],
      );
    }
  });
  it.skipIf(!hasGit)(
    "read a nested repository's own excludes file and letter case inside it",
    async () => {
      const settings = await fixture({ outer: "outer.md\n", inner: "inner.md\n" });
      const names = ["NOTES.md", "inner.md", "kept.md", "outer.md"];
      const root = await fixture({
        ".gitignore": "notes.md\n",
        "inner/.gitignore": "notes.md\n",
        ...Object.fromEntries(
          names.flatMap((name) => [
            [name, "Text.\n"],
            [`inner/${name}`, "Text.\n"],
          ]),
        ),
      });
      const inner = path.join(root, "inner");
      gitInit(root);
      gitInit(inner);
      // Git reads a backslash in its settings as an escape.
      const excludes = (name: string) => path.join(settings, name).split(path.sep).join("/");
      git(root, ["config", "core.excludesFile", excludes("outer")]);
      git(inner, ["config", "core.excludesFile", excludes("inner")]);
      // The two differ, whatever Git sets when it creates a repository here.
      git(root, ["config", "core.ignorecase", "true"]);
      git(inner, ["config", "core.ignorecase", "false"]);
      const set = await discover(root, [], [], { nestedRepositories: true });
      const outerIgnored = gitIgnored(root, names);
      expect(set.selected).toEqual(names.filter((name) => !outerIgnored.includes(name)));
      // Files of a nested repository are only link targets.
      const innerIgnored = gitIgnored(inner, names);
      const targets = names.filter((name) => set.files[`inner/${name}`] !== undefined);
      expect(targets).toEqual(names.filter((name) => !innerIgnored.includes(name)));
      // What Git decides here, so that the comparison covers each case.
      expect(set.selected).toEqual(["inner.md", "kept.md"]);
      expect(targets).toEqual(["NOTES.md", "kept.md", "outer.md"]);
    },
  );
  it.skipIf(!hasGit)("leave out everything in a root that Git ignores, and say why", async () => {
    const root = await fixture({
      ".gitignore": "generated/\n",
      "generated/a.md": "A.\n",
      "generated/sub/b.md": "B.\n",
    });
    gitInit(root);
    const generated = path.join(root, "generated");
    expect(gitIgnored(generated, ["a.md", "sub/b.md"])).toEqual(["a.md", "sub/b.md"]);
    const message =
      'Skipped ignored workspace root: . (matched by "generated/" in ../.gitignore). Its files are not processed.';
    const set = await discover(generated, [], []);
    expect(set.selected).toEqual([]);
    expect(set.skipped).toEqual([{ path: ".", type: "directory", code: "IGNORED", message }]);
    // The command line names the paths from the current directory.
    const checked = run(root, ["lint", "--root", "generated"]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stderr).toContain(
      'mdtools: warning: Skipped ignored workspace root: generated (matched by "generated/" in .gitignore). Its files are not processed.\n',
    );
    expect(run(generated, ["lint", "--root", "."]).stderr).toContain(
      'mdtools: warning: Skipped ignored workspace root: . (matched by "generated/" in ../.gitignore)',
    );
    // No path named the root, and none of its files is processed, so --no-warn-ignored keeps it.
    expect(run(generated, ["lint", "--root", ".", "--no-warn-ignored"]).stderr).toContain(
      "mdtools: warning: Skipped ignored workspace root: .",
    );
    // Stdin selects no file from disk, so the root's warning does not apply to
    // it (issue #314), and a path that --stdin-filepath gives it there is
    // ignored, as a named file is (issue #313).
    const text = "A *b*.\n";
    const piped = run(generated, ["lint", "-", "--root", "."], text);
    expect(piped.stderr).toBe(
      'stdin.md:1:3: warn style/emphasis: Use "_" for emphasis.\nstdin.md:1:5: warn style/emphasis: Use "_" for emphasis.\n',
    );
    expect(run(generated, ["lint", "-", "--root", ".", "--stdin-filepath", "a.md"], text)).toEqual(
      expect.objectContaining({
        status: 0,
        stderr:
          'mdtools: warning: Skipped ignored input: a.md (in the workspace root, which is matched by "generated/" in ../.gitignore). It is not processed.\n',
      }),
    );
    // A named input says where the rule matched, from the root.
    const sub = path.join(generated, "sub");
    expect((await discover(sub, [path.join(sub, "b.md")], [])).skipped).toEqual([
      {
        path: "b.md",
        type: "file",
        code: "IGNORED",
        message:
          'Skipped ignored input: b.md (in .., which "generated/" in ../../.gitignore matches). It is not processed.',
      },
    ]);
    expect(
      (await discover(generated, [path.join(generated, "a.md")], [])).skipped[0]?.message,
    ).toBe(
      'Skipped ignored input: a.md (in the workspace root, which is matched by "generated/" in ../.gitignore). It is not processed.',
    );
  });
  it("skip the global excludes file where Git is not installed", async () => {
    const settings = await fixture({ ignore: "global.md\n" });
    const root = await fixture({ "excluded.md": "E.\n", "global.md": "G.\n", "kept.md": "K.\n" });
    await mkdir(path.join(root, ".git/info"));
    await writeFile(path.join(root, ".git/info/exclude"), "excluded.md\n");
    await globalExcludes(settings, path.join(settings, "ignore"));
    if (hasGit) expect((await discover(root, [], [])).selected).toEqual(["kept.md"]);
    vi.stubEnv("PATH", path.join(root, "no-programs"));
    expect((await discover(root, [], [])).selected).toEqual(["global.md", "kept.md"]);
  });
  it.skipIf(!canRestrict && process.platform !== "win32")(
    "stop the run when rules above the root cannot be read, and skip such a nested repository",
    async () => {
      const deny = async (file: string) => {
        if (process.platform === "win32") denyRead(file);
        else await restrict(file);
      };
      const code = process.platform === "win32" ? "EPERM" : "EACCES";
      const refused = `${code}: ${code === "EPERM" ? "operation not permitted" : "permission denied"}`;
      const root = await fixture({ ".gitignore": "draft.md\n", "docs/a.md": "A.\n" });
      await deny(path.join(root, ".gitignore"));
      const docs = path.join(root, "docs");
      await expect(discover(docs, [], [])).rejects.toThrow(
        `Workspace root cannot be read: ${docs} (${refused} for ../.gitignore)`,
      );
      const outer = await fixture({ "inner/.git/info/exclude": "b.md\n", "inner/b.md": "B.\n" });
      await deny(path.join(outer, "inner/.git/info/exclude"));
      expect((await discover(outer, [], [], { nestedRepositories: true })).skipped).toEqual([
        {
          path: "inner",
          type: "directory",
          code,
          message: `Skipped unreadable directory: inner (${refused} for inner/.git/info/exclude). Its files are not processed, and links into it cannot be checked.`,
        },
      ]);
    },
  );
});

describe("named inputs", () => {
  const files = {
    "mdtools.config.json": JSON.stringify({
      extends: ["recommended", "github"],
      ignore: ["drafts/**"],
    }),
    ".gitignore": "generated/\nskip.md\n",
    "guide.md": "# Guide\n\nSee [the readme](README.markdown#read-me).\n",
    "README.markdown": "# Read me\n\nSee [the notes](notes.txt#anything) and [me](#nope).\n",
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
    // A text file's headings are no anchors, also when it is linted as Markdown,
    // so any fragment is accepted there.
    expect(reports.find((file) => file.path === "guide.md")!.diagnostics).toEqual([]);
    expect(reports.find((file) => file.path === "README.markdown")!.diagnostics).toEqual([
      expect.objectContaining({ message: "Missing fragment in #nope." }),
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
  it("say nothing about an ignored one with --no-warn-ignored, which changes nothing else", async () => {
    // A vault whose settings cannot be used, for a warning that stays.
    const root = await fixture({
      ...files,
      "vault/.obsidian/app.json": "",
      "vault/note.md": "N.\n",
    });
    const named = ["generated/out.md", "skip.md", "drafts/draft.md", "node_modules", "vendor"];
    const settings =
      "mdtools: warning: Skipped unusable settings file: vault/.obsidian/app.json (not valid JSON). Obsidian's strictLineBreaks setting is not verified for that vault, so its documents are not reflowed.\n";
    const emphasis = (column: number) =>
      `notes.txt:3:${column}: warn style/emphasis: Use "_" for emphasis.\n`;
    const lint = ["lint", "--max-warnings", "0", "notes.txt", ...named];
    const linted = run(root, [...lint, "--no-warn-ignored"]);
    expect(linted.stderr).toBe(
      settings + emphasis(3) + emphasis(8) + "1 file(s) linted; 0 error(s), 2 warning(s).\n",
    );
    // The exit code is the one without the option.
    expect(linted.status).toBe(1);
    expect(run(root, lint).status).toBe(1);
    const checked = run(root, ["format", "--check", "--no-warn-ignored", ...named]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stderr).toBe(settings + "0 file(s) processed; 0 would change.\n");
    // The JSON report still lists them, for a program to filter.
    const report = run(root, ["lint", "--json", "--no-warn-ignored", ...named]);
    const skipped = JSON.parse(report.stdout).skipped as { path: string; code: string }[];
    expect(skipped.map((item) => [item.path, item.code])).toEqual([
      ["drafts/draft.md", "IGNORED"],
      ["generated/out.md", "IGNORED"],
      ["node_modules", "IGNORED"],
      ["skip.md", "IGNORED"],
      ["vault/.obsidian/app.json", "INVALID"],
      ["vendor", "IGNORED"],
    ]);
    // A document from stdin under an ignored path is not processed, and gets no warning.
    const piped = run(
      root,
      ["lint", "-", "--no-warn-ignored", "--stdin-filepath", "skip.md"],
      "S.\n",
    );
    expect(piped.status, piped.stderr).toBe(0);
    expect(piped.stderr).toBe(settings);
  });
  it("leave out a document from stdin whose path they ignore, as they do a named file", async () => {
    // Issue #313: such a document used to be linted and formatted.
    const root = await fixture(files);
    const text = "A *b*.\n";
    const message = (name: string, why: string) =>
      `Skipped ignored input: ${name} (${why}). It is not processed.`;
    // Each kind of rule, also where no folder of the path exists yet.
    const cases = [
      ["dist/new.md", "in dist, which discovery always leaves out"],
      ["drafts/later/new.md", `matched by the configuration's ignore pattern "drafts/**"`],
      ["drafts/new.md", `matched by the configuration's ignore pattern "drafts/**"`],
      ["generated/new.md", 'in generated, which "generated/" in .gitignore matches'],
      ["node_modules/package/new.md", "in node_modules, which discovery always leaves out"],
      ["skip.md", 'matched by "skip.md" in .gitignore'],
    ] as const;
    const discovery = await discoverWorkspace({
      root,
      inputs: [],
      config: JSON.parse(files["mdtools.config.json"]),
      documents: Object.fromEntries([...cases.map(([name]) => [name, text]), ["new.md", text]]),
    });
    expect(discovery.selected).toEqual(["new.md"]);
    expect(discovery.skipped.map((item) => [item.path, item.code, item.message])).toEqual(
      cases.map(([name, why]) => [name, "IGNORED", message(name, why)]),
    );
    // The command line leaves such a document out in the same way.
    const warning = `mdtools: warning: ${message("skip.md", cases[5][1])}\n`;
    const named = ["--stdin-filepath", "skip.md"];
    const linted = run(root, ["lint", "-", "--max-warnings", "0", ...named], text);
    expect([linted.status, linted.stderr]).toEqual([0, warning]);
    // `format` gives the text back unchanged, as Prettier does, for an editor
    // that replaces its buffer with the output.
    const formatted = run(root, ["format", "-", ...named], text);
    expect([formatted.status, formatted.stdout, formatted.stderr]).toEqual([0, text, warning]);
    const checked = run(root, ["format", "-", "--check", "--no-warn-ignored", ...named], text);
    expect([checked.status, checked.stdout, checked.stderr]).toEqual([0, "", ""]);
    const report = JSON.parse(run(root, ["lint", "-", "--json", ...named], text).stdout);
    expect([report.files, report.skipped]).toEqual([
      [],
      [
        {
          path: "skip.md",
          type: "file",
          code: "IGNORED",
          message: message("skip.md", cases[5][1]),
        },
      ],
    ]);
    // A path that nothing ignores is processed, and so is stdin without a path.
    for (const args of [["--stdin-filepath", "new.md"], []])
      expect(run(root, ["format", "-", ...args], text).stdout).toBe("A _b_.\n");
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

describe("the configuration's ignore patterns", () => {
  it("are compiled once, not for every file", async () => {
    const names = Array.from({ length: 2000 }, (_, index) => `docs/${index}.md`);
    const root = await fixture(Object.fromEntries(names.map((name) => [name, "Text.\n"])));
    // Patterns that match none of the files, so that each is tried for each.
    const ignore = Array.from({ length: 16 }, (_, index) => `drafts-${index}/**`);
    // Without Git to start, discovery itself is what is timed.
    vi.stubEnv("PATH", path.join(root, "no-programs"));
    const fastest = async (patterns: string[]) => {
      let best = Infinity;
      for (let run = 0; run < 5; run++) {
        const started = performance.now();
        expect((await discover(root, [], patterns)).selected).toHaveLength(names.length);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    // Discovery without patterns is the baseline. Matching the patterns takes
    // about four times as long as that, and compiling them for each file took
    // about twenty times as long.
    expect((await fastest(ignore)) / (await fastest([]))).toBeLessThan(9);
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
    if (process.platform === "win32") {
      // `C:` alone names the drive's current folder, but `C:/` is the drive's root.
      const drive = root.slice(0, 2);
      fails(root, [`${drive}/*.md`], `Input is outside the workspace: ${drive}/*.md`);
      fails(
        root,
        [`${drive.toLowerCase()}/*.md`],
        `Input is outside the workspace: ${drive.toLowerCase()}/*.md`,
      );
    }
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
    expect(findings(checked.stdout)).toEqual([]);
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
