import {
  cjkFriendlyExtension,
  fromMarkdown,
  gfm,
  gfmAutolinkLiteral,
  gfmFootnote,
  gfmStrikethrough,
} from "./parser.generated.js";
import type { Extension as TreeExtension } from "mdast-util-from-markdown";
import type { Extension as SyntaxExtension } from "micromark-util-types";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { mathFromMarkdown } from "mdast-util-math";
import type { InlineCode, Nodes, Paragraph, Root } from "mdast";
import type { Dialect, DialectName, Document, Plugin } from "../core/types.js";
import { knownDialect } from "../config/resolve.js";
import { math } from "./math.js";
import type { MathConditions } from "./math.js";
import { obsidianSyntax, obsidianTree } from "./obsidian.js";
import type { VitePressOptions } from "../core/types.js";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { projectVitePress, recordVitePress, vitepressCodeText } from "./vitepress/projection.js";

// GFM's tree transform performs GitHub's second, transform-time autolink pass
// (`[www.example.com]` or a Forgejo shortlink's `|https://` in files), but its
// nodes carry no source positions, which made the engine refuse whole documents.
// The link style rules use only positioned literal autolinks;
// plugins inspecting link nodes do not see transform-time autolinks.
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
  const vitepress = vitepressCodeText(node);
  if (vitepress !== undefined) return vitepress;
  const content = codeSpanContent(node);
  return /^ [^]* $/.test(content) && /[^ ]/.test(content) ? content.slice(1, -1) : content;
}
/**
 * The content of a code span as the primary parser reads it, on one line, before
 * the one space comes off each end: what lies between its backticks. In
 * VitePress, `codeSpanText` prefers markdown-it's reading, which can differ for a
 * span across lines; compare the two before relying on this one there.
 */
export function codeSpanContent(node: InlineCode): string {
  const { padding = [], lazy = {} } = codeSpanSources.get(node) ?? {};
  let line = node.position?.start.line ?? 0;
  return `${padding[0] ?? ""}${node.value}${padding[1] ?? ""}`.replace(
    /(?:\r\n|\r|\n)([ \t]*)/g,
    (_, indentation: string) => (lazy[++line] ? ` ${indentation}` : " "),
  );
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
  vitepress: "obsidian",
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
 * The reading with front matter of a document that `parse` read without it,
 * by the tree of the reading without it.
 */
const frontMatterReadings = new WeakMap<Root, Root>();
/**
 * The document read with front matter, where `parse` read it without front
 * matter because its front matter would end inside a code block, an HTML
 * block, or display math. Site generators read front matter there, and so does
 * GitHub's file view when it is a YAML mapping; GitHub's comments and
 * renderers without front matter read the block. Undefined for other trees.
 */
export function frontMatterReading(tree: Root): Root | undefined {
  return frontMatterReadings.get(tree);
}
/**
 * The reading without front matter of a document that `parse` read with TOML
 * front matter, made when it is first asked for, by the tree of the reading
 * with it.
 */
const tomlReadings = new WeakMap<Root, () => Root>();
/** Lazy target-anchor readings without GitHub's formatter dollar-math extension (#570). */
const githubFileReadings = new WeakMap<Root, () => Root>();
function hasTargetMath(tree: Root): boolean {
  const stack: Nodes[] = [tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === "math" || node.type === "inlineMath") return true;
    if ("children" in node) for (const child of node.children) stack.push(child);
  }
  return false;
}
/**
 * The selected tree read without dollar math for GitHub file anchors. Keep its
 * front-matter route and positions; cache the alternative only when requested.
 * Trees without math and trees of other dialects retain their identity. This
 * reading is separate from the formatter's otherReading and plainReading.
 */
export function githubFileReading(tree: Root): Root {
  return githubFileReadings.get(tree)?.() ?? tree;
}
/** All parser-created front-matter roots, including alternate candidates. */
const plainReadings = new WeakMap<Root, () => Root>();
/**
 * The same source read without front matter, made only when first asked for.
 * Returns the supplied tree when it already has no front matter. Unlike
 * otherReading, this does not add a reading to the formatter's safety policy.
 */
export function plainReading(tree: Root): Root {
  return plainReadings.get(tree)?.() ?? tree;
}
/**
 * The other reading of a document, whose meaning an edit has to keep too:
 * `frontMatterReading`, or, for a document that `parse` read with TOML front
 * matter, the reading without it. Site generators read TOML front matter, and
 * GitHub, Forgejo, Gitea, Obsidian, commonmark.js, and markdown-it read its
 * lines as a paragraph, which the line below it can continue or underline as a
 * heading (issue #333). Undefined for other trees.
 */
export function otherReading(tree: Root): Root | undefined {
  return frontMatterReadings.get(tree) ?? tomlReadings.get(tree)?.();
}
/**
 * Whether `node` is the first block below a document's TOML front matter and
 * starts on the line after it, where renderers without TOML front matter can
 * read it as part of the paragraph that the front matter's lines make.
 */
