import type { Root } from "mdast";
import type { Document } from "../core/types.js";
import { walk } from "../syntax/walk.js";
import { htmlTokens, htmlView } from "./html.js";

type Tokens = ReturnType<typeof htmlTokens>;
const heading = /^h[1-6]$/;
const blocks = new Set(
  "address article aside blockquote body caption center colgroup dd details dialog dir dl dt fieldset figcaption figure footer form frameset h1 h2 h3 h4 h5 h6 header hgroup html legend li main menu nav ol optgroup option p pre search section select summary table tbody td template tfoot th thead tr ul".split(
    " ",
  ),
);
const cached = new WeakMap<Root, { start: number | undefined }>();

/**
 * A heading's structural HTML can keep its generated closing tag from ending
 * it, or close it early. GitHub's resulting anchor is not the inline text of
 * the primary heading. Balanced divs, inline/void tags and custom elements
 * are safe controls; other structural block tags are conservatively uncertain
 * (#498, #535). This classifies boundaries rather than emulating HTML parsing.
 */
function structural(tokens: Tokens): boolean {
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
  return divs > 0;
}

/** Whether a raw HTML block contains a heading whose text cannot be modeled. */
function rawHeading(tokens: Tokens): boolean {
  let from: number | undefined;
  for (const [index, token] of tokens.entries()) {
    if (token.name === undefined || !heading.test(token.name)) continue;
    if (!token.close) {
      if (token.selfClosing || (from !== undefined && structural(tokens.slice(from, index))))
        return true;
      // As in htmlHeadings(), another heading start closes the previous one.
      from = index + 1;
    } else if (from !== undefined) {
      if (structural(tokens.slice(from, index))) return true;
      from = undefined;
    }
  }
  return from !== undefined;
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
    if (
      (node.type === "heading" && structural(htmlTokens(htmlView(node)))) ||
      (node.type === "paragraph" && rawHeading(htmlTokens(htmlView(node)))) ||
      (node.type === "html" &&
        parent?.type !== "paragraph" &&
        parent?.type !== "emphasis" &&
        parent?.type !== "strong" &&
        parent?.type !== "delete" &&
        parent?.type !== "link" &&
        parent?.type !== "linkReference" &&
        parent?.type !== "heading" &&
        rawHeading(htmlTokens(node.value)))
    )
      start = node.position?.start.offset ?? 0;
  });
  cached.set(document.tree, { start });
  return start;
}
