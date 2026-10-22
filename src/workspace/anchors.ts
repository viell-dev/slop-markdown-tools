import GithubSlugger from "github-slugger";
import { walk } from "../syntax/walk.js";
import type { Heading, Nodes } from "mdast";
import type { Document } from "../core/types.js";
import { blockIdentifier } from "../syntax/block-identifier.js";
import { descriptionLine } from "../syntax/misread-lists.js";
import { parse, range, textContent } from "../syntax/parse.js";
import { lineBreak } from "../syntax/source.js";
import { headingAttributes, lastLineSource } from "./heading-attributes.js";
import { createForgejoSlugger, createGiteaSlugger, giteaAnchor } from "./slug.js";
import { htmlTokens, htmlAnchors, htmlHeadings, htmlView } from "./html.js";
import { githubHeadingLimit } from "./github-heading-source.js";

/** How a renderer shows a heading's inline content when it builds the anchor from the rendered text. */
interface Rendering {
  /** Tags shown as text rather than as HTML, and so part of the anchor. */
  shownTags: RegExp;
  /** What a hard line break contributes. */
  lineBreak: string;
}

/** GFM's tagfilter makes GitHub show these tags as text; a hard break adds nothing. */
const github: Rendering = {
  shownTags:
    /^<\/?(?:iframe|noembed|noframes|plaintext|script|style|title|textarea|xmp)(?=[\t\n\f\r />])/i,
  lineBreak: "",
};

/**
 * Gitea 1.26 and later show these tags as text, drop other disallowed tags
 * while keeping their text, and read a hard break as a line break. Rendered on
 * Gitea 1.27.3 and 28.0.0: `## X <script>a</script> Y` is `#x-scriptascript-y`
 * and `## X <iframe>a</iframe> Y` is `#x-a-y`.
 */
const gitea: Rendering = {
  shownTags: /^<\/?(?:script|style|html|head)(?=[\t\n\f\r />])/i,
  lineBreak: "\n",
};

/**
 * Heading text as rendered, which GitHub and Gitea 1.26 and later build anchors
 * from: inline HTML tags and comments are left out and the text between tags
 * stays, so `## A <span>B</span>` reads `A B`, except for the tags that the
 * renderer shows as text.
 */
function renderedText(node: Nodes, rendering: Rendering): string {
  if (node.type === "html") return rendering.shownTags.test(node.value) ? node.value : "";
  if (node.type === "break") return rendering.lineBreak;
  if ("children" in node)
    return node.children.map((child) => renderedText(child, rendering)).join("");
  return textContent(node);
}

/**
 * Heading text with `_` emphasis delimiters kept, as Gitea 1.26 and later show
 * them near `_.py` (`## __init__.py` reads `__init__.py`, not `init.py`).
 * Everything else is as in Gitea's rendered text.
 */
function literalUnderscoreText(node: Nodes, source: string): string {
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
  return renderedText(node, gitea);
}

/**
 * What Obsidian links to: headings, by the text they show or by their source
 * text, as written or without regard to case, and block identifiers.
 */
interface ObsidianAnchors {
  headings: Set<string>;
  foldedHeadings: Set<string>;
  /**
   * The headings in document order, with their levels and names, for a link to
   * a heading below another one, such as `[[Note#Setup#Mobile]]`.
   */
  outline: { depth: number; names: string[] }[];
  blocks: Set<string>;
}

/** What GitHub links to, and CommonMark in its stead. */
interface GithubAnchors {
  /** Whether generated anchors are known after all of the document's HTML. */
  complete: boolean;
  /** GitHub's numbered heading anchors. */
  slugs: Set<string>;
  /** `id` and `<a name>` values from the document's HTML, lowercased, as GitHub stores and matches them. */
  explicit: Set<string>;
}

/** What Forgejo and Gitea link to; each reads attribute blocks and its own anchor rules. */
interface ForgeAnchors {
  /** Forgejo heading anchors; punctuation runs collapse differently. */
  forgejoSlugs: Set<string>;
  /** Gitea heading anchors; GitHub-like, but combining marks are dropped. */
  giteaSlugs: Set<string>;
  /** `id` and `<a name>` values from the document's HTML, as written, which is how both match them. */
  explicit: Set<string>;
}

/** What one HTML node, or one paragraph holding an inline heading, adds to the page. */
interface HtmlPart {
  anchors: string[];
  headings: { text: string; hasId: boolean }[];
}

