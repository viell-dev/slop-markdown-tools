import type { Nodes, Root } from "mdast";
import type { Document } from "../core/types.js";
import { walk } from "../syntax/walk.js";
import { htmlTokens, htmlView } from "./html.js";

type Tokens = ReturnType<typeof htmlTokens>;
const heading = /^h[1-6]$/;
const tableStructure = new Set("table tbody tfoot thead tr td th caption colgroup".split(" "));
const blocks = new Set(
  "address article aside blockquote body caption center colgroup dd details dialog dir dl dt fieldset figcaption figure footer form frameset h1 h2 h3 h4 h5 h6 header hgroup html legend li main menu nav ol optgroup option p pre search section select summary table tbody td template tfoot th thead tr ul".split(
    " ",
  ),
);
const cached = new WeakMap<Root, { start: number | undefined }>();
const prefixes = new WeakMap<Nodes, number>();

/**
 * A heading's structural HTML can keep its generated closing tag from ending
 * it, or close it early. GitHub's resulting anchor is not the inline text of
 * the primary heading. Balanced divs, inline/void tags and custom elements
 * are safe controls; other structural block tags are conservatively uncertain
 * (#498, #535). This classifies boundaries rather than emulating HTML parsing.
 */
function structural(tokens: Tokens, closeAtEnd = false): boolean {
  let divs = 0;
  for (const token of tokens) {
    if (token.name === undefined) continue;
    if (token.name === "div") {
      if (token.selfClosing) continue;
      if (token.close) {
        if (!divs) return true;
        divs--;
      } else divs++;
    } else if (blocks.has(token.name)) return true;
  }
  return divs > 0 && !closeAtEnd;
}

/** Known headings before the first uncertain one in a raw block or paragraph. */
function rawHeading(tokens: Tokens, closeAtEnd = false): { uncertain: boolean; known: number } {
  let from: number | undefined;
  let known = 0;
  for (const [index, token] of tokens.entries()) {
    if (token.name === undefined || !heading.test(token.name)) continue;
    if (!token.close) {
      if (token.selfClosing || (from !== undefined && structural(tokens.slice(from, index))))
        return { uncertain: true, known };
      // As in htmlHeadings(), another heading start closes the previous one.
      if (from !== undefined) known++;
      from = index + 1;
    } else if (from !== undefined) {
      if (structural(tokens.slice(from, index))) return { uncertain: true, known };
      known++;
      from = undefined;
    }
  }
  return {
    uncertain: from !== undefined && (!closeAtEnd || structural(tokens.slice(from), closeAtEnd)),
    known,
  };
}

/** Known raw headings in the block whose source starts the uncertain suffix. */
export function githubHeadingPrefix(node: Nodes): number {
  return prefixes.get(node) ?? 0;
}

/**
 * Earliest source whose GitHub heading anchors are uncertain. Neither a later
 * Markdown heading, a container end, nor a raw closing tag reliably bounds the
 * affected anchor, so formatting retains the suffix through EOF. This scan is
 * shared with fragment lookup and cached per source tree.
 */
export function githubHeadingLimit(document: Document): number | undefined {
  const known = cached.get(document.tree);
  if (known) return known.start;
  let start: number | undefined;
  walk(document.tree, (node, _index, parent) => {
    if (start !== undefined) return;
    let uncertain = node.type === "heading" && structural(htmlTokens(htmlView(node)));
    // Cell boundaries close ordinary headings, including an open div. Raw
    // table closers can instead move a later heading before the whole table,
    // changing duplicate numbering. Retain that table rather than guessing.
    if (node.type === "table")
      uncertain = node.children.some((row) =>
        row.children.some((cell) => {
          const tokens = htmlTokens(htmlView(cell));
          return (
            tokens.some((token) => token.name && token.close && tableStructure.has(token.name)) ||
            rawHeading(tokens, true).uncertain
          );
        }),
      );
    if (
      node.type === "paragraph" ||
      (node.type === "html" &&
        (parent?.type === "root" ||
          parent?.type === "blockquote" ||
          parent?.type === "listItem" ||
          parent?.type === "footnoteDefinition"))
    ) {
      const result = rawHeading(htmlTokens(htmlView(node)));
      uncertain = result.uncertain;
      if (uncertain) prefixes.set(node, result.known);
    }
    if (uncertain) start = node.position?.start.offset ?? 0;
  });
  cached.set(document.tree, { start });
  return start;
}
