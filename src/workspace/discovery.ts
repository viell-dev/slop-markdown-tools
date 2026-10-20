import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { resolveConfig } from "../config/resolve.js";
import type { Config, Dialect, Plugin, ProcessOptions, Workspace } from "../core/types.js";
import { pathError } from "./access.js";
import { discover, isIgnoredInput, unlistedLookup, vaultFor } from "./files.js";
import type { Skipped } from "./files.js";
import { createWorkspace } from "./index.js";
import { excludeSelection } from "./selection.js";
import { vaultOf } from "./vault.js";
import type { Vault } from "./vault.js";

/** The options of `discoverWorkspace`. */
export interface DiscoverOptions {
  /** The workspace root: the folder whose documents are processed and whose files are link targets. */
  root: string;
  /**
   * Files, folders, and patterns to select, absolute or relative to the root.
   * A folder selects its Markdown files, those named `.md` or `.markdown`; a
   * file is selected whatever its name. An input that names no existing path
   * and holds pattern characters (`*`, `?`, `[`, `{`) is a pattern, with `/`
   * between folders on every system: it selects the Markdown files that it
   * matches, and matching none is an error. Ignored files are not selected,
   * and an ignored file or folder named here is reported in `skipped`.
   * Omitted, every document of the workspace is selected; an empty list
   * selects none.
   */
  inputs?: string[];
  /**
   * Files and folders to leave out of the selection, absolute or relative to
   * the root. They are paths, not patterns, and stay link targets.
   */
  exclude?: string[];
  /** The configuration: its `ignore` and `resolve` settings, and the dialect of each document. */
  config?: Config;
  /** Plugin objects, whose rules and presets the configuration can name. */
  plugins?: Plugin[];
  /**
   * Documents whose text the caller supplies, such as an editor's unsaved
   * text, by path relative to the root. They are selected, and the workspace
   * reads this text instead of a file at that path. Exclusions leave them out
   * of the selection too. One whose path ignore rules leave out is not selected
   * and is reported in `skipped`, as a named file is.
   */
  documents?: Record<string, string>;
}
/** The files of a workspace that `discoverWorkspace` found, and how to process them. */
export interface WorkspaceDiscovery {
  /** The workspace root's real path. */
  readonly root: string;
  /** The documents to process, as forward-slash paths relative to the root, sorted. */
  readonly selected: readonly string[];
  /** What discovery could not read or use and left out, as in the CLI's JSON report. */
  readonly skipped: readonly Skipped[];
  /**
   * The text of a selected document. A file is read when it is first needed
   * and then kept; an error with the code `EACCES`, `EPERM`, or `EBUSY` means
   * that the system did not let it be read, and one with the code
   * `ERR_ENCODING_INVALID_ENCODED_DATA` that its bytes are not UTF-8 text.
   */
  read(path: string): string;
  /**
   * The options to lint or format a selected document with, as the CLI does:
   * its path, the configuration and plugins, a workspace for its dialect with
   * its vault's line-break setting, and the dialect to assume for a note.
   */
  options(path: string): ProcessOptions;
}

/**
 * The dialect to assume for a document when nothing names one, or undefined for
 * the library's own default. An Obsidian vault shows a single line break as a
 * line break and holds wikilinks, both of which any other dialect lets reflow
 * change, so a document that a vault holds is read as a note.
 */
export function assumedDialect(vault: Vault | string | undefined): Dialect | undefined {
  return vault ? "obsidian" : undefined;
}
/**
 * Stops when `given` cannot serve as a workspace root, with a message that
 * names it. Without this check the first thing to fail could be a search
 * inside it, with a message about a path the user never named.
 */
export async function checkRoot(given: string): Promise<void> {
  const root = path.resolve(given);
  try {
    if (!(await stat(root)).isDirectory())
      throw new Error(`Workspace root is not a directory: ${root}`);
    await access(root, constants.R_OK | constants.X_OK);
  } catch (error) {
    throw pathError("Workspace root", root, error);
  }
}
/**
 * Find the files of a workspace and select documents the way the CLI does:
 * honoring Git's ignore rules and the configuration's `ignore` and `resolve`
 * settings, skipping links, nested repositories, and what the system does not
 * let the tool read, and recognizing each document's Obsidian vault. Nothing
 * is written.
 */
export function discoverWorkspace(options: DiscoverOptions): Promise<WorkspaceDiscovery> {
  return discoverFrom(options, path.resolve(options.root));
}
/**
 * The same, with relative inputs and exclusions resolved from `base`. Without
 * `ignoreDocuments`, ignore rules do not leave out the supplied documents, as
 * for text from stdin without a path of its own.
 */
