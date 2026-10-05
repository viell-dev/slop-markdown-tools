import { lstat, readdir, readFile, realpath, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import type { ResolveOptions } from "../core/types.js";
import type { WorkspaceSource } from "./index.js";
import { randomUUID } from "node:crypto";
import ignore from "ignore";
import { minimatch } from "minimatch";
import { exists } from "../config/load.js";
import { refusal, refusalText } from "./access.js";
import type { RefusalCode } from "./access.js";

/** A path that discovery was not permitted to read and left out of the run. */
export interface Skipped {
  /** The directory or settings file, relative to the workspace root. */
  path: string;
  type: "directory" | "file";
  /** The system's error code. */
  code: RefusalCode;
  /** What was skipped, why, and what follows from it. */
  message: string;
}
export interface FileSet {
  root: string;
  files: Record<string, WorkspaceSource>;
  directories: string[];
  /** What the system refused to let discovery read, sorted by path. */
  skipped: Skipped[];
  selected: string[];
  strictLineBreaks?: boolean;
}
export async function discover(
  rootPath: string,
  supplied: string[],
  excluded: string[],
  resolve: ResolveOptions = {},
): Promise<FileSet> {
  const root = await realpath(rootPath);
  const files: Record<string, WorkspaceSource> = {};
  const directories: string[] = [];
  const selected: string[] = [];
  const requests: string[] = [];
  for (const input of supplied.length ? supplied : [root]) {
    const absolute = path.resolve(input);
    if ((await lstat(absolute)).isSymbolicLink())
      throw new Error(`Refusing symbolic-link input: ${input}`);
    const resolved = await realpath(absolute);
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
        files[name] = markdown ? () => (cached ??= readFileSync(full, "utf8")) : null;
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
  let strictLineBreaks: boolean | undefined;
  const app = path.join(root, ".obsidian", "app.json");
  try {
    if (await exists(app)) {
      const settings: unknown = JSON.parse(await readFile(app, "utf8"));
      strictLineBreaks =
        typeof settings === "object" &&
        settings !== null &&
        "strictLineBreaks" in settings &&
        settings.strictLineBreaks === true;
    }
  } catch (error) {
    // Unverified settings are safe: Obsidian reflow needs them verified.
    const code = refusal(error);
    if (!code) throw error;
    skipped.push({
      path: ".obsidian/app.json",
      type: "file",
      code,
      message: `Skipped unreadable settings file: .obsidian/app.json (${refusalText(code)}). Obsidian's strictLineBreaks setting is not verified, so Obsidian documents are not reflowed.`,
    });
  }
  return {
    root,
    files,
    directories,
    skipped: skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    selected: selected.sort(),
    ...(strictLineBreaks !== undefined ? { strictLineBreaks } : {}),
  };
}
export async function writeAtomic(file: string, before: string, after: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Refusing non-regular file: ${file}`);
  if ((await readFile(file, "utf8")) !== before)
    throw new Error(`File changed during formatting: ${file}`);
  const temporary = path.join(path.dirname(file), `.mdtools-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", info.mode);
  try {
    await handle.writeFile(after, "utf8");
    await handle.chmod(info.mode);
    await handle.sync();
    await handle.close();
    const current = await lstat(file);
    if (
      current.isSymbolicLink() ||
      current.ino !== info.ino ||
      (await readFile(file, "utf8")) !== before
    )
      throw new Error(`File changed before replacement: ${file}`);
    await rename(temporary, file);
  } finally {
    await handle.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
