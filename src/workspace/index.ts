import path from "node:path";
import GithubSlugger from "github-slugger";
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { walk } from "../syntax/walk.js";
import type { Heading, Nodes } from "mdast";
import type { Dialect, Document, LinkResolution, Workspace } from "../core/types.js";
import { fallbackDialect } from "../config/resolve.js";
import { parse, range, textContent } from "../syntax/parse.js";
import { headingAttributes, lastLineSource } from "./heading-attributes.js";
import { createForgejoSlugger, createGiteaSlugger, giteaAnchor } from "./slug.js";
import { refusal } from "./access.js";

/**
 * A Markdown file's text, null for a file that is not Markdown, or a loader
 * that returns the text when a fragment check needs it. A loader that throws an
 * error whose `code` is `EACCES` or `EPERM` marks the file as unreadable; any
 * other error propagates.
 */
export type WorkspaceSource = string | null | (() => string);

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
/** An HTML open tag with its attributes, by CommonMark's grammar for raw HTML. */
const openTag =
  /<([A-Za-z][A-Za-z0-9-]*)((?:[ \t\r\n]+[A-Za-z_:][\w.:-]*(?:[ \t\r\n]*=[ \t\r\n]*(?:"[^"]*"|'[^']*'|[^ \t\r\n"'=<>`]+))?)*)[ \t\r\n]*\/?>/y;
const closeTag = /<\/([A-Za-z][A-Za-z0-9-]*)[ \t\r\n]*>/y;
const attribute =
  /([A-Za-z_:][\w.:-]*)(?:[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)'|([^ \t\r\n"'=<>`]+)))?/g;
/**
 * Elements whose content HTML reads as text and that no renderer shows as an
 * element: GitHub's tagfilter shows these tags as text, Forgejo removes them,
 * and Gitea shows them as text or removes them. `<plaintext>` has no end.
 */
const rawText = new Set([
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);
/** A tag that becomes an element, or the text between tags. */
type HtmlToken =
  { name: string; attributes: string; close: boolean } | { name?: undefined; text: string };
/**
 * HTML as a browser tokenizes it, in one forward pass: comments, which run to
 * the end when unterminated, declarations, and raw-text elements with their
 * content are left out, and a tag is read whole, so a `<!--` or `<h2>` inside
 * a quoted attribute value is part of the value.
 */
function htmlTokens(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const lower = html.toLowerCase();
  let copied = 0;
  const text = (end: number) => {
    if (end > copied) tokens.push({ text: html.slice(copied, end) });
  };
  for (let at = html.indexOf("<"); at >= 0; at = html.indexOf("<", at)) {
    let end: number;
    if (html.startsWith("<!--", at)) {
      const close = html.indexOf("-->", at + 4);
      end = close < 0 ? html.length : close + 3;
      text(at);
    } else if (html[at + 1] === "!" || html[at + 1] === "?") {
      const close = html.indexOf(">", at);
      end = close < 0 ? html.length : close + 1;
      text(at);
    } else {
      openTag.lastIndex = closeTag.lastIndex = at;
      const open = openTag.exec(html);
      const tag = open ?? closeTag.exec(html);
      if (!tag) {
        // A `<` that starts no tag is text.
        at++;
        continue;
      }
      const name = tag[1]!.toLowerCase();
      end = at + tag[0].length;
      text(at);
      if (!open) tokens.push({ name, attributes: "", close: true });
      else if (!rawText.has(name)) tokens.push({ name, attributes: tag[2]!, close: false });
      else {
        const close = name === "plaintext" ? -1 : lower.indexOf(`</${name}`, end);
        const after = close < 0 ? -1 : html.indexOf(">", close);
        end = after < 0 ? html.length : after + 1;
      }
    }
    copied = at = end;
  }
  text(html.length);
  return tokens;
}
/**
 * The anchors that HTML in a document adds: the `id` of any element and the
 * `name` of an `<a>`, as written. GitHub, Forgejo, and Gitea keep both on the
 * elements they allow and add their `user-content-` prefix to them unless it is
 * already there, as they do to a link's fragment, so an `id` written with the
 * prefix is recorded without it. Every value of a repeated attribute counts:
 * Forgejo 16 and Gitea 1.26 keep the first, Gitea 1.25 the last.
 */
function htmlAnchors(tokens: HtmlToken[]): string[] {
  const anchors: string[] = [];
  for (const token of tokens) {
    if (token.name === undefined || token.close) continue;
    for (const match of token.attributes.matchAll(attribute)) {
      const attributeName = match[1]!.toLowerCase();
      if (attributeName !== "id" && !(token.name === "a" && attributeName === "name")) continue;
      const value = (match[2] ?? match[3] ?? match[4] ?? "").replace(/^user-content-/, "");
      if (value) anchors.push(value);
    }
  }
  return anchors;
}

/**
 * A character reference, which HTML decodes in an element's text. A numeric one
 * needs no semicolon, and one that names no character becomes U+FFFD.
 */
const characterReference = /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z][A-Za-z\d]*);)/g;
function decodeReferences(text: string): string {
  return text.replace(characterReference, (reference, decimal, hex, name) => {
    if (name) return decodeNamedCharacterReference(name) || reference;
    const code = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : "�";
  });
}
const headingTag = /^h[1-6]$/;
/**
 * Headings written as HTML, as GitHub and Gitea 1.26 and later see them when
 * they generate anchors: the text content with inner tags removed and character
 * references decoded, and whether the tag sets its own `id`. As in HTML, a
 * heading's start tag also ends an open heading, and any heading's end tag
 * closes it. A heading left open at the end is not reported: the renderers
 * continue it through the Markdown that follows, which is not modeled.
 */
function htmlHeadings(tokens: HtmlToken[]): { text: string; hasId: boolean }[] {
  const headings: { text: string; hasId: boolean }[] = [];
  let open: { text: string; hasId: boolean } | undefined;
  const close = () => {
    if (open) headings.push({ text: decodeReferences(open.text), hasId: open.hasId });
    open = undefined;
  };
  for (const token of tokens) {
    if (token.name === undefined) {
      if (open) open.text += token.text;
    } else if (headingTag.test(token.name)) {
      close();
      if (!token.close)
        open = {
          text: "",
          hasId: [...token.attributes.matchAll(attribute)].some(
            (item) => item[1]!.toLowerCase() === "id",
          ),
        };
    }
  }
  return headings;
}
/**
 * A paragraph as HTML, for headings that are written inline: the HTML tags as
 * written around the text that the renderers put between them, with the text's
 * own `<` and `&` escaped so that only real tags are read.
 */
function htmlView(node: Nodes): string {
  if (node.type === "html") return node.value;
  if (node.type === "break") return "\n";
  if ("children" in node) return node.children.map(htmlView).join("");
  return textContent(node).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

/** What Obsidian links to: exact heading text, matched case-insensitively, and block identifiers. */
interface ObsidianAnchors {
  headings: Set<string>;
  foldedHeadings: Set<string>;
  blocks: Set<string>;
}
/** What GitHub links to, and CommonMark in its stead. */
interface GithubAnchors {
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
  /** Whether the system refused to let the target's source be read. */
  unreadable?: true;
  obsidian?: ObsidianAnchors;
  github?: GithubAnchors;
  forge?: ForgeAnchors;
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
/** A target's anchors for Obsidian; none for a target that is not Markdown source. */
function obsidianAnchors(document: Document | null): ObsidianAnchors {
  const anchors: ObsidianAnchors = {
    headings: new Set(),
    foldedHeadings: new Set(),
    blocks: new Set(),
  };
  if (!document) return anchors;
  walk(document.tree, "heading", (node) => {
    const text = textContent(node);
    anchors.headings.add(text);
    anchors.foldedHeadings.add(text.toLowerCase());
  });
  walk(document.tree, "text", (node) => {
    const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(node.value);
    if (match) anchors.blocks.add(match[1]!);
  });
  detachAll(anchors.headings, anchors.foldedHeadings, anchors.blocks);
  return anchors;
}
/** A target's anchors for GitHub and CommonMark; none for a target that is not Markdown source. */
function githubAnchors(document: Document | null): GithubAnchors {
  const anchors: GithubAnchors = { slugs: new Set(), explicit: new Set() };
  if (!document) return anchors;
  const slugger = new GithubSlugger();
  const parts = htmlParts(document);
  // GitHub numbers the anchors of Markdown and HTML headings together, in
  // document order, and prefixes an id only when it does not already start
  // with the prefix.
  const add = (text: string) => anchors.slugs.add(slugger.slug(text).replace(/^user-content-/, ""));
  walk(document.tree, (node) => {
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
/** A target's anchors for Forgejo and Gitea; none for a target that is not Markdown source. */
function forgeAnchors(document: Document | null): ForgeAnchors {
  const anchors: ForgeAnchors = {
    forgejoSlugs: new Set(),
    giteaSlugs: new Set(),
    explicit: new Set(),
  };
  if (!document) return anchors;
  const { source } = document;
  const forgejoSlugger = createForgejoSlugger();
  const giteaSlugger = createGiteaSlugger();
  const attributes = headingAttributes(document);
  const parts = htmlParts(document);
  // How many block quotes each heading is in, for the markers of its last line.
  const quotes = new Map<Heading, number>();
  const count = (node: Nodes, depth: number) => {
    if (node.type === "heading") quotes.set(node, depth);
    if ("children" in node)
      for (const child of node.children) count(child, depth + (node.type === "blockquote" ? 1 : 0));
  };
  count(document.tree, 0);
  walk(document.tree, (node) => {
    // Gitea 1.26 and later give HTML headings without an `id` an anchor from
    // their text, and number nothing. Forgejo gives them none.
    for (const heading of parts.get(node)?.headings ?? []) {
      const anchor = heading.hasId ? "" : giteaAnchor(heading.text);
      if (anchor) anchors.giteaSlugs.add(anchor);
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
  // Explicit anchors, inline or in HTML blocks, do not affect heading numbering.
  for (const part of parts.values())
    for (const anchor of part.anchors) anchors.explicit.add(anchor);
  detachAll(anchors.forgejoSlugs, anchors.giteaSlugs, anchors.explicit);
  return anchors;
}
export interface WorkspaceOptions {
  /** The dialect that link targets are parsed in; `github` when omitted. */
  dialect?: Dialect;
  strictLineBreaks?: boolean;
  /** Existing directories, including empty ones; never treated as note targets. */
  directories?: string[];
  /**
   * Existing directories whose contents could not be read. A link that leads
   * into one, or that an Obsidian name search finds nowhere else, resolves as
   * `unreadable` instead of `missing`.
   */
  unreadable?: string[];
  /**
   * Folders below the workspace root that are Obsidian vaults of their own. An
   * Obsidian link in a note of such a vault reaches only the vault's files: a
   * path is counted from the vault's folder, and a search by name looks inside
   * it. Other dialects, and notes outside these folders, resolve as without it.
   */
  vaults?: string[];
  /**
   * The workspace root's own path inside an Obsidian vault, such as
   * `Projects/Notes`, when the root is a folder of that vault and not the vault
   * itself. The rest of the vault is then out of sight: an Obsidian link whose
   * target could lie there, or be outdone by a note there, resolves as
   * `unreadable` or as `resolved` with `unreadable` set, never as `missing`.
   */
  rootInVault?: string;
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
  /**
   * One group of a target's anchors, from the target read and parsed for it;
   * nothing keeps the parsed document. A target that is not Markdown source has
   * no anchors. Undefined for a target that the system refuses to let be read,
   * which is marked and not read again.
   */
  function compute<Anchors>(
    target: Target,
    name: string,
    anchors: (document: Document | null) => Anchors,
  ): Anchors | undefined {
    if (target.unreadable) return undefined;
    const value = sources.get(name);
    if (value === null || value === undefined || !/\.md$/i.test(name)) return anchors(null);
    let source: string;
    try {
      source = typeof value === "function" ? value() : value;
    } catch (error) {
      // The file exists, but its anchors are unknown; any other error is a fault.
      if (!refusal(error)) throw error;
      target.unreadable = true;
      return undefined;
    }
    return anchors(parse(source, options.dialect ?? fallbackDialect, name));
  }
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
    let target = targets.get(name);
    if (!target) targets.set(name, (target = {}));
    if (dialect === "obsidian") {
      const anchors = target.obsidian ?? compute(target, name, obsidianAnchors);
      if (!anchors) return undefined;
      target.obsidian = anchors;
      return fragment.startsWith("^")
        ? anchors.blocks.has(fragment.slice(1))
        : anchors.headings.has(fragment) || anchors.foldedHeadings.has(fragment.toLowerCase());
    }
    if (dialect === "forgejo" || dialect === "gitea") {
      const forge = target.forge ?? compute(target, name, forgeAnchors);
      if (!forge) return undefined;
      target.forge = forge;
      const slugs = dialect === "forgejo" ? forge.forgejoSlugs : forge.giteaSlugs;
      if (slugs.has(anchor) || slugs.has(fragment)) return true;
      return forge.explicit.has(anchor) || forge.explicit.has(fragment);
    }
    const anchors = target.github ?? compute(target, name, githubAnchors);
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
      found.push(...namesMatching(rest));
      if (!path.posix.extname(rest)) found.push(...namesMatching(`${rest}.md`));
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
      if (slash < 0) found.push(...sharing);
      else {
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
            (isDirectory(bare, true) ? bare : undefined);
          return;
        }
        if (isDirectory(bare, folded)) directory = true;
        const above = unreadableAbove(bare, folded);
        if (above !== undefined) blocking.add(above);
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
      if (candidates.size === 0 && (blocking.size > 0 || unsearched || unseen.length > 0))
        return {
          status: "unreadable",
          unreadable: [...(blocking.size ? blocking : unsearched ? hidden : []), ...unseen],
          ...(vault ? { vault } : {}),
        };
      if (candidates.size !== 1)
        return {
          status: candidates.size ? "ambiguous" : "missing",
          ...(vault ? { vault } : {}),
          ...(candidates.size === 0 && outside !== undefined ? { outside } : {}),
        };
      const resolved = [...candidates][0]!;
      const fragment = parts.fragment;
      let fragmentExists = true;
      if (fragment) {
        const found = hasAnchor(
          resolved,
          dialect,
          fragment,
          fragment.replace(/^user-content-/, ""),
        );
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
    },
  };
}
