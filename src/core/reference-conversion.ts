import type { Definition, Image, Link, Nodes, Root } from "mdast";
import type { Diagnostic, Document, Edit, Plugin, Workspace } from "./types.js";
import { labelEnd, otherReading, parse, range, startsWithMarker } from "../syntax/parse.js";
import { lineBreak } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { normalizeLabel } from "../rules/links.js";
import { emptyTitle } from "../rules/link-format.js";
import { changesForgeHeading } from "../workspace/heading-attributes.js";
import { semanticFingerprint, semanticFingerprintWithReferences } from "./semantics.js";

interface Conversion {
  node: Link | Image;
  edit: Edit;
  identifier: string;
  at: number;
}
interface Addition {
  identifier: string;
  text: string;
  at: number;
}
const definitionLabel = /^\[((?:\\[\s\S]|[^\]\\])+)\]:/;
const referenceFields = new Set(["identifier", "label", "referenceType"]);
// markdown-it rejects these resources instead of hiding their definitions. Keep
// their authored notation, including data images, rather than assuming host policy.
const supportedDestination = (url: string) =>
  !/^(?:vbscript|javascript|file|data):/i.test(url.trim());
/** commonmark.js disagrees with other hosts about tabs in resource syntax. */
function supportedResource(document: Document, node: Link | Image | Definition): boolean {
  if (!supportedDestination(node.url)) return false;
  const start = node.type === "definition" ? range(node)[0] : labelEnd(node);
  return start !== undefined && !document.source.slice(start, range(node)[1]).includes("\t");
}
const readings = (document: Document): Root[] => {
  const other = otherReading(document.tree);
  return other ? [document.tree, other] : [document.tree];
};
/** Keep an explicit empty title distinct from an absent title, which mdast does not. */
function title(document: Document, node: Link | Image | Definition): string | null {
  const [start, end] = range(node);
  return (
    node.title ??
    (emptyTitle(document.source.slice(start, end), node.type === "definition") ? "" : null)
  );
}
function definitions(tree: Root) {
  const result = new Map<string, Definition[]>();
  walk(tree, "definition", (node) => {
    const group = result.get(node.identifier) ?? [];
    group.push(node);
    result.set(node.identifier, group);
  });
  return result;
}

/** Marker lines are parsed separately by the callout/alert title guard. */
function calloutTitles(document: Document): [number, number][] {
  const titles: [number, number][] = [];
  if (document.dialect === "commonmark") return titles;
  walk(document.tree, "blockquote", (quote) => {
    let first: Nodes | undefined = quote.children[0];
    while (first && first.type !== "paragraph" && "children" in first) first = first.children[0];
    if (first?.type !== "paragraph") return;
    const [start, end] = range(first);
    const header = document.source.slice(start, end).split(lineBreak, 1)[0]!;
    if (startsWithMarker(header, first)) titles.push([start, start + header.length]);
  });
  return titles;
}

/**
 * Verify against actual first-match definitions, then compare the complete document.
 * Only the planned references and appended root definitions receive a projection.
 * Ordinary fingerprints, untouched references and VitePress's secondary reading stay exact.
 */
export function verifyReferenceConversion(
  before: Document,
  after: Document,
  conversions: readonly Conversion[],
  additions: readonly Addition[],
  workspace?: Workspace,
): boolean {
  // Live Preview displays definition lines and treats reference images as embeds.
  if (
    before.dialect === "obsidian" &&
    (additions.length || conversions.some(({ node }) => node.type === "image"))
  )
    return false;
  const original = readings(before);
  const candidate = readings(after);
  if (original.length !== candidate.length) return false;
  const replacements = new WeakMap<Nodes, Nodes>();
  const omitted = new WeakSet<Nodes>();
  for (let index = 0; index < original.length; index++) {
    const tree = candidate[index]!;
    const rootNodes = new Set<Nodes>(tree.children);
    const targets = definitions(tree);
    const beforeNodes = new Map<number, Nodes>();
    const afterNodes = new Map<number, Nodes>();
    walk(original[index]!, (node) => {
      if (node.type === "link" || node.type === "image") beforeNodes.set(range(node)[0], node);
    });
    walk(tree, (node) => {
      if (node.type === "linkReference" || node.type === "imageReference")
        afterNodes.set(range(node)[0], node);
    });
    for (const addition of additions) {
      const group = targets.get(addition.identifier);
      const definition = group?.[0];
      if (
        group?.length !== 1 ||
        !definition ||
        !rootNodes.has(definition) ||
        range(definition)[0] !== addition.at ||
        after.source.slice(...range(definition)) !== addition.text
      )
        return false;
      omitted.add(definition);
    }
    for (const conversion of conversions) {
      const old = beforeNodes.get(conversion.edit.start);
      const node = afterNodes.get(conversion.at);
      const target = targets.get(conversion.identifier)?.[0];
      if (
        !old ||
        (old.type !== "link" && old.type !== "image") ||
        old.type !== conversion.node.type ||
        range(old)[1] !== conversion.edit.end ||
        !supportedResource(before, old) ||
        !node ||
        (node.type !== "linkReference" && node.type !== "imageReference") ||
        node.type !== (old.type === "link" ? "linkReference" : "imageReference") ||
        node.referenceType !== "full" ||
        node.identifier !== conversion.identifier ||
        range(node)[1] !== conversion.at + conversion.edit.text.length ||
        Object.hasOwn(node, "url") ||
        Object.hasOwn(node, "title") ||
        !target ||
        !supportedResource(after, target) ||
        target.url !== old.url ||
        title(after, target) !== title(before, old)
      )
        return false;
      // Retain extension fields in the comparison. Only the known reference
      // bookkeeping is replaced; a projection must not erase unknown meaning.
      const properties = Object.fromEntries(
        Object.entries(node as unknown as Record<string, unknown>).filter(
          ([key]) => !referenceFields.has(key),
        ),
      );
      replacements.set(
        node,
        node.type === "linkReference"
          ? {
              ...properties,
              type: "link",
              children: node.children,
              url: target.url,
              title: target.title ?? null,
              position: node.position!,
            }
          : {
              ...properties,
              type: "image",
              alt: node.alt,
              url: target.url,
              title: target.title ?? null,
              position: node.position!,
            },
      );
    }
  }
  return (
    semanticFingerprint(before, workspace) ===
    semanticFingerprintWithReferences(after, replacements, omitted, workspace)
  );
}

