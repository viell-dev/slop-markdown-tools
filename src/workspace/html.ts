import type { Nodes } from "mdast";
import { textContent } from "../syntax/parse.js";
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { decodeHTMLAttribute } from "entities/decode";

/** An HTML open tag with its attributes, by CommonMark's grammar for raw HTML. */
const openTag =
  /<([A-Za-z][A-Za-z0-9-]*)((?:[ \t\r\n]+[A-Za-z_:][\w.:-]*(?:[ \t\r\n]*=[ \t\r\n]*(?:"[^"]*"|'[^']*'|[^ \t\r\n"'=<>`]+))?)*)[ \t\r\n]*\/?>/y;

const closeTag = /<\/([A-Za-z][A-Za-z0-9-]*)[ \t\r\n]*>/y;

const attribute =
  /([A-Za-z_:][\w.:-]*)(?:[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)'|([^ \t\r\n"'=<>`]+)))?/g;

/**
 * Elements whose content HTML reads as text and that no renderer shows as an
 * element: GitHub's tagfilter shows these tags as text, Forgejo removes them,
 * and Gitea shows them as text or removes them. `<plaintext>` has no end.
 */
const rawText = new Set([
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

/** A tag that becomes an element, or the text between tags. */
type HtmlToken =
  | { name: string; attributes: string; close: boolean; selfClosing?: true }
  | { name?: undefined; text: string };

/**
 * HTML as a browser tokenizes it, in one forward pass: comments, which run to
 * the end when unterminated, declarations, and raw-text elements with their
 * content are left out, and a tag is read whole, so a `<!--` or `<h2>` inside
 * a quoted attribute value is part of the value.
 */
function htmlTokens(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const lower = html.toLowerCase();
  let copied = 0;
  const text = (end: number) => {
    if (end > copied) tokens.push({ text: html.slice(copied, end) });
  };
  for (let at = html.indexOf("<"); at >= 0; at = html.indexOf("<", at)) {
    let end: number;
    if (html.startsWith("<!--", at)) {
      const close = html.indexOf("-->", at + 4);
      end = close < 0 ? html.length : close + 3;
      text(at);
    } else if (html[at + 1] === "!" || html[at + 1] === "?") {
      const close = html.indexOf(">", at);
      end = close < 0 ? html.length : close + 1;
      text(at);
    } else {
      openTag.lastIndex = closeTag.lastIndex = at;
      const open = openTag.exec(html);
      const tag = open ?? closeTag.exec(html);
      if (!tag) {
        // A `<` that starts no tag is text.
        at++;
        continue;
      }
      const name = tag[1]!.toLowerCase();
      end = at + tag[0].length;
      text(at);
      if (!open) tokens.push({ name, attributes: "", close: true });
      else if (!rawText.has(name))
        tokens.push({
          name,
          attributes: tag[2]!,
          close: false,
          ...(tag[0].endsWith("/>") ? { selfClosing: true as const } : {}),
        });
      else {
        const close = name === "plaintext" ? -1 : lower.indexOf(`</${name}`, end);
        const after = close < 0 ? -1 : html.indexOf(">", close);
        end = after < 0 ? html.length : after + 1;
      }
    }
    copied = at = end;
  }
  text(html.length);
  return tokens;
}

/**
 * The anchors that HTML in a document adds: the `id` of any element and the
 * `name` of an `<a>`, with character references decoded once as HTML attribute
 * values. GitHub, Forgejo, and Gitea keep both on allowed elements and add their
 * `user-content-` prefix to them unless it is
 * already there, as they do to a link's fragment, so an `id` written with the
 * prefix is recorded without it. Every value of a repeated attribute counts:
 * Forgejo 16 and Gitea 1.26 keep the first, Gitea 1.25 the last.
 */
function htmlAnchors(tokens: HtmlToken[]): string[] {
  const anchors: string[] = [];
  for (const token of tokens) {
    if (token.name === undefined || token.close) continue;
    for (const match of token.attributes.matchAll(attribute)) {
      const attributeName = match[1]!.toLowerCase();
      if (attributeName !== "id" && !(token.name === "a" && attributeName === "name")) continue;
      const value = decodeHTMLAttribute(match[2] ?? match[3] ?? match[4] ?? "").replace(
        /^user-content-/,
        "",
      );
      if (value) anchors.push(value);
    }
  }
  return anchors;
}

/**
 * A character reference, which HTML decodes in an element's text. A numeric one
 * needs no semicolon, and one that names no character becomes U+FFFD.
 */
const characterReference = /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z][A-Za-z\d]*);)/g;

function decodeReferences(text: string): string {
  return text.replace(
    characterReference,
    (
      reference: string,
      decimal: string | undefined,
      hex: string | undefined,
      name: string | undefined,
    ) => {
      if (name) return decodeNamedCharacterReference(name) || reference;
      const code = Number.parseInt((decimal ?? hex)!, decimal ? 10 : 16);
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : "�";
    },
  );
}

const headingTag = /^h[1-6]$/;

/**
 * Headings written as HTML, as GitHub and Gitea 1.26 and later see them when
 * they generate anchors: the text content with inner tags removed and character
 * references decoded, and whether the tag sets its own `id`. As in HTML, a
 * heading's start tag also ends an open heading, and any heading's end tag
 * closes it. A heading left open at the end is not reported: the renderers
 * continue it through the Markdown that follows, which is not modeled.
 */
function htmlHeadings(tokens: HtmlToken[]): { text: string; hasId: boolean }[] {
  const headings: { text: string; hasId: boolean }[] = [];
  let open: { text: string; hasId: boolean } | undefined;
  const close = () => {
    if (open) headings.push({ text: decodeReferences(open.text), hasId: open.hasId });
    open = undefined;
  };
  for (const token of tokens) {
    if (token.name === undefined) {
      if (open) open.text += token.text;
    } else if (headingTag.test(token.name)) {
      close();
      if (!token.close)
        open = {
          text: "",
          hasId: [...token.attributes.matchAll(attribute)].some(
            (item) => item[1]!.toLowerCase() === "id",
          ),
        };
    }
  }
  return headings;
}

/**
 * A paragraph as HTML, for headings that are written inline: the HTML tags as
 * written around the text that the renderers put between them, with the text's
 * own `<` and `&` escaped so that only real tags are read.
 */
function htmlView(node: Nodes): string {
  if (node.type === "html") return node.value;
  if (node.type === "break") return "\n";
  if ("children" in node) return node.children.map(htmlView).join("");
  return textContent(node).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}
export { htmlTokens, htmlAnchors, htmlHeadings, htmlView };
