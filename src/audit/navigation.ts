import type { Definition, FootnoteDefinition, Nodes } from "mdast";
import type { Document } from "../core/types.js";
import { htmlStartTags } from "../rules/html-elements.js";
import { walk } from "../syntax/walk.js";
import { lineStarts } from "../syntax/source.js";
import { diagnostic } from "../core/diagnostics.js";
import { skipVitePressLink } from "../syntax/vitepress/links.js";

export interface NavigationLink {
  destination: string;
  wiki: boolean;
  line: number;
  column: number;
}
export interface NavigationLimit {
  message: string;
  line: number;
  column: number;
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
    if (
      (node.type === "html" && /<!--\s*@include\s*:/.test(node.value)) ||
      (node.type === "obsidianHighlight" && node.value.includes("[")) ||
      (node.type === "html" && node.value.includes("[") && !/^\s*<!--/.test(node.value))
    )
      limits.push({
        ...position(node),
        message: "Navigation inside transclusions, highlights, or raw HTML is not fully modeled.",
      });
    if ("children" in node)
      for (let index = node.children.length - 1; index >= 0; index--)
        stack.push(node.children[index]!);
  }
  let starts: number[] | undefined;
  for (const tag of htmlStartTags(document)) {
    const href = tag.attributes.get("href") ?? tag.attributes.get("xlink:href");
    const dynamic =
      document.dialect === "vitepress" &&
      (/[A-Z-]/.test(tag.name) ||
        [...tag.attributes.keys()].some((name) => /^(?:[:@#]|v-)/.test(name)));
    if (dynamic || (href && !href.startsWith("#") && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href))) {
      const location = diagnostic(
        (starts ??= lineStarts(document.source)),
        "audit/reachability",
        "error",
        {
          start: tag.start,
          message: "Local HTML links and dynamic components are not modeled as navigation.",
        },
      );
      limits.push({
        line: location.line,
        column: location.column,
        message: location.message,
      });
    }
  }
  return { links, limits };
}
