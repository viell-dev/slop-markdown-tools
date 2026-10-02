import path from "node:path";
import GithubSlugger from "github-slugger";
import { walk } from "../syntax/walk.js";
import type { Nodes } from "mdast";
import type { Dialect, LinkResolution, Workspace } from "../core/types.js";
import { parse, range, textContent } from "../syntax/parse.js";
import { headingAttributes, lastLineSource } from "./heading-attributes.js";
import { createForgejoSlugger, createGiteaSlugger, giteaAnchor } from "./slug.js";

export type WorkspaceSource = string | null | (() => string);

/** Tags that GFM's tagfilter makes GitHub show as text instead of as HTML. */
const filteredTag =
  /^<\/?(?:iframe|noembed|noframes|plaintext|script|style|title|textarea|xmp)(?=[\t\n\f\r />])/i;
/**
 * Heading text as rendered, which GitHub and Gitea 1.26 and later build anchors
 * from: inline HTML tags and comments are left out and the text between tags
 * stays, so `## A <span>B</span>` reads `A B`. With `tagfilter`, the tags that
 * GitHub shows as text are kept.
 */
function renderedText(node: Nodes, tagfilter: boolean): string {
  if (node.type === "html") return tagfilter && filteredTag.test(node.value) ? node.value : "";
  if ("children" in node)
    return node.children.map((child) => renderedText(child, tagfilter)).join("");
  return textContent(node);
}
/**
 * Heading text with `_` emphasis delimiters kept, as Gitea 1.26 and later show
 * them near `_.py` (`## __init__.py` reads `__init__.py`, not `init.py`).
 * Inline HTML tags and comments are left out, as in the rendered text.
 */
