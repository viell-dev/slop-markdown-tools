/** A complete comment and its UTF-16 range within an HTML node's value. */
export interface HtmlComment {
  value: string;
  start: number;
  end: number;
}

/**
 * Comment boundaries for source directives, not a renderer's filtered HTML.
 * Tags consume quoted attributes whole. Raw-text and code elements are opaque
 * within this node. Do not carry element state into later Markdown nodes:
 * containers, code spans and Vue components can close or reinterpret elements.
 */
export function htmlComments(html: string): HtmlComment[] {
  const tagStart = /<\/?([a-z][^\t\n\f\r />]*)(?=[\t\n\f\r />])/iy;
  const opaque = new Set([
    "code",
    "iframe",
    "noembed",
    "noframes",
    "plaintext",
    "pre",
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
  ]);
  let inside: string | undefined;
  const comments: HtmlComment[] = [];
  let at = 0;
  while (at < html.length) {
    if (inside) {
      if (inside === "plaintext") break;
      const close = new RegExp(`</${inside}(?=[\\t\\n\\f\\r />]|$)`, "gi");
      close.lastIndex = at;
      const match = close.exec(html);
      if (!match) break;
      at = match.index;
      inside = undefined;
    }
    const start = html.indexOf("<", at);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const close = html.indexOf("-->", start + 4);
      if (close < 0) break;
      at = close + 3;
      comments.push({ value: html.slice(start, at), start, end: at });
      continue;
    }
    if (html.startsWith("<![CDATA[", start)) {
      const close = html.indexOf("]]>", start + 9);
      if (close < 0) break;
      at = close + 3;
      continue;
    }
    // A whole tag/declaration is opaque to comment recognition. Incomplete
    // tags consume the rest of this node rather than exposing attribute text.
    tagStart.lastIndex = start;
    const tag = tagStart.exec(html);
    if (!tag && html[start + 1] !== "!" && html[start + 1] !== "?") {
      at = start + 1;
      continue;
    }
    let quote: string | undefined;
    at = start + 1;
    for (; at < html.length; at++) {
      const character = html[at]!;
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (at === html.length) break;
    at++;
    const name = tag?.[1]!.toLowerCase();
    if (name && html[start + 1] !== "/" && opaque.has(name)) inside = name;
  }
  return comments;
}