/**
 * An atomic source-edit plan for the host's explicitly enabled built-in rule.
 * The host filters findings and every edit through suppression, range and renderer guards.
 */
export function convertReferences(
  document: Document,
  diagnostics: readonly Diagnostic[],
  allowed: (edit: Edit) => boolean,
  plugins: readonly Plugin[] = [],
  workspace?: Workspace,
): { document: Document; edits: Edit[] } | undefined {
  const selected = new Set(diagnostics.map((item) => item.start));
  if (!selected.size) return undefined;
  const { source } = document;
  const titles = calloutTitles(document);
  const existing = definitions(document.tree);
  const used = new Set<string>();
  walk(document.tree, (node) => {
    if (node.type === "linkReference" || node.type === "imageReference") used.add(node.identifier);
  });
  const reusable = new Map<string, { label: string; identifier: string }>();
  const identity = (node: Link | Image | Definition) =>
    JSON.stringify([node.url, title(document, node)]);
  for (const [identifier, group] of existing) {
    if (group.length !== 1 || !used.has(identifier) || identifier === "//") continue;
    const definition = group[0]!;
    if (!supportedResource(document, definition)) continue;
    const label = definitionLabel.exec(source.slice(...range(definition)))?.[1];
    if (!label || /[\r\n]/.test(label)) continue;
    const key = identity(definition);
    if (!reusable.has(key)) reusable.set(key, { label, identifier });
  }
  // Reserve generated-looking text everywhere, including undefined shortcuts,
  // comments and code. Conservative over-reservation does not change meaning.
  const reserved = new Set(normalizeLabel(source).match(/mdrefine-link-[0-9]+/g) ?? []);
  for (const identifier of existing.keys()) reserved.add(identifier);
  let number = 1;
  const newline = source.match(lineBreak)?.[0] ?? "\n";
  const additions: Addition[] = [];
  const conversions: Conversion[] = [];
  let shift = 0;
  let previousEnd = -1;
  walk(document.tree, (node) => {
    if (node.type !== "link" && node.type !== "image") return;
    const [start, end] = range(node);
    const close = labelEnd(node);
    if (!selected.has(start) || start < previousEnd || close === undefined) return;
    if (!supportedResource(document, node)) return;
    if (changesForgeHeading(document, start, end)) return;
    if (titles.some(([from, to]) => start < to && end > from)) return;
    if (document.dialect === "obsidian" && node.type === "image") return;
    const raw = source.slice(start, end);
    if (!(raw.startsWith("[") || raw.startsWith("![")) || source.slice(close, close + 2) !== "](")
      return;
    // CommonMark keeps Unicode whitespace in destinations; only ASCII space is padding.
    const body = source.slice(close + 2, end - 1).replace(/^ +| +$/g, "");
    // A generated definition has one line; don't reinterpret multiline resources.
    if (/[\r\n]/.test(body)) return;
    const key = identity(node);
    const shared = reusable.get(key);
    if (document.dialect === "obsidian" && !shared) return;
    while (reserved.has(`mdrefine-link-${number}`)) number++;
    const label = shared?.label ?? `mdrefine-link-${number}`;
    const identifier = shared?.identifier ?? label;
    const edit = { start, end, text: `${source.slice(start, close + 1)}[${label}]` };
    if (!allowed(edit)) return;
    if (!shared) {
      reusable.set(key, { label, identifier });
      reserved.add(identifier);
      number++;
      additions.push({ identifier, text: `[${label}]: ${body || "<>"}`, at: 0 });
    }
    conversions.push({ node, edit, identifier, at: start + shift });
    shift += edit.text.length - (end - start);
    previousEnd = end;
  });
  if (!conversions.length) return undefined;
  const edits = conversions.map((item) => item.edit);
  if (additions.length) {
    const separator = /[\r\n]$/.test(source) ? newline : newline + newline;
    let at = source.length + shift + separator.length;
    for (const addition of additions) {
      addition.at = at;
      at += addition.text.length + newline.length;
    }
    const edit = {
      start: source.length,
      end: source.length,
      text: separator + additions.map((item) => item.text + newline).join(""),
    };
    if (!allowed(edit)) return undefined;
    edits.push(edit);
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  const parsed = parse(
    parts.join(""),
    document.dialect,
    document.path,
    plugins,
    document.vitepress,
  );
  return verifyReferenceConversion(document, parsed, conversions, additions, workspace)
    ? { document: parsed, edits }
    : undefined;
}
