import type { Nodes, Root } from "mdast";
import { decodeHTMLAttribute } from "entities/decode";
import type { Dialect, Document } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { rendererProtections } from "../syntax/renderer-protections.js";
import { lineBreaks } from "../syntax/source.js";
import { located } from "./shared.js";

/**
 * An HTML start tag that renderers read as an element where it is written,
 * shared by the rules that check HTML elements.
 */
export interface HtmlStartTag {
  /** The element's name as written. */
  name: string;
  /** Where the whole tag starts and ends in the source. */
  start: number;
  end: number;
  /** Attribute values by lowercase name, with character references decoded; the first of a repeated name counts. */
  attributes: Map<string, string>;
  /** Whether the tag is in a cell of a Markdown table. */
  table: boolean;
  /**
   * Whether the tag is inside an element whose content renderers may not
   * show, such as `<template>`, `<video>` or one with a `hidden` attribute, or
   * in VitePress a component or an element with Vue's attributes.
   */
  hidden: boolean;
}

/** A start tag by CommonMark's grammar for raw HTML, as a whole tag. */
const startTag =
  /^<[A-Za-z][A-Za-z0-9-]*((?:[ \t\r\n]+[A-Za-z_:][\w.:-]*(?:[ \t\r\n]*=[ \t\r\n]*(?:"[^"]*"|'[^']*'|[^ \t\r\n"'=<>`]+))?)*)[ \t\r\n]*(\/?)>$/;
const attribute =
  /[ \t\r\n]+([A-Za-z_:][\w.:-]*)(?:[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)'|([^ \t\r\n"'=<>`]+)))?/g;
const letter = /[A-Za-z]/;

/**
 * Elements whose content a browser reads as text up to their end tag, with
 * `<noscript>`, which it reads so when scripts run. GitHub's tag filter shows
 * their tags as text instead, which leaves their content as HTML: reading it
 * as text there only leaves images unreported.
 */
const rawText = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);
/**
 * Elements whose content is parsed as HTML but not certainly shown: inert
 * templates, media and object fallbacks, closed dialogs, options, foreign
 * content, and what DOMPurify, which Obsidian sanitizes with, drops.
 */
const hidingElements = new Set([
  "audio",
  "canvas",
  "colgroup",
  "datalist",
  "dialog",
  "head",
  "math",
  "object",
  "select",
  "svg",
  "template",
  "video",
]);
/** Elements without content or an end tag. */
const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
/**
 * The names that Vue's template compiler, which VitePress renders with, reads
 * as native HTML elements (`isHTMLTag` of `@vue/shared`). Any other name, such
 * as `Badge` or `client-only`, can be a component, which decides itself what
 * of its content it shows.
 */
const vueHtml = new Set(
  (
    "html,body,base,head,link,meta,style,title,address,article,aside,footer,header,hgroup," +
    "h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,main,ol," +
    "p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small," +
    "span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source," +
    "canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button," +
    "datalist,fieldset,form,input,label,legend,meter,optgroup,option,output,progress,select," +
    "textarea,details,dialog,menu,summary,template,blockquote,iframe,tfoot"
  ).split(","),
);
/** Vue's attribute syntax: a binding, an event, a slot, or a directive. */
const vueAttribute = /^(?::|@|#|v-)/;
/** CSS in a `style` attribute that hides the element. */
const hidingStyle = /display\s*:\s*none|visibility\s*:\s*hidden|content-visibility/i;
/**
 * The Markdown nodes that renderers write as inline elements, such as `<em>`,
 * which an end tag of the HTML around them closes with them. The others with
 * content are written as blocks, such as `<p>`, `<li>` or `<td>`, which a
 * browser may not close for such an end tag.
 */
const inlineNodes = new Set([
  "delete",
  "emphasis",
  "link",
  "linkReference",
  "obsidianHighlight",
  "strong",
]);
/** The blocks whose inline HTML a renderer writes into one element. */
const phrasing = new Set(["paragraph", "heading", "tableCell"]);
/** The blocks whose content lines can start with a prefix that the parser leaves out. */
const containers = new Set(["blockquote", "listItem", "footnoteDefinition"]);

/** Whether a tag has Vue's attribute syntax, which VitePress compiles. */
export function vueSyntax(attributes: Map<string, string>): boolean {
  for (const name of attributes.keys()) if (vueAttribute.test(name)) return true;
  return false;
}

/**
 * Whether an element's attributes hide it, and its content: `hidden`,
 * `inert` or a hiding style from everyone, and `aria-hidden="true"` from
 * assistive technology. GitHub's sanitizer removes all of them, as its
 * Markdown API showed on 2026-10-28 and 2026-10-29.
 */
export function hiddenBy(attributes: Map<string, string>, dialect: Dialect): boolean {
  return (
    dialect !== "github" &&
    (attributes.has("hidden") ||
      attributes.has("inert") ||
      attributes.get("aria-hidden")?.trim().toLowerCase() === "true" ||
      hidingStyle.test(attributes.get("style") ?? ""))
  );
}

/** The attributes of a start tag's attribute text, by lowercase name. */
function attributeMap(written: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of written.matchAll(attribute)) {
    const name = match[1]!.toLowerCase();
    if (!map.has(name)) map.set(name, decodeHTMLAttribute(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return map;
}

/**
 * The end of a tag that a browser reads from `<` at `at`: up to `>`, where
 * quoted attribute values can hold `>`; -1 when the HTML ends first.
 */
function tagEnd(html: string, at: number): number {
  let value = false;
  for (let i = at + 1; i < html.length; i++) {
    const character = html[i]!;
    if (character === ">") return i + 1;
    if (value && (character === '"' || character === "'")) {
      const close = html.indexOf(character, i + 1);
      if (close < 0) return -1;
      i = close;
      value = false;
    } else if (character === "=") value = true;
    else if (!"\t\n\f\r ".includes(character)) value = false;
  }
  return -1;
}

/** A tag as a browser reads it from one raw HTML node's value. */
interface ScannedTag {
  /** The name as written. */
  name: string;
  close: boolean;
  from: number;
  to: number;
  /** For a start tag that CommonMark's grammar reads whole: its attributes. */
  attributes?: Map<string, string>;
  selfClosing: boolean;
}

/**
 * Reads one raw HTML node's value as a browser reads it, from the data state
 * or inside the raw-text element `inside`. Returns whether the reading is
 * certain, and the raw-text element still open at its end. A comment, a
 * declaration or a tag that the value does not end, an abrupt comment such as
 * `<!-->`, CDATA, and `<!--` in raw text, such as a script's escapes, which
 * the renderers may read apart, are uncertain.
 */
function scan(
  html: string,
  inside: string | undefined,
  emit: (tag: ScannedTag) => void,
): { certain: boolean; inside: string | undefined } {
  let lower: string | undefined;
  let at = 0;
  while (at < html.length) {
    if (inside !== undefined) {
      if (inside === "plaintext") return { certain: false, inside };
      lower ??= html.toLowerCase();
      const pattern = new RegExp(String.raw`</${inside}(?=[\t\n\f\r />]|$)`, "g");
      pattern.lastIndex = at;
      const close = pattern.exec(lower)?.index ?? -1;
      // Script escapes depend on comments, and a renderer that removes
      // comments before the browser reads the page would also remove an end
      // tag inside one. Only the element's own text is searched.
      if (lower.slice(at, close < 0 ? undefined : close).includes("<!--"))
        return { certain: false, inside };
      if (close < 0) return { certain: true, inside };
      const end = tagEnd(html, close);
      if (end < 0) return { certain: false, inside };
      inside = undefined;
      at = end;
      continue;
    }
    const lt = html.indexOf("<", at);
    if (lt < 0) break;
    const next = html[lt + 1] ?? "";
    if (html.startsWith("<!--", lt)) {
      if (html.startsWith("<!-->", lt) || html.startsWith("<!--->", lt))
        return { certain: false, inside };
      const close = html.indexOf("-->", lt + 4);
      if (close < 0) return { certain: false, inside };
      at = close + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) return { certain: false, inside };
    if (next === "!" || next === "?" || (next === "/" && !letter.test(html[lt + 2] ?? ""))) {
      // A declaration, or what a browser reads as a comment, up to `>`.
      const close = html.indexOf(">", lt + 2);
      if (close < 0) return { certain: false, inside };
      at = close + 1;
      continue;
    }
    if (!letter.test(next) && next !== "/") {
      at = lt + 1;
      continue;
    }
    const end = tagEnd(html, lt);
    if (end < 0) return { certain: false, inside };
    const written = html.slice(lt, end);
    const close = next === "/";
    const name = /^<\/?([^\t\n\f\r />]+)/.exec(written)![1]!;
    const tag = close ? null : startTag.exec(written);
    emit({
      name,
      close,
      from: lt,
      to: end,
      ...(tag ? { attributes: attributeMap(tag[1]!) } : {}),
      selfClosing: tag?.[2] === "/",
    });
    if (!close && rawText.has(name.toLowerCase())) inside = name.toLowerCase();
    at = end;
  }
  return { certain: true, inside };
}

/**
 * Maps a range of a raw HTML node's value, given in increasing order, to the
 * source. A paragraph's value leaves out the indentation of its later lines,
 * and inside a block quote, list item or footnote each line's container
 * prefix. A line maps when the source line ends with its value; a range across
 * lines maps only outside containers, where what is left out is blank space,
 * which leaves out tags split across a container's lines. Each node's lines
 * are indexed once.
 */
function sourceMapper(
  source: string,
  node: Nodes,
  contained: boolean,
): (from: number, to: number) => [number, number] | undefined {
  const [start, end] = range(node);
  const value = (node as { value: string }).value;
  const raw = source.slice(start, end);
  if (raw === value) return (from, to) => [start + from, start + to];
  const lines = (text: string) => {
    const found: [number, number][] = [];
    let at = 0;
    for (const match of lineBreaks(text)) {
      found.push([at, match.index]);
      at = match.index + match[0].length;
    }
    found.push([at, text.length]);
    return found;
  };
  const valueLines = lines(value);
  const rawLines = lines(raw);
  if (valueLines.length !== rawLines.length) return () => undefined;
  /** Each line's offset from its value to the source, or NaN where it does not map. */
  const shifts: number[] = [];
  /** Whether what the value leaves out of each line is blank space. */
  const blank: boolean[] = [];
  valueLines.forEach(([valueStart, valueEnd], index) => {
    const [rawStart, rawEnd] = rawLines[index]!;
    const prefix = rawEnd - rawStart - (valueEnd - valueStart);
    const maps =
      prefix >= 0 && raw.startsWith(value.slice(valueStart, valueEnd), rawStart + prefix);
    shifts.push(maps ? start + rawStart + prefix - valueStart : NaN);
    blank.push(maps && /^[ \t]*$/.test(raw.slice(rawStart, rawStart + prefix)));
  });
  let line = 0;
  return (from, to) => {
    while (line < valueLines.length - 1 && valueLines[line + 1]![0] <= from) line++;
    const shift = shifts[line]!;
    if (Number.isNaN(shift)) return undefined;
    if (to <= valueLines[line]![1]) return [shift + from, shift + to];
    if (contained) return undefined;
    let last = line;
    while (last + 1 < valueLines.length && valueLines[last + 1]![0] < to)
      if (!blank[++last]) return undefined;
    return [shift + from, shifts[last]! + to];
  };
}

/** Where a node is: its phrasing block, and whether it is in a table or a container. */
interface Context {
  owner: Nodes | undefined;
  table: boolean;
  contained: boolean;
  /** The tags found so far. */
  into: HtmlStartTag[];
  /** Outside footnote definitions, which are read after the rest. */
  body: boolean;
}

/** An open element: its lowercase name, whether it hides its content, and its depth. */
interface OpenElement {
  name: string;
  hides: boolean;
  index: number;
}

/** The element that renderers write for a Markdown block with content. */
function blockName(node: Nodes): string {
  switch (node.type) {
    case "paragraph":
      return "p";
    case "heading":
      return `h${node.depth}`;
    case "list":
      return node.ordered ? "ol" : "ul";
    case "listItem":
    case "footnoteDefinition":
      return "li";
    case "blockquote":
    case "table":
      return node.type;
    case "tableRow":
      return "tr";
    case "tableCell":
      return "td";
    default:
      // Such as a container that a dialect writes as a `<div>`.
      return "div";
  }
}

const read = new WeakMap<Root, HtmlStartTag[]>();

/**
 * The HTML start tags in a document that its renderer certainly reads as
 * elements where they are written, in source order, read once per document.
 *
 * Raw HTML is read as a browser reads the page, with each block's own HTML
 * and inline HTML in one paragraph, heading or table cell read together.
 * Where that reading becomes uncertain, nothing after it is read: a comment,
 * raw-text element or tag left open at the end of such a block, which the
 * renderers continue through what follows, or which Obsidian, rendering each
 * block alone, does not; a region that a renderer reads otherwise than the
 * parser and that holds a `<`; inline footnotes, which Obsidian and VitePress
 * move to the end; and in VitePress, a `{{ }}` interpolation that holds HTML
 * and a tag that only VitePress reads as HTML, such as one with `@click`.
 * An end tag that does not close the innermost open element, which a browser
 * may ignore, leaves every later tag hidden if something hides at that point.
 * Footnote definitions are read after the rest, each from the state that the
 * rest ends in, and only when nothing was uncertain: only those that a
 * reference outside footnotes uses, and none if one of them changes that
 * state, because the renderers order them by first reference.
 */
export function htmlStartTags(document: Document): HtmlStartTag[] {
  const known = read.get(document.tree);
  if (known) return known;
  const { source, dialect } = document;
  const tags: HtmlStartTag[] = [];
  read.set(document.tree, tags);
  if (!source.includes("<")) return tags;
  const vitepress = dialect === "vitepress";
  const inlineFootnotes = vitepress || dialect === "obsidian";
  // The first region that a renderer reads otherwise than the parser and that holds a `<`.
  let stopAt = Infinity;
  let protections: [number, number][] | undefined;
  const regions = () => {
    if (protections) return;
    protections = [];
    // Obsidian's inline HTML stretches are Live Preview's editing state, not
    // what Reading view shows; its block-derived subset is a reading of its own.
    for (const [name, set] of Object.entries(rendererProtections(document)))
      if (set instanceof Set && name !== "htmlText")
        for (const node of set as ReadonlySet<unknown>)
          if (typeof node === "object" && node !== null && located(node as Nodes))
            protections.push(range(node as Nodes));
    protections.sort((a, b) => a[0] - b[0]);
    let lt = -1;
    for (const [start, end] of protections) {
      if (lt < start) lt = source.indexOf("<", start);
      if (lt < 0) break;
      if (lt < end) {
        stopAt = start;
        break;
      }
    }
  };
  const mustaches = vitepress
    ? Array.from(source.matchAll(/\{\{[\s\S]*?(?:\}\}|$)/g), (match): [number, number] => [
        match.index,
        match.index + match[0].length,
      ])
    : [];
  const inMustache = (start: number, end: number) => {
    let low = 0;
    let high = mustaches.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (mustaches[middle]![1] <= start) low = middle + 1;
      else high = middle;
    }
    return low < mustaches.length && mustaches[low]![0] < end;
  };

  let stopped = false;
  /** The raw-text element open at the end of the last node, and the block it is in. */
  let inside: string | undefined;
  let unit: Nodes | undefined;
  /**
   * The open elements, those written and those that renderers write for
   * Markdown blocks, as a browser has them when it closes each element at its
   * own end tag. An end tag of an open element that is not the innermost is
   * uncertain: a browser can ignore it, as in a table cell, a `<select>`, a
   * `<template>` or across a `<p>`, or close other elements, and a start tag
   * may already have closed elements, as `<li>` closes a `<p>`. While
   * something hides, such an end tag leaves everything after it hidden; while
   * nothing hides, what it closes cannot show anything hidden.
   */
  const open: OpenElement[] = [];
  /** The open elements by lowercase name, innermost last. */
  const named = new Map<string, OpenElement[]>();
  /** How many open elements hide their content. */
  let hiding = 0;
  /** Whether an uncertain end tag left everything after it hidden. */
  let lost = false;
  /** While footnotes are read: the elements that the rest leaves open, and whether one closed any. */
  let floor = 0;
  let changed = false;
  const push = (name: string, hides: boolean): OpenElement => {
    const element = { name, hides, index: open.length };
    open.push(element);
    const same = named.get(name);
    if (same) same.push(element);
    else named.set(name, [element]);
    if (hides) hiding++;
    return element;
  };
  /** Closes the element at `index` and those inside it. */
  const closeTo = (index: number) => {
    if (index < floor) changed = true;
    while (open.length > index) {
      const element = open.pop()!;
      named.get(element.name)!.pop();
      if (element.hides) hiding--;
    }
  };
  /** Closes an element, if it is still open, at its end tag. */
  const close = (element: OpenElement | undefined) => {
    if (!element || open[element.index] !== element) return;
    if (element.index === open.length - 1) closeTo(element.index);
    else if (lost || hiding > 0) lost = true;
    else closeTo(element.index);
  };
  const hides = (tag: ScannedTag): boolean => {
    const name = tag.name.toLowerCase();
    if (hidingElements.has(name)) return true;
    // An attribute that the grammar does not read can be anything.
    if (!tag.attributes) return true;
    if (vitepress && (!vueHtml.has(tag.name) || vueSyntax(tag.attributes))) return true;
    return hiddenBy(tag.attributes, dialect);
  };
  const readHtml = (node: Nodes, { owner, table, contained, into }: Context) => {
    const [start, end] = range(node);
    if (end > stopAt || (vitepress && inMustache(start, end))) {
      stopped = true;
      return;
    }
    const block = owner ?? node;
    if (block !== unit) {
      if (inside !== undefined) {
        stopped = true;
        return;
      }
      unit = block;
      if (owner && inlineFootnotes && source.slice(...range(owner)).includes("^[")) {
        stopped = true;
        return;
      }
    }
    const map = sourceMapper(source, node, contained);
    const result = scan((node as { value: string }).value, inside, (tag) => {
      const name = tag.name.toLowerCase();
      // A browser ignores the end tag of an element that is not open.
      if (tag.close) return close(named.get(name)?.at(-1));
      const at = tag.attributes && map(tag.from, tag.to);
      if (tag.attributes && at)
        into.push({
          name: tag.name,
          start: at[0],
          end: at[1],
          attributes: tag.attributes,
          table,
          hidden: lost || hiding > 0,
        });
      // Vue closes any element written as `<x/>`; HTML only void elements.
      if (voidElements.has(name) || (vitepress && tag.selfClosing)) return;
      push(name, hides(tag));
    });
    inside = result.inside;
    if (!result.certain) stopped = true;
  };

  const footnotes: Nodes[] = [];
  const used = new Set<string>();
  const visit = (node: Nodes, context: Context) => {
    if (stopped) return;
    if (node.type === "html") {
      regions();
      readHtml(node, context);
      return;
    }
    if (node.type === "footnoteDefinition" && context.body) {
      footnotes.push(node);
      return;
    }
    if (node.type === "footnoteReference" && context.body) used.add(node.identifier);
    // VitePress's component grammar reads more tags as HTML than CommonMark,
    // such as `<b @click="x">`, which the parser leaves as text.
    if (vitepress && node.type === "text" && /<\/?[A-Za-z]/.test(source.slice(...range(node)))) {
      stopped = true;
      return;
    }
    if (!("children" in node)) return;
    let inner = context;
    if (phrasing.has(node.type)) inner = { ...inner, owner: node };
    if (node.type === "table") inner = { ...inner, table: true };
    if (containers.has(node.type) && !inner.contained) inner = { ...inner, contained: true };
    // The block's own element, such as `<p>`, which the renderer closes after its content.
    const block =
      node.type === "root" || inlineNodes.has(node.type) ? undefined : push(blockName(node), false);
    for (const child of node.children) visit(child, inner);
    close(block);
  };
  const body: Context = {
    owner: undefined,
    table: false,
    contained: false,
    into: tags,
    body: true,
  };
  visit(document.tree, body);
  if (inside !== undefined) stopped = true;
  if (stopped || !footnotes.length) return tags;
  regions();
  if (stopAt !== Infinity) return tags;
  // Footnotes follow the rest of the page, each from the state it ends in.
  floor = open.length;
  const later: HtmlStartTag[] = [];
  const seen = new Set<string>();
  for (const footnote of footnotes) {
    const identifier = (footnote as { identifier: string }).identifier;
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    if (!used.has(identifier)) continue;
    unit = undefined;
    visit(footnote, { ...body, contained: true, into: later, body: false });
    if (stopped || inside !== undefined || changed || open.length !== floor) return tags;
  }
  tags.push(...later);
  return tags;
}
