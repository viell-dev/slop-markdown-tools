import { access, lstat, readdir, readFile, realpath, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { constants, readFileSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import type { ResolveOptions } from "../core/types.js";
import type { WorkspaceSource } from "./index.js";
import { randomUUID } from "node:crypto";
import ignore from "ignore";
import { minimatch } from "minimatch";
import { exists, pathError, refusal, refusalText, systemErrorText } from "./access.js";
import type { RefusalCode } from "./access.js";
import { decodeText } from "./encoding.js";
import { enclosingVault, isVault, lineBreakSetting } from "./vault.js";
import type { SettingsProblem, Vault } from "./vault.js";

/** A path that discovery could not use and left out of the run. */
export interface Skipped {
  /** The directory or settings file, relative to the workspace root. */
  path: string;
  type: "directory" | "file";
  /** The system's error code, or `INVALID` for a settings file with unusable content. */
  code: RefusalCode | "INVALID";
  /** What was skipped, why, and what follows from it. */
  message: string;
}
export interface FileSet {
  root: string;
  files: Record<string, WorkspaceSource>;
  directories: string[];
  /** What discovery could not read or use, sorted by path. */
  skipped: Skipped[];
  selected: string[];
  /**
   * The Obsidian vaults that hold documents of the workspace, sorted by path:
   * the one at or above the root, and each one in a folder that discovery
   * visited.
   */
  vaults: Vault[];
}
/** The workspace's record of the vault in `directory`, and of its settings file if unusable. */
async function describeVault(
  root: string,
  part: string,
  directory: string,
): Promise<{ vault: Vault; skipped?: Skipped }> {
  const setting = await lineBreakSetting(directory);
  // Only the vault that holds the root can lie above it.
  const below = part ? "" : path.relative(directory, root).split(path.sep).join("/");
  const vault: Vault = {
    path: part,
    ...(setting.value !== undefined ? { strictLineBreaks: setting.value } : {}),
    ...(below ? { rootInVault: below } : {}),
  };
  if (!setting.problem) return { vault };
  const problem: SettingsProblem = setting.problem;
  const file = path
    .relative(root, path.join(directory, ".obsidian", "app.json"))
    .split(path.sep)
    .join("/");
  return {
    vault,
    skipped: {
      path: file,
      type: "file",
      code: problem.code,
      message: `Skipped ${problem.code === "INVALID" ? "unusable" : "unreadable"} settings file: ${file} (${problem.reason}). Obsidian's strictLineBreaks setting is not verified for that vault, so its documents are not reflowed.`,
    },
  };
}
/**
 * The vault that holds the document `name` of the workspace, which need not
 * exist on disk: text read from stdin can be named into a folder that discovery
 * did not visit. The vault is found by searching upward from the document's
 * folder and is added to the set when it is new.
 */
export async function vaultFor(set: FileSet, name: string): Promise<Vault | undefined> {
  const directory = await enclosingVault(path.join(set.root, name));
  if (!directory) return undefined;
  const relative = path.relative(set.root, directory).split(path.sep).join("/");
  const part =
    relative === ".." || relative.startsWith("../") || path.isAbsolute(relative) ? "" : relative;
  const known = set.vaults.find((vault) => vault.path === part);
  if (known) return known;
  const described = await describeVault(set.root, part, directory);
  set.vaults.push(described.vault);
  if (described.skipped) set.skipped.push(described.skipped);
  return described.vault;
}
/**
 * The files of the workspace at `rootPath`, and the documents that `supplied`
 * files and folders select, or all of them when `supplied` is empty. Relative
 * inputs are resolved from `base`.
 */
export async function discover(
  rootPath: string,
  supplied: string[],
  excluded: string[],
  resolve: ResolveOptions = {},
  base = process.cwd(),
): Promise<FileSet> {
  const root = await realpath(rootPath);
  const files: Record<string, WorkspaceSource> = {};
  const directories: string[] = [];
  const selected: string[] = [];
  const requests: string[] = [];
  /** The folders that are vaults, by the part of the workspace that each holds. */
  const vaultFolders = new Map<string, string>();
  for (const input of supplied.length ? supplied : [root]) {
    const absolute = path.resolve(base, input);
    let resolved: string;
    try {
      if ((await lstat(absolute)).isSymbolicLink())
        throw new Error(`Refusing symbolic-link input: ${input}`);
      resolved = await realpath(absolute);
    } catch (error) {
      throw pathError("Input", input, error);
    }
    const relative = path.relative(root, resolved).split(path.sep).join("/");
    if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative))
      throw new Error(`Input is outside the workspace: ${input}`);
    requests.push(relative);
  }
  interface IgnoreLayer {
    base: string;
    matcher: ReturnType<typeof ignore>;
  }
  /** Directories left out, with the path whose read the system refused. */
  const refused: { directory: string; reading: string; code: RefusalCode }[] = [];
  const reason = (item: { reading: string; code: RefusalCode }, subject: string) =>
    refusalText(item.code) + (item.reading === subject ? "" : ` for ${item.reading}`);
  /**
   * Leave out a directory that the system refuses to let the tool read. Any
   * other error is a fault and stops the run, and so does a refusal for the
   * workspace root, without which there is nothing to do.
   */
  function leaveOut(directory: string, reading: string, error: unknown): void {
    const code = refusal(error);
    if (!code) throw error;
    if (!directory)
      throw new Error(
        `Workspace root cannot be read: ${rootPath} (${reason({ reading, code }, "")})`,
        { cause: error },
      );
    refused.push({ directory, reading, code });
  }
  async function walk(relative: string, inherited: IgnoreLayer[], targetOnly = false) {
    const directory = path.join(root, relative);
    const layers = [...inherited];
    const rules = path.join(directory, ".gitignore");
    let entries: Dirent[];
    // What is being read: the directory itself, or its `.gitignore`. Without the
    // ignore rules nothing tells which of the directory's files may be touched.
    let reading = relative;
    try {
      if (await exists(rules)) {
        reading = relative ? `${relative}/.gitignore` : ".gitignore";
        layers.push({ base: relative, matcher: ignore().add(await readFile(rules, "utf8")) });
        reading = relative;
      }
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      leaveOut(relative, reading, error);
      return;
    }
    // Obsidian creates the settings folder itself; a link to one shares a vault's settings.
    const settings = entries.find((entry) => entry.name === ".obsidian");
    if (settings?.isDirectory() || (settings?.isSymbolicLink() && (await isVault(directory))))
      vaultFolders.set(relative, directory);
    for (const entry of entries) {
      if (
        [".git", ".obsidian", "node_modules", ".npm-cache", "dist", "coverage"].includes(
          entry.name,
        ) ||
        entry.isSymbolicLink()
      )
        continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const gitIgnored = layers.some((layer) =>
        layer.matcher.ignores(
          name.slice(layer.base ? layer.base.length + 1 : 0) + (entry.isDirectory() ? "/" : ""),
        ),
      );
      if (gitIgnored && resolve.gitIgnored !== true) continue;
      const full = path.join(root, name);
      if (entry.isDirectory()) {
        directories.push(name);
        let nested: boolean;
        try {
          nested = await exists(path.join(full, ".git"));
        } catch (error) {
          // A directory that cannot be entered: nothing in it can be read.
          leaveOut(name, name, error);
          continue;
        }
        if (!nested || resolve.nestedRepositories === true)
          await walk(name, layers, targetOnly || gitIgnored || nested);
      } else if (entry.isFile()) {
        const markdown = /\.md$/i.test(name);
        let cached: string | undefined;
        files[name] = markdown ? () => (cached ??= decodeText(readFileSync(full), name)) : null;
        if (
          markdown &&
          !targetOnly &&
          !gitIgnored &&
          requests.some(
            (request) => !request || name === request || name.startsWith(`${request}/`),
          ) &&
          !excluded.some((pattern) => minimatch(name, pattern, { dot: true }))
        )
          selected.push(name);
      }
    }
  }
  await walk("", []);
  // An input in a directory that was left out is an error: the user asked for it.
  for (const [index, request] of requests.entries()) {
    const item = refused.find(
      ({ directory }) => request === directory || request.startsWith(`${directory}/`),
    );
    if (item)
      throw new Error(`Input cannot be read: ${supplied[index]!} (${reason(item, request)})`);
  }
  const skipped: Skipped[] = refused.map((item) => ({
    path: item.directory,
    type: "directory",
    code: item.code,
    message: `Skipped unreadable directory: ${item.directory} (${reason(item, item.directory)}). Its files are not processed, and links into it cannot be checked.`,
  }));
  // A root that is no vault itself can be a folder of one.
  if (!vaultFolders.has("")) {
    const outer = await enclosingVault(root);
    if (outer) vaultFolders.set("", outer);
  }
  const vaults: Vault[] = [];
  for (const [part, directory] of vaultFolders) {
    const described = await describeVault(root, part, directory);
    vaults.push(described.vault);
    if (described.skipped) skipped.push(described.skipped);
  }
  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  return {
    root,
    files,
    directories,
    skipped: skipped.sort(byPath),
    selected: selected.sort(),
    vaults: vaults.sort(byPath),
  };
}
/**
 * A file that `writeAtomic` would not write, or did not write completely, with
 * the reason in words that do not name it.
 */