export async function discoverFrom(
  options: DiscoverOptions,
  base: string,
  ignoreDocuments = true,
): Promise<WorkspaceDiscovery> {
  await checkRoot(options.root);
  // Which files to leave out does not depend on a document's dialect.
  const resolved = resolveConfig({ config: options.config, plugins: options.plugins });
  const documents = new Map<string, string>();
  for (const [given, text] of Object.entries(options.documents ?? {})) {
    const name = path.posix.normalize(given.split(path.sep).join("/"));
    if (name === "." || name === ".." || name.startsWith("../") || path.isAbsolute(given))
      throw new Error(`Document path is outside the workspace: ${given}`);
    documents.set(name, text);
  }
  // Discovery always visits the whole workspace, whose files are link targets;
  // the inputs only choose what is selected.
  const none = options.inputs?.length === 0;
  const set = await discover(
    options.root,
    none ? [] : (options.inputs ?? []),
    resolved.ignore,
    resolved.resolve,
    base,
    { documents: ignoreDocuments ? [...documents.keys()] : [], selectNone: none },
  );
  if (none) set.selected = [];
  // A supplied document that ignore rules leave out is reported as a named
  // file is, and not selected.
  const ignored = new Set(
    set.skipped.flatMap((item) =>
      item.type === "file" && isIgnoredInput(item) ? [item.path] : [],
    ),
  );
  // A supplied document can lie in a folder that discovery did not visit, so
  // its vault is found by a search of its own.
  const supplied = new Map<string, Vault | undefined>();
  for (const [name, text] of documents) {
    set.files[name] = text;
    if (!ignored.has(name)) supplied.set(name, undefined);
  }
  for (const name of supplied.keys()) supplied.set(name, await vaultFor(set, name));
  const selected = await excludeSelection(
    set.root,
    [...new Set([...set.selected, ...supplied.keys()])].sort(),
    options.exclude ?? [],
    base,
  );
  const chosen = new Set(selected);
  const known = (name: string) => {
    if (!chosen.has(name)) throw new Error(`Not a selected document: ${name}`);
  };
  // One index per active dialect, built when a document of the dialect is first
  // processed, and a view of it with each vault's line-break setting.
  const indexes = new Map<Dialect, Workspace>();
  const views = new Map<Dialect, Map<Vault, Workspace>>();
  // Links into folders that discovery does not enter are checked on disk.
  const lookup = unlistedLookup(set);
  function index(dialect: Dialect): Workspace {
    let workspace = indexes.get(dialect);
    if (workspace) return workspace;
    // The vault that the root is a folder of, if it is one: links may lead out of sight.
    const enclosing = set.vaults.find((item) => item.rootInVault);
    workspace = createWorkspace(set.files, {
      dialect,
      directories: set.directories,
      // Links into a directory that could not be read are unchecked, not missing.
      unreadable: set.skipped.flatMap((item) =>
        item.type === "directory" && item.code !== "IGNORED" ? [item.path] : [],
      ),
      // The vault at or above the root holds the whole workspace and needs no entry.
      vaults: set.vaults.flatMap((item) => (item.path ? [item.path] : [])),
      ...(enclosing?.rootInVault ? { rootInVault: enclosing.rootInVault } : {}),
      lookup,
    });
    indexes.set(dialect, workspace);
    return workspace;
  }
  return {
    root: set.root,
    selected,
    skipped: set.skipped,
    read(name) {
      known(name);
      const value = set.files[name];
      if (typeof value === "string") return value;
      if (typeof value === "function") return value();
      throw new Error(`Not a Markdown document: ${name}`);
    },
    options(name) {
      known(name);
      const vault = supplied.has(name) ? supplied.get(name) : vaultOf(set.vaults, name);
      const assumed = assumedDialect(vault);
      const { dialect } = resolveConfig({
        config: options.config,
        path: name,
        plugins: options.plugins,
        defaultDialect: assumed,
      });
      let workspace = index(dialect);
      // Whether a note may be reflowed is a setting of its own vault.
      if (vault?.strictLineBreaks !== undefined) {
        let ofDialect = views.get(dialect);
        if (!ofDialect) views.set(dialect, (ofDialect = new Map()));
        const shared = workspace;
        workspace = ofDialect.get(vault) ?? { ...shared, strictLineBreaks: vault.strictLineBreaks };
        ofDialect.set(vault, workspace);
      }
      return {
        path: name,
        ...(options.config ? { config: options.config } : {}),
        ...(options.plugins ? { plugins: options.plugins } : {}),
        workspace,
        ...(assumed ? { defaultDialect: assumed } : {}),
      };
    },
  };
}
