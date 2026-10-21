import path from "node:path";
import type { Dialect, LinkResolution } from "../core/types.js";
import type { TargetIndex } from "./targets.js";

export function splitDestination(destination: string): { path: string; fragment: string } {
  const hash = destination.indexOf("#");
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return {
    path: decode(hash < 0 ? destination : destination.slice(0, hash)),
    fragment: decode(hash < 0 ? "" : destination.slice(hash + 1)),
  };
}
/** Resolve one link against the shared target index. Selection state belongs to this call. */
export function resolveLink(
  index: TargetIndex,
  source: string,
  destination: string,
  dialect: Dialect,
  wiki = false,
): LinkResolution {
  const {
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
  } = index;

  if (/^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith("//"))
    return { status: "external" };
  source = source.replaceAll("\\", "/");
  const parts = splitDestination(destination);
  const targetPath = parts.path;
  if (dialect !== "obsidian" && (targetPath.startsWith("/") || targetPath.includes("?")))
    return { status: "unavailable" };
  const candidates = new Set<string>();
  let ambiguous = false;
  // Unreadable directories that the link's path leads into.
  const blocking = new Set<string>();
  let directory = false;
  // Whether Obsidian's search by name was used, which looks in every directory.
  let searched = false;
  // Whether a place that Obsidian tries first could not be looked in.
  let obstructed = false;
  const folded = dialect === "obsidian";
  // The vault below the root that an Obsidian link is confined to, if any.
  const vault = folded ? vaultOf(source) : "";
  // Something that the link's path names outside that vault.
  let outside: string | undefined;
  // Whether the workspace is only a part of the note's vault.
  const partial = folded && !vault && rootFolders.length > 0;
  // Whether Obsidian would look in a place of that vault outside the workspace.
  let beyond = false;
  // A link on the disk that the path leads through to outside the workspace root.
  let leaves: string | undefined;
  /** What the host finds at a path that the index does not hold. */
  const look = (name: string, file = true) => {
    const found = lookup(name, folded);
    if (found?.type === "file") {
      if (file) {
        candidates.add(found.path);
        ambiguous ||= found.ambiguous === true;
      }
    } else if (found?.type === "directory") directory ||= !wiki;
    else if (found?.type === "outside") leaves ??= found.through;
    else if (found?.type === "unreadable") blocking.add(found.at);
  };
  const add = (candidate: string) => {
    const normalized = path.posix.normalize(candidate);
    if (normalized === ".." || normalized.startsWith("../")) {
      // As far up as the vault's folder, the path stays inside the vault.
      const climbed = normalized.split("/").filter((part) => part === "..").length;
      if (partial && climbed <= rootFolders.length) beyond = true;
      return;
    }
    if (path.posix.isAbsolute(normalized)) return;
    const bare = normalized.replace(/\/$/, "");
    if (vault && bare !== vault && !bare.startsWith(`${vault}/`)) {
      // Obsidian does not look there; remember it to say so instead of "missing".
      outside ??=
        namesMatching(bare)[0] ??
        (path.posix.extname(bare) ? undefined : namesMatching(`${bare}.md`)[0]) ??
        (!wiki && isDirectory(bare, true) ? bare : undefined);
      return;
    }
    // Obsidian links a wikilink to a note or a file, never to a folder.
    if (!wiki && isDirectory(bare, folded)) directory = true;
    const above = unreadableAbove(bare, folded);
    if (above !== undefined) blocking.add(above);
    if (!folded) {
      if (sources.has(normalized)) candidates.add(normalized);
      // A path that ends with a slash names a folder only.
      else if (!directory) look(bare, bare === normalized);
      return;
    }
    // Names differing only by case all count, so such vaults report ambiguity.
    const before = candidates.size;
    for (const name of namesMatching(normalized)) candidates.add(name);
    if (!path.posix.extname(normalized))
      for (const name of namesMatching(`${normalized}.md`)) candidates.add(name);
    if (candidates.size === before && !directory) {
      look(bare);
      if (!path.posix.extname(bare)) look(`${bare}.md`);
    }
  };
  if (!targetPath) add(source);
  else if (dialect === "obsidian") {
    if (/^\.{1,2}\//.test(targetPath)) add(path.posix.join(path.posix.dirname(source), targetPath));
    else {
      const rooted = targetPath.replace(/^\//, "");
      if (partial) {
        // The path is counted from the vault's folder, above the root: only
        // one through the root's own folder names something in the workspace.
        const below = belowRoot(rooted);
        if (below === undefined) beyond = true;
        else add(below);
      } else add(path.posix.join(vault, rooted));
      if (candidates.size === 0 && !directory && !targetPath.startsWith("/")) {
        // The vault root comes first: a note there, unseen, would be the target.
        obstructed = blocking.size > 0;
        add(path.posix.join(path.posix.dirname(source), targetPath));
      }
      if (candidates.size === 0 && !directory && !targetPath.startsWith("/")) {
        searched = true;
        for (const name of searchCandidates(targetPath, vault)) candidates.add(name);
        if (partial) for (const name of overlapCandidates(targetPath)) candidates.add(name);
      }
    }
  } else add(path.posix.join(path.posix.dirname(source), targetPath));
  if (candidates.size === 0 && directory) return { status: "directory" };
  // The search looks in the note's own vault only, and so do the directories
  // that could hide a match from it.
  const hidden = vault ? unreadable.filter((name) => name.startsWith(`${vault}/`)) : unreadable;
  // A search by name covers the readable files only: an unreadable directory
  // may hold the note that is missing, or a second one of a name found once.
  const unsearched = searched && hidden.length > 0;
  // The rest of a vault that the workspace is a part of may hold the target of
  // a link that led there, and a note that a search would find as well or first.
  const unseen = partial && (beyond || searched) ? [beyondRoot] : [];
  // A match is uncertain when a place that could not be looked in may hold a
  // note that Obsidian would choose instead, or as well.
  const uncertain = [...(unsearched ? hidden : obstructed ? blocking : []), ...unseen];
  // The tool reads nothing outside the workspace root, where the link leads.
  if (candidates.size === 0 && leaves !== undefined)
    return {
      status: "unreadable",
      unreadable: [leaves],
      leavesRoot: leaves,
      ...(vault ? { vault } : {}),
    };
  if (candidates.size === 0 && (blocking.size > 0 || unsearched || unseen.length > 0))
    return {
      status: "unreadable",
      unreadable: [...(blocking.size ? blocking : unsearched ? hidden : []), ...unseen],
      ...(vault ? { vault } : {}),
    };
  if (candidates.size !== 1 || ambiguous)
    return {
      status: candidates.size ? "ambiguous" : "missing",
      ...(vault ? { vault } : {}),
      ...(candidates.size === 0 && outside !== undefined ? { outside } : {}),
    };
  const resolved = [...candidates][0]!;
  const fragment = parts.fragment;
  let fragmentExists = true;
  if (fragment) {
    const found = hasAnchor(resolved, dialect, fragment, fragment.replace(/^user-content-/, ""));
    // The file is there, but what it contains could not be read.
    if (found === undefined)
      return {
        status: "unreadable",
        target: resolved,
        fragment,
        unreadable: [resolved],
        ...(vault ? { vault } : {}),
      };
    fragmentExists = found;
  }
  return {
    status: "resolved",
    target: resolved,
    fragment,
    fragmentExists,
    ...(uncertain.length ? { unreadable: uncertain } : {}),
    ...(vault ? { vault, rooted: resolved.slice(vault.length + 1) } : {}),
    ...(partial ? { rooted: `${rootFolders.join("/")}/${resolved}` } : {}),
  };
}
