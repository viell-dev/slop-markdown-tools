import { fromMarkdown } from "mdast-util-from-markdown";
import type { Extension as TreeExtension } from "mdast-util-from-markdown";
import type { Extension as SyntaxExtension } from "micromark-util-types";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { mathFromMarkdown } from "mdast-util-math";
import type { InlineCode, Nodes } from "mdast";
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

/** The offset of the `]` that closes the text of each link and image, by node. */
const labelEnds = new WeakMap<Nodes, number>();
/**
 * Record where the text of a link or image ends. The tree keeps an image's
 * description only as plain text, so its source positions are otherwise lost.
 */
const labelEndTree: TreeExtension = {
  exit: {
    // A label has an opening and a closing marker; the closing one comes last.
    labelMarker(token) {
      // The label's fragment is on top of the stack, and the link or image below it.
      const node = this.stack[this.stack.length - 2];
      if (node?.type === "link" || node?.type === "image") labelEnds.set(node, token.start.offset);
    },
  },
};
/**
 * Where the text of a link or the description of an image ends in the source:
 * the offset of its closing `]`. Undefined for other nodes and for nodes that
 * `parse` did not make.
 */
export function labelEnd(node: Nodes): number | undefined {
  return labelEnds.get(node);
}
/**
 * What the value of a code span in the tree leaves out, by node: the space or
 * line ending that the parser took off each end, and which lines of the
 * document are lazy continuation lines.
 */
const codeSpanSources = new WeakMap<
  InlineCode,
  { padding: string[]; lazy: Record<number, boolean> }
>();
/**
 * The extensions of one parse that record what code spans leave out. The
 * parser knows which lines are lazy once it has read the document's blocks, and
 * a construct at a backtick, which never matches, reads that from it before a
 * code span is read there.
 */
function codeSpanRecording(): { syntax: SyntaxExtension; tree: TreeExtension } {
  let lazy: Record<number, boolean> = {};
  return {
    syntax: {
      text: {
        [0x60]: {
          // The text tokenizer asks each construct at a backtick whether the
          // character before allows it, and tries them all if one does. This
          // one never does, so the parse is the same as without it.
          previous() {
            lazy = this.parser.lazy;
            return false;
          },
          tokenize(_effects, _ok, nok) {
            lazy = this.parser.lazy;
            return nok;
          },
        },
      },
    },
    tree: {
      exit: {
        // The span's value is collected in a fragment on top of the stack, with
        // the span's node below it.
        codeTextSequence() {
          const node = this.stack[this.stack.length - 2];
          if (node?.type === "inlineCode" && !codeSpanSources.has(node))
            codeSpanSources.set(node, { padding: [], lazy });
        },
        codeTextPadding(token) {
          const node = this.stack[this.stack.length - 2];
          if (node?.type === "inlineCode")
            codeSpanSources.get(node)?.padding.push(this.sliceSerialize(token));
        },
      },
    },
  };
}
/**
 * The text of a code span as GitHub shows it, read in CommonMark's order: the
 * spaces and tabs that start each line after the first are dropped, as from
 * every line of a paragraph, but kept on a lazy continuation line, one that
 * lacks its block quote's `>` or its list item's indentation; then each line
 * ending becomes a space; then one space comes off each end when both ends
 * have one and the span is not only spaces. The parser keeps the spaces and
 * tabs in the span's value, and takes a space or line ending off each end
 * before line endings become spaces (issues #276 and #290). A node that
 * `parse` did not make is read as if its value were all of its content.
 */
export function codeSpanText(node: InlineCode): string {
  const { padding = [], lazy = {} } = codeSpanSources.get(node) ?? {};
  let line = node.position?.start.line ?? 0;
  const content = `${padding[0] ?? ""}${node.value}${padding[1] ?? ""}`.replace(
    /(?:\r\n|\r|\n)([ \t]*)/g,
    (_, indentation: string) => (lazy[++line] ? ` ${indentation}` : " "),
  );
  return /^ [^]* $/.test(content) && /[^ ]/.test(content) ? content.slice(1, -1) : content;
}
/**
 * Whether a code span goes on in a lazy continuation line that starts with
 * spaces or tabs. GitHub keeps them in the span, as `codeSpanText` does, and
 * commonmark.js drops them, so renderers show such a span differently.
 */
export function lazyIndentation(node: InlineCode): boolean {
  const { padding = [], lazy = {} } = codeSpanSources.get(node) ?? {};
  let line = node.position?.start.line ?? 0;
  const content = `${padding[0] ?? ""}${node.value}${padding[1] ?? ""}`;
  for (const [, indentation] of content.matchAll(/(?:\r\n|\r|\n)([ \t]*)/g))
    if (lazy[++line] && indentation) return true;
  return false;
}

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
  const codeSpans = codeSpanRecording();
  const extensions = [frontmatter(["yaml", "toml"]), codeSpans.syntax];
  const mdastExtensions = [frontmatterFromMarkdown(["yaml", "toml"]), labelEndTree, codeSpans.tree];
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
 * literal nodes, in order. A code span gives its text as `codeSpanText` reads
 * it, on one line, a wikilink its label, or else its target, and an Obsidian
 * comment nothing.
 */
export function textContent(node: Nodes): string {
  if (node.type === "wikiLink") return node.label ?? node.target;
  if (node.type === "obsidianComment") return "";
  if (node.type === "inlineCode") return codeSpanText(node);
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(textContent).join("");
  return "";
}
