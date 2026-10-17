import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { exists } from "./access.js";

/**
 * The text of a file that need not be there, or undefined when nothing, or a
 * folder, is at its path. A refusal, or any other error, is thrown.
 */
export async function optionalText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return undefined;
    throw error;
  }
}
/**
 * The top level of the Git repository that holds `directory`: the nearest
 * folder at or above it that contains `.git`, a folder or, in a linked worktree
 * or a submodule, a file. Undefined outside a repository; a refusal, or any
 * other error, is thrown.
 */
export async function repositoryTop(directory: string): Promise<string | undefined> {
  for (let current = directory; ; current = path.dirname(current)) {
    if (await exists(path.join(current, ".git"))) return current;
    if (path.dirname(current) === current) return undefined;
  }
}
/**
 * The repository's own excludes file, `info/exclude` in its common Git
 * folder: `.git` itself, or the folder that a `.git` file names, as a
 * submodule's does, and for a linked worktree the main repository's folder,
 * which its `commondir` file names. Undefined when the `.git` file is not one
 * that Git reads.
 */
export async function excludesFile(top: string): Promise<string | undefined> {
  const dotGit = path.join(top, ".git");
  // A folder reads as nothing.
  const link = await optionalText(dotGit);
  let gitDirectory = dotGit;
  if (link !== undefined) {
    if (!link.startsWith("gitdir: ")) return undefined;
    const named = link.slice("gitdir: ".length).replace(/[\r\n]+$/, "");
    if (!named) return undefined;
    gitDirectory = path.resolve(top, named);
  }
  const common = await optionalText(path.join(gitDirectory, "commondir"));
  const commonDirectory =
    common === undefined
      ? gitDirectory
      : path.resolve(gitDirectory, common.replace(/[\r\n]+$/, ""));
  return path.join(commonDirectory, "info", "exclude");
}
/**
 * The Git program to run. Windows, and Node.js on Windows, look for a program
 * in the folder that it is started in before the folders of `PATH`, so a
 * `git.exe` in a workspace would run in place of Git. There the program is
 * found in the absolute folders of `PATH` alone.
 */
function gitProgram(): string | undefined {
  if (process.platform !== "win32") return "git";
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    const folder = entry.replace(/^"(.*)"$/, "$1");
    if (!path.isAbsolute(folder)) continue;
    const file = path.join(folder, "git.exe");
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // Not in this folder.
    }
  }
  return undefined;
}
/**
 * Variables that make Git use another repository than the one that holds its
 * working folder. A Git hook, which can run the tool, sets some of them for
 * its own repository, and Git's advice for a hook that works in another one is
 * to clear them.
 */
const repositoryVariables = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
];
/**
 * Run Git in the repository at `top`, for its exit status and what it
 * printed, or undefined where Git is not installed or does not start.
 */
function runGit(
  top: string,
  args: string[],
): Promise<{ status: number; stdout: string } | undefined> {
  const program = gitProgram();
  if (!program) return Promise.resolve(undefined);
  const env = { ...process.env };
  for (const name of repositoryVariables) delete env[name];
  return new Promise((resolve) => {
    execFile(
      program,
      args,
      { cwd: top, env, encoding: "utf8", maxBuffer: Infinity, windowsHide: true },
      (error, stdout) => {
        if (!error) resolve({ status: 0, stdout });
        else resolve(typeof error.code === "number" ? { status: error.code, stdout } : undefined);
      },
    );
  });
}
/**
 * The global excludes file that Git reads for the repository at `top`:
 * `core.excludesFile` from Git's configuration, else
 * `$XDG_CONFIG_HOME/git/ignore`, by default `~/.config/git/ignore`. Only Git
 * itself can read its configuration, with its included files and system and
 * repository settings, so this runs `git config`. Undefined where Git is not
 * installed or cannot read its configuration, since which file Git would read
 * is then unknown.
 */
export async function globalExcludesFile(top: string): Promise<string | undefined> {
  const result = await runGit(top, ["config", "-z", "--path", "--get", "core.excludesFile"]);
  // Git reads a relative path from the repository's top level.
  const value = result?.status === 0 ? result.stdout.replace(/\0$/, "") : "";
  if (value) return path.resolve(top, value);
  // Status 1: the setting is not there, and Git reads its default.
  if (result?.status !== 1) return undefined;
  const home = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || homedir(), ".config");
  return path.join(home, "git", "ignore");
}
/**
 * The files that the repository at `top` tracks, relative to its top level,
 * which Git's ignore rules never apply to, or undefined where Git is not
 * installed or cannot list them. Git lists a submodule as one entry.
 */
export async function trackedFiles(top: string): Promise<string[] | undefined> {
  const result = await runGit(top, ["ls-files", "-z"]);
  return result?.status === 0 ? result.stdout.split("\0").filter(Boolean) : undefined;
}
