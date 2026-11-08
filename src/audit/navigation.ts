import type { Definition, FootnoteDefinition, Nodes } from "mdast";
import type { Document } from "../core/types.js";
import { walk } from "../syntax/walk.js";
import { skipVitePressLink } from "../syntax/vitepress/links.js";
import { vitepressTokens } from "../syntax/vitepress/projection.js";
import { htmlNavigationLimit } from "./html.js";

export interface NavigationLink {
  destination: string;
  wiki: boolean;
  line: number;
  column: number;
}
export interface NavigationLimit {
  message: string;
  line?: number;
  column?: number;
}

/** Collect source navigation, not unused definitions, images, code, or unused footnotes. */
export function navigation(document: Document): {
  links: NavigationLink[];
  limits: NavigationLimit[];
} {
  const definitions = new Map<string, Definition>();
  const footnotes = new Map<string, FootnoteDefinition>();
  walk(document.tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if (node.type === "footnoteDefinition" && !footnotes.has(node.identifier))
      footnotes.set(node.identifier, node);
  });
  const links: NavigationLink[] = [];
  const limits: NavigationLimit[] = [];
  const position = (node: Nodes) => ({
    line: node.position?.start.line ?? 1,
    column: node.position?.start.column ?? 1,
  });
  const usedFootnotes = new Set<string>();
  const stack: Nodes[] = [document.tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === "definition" || node.type === "footnoteDefinition") continue;
    if (node.type === "footnoteReference" && !usedFootnotes.has(node.identifier)) {
      usedFootnotes.add(node.identifier);
      const definition = footnotes.get(node.identifier);
      if (definition) for (const child of definition.children) stack.push(child);
    }
    const destination =
      node.type === "link"
        ? node.url
        : node.type === "linkReference"
          ? definitions.get(node.identifier)?.url
          : node.type === "wikiLink"
            ? node.target
            : undefined;
    if (destination !== undefined) {
      if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination) && skipVitePressLink(document, node))
        limits.push({
          ...position(node),
          message: "VitePress target/download links bypass modeled page-path resolution.",
        });
      else if (destination.includes("{{"))
        limits.push({ ...position(node), message: "Dynamic link destinations are not modeled." });
      else links.push({ destination, wiki: node.type === "wikiLink", ...position(node) });
    }
    if (node.type === "obsidianHighlight" && node.value.includes("["))
      limits.push({
        ...position(node),
        message: "Navigation inside highlights is not fully modeled.",
      });
    if (node.type === "html" && document.dialect !== "vitepress") {
      const message = htmlNavigationLimit(node.value, document.dialect);
      if (message) limits.push({ ...position(node), message });
    }
    if ("children" in node)
      for (let index = node.children.length - 1; index >= 0; index--)
        stack.push(node.children[index]!);
  }
  if (document.dialect === "vitepress") {
    // Vue accepts HTML that mdast reads as plain text, including @event attributes.
    // Reuse the cached native token reading; do not infer absence from a display collector.
    const pending = vitepressTokens(document).map((token) => ({ token, line: token.map?.[0] }));
    while (pending.length) {
      const { token, line } = pending.pop()!;
      if (token.type === "html_block" || token.type === "html_inline") {
        const message = htmlNavigationLimit(token.content, document.dialect);
        if (message) limits.push({ message, ...(line === undefined ? {} : { line: line + 1 }) });
      }
      for (const child of token.children ?? [])
        pending.push({ token: child, line: child.map?.[0] ?? line });
    }
  }
  return { links, limits };
}
