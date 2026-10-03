import path from "node:path";
import GithubSlugger from "github-slugger";
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { walk } from "../syntax/walk.js";
import type { Heading, Nodes } from "mdast";
import type { Dialect, LinkResolution, Workspace } from "../core/types.js";
import { parse, range, textContent } from "../syntax/parse.js";
import { headingAttributes, lastLineSource } from "./heading-attributes.js";
import { createForgejoSlugger, createGiteaSlugger, giteaAnchor } from "./slug.js";

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
/**
 * The anchors that HTML in a document adds: the `id` of any element and the
 * `name` of an `<a>`, as written. GitHub, Forgejo, and Gitea keep both on the
 * elements they allow and add their `user-content-` prefix to them unless it is
 * already there, as they do to a link's fragment, so an `id` written with the
 * prefix is recorded without it. The scan follows HTML tokenization in one
 * pass: comments, which run to the end when unterminated, declarations, and
 * raw-text elements with their content are skipped, and a `<!--` inside a
 * tag's quoted value is part of the value. Every value of a repeated attribute
 * counts: Forgejo 16 and Gitea 1.26 keep the first, Gitea 1.25 the last.
 */
function htmlAnchors(html: string): string[] {
  const anchors: string[] = [];
  const lower = html.toLowerCase();
  for (let at = html.indexOf("<"); at >= 0; at = html.indexOf("<", at + 1)) {
    if (html.startsWith("<!--", at)) {
      const end = html.indexOf("-->", at + 4);
      if (end < 0) break;
      at = end + 2;
      continue;
    }
    if (html[at + 1] === "!" || html[at + 1] === "?") {
      const end = html.indexOf(">", at);
      if (end < 0) break;
      at = end;
      continue;
    }
    openTag.lastIndex = at;
    const tag = openTag.exec(html);
    if (!tag) continue;
    const name = tag[1]!.toLowerCase();
    at += tag[0].length - 1;
    if (rawText.has(name)) {
      const end = lower.indexOf(`</${name}`, at);
      if (end < 0) break;
      at = end;
      continue;
    }
    for (const match of tag[2]!.matchAll(attribute)) {
      const attributeName = match[1]!.toLowerCase();
      if (attributeName !== "id" && !(name === "a" && attributeName === "name")) continue;
      const value = (match[2] ?? match[3] ?? match[4] ?? "").replace(/^user-content-/, "");
      if (value) anchors.push(value);
    }
  }
  return anchors;
}