export function belowTomlFrontMatter(tree: Root, node: Nodes): boolean {
  const [matter, block] = tree.children;
  // The tree's types know YAML front matter only; the parser also reads TOML.
  const end = matter?.type === ("toml" as string) ? matter.position?.end.line : undefined;
  return end !== undefined && block === node && block.position?.start.line === end + 1;
}
/**
 * Whether renderers without TOML front matter read the first line of `node`,
 * the block directly below a document's TOML front matter, as part of the
 * paragraph that the front matter's lines make: as its text, as for a list
 * that cannot interrupt a paragraph, or as the underline that makes it a
 * heading.
 */
export function joinsTomlFrontMatter(tree: Root, node: Nodes): boolean {
  const plain = belowTomlFrontMatter(tree, node) ? tomlReadings.get(tree)?.() : undefined;
  if (!plain) return false;
  const line = node.position!.start.line;
  return plain.children.some(
    ({ position }) =>
      position !== undefined && position.start.line < line && position.end.line >= line,
  );
}
/**
 * A line of front matter that could open a block whose content is literal: a
 * code fence, display math, or an HTML block.
 */
const literalOpener = /^ {0,3}(?:`{3,}|~{3,}|\$\$|<)/m;
/** Blocks in which a `---` or `+++` line is content, not a closing line. */
const literalBlocks = new Set(["code", "html", "math"]);
/**
 * The fence, `---` or `+++`, of front matter that the first line of `source`
 * opens and no line closes. The front matter extension opens front matter at a
 * first line of `---` or `+++` followed only by spaces or tabs, and closes it
 * at the next line of the same fence, also followed only by spaces or tabs.
 * Without a closing line the document has no front matter, but the extension
 * then reads the lists and block quotes below as paragraphs (issue #278,
 * micromark/micromark-extension-frontmatter#5). An edit that writes such a line
 * below makes front matter of everything above it.
 */
export function unclosedFrontMatter(source: string): "---" | "+++" | undefined {
  const opening = /^(---|\+\+\+)[ \t]*(?:\r\n|\r|\n)/.exec(source);
  if (!opening) return undefined;
  const fence = opening[1] as "---" | "+++";
  const closing = new RegExp(`(?:^|\\r|\\n)${fence.replaceAll("+", "\\+")}[ \\t]*(?:\\r|\\n|$)`);
  return closing.test(source.slice(opening[0].length)) ? undefined : fence;
}

/**
 * Parse a document in `dialect`, or the dialect that an alias such as
 * `codeberg` stands for, which the result holds; an unknown dialect is an
 * error. Byte order marks at the start of `source` are not part of the
 * document: the document's source starts after them, as the positions in the
 * tree count. `path` is the document's path relative to the workspace root,
 * and `plugins` add their syntax extensions.
 *
 * Front matter whose `---` or `+++` closes it inside a code block, an HTML
 * block, or display math, opened by a line of the front matter, is read as
 * Markdown: the document is read without it (issue #295), and
 * `frontMatterReading` gives the other reading. For a document read with TOML
 * front matter, `otherReading` gives the reading without it (issue #333). A
 * document whose first line would open front matter that no line closes is
 * read without the front matter extension, as renderers read it (issue #278).
 */
export function parse(
  source: string,
  dialect: DialectName,
  path = "document.md",
  plugins: readonly Plugin[] = [],
  vitepress: VitePressOptions = {},
): Document {
  const read = knownDialect(dialect);
  source = splitByteOrderMark(source)[1];
  const projection =
    read === "vitepress"
      ? projectVitePress({
          source,
          dialect: read,
          path,
          tree: { type: "root", children: [] },
          vitepress,
        })
      : undefined;
  const tree = (withFrontMatter: boolean, withMath = true): Root => {
    const codeSpans = codeSpanRecording();
    const extensions = [codeSpans.syntax];
    // External syntax may observe/mutate inline history. Keep its existing
    // attention/strike/CJK fallback and original nonempty label lookup/scan.
    if (plugins.some((plugin) => plugin.syntax !== undefined)) {
      extensions.push({ disable: { null: ["mdrefineDeferredInline"] } });
    } else {
      // #94 trusted-label proof obligations, shared by ALL lazy readings:
      // (a) Core IDs come only from factoryLabel: bare '[' is rejected and
      // normalization cannot remove/introduce '[', ']' or backslashes.
      // factoryLabel escapes only those three characters, so an ID's '['
      // has an odd preceding backslash run; case mapping creates none of them.
      // (b) Only the stock footnote-definition writer makes footnote IDs;
      // these contain no whitespace or unescaped '['/']'.
      // (c) characterEscape stays enabled in every trusted grammar.
      // (d) No trusted text construct ends in a backslash immediately before
      // a label '[' or attempted ']' while a label is open. Literal autolinks
      // are refused inside it; this depends on #542 having no false negatives.
      // Hard-break escapes end at a line ending; code/math/HTML/references and
      // Obsidian literals end on other characters.
      // (e) Events append, roll back, resolve within a code/math construct, or
      // replace a label/footnote suffix and end with a new barrier. Retained
      // prefixes never gain/retype a barrier; resolveAll runs later. This is
      // what makes positive AND negative prefix caches safe, not guards alone.
      // Obsidian has no resolvers and CJK only resolveAll; label/footnote
      // suffix replacement starts at labelLink/labelImage and ends at the new
      // link/image/gfmFootnoteCall barrier. resolveAllLabelEnd runs last.
      // New constructs/resolvers/disable entries/definition writers require
      // re-proving these properties or keeping that grammar off this marker.
      // Empty-dictionary shortcuts need none of (a)-(e) and run on both paths.
      extensions.push({
        disable: { null: ["mdrefineBuiltinLabels", "mdrefineHomogeneousAttention"] },
      });
    }
    const mdastExtensions = [labelEndTree, codeSpans.tree];
    if (withFrontMatter && read !== "vitepress") {
      extensions.unshift(frontmatter(["yaml", "toml"]));
      mdastExtensions.unshift(frontmatterFromMarkdown(["yaml", "toml"]));
    }
    // GitHub, Forgejo, and Gitea share GFM tables, task lists, strikethrough,
    // footnotes, autolinks, and dollar math. Forgejo and Gitea syntax beyond
    // that is protected by rules rather than parsed.
    if (read === "vitepress") {
      extensions.push(gfmTable(), gfmStrikethrough({ singleTilde: false }), gfmAutolinkLiteral());
      const autolinks = { ...gfmAutolinkLiteralFromMarkdown() };
      delete autolinks.transforms;
      mdastExtensions.push(gfmTableFromMarkdown(), gfmStrikethroughFromMarkdown(), autolinks);
      if (vitepress.tasklist !== false) {
        extensions.push(gfmTaskListItem());
        mdastExtensions.push(gfmTaskListItemFromMarkdown());
      }
      if (vitepress.footnote !== false) {
        extensions.push(gfmFootnote());
        mdastExtensions.push(gfmFootnoteFromMarkdown());
      }
      if (vitepress.cjkFriendlyEmphasis !== false) extensions.push(cjkFriendlyExtension());
      if (vitepress.math) {
        extensions.push(math("obsidian"));
        mdastExtensions.push(mathFromMarkdown());
      }
    } else if (read !== "commonmark") {
      // Obsidian marks strikethrough with two tildes only; `~a~` is text there
      // (issue #319).
      extensions.push(gfm({ singleTilde: read !== "obsidian" }));
      mdastExtensions.push(...gfmTree);
      if (withMath) {
        extensions.push(math(mathConditions[read]));
        mdastExtensions.push(mathFromMarkdown());
      }
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
    const parsed = fromMarkdown(projection?.source ?? source, { extensions, mdastExtensions });
    if (read === "github" && withMath) {
      let reading: Root | undefined;
      githubFileReadings.set(parsed, () => {
        if (!reading) reading = hasTargetMath(parsed) ? tree(withFrontMatter, false) : parsed;
        return reading;
      });
    }
    return parsed;
  };
  const result = tree(!unclosedFrontMatter(source));
  if (projection) {
    recordVitePress(result, projection, source);
    return { source, dialect: read, path, tree: result, vitepress };
  }
  // The tree's types know YAML front matter only; the parser also reads TOML.
  const matter = result.children[0] as { type: string; value?: string } | undefined;
  let plain: Root | undefined;
  if (matter?.type === "yaml" || matter?.type === "toml")
    plainReadings.set(result, () => (plain ??= tree(false)));
  // Only front matter with a line that could open such a block is read again.
  // It is given up only when the line that closes it is content of that block
  // in the other reading, which a multiline TOML string or a YAML block
  // scalar holding a fence does not decide by itself.
  if (
    (matter?.type === "yaml" || matter?.type === "toml") &&
    literalOpener.test(matter.value ?? "")
  ) {
    const closing = result.children[0]!.position!.end.line;
    plain = tree(false);
    if (
      plain.children.some(
        (node) =>
          literalBlocks.has(node.type) &&
          node.position!.start.line < closing &&
          node.position!.end.line >= closing,
      )
    ) {
      frontMatterReadings.set(plain, result);
      return { source, dialect: read, path, tree: plain };
    }
  }
  if (matter?.type === "toml") tomlReadings.set(result, plainReadings.get(result)!);
  return { source, dialect: read, path, tree: result };
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
/** An alert's or callout's marker, such as `[!NOTE]` or `[!tip]`. */
const calloutMarker = /^\[![\w-]+\]/;
/**
 * Whether a paragraph starts with text that `pattern` matches, by default an
 * alert's or callout's marker: in `written`, its source from its start, or in
 * its text as renderers read it, where a backslash escape or a character
 * reference stands for the character it writes. GitHub reads `\[!NOTE]`,
 * `&#91;!NOTE]`, and `[!&#78;OTE]` as alerts too (issue #294).
 */
export function startsWithMarker(
  written: string,
  paragraph: Paragraph,
  pattern: RegExp = calloutMarker,
): boolean {
  const first = paragraph.children[0];
  return pattern.test(written) || (first?.type === "text" && pattern.test(first.value));
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
