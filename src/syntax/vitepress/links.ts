import type { Nodes, Root } from "mdast";
import type { Document } from "../../core/types.js";
import { walk } from "../walk.js";
import { readVitePress } from "./reader.js";
import { vitepressPage } from "./paths.js";

interface Bypassed {
  check: WeakSet<Nodes>;
  rewrite: WeakSet<Nodes>;
}
const bypassed = new WeakMap<Root, Bypassed>();
function collect(document: Document): Bypassed {
  const result: Bypassed = { check: new WeakSet(), rewrite: new WeakSet() };
  const definitions = new Map<string, Extract<Nodes, { type: "definition" }>>();
  const references = new Map<string, { total: number; bypassed: number }>();
  walk(document.tree, "definition", (node) => definitions.set(node.identifier, node));
  walk(document.tree, (node) => {
    if (node.type !== "link" && node.type !== "linkReference") return;
    const url = node.type === "link" ? node.url : definitions.get(node.identifier)?.url;
    let ignored = false;
    if (url && !url.startsWith("#")) {
      const end = node.position?.end.offset;
      const raw =
        end === undefined ? undefined : /^\{[^}\r\n]*\}/.exec(document.source.slice(end))?.[0];
      if (raw) {
        // Let the same attrs parser decide whether these bytes belong to the
        // link and set target/download; words inside quoted values are data.
        const tokens = readVitePress(`[x](/mdtools-placeholder)${raw}`, document.vitepress);
        ignored = tokens.some((token) =>
          token.children?.some(
            (child) =>
              child.type === "link_open" &&
              (child.attrGet("target") !== null || child.attrGet("download") !== null),
          ),
        );
      }
    }
    if (ignored) {
      result.check.add(node);
      result.rewrite.add(node);
    }
    if (node.type === "linkReference") {
      const counts = references.get(node.identifier) ?? { total: 0, bypassed: 0 };
      counts.total++;
      if (ignored) counts.bypassed++;
      references.set(node.identifier, counts);
    }
  });
  for (const [name, counts] of references) {
    const definition = definitions.get(name);
    if (!definition || !counts.bypassed) continue;
    result.rewrite.add(definition);
    if (counts.total === counts.bypassed) result.check.add(definition);
  }
  return result;
}
/** VitePress bypasses page normalization/dead-link checks for target/download links. */
export function skipVitePressLink(document: Document, node: Nodes, rewriting = false): boolean {
  if (document.dialect !== "vitepress") return false;
  if (rewriting && (("url" in node && !vitepressPage(node.url)) || node.type === "image"))
    return true;
  if (document.vitepress?.attrs === false) return false;
  let found = bypassed.get(document.tree);
  if (!found) {
    found = collect(document);
    bypassed.set(document.tree, found);
  }
  return (rewriting ? found.rewrite : found.check).has(node);
}
