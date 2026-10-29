import type { Code, Nodes } from "mdast";
import type { Document, Workspace } from "./types.js";
import { codeSpanText, otherReading, parse, range, startsWithMarker } from "../syntax/parse.js";
import { vitepressSemantics } from "../syntax/vitepress/guard.js";
import { headingAnchorSource, headingAttributeSource } from "../workspace/heading-attributes.js";
import { githubAnchors } from "../workspace/anchors.js";
import { githubHeadingLimit } from "../workspace/github-heading-source.js";
import { walk } from "../syntax/walk.js";
import { lineBreak } from "../syntax/source.js";

/**
 * The meaning of a parsed document as text, which `format` compares before and
 * after edits to refuse a change of meaning: its syntax tree without positions,
 * with runs of whitespace in text alike, and with each link's destination as
 * the workspace resolves it, so that two spellings of one target are the same.
 */
export function semanticFingerprint(document: Document, workspace?: Workspace): string {
  return JSON.stringify(semanticTree(document, workspace));
}
/** Internal host guard: replace only explicitly approved literal code values. */
export function semanticFingerprintWithCode(
  document: Document,
  values: WeakMap<Code, string>,
  workspace?: Workspace,
): string {
  return JSON.stringify(semanticTree(document, workspace, undefined, values));
}
/** Internal host guard: trust only the selected metadata value, never its surroundings. */
export function semanticFingerprintWithFrontMatter(
  document: Document,
  node: Nodes,
  value: string,
  source: string,
  workspace?: Workspace,
): string {
  return JSON.stringify(
    semanticTree(document, workspace, undefined, undefined, { node, value, source }),
  );
}
/**
 * The document's meaning as plain data whose keys are in sorted order. With
 * `origins`, each object of the result that stands for a node of the document
 * is mapped to that node.
 */