/** A character reference, which HTML decodes in an element's text. */
const characterReference = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z\d]*));/g;
function decodeReferences(text: string): string {
  return text.replace(characterReference, (reference, decimal, hex, name) => {
    if (name) return decodeNamedCharacterReference(name) || reference;
    const code = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : reference;
  });
}
/** An `<h1>` to `<h6>` element with its attributes and content. */
const htmlHeading =
  /<h([1-6])\b((?:[ \t\r\n]+[A-Za-z_:][\w.:-]*(?:[ \t\r\n]*=[ \t\r\n]*(?:"[^"]*"|'[^']*'|[^ \t\r\n"'=<>`]+))?)*)[ \t\r\n]*>([\s\S]*?)<\/h\1[ \t\r\n]*>/gi;
/**
 * The HTML that reaches the page as markup: without comments, which run to the
 * end when unterminated, declarations, and raw-text elements with their
 * content, found in one pass as `htmlAnchors` finds them.
 */
function visibleHtml(html: string): string {
  const lower = html.toLowerCase();
  let visible = "";
  let copied = 0;
  for (let at = html.indexOf("<"); at >= 0; at = html.indexOf("<", at + 1)) {
    if (at < copied) continue;
    let skipTo: number;
    if (html.startsWith("<!--", at)) {
      const end = html.indexOf("-->", at + 4);
      skipTo = end < 0 ? html.length : end + 3;
    } else if (html[at + 1] === "!" || html[at + 1] === "?") {
      const end = html.indexOf(">", at);
      skipTo = end < 0 ? html.length : end + 1;
    } else {
      openTag.lastIndex = at;
      const tag = openTag.exec(html);
      if (!tag || !rawText.has(tag[1]!.toLowerCase())) continue;
      const close = lower.indexOf(`</${tag[1]!.toLowerCase()}`, at + tag[0].length);
      const end = close < 0 ? -1 : html.indexOf(">", close);
      skipTo = end < 0 ? html.length : end + 1;
    }
    visible += html.slice(copied, at);
    copied = skipTo;
    at = skipTo - 1;
  }
  return visible + html.slice(copied);
}
/**
 * Headings written as HTML, as GitHub and Gitea 1.26 and later see them when
 * they generate anchors: the text content with inner tags removed and character
 * references decoded, and whether the tag sets its own `id`.
 */
function htmlHeadings(html: string): { text: string; hasId: boolean }[] {
  const headings: { text: string; hasId: boolean }[] = [];
  for (const match of visibleHtml(html).matchAll(htmlHeading)) {
    const hasId = [...match[2]!.matchAll(attribute)].some(
      (item) => item[1]!.toLowerCase() === "id",
    );
    headings.push({ text: decodeReferences(match[3]!.replace(/<[^>]*>/g, "")), hasId });
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
  /** `id` and `<a name>` values from the document's HTML, which Forgejo and Gitea match as written. */
  htmlAnchors: Set<string>;
  /** The same lowercased, as GitHub stores and matches them. */
  foldedHtmlAnchors: Set<string>;
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
      htmlAnchors: new Set(),
      foldedHtmlAnchors: new Set(),
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
      // How many block quotes each heading is in, for the markers of its last line.
      const quotes = new Map<Heading, number>();
      const count = (node: Nodes, depth: number) => {
        if (node.type === "heading") quotes.set(node, depth);
        if ("children" in node)
          for (const child of node.children)
            count(child, depth + (node.type === "blockquote" ? 1 : 0));
      };
      count(document.tree, 0);
      // GitHub numbers the anchors of Markdown and HTML headings together, in
      // document order; Gitea 1.26 and later give HTML headings without an `id`
      // an anchor from their text, and number nothing. Forgejo gives them none.
      const addHtmlHeadings = (html: string) => {
        for (const heading of htmlHeadings(html)) {
          entry.slugs.add(slugger.slug(heading.text));
          const anchor = heading.hasId ? "" : giteaAnchor(heading.text);
          if (anchor) entry.giteaSlugs.add(anchor);
        }
      };
      walk(document.tree, (node) => {
        if (node.type === "html") return addHtmlHeadings(node.value);
        if (node.type === "paragraph" && node.children.some((child) => child.type === "html"))
          return addHtmlHeadings(htmlView(node));
        if (node.type !== "heading") return;
        const text = textContent(node);
        entry.headings.add(text);
        entry.foldedHeadings.add(text.toLowerCase());
        // GitHub prefixes an id only when it does not already start with the prefix.
        entry.slugs.add(slugger.slug(renderedText(node, github)).replace(/^user-content-/, ""));
        // Forgejo and Gitea take a trailing `{#id .class}` as attributes, not text.
        const block = attributes.get(node);
        if (block?.id !== undefined) {
          // A non-string id is empty on Gitea 1.26 and later and unrenderable before.
          const anchor = forgejoSlugger.custom(block.id ?? "");
          if (anchor) entry.forgejoSlugs.add(anchor);
          if (giteaSlugger.custom(block.id ?? "")) entry.giteaSlugs.add(anchor);
          return;
        }
        // Forgejo, like Gitea before 1.26, builds anchors from the source of
        // the heading's last line: markup, destinations, and tags are part of it.
        const line = lastLineSource(source, node, quotes.get(node) ?? 0, block?.start);
        entry.forgejoSlugs.add(forgejoSlugger.slug(line));
        entry.giteaSlugs.add(giteaSlugger.slug(line));
        // Gitea 1.26 and later number no anchors, build them from the rendered
        // text, and keep underscores near `_.py` literal.
        const shown = block?.heading ?? node;
        const [start, end] = range(shown);
        const anchor = giteaAnchor(
          source.slice(start, block ? Math.min(end, block.start) : end).includes("_.py")
            ? literalUnderscoreText(shown, source)
            : renderedText(shown, gitea),
        );
        if (anchor) entry.giteaSlugs.add(anchor);
      });
      walk(document.tree, "text", (node) => {
        const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(node.value);
        if (match) entry.blocks.add(match[1]!);
      });
      // Explicit anchors, inline or in HTML blocks, do not affect heading numbering.
      walk(document.tree, "html", (node) => {
        for (const anchor of htmlAnchors(node.value)) {
          entry.htmlAnchors.add(anchor);
          entry.foldedHtmlAnchors.add(anchor.toLowerCase());
        }
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
      // GitHub, Forgejo, and Gitea store anchors with a `user-content-` prefix
      // and add it to a link's fragment unless it is already there, so a link
      // written with the prefix reaches the same anchor as one without. Gitea
      // 1.26 and later prefix a generated anchor that already has the prefix
      // again, and a browser reaches that element with the fragment as written.
      // GitHub's page script also retries a fragment lowercased, and its anchors are.
      const anchor = fragment.replace(/^user-content-/, "");
      const fragmentExists =
        !fragment ||
        (dialect === "obsidian"
          ? fragment.startsWith("^")
            ? entry!.blocks.has(fragment.slice(1))
            : entry!.headings.has(fragment) || entry!.foldedHeadings.has(fragment.toLowerCase())
          : dialect === "forgejo"
            ? entry!.forgejoSlugs.has(anchor) ||
              entry!.forgejoSlugs.has(fragment) ||
              entry!.htmlAnchors.has(anchor) ||
              entry!.htmlAnchors.has(fragment)
            : dialect === "gitea"
              ? entry!.giteaSlugs.has(anchor) ||
                entry!.giteaSlugs.has(fragment) ||
                entry!.htmlAnchors.has(anchor) ||
                entry!.htmlAnchors.has(fragment)
              : entry!.slugs.has(anchor.toLowerCase()) ||
                entry!.foldedHtmlAnchors.has(anchor.toLowerCase()));
      return { status: "resolved", target, fragment, fragmentExists };
    },
  };
}
