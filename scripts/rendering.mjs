// Generated documents and HTML normalization for comparing renderers before and after
// formatting. The unit test tests/unit/renderers.test.ts compares commonmark.js and
// markdown-it offline; scripts/github-rendering.mjs compares GitHub's Markdown API.
//
// A document comes from a seed alone, so a seed reproduces it on any machine. The generator is
// mulberry32, whose low bits do not repeat with a short period, unlike a linear congruential
// generator in floating point. Every word and line is synthetic.

import { decodeHTML } from "entities/decode";
import { escapeAttribute, escapeText } from "entities/escape";

/** A seeded generator (mulberry32) of unsigned 32-bit integers. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

/**
 * What a document may contain. `commonmark` is CommonMark, with tables and tildes, which it reads
 * as text; `gfm` is what markdown-it's default preset reads as GitHub does: CommonMark, tables,
 * and strikethrough with two tildes; `github` adds the rest of GitHub's syntax: strikethrough
 * with one tilde, task lists, alerts, footnotes, literal autolinks, and dollar math. `obsidian`
 * is `github` with Obsidian's wikilinks, embeds, highlights, comments, tags, and inline
 * footnotes in place of the runs of emphasis markers, which Obsidian pairs in ways of its own
 * (scripts/obsidian-check.mjs).
 * @typedef {"commonmark" | "gfm" | "github" | "obsidian"} Syntax
 */

const words =
  "amber birch cedar delta ember fern grove harbor iris juniper kettle lantern meadow needle orchard pebble quarry ribbon saddle timber valley walnut yonder zephyr signal method anchor basket candle engine fabric glacier".split(
    " ",
  );
/** Words that open a block at the start of a line, or end one, if wrapping puts them there. */
const hazards = [
  "-",
  "+",
  "*",
  "1.",
  "2)",
  "10.",
  "#",
  "##",
  ">",
  "=",
  "===",
  "---",
  "***",
  "```",
  "~~~",
  "<div>",
  "<!--",
  "-->",
  "[a]:",
  "|",
  ":::",
  "{%",
  "\\",
  "&amp;",
  "&#42;",
  "\\*",
  "<b>",
];