function semanticTree(
  document: Document,
  workspace?: Workspace,
  origins?: Map<unknown, Nodes>,
  codeValues?: WeakMap<Code, string>,
  frontMatter?: { node: Nodes; value: string; source: string },
): unknown {
  const githubHeadings = new Map<Nodes, string[]>();
  const githubSources = new Map<Nodes, string>();
  if (document.dialect === "github") {
    const alternative = otherReading(document.tree);
    for (const tree of alternative ? [document.tree, alternative] : [document.tree]) {
      const reading = { ...document, tree };
      githubAnchors(reading, (node, slug) => {
        const headings = githubHeadings.get(node);
        if (headings) headings.push(slug);
        else githubHeadings.set(node, [slug]);
      });
      const limit = githubHeadingLimit(reading);
      if (limit !== undefined) {
        let recorded = false;
        walk(tree, (node) => {
          if (!recorded && node.type !== "root" && node.position?.start.offset === limit) {
            githubSources.set(node, document.source.slice(limit));
            recorded = true;
          }
        });
      }
    }
  }
  const canonicalUrl = (url: string, wiki = false) => {
    const resolution = workspace?.resolve(document.path, url, document.dialect, wiki);
    // A target that is uncertain, because a directory could not be read, is not
    // an identity: only the same spelling is known to name the same note.
    return resolution?.status === "resolved" &&
      typeof resolution.target === "string" &&
      !resolution.unreadable
      ? {
          fragment: resolution.fragment ?? "",
          ...(document.dialect === "vitepress"
            ? { query: /\?[^#]*/.exec(url.split("#", 1)[0]!)?.[0] ?? "" }
            : {}),
          target: resolution.target,
        }
      : url;
  };
  // Keys are emitted in sorted order so the JSON text is canonical without a replacer.
  function normalize(node: Nodes, calloutHeader = false): unknown {
    if (node.type === "wikiLink") {
      const link = node.embed
        ? { label: node.label, type: "embed", url: canonicalUrl(node.target, true) }
        : {
            children: [{ type: "text", value: node.label ?? node.target }],
            title: null,
            type: "link",
            url: canonicalUrl(node.target, true),
          };
      origins?.set(link, node);
      return link;
    }
    const result: Record<string, unknown> = {};
    // Anchor differences belong to their heading/block, so a refusal names
    // that source location instead of stopping at root-level metadata.
    const headingSlugs = githubHeadings.get(node);
    if (headingSlugs) result.githubAnchors = headingSlugs;
    const headingSource = githubSources.get(node);
    if (headingSource !== undefined) result.githubHeadingSource = headingSource;
    // Forgejo and Gitea read a heading's trailing `{...}` block as attributes,
    // character for character, where the tree holds ordinary inline content,
    // and generate the anchor from the heading's last line as written.
    if (node.type === "heading") {
      const attributes = headingAttributeSource(document, node);
      if (attributes !== undefined) result.attributes = attributes;
      const anchors = headingAnchorSource(document, node);
      if (anchors !== undefined) result.anchors = anchors;
    }
    if (calloutHeader && document.dialect !== "commonmark" && node.type === "paragraph") {
      const [start, end] = range(node);
      const header = document.source.slice(start, end).split(lineBreak, 1)[0]!;
      if (startsWithMarker(header, node)) {
        // CommonMark merges an Obsidian callout's title, or the line of a
        // GitHub alert's marker, and the body into one paragraph. Preserve
        // their boundary too, also for a marker written as `\[!NOTE]`.
        const title = header.replace(
          /^\[!([\w-]+)\]/,
          (_, marker: string) => `[!${marker.toLowerCase()}]`,
        );
        result.calloutTitle = normalize(
          parse(title, document.dialect, document.path, [], document.vitepress).tree,
        );
      }
    }
    for (const key of Object.keys(node).sort()) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (key === "position" || key === "data") continue;
      if (key === "children" && "children" in node) {
        result.children = node.children.map((child, index) =>
          normalize(child, index === 0 && (node.type === "blockquote" || calloutHeader)),
        );
      } else if (key === "url" && typeof value === "string") result[key] = canonicalUrl(value);
      else if (key === "value" && node === frontMatter?.node) result[key] = frontMatter.value;
      else if (key === "value" && node.type === "code" && codeValues?.has(node))
        result[key] = codeValues.get(node);
      else if (key === "value" && node.type === "text") {
        let text = node.value.replace(/[ \t\r\n]+/g, " ");
        if (calloutHeader && document.dialect !== "commonmark")
          text = text.replace(
            /^\[!([\w-]+)\]/,
            (_, marker: string) => `[!${marker.toLowerCase()}]`,
          );
        result[key] = text;
      } else if (key === "value" && node.type === "inlineCode")
        // A code span is compared by the text that GitHub shows, which its
        // value in the tree does not hold where it spans lines.
        result[key] = codeSpanText(node);
      // An image's description renders as plain text, and a reference's label
      // matches its definition with whitespace collapsed.
      else if ((key === "alt" || key === "label") && typeof value === "string")
        result[key] = value.replace(/[ \t\r\n]+/g, " ");
      else result[key] = value;
    }
    origins?.set(result, node);
    return result;
  }
  const result = normalize(document.tree) as Record<string, unknown>;
  if (document.dialect === "vitepress")
    result.vitepress = vitepressSemantics(document, workspace, codeValues, frontMatter?.source);
  // Where front matter would end inside a code block, an HTML block, or
  // display math, the document is read without it, and renderers read TOML
  // front matter as a paragraph. An edit has to keep the meaning of both
  // readings.
  const reading = otherReading(document.tree);
  if (reading) result.otherReading = normalize(reading);
  return result;
}
/** A part of a semantic tree that has children. */
type Branch = Record<string, unknown> & { children: unknown[] };
const isBranch = (value: unknown): value is Branch =>
  typeof value === "object" && value !== null && Array.isArray((value as Branch).children);
/**
 * Where the meaning of `after` first differs from that of `before`, as an
 * offset into `before`'s source: the start of the first node, in document
 * order, whose meaning is not the same, or the end of the node that `after`
 * gives more content.
 */
export function divergence(before: Document, after: Document, workspace?: Workspace): number {
  const origins = new Map<unknown, Nodes>();
  let a = semanticTree(before, workspace, origins);
  let b = semanticTree(after, workspace);
  // Where only the other reading differs, the place is in that reading, and
  // otherwise in the document's own.
  const reading = (value: unknown) => (value as { otherReading?: unknown }).otherReading;
  if (
    isBranch(a) &&
    isBranch(b) &&
    isBranch(reading(a)) &&
    isBranch(reading(b)) &&
    JSON.stringify(a.children) === JSON.stringify(b.children)
  ) {
    a = reading(a);
    b = reading(b);
  }
  let offset = 0;
  for (;;) {
    const node = origins.get(a);
    // A node made up for the comparison, or one without a position, is placed at its parent.
    offset = node?.position?.start.offset ?? offset;
    if (!isBranch(a) || !isBranch(b)) return offset;
    const own = (value: Branch) =>
      JSON.stringify({ ...value, children: undefined, otherReading: undefined });
    if (own(a) !== own(b)) return offset;
    const { children } = b;
    const index = a.children.findIndex(
      (child, at) => JSON.stringify(child) !== JSON.stringify(children[at]),
    );
    if (index < 0) return node?.position?.end.offset ?? offset;
    a = a.children[index];
    b = children[index];
  }
}