export class ReplacementRefused extends Error {
  constructor(
    readonly reason: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
/**
 * Why `file` cannot be replaced, or undefined when nothing stands in the way
 * that can be seen before writing: the file may not be written, or its folder
 * does not let the temporary file be created beside it. A read-only file is
 * refused on every platform, although renaming over one works outside
 * Windows: the flag marks a file that is not to be edited.
 */
export async function replacementProblem(file: string): Promise<string | undefined> {
  for (const [target, subject] of [
    [file, "The file"],
    [path.dirname(file), "The file's folder"],
  ] as const) {
    try {
      await access(target, constants.W_OK);
    } catch (error) {
      const text = systemErrorText(error);
      if (!text) throw error;
      return `${subject} may not be written (${text})`;
    }
  }
  return undefined;
}
/**
 * What went wrong when `writeAtomic` failed for a file, in words that do not
 * name it, or undefined for an error that is a fault of the tool.
 */
export function replacementFailure(error: unknown): string | undefined {
  if (error instanceof ReplacementRefused) return error.reason;
  const text = systemErrorText(error);
  return text ? `The file could not be written (${text}) and is unchanged` : undefined;
}
/** The refusal for a file whose bytes are no longer those that were read. */
function changedOnDisk(file: string, when: string): ReplacementRefused {
  return new ReplacementRefused(
    "The file changed on disk during formatting and was not written",
    `File changed ${when}: ${file}`,
  );
}
/**
 * Write `content` over the file itself, which keeps everything about it but
 * its content, after checking through the open file that it is still the file
 * that was read. A failure once writing has begun can leave the file
 * incomplete and is reported so.
 */
async function writeInPlace(
  file: string,
  identity: Stats,
  expected: Buffer,
  content: Buffer,
): Promise<void> {
  const handle = await open(file, "r+");
  try {
    const current = await handle.stat();
    if (current.ino !== identity.ino || !(await handle.readFile()).equals(expected))
      throw changedOnDisk(file, "before writing");
    try {
      for (let at = 0; at < content.length;)
        at += (await handle.write(content, at, content.length - at, at)).bytesWritten;
      await handle.truncate(content.length);
      await handle.sync();
    } catch (error) {
      const text = systemErrorText(error);
      if (!text) throw error;
      throw new ReplacementRefused(
        `The file could not be written completely (${text}) and may be incomplete`,
        `File written in part: ${file}`,
        { cause: error },
      );
    }
  } finally {
    await handle.close();
  }
}
/**
 * Write the formatted text `after` to `file`, whose text was read as `before`,
 * if the file still holds exactly the bytes that were read. The new content is
 * written to a file beside it, which then replaces it, so that a failure never
 * leaves the file half written; the replacement gets the file's permission
 * bits. Replacing makes a new file, though, and some of what belonged to the old
 * one can be seen to be lost: a second name of the file, a hard link, would keep
 * the old content, and on Unix a replacement with another owner or group than
 * the file's would change who may read it. Such a file is written in place
 * instead, once the file beside it has shown that the new content fits on the
 * disk. A file that already holds `after`, as the second name of a hard link
 * written earlier in the batch does, is left as it is.
 */
export async function writeAtomic(file: string, before: string, after: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw new ReplacementRefused(
      "The file is not a regular file and was not written",
      `Refusing non-regular file: ${file}`,
    );
  // The text was decoded from valid UTF-8, so encoding it again gives the bytes
  // that were read; comparing the text instead would miss a change to bytes that
  // decode to the same text.
  const expected = Buffer.from(before, "utf8");
  const content = Buffer.from(after, "utf8");
  const found = await readFile(file);
  if (found.equals(content)) return;
  if (!found.equals(expected)) throw changedOnDisk(file, "during formatting");
  const temporary = path.join(path.dirname(file), `.mdtools-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", info.mode);
  try {
    await handle.writeFile(content);
    await handle.chmod(info.mode);
    await handle.sync();
    const made = await handle.stat();
    await handle.close();
    const current = await lstat(file);
    if (
      current.isSymbolicLink() ||
      current.ino !== info.ino ||
      !(await readFile(file)).equals(expected)
    )
      throw changedOnDisk(file, "before replacement");
    if (current.nlink > 1 || made.uid !== current.uid || made.gid !== current.gid) {
      // Removing the new file first leaves the room it took for the write.
      await unlink(temporary);
      await writeInPlace(file, current, expected, content);
    } else await rename(temporary, file);
  } finally {
    await handle.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