/**
 * A copy of a string that shares no memory with the text it was cut from. An
 * engine may store a substring, such as a regular expression's match or a slice
 * of the source, as a reference into the whole string, so a kept heading name
 * or `id` would keep its document's text alive after the parsed document is
 * gone. Joining the string's code units builds a new string of the same
 * content. `text + ""`, a template literal, `String()`, and `substring()` return
 * the same string and detach nothing; measured on Node.js 22 and 24.
 */
function detach(text: string): string {
  return text.split("").join("");
}

/** Replace every string of the sets, which are all a target keeps, by a detached copy. */
function detachAll(...sets: Set<string>[]): void {
  for (const set of sets) {
    const copies = Array.from(set, detach);
    set.clear();
    for (const copy of copies) set.add(copy);
  }
}

/** The document's HTML, tokenized once for the headings and the explicit anchors of a group. */
function htmlParts(document: Document): Map<Nodes, HtmlPart> {
  const parts = new Map<Nodes, HtmlPart>();
  const { source, tree } = document;
  walk(tree, (node) => {
    if (node.type === "html") {
      const tokens = htmlTokens(node.value);
      parts.set(node, { anchors: htmlAnchors(tokens), headings: htmlHeadings(tokens) });
    } else if (node.type === "paragraph" && /<h[1-6]/i.test(source.slice(...range(node))))
      // An inline heading's tags and text are separate nodes, at any depth;
      // their explicit anchors come from the tags' own nodes.
      parts.set(node, { anchors: [], headings: htmlHeadings(htmlTokens(htmlView(node))) });
  });
  return parts;
}

/**
 * Whether the outline holds a chain of headings that `parts` name, each one
 * below the one before, within its section: `Setup#Mobile` is a heading
 * `Mobile` of any lower level after a heading `Setup` and before the next
 * heading of `Setup`'s level or higher. Every heading that a part names is
 * tried, so the link is missing only when no such chain exists.
 */
function hasHeadingPath(outline: ObsidianAnchors["outline"], parts: string[]): boolean {
  const named = (names: string[], part: string) =>
    names.some((name) => name === part || name.toLowerCase() === part.toLowerCase());
  const below = (part: number, from: number, depth: number): boolean => {
    for (let at = from; at < outline.length && outline[at]!.depth > depth; at++)
      if (
        named(outline[at]!.names, parts[part]!) &&
        (part === parts.length - 1 || below(part + 1, at + 1, outline[at]!.depth))
      )
        return true;
    return false;
  };
  return below(0, 0, 0);
}

/** A target's anchors for Obsidian. */
function obsidianAnchors(document: Document): ObsidianAnchors {
  const anchors: ObsidianAnchors = {
    headings: new Set(),
    foldedHeadings: new Set(),
    outline: [],
    blocks: new Set(),
  };
  const { source } = document;
  walk(document.tree, (node) => {
    const block = blockIdentifier(source, node);
    if (block) anchors.blocks.add(block.id);
    if (node.type !== "heading") return;
    // A link may name a heading by the text it shows or as its source writes
    // it: the heading `` `move` `` is both `move` and `` `move` ``.
    const first = node.children[0];
    const written = first ? source.slice(range(first)[0], range(node.children.at(-1)!)[1]) : "";
    const names = [...new Set([textContent(node), written])].map(detach);
    for (const name of names) {
      anchors.headings.add(name);
      anchors.foldedHeadings.add(name.toLowerCase());
    }
    anchors.outline.push({ depth: node.depth, names });
  });
  // The names are detached already, and so is their lowercase form.
  detachAll(anchors.blocks);
  return anchors;
}

/** A target's anchors for GitHub and CommonMark. */
function githubAnchors(document: Document): GithubAnchors {
  const limit = githubHeadingLimit(document);
  const anchors: GithubAnchors = {
    complete: limit === undefined,
    slugs: new Set(),
    explicit: new Set(),
  };
  const slugger = new GithubSlugger();
  const parts = htmlParts(document);
  // GitHub numbers the anchors of Markdown and HTML headings together, in
  // document order, and prefixes an id only when it does not already start
  // with the prefix.
  const add = (text: string) => anchors.slugs.add(slugger.slug(text).replace(/^user-content-/, ""));
  walk(document.tree, (node) => {
    if (limit !== undefined && (node.position?.start.offset ?? 0) >= limit) return;
    const part = parts.get(node);
    if (part) for (const heading of part.headings) add(heading.text);
    else if (node.type === "heading") add(renderedText(node, github));
  });
  // Explicit anchors, inline or in HTML blocks, do not affect heading numbering.
  for (const part of parts.values())
    for (const anchor of part.anchors) anchors.explicit.add(anchor.toLowerCase());
  detachAll(anchors.slugs, anchors.explicit);
  return anchors;
}