/** One document's writer, from its seed. */
function writer(seed, syntax) {
  const next = random(seed);
  const below = (count) => next() % count;
  const chance = (percent) => below(100) < percent;
  const pick = (list) => list[below(list.length)];
  const word = () => pick(words);
  const gfm = syntax !== "commonmark";
  const obsidian = syntax === "obsidian";
  const github = syntax === "github" || obsidian;
  // markdown-it reads runs of three or more tildes as strikethrough, which GitHub does not.
  const tildes = (text) => (syntax === "gfm" ? text.replace(/~{3,}/g, "~~") : text);

  /** A run of emphasis, strong, strikethrough, and code span markers mixed with letters. */
  function markers() {
    const runs = ["*", "**", "***", "_", "__", "`", "``", "~~"];
    if (github || syntax === "commonmark") runs.push("~");
    const letters = ["a", "b", "x", "ab", " ", " ", ".", "!", "(", ")"];
    const length = 3 + below(9);
    let text = word();
    for (let index = 0; index < length; index++) text += chance(55) ? pick(runs) : pick(letters);
    return text + pick(["", " ", "."]) + word();
  }
  /**
   * A line made mostly of emphasis, strong, strikethrough, and code span markers, where
   * renderers pair delimiter runs in the ways that differ most.
   */
  function markerLine() {
    const characters = ["*", "*", "*", "_", "_", "`", "a", "b", "x", " ", " ", ".", "!"];
    if (syntax === "gfm") characters.push("~~");
    else characters.push("~", "~");
    const length = 8 + below(24);
    let text = word() + pick(["", " "]);
    for (let index = 0; index < length; index++) text += pick(characters);
    return tildes(text + pick(["", " "]) + word());
  }
  /** A link, an image, a badge, or an autolink. */
  function link() {
    const target = pick(["https://example.com/a", "page.md", "#section", "../b.md#c", "<a b.md>"]);
    const title = chance(20) ? ` "${word()}"` : "";
    switch (below(7)) {
      case 0:
        return `![${word()}](https://example.com/${word()}.svg)`;
      case 1:
        return `[![${word()}](https://img.example.com/badge/${word()}-${word()}.svg)](https://example.com/${word()})`;
      case 2:
        return "<https://example.com/" + word() + ">";
      case 3:
        return github ? `https://example.com/${word()}` : `[${word()}][ref]`;
      case 4:
        return `[${word()} ${word()}](${target}${title})`;
      default:
        return `[${word()}](${target})`;
    }
  }
  /** One of Obsidian's own inline constructs. */
  function obsidianInline() {
    return pick([
      `[[${word()}]]`,
      `[[${word()}|${word()} ${word()}]]`,
      `[[${word()}#${word()}]]`,
      `![[${word()}.png]]`,
      `==${word()} ${word()}==`,
      `%%${word()} ${word()}%%`,
      `#${word()}`,
      `^[${word()} ${word()}]`,
    ]);
  }
  /** One word or construct of a paragraph. */
  function inline() {
    const roll = below(100);
    if (obsidian && roll >= 31 && roll < 36) return obsidianInline();
    if (roll < 6) return `*${word()} ${word()}*`;
    if (roll < 10) return `_${word()}_`;
    if (roll < 14) return `__${word()}__`;
    if (roll < 17) return `**${word()}**`;
    if (roll < 22) return `\`${word()}${pick(["", " ", "  "])}${word()}\``;
    if (roll < 27) return link();
    if (roll < 31) return pick(hazards);
    if (roll < 36) return markers();
    if (roll < 38 && gfm) return `~~${word()}~~`;
    if (roll < 40 && github) return pick([`~${word()}~`, "$x^2$", "www.example.com", "[^1]"]);
    if (roll < 41) return "<span>" + word() + "</span>";
    if (roll < 42) return "&copy;";
    return word();
  }
  /** Lines of prose, with hard breaks and trailing spaces. */
  function prose(lines = 1 + below(4)) {
    const result = [];
    for (let line = 0; line < lines; line++) {
      const length = 2 + below(chance(40) ? 22 : 9);
      const parts = Array.from({ length }, inline);
      let text = parts.join(" ");
      if (line < lines - 1) text += pick(["", "", "", "  ", "\\", " ", "   "]);
      else if (chance(10)) text += " ";
      result.push(tildes(text));
    }
    return result;
  }
  const indent = (lines, by) => lines.map((line) => (line ? by + line : line));
  /** A list, nested and loose at random. */
  function list(depth = 0) {
    const ordered = chance(35);
    const bullet = pick(["-", "*", "+"]);
    const delimiter = pick([".", ")"]);
    const start = pick([1, 1, 1, 2, 9]);
    const loose = chance(30);
    const lines = [];
    const items = 1 + below(4);
    for (let index = 0; index < items; index++) {
      let marker = ordered ? `${start + index}${delimiter}` : bullet;
      if (ordered && chance(15)) marker = `${start}${delimiter}`;
      if (github && !ordered && chance(25)) marker += pick([" [ ]", " [x]", " [X]"]);
      const width = marker.replace(/ \[.\]$/, "").length + 1;
      const body = prose(1 + below(2));
      lines.push(
        `${marker} ${body[0]}`,
        ...indent(body.slice(1), chance(70) ? " ".repeat(width) : ""),
      );
      if (depth < 2 && chance(25)) {
        if (loose) lines.push("");
        lines.push(...indent(list(depth + 1), " ".repeat(width)));
      }
      if (loose && index < items - 1) lines.push("");
    }
    return lines;
  }
  /** A table, with or without alignment and outer pipes. */
  function table() {
    const columns = 1 + below(3);
    const cell = () => tildes(chance(70) ? inline() : `${word()} ${word()}`).replaceAll("|", "\\|");
    // markdown-it needs a pipe in the delimiter row, which GitHub does not.
    const outer = chance(70) || (syntax === "gfm" && columns === 1);
    const row = (cells) => (outer ? `| ${cells.join(" | ")} |` : cells.join(" | "));
    const align = () => pick(["---", ":--", "--:", ":-:", "-"]);
    const rows = [row(Array.from({ length: columns }, cell))];
    rows.push(row(Array.from({ length: columns }, align)));
    for (let index = below(3); index >= 0; index--)
      rows.push(row(Array.from({ length: columns }, cell)));
    return rows;
  }
  /** A block quote, an alert, or a callout written as one. */
  function quote(depth = 0) {
    const lines = [];
    if (github && chance(40)) {
      const kind = pick(["NOTE", "TIP", "WARNING", "note", "Important", "CAUTION"]);
      lines.push(pick([`[!${kind}]`, `\\[!${kind}]`, `&#91;!${kind}]`, `[!${kind}] ${word()}`]));
    }
    const body = depth < 1 && chance(25) ? quote(depth + 1) : chance(30) ? list() : prose();
    lines.push(...body);
    const prefix = pick(["> ", ">", ">  "]);
    const quoted = lines.map((line) => (line ? prefix + line : ">"));
    // A lazy continuation line.
    if (chance(15)) quoted.push(word() + " " + word());
    return quoted;
  }
  /** A fenced or indented code block. */
  function code() {
    const fence = pick(["```", "~~~", "````", "~~~~"]);
    const info = pick(["", "js", "sh", "md", " text"]);
    const body = [`const ${word()} = ${below(100)};`, `  ${word()}(${word()})   `, ""];
    if (chance(20)) return indent(body.slice(0, 2), "    ");
    return [fence + info, ...body.slice(0, 1 + below(3)), fence.slice(0, chance(90) ? 4 : 3)];
  }
  /** One block. */
  function block() {
    const roll = below(100);
    if (roll < 8) return [`${"#".repeat(1 + below(4))} ${prose(1)[0]}${pick(["", " #", " ##"])}`];
    if (roll < 12) return [...prose(1 + below(2)), pick(["===", "---", "=", "-----"])];
    if (roll < 26) return prose();
    if (roll < 36) return obsidian ? prose() : Array.from({ length: 1 + below(3) }, markerLine);
    if (roll < 48) return list();
    if (roll < 52) return [pick(["***", "___", "- - -", "---", "* * *", "_____"])];
    if (roll < 59) return code();
    if (roll < 65) return gfm ? table() : table().concat(prose(1));
    if (roll < 74) return quote();
    if (roll < 78) return [pick(["<!-- a comment -->", "<!--", "<!-- multi"]), word() + " -->"];
    if (roll < 81) return ["<div>", ...prose(1), "</div>"];
    if (roll < 84) return [`::: ${word()}`, ...prose(1), ":::"];
    if (roll < 87) return [`{% include ${word()}.html %}`, ...prose(1)];
    if (roll < 90) return [`[ref]: https://example.com/${word()}${chance(30) ? ' "Title"' : ""}`];
    if (roll < 93 && github) return [`[^1]: ${prose(1)[0]}`, ...indent(prose(1), "    ")];
    if (roll < 95 && github) return ["$$", "x = " + word(), "$$"];
    return [link() + " " + prose(1)[0]];
  }
  return { below, chance, pick, block };
}

