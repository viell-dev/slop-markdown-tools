import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../../src/workspace/files.js";
import { fixture, run } from "./support.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
/** Where letter case is ignored by default, by Git and by the file system. */
const foldsCase = process.platform === "win32" || process.platform === "darwin";
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
