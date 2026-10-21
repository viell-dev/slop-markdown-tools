import { hasHeadingPath, obsidianAnchors, githubAnchors, forgeAnchors } from "./anchors.js";
import type { ObsidianAnchors, GithubAnchors, ForgeAnchors } from "./anchors.js";
import path from "node:path";
import type { Dialect, Document } from "../core/types.js";
import { fallbackDialect } from "../config/resolve.js";
import { parse } from "../syntax/parse.js";
import { refusal } from "./access.js";
import { isNotUtf8 } from "./encoding.js";
import type { WorkspaceSource, LookupResult, WorkspaceOptions } from "./types.js";
import { vitepressAnchors, vitepressSlug } from "./vitepress.js";
import type { VitePressAnchors } from "./vitepress.js";

/**
 * Whether a file is Markdown by its name: one ending in `.md` or `.markdown`,
 * in any letter case, both of which GitHub, Forgejo, and Gitea render.
 * Discovery selects such files in folders, and their headings are link
 * targets. For the Obsidian dialect only `.md` counts: Obsidian opens no
 * other file as a note.
 */
export function isMarkdownName(name: string, dialect?: Dialect): boolean {
  return (
    dialect === "obsidian" || dialect === "vitepress" ? /\.md$/i : /\.(?:md|markdown)$/i
  ).test(name);
}

/**
 * What link checks read from a target: its anchors, in one group per set of
 * dialects that share them. A group is computed the first time a link is
 * checked against one of its dialects, so a GitHub or Obsidian workspace never
 * reads attribute blocks, which need a second parse, or the Forgejo and Gitea
 * anchors, and the forges never number anchors GitHub's way.
 *
 * Nothing else is kept. A parsed document takes many times the memory of its
 * source, and a workspace held one for every target until the run ended, so
 * each group is computed from a document that is parsed for it and released
 * with it. A workspace's links are almost always checked against one group, and
 * a check against another one parses the target once more.
 */