/** The separators between blocks: none, blank lines, and blank lines with spaces. */
const separators = ["\n", "\n\n", "\n\n", "\n\n", "\n\n\n", "\n  \n", "\n\t\n"];

/**
 * The document of `seed`: four to nine blocks with random separators, after front matter in
 * some documents.
 * @param {number} seed
 * @param {Syntax} syntax
 * @returns {string}
 */
export function generateDocument(seed, syntax) {
  const { below, chance, pick, block } = writer(seed, syntax);
  let source = "";
  if (chance(15)) {
    source += pick(["---\ntitle: A title\n---\n", "+++\ntitle = 1\n+++\n", "---\n---\n"]);
    source += pick(["", "\n"]);
  }
  const count = 4 + below(6);
  for (let index = 0; index < count; index++) {
    if (index > 0) source += pick(separators);
    source += block().join("\n");
  }
  return source + pick(["\n", "\n", "", "\n\n"]);
}

/**
 * The seed of document `index` of the run seed `runSeed`, mixed so that the documents of
 * neighboring seeds and indices share no state.
 * @param {number} runSeed
 * @param {number} index
 * @returns {number}
 */
export function documentSeed(runSeed, index) {
  return (Math.imul(runSeed >>> 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca77)) >>> 0;
}

/**
 * Elements whose content keeps its whitespace when rendered: code blocks, and code spans, which
 * GitHub's styles show with every space.
 */
