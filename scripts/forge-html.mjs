import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { htmlTokens } from "../dist/workspace/html.js";
import { normalizeHtml } from "./rendering.mjs";

/** Extract the actual repository-file markup, excluding the surrounding forge UI. */
export function fileMarkup(page) {
  const tokens = htmlTokens(page);
  const start = tokens.findIndex((token) => {
    if (token.name !== "div" || token.close) return false;
    const classes = /\bclass="([^"]*)"/.exec(token.attributes)?.[1].split(/\s+/) ?? [];
    return classes.includes("file-view") && classes.includes("markup");
  });
  assert(start >= 0, "Repository file view has no rendered markup container");
  let depth = 1;
  const body = [];
  for (const token of tokens.slice(start + 1)) {
    if (token.name === "div") depth += token.close ? -1 : 1;
    if (!depth)
      return body
        .map(
          (part) =>
            part.text ??
            `<${part.close ? "/" : ""}${part.name}${part.attributes}${part.selfClosing ? "/" : ""}>`,
        )
        .join("");
    body.push(token);
  }
  throw new Error("Repository file markup container was not closed");
}

/** Keep all attributes, target IDs, links, code and formula source intact. */
export function forgeHtml(html, source) {
  // The hosts point generated task checkboxes at UTF-8 source offsets. Formatting
  // moves those offsets; strip only values still bound to an actual task marker.
  if (source !== undefined) {
    const bytes = Buffer.from(source);
    html = html.replace(/<input\b[^>]*>/g, (tag) => {
      if (!/\btype="checkbox"/.test(tag) || !/\bdisabled=""/.test(tag)) return tag;
      return tag.replace(/ data-source-position="(\d+)"/g, (attribute, raw) => {
        const at = Number(raw);
        return /^\[[xX ]\]$/.test(bytes.subarray(at, at + 3).toString()) &&
          /(?:[-+*]|\d{1,9}[.)])[ \t]+$/.test(bytes.subarray(Math.max(0, at - 16), at).toString())
          ? ""
          : attribute;
      });
    });
  }
  return normalizeHtml(html);
}
