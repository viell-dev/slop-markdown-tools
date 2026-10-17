import type { Nodes, Text } from "mdast";
import { range } from "./parse.js";

/**
 * An Obsidian block identifier as the source writes it, as the Obsidian help
 * defines one: a `^` followed by Latin letters, digits, and hyphens, after a
 * space at the end of a block, or alone on the block's last line, such as
 * after a list or a quote.
 */
export const blockIdentifierSource = /(?:^|[ \t\r\n])\^([A-Za-z0-9-]+)[ \t]*$/;

/**
 * The block identifier that ends a paragraph or heading, without its `^`, and
 * the text node that holds it; undefined when the block ends otherwise. An
 * identifier must end the block, so `^id` before other inline content, such
 * as emphasis or a link, is text, and so is an escaped `\^id`.
 */
export function blockIdentifier(
  source: string,
  node: Nodes,
): { id: string; node: Text } | undefined {
  if (node.type !== "paragraph" && node.type !== "heading") return undefined;
  const last = node.children.at(-1);
  if (last?.type !== "text") return undefined;
  const match = blockIdentifierSource.exec(source.slice(...range(last)));
  return match ? { id: match[1]!, node: last } : undefined;
}