function literalUnderscoreText(node: Nodes, source: string): string {
  if (node.type === "html") return "";
  if (node.type === "emphasis" || node.type === "strong") {
    const [start, end] = range(node);
    if (source[start] === "_") {
      const size = node.type === "strong" ? 2 : 1;
      const inner = node.children.map((child) => literalUnderscoreText(child, source)).join("");
      return source.slice(start, start + size) + inner + source.slice(end - size, end);
    }
  }
  if ("children" in node)
    return node.children.map((child) => literalUnderscoreText(child, source)).join("");
  return textContent(node);
}
interface Entry {
  headings: Set<string>;
  /** Lowercased heading text; Obsidian matches heading subpaths case-insensitively. */
  foldedHeadings: Set<string>;
  /** GitHub heading anchors. */
  slugs: Set<string>;
  /** Forgejo heading anchors; punctuation runs collapse differently. */
  forgejoSlugs: Set<string>;
  /** Gitea heading anchors; GitHub-like, but combining marks are dropped. */
  giteaSlugs: Set<string>;
  blocks: Set<string>;
}
export interface WorkspaceOptions {
  dialect?: Dialect;
  strictLineBreaks?: boolean;
  /** Existing directories, including empty ones; never treated as note targets. */
  directories?: string[];
}
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
export function createWorkspace(
  files: Record<string, WorkspaceSource>,
  options: WorkspaceOptions = {},
): Workspace {
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
  for (const name of sources.keys()) {
    let directory = path.posix.dirname(name);
    while (directory !== "." && directory !== path.posix.dirname(directory)) {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  // Obsidian resolves note names case-insensitively; these indexes are built on first use.
  let foldedNames: Map<string, string[]> | undefined;
  let foldedDirectories: Set<string> | undefined;
  function namesMatching(name: string): string[] {
    if (!foldedNames) {
      foldedNames = new Map();
      for (const actual of sources.keys()) {
        const key = actual.toLowerCase();
        foldedNames.set(key, [...(foldedNames.get(key) ?? []), actual]);
      }
    }
    return foldedNames.get(name.toLowerCase()) ?? [];
  }
  function isDirectory(name: string, folded: boolean): boolean {
    if (!folded) return directories.has(name);
    foldedDirectories ??= new Set([...directories].map((directory) => directory.toLowerCase()));
    return foldedDirectories.has(name.toLowerCase());
  }
  const entries = new Map<string, Entry>();
  function fragments(name: string): Entry {
    const cached = entries.get(name);
    if (cached) return cached;
    const entry: Entry = {
      headings: new Set(),
      foldedHeadings: new Set(),
      slugs: new Set(),
      forgejoSlugs: new Set(),
      giteaSlugs: new Set(),
      blocks: new Set(),
    };
    const value = sources.get(name);
    if (value !== null && value !== undefined && /\.md$/i.test(name)) {
      const source = typeof value === "function" ? value() : value;
      const document = parse(source, options.dialect ?? "commonmark", name);
      const slugger = new GithubSlugger();
      const forgejoSlugger = createForgejoSlugger();
      const giteaSlugger = createGiteaSlugger();
      const attributes = headingAttributes(document);
      walk(document.tree, "heading", (node) => {
        const text = textContent(node);
        entry.headings.add(text);
        entry.foldedHeadings.add(text.toLowerCase());
        entry.slugs.add(slugger.slug(renderedText(node, true)));
        // Forgejo and Gitea take a trailing `{#id .class}` as attributes, not text.
        const block = attributes.get(node);
        if (block?.id !== undefined) {
          const anchor = forgejoSlugger.custom(block.id);
          if (anchor) entry.forgejoSlugs.add(anchor);
          if (giteaSlugger.custom(block.id)) entry.giteaSlugs.add(anchor);
          return;
        }
        // Forgejo, like Gitea before 1.26, builds anchors from the source of
        // the heading's last line: markup, destinations, and tags are part of it.
        const line = lastLineSource(source, node, block?.start);
        entry.forgejoSlugs.add(forgejoSlugger.slug(line));
        entry.giteaSlugs.add(giteaSlugger.slug(line));
        // Gitea 1.26 and later number no anchors, build them from the rendered
        // text, and keep underscores near `_.py` literal.
        const shown = block?.heading ?? node;
        const [start, end] = range(shown);
        const anchor = giteaAnchor(
          source.slice(start, block ? Math.min(end, block.start) : end).includes("_.py")
            ? literalUnderscoreText(shown, source)
            : renderedText(shown, false),
        );
        if (anchor) entry.giteaSlugs.add(anchor);
      });
      walk(document.tree, "text", (node) => {
        const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(node.value);
        if (match) entry.blocks.add(match[1]!);
      });
    }
    entries.set(name, entry);
    return entry;
  }
  let suffixes: Map<string, Set<string>> | undefined;
  function suffixCandidates(target: string): Set<string> | undefined {
    if (!suffixes) {
      suffixes = new Map();
      for (const name of sources.keys()) {
        const parts = name.split("/");
        for (let i = 0; i < parts.length; i++) {
          const suffix = parts.slice(i).join("/").toLowerCase();
          for (const key of suffix.endsWith(".md") ? [suffix, suffix.slice(0, -3)] : [suffix]) {
            if (!suffixes.has(key)) suffixes.set(key, new Set());
            suffixes.get(key)!.add(name);
          }
        }
      }
    }
    return suffixes.get(target.toLowerCase());
  }
  return {
    ...(options.strictLineBreaks !== undefined
      ? { strictLineBreaks: options.strictLineBreaks }
      : {}),
    resolve(source, destination, dialect): LinkResolution {
      if (/^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith("//"))
        return { status: "external" };
      source = source.replaceAll("\\", "/");
      const parts = splitDestination(destination);
      const targetPath = parts.path;
      if (dialect !== "obsidian" && (targetPath.startsWith("/") || targetPath.includes("?")))
        return { status: "unavailable" };
      const candidates = new Set<string>();
      let directory = false;
      const folded = dialect === "obsidian";
      const add = (candidate: string) => {
        const normalized = path.posix.normalize(candidate);
        if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return;
        if (isDirectory(normalized.replace(/\/$/, ""), folded)) directory = true;
        if (!folded) {
          if (sources.has(normalized)) candidates.add(normalized);
          return;
        }
        // Names differing only by case all count, so such vaults report ambiguity.
        for (const name of namesMatching(normalized)) candidates.add(name);
        if (!path.posix.extname(normalized))
          for (const name of namesMatching(`${normalized}.md`)) candidates.add(name);
      };
      if (!targetPath) add(source);
      else if (dialect === "obsidian") {
        if (/^\.{1,2}\//.test(targetPath))
          add(path.posix.join(path.posix.dirname(source), targetPath));
        else {
          add(targetPath.replace(/^\//, ""));
          if (candidates.size === 0 && !directory && !targetPath.startsWith("/"))
            add(path.posix.join(path.posix.dirname(source), targetPath));
          if (candidates.size === 0 && !directory && !targetPath.startsWith("/")) {
            for (const name of suffixCandidates(targetPath) ?? []) candidates.add(name);
          }
        }
      } else add(path.posix.join(path.posix.dirname(source), targetPath));
      if (candidates.size === 0 && directory) return { status: "directory" };
      if (candidates.size !== 1) return { status: candidates.size ? "ambiguous" : "missing" };
      const target = [...candidates][0]!;
      const fragment = parts.fragment;
      const entry = fragment ? fragments(target) : undefined;
      const fragmentExists =
        !fragment ||
        (dialect === "obsidian"
          ? fragment.startsWith("^")
            ? entry!.blocks.has(fragment.slice(1))
            : entry!.headings.has(fragment) || entry!.foldedHeadings.has(fragment.toLowerCase())
          : dialect === "forgejo"
            ? entry!.forgejoSlugs.has(fragment)
            : dialect === "gitea"
              ? entry!.giteaSlugs.has(fragment)
              : entry!.slugs.has(fragment));
      return { status: "resolved", target, fragment, fragmentExists };
    },
  };
}
