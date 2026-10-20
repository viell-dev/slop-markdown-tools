import { access, lstat, readdir, readFile, realpath, open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { constants, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import type { ResolveOptions } from "../core/types.js";
import type { LookupResult, WorkspaceSource } from "./index.js";
import { randomBytes, randomUUID } from "node:crypto";
import ignore from "ignore";
import type { Ignore } from "ignore";
import { minimatch, Minimatch } from "minimatch";
import { exists, pathError, refusal, refusalText, systemErrorText } from "./access.js";
import type { RefusalCode } from "./access.js";
import { decodeText } from "./encoding.js";
import { excludesFile, ignoreSettings, optionalText, repositoryTop, trackedFiles } from "./git.js";
import { isMarkdownName } from "./index.js";
import { enclosingVault, isVault, lineBreakSetting } from "./vault.js";
import type { SettingsProblem, Vault } from "./vault.js";

/** A path that discovery could not use and left out of the run. */
export interface Skipped {
  /** The directory or file, relative to the workspace root. */
  path: string;
  /** Whether a directory or a file was left out. */
  type: "directory" | "file";
  /**
   * The system's error code, `INVALID` for a settings file with unusable
   * content, or `IGNORED` for an input that was named but is ignored.
   */
  code: RefusalCode | "INVALID" | "IGNORED";
  /** What was skipped, why, and what follows from it. */
  message: string;
}
/** Names a path of the workspace, given relative to the root, as a message shows it. */
type PathText = (file: string) => string;
/** The words of each skipped entry's message, with the paths it names left to the caller. */
const wording = new WeakMap<Skipped, (show: PathText) => string>();
/** A skipped entry whose message names paths relative to the root. */
function skip(entry: Omit<Skipped, "message">, words: (show: PathText) => string): Skipped {
  const item = { ...entry, message: words((file) => file) };
  wording.set(item, words);
  return item;
}
/**
 * The message of a skipped entry with each path of the workspace that it names
 * given by `show`, which receives the path relative to the root. The CLI's text
 * names them from the current directory.
 */
export function skippedMessage(item: Skipped, show: PathText): string {
  return wording.get(item)?.(show) ?? item.message;
}
/** The skipped entries of named inputs that ignore rules leave out. */
const ignoredInputs = new WeakSet<Skipped>();
/**
 * Whether a skipped entry reports a named file or folder that discovery leaves
 * out as ignored, a warning that the CLI's `--no-warn-ignored` leaves out. An
 * ignored workspace root is not one: no path named it, and none of its files is
 * processed.
 */
export function isIgnoredInput(item: Skipped): boolean {
  return ignoredInputs.has(item);
}
/** A file of ignore rules as a message shows it: one outside the repository by its full path. */
function showFile(show: PathText, file: string): string {
  return path.isAbsolute(file) ? file : show(file);
}
/**
 * Names of folders and files that discovery never enters or selects, wherever
 * they are. A link can still name what is in them; `unlistedLookup` finds it.
 */
const alwaysSkipped = new Set([".git", ".obsidian", "node_modules", "dist", "coverage"]);
/**
 * Whether letter case is ignored where the file system usually ignores it, as
 * those of Windows and macOS do by default. Git turns `core.ignorecase` on when
 * it creates a repository on such a file system, and `.gitignore` patterns
 * match accordingly; where Git cannot say, this stands in for the setting.
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
/**
 * A file of Git ignore rules for the folder whose paths its patterns match: a
 * `.gitignore` for the folder that holds it, and a repository's
 * `info/exclude` or the global excludes file for the repository's top level.
 */
interface IgnoreLayer {
  /**
   * The folder, relative to the top level of the repository that holds the
   * workspace root, or to the root outside a repository; empty for that folder.
   */
  base: string;
  /** The file, as messages name it. */
  file: string;
  /** The file's text. */
  text: string;
  /** Whether its patterns match without regard to letter case, as its repository says. */
  ignoreCase: boolean;
  matcher: Ignore;
}
/** A gitignore pattern that matches exactly one folder, at a path relative to the file's folder. */
function folderOnly(folder: string): string {
  return `/${folder.replace(/[\\*?[]/g, "\\$&")}/`;
}
/**
 * The matchers for the entries of the folder `at`, relative to where the
 * layers' folders are, one for each file of rules above them, nearest last,
 * with the path from that file's folder. Git asks each file only whether its
 * patterns match the path itself; that nothing below an excluded folder counts
 * is settled by the walk, which never enters one. The `ignore` package also
 * answers that a path is ignored when the file's patterns exclude a folder
 * above it, which is wrong when a deeper `.gitignore` included that folder
 * again. For such a folder, the file's patterns are tested with each folder on
 * the way marked as included.
 */
function ignoreScopes(at: string, layers: IgnoreLayer[]) {
  return layers.map((layer) => {
    const inner = at.slice(layer.base ? layer.base.length + 1 : 0);
    let { matcher } = layer;
    if (inner && matcher.test(`${inner}/`).ignored) {
      const folders = inner
        .split("/")
        .map((_, index, parts) => parts.slice(0, index + 1).join("/"));
      matcher = ignore({ ignorecase: layer.ignoreCase })
        .add(layer.text)
        .add(folders.map((folder) => `!${folderOnly(folder)}`));
    }
    return { layer, matcher, prefix: inner ? `${inner}/` : "" };
  });
}
/**
 * The file and pattern that exclude an entry, or undefined when none does: the
 * nearest file whose patterns match the entry decides, and a negated pattern
 * includes it.
 */
function gitIgnoreRule(
  scopes: ReturnType<typeof ignoreScopes>,
  entry: string,
  directory: boolean,
): { file: string; pattern: string } | undefined {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const { layer, matcher, prefix } = scopes[index]!;
    const result = matcher.test(prefix + entry + (directory ? "/" : ""));
    if (result.ignored) return { file: layer.file, pattern: result.rule?.pattern ?? "" };
    if (result.unignored) return undefined;
  }
  return undefined;
}
/**
 * The layer of the rules `text`, read from `file`, for the folder `base`, in a
 * repository that ignores letter case or not.
 */
function ignoreLayer(base: string, file: string, text: string, ignoreCase: boolean): IgnoreLayer {
  return { base, file, text, ignoreCase, matcher: ignore({ ignorecase: ignoreCase }).add(text) };
}
/** A path that the user named among the inputs. */
interface NamedInput {
  /** The real path, relative to the root. */
  path: string;
  directory: boolean;
  /** Whether it is only a supplied document's path, which selects nothing on disk. */
  document?: boolean;
  /** Why discovery leaves it out, when it does, naming paths through `show`. */
  reason?: (show: PathText) => string;
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
    // A pattern that starts with `/` or with a drive and `/`, such as `C:/`,
    // starts at that root: `C:` alone names the drive's current folder.
    const start = literal && /^(?:[A-Za-z]:)?$/.test(prefix) ? `${prefix}/` : prefix || ".";
    let folder: string;
    try {
      folder = await realpath(path.resolve(base, start));
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
  const folded = new Map<string, string[]>();
  for (const name of set.unlisted) {
    const key = name.toLowerCase();
    const names = folded.get(key);
    if (names) names.push(name);
    else folded.set(key, [name]);
  }
  const folders = new Map<string, Map<string, string[]>>();
  /** The case-insensitive matches within a directory whose containment was checked. */
  function namesIn(folder: string, wanted: string): string[] {
    let names = folders.get(folder);
    if (!names) {
      names = new Map();
      for (const name of readdirSync(path.join(set.root, folder))) {
        const key = name.toLowerCase();
        const matches = names.get(key);
        if (matches) matches.push(name);
        else names.set(key, [name]);
      }
      folders.set(folder, names);
    }
    return names.get(wanted.toLowerCase()) ?? [];
  }
  /** Follow only matching components, checking links before listing any directory. */
  function foldedPath(entries: string[], rest: string[]): LookupResult | undefined {
    let candidates = entries;
    for (const part of rest) {
      const next: string[] = [];
      for (const folder of candidates) {
        const found = onDisk(set.root, folder);
        if (found?.type === "outside" || found?.type === "unreadable") return found;
        if (found?.type !== "directory") continue;
        try {
          for (const name of namesIn(folder, part)) next.push(`${folder}/${name}`);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") continue;
          if (refusal(error)) return { type: "unreadable", at: folder };
          throw error;
        }
      }
      candidates = next;
      if (!candidates.length) return undefined;
    }
    let file: Extract<LookupResult, { type: "file" }> | undefined;
    let directory = false;
    let ambiguous = false;
    for (const name of candidates) {
      const found = onDisk(set.root, name);
      if (found?.type === "outside" || found?.type === "unreadable") return found;
      if (found?.type === "file") {
        if (file && file.path !== found.path) ambiguous = true;
        file ??= found;
      } else if (found?.type === "directory") directory = true;
    }
    return file
      ? ambiguous
        ? { ...file, ambiguous: true }
        : file
      : directory
        ? { type: "directory" }
        : undefined;
  }
  return (name, fold) => {
    if (!set.unlisted.length) return undefined;
    const parts = name.split("/");
    for (let count = 1; count <= parts.length; count++) {
      const prefix = parts.slice(0, count).join("/");
      const entries = fold
        ? folded.get(prefix.toLowerCase())
        : exact.has(prefix)
          ? [prefix]
          : undefined;
      if (entries !== undefined)
        return fold
          ? foldedPath(entries, parts.slice(count))
          : onDisk(set.root, [entries[0]!, ...parts.slice(count)].join("/"));
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
    skipped: skip(
      { path: file, type: "file", code: problem.code },
      (show) =>
        `Skipped ${problem.code === "INVALID" ? "unusable" : "unreadable"} settings file: ${show(file)} (${problem.reason}). Obsidian's strictLineBreaks setting is not verified for that vault, so its documents are not reflowed.`,
    ),
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
 * Where Git's ignore rules for the workspace at `root` come from. They start at
 * `top`, the top level of the repository that holds the root, which can lie
 * above it; in each repository nested in the workspace, only its own rules
 * apply. What a repository tracks is never ignored.
 */
function gitRules(root: string, top: string | undefined) {
  /** The root, relative to the repository's top level. */
  const lead = top ? path.relative(top, root).split(path.sep).join("/") : "";
  /** A path relative to the root, relative to the repository's top level instead. */
  const fromTop = (relative: string) =>
    lead && relative ? `${lead}/${relative}` : lead || relative;
  /** How messages name a file of rules: from the root, or in full outside the repository. */
  function shown(file: string): string {
    const inside = path.relative(top ?? root, file);
    if (inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
      return file;
    return path.relative(root, file).split(path.sep).join("/");
  }
  /** The file whose read failed, as messages name it. */
  const failed = (error: unknown, fallback: string) =>
    shown((error as NodeJS.ErrnoException).path ?? fallback);
  /**
   * The tracked files, from the top level, and the folders that hold them,
   * each kept as its repository compares letter case: as they are, or in lower
   * case.
   */
  const exact = { tracked: new Set<string>(), holding: new Set<string>() };
  const folded = { tracked: new Set<string>(), holding: new Set<string>() };
  /**
   * The rules for the top level of the repository in `directory`, `base` from
   * the outer repository's top level, with the lowest precedence first: the
   * global excludes file that the repository's settings name, then its
   * `info/exclude`; and whether its patterns ignore letter case. What the
   * repository tracks is recorded on the way.
   */
  async function repositoryLayers(
    directory: string,
    base: string,
  ): Promise<{ layers: IgnoreLayer[]; ignoreCase: boolean }> {
    const settings = ignoreSettings(directory).then(async (found) => ({
      ...found,
      text: found.excludesFile === undefined ? undefined : await optionalText(found.excludesFile),
    }));
    const listed = trackedFiles(directory);
    let text: string | undefined;
    let exclude: string | undefined;
    try {
      exclude = await excludesFile(directory);
      text = exclude === undefined ? undefined : await optionalText(exclude);
    } finally {
      // Git runs in the repository's folder, which Windows does not let anyone
      // remove until it is done, so discovery waits for it also after a failure.
      await Promise.allSettled([settings, listed]);
    }
    const global = await settings;
    // Where Git cannot say, case is compared as the file system usually does.
    const ignoreCase = global.ignoreCase ?? caseInsensitive;
    const sets = ignoreCase ? folded : exact;
    for (const name of (await listed) ?? []) {
      let at = base ? `${base}/${name}` : name;
      if (ignoreCase) at = at.toLowerCase();
      sets.tracked.add(at);
      for (
        at = path.posix.dirname(at);
        at !== "." && !sets.holding.has(at);
        at = path.posix.dirname(at)
      )
        sets.holding.add(at);
    }
    const layers: IgnoreLayer[] = [];
    if (global.text !== undefined)
      layers.push(ignoreLayer(base, shown(global.excludesFile!), global.text, ignoreCase));
    if (text !== undefined) layers.push(ignoreLayer(base, shown(exclude!), text, ignoreCase));
    return { layers, ignoreCase };
  }
  /** Whether a repository tracks the path `at`, from the top level, or a file in that folder. */
  function isTracked(at: string): boolean {
    if (exact.tracked.has(at) || exact.holding.has(at)) return true;
    if (!folded.tracked.size) return false;
    const lower = at.toLowerCase();
    return folded.tracked.has(lower) || folded.holding.has(lower);
  }
  return { lead, fromTop, shown, failed, repositoryLayers, isTracked };
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
 *
 * `documents` are paths from the root of documents whose text a caller
 * supplies, which need not exist. They are not selected here, but ignore rules
 * leave them out as named files, including in missing folders. With
 * `selectNone`, the caller selects nothing from disk, and an ignored root is
 * not reported.
 */
export async function discover(
  rootPath: string,
  supplied: string[],
  excluded: string[],
  resolve: ResolveOptions = {},
  base = process.cwd(),
  { documents = [], selectNone = false }: { documents?: string[]; selectNone?: boolean } = {},
): Promise<FileSet> {
  const root = await realpath(rootPath);
  let top: string | undefined;
  try {
    top = await repositoryTop(root);
  } catch (error) {
    const code = refusal(error);
    if (!code) throw error;
    // Only the root itself can refuse it: each folder above leads to the root.
    throw new Error(`Workspace root cannot be read: ${rootPath} (${refusalText(code)})`, {
      cause: error,
    });
  }
  const { lead, fromTop, shown, failed, repositoryLayers, isTracked } = gitRules(root, top);
  // Compiled once: compiling a pattern costs more than matching it.
  const ignorePatterns = excluded.map((pattern) => ({
    pattern,
    matcher: new Minimatch(pattern, { dot: true }),
  }));
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
  /** The supplied documents, which ignore rules leave out as they do named files. */
  const documentInputs: NamedInput[] = [];
  // Overlay only the paths implied by supplied buffers. Missing directories
  // need the same inherited ignore decisions without any filesystem writes.
  const documentChildren = new Map<string, Map<string, boolean>>();
  for (const name of documents) {
    const parts = name.split("/");
    for (let index = 0; index < parts.length; index++) {
      const parent = parts.slice(0, index).join("/");
      let children = documentChildren.get(parent);
      if (!children) documentChildren.set(parent, (children = new Map<string, boolean>()));
      const child = parts[index]!;
      children.set(child, children.get(child) === true || index < parts.length - 1);
    }
    const existing = namedInputs.get(name);
    if (existing) {
      if (!existing.directory) documentInputs.push(existing);
      continue;
    }
    const request: NamedInput = { path: name, directory: false, document: true };
    namedInputs.set(name, request);
    documentInputs.push(request);
    for (let at = name; at !== "."; at = path.posix.dirname(at)) {
      const list = named.get(at);
      if (list) list.push(request);
      else named.set(at, [request]);
    }
  }
  /**
   * Record why the entry `name` leaves out the named inputs at or below it for
   * which `applies` holds, unless something above it did already.
   */
  function leaveNamed(
    name: string,
    why: (input: NamedInput) => (show: PathText) => string,
    applies: (input: NamedInput) => boolean = () => true,
  ) {
    for (const request of named.get(name) ?? [])
      if (applies(request)) request.reason ??= why(request);
  }
  /** Whether Git's rules can leave out a named input: Git ignores nothing that it tracks. */
  const untracked = (input: NamedInput) => !isTracked(fromTop(input.path));
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
  /** The rules that apply at the root, from the repository's top level down. */
  let rootLayers: IgnoreLayer[] = [];
  /** Whether the rules of the repository that holds the root ignore letter case. */
  let rootIgnoreCase = caseInsensitive;
  /** The folder at or above the root that Git ignores, from the top level, and the rule. */
  let ignoredRoot: { folder: string; file: string; pattern: string } | undefined;
  if (top) {
    try {
      ({ layers: rootLayers, ignoreCase: rootIgnoreCase } = await repositoryLayers(top, ""));
      const parts = lead ? lead.split("/") : [];
      for (let index = 0; index < parts.length && !ignoredRoot; index++) {
        const at = parts.slice(0, index).join("/");
        const file = path.join(top, ...parts.slice(0, index), ".gitignore");
        const text = await optionalText(file);
        if (text !== undefined) rootLayers.push(ignoreLayer(at, shown(file), text, rootIgnoreCase));
        const rule = gitIgnoreRule(ignoreScopes(at, rootLayers), parts[index]!, true);
        if (rule) ignoredRoot = { folder: parts.slice(0, index + 1).join("/"), ...rule };
      }
    } catch (error) {
      leaveOut("", failed(error, path.join(top, ".git")), error);
    }
  }
  /**
   * Visit a directory, whose repository's rules ignore letter case or not.
   * Below a folder that Git's rules exclude, nothing can be included again, as
   * in Git, except what Git tracks. Such a folder is visited for what it
   * tracks, and otherwise only for link targets.
   */
  async function walk(
    relative: string,
    inherited: IgnoreLayer[],
    ignoreCase: boolean,
    {
      targetOnly = false,
      gitIgnoredAbove = false,
      virtual = false,
      suppliedOnly = false,
    }: {
      targetOnly?: boolean;
      gitIgnoredAbove?: boolean;
      virtual?: boolean;
      suppliedOnly?: boolean;
    } = {},
  ) {
    const directory = path.join(root, relative);
    const layers = [...inherited];
    const rules = path.join(directory, ".gitignore");
    let entries: (Pick<Dirent, "name" | "isDirectory" | "isFile" | "isSymbolicLink"> & {
      virtual?: boolean;
    })[] = [];
    // What is being read: the directory itself, or its `.gitignore`. Without the
    // ignore rules nothing tells which of the directory's files may be touched.
    let reading = relative;
    try {
      if (!virtual && !gitIgnoredAbove && (await exists(rules))) {
        reading = relative ? `${relative}/.gitignore` : ".gitignore";
        const text = await readFile(rules, "utf8");
        layers.push(ignoreLayer(fromTop(relative), reading, text, ignoreCase));
        reading = relative;
      }
      if (!virtual) entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      leaveOut(relative, reading, error);
      return;
    }
    // Obsidian creates the settings folder itself; a link to one shares a vault's settings.
    const settings = entries.find((entry) => entry.name === ".obsidian");
    if (settings?.isDirectory() || (settings?.isSymbolicLink() && (await isVault(directory))))
      vaultFolders.set(relative, directory);
    const children = documentChildren.get(relative);
    if (suppliedOnly) entries = entries.filter((entry) => children?.has(entry.name));
    if (children) {
      const present = new Set(entries.map((entry) => entry.name));
      for (const [name, folder] of children) {
        if (present.has(name)) continue;
        entries.push({
          name,
          virtual: true,
          isDirectory: () => folder,
          isFile: () => !folder,
          isSymbolicLink: () => false,
        });
      }
    }
    const scopes = gitIgnoredAbove ? [] : ignoreScopes(fromTop(relative), layers);
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const rule = gitIgnoredAbove
        ? undefined
        : gitIgnoreRule(scopes, entry.name, entry.isDirectory());
      const gitExcluded = gitIgnoredAbove || rule !== undefined;
      // Git ignores no file that it tracks, and no folder that holds one,
      // though the folder's other files stay ignored.
      const gitIgnored = gitExcluded && !isTracked(fromTop(name));
      const skippedName = alwaysSkipped.has(entry.name);
      if (skippedName || entry.isSymbolicLink()) {
        if (skippedName)
          leaveNamed(
            name,
            (input) => (show) =>
              input.path === name
                ? `discovery always leaves out ${entry.name}`
                : `in ${show(name)}, which discovery always leaves out`,
          );
        // Not entered, but a link can name what is in it or behind it, unless
        // Git ignores it and so its files are no link targets.
        if (!gitIgnored || resolve.gitIgnored === true) unlisted.push(name);
        continue;
      }
      if (rule)
        leaveNamed(
          name,
          (input) => (show) =>
            input.path === name
              ? `matched by "${rule.pattern}" in ${showFile(show, rule.file)}`
              : `in ${show(name)}, which "${rule.pattern}" in ${showFile(show, rule.file)} matches`,
          untracked,
        );
      if (gitIgnored && resolve.gitIgnored !== true) continue;
      const full = path.join(root, name);
      if (entry.isDirectory()) {
        if (!entry.virtual) directories.push(name);
        let nested: boolean;
        try {
          nested = !entry.virtual && (await exists(path.join(full, ".git")));
        } catch (error) {
          // A directory that cannot be entered: nothing in it can be read.
          leaveOut(name, name, error);
          continue;
        }
        // A nested repository is another project, not one that a rule leaves
        // alone: text supplied for one of its documents is read as its own.
        if (nested)
          leaveNamed(
            name,
            (input) => (show) =>
              input.path === name ? "a nested repository" : `in ${show(name)}, a nested repository`,
            (input) => !input.document,
          );
        const onlySupplied = suppliedOnly || (nested && resolve.nestedRepositories !== true);
        if (onlySupplied && !documentChildren.has(name)) continue;
        // Inside a nested repository, only its own rules and settings apply, as in Git.
        let inner = { layers, ignoreCase };
        if (nested && !gitIgnored)
          try {
            inner = await repositoryLayers(full, fromTop(name));
          } catch (error) {
            leaveOut(name, failed(error, path.join(full, ".git")), error);
            continue;
          }
        await walk(name, inner.layers, inner.ignoreCase, {
          targetOnly: targetOnly || gitIgnored || nested,
          gitIgnoredAbove: nested && !gitIgnored ? false : gitExcluded,
          virtual: entry.virtual === true,
          suppliedOnly: onlySupplied,
        });
      } else if (entry.isFile() && !entry.virtual) {
        const request = named.get(name)?.find((input) => input.path === name && !input.directory);
        const markdown = isMarkdownName(name);
        let cached: string | undefined;
        files[name] =
          markdown || request ? () => (cached ??= decodeText(readFileSync(full), name)) : null;
        if (!(markdown || request) || targetOnly || gitIgnored) continue;
        const pattern = ignorePatterns.find((item) => item.matcher.match(name))?.pattern;
        if (pattern !== undefined) {
          if (request)
            request.reason ??= () => `matched by the configuration's ignore pattern "${pattern}"`;
          continue;
        }
        let chosen = request !== undefined && !request.document;
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
  await walk("", rootLayers, rootIgnoreCase, { gitIgnoredAbove: ignoredRoot !== undefined });
  // The names that discovery always leaves out, and the configuration's
  // patterns, apply to a supplied document's path also where no folder of it
  // exists.
  for (const request of documentInputs) {
    if (request.reason) continue;
    const parts = request.path.split("/");
    const at = parts.findIndex((part) => alwaysSkipped.has(part));
    if (at >= 0) {
      const folder = parts.slice(0, at + 1).join("/");
      request.reason =
        folder === request.path
          ? () => `discovery always leaves out ${parts[at]}`
          : (show) => `in ${show(folder)}, which discovery always leaves out`;
      continue;
    }
    const pattern = ignorePatterns.find((item) => item.matcher.match(request.path))?.pattern;
    if (pattern !== undefined)
      request.reason = () => `matched by the configuration's ignore pattern "${pattern}"`;
  }
  // Nothing that Git does not track is processed in a root that Git ignores.
  let rootIgnored: ((show: PathText) => string) | undefined;
  if (ignoredRoot) {
    const { file, pattern } = ignoredRoot;
    // The root itself, or a folder above it.
    const folder = path.posix.relative(lead, ignoredRoot.folder);
    const why = (show: PathText) =>
      folder
        ? `in ${show(folder)}, which "${pattern}" in ${showFile(show, file)} matches`
        : `matched by "${pattern}" in ${showFile(show, file)}`;
    for (const input of namedInputs.values())
      if (untracked(input))
        input.reason ??= folder ? why : (show) => `in the workspace root, which is ${why(show)}`;
    if (!namedInputs.size && !selectNone && !isTracked(lead)) rootIgnored = why;
  }
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
  const skipped: Skipped[] = refused.map((item) =>
    skip(
      { path: item.directory, type: "directory", code: item.code },
      (show) =>
        `Skipped unreadable directory: ${show(item.directory)} (${refusalText(item.code)}${item.reading === item.directory ? "" : ` for ${showFile(show, item.reading)}`}). Its files are not processed, and links into it cannot be checked.`,
    ),
  );
  if (rootIgnored) {
    const why = rootIgnored;
    skipped.push(
      skip(
        { path: ".", type: "directory", code: "IGNORED" },
        (show) =>
          `Skipped ignored workspace root: ${show(".") || "."} (${why(show)}). Its files are not processed.`,
      ),
    );
  }
  // A named input that ignore rules leave out is not an error, but the user asked for it.
  for (const input of namedInputs.values()) {
    const why = input.reason;
    if (!why) continue;
    const item = skip(
      { path: input.path, type: input.directory ? "directory" : "file", code: "IGNORED" },
      (show) =>
        `Skipped ignored input: ${show(input.path)} (${why(show)}). ${input.directory ? "Its files are" : "It is"} not processed.`,
    );
    ignoredInputs.add(item);
    skipped.push(item);
  }
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
 * A file that `writeFormatted` would not write, or did not write completely,
 * with the reason in words that do not name it.
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
 * Why `file` cannot be written, or undefined when nothing stands in the way
 * that can be seen before writing: the file may not be written, or its folder
 * does not let the trial file be created beside it. A read-only file is refused
 * on every platform: the flag marks a file that is not to be edited.
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
 * What went wrong when `writeFormatted` failed for a file, in words that do
 * not name it, or undefined for an error that is a fault of the tool.
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
 * Show that `size` more bytes fit on the disk of `folder`, by writing a file
 * of that size there and removing it. It holds random bytes, not the
 * document's text: a file left behind by a crash then reveals nothing, and a
 * disk that compresses what it stores cannot make the trial smaller than the
 * write. Common file systems set aside the room when the bytes are written, so
 * the trial is not flushed to the disk; a file system that runs out of room only
 * then makes the write itself fail, and the file's content is written back.
 */
async function trialWrite(folder: string, size: number): Promise<void> {
  const trial = path.join(folder, `.mdtools-${randomUUID()}.tmp`);
  const handle = await open(trial, "wx", 0o600);
  try {
    await handle.writeFile(randomBytes(size));
  } finally {
    await handle.close();
    await unlink(trial).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
/** Make the open file hold exactly `content`. */
async function overwrite(handle: FileHandle, content: Buffer): Promise<void> {
  for (let at = 0; at < content.length;)
    at += (await handle.write(content, at, content.length - at, at)).bytesWritten;
  await handle.truncate(content.length);
  await handle.sync();
}
/**
 * Write the formatted text `after` into `file`, whose text was read as
 * `before`, if the file still holds exactly the bytes that were read. The file
 * itself is written, not replaced by a new one, so that it keeps its
 * permissions, attributes, owner, creation time, and hard links, which Node.js
 * cannot all carry over to a new file. A trial write beside the file first shows that
 * the new content fits on the disk. The file is then checked through the open
 * file, just before writing. If writing fails part way, the bytes that were read
 * are written back, and the reason says whether that worked. A file that already
 * holds `after`, as the second name of a hard link written earlier in the batch
 * does, is left as it is.
 */
export async function writeFormatted(file: string, before: string, after: string): Promise<void> {
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
  await trialWrite(path.dirname(file), content.length);
  const handle = await open(file, "r+");
  try {
    // The path may lead to another file by now, such as through a link put in its place.
    const current = await handle.stat();
    if (current.ino !== info.ino || !(await handle.readFile()).equals(expected))
      throw changedOnDisk(file, "before writing");
    try {
      await overwrite(handle, content);
    } catch (error) {
      const text = systemErrorText(error);
      if (!text) throw error;
      let undone: string | undefined;
      try {
        await overwrite(handle, expected);
      } catch (again) {
        undone = systemErrorText(again);
        if (!undone) throw again;
      }
      throw new ReplacementRefused(
        undone === undefined
          ? `The file could not be written (${text}), and its content from before formatting was written back`
          : `The file could not be written (${text}), and writing its content from before formatting back failed too (${undone}); it may be incomplete`,
        `File written in part: ${file}`,
        { cause: error },
      );
    }
  } finally {
    await handle.close();
  }
}
