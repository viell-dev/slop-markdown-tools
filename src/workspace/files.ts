import { access, lstat, readdir, readFile, realpath, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { constants, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import type { ResolveOptions } from "../core/types.js";
import type { LookupResult, WorkspaceSource } from "./index.js";
import { randomUUID } from "node:crypto";
import ignore from "ignore";
import type { Ignore } from "ignore";
import { minimatch, Minimatch } from "minimatch";
import { exists, pathError, refusal, refusalText, systemErrorText } from "./access.js";
import type { RefusalCode } from "./access.js";
import { decodeText } from "./encoding.js";
import { isMarkdownName } from "./index.js";
import { enclosingVault, isVault, lineBreakSetting } from "./vault.js";
import type { SettingsProblem, Vault } from "./vault.js";

/** A path that discovery could not use and left out of the run. */
export interface Skipped {
  /** The directory or file, relative to the workspace root. */
  path: string;
  type: "directory" | "file";
  /**
   * The system's error code, `INVALID` for a settings file with unusable
   * content, or `IGNORED` for an input that was named but is ignored.
   */
  code: RefusalCode | "INVALID" | "IGNORED";
  /** What was skipped, why, and what follows from it. */
  message: string;
}
/**
 * Names of folders and files that discovery never enters or selects, wherever
 * they are. A link can still name what is in them; `unlistedLookup` finds it.
 */
const alwaysSkipped = new Set([".git", ".obsidian", "node_modules", "dist", "coverage"]);
/**
 * Whether letter case is ignored where Git and the file system usually ignore
 * it. Git sets `core.ignorecase` when it creates a repository on a file system
 * that ignores case, as those of Windows and macOS do by default, and leaves it
 * off elsewhere; `.gitignore` patterns then match accordingly.
 */
const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
/**
 * Characters that make an input a pattern when no path of its name exists:
 * wildcards, a character class, a brace list, or an extended group.
 */
const patternCharacters = /[*?[{]|[!@+]\(/;
/**
 * How input patterns match, on every system: `/` separates folders and `\`
 * escapes the next character; a name starting with a dot is matched like any
 * other, as discovery finds it; letter case is ignored where the file system
 * usually ignores it, as the `glob` package does.
 */
const patternOptions = { dot: true, nocomment: true, nonegate: true, nocase: caseInsensitive };
/** A `.gitignore` file's rules for the folder that holds it. */
interface IgnoreLayer {
  /** The folder, relative to the workspace root; empty for the root. */
  base: string;
  /** The file's text. */
  text: string;
  matcher: Ignore;
}
/** A gitignore pattern that matches exactly one folder, at a path relative to the file's folder. */
function folderOnly(folder: string): string {
  return `/${folder.replace(/[\\*?[]/g, "\\$&")}/`;
}
/**
 * The matchers for the entries of the folder `relative`, one for each
 * `.gitignore` above them, nearest last, with the path from that file's
 * folder. Git asks each file only whether its patterns match the path itself;
 * that nothing below an excluded folder counts is settled by the walk, which
 * never enters one. The `ignore` package also answers that a path is ignored
 * when the file's patterns exclude a folder above it, which is wrong when a
 * deeper `.gitignore` included that folder again. For such a folder, the
 * file's patterns are tested with each folder on the way marked as included.
 */
function ignoreScopes(relative: string, layers: IgnoreLayer[]) {
  return layers.map((layer) => {
    const inner = relative.slice(layer.base ? layer.base.length + 1 : 0);
    let { matcher } = layer;
    if (inner && matcher.test(`${inner}/`).ignored) {
      const folders = inner
        .split("/")
        .map((_, index, parts) => parts.slice(0, index + 1).join("/"));
      matcher = ignore({ ignorecase: caseInsensitive })
        .add(layer.text)
        .add(folders.map((folder) => `!${folderOnly(folder)}`));
    }
    return { layer, matcher, prefix: inner ? `${inner}/` : "" };
  });
}
/**
 * The `.gitignore` file and pattern that exclude an entry, or undefined when
 * none does: the nearest file whose patterns match the entry decides, and a
 * negated pattern includes it.
 */
function gitIgnoreRule(
  scopes: ReturnType<typeof ignoreScopes>,
  entry: string,
  directory: boolean,
): { file: string; pattern: string } | undefined {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const { layer, matcher, prefix } = scopes[index]!;
    const result = matcher.test(prefix + entry + (directory ? "/" : ""));
    if (result.ignored)
      return {
        file: layer.base ? `${layer.base}/.gitignore` : ".gitignore",
        pattern: result.rule?.pattern ?? "",
      };
    if (result.unignored) return undefined;
  }
  return undefined;
}
/** A path that the user named among the inputs. */
interface NamedInput {
  /** The real path, relative to the root. */
  path: string;
  directory: boolean;
  /** Why discovery leaves it out, when it does. */
  reason?: string;
}
/** An input that is a pattern, with one matcher of paths from the root for each brace alternative. */
interface PatternInput {
  input: string;
  matchers: Minimatch[];
  /** The folders, relative to the root, that the alternatives' literal parts name. */
  folders: string[];
  matched: boolean;
}
/**
 * An input that names no existing path, read as a pattern relative to `base`.
 * The literal folders at the start of each alternative are located as a path
 * is, so the pattern can match paths from the workspace root. Undefined for an
 * input without pattern characters.
 */
async function patternInput(
  input: string,
  root: string,
  base: string,
): Promise<PatternInput | undefined> {
  if (!patternCharacters.test(input)) return undefined;
  const result: PatternInput = { input, matchers: [], folders: [], matched: false };
  for (const alternative of minimatch.braceExpand(input)) {
    const parts = alternative.split("/");
    let literal = 0;
    while (
      literal < parts.length - 1 &&
      !patternCharacters.test(parts[literal]!) &&
      !parts[literal]!.includes("\\")
    )
      literal++;
    const prefix = parts.slice(0, literal).join("/");
    let folder: string;
    try {
      folder = await realpath(path.resolve(base, literal === 1 && !prefix ? "/" : prefix || "."));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A folder that is not there holds nothing that could match.
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      throw pathError("Input", input, error);
    }
    const relative = path.relative(root, folder).split(path.sep).join("/");
    if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative))
      throw new Error(`Input is outside the workspace: ${input}`);
    const rest = parts.slice(literal).join("/");
    result.folders.push(relative);
    result.matchers.push(
      new Minimatch(relative ? `${relative.replace(/[\\*?[\](){}!+@]/g, "\\$&")}/${rest}` : rest, {
        ...patternOptions,
        // The braces were expanded already; a folder's name may hold one.
        nobrace: true,
      }),
    );
  }
  return result;
}
export interface FileSet {
  root: string;
  files: Record<string, WorkspaceSource>;
  directories: string[];
  /**
   * The entries below the root that discovery did not enter and that Git does
   * not ignore: folders and files of the names that it always leaves out, and
   * symbolic links and junctions. Their files are not in `files`, but a link
   * can name one.
   */
  unlisted: string[];
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
/**
 * The workspace's lookup of a path at or below one of the set's `unlisted`
 * entries, on disk: a link that names such a path is checked there instead of
 * being called missing. The workspace root still bounds what is read, so a
 * path whose real location lies outside it, through a symbolic link or a
 * junction, is reported as such and not read.
 */
export function unlistedLookup(
  set: FileSet,
): (name: string, folded: boolean) => LookupResult | undefined {
  const exact = new Set(set.unlisted);
  // Obsidian matches paths without regard to case.
  const folded = new Map(set.unlisted.map((name) => [name.toLowerCase(), name]));
  return (name, fold) => {
    if (!set.unlisted.length) return undefined;
    const parts = name.split("/");
    for (let count = 1; count <= parts.length; count++) {
      const prefix = parts.slice(0, count).join("/");
      const entry = fold
        ? folded.get(prefix.toLowerCase())
        : exact.has(prefix)
          ? prefix
          : undefined;
      if (entry !== undefined) return onDisk(set.root, [entry, ...parts.slice(count)].join("/"));
    }
    return undefined;
  };
}
/** What is at the path `name` below `root`, following links as far as the root allows. */
function onDisk(root: string, name: string): LookupResult | undefined {
  const parts = name.split("/");
  // Each step on the way, so that what stands in the way can be named.
  for (let count = 1; count <= parts.length; count++) {
    const step = parts.slice(0, count).join("/");
    let actual: string;
    try {
      if (!lstatSync(path.join(root, step)).isSymbolicLink()) continue;
      actual = realpathSync.native(path.join(root, step));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A path through something that is not there, or a link that leads nowhere.
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") return undefined;
      if (refusal(error))
        return { type: "unreadable", at: count > 1 ? parts.slice(0, count - 1).join("/") : step };
      throw error;
    }
    const relative = path.relative(root, actual);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return { type: "outside", through: step };
  }
  let info: Stats;
  try {
    info = statSync(path.join(root, name));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") return undefined;
    if (refusal(error)) return { type: "unreadable", at: name };
    throw error;
  }
  if (info.isDirectory()) return { type: "directory" };
  const full = path.join(root, name);
  let cached: string | undefined;
  return {
    type: "file",
    path: name,
    source: isMarkdownName(name) ? () => (cached ??= decodeText(readFileSync(full), name)) : null,
  };
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
 * files, folders, and patterns select, or all of them when `supplied` is
 * empty. Relative inputs are resolved from `base`.
 *
 * A folder or pattern selects the Markdown files in it or matching it, by
 * name (`isMarkdownName`), that nothing ignores. A file named on its own is
 * selected whatever its name: naming it is the request. When ignore rules
 * leave out a named file or folder, `skipped` says so and why.
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
  const unlisted: string[] = [];
  const selected: string[] = [];
  /** The folders that select their Markdown files, relative to the root. */
  const requests: string[] = [];
  /** The paths named as inputs, by their own path and that of each folder above them. */
  const named = new Map<string, NamedInput[]>();
  const namedInputs = new Map<string, NamedInput>();
  const patterns: PatternInput[] = [];
  /** Each input as given, with a path from the root that it names or searches. */
  const located: { input: string; path: string }[] = [];
  /** The folders that are vaults, by the part of the workspace that each holds. */
  const vaultFolders = new Map<string, string>();
  for (const input of supplied.length ? supplied : [root]) {
    const absolute = path.resolve(base, input);
    let resolved: string;
    let directory: boolean;
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`Refusing symbolic-link input: ${input}`);
      directory = info.isDirectory();
      resolved = await realpath(absolute);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const pattern =
        code === "ENOENT" || code === "ENOTDIR" ? await patternInput(input, root, base) : undefined;
      if (pattern) {
        patterns.push(pattern);
        for (const folder of pattern.folders) located.push({ input, path: folder });
        continue;
      }
      throw pathError("Input", input, error);
    }
    const relative = path.relative(root, resolved).split(path.sep).join("/");
    if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative))
      throw new Error(`Input is outside the workspace: ${input}`);
    located.push({ input, path: relative });
    if (directory) requests.push(relative);
    if (!relative || namedInputs.has(relative)) continue;
    const request: NamedInput = { path: relative, directory };
    namedInputs.set(relative, request);
    for (let at = relative; at !== "."; at = path.posix.dirname(at)) {
      const list = named.get(at);
      if (list) list.push(request);
      else named.set(at, [request]);
    }
  }
  /**
   * Record why the entry `name` leaves out the named inputs at or below it,
   * unless something above it did already.
   */
  function leaveNamed(name: string, why: (input: NamedInput) => string) {
    for (const request of named.get(name) ?? []) request.reason ??= why(request);
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
  /**
   * Visit a directory. Below a folder that Git ignores, which is visited only
   * for link targets, nothing can be included again, as in Git.
   */
  async function walk(
    relative: string,
    inherited: IgnoreLayer[],
    targetOnly = false,
    gitIgnoredAbove = false,
  ) {
    const directory = path.join(root, relative);
    const layers = [...inherited];
    const rules = path.join(directory, ".gitignore");
    let entries: Dirent[];
    // What is being read: the directory itself, or its `.gitignore`. Without the
    // ignore rules nothing tells which of the directory's files may be touched.
    let reading = relative;
    try {
      if (!gitIgnoredAbove && (await exists(rules))) {
        reading = relative ? `${relative}/.gitignore` : ".gitignore";
        const text = await readFile(rules, "utf8");
        layers.push({
          base: relative,
          text,
          matcher: ignore({ ignorecase: caseInsensitive }).add(text),
        });
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
    const scopes = gitIgnoredAbove ? [] : ignoreScopes(relative, layers);
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const rule = gitIgnoredAbove
        ? undefined
        : gitIgnoreRule(scopes, entry.name, entry.isDirectory());
      const skippedName = alwaysSkipped.has(entry.name);
      if (skippedName || entry.isSymbolicLink()) {
        if (skippedName)
          leaveNamed(name, (input) =>
            input.path === name
              ? `discovery always leaves out ${entry.name}`
              : `in ${name}, which discovery always leaves out`,
          );
        // Not entered, but a link can name what is in it or behind it, unless
        // Git ignores it and so its files are no link targets.
        if (!(gitIgnoredAbove || rule) || resolve.gitIgnored === true) unlisted.push(name);
        continue;
      }
      if (rule)
        leaveNamed(name, (input) =>
          input.path === name
            ? `matched by "${rule.pattern}" in ${rule.file}`
            : `in ${name}, which "${rule.pattern}" in ${rule.file} matches`,
        );
      const gitIgnored = gitIgnoredAbove || rule !== undefined;
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
        if (nested)
          leaveNamed(name, (input) =>
            input.path === name ? "a nested repository" : `in ${name}, a nested repository`,
          );
        if (!nested || resolve.nestedRepositories === true)
          await walk(name, layers, targetOnly || gitIgnored || nested, gitIgnored);
      } else if (entry.isFile()) {
        const request = named.get(name)?.find((input) => input.path === name && !input.directory);
        const markdown = isMarkdownName(name);
        let cached: string | undefined;
        files[name] =
          markdown || request ? () => (cached ??= decodeText(readFileSync(full), name)) : null;
        if (!(markdown || request) || targetOnly || gitIgnored) continue;
        const pattern = excluded.find((item) => minimatch(name, item, { dot: true }));
        if (pattern !== undefined) {
          if (request)
            request.reason ??= `matched by the configuration's ignore pattern "${pattern}"`;
          continue;
        }
        let chosen = request !== undefined;
        if (markdown) {
          chosen ||= requests.some(
            (folder) => !folder || name === folder || name.startsWith(`${folder}/`),
          );
          for (const item of patterns)
            if (item.matchers.some((matcher) => matcher.match(name))) chosen = item.matched = true;
        }
        if (chosen) selected.push(name);
      }
    }
  }
  await walk("", []);
  // An input in a directory that was left out is an error: the user asked for it.
  for (const { input, path: request } of located) {
    const item = refused.find(
      ({ directory }) => request === directory || request.startsWith(`${directory}/`),
    );
    if (item) throw new Error(`Input cannot be read: ${input} (${reason(item, request)})`);
  }
  // A pattern stands for the documents it matches, so one that matches none is
  // an error, as a path that does not exist is.
  for (const item of patterns)
    if (!item.matched)
      throw new Error(
        `Input pattern matches no document: ${item.input}${
          item.input.includes("\\") ? " (patterns separate folders with /)" : ""
        }`,
      );
  const skipped: Skipped[] = refused.map((item) => ({
    path: item.directory,
    type: "directory",
    code: item.code,
    message: `Skipped unreadable directory: ${item.directory} (${reason(item, item.directory)}). Its files are not processed, and links into it cannot be checked.`,
  }));
  // A named input that ignore rules leave out is not an error, but the user asked for it.
  for (const input of namedInputs.values())
    if (input.reason)
      skipped.push({
        path: input.path,
        type: input.directory ? "directory" : "file",
        code: "IGNORED",
        message: `Skipped ignored input: ${input.path} (${input.reason}). ${input.directory ? "Its files are" : "It is"} not processed.`,
      });
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
    unlisted,
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
