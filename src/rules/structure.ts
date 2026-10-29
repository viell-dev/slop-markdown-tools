import type { Emphasis, Heading, Nodes, PhrasingContent, Root, RootContent, Strong } from "mdast";
import type { Document, Finding, Rule } from "../core/types.js";
import { blockIdentifier } from "../syntax/block-identifier.js";
import { range, startsWithMarker, textContent } from "../syntax/parse.js";
import { lineEnd, lineStart } from "../syntax/source.js";
import { vitepressTokens } from "../syntax/vitepress/projection.js";
import { walk } from "../syntax/walk.js";
import { headingAttributes } from "../workspace/heading-attributes.js";
import { obsidianTag, optionsSchema } from "./shared.js";

function content(nodes: RootContent[]): RootContent[] {
  return nodes.filter((node) => !["yaml", "toml"].includes(node.type));
}
/**
 * The headings of a document, in source order, as separate outlines: the
 * document's own, then one for each block quote and footnote. A block quote,
 * which is also how callouts and alerts are written, and a footnote stand
 * apart from the text around them, as they do in an HTML outline, so their
 * headings are checked among themselves and do not count for the document's.
 */
function outlines(tree: Root): Heading[][] {
  const document: Heading[] = [];
  const result = [document];
  const visit = (node: Nodes, outline: Heading[]) => {
    if (node.type === "heading") outline.push(node);
    if (!("children" in node)) return;
    for (const child of node.children)
      if (child.type === "blockquote" || child.type === "footnoteDefinition") {
        const own: Heading[] = [];
        result.push(own);
        visit(child, own);
      } else visit(child, outline);
  };
  visit(tree, document);
  return result;
}
const levelSchema = { type: "integer", minimum: 1, maximum: 6, default: 1 };
const titleSchema = {
  description:
    "True uses the default literal title field; a string matches front matter in multiline mode; false or an empty string disables it.",
  anyOf: [{ type: "boolean" }, { type: "string", format: "regex" }],
};
type TitleSetting = boolean | string;
/** Whether front matter contains a recognized title field or matches a configured pattern. */
function frontMatterTitle(tree: Root, setting: TitleSetting = true): boolean {
  if (setting === false || setting === "") return false;
  const pattern = typeof setting === "string" ? new RegExp(setting, "m") : undefined;
  return tree.children.some((node) => {
    // The tree's types know YAML front matter only; the parser also reads TOML.
    const { type, value } = node as { type: string; value?: string };
    if (pattern) return (type === "yaml" || type === "toml") && pattern.test(value ?? "");
    if (type === "yaml") return /^["']?title["']?[ \t]*:/m.test(value ?? "");
    if (type !== "toml") return false;
    // TOML keys after a table header belong to that table.
    const top = (value ?? "").split(/^[ \t]*\[/m, 1)[0]!;
    return /^[ \t]*["']?title["']?[ \t]*=/m.test(top);
  });
}
/** A heading's text as a reader sees it, with blank space collapsed. */
function headingText(node: Heading): string {
  return textContent(node).replace(/\s+/g, " ").trim();
}
/** Text for a message, shortened to about 60 characters. */
function quoted(text: string): string {
  const characters = [...text];
  return characters.length > 60 ? `${characters.slice(0, 57).join("").trimEnd()}…` : text;
}

interface Trailing {
  /** The visible text that ends the content, without the blank space after it. */
  text: string;
  /** The node whose text it is. */
  node: Nodes;
}
/**
 * The text that inline content ends with as readers see it: `undefined` when
 * the node shows no text, such as a comment, an HTML tag, or a footnote
 * reference, so that the text before it ends the content, and `null` when it
 * ends with something whose characters are not prose: code, math, an image, an
 * embed, or an autolink, which shows its address.
 */
function trailingText(node: Nodes, source: string): Trailing | null | undefined {
  if (node.type === "link" && source[range(node)[0]] !== "[") return null;
  switch (node.type) {
    case "text":
    case "obsidianHighlight":
      return node.value.trim() ? { text: node.value.trimEnd(), node } : undefined;
    case "wikiLink":
      return node.embed ? null : { text: (node.label ?? node.target).trimEnd(), node };
    case "html":
    case "obsidianComment":
    case "footnoteReference":
    case "break":
      return undefined;
    case "heading":
    case "emphasis":
    case "strong":
    case "delete":
    case "link":
    case "linkReference":
      for (let i = node.children.length - 1; i >= 0; i--) {
        const found = trailingText(node.children[i]!, source);
        if (found !== undefined) return found;
      }
      return undefined;
    default:
      return null;
  }
}
/** markdownlint's MD026 default: sentence punctuation, but not `?`, which ends the questions of an FAQ. */
const headingPunctuation = ".,;:!。，；：！";
/**
 * An emoji shortcode such as `:tada:` at the end, whose colon closes the
 * shortcode. GitHub, Forgejo, Gitea, and VitePress show an emoji in its place.
 */
const shortcode = /(?:^|\s):[\w+-]+:$/u;
/**
 * A period that ends an abbreviation rather than a sentence: initials such as
 * `e.g.`, `U.S.`, and `Ph.D.`, and the common abbreviations listed, such as
 * `etc.`, which the rule's documentation names.
 */
const abbreviation =
  /(?:^|[^\p{L}\p{N}])(?:(?:\p{L}{1,2}\.){2,}|(?:etc|et al|cf|vs|viz|approx|inc|ltd|co|corp|jr|sr)\.)$/iu;
/** The punctuation character from `punctuation` that `text` ends with as a sentence would, if any. */
function endingPunctuation(text: string, punctuation: string): string | undefined {
  const last = [...text].at(-1);
  if (last === undefined || !punctuation.includes(last) || shortcode.test(text)) return undefined;
  // An ellipsis trails off rather than ending a sentence.
  if (last === "." && (/\.{3,}$/.test(text) || abbreviation.test(text))) return undefined;
  return last;
}
/**
 * The text that each heading ends with as its renderer shows it, without the
 * trailing attribute block that Forgejo, Gitea, and VitePress read as the
 * heading's attributes, or the block identifier that Obsidian reads as its
 * identifier, rather than its text.
 */
function headingEndings(document: Document): Map<Heading, Trailing | null | undefined> {
  const forge = document.dialect === "forgejo" || document.dialect === "gitea";
  const attributes = forge ? headingAttributes(document) : undefined;
  // VitePress removes a valid block, and records its attributes on the heading, by the line it starts on.
  const attributed = new Set<number>();
  if (document.dialect === "vitepress" && document.vitepress?.attrs !== false)
    for (const token of vitepressTokens(document))
      if (token.type === "heading_open" && token.attrs?.length && token.map)
        attributed.add(token.map[0]);
  const endings = new Map<Heading, Trailing | null | undefined>();
  const visit = (node: Nodes) => {
    if (node.type === "heading") {
      const heading = attributes?.get(node)?.heading ?? node;
      let ending = trailingText(heading, document.source);
      const suffix = attributed.has(node.position!.start.line - 1)
        ? /\s*\{[^{}]*\}$/u
        : document.dialect === "obsidian" && blockIdentifier(document.source, node)
          ? /\s+\^[A-Za-z0-9-]+$/u
          : undefined;
      if (ending && suffix) {
        const text = ending.text.replace(suffix, "");
        if (text.trim()) ending = { ...ending, text };
        else {
          // The suffix fills its whole text node, as in `**Use.** ^usage`:
          // the inline content before that node ends the heading.
          const at = heading.children.indexOf(ending.node as PhrasingContent);
          ending = undefined;
          for (let index = at - 1; at > 0 && index >= 0 && ending === undefined; index--)
            ending = trailingText(heading.children[index]!, document.source);
        }
      }
      endings.set(node, ending);
    } else if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(document.tree);
  return endings;
}

/** markdownlint's MD036 default: text that ends with these is a sentence, not a heading. */
const emphasisPunctuation = ".,;:!?。，；：！？";
/** The inline content that a heading could hold as plain text, without links, images, or breaks. */
const prose = new Set([
  "text",
  "emphasis",
  "strong",
  "delete",
  "inlineCode",
  "inlineMath",
  "obsidianHighlight",
]);
function plain(node: PhrasingContent): boolean {
  if (!prose.has(node.type)) return false;
  return !("children" in node) || node.children.every(plain);
}
/**
 * The emphasis or strong text that a paragraph consists of, if that is all it
 * shows: HTML tags, comments, blank space, and an Obsidian block identifier
 * beside it do not count.
 */
function emphasisOnly(document: Document, paragraph: Nodes): Emphasis | Strong | undefined {
  if (paragraph.type !== "paragraph") return undefined;
  const identifier =
    document.dialect === "obsidian" ? blockIdentifier(document.source, paragraph) : undefined;
  const shown = paragraph.children.filter(
    (child) =>
      child.type !== "html" &&
      child.type !== "obsidianComment" &&
      !(child.type === "text" && !child.value.trim()) &&
      !(child === identifier?.node && /^\s*\^[A-Za-z0-9-]+\s*$/u.test(child.value)),
  );
  const [only] = shown;
  if (shown.length !== 1 || (only?.type !== "emphasis" && only?.type !== "strong"))
    return undefined;
  return only.children.every(plain) ? only : undefined;
}

/**
 * The offsets where paragraphs start a line that renderers would read as an
 * ATX heading if it started with one: each paragraph's first line, and, below
 * the line of an alert's or callout's marker, the line where its body starts.
 * Later lines of a paragraph can start with any word once it is wrapped, such
 * as an issue reference or a hashtag, so they are left out.
 */
function lineStartsOfParagraphs(document: Document): number[] {
  const { source } = document;
  const starts: number[] = [];
  walk(document.tree, "paragraph", (node, _index, parent) => {
    const [start, end] = range(node);
    starts.push(start);
    if (document.dialect === "commonmark" || parent?.type !== "blockquote") return;
    if (parent.children[0] !== node) return;
    const first = lineEnd(source, start);
    if (first >= end || !startsWithMarker(source.slice(start, first), node)) return;
    let at = first + (source.startsWith("\r\n", first) ? 2 : 1);
    // The body's line starts after its container's markers and indentation.
    while (at < end && (source[at] === ">" || source[at] === " " || source[at] === "\t")) at++;
    if (at < end) starts.push(at);
  });
  return starts;
}
/**
 * One to six `#` before what would be a heading's text after a space: a
 * letter or a digit, also after `*`, `_`, or a backtick that opens emphasis or
 * code. Other characters after `#` mark other notations, such as a shebang
 * (`#!`) or a keycap emoji.
 */
const unspacedHeading = /^(#{1,6})(?=[*_`]*[\p{L}\p{N}])/u;
/** A single `#` before a number alone, as in an issue reference such as `#123`. */
const numberReference = /^#\p{N}+(?![\p{L}\p{N}])/u;
/** A closing run of `#` that a space before it would make a closed heading's, not escaped. */
const closingRun = /(?:^|[^\\#])#+$/;

export const structureRules: Record<string, Rule> = {
  "structure/initial-heading": {
    description: "Require an initial heading at the configured level.",
    kind: "problem",
    schema: optionsSchema({
      level: levelSchema,
      allowPreamble: { type: "boolean", default: false },
      frontMatterTitle: { ...titleSchema, default: false },
    }),
    check({ document, options }) {
      if (frontMatterTitle(document.tree, (options.frontMatterTitle ?? false) as TitleSetting))
        return [];
      const level = (options.level as number | undefined) ?? 1;
      const blocks = content(document.tree.children);
      const first = options.allowPreamble
        ? blocks.find((node) => node.type === "heading")
        : blocks[0];
      return first?.type === "heading" && first.depth === level
        ? []
        : [
            {
              start: first ? range(first)[0] : blocks[0] ? range(blocks[0])[0] : 0,
              message: options.allowPreamble
                ? `Use a level-${level} heading as the first heading after any preamble or front matter.`
                : `Start the document with a level-${level} heading after optional front matter.`,
            },
          ];
    },
  },
  "structure/heading-increment": {
    description: "Report headings more than one level deeper than the heading before them.",
    kind: "problem",
    schema: optionsSchema({ frontMatterTitle: { ...titleSchema, default: false } }),
    check({ document, options }) {
      const findings: Finding[] = [];
      // A recognized front-matter title stands for a level-1 heading before
      // the document's own first heading; quotes and footnotes keep theirs.
      const titled = frontMatterTitle(
        document.tree,
        (options.frontMatterTitle ?? false) as TitleSetting,
      );
      outlines(document.tree).forEach((outline, index) => {
        const first = index === 0 && titled ? 0 : 1;
        for (let i = first; i < outline.length; i++) {
          const previous = i ? outline[i - 1]!.depth : 1;
          const heading = outline[i]!;
          if (heading.depth > previous + 1)
            findings.push({
              start: range(heading)[0],
              message: i
                ? `Heading level ${heading.depth} follows level ${previous}; use at most level ${previous + 1}.`
                : `Heading level ${heading.depth} follows the front matter's title, which counts as level 1; use at most level 2.`,
            });
        }
      });
      return findings;
    },
  },
  "structure/single-title": {
    description:
      "Report repeated title headings at the configured level, including front matter titles.",
    kind: "problem",
    schema: optionsSchema({
      level: levelSchema,
      frontMatterTitle: { ...titleSchema, default: true },
    }),
    check({ document, options }) {
      const level = (options.level as number | undefined) ?? 1;
      const findings: Finding[] = [];
      outlines(document.tree).forEach((outline, index) => {
        // Only the document's own outline has front matter.
        let title =
          index === 0 &&
          frontMatterTitle(document.tree, options.frontMatterTitle as TitleSetting | undefined)
            ? "the front matter sets the title"
            : undefined;
        for (const heading of outline) {
          if (heading.depth !== level) continue;
          if (title === undefined) {
            title = `the title is on line ${heading.position!.start.line}`;
            continue;
          }
          findings.push({
            start: range(heading)[0],
            message: `Use one level-${level} heading per document; ${title}.`,
          });
        }
      });
      return findings;
    },
  },
  "structure/duplicate-heading": {
    description: "Report repeated heading text among siblings or across an outline.",
    kind: "problem",
    schema: optionsSchema({ siblingsOnly: { type: "boolean", default: true } }),
    check({ document, options }) {
      const findings: Finding[] = [];
      for (const outline of outlines(document.tree)) {
        // The headings that a following heading can be under, from the outermost.
        const parents: Heading[] = [];
        // The texts of the headings under each parent so far, by parent.
        const seen = new Map<Heading | undefined, Map<string, Heading>>();
        for (const heading of outline) {
          while (parents.length && parents.at(-1)!.depth >= heading.depth) parents.pop();
          const parent = options.siblingsOnly === false ? undefined : parents.at(-1);
          parents.push(heading);
          const text = headingText(heading);
          if (!text) continue;
          let siblings = seen.get(parent);
          if (!siblings) seen.set(parent, (siblings = new Map<string, Heading>()));
          const earlier = siblings.get(text);
          if (earlier)
            findings.push({
              start: range(heading)[0],
              message: `Heading "${text}" repeats the heading on line ${earlier.position!.start.line} ${options.siblingsOnly === false ? "in this outline" : "under the same parent"}; give it a distinct name.`,
            });
          else siblings.set(text, heading);
        }
      }
      return findings;
    },
  },
  "structure/unspaced-heading": {
    description: "Report paragraph text that would be an ATX heading with a space after its #.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const { source } = document;
      const findings: Finding[] = [];
      for (const start of lineStartsOfParagraphs(document)) {
        const line = source.slice(start, lineEnd(source, start)).trimEnd();
        const hashes = unspacedHeading.exec(line)?.[1];
        if (!hashes || numberReference.test(line)) continue;
        // Obsidian reads `#word` as a tag.
        if (document.dialect === "obsidian" && obsidianTag.test(line)) continue;
        const closed = closingRun.test(line.slice(hashes.length));
        findings.push({
          start,
          end: start + line.length,
          message: `Text starts with "${hashes}" without a space after it, so it is not a heading; if it should be one, ${closed ? `add spaces inside the hashes, as in "${hashes} Heading ${hashes}"` : `add a space after "${hashes}"`}.`,
        });
      }
      return findings;
    },
  },
  "structure/heading-punctuation": {
    description: "Report headings that end with sentence punctuation.",
    kind: "problem",
    schema: optionsSchema({ punctuation: { type: "string", default: headingPunctuation } }),
    check({ document, options }) {
      const punctuation = (options.punctuation as string | undefined) ?? headingPunctuation;
      const findings: Finding[] = [];
      for (const [heading, ending] of headingEndings(document)) {
        if (!ending) continue;
        const mark = endingPunctuation(ending.text, punctuation);
        if (mark === undefined) continue;
        const message = `Heading ends with "${mark}"; a heading is a title, not a sentence.`;
        // The character itself where the source holds the text as written,
        // not as a character reference or escape; otherwise the heading.
        const [start, end] = range(ending.node);
        findings.push(
          document.source.slice(start, end).startsWith(ending.text)
            ? {
                start: start + ending.text.length - mark.length,
                end: start + ending.text.length,
                message,
              }
            : { start: range(heading)[0], message },
        );
      }
      return findings;
    },
  },
  "structure/emphasis-heading": {
    description: "Report paragraphs of only emphasized or strong text, which read as headings.",
    kind: "problem",
    schema: optionsSchema({ punctuation: { type: "string", default: emphasisPunctuation } }),
    check({ document, options }) {
      const punctuation = (options.punctuation as string | undefined) ?? emphasisPunctuation;
      const findings: Finding[] = [];
      // VitePress's custom containers, such as `::: tip`, are its callouts.
      // Their lines, by the lines that open and close them.
      const containers: [number, number][] = [];
      if (document.dialect === "vitepress")
        for (const token of vitepressTokens(document))
          if (token.type.startsWith("container_") && token.nesting === 1 && token.map)
            containers.push([token.map[0], token.map[1]]);
      // Only the document's own paragraphs: in a list item, quote, callout, or
      // footnote, emphasized text labels the content beside it.
      for (const node of document.tree.children) {
        const emphasis = emphasisOnly(document, node);
        if (!emphasis) continue;
        const line = node.position!.start.line - 1;
        if (containers.some(([open, close]) => line > open && line <= close)) continue;
        const text = textContent(emphasis).replace(/\s+/g, " ").trim();
        const last = [...text].at(-1);
        if (last === undefined || punctuation.includes(last)) continue;
        const [start, end] = range(node);
        findings.push({
          start,
          end,
          message: `Paragraph "${quoted(text)}" is only ${emphasis.type === "strong" ? "strong" : "emphasized"} text; if it names a section, make it a heading, which the outline lists and links can reach.`,
        });
      }
      return findings;
    },
  },
  "structure/split-quote": {
    description: "Report block quotes separated only by blank lines, which may be meant as one.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const { source } = document;
      const findings: Finding[] = [];
      walk(document.tree, (parent) => {
        if (!("children" in parent)) return;
        const children: Nodes[] = parent.children;
        for (let i = 1; i < children.length; i++) {
          const before = children[i - 1]!;
          const after = children[i]!;
          if (before.type !== "blockquote" || after.type !== "blockquote") continue;
          // A blank line is the only way to write an alert or callout directly
          // after a quote, so one that opens the next quote stands apart.
          const opening = after.children[0];
          if (opening?.type === "paragraph") {
            const [start] = range(opening);
            if (startsWithMarker(source.slice(start, lineEnd(source, start)), opening)) continue;
          }
          const end = lineEnd(source, range(before)[1]);
          const from = end + (source.startsWith("\r\n", end) ? 2 : 1);
          const gap = source.slice(from, lineStart(source, range(after)[0]));
          // Only blank lines, with the markers of an enclosing quote.
          if (!/^[ \t>\r\n]*$/.test(gap)) continue;
          findings.push({
            start: from,
            end: from + gap.replace(/(?:\r\n|\r|\n)$/, "").length,
            message:
              'A blank line separates two block quotes, which some renderers join into one; to write one quote, start the blank line with ">", or to keep two, put text or a comment between them.',
          });
        }
      });
      return findings;
    },
  },
};
