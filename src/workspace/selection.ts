import { execFile } from "node:child_process";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
/** Select working-tree paths; never read or modify staged file contents. */
export async function gitSelection(root: string, staged: boolean): Promise<Set<string>> {
  const git = async (args: string[]) =>
    (await execute("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }))
      .stdout;
  try {
    if ((await git(["rev-parse", "--is-inside-work-tree"])).trim() !== "true") throw new Error();
  } catch {
    throw new Error("Git selection requires a Git working tree and an available git executable.");
  }
  let hasHead = true;
  if (!staged) {
    try {
      await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
    } catch {
      hasHead = false;
    }
  }
  const changed = await git([
    "diff",
    ...(staged || !hasHead ? ["--cached"] : ["HEAD"]),
    "--name-only",
    "-z",
    "--diff-filter=ACMR",
    "--no-renames",
    "--relative",
    "--",
    ".",
  ]);
  const untracked = staged
    ? ""
    : await git(["ls-files", "--others", "--exclude-standard", "-z", "--", "."]);
  return new Set((changed + untracked).split("\0").filter((name) => /\.md$/i.test(name)));
}

/** Exclusions are literal paths relative to cwd, never glob patterns. */
export async function excludeSelection(
  root: string,
  selected: string[],
  exclusions: string[],
): Promise<string[]> {
  // Resolve filesystem aliases (including Windows short names) consistently
  // with discovery, while allowing exclusions for paths that do not exist yet.
  async function canonical(file: string): Promise<string> {
    try {
      return await realpath(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(file);
      if (parent === file) throw error;
      return path.join(await canonical(parent), path.basename(file));
    }
  }
  const relative = await Promise.all(
    exclusions.map(async (input) => {
      const name = path
        .relative(root, await canonical(path.resolve(input)))
        .split(path.sep)
        .join("/");
      if (name === ".." || name.startsWith("../") || path.isAbsolute(name))
        throw new Error(`Excluded path is outside the workspace: ${input}`);
      return name;
    }),
  );
  return selected.filter(
    (name) =>
      !relative.some(
        (excluded) => !excluded || name === excluded || name.startsWith(`${excluded}/`),
      ),
  );
}
