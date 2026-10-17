import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { mathFromMarkdown } from "mdast-util-math";
import type { Nodes } from "mdast";
import type { Dialect, DialectName, Document, Plugin } from "../core/types.js";
import { knownDialect } from "../config/resolve.js";
import { math } from "./math.js";
import type { MathConditions } from "./math.js";
import { obsidianSyntax, obsidianTree } from "./obsidian.js";

// GFM's tree transform performs GitHub's second, transform-time autolink pass
// (`[www.example.com]` or a Forgejo shortlink's `|https://` in files), but its
// nodes carry no source positions, which made the engine refuse whole documents.
// No built-in rule acts on literal autolinks, so output is unchanged without it;
// plugins inspecting link nodes do not see those autolinks.
const gfmTree = gfmFromMarkdown().map((extension) => {
  const copy = { ...extension };
  delete copy.transforms;
  return copy;
});

/**
 * Whose conditions for `$…$` in running text each dialect follows, as observed
 * on GitHub's file view, on Forgejo 16 and Gitea 1.25 and 28, and in Obsidian's
 * Reading view and Live Preview. CommonMark has no math.
 */
const mathConditions: Record<Exclude<Dialect, "commonmark">, MathConditions> = {
  github: "github",
  forgejo: "forge",
  gitea: "forge",
  obsidian: "obsidian",
};

/**
 * The byte order marks that `source` starts with, and the text after them.
 * Some editors write a mark at the start of a UTF-8 file, and a program that
 * adds one without looking can leave two. The parser skips one mark at the
 * start of what it is given.
 */
export function splitByteOrderMark(source: string): [string, string] {
  let end = 0;
  while (source.charCodeAt(end) === 0xfeff) end++;
  return [source.slice(0, end), source.slice(end)];
}

/**
 * Parse a document in `dialect`, or the dialect that an alias such as
 * `codeberg` stands for, which the result holds; an unknown dialect is an
 * error. Byte order marks at the start of `source` are not part of the
 * document: the document's source starts after them, as the positions in the
 * tree count. `path` is the document's path relative to the workspace root,
 * and `plugins` add their syntax extensions.
 */
export function parse(
  source: string,
  dialect: DialectName,
  path = "document.md",
  plugins: readonly Plugin[] = [],
): Document {
  const read = knownDialect(dialect);
  source = splitByteOrderMark(source)[1];
  const extensions = [frontmatter(["yaml", "toml"])];
  const mdastExtensions = [frontmatterFromMarkdown(["yaml", "toml"])];
  // GitHub, Forgejo, and Gitea share GFM tables, task lists, strikethrough,
  // footnotes, autolinks, and dollar math. Forgejo and Gitea syntax beyond
  // that is protected by rules rather than parsed.
  if (read !== "commonmark") {
    extensions.push(gfm(), math(mathConditions[read]));
    mdastExtensions.push(...gfmTree, mathFromMarkdown());
  }
  if (read === "obsidian") {
    extensions.push(obsidianSyntax);
    mdastExtensions.push(obsidianTree);
  }
  for (const plugin of plugins) {
    if (plugin.syntax) {
      extensions.push(plugin.syntax.micromark);
      mdastExtensions.push(plugin.syntax.mdast);
    }
  }
  return {
    source,
    dialect: read,
    path,
    tree: fromMarkdown(source, { extensions, mdastExtensions }),
  };
}

/**
 * The `[start, end]` offsets of a node of a parsed document in its `source`:
 * half-open, in UTF-16 code units. A node without a source position, such as
 * one that a plugin's tree extension built without one, is an error.
 */
export function range(node: Nodes): [number, number] {
  if (node.position?.start.offset === undefined || node.position.end.offset === undefined) {
    throw new Error(`Missing source position for ${node.type}`);
  }
  return [node.position.start.offset, node.position.end.offset];
}
/**
 * A node's text as a reader sees it: the values of its text, code, and other
 * literal nodes, in order. A wikilink gives its label, or else its target, and
 * an Obsidian comment nothing.
 */
export function textContent(node: Nodes): string {
  if (node.type === "wikiLink") return node.label ?? node.target;
  if (node.type === "obsidianComment") return "";
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(textContent).join("");
  return "";
}