/** A target's anchors for Forgejo and Gitea. */
function forgeAnchors(document: Document): ForgeAnchors {
  const anchors: ForgeAnchors = {
    forgejoSlugs: new Set(),
    giteaSlugs: new Set(),
    explicit: new Set(),
  };
  const forgejoSlugger = createForgejoSlugger();
  const giteaSlugger = createGiteaSlugger();
  const parts = htmlParts(document);
  /**
   * Adds the anchors of the headings in `part`, in document order: the
   * document, or the content of a definition description in it, whose HTML
   * the document's own parts already hold.
   */
  const collect = (part: Document) => {
    const { source } = part;
    const attributes = headingAttributes(part);
    // How many block quotes each heading is in, for the markers of its last line.
    const quotes = new Map<Heading, number>();
    const count = (node: Nodes, depth: number) => {
      if (node.type === "heading") quotes.set(node, depth);
      if ("children" in node)
        for (const child of node.children)
          count(child, depth + (node.type === "blockquote" ? 1 : 0));
    };
    count(part.tree, 0);
    walk(part.tree, (node, index, parent) => {
      // Gitea 1.26 and later give HTML headings without an `id` an anchor from
      // their text, and number nothing. Forgejo gives them none.
      for (const heading of part === document ? (parts.get(node)?.headings ?? []) : []) {
        const anchor = heading.hasId ? "" : giteaAnchor(heading.text);
        if (anchor) anchors.giteaSlugs.add(anchor);
      }
      // Forgejo and Gitea read a definition description as blocks, where the
      // parser reads text, and give its headings anchors in their place in the
      // document (issue #353).
      if (node.type === "paragraph") {
        const previous = index === undefined ? undefined : parent?.children[index - 1];
        for (const content of descriptionContents(source, node, previous))
          collect(parse(content, part.dialect, part.path));
        return;
      }
      if (node.type !== "heading") return;
      // Forgejo and Gitea take a trailing `{#id .class}` as attributes, not text.
      const block = attributes.get(node);
      if (block?.id !== undefined) {
        // A non-string id is empty on Gitea 1.26 and later and unrenderable before.
        const anchor = forgejoSlugger.custom(block.id ?? "");
        if (anchor) anchors.forgejoSlugs.add(anchor);
        if (giteaSlugger.custom(block.id ?? "")) anchors.giteaSlugs.add(anchor);
        return;
      }
      // Forgejo, like Gitea before 1.26, builds anchors from the source of
      // the heading's last line: markup, destinations, and tags are part of it.
      const line = lastLineSource(source, node, quotes.get(node) ?? 0, block?.start);
      anchors.forgejoSlugs.add(forgejoSlugger.slug(line));
      anchors.giteaSlugs.add(giteaSlugger.slug(line));
      // Gitea 1.26 and later number no anchors, build them from the rendered
      // text, and keep underscores near `_.py` literal.
      const shown = block?.heading ?? node;
      const [start, end] = range(shown);
      const anchor = giteaAnchor(
        source.slice(start, block ? Math.min(end, block.start) : end).includes("_.py")
          ? literalUnderscoreText(shown, source)
          : renderedText(shown, gitea),
      );
      if (anchor) anchors.giteaSlugs.add(anchor);
    });
  };
  collect(document);
  // Explicit anchors, inline or in HTML blocks, do not affect heading numbering.
  for (const part of parts.values())
    for (const anchor of part.anchors) anchors.explicit.add(anchor);
  detachAll(anchors.forgejoSlugs, anchors.giteaSlugs, anchors.explicit);
  return anchors;
}

/**
 * What follows the `:` and the blank space after it on each line of a
 * paragraph that Forgejo and Gitea read as opening a definition description,
 * as `Term` and `: # Heading` below it do: a line below the paragraph's first,
 * or its first after another paragraph, which ends with a term or a
 * description. The rest of the description is below that line, where the
 * parser reads the blocks that interrupt the paragraph as Forgejo and Gitea do.
 */
function descriptionContents(
  source: string,
  paragraph: Nodes,
  previous: Nodes | undefined,
): string[] {
  const [start, end] = range(paragraph);
  const text = source.slice(start, end);
  const contents: string[] = [];
  if (!descriptionLine.test(text)) return contents;
  text.split(lineBreak).forEach((line, index) => {
    const content = /^[ \t>]*:[ \t]+(.*)$/.exec(line)?.[1];
    if (content && (index > 0 || previous?.type === "paragraph")) contents.push(content);
  });
  return contents;
}
export { hasHeadingPath, obsidianAnchors, githubAnchors, forgeAnchors };
export type { ObsidianAnchors, GithubAnchors, ForgeAnchors };