interface Target {
  /** Whether the system refused to let the target's source be read, or it is not UTF-8 text. */
  unreadable?: true;
  obsidian?: ObsidianAnchors;
  github?: GithubAnchors;
  forge?: ForgeAnchors;
  vitepress?: VitePressAnchors;
}
/** The workspace's targets and lazy indexes, independent of one link's resolution. */
export function createTargetIndex(
  files: Record<string, WorkspaceSource>,
  options: WorkspaceOptions = {},
) {
  const sources = new Map(
    Object.entries(files).map(([name, source]) => [
      name.replaceAll("\\", "/").replace(/^\.\//, ""),
      source,
    ]),
  );
  const directories = new Set(
    (options.directories ?? []).map((name) => name.replaceAll("\\", "/")),
  );
  directories.add(".");
  /** The directories above a path, nearest first, up to the workspace root. */
  function* parents(name: string): Generator<string> {
    let directory = path.posix.dirname(name);
    while (directory !== "." && directory !== path.posix.dirname(directory)) {
      yield directory;
      directory = path.posix.dirname(directory);
    }
  }
  for (const name of sources.keys())
    for (const directory of parents(name)) directories.add(directory);
  const vitepressRoots = [...directories]
    .filter((name) => path.posix.basename(name) === ".vitepress")
    .map((name) => path.posix.dirname(name))
    .sort((a, b) => b.length - a.length);
  const vitepressRoot = (source: string): string => {
    const configured = options.vitepress?.srcDir;
    const root =
      configured === undefined
        ? (vitepressRoots.find((name) => name === "." || source.startsWith(name + "/")) ?? ".")
        : path.posix.normalize(configured.replaceAll("\\", "/"));
    return root === "." ? "" : root;
  };
  const unreadable = [
    ...new Set(
      (options.unreadable ?? []).map((name) =>
        path.posix.normalize(name.replaceAll("\\", "/")).replace(/\/$/, ""),
      ),
    ),
  ].sort();
  for (const name of unreadable) {
    directories.add(name);
    for (const directory of parents(name)) directories.add(directory);
  }
  const unreadableNames = new Set(unreadable);
  // Obsidian matches paths without regard to case.
  const unreadableFolded = new Map(unreadable.map((name) => [name.toLowerCase(), name]));
  /** The unreadable directory that a path lies in, if any. */
  function unreadableAbove(name: string, folded: boolean): string | undefined {
    if (unreadable.length)
      for (const directory of parents(name)) {
        const found = folded
          ? unreadableFolded.get(directory.toLowerCase())
          : unreadableNames.has(directory)
            ? directory
            : undefined;
        if (found !== undefined) return found;
      }
    return undefined;
  }
  // Obsidian resolves note names case-insensitively; these indexes are built on first use.
  // Every file is filed once, under its file name in lowercase. A table of every
  // path, or of every ending of every path, costs hundreds of bytes for each
  // file, which a vault with many attachments pays whether or not they are linked.
  let fileNames: Map<string, string | string[]> | undefined;
  let foldedDirectories: Set<string> | undefined;
  /** The files whose file name, the last part of the path, is `key` in lowercase. */
  function filesNamed(key: string): readonly string[] {
    if (!fileNames) {
      fileNames = new Map();
      for (const actual of sources.keys()) {
        const name = actual.slice(actual.lastIndexOf("/") + 1).toLowerCase();
        const held = fileNames.get(name);
        if (held === undefined) fileNames.set(name, actual);
        else if (typeof held === "string") fileNames.set(name, [held, actual]);
        else held.push(actual);
      }
    }
    const held = fileNames.get(key);
    return held === undefined ? [] : typeof held === "string" ? [held] : held;
  }
  // A file name that very many files share, such as an index note in every folder,
  // gets a table of its paths, so that a link to one of them does not compare all.
  const manySharing = 32;
  const sharedNames = new Map<string, Map<string, string[]>>();
  /** The files whose whole path is `name` without regard to case. */
  function namesMatching(name: string): string[] {
    const folded = name.toLowerCase();
    const key = folded.slice(folded.lastIndexOf("/") + 1);
    const sharing = filesNamed(key);
    if (sharing.length <= manySharing)
      return sharing.filter((actual) => actual.toLowerCase() === folded);
    let paths = sharedNames.get(key);
    if (!paths) {
      paths = new Map();
      for (const actual of sharing) {
        const path = actual.toLowerCase();
        const held = paths.get(path);
        if (held) held.push(actual);
        else paths.set(path, [actual]);
      }
      sharedNames.set(key, paths);
    }
    return paths.get(folded) ?? [];
  }
  function isDirectory(name: string, folded: boolean): boolean {
    if (!folded) return directories.has(name);
    foldedDirectories ??= new Set([...directories].map((directory) => directory.toLowerCase()));
    return foldedDirectories.has(name.toLowerCase());
  }
  const targets = new Map<string, Target>();
  /** What the host's lookup found, by the matching asked for and the path. */
  const lookedUp = new Map<string, LookupResult | undefined>();
  /** The sources of the files that the lookup found, by path. */
  const foundSources = new Map<string, WorkspaceSource>();
  /** What the host finds at a path that the index does not hold, asked once per path. */
  function lookup(name: string, folded: boolean): LookupResult | undefined {
    if (!options.lookup) return undefined;
    const key = `${folded ? "i" : "s"}:${name}`;
    if (lookedUp.has(key)) return lookedUp.get(key);
    const result = options.lookup(name, folded);
    lookedUp.set(key, result);
    if (result?.type === "file") foundSources.set(result.path, result.source);
    return result;
  }
  /**
   * One group of a Markdown target's anchors, from the target read and parsed
   * for it; nothing keeps the parsed document. Undefined for a target that the
   * system refuses to let be read, or whose text is not UTF-8, which is marked
   * and not read again.
   */
  function textOf(target: Target, value: string | (() => string)): string | undefined {
    if (target.unreadable) return undefined;
    let source: string;
    try {
      source = typeof value === "function" ? value() : value;
    } catch (error) {
      // The file exists, but its anchors are unknown; any other error is a fault.
      if (!refusal(error) && !isNotUtf8(error)) throw error;
      target.unreadable = true;
      return undefined;
    }
    return source;
  }
  function compute<Anchors>(
    target: Target,
    value: string | (() => string),
    name: string,
    anchors: (document: Document) => Anchors,
  ): Anchors | undefined {
    const source = textOf(target, value);
    if (source === undefined) return undefined;
    return anchors(
      options.dialect === "vitepress"
        ? parse(source, "vitepress", name, [], options.vitepress)
        : parse(source, options.dialect ?? fallbackDialect, name),
    );
  }
  const includeText = (name: string): string | undefined => {
    let value = sources.has(name) ? sources.get(name) : foundSources.get(name);
    if (value === null || value === undefined) {
      const found = lookup(name, false);
      if (found?.type !== "file") return undefined;
      value = found.source;
    }
    if (value === null || value === undefined) return undefined;
    try {
      return typeof value === "function" ? value() : value;
    } catch (error) {
      if (refusal(error) || isNotUtf8(error)) return undefined;
      throw error;
    }
  };
  /**
   * Whether the target has the anchor a fragment names, or undefined when the
   * target's source could not be read. GitHub, Forgejo, and Gitea store anchors
   * with a `user-content-` prefix and add it to a link's fragment unless it is
   * already there, so `anchor` is the fragment with one prefix removed. Gitea
   * 1.26 and later prefix a generated anchor that already has the prefix again,
   * and a browser reaches that element with the fragment as written. GitHub's
   * page script also retries a fragment lowercased, and its anchors are.
   */
  function hasAnchor(
    name: string,
    dialect: Dialect,
    fragment: string,
    anchor: string,
  ): boolean | undefined {
    const value = sources.has(name) ? sources.get(name) : foundSources.get(name);
    // Only a Markdown file's anchors are known. Other files take fragments of
    // their own, such as an image's `#gh-dark-mode-only`, a PDF's `#page=2`, or
    // a forge's line range `#L10-L20` in source code, which are not checked; so
    // is a file that is linted as Markdown only because it was named.
    if (value === null || value === undefined || !isMarkdownName(name, dialect)) return true;
    let target = targets.get(name);
    if (!target) targets.set(name, (target = {}));
    if (dialect === "vitepress") {
      let anchors = target.vitepress;
      if (!anchors) {
        const source = textOf(target, value);
        if (source === undefined) return undefined;
        anchors = vitepressAnchors(
          source,
          name,
          options.vitepress ?? {},
          vitepressRoot(name),
          includeText,
        );
        target.vitepress = anchors;
      }
      if (!anchors.complete) return undefined;
      return anchors.ids.has(vitepressSlug(fragment, options.vitepress));
    }
    if (dialect === "obsidian") {
      const anchors = target.obsidian ?? compute(target, value, name, obsidianAnchors);
      if (!anchors) return undefined;
      target.obsidian = anchors;
      if (fragment.startsWith("^")) return anchors.blocks.has(fragment.slice(1));
      if (anchors.headings.has(fragment) || anchors.foldedHeadings.has(fragment.toLowerCase()))
        return true;
      // A path of headings, each below the one before, such as `Setup#Mobile`.
      return fragment.includes("#") && hasHeadingPath(anchors.outline, fragment.split("#"));
    }
    if (dialect === "forgejo" || dialect === "gitea") {
      const forge = target.forge ?? compute(target, value, name, forgeAnchors);
      if (!forge) return undefined;
      target.forge = forge;
      const slugs = dialect === "forgejo" ? forge.forgejoSlugs : forge.giteaSlugs;
      if (slugs.has(anchor) || slugs.has(fragment)) return true;
      return forge.explicit.has(anchor) || forge.explicit.has(fragment);
    }
    const anchors = target.github ?? compute(target, value, name, githubAnchors);
    if (!anchors) return undefined;
    target.github = anchors;
    const folded = anchor.toLowerCase();
    return anchors.slugs.has(folded) || anchors.explicit.has(folded);
  }
  // Vaults of their own, deepest first, so that a note belongs to the nearest one.
  const vaults = [
    ...new Set(
      (options.vaults ?? [])
        .map((name) => path.posix.normalize(name.replaceAll("\\", "/")).replace(/\/$/, ""))
        .filter((name) => name !== "." && name !== ""),
    ),
  ].sort((a, b) => b.length - a.length);
  /** The vault below the root that holds a note, or "" when none does. */
  function vaultOf(name: string): string {
    return vaults.find((vault) => name.startsWith(`${vault}/`)) ?? "";
  }
  // The folders from the vault that the root is a part of, down to the root.
  const rootFolders = path.posix
    .normalize((options.rootInVault ?? "").replaceAll("\\", "/"))
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  const rootFolded = rootFolders.map((part) => part.toLowerCase());
  /** Where the rest of that vault is, seen from the root. */
  const beyondRoot = rootFolders.map(() => "..").join("/");
  /**
   * The path from the root that a path from that vault's folder names, or
   * undefined when it names something of the vault outside the root.
   */
  function belowRoot(rooted: string): string | undefined {
    const parts = rooted.split("/").filter((part) => part !== "" && part !== ".");
    if (parts.length < rootFolders.length) return undefined;
    for (const [index, part] of rootFolded.entries())
      if (parts[index]!.toLowerCase() !== part) return undefined;
    return parts.slice(rootFolders.length).join("/") || ".";
  }
  /**
   * Files that a search finds when the searched path starts in the folders above
   * the root: with the root at `A/B`, the path `B/Note` names `Note` at the root.
   */
  function overlapCandidates(target: string): string[] {
    const parts = target.split("/").filter((part) => part !== "");
    const found: string[] = [];
    for (let count = 1; count <= rootFolders.length && count < parts.length; count++) {
      const tail = rootFolded.slice(-count);
      if (!tail.every((part, index) => parts[index]!.toLowerCase() === part)) continue;
      const rest = parts.slice(count).join("/");
      for (const name of namesMatching(rest)) found.push(name);
      if (!path.posix.extname(rest))
        for (const name of namesMatching(`${rest}.md`)) found.push(name);
    }
    return found;
  }
  /**
   * The files that an Obsidian search for `target` finds in `vault`: those whose
   * path from the vault's folder ends with it.
   */
  function searchCandidates(target: string, vault: string): string[] {
    const found = suffixCandidates(target);
    if (!vault) return found;
    const wanted = target.toLowerCase();
    const ends = (name: string) => name === wanted || name.endsWith(`/${wanted}`);
    return found.filter((name) => {
      if (!name.startsWith(`${vault}/`)) return false;
      // The index matched a suffix of the path from the root, which may be longer.
      const inside = name.slice(vault.length + 1).toLowerCase();
      return ends(inside) || (inside.endsWith(".md") && ends(inside.slice(0, -3)));
    });
  }
  /**
   * The files whose path ends with `target` at a folder boundary, without regard
   * to case; a Markdown file is also found without its `.md`.
   */
  function suffixCandidates(target: string): string[] {
    const wanted = target.toLowerCase();
    const slash = wanted.lastIndexOf("/");
    const found: string[] = [];
    for (const extension of ["", ".md"]) {
      const sharing = filesNamed(wanted.slice(slash + 1) + extension);
      // A bare file name is decided by the table alone.
      if (slash < 0) {
        for (const name of sharing) found.push(name);
      } else {
        const ending = `/${wanted}${extension}`;
        for (const actual of sharing) {
          const path = actual.toLowerCase();
          if (path.length + 1 === ending.length ? ending.endsWith(path) : path.endsWith(ending))
            found.push(actual);
        }
      }
    }
    return found;
  }
  return {
    sources,
    unreadable,
    rootFolders,
    beyondRoot,
    namesMatching,
    isDirectory,
    lookup,
    unreadableAbove,
    hasAnchor,
    vaultOf,
    belowRoot,
    overlapCandidates,
    searchCandidates,
    vitepressRoot,
    vitepressOptions: options.vitepress ?? {},
  };
}
export type TargetIndex = ReturnType<typeof createTargetIndex>;
