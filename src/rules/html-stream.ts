import { decodeHTMLAttribute } from "entities/decode";
import type { Dialect } from "../core/types.js";

/**
 * An attribute's name in an HTML start tag that Markdown reads as HTML:
 * CommonMark's grammar, or in VitePress the grammar of its Vue component
 * plugin (`@mdit-vue/plugin-component`), which also accepts Vue's `@event`
 * names. VitePress shows a tag with other names, such as `#slot` or
 * `v-bind:[key]`, as text.
 */
const attributeName = {
  commonmark: String.raw`[A-Za-z_:][\w.:-]*`,
  vitepress: String.raw`[A-Za-z_:@][\w.:-]*`,
};
const attributeValue = String.raw`[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)'|([^ \t\r\n"'=<>\x60]+))`;

/** A start tag by one of the grammars, whose attributes are captured whole. */
function startTag(name: string): RegExp {
  const value = attributeValue.replace(/\((?!\?)/g, "(?:");
  return new RegExp(
    String.raw`<([A-Za-z][A-Za-z0-9-]*)((?:[ \t\r\n]+${name}(?:${value})?)*)[ \t\r\n]*(\/?)>`,
    "y",
  );
}
const startTags = {
  commonmark: startTag(attributeName.commonmark),
  vitepress: startTag(attributeName.vitepress),
};
/** A close tag, as Markdown reads one. */
const closeTag = /<\/[A-Za-z][A-Za-z0-9-]*[ \t\r\n]*>/y;
/** Each attribute of a start tag's attributes, with its name and value. */
const attributes = {
  commonmark: new RegExp(
    String.raw`[ \t\r\n]+(${attributeName.commonmark})(?:${attributeValue})?`,
    "g",
  ),
  vitepress: new RegExp(
    String.raw`[ \t\r\n]+(${attributeName.vitepress})(?:${attributeValue})?`,
    "g",
  ),
};

/** The attributes of a start tag, by lowercase name; the first of a repeated name counts. */
function attributeMap(written: string, grammar: Grammar): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of written.matchAll(attributes[grammar])) {
    const name = match[1]!.toLowerCase();
    if (!map.has(name)) map.set(name, decodeHTMLAttribute(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return map;
}

/**
 * Elements whose content a browser reads as text up to their end tag. VitePress
 * passes its HTML to Vue, which reads the same content as elements of some of
 * them, but its server-rendered page is read by a browser again.
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
/** GitHub's tag filter escapes these starts, which leaves their content as HTML. */
const filtered = /[\t\n\f\r >]|\/>|$/y;

type Grammar = keyof typeof attributeName;
/** A start tag that Markdown reads as HTML, outside comments and raw text. */
interface StartTag {
  name: string;
  /** The attributes by lowercase name, with character references decoded. */
  attributes: Map<string, string>;
  /** Where the tag starts and ends in the HTML fed to the reader. */
  start: number;
  end: number;
}

/**
 * The end of a tag that a browser reads from `<` at `at`: its name, then
 * attributes, whose quoted values can hold `>`, up to `>`, or the HTML's end.
 */
function tagEnd(html: string, at: number): number {
  let value = false;
  for (let i = at + 1; i < html.length; i++) {
    const character = html[i]!;
    if (character === ">") return i + 1;
    if (value && (character === '"' || character === "'")) {
      const close = html.indexOf(character, i + 1);
      if (close < 0) return html.length;
      i = close;
      value = false;
    } else if (character === "=") value = true;
    else if (!"\t\n\f\r ".includes(character)) value = false;
  }
  return html.length;
}

/**
 * A reader of the HTML that a renderer emits for a document, as a browser
 * reads the whole page: raw HTML is fed to it in the order the page shows it,
 * and the renderer's own output between, which escapes its `<`, changes
 * nothing. A comment runs to its `-->` and a raw-text element such as
 * `<textarea>` to its end tag, across the Markdown between them, so an end tag
 * inside a comment there still ends the element. GitHub's tag filter shows the
 * starts of raw-text elements as text, and Vue, which VitePress renders with,
 * closes one written as `<textarea/>`. Script content's escapes are followed as
 * browsers follow them, except in VitePress, where Vue reads to the first end
 * tag.
 */
function htmlReader(dialect: Dialect) {
  /** The raw-text element being read, or `!--` inside a comment. */
  let inside: string | undefined;
  /** Inside a script: 1 after `<!--`, 2 after `<!--<script>`, as browsers read it. */
  let escaped = 0;
  const vue = dialect === "vitepress";
  /** Reads `html` on from `at` inside a raw-text element; returns where its end tag ends, or -1. */
  const rawEnd = (html: string, at: number): number => {
    const name = inside!;
    if (name === "plaintext") return -1;
    const pattern = new RegExp(
      name === "script" && !vue
        ? String.raw`<\/script(?=[\t\n\f\r />]|$)|<script(?=[\t\n\f\r />]|$)|<!--|-->`
        : String.raw`<\/${name}(?=[\t\n\f\r />]|$)`,
      "gi",
    );
    pattern.lastIndex = at;
    for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
      const found = match[0].toLowerCase();
      if (found === "<!--") {
        if (escaped === 0) {
          escaped = 1;
          // `<!-->` ends the escape it starts.
          pattern.lastIndex = match.index + 2;
        }
      } else if (found.startsWith("--")) escaped = 0;
      else if (found === "<script") {
        if (escaped === 1) escaped = 2;
      } else if (escaped === 2) escaped = 1;
      else {
        escaped = 0;
        return tagEnd(html, match.index);
      }
    }
    return -1;
  };
  /**
   * The start tags in the next piece of raw HTML, read by `grammar`; the
   * offsets are the piece's own.
   */
  return (html: string, grammar: Grammar): StartTag[] => {
    const tags: StartTag[] = [];
    let at = 0;
    while (at < html.length) {
      if (inside === "!--") {
        const close = /--!?>/g;
        close.lastIndex = at;
        const found = close.exec(html);
        if (!found) break;
        inside = undefined;
        at = found.index + found[0].length;
        continue;
      }
      if (inside !== undefined) {
        const end = rawEnd(html, at);
        if (end < 0) break;
        inside = undefined;
        at = end;
        continue;
      }
      const lt = html.indexOf("<", at);
      if (lt < 0) break;
      const next = html[lt + 1] ?? "";
      if (html.startsWith("<!--", lt)) {
        inside = "!--";
        // `<!-->` and `<!--->` end the comment they start.
        at = lt + 2;
      } else if (
        next === "!" ||
        next === "?" ||
        (next === "/" && !/[A-Za-z]/.test(html[lt + 2] ?? ""))
      ) {
        // A declaration, or what a browser reads as a comment, up to `>`.
        const close = html.indexOf(">", lt + 2);
        at = close < 0 ? html.length : close + 1;
      } else if (next === "/") at = tagEnd(html, lt);
      else if (!/[A-Za-z]/.test(next)) at = lt + 1;
      else {
        const end = tagEnd(html, lt);
        at = end;
        const name = /^<([^\t\n\f\r />]+)/.exec(html.slice(lt, end))![1]!.toLowerCase();
        const pattern = startTags[grammar];
        pattern.lastIndex = lt;
        const tag = pattern.exec(html);
        const exact = tag !== null && lt + tag[0].length === end;
        if (rawText.has(name)) {
          filtered.lastIndex = lt + 1 + name.length;
          if (dialect === "github" && filtered.test(html)) continue;
          if (!(vue && exact && tag[3])) inside = name;
          continue;
        }
        // A tag that Markdown does not read as HTML is not checked.
        if (exact) tags.push({ name, attributes: attributeMap(tag[2]!, grammar), start: lt, end });
      }
    }
    return tags;
  };
}

/**
 * The start tags in text that VitePress reads as inline HTML while CommonMark,
 * whose reading positions the document, reads it as text: a tag with a Vue
 * attribute such as `@click`. Only a tag that the text node holds as written is
 * found; one that a backslash escapes, or that spans a block quote's markers,
 * is left out.
 */
function vueTags(source: string, start: number, end: number, value: string): [number, number][] {
  const found: [number, number][] = [];
  const pattern = startTags.vitepress;
  for (let at = source.indexOf("<", start); at >= 0 && at < end; at = source.indexOf("<", at + 1)) {
    let slashes = 0;
    while (at - slashes > start && source[at - slashes - 1] === "\\") slashes++;
    if (slashes % 2) continue;
    pattern.lastIndex = closeTag.lastIndex = at;
    const tag = pattern.exec(source) ?? closeTag.exec(source);
    if (!tag || at + tag[0].length > end || !value.includes(tag[0])) continue;
    found.push([at, at + tag[0].length]);
  }
  return found;
}

export { htmlReader, vueTags };
export type { Grammar, StartTag };
