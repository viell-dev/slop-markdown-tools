import path from "node:path";
import GithubSlugger from "github-slugger";
import { visit } from "unist-util-visit";
import type { Dialect, LinkResolution, Workspace } from "../core/types.js";
import { parse, textContent } from "../syntax/parse.js";

interface Entry {
  headings: Set<string>;
  slugs: Set<string>;
  blocks: Set<string>;
}
export interface WorkspaceOptions {
  dialect?: Dialect;
  strictLineBreaks?: boolean;
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
  files: Record<string, string | null>,
  options: WorkspaceOptions = {},
): Workspace {
  const entries = new Map<string, Entry>();
  for (const [name, source] of Object.entries(files)) {
    const entry: Entry = { headings: new Set(), slugs: new Set(), blocks: new Set() };
    if (source !== null && /\.md$/i.test(name)) {
      const document = parse(source, options.dialect ?? "commonmark", name);
      const slugger = new GithubSlugger();
      visit(document.tree, "heading", (node) => {
        const text = textContent(node);
        entry.headings.add(text);
        entry.slugs.add(slugger.slug(text));
      });
      visit(document.tree, "text", (node) => {
        const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(node.value);
        if (match) entry.blocks.add(match[1]!);
      });
    }
    entries.set(name.replaceAll("\\", "/").replace(/^\.\//, ""), entry);
  }
  return {
    ...(options.strictLineBreaks !== undefined
      ? { strictLineBreaks: options.strictLineBreaks }
      : {}),
    resolve(source, destination, dialect): LinkResolution {
      if (/^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith("//"))
        return { status: "external" };
      const parts = splitDestination(destination);
      const targetPath = parts.path;
      if (dialect !== "obsidian" && (targetPath.startsWith("/") || targetPath.includes("?")))
        return { status: "unavailable" };
      const candidates = new Set<string>();
      const add = (candidate: string) => {
        const normalized = path.posix.normalize(candidate);
        if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return;
        if (entries.has(normalized)) candidates.add(normalized);
        if (
          dialect === "obsidian" &&
          !path.posix.extname(normalized) &&
          entries.has(`${normalized}.md`)
        )
          candidates.add(`${normalized}.md`);
      };
      if (!targetPath) add(source);
      else if (dialect === "obsidian") {
        if (/^\.{1,2}\//.test(targetPath))
          add(path.posix.join(path.posix.dirname(source), targetPath));
        else {
          add(targetPath.replace(/^\//, ""));
          if (!targetPath.startsWith("/"))
            add(path.posix.join(path.posix.dirname(source), targetPath));
          if (candidates.size === 0) {
            for (const name of entries.keys()) {
              if (
                name === targetPath ||
                name.endsWith(`/${targetPath}`) ||
                name === `${targetPath}.md` ||
                name.endsWith(`/${targetPath}.md`)
              )
                candidates.add(name);
            }
          }
        }
      } else add(path.posix.join(path.posix.dirname(source), targetPath));
      if (candidates.size !== 1) return { status: candidates.size ? "ambiguous" : "missing" };
      const target = [...candidates][0]!;
      const entry = entries.get(target)!;
      const fragment = parts.fragment;
      const fragmentExists =
        !fragment ||
        (dialect === "obsidian"
          ? fragment.startsWith("^")
            ? entry.blocks.has(fragment.slice(1))
            : entry.headings.has(fragment)
          : entry.slugs.has(fragment));
      return { status: "resolved", target, fragment, fragmentExists };
    },
  };
}