const literal = /(<pre(?=[\s>])[^>]*>)([\s\S]*?)<\/pre>|(<code(?=[\s>])[^>]*>)([\s\S]*?)<\/code>/g;
/** Block-level tags, next to which whitespace has no effect. */
const blockTag =
  / ?(<\/?(?:p|li|ul|ol|blockquote|h[1-6]|hr|table|thead|tbody|tr|td|th|pre|div|section|details|summary|markdown-accessiblity-table|br)(?=[\s/>])[^>]*>) ?/g;
/** Where normalizeHtml takes the content of a code element out; renderers never write it. */
const mark = String.fromCharCode(0);

/**
 * The HTML that a renderer produced, with the whitespace that a browser does not show
 * normalized: runs of whitespace are collapsed outside code, and removed next to block-level
 * tags. The content of code blocks and code spans is compared as it is.
 * @param {string} html
 * @returns {string}
 */
export function normalizeHtml(html) {
  const kept = [];
  const outside = html.replace(literal, (_, pre, preContent, code, codeContent) => {
    kept.push(pre ? preContent : codeContent);
    return pre ? `${pre}${mark}</pre>` : `${code}${mark}</code>`;
  });
  const parts = outside.replace(/\s+/g, " ").replace(blockTag, "$1").trim().split(mark);
  return parts.map((part, index) => (index === 0 ? part : kept[index - 1] + part)).join("");
}

/**
 * GitHub's comparison, with code verified against the source parse before
 * accepting highlighting-wrapper or final-line variations (#515). A mismatch
 * stays exact. Raw HTML pre elements are not source code blocks.
 * @param {string} html
 * @param {string} mode
 * @param {import("mdast").Root} tree
 */
