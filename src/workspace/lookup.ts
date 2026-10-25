import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { refusal } from "./access.js";
import { decodeText } from "./encoding.js";
import type { LookupResult } from "./types.js";

/**
 * The workspace's lookup of a path at or below one of the set's `unlisted`
 * entries, on disk: a link that names such a path is checked there instead of
 * being called missing. The workspace root still bounds what is read, so a
 * path whose real location lies outside it, through a symbolic link or a
 * junction, is reported as such and not read.
 */
export function unlistedLookup(set: {
  root: string;
  unlisted: readonly string[];
}): (name: string, folded: boolean) => LookupResult | undefined {
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
    // Non-Markdown text is loaded only for an explicit VitePress include;
    // ordinary fragment checks still reject non-Markdown names before reading.
    source: () => (cached ??= decodeText(readFileSync(full), name)),
  };
}
