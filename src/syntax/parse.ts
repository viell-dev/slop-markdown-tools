import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import type { Nodes } from "mdast";
import type { Dialect, Document, Plugin } from "../core/types.js";
import { obsidianSyntax, obsidianTree } from "./obsidian.js";

// GFM's autolink transform re-scans text with looser boundary rules than the
// syntax extension and GitHub itself, so `x|www.example.com` or a Forgejo
// shortlink's `|https://` became links, and its nodes carry no source positions.
const gfmTree = gfmFromMarkdown().map((extension) => {
  const copy = { ...extension };
  delete copy.transforms;
  return copy;
});

export function parse(
  source: string,
  dialect: Dialect,
  path = "document.md",
  plugins: Plugin[] = [],
): Document {
  const extensions = [frontmatter(["yaml", "toml"])];
  const mdastExtensions = [frontmatterFromMarkdown(["yaml", "toml"])];
  // GitHub and Forgejo share GFM tables, task lists, strikethrough, footnotes,
  // autolinks, and dollar math. Forgejo-only syntax is protected by rules
  // rather than parsed.
  if (dialect !== "commonmark") {
    extensions.push(gfm(), math());
    mdastExtensions.push(...gfmTree, mathFromMarkdown());
  }
  if (dialect === "obsidian") {
    extensions.push(obsidianSyntax);
    mdastExtensions.push(obsidianTree);
  }
  for (const plugin of plugins) {
    if (plugin.syntax) {
      extensions.push(plugin.syntax.micromark);
      mdastExtensions.push(plugin.syntax.mdast);
    }
  }
  return { source, dialect, path, tree: fromMarkdown(source, { extensions, mdastExtensions }) };
}

export function range(node: Nodes): [number, number] {
  if (node.position?.start.offset === undefined || node.position.end.offset === undefined) {
    throw new Error(`Missing source position for ${node.type}`);
  }
  return [node.position.start.offset, node.position.end.offset];
}
export function textContent(node: Nodes): string {
  if (node.type === "wikiLink") return node.label ?? node.target ?? node.value;
  if (node.type === "obsidianComment") return "";
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(textContent).join("");
  return "";
}