export function normalizeGithubHtml(html, mode, tree) {
  /** @type {import("mdast").Code[]} */
  const codes = [];
  let rawPre = false;
  let footnotes = false;
  let rawFootnotes = false;
  let math = false;
  let rawMath = false;
  let rawHtmlDollars = false;
  /** @param {import("mdast").Nodes} node */
  const visit = (node) => {
    if (node.type === "code") codes.push(node);
    if (node.type === "footnoteDefinition") footnotes = true;
    if (
      node.type === "math" ||
      node.type === "inlineMath" ||
      (node.type === "code" && node.lang === "math")
    )
      math = true;
    if (node.type === "html" && /<\/?pre(?:[\s>])/i.test(node.value)) rawPre = true;
    if (node.type === "html" && /\bdata-(?:footnotes|run-id)\b|user-content-fn/.test(node.value))
      rawFootnotes = true;
    if (node.type === "html" && node.value.includes("$")) rawHtmlDollars = true;
    if (node.type === "html" && /<\/?math-renderer\b|\bdata-run-id\b/i.test(node.value))
      rawMath = true;
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
  const pre =
    /<div class="highlight [^"]*"><pre\b[^>]*>([\s\S]*?)<\/pre><\/div>|<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/g;
  const matches = [...html.matchAll(pre)];
  if (
    !rawPre &&
    matches.length === codes.length &&
    html.match(/<pre(?=[\s>])/g)?.length === codes.length
  ) {
    let index = 0;
    html = html.replace(pre, (whole, highlighted, plain) => {
      const node = codes[index++];
      const content = (highlighted ?? plain).replace(/<\/?span(?:\s[^>]*)?>/g, "");
      // Only highlighting spans are markup inside code; actual code brackets
      // must be escaped. Otherwise normalizing could conceal rendered HTML.
      if (/[<>]/.test(content)) return whole;
      const value = decodeHTML(content).replace(/\r\n?/g, "\n");
      if (value !== node.value && value !== node.value + "\n") return whole;
      return `<pre data-source-language="${escapeAttribute(node.lang ?? "")}" data-source-meta="${escapeAttribute(node.meta ?? "")}"><code>${escapeText(node.value)}</code></pre>`;
    });
  }
  // Response IDs and gfm's soft breaks are outside literal code. In particular,
  // a 32-digit hexadecimal code value must not become an incidental ID.
  const kept = [];
  const outside = html.replace(literal, (value) => {
    kept.push(value);
    return `${mark}${kept.length - 1}${mark}`;
  });
  // GitHub's generated footnotes and math carry response IDs. A hexadecimal
  // paragraph, anchor, URL, or source-authored HTML stays exact (#523).
  const ids = new Set();
  const footnoteSection = (tag) =>
    /^<section\b/.test(tag) && /\bdata-footnotes(?:=|[ >])/.test(tag);
  let sectionDepth = 0;
  let definitions = 0;
  if (footnotes && !rawFootnotes)
    for (const [tag] of outside.matchAll(/<[^>]*>/g)) {
      if (footnoteSection(tag) || (sectionDepth && /^<section\b/.test(tag))) {
        sectionDepth++;
        const id = footnoteSection(tag) && /\bdata-run-id="([0-9a-f]{32})"/.exec(tag)?.[1];
        if (id) ids.add(id);
      } else if (sectionDepth && /^<\/section\s*>/.test(tag)) sectionDepth--;
      if (sectionDepth && /^<li\b/.test(tag)) {
        const id = /\bid="user-content-fn-[^"\s]+-([0-9a-f]{32})"/.exec(tag)?.[1];
        if (id) {
          ids.add(id);
          definitions++;
        }
      }
    }
  // Current responses put the suffix only on the definitions and references;
  // older retained responses also had data-run-id. Require one shared suffix.
  if (!definitions || ids.size !== 1) ids.clear();
  const text = outside.replace(/<[^>]*>/g, (tag) =>
    tag.replace(/ (data-run-id|id|href)="([^"]*)"/g, (attribute, name, value) => {
      if (name === "data-run-id")
        return (footnoteSection(tag) && ids.has(value)) ||
          ((math || rawHtmlDollars) &&
            !rawMath &&
            /^<math-renderer(?=[\s>])/.test(tag) &&
            /^[0-9a-f]{32}$/.test(value))
          ? ' data-run-id="ID"'
          : attribute;
      const id = /^((?:#)?user-content-fn(?:ref)?-[^"\s]+-)([0-9a-f]{32})$/.exec(value);
      return id && ids.has(id[2]) ? ` ${name}="${id[1]}ID"` : attribute;
    }),
  );
  return normalizeHtml(
    (mode === "gfm" ? text.replace(/<br\s*\/?>/g, " ") : text).replace(
      new RegExp(`${mark}(\\d+)${mark}`, "g"),
      (_, index) => kept[Number(index)],
    ),
  );
}
