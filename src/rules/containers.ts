import type { Nodes } from "mdast";
import type { Document, Edit, Finding, Rule } from "../core/types.js";
import { walk } from "../syntax/walk.js";
import { lineBreak } from "../syntax/source.js";
import {
  type Analysis,
  type Container,
  type Level,
  analyze,
  quoteListIndentation,
  structuralTab,
} from "./lists.js";
import { obsidianTag, optionsSchema } from "./shared.js";
import { siteSyntax } from "./wrap.js";

/**
 * The rules that write the prefixes of block quotes, list items, and footnote
 * definitions on the lines inside them. Both read a line's containers as the
 * list rules do, through the shared analysis in `lists.ts`.
 */

/** Blocks whose lines may start with any number of spaces after the quote's `>`. */
const spacedBlocks = new Set(["paragraph", "heading", "thematicBreak"]);
/**
 * Blocks whose content starts at the same column after `>` and after `> `,
 * because the quote takes one space after its marker. Others, such as
 * Obsidian comments or a plugin's nodes, stay as written.
 */
const literalBlocks = new Set(["code", "html", "table", "math", "definition"]);

/**
 * The later lines, by index, of inline nodes that keep the whitespace at the
 * start of their lines, such as code spans, math, inline HTML, and titles,
 * and of definitions; the parser and the renderers do not agree on it there.
 */
function keptLines(document: Document): Set<number> {
  const lines = new Set<number>();
  walk(document.tree, (node) => {
    const keeps =
      node.type === "definition" ||
      ("title" in node && typeof node.title === "string") ||
      ("value" in node &&
        typeof node.value === "string" &&
        node.type !== "text" &&
        node.type !== "code" &&
        node.type !== "math");
    if (keeps && node.position)
      for (let line = node.position.start.line; line < node.position.end.line; line++)
        lines.add(line);
  });
  return lines;
}

/** Each line's block directly inside the innermost container that holds the line. */
function blocksByLine(document: Document): Map<number, Nodes> {
  const blocks = new Map<number, Nodes>();
  walk(document.tree, (node) => {
    if (
      node.type !== "blockquote" &&
      node.type !== "listItem" &&
      node.type !== "footnoteDefinition"
    )
      return;
    // Pre-order: a container inside another one overwrites its own lines.
    for (const child of node.children as Nodes[]) {
      if (!child.position) continue;
      for (let line = child.position.start.line - 1; line < child.position.end.line; line++)
        blocks.set(line, child);
    }
  });
  return blocks;
}

const siteParagraphs = new WeakMap<Nodes, boolean>();
/** Whether a line of a node, after its container markers, starts with site-generator syntax. */
function siteLines(document: Document, block: Nodes): boolean {
  let known = siteParagraphs.get(block);
  if (known === undefined) {
    const { start, end } = block.position!;
    known = document.source
      .slice(start.offset, end.offset)
      .split(lineBreak)
      .some((line) => siteSyntax.test(line.replace(/^[ \t>]+/, "")));
    siteParagraphs.set(block, known);
  }
  return known;
}

/**
 * Whether a VitePress document has a custom container's fence on a quote's
 * line. The VitePress dialect's tree leaves the fences out of the quote and
 * reads the lines between them as the container's, so a quote's spaces and
 * prefixes stay as written in such a document.
 */
function quotedVitePressContainer(document: Document): boolean {
  return document.dialect === "vitepress" && /^[ \t]*>[ \t>]*:::/m.test(document.source);
}

/**
 * Whether the line after a quote's last line has text without being in the
 * quote. Renderers can read such a line as more of the quote where the parser
 * does not, as with a numbered item that does not start at 1 (#191, #543), so
 * the quote's lines stay as written.
 */
function adjoined(analysis: Analysis, quote: Container): boolean {
  const next = quote.position!.end.line;
  const { source, lines } = analysis;
  return (
    next < lines.length &&
    /[^ \t>]/.test(source.slice(lines[next]!.start, lines[next]!.end)) &&
    !analysis.match(next).chain.includes(quote)
  );
}

/** The offset of the `>` that a block quote's matched level ends after. */
function quoteMarker(source: string, level: Level): number {
  return source[level.end - 1] === ">" ? level.end - 1 : level.end - 2;
}

const quoteMarkerRule: Rule = {
  description: "Write one space after each block quote marker.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({ listItems: { type: "boolean" } }),
  check({ document, options }) {
    const { source } = document;
    if (!source.includes(">") || quotedVitePressContainer(document)) return [];
    const analysis = analyze(document);
    const { lines } = analysis;
    const kept = keptLines(document);
    const blocks = blocksByLine(document);
    const findings: Finding[] = [];
    const obsidian = document.dialect === "obsidian";
    let continued: Map<number, Nodes> | undefined;
    for (let line = 0; line < lines.length; line++) {
      const { start: lineStart, end: lineEnd } = lines[line]!;
      if (!source.slice(lineStart, lineEnd).includes(">")) continue;
      const { chain, levels } = analysis.match(line);
      // Tabs among the prefixes count to the next tab stop, which moving the
      // characters before them would change.
      if (!levels.length || structuralTab(source, lineStart, lineEnd)) continue;
      for (const [index, level] of levels.entries()) {
        if (level.kind !== "content") break;
        if (level.node.type !== "blockquote") continue;
        const marker = quoteMarker(source, level);
        if (source[marker] !== ">") break;
        let end = marker + 1;
        while (source[end] === " ") end++;
        const spaces = end - marker - 1;
        // A blank quote line's spaces are trailing space, or code's content.
        if (spaces === 1 || end >= lineEnd || source[end] === "\t") continue;
        const quote = level.node;
        if (adjoined(analysis, quote)) continue;
        const next = levels[index + 1];
        const content = source.slice(end, lineEnd);
        if (spaces === 0) {
          // Live Preview reads a tag only after blank space, not directly
          // after `>`, so the space would make the text a tag (issue #409).
          if (obsidian && obsidianTag.test(content)) continue;
          // The quote takes one space after its marker, so a space where it
          // has none moves nothing after it, in any block.
          const block = next ? undefined : blocks.get(line);
          if (
            !next &&
            (chain.length !== index + 1 ||
              !block ||
              (!spacedBlocks.has(block.type) && !literalBlocks.has(block.type)))
          )
            continue;
          if (next && next.node.type === "footnoteDefinition") continue;
          findings.push({
            start: marker + 1,
            end: marker + 1,
            message: "Add a space after the block quote marker.",
            edit: { start: marker + 1, end: marker + 1, text: " " },
          });
          continue;
        }
        if (next) {
          // Spaces before a nested quote's `>` are its indentation and can
          // go; spaces before a list marker are the list's indentation, which
          // moves with the list's lines below; on other lines of a list item
          // they belong to the item.
          if (next.node.type !== "blockquote" || next.kind !== "content" || source[end] !== ">")
            continue;
        } else {
          if (chain.length !== index + 1 || kept.has(line)) continue;
          const block = blocks.get(line);
          if (!block || !spacedBlocks.has(block.type)) continue;
          // Four or more spaces can be what keeps a paragraph's later line
          // from starting a block, as a missing marker keeps a lazy line's,
          // so the spaces go only where the text starts no block without them.
          continued ??= continuationLines(document);
          if (continued.has(line) && !startsNoBlock(content)) continue;
          // Site generators read their containers and template tags by line,
          // and the lines between them as their content; the VitePress
          // dialect's tree holds only that content.
          if (siteLines(document, quote)) continue;
          // In Obsidian, a callout's marker after two or more spaces is text;
          // one space would make the quote a callout.
          if (obsidian && quote.position!.start.line - 1 === line && /^(?:\\?\[|&)/.test(content))
            continue;
        }
        findings.push({
          start: marker + 1,
          end,
          message: "Use one space after the block quote marker.",
          edit: { start: marker + 1, end, text: " " },
        });
      }
    }
    if (options.listItems !== false)
      for (const finding of quoteListIndentation(
        document,
        "Use one space after the block quote marker.",
      ))
        findings.push(finding);
    return findings;
  },
};

/**
 * Text that continues a paragraph on a lazy line and also once the line has
 * its containers' prefixes, in every dialect: a letter or another character
 * that starts no block, a number that is no list marker, emphasis, a code
 * span, a link or image, or an opening bracket or quotation mark. Anything
 * else could start a block, a heading's underline, or a table row inside the
 * container, which the lazy line does not. Digits go only through the number
 * alternative: renderers differ on which ordered markers start a list inside
 * a container, so no marker counts as text.
 */
const continuing = /^(?:[^\s\d!-/:-@[-`{-~]|\d+(?![\d.)])|[*_](?=[^\s*_])|`{1,2}(?!`)|!?\[|[("'])/u;
/** A link reference or footnote definition, which reads otherwise in some renderers. */
const definitionLike = /^\[[^\]]*\]:/;

/**
 * Whether a paragraph's later line, with its indentation removed or its
 * containers' prefixes written, still continues the paragraph: the line's
 * spaces or missing prefixes are what keep a heading, a fence, a list
 * marker, or HTML there from starting a block.
 */
function startsNoBlock(text: string): boolean {
  return (
    continuing.test(text) &&
    !definitionLike.test(text) &&
    !siteSyntax.test(text) &&
    !text.includes("|")
  );
}

/** The lines, by index, that continue a paragraph or an underlined heading's text. */
function continuationLines(document: Document): Map<number, Nodes> {
  const lines = new Map<number, Nodes>();
  walk(document.tree, (node) => {
    if (node.type !== "paragraph" && node.type !== "heading") return;
    if (!node.position) return;
    const last = node.children.at(-1)?.position?.end.line ?? node.position.end.line;
    for (let line = node.position.start.line; line < last; line++) lines.set(line, node);
  });
  return lines;
}

const lazyContinuation: Rule = {
  description: "Write the container markers and indentation on lazy continuation lines.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({}),
  check({ document }) {
    if (quotedVitePressContainer(document)) return [];
    const analysis = analyze(document);
    const { lines } = analysis;
    let paragraphs: Map<number, Nodes> | undefined;
    let kept: Set<number> | undefined;
    // Each paragraph's lazy lines, with the edit for each or undefined where
    // a line must stay lazy. A paragraph changes all of them or none: one line
    // left lazy keeps what the renderers read around it, such as a lazy line
    // of `=` that Obsidian takes for an underline of the text above it.
    const byParagraph = new Map<Nodes, (LazyLine | undefined)[]>();
    for (let line = 1; line < lines.length; line++) {
      const { chain, levels } = analysis.match(line);
      const level = levels.at(-1);
      if (level?.kind !== "lazy") continue;
      paragraphs ??= continuationLines(document);
      kept ??= keptLines(document);
      const paragraph = paragraphs.get(line);
      if (!paragraph) continue;
      const found = byParagraph.get(paragraph) ?? [];
      byParagraph.set(paragraph, found);
      found.push(
        kept.has(line) || siteLines(document, paragraph) || siteLines(document, chain[0]!)
          ? undefined
          : lazyLine(analysis, line, chain, level, levels.length - 1),
      );
    }
    const findings: Finding[] = [];
    for (const found of byParagraph.values()) {
      if (found.some((entry) => !entry)) continue;
      const hold = found.some((entry) => obsidianHold(document, entry!.chain, entry!.from));
      for (const { start, end, message, edit } of found as LazyLine[])
        findings.push(
          hold
            ? { start, end, message: `Left as written to preserve Obsidian rendering: ${message}` }
            : { start, end, message, edit },
        );
    }
    return findings;
  },
};

interface LazyLine extends Finding {
  end: number;
  edit: Edit;
  chain: Container[];
  from: number;
}
/**
 * The finding for a lazy line, or undefined when it must stay lazy: its text
 * could start a block once inside its containers, or a tab or an unknown
 * column makes its prefixes uncertain.
 */
function lazyLine(
  analysis: Analysis,
  line: number,
  chain: Container[],
  level: Level,
  from: number,
): LazyLine | undefined {
  const { source, lines } = analysis;
  const { start: lineStart, end: lineEnd } = lines[line]!;
  if (structuralTab(source, lineStart, lineEnd)) return undefined;
  let textStart = level.start;
  while (source[textStart] === " ") textStart++;
  if (!startsNoBlock(source.slice(textStart, lineEnd))) return undefined;
  let prefix = lazyPrefix(analysis, chain, from);
  if (prefix === undefined) return undefined;
  // Directly after a `>` with no space, the quote would take the first
  // space written as its own.
  if (source[level.start - 1] === ">" && level.start > lineStart) prefix = ` ${prefix}`;
  return {
    start: lineStart,
    end: lineEnd,
    message: lazyMessage(chain.slice(from)),
    edit: { start: level.start, end: textStart, text: prefix },
    chain,
    from,
  };
}

/**
 * The prefixes of the containers from `from` on in `chain`: a quote's `>`
 * indented as on its first line, with one space after it; a list item's
 * columns up to its content; four spaces for a footnote definition. Undefined
 * where a container's first line has a tab among its prefixes, or its
 * columns are not known.
 */
function lazyPrefix(analysis: Analysis, chain: Container[], from: number): string | undefined {
  const { source, lines } = analysis;
  let prefix = "";
  for (const [index, node] of chain.entries()) {
    const first = node.position!.start.line - 1;
    if (structuralTab(source, lines[first]!.start, lines[first]!.end)) return undefined;
    if (index < from) continue;
    if (node.type === "footnoteDefinition") prefix += "    ";
    else if (node.type === "listItem") {
      const width = analysis.items.get(node)?.width;
      if (width === undefined) return undefined;
      prefix += " ".repeat(width);
    } else {
      const level = analysis.match(first).levels[index];
      const marker = node.position!.start.offset!;
      if (level?.node !== node || !/^ *$/.test(source.slice(level.start, marker))) return undefined;
      prefix += `${source.slice(level.start, marker)}> `;
    }
  }
  return prefix;
}

function lazyMessage(missing: Container[]): string {
  if (missing.every((node) => node.type === "blockquote"))
    return "Add the block quote marker to the lazy continuation line.";
  if (missing.every((node) => node.type === "listItem"))
    return "Indent the lazy continuation line to the list item's content.";
  if (missing.every((node) => node.type === "footnoteDefinition"))
    return "Indent the lazy continuation line of the footnote definition.";
  return "Add the container markers and indentation to the lazy continuation line.";
}

/**
 * Whether Obsidian's Live Preview would show the line otherwise with its
 * containers' prefixes, where Reading view shows it the same. Observed in
 * Obsidian 1.14.5: a lazy line of a quote and its nested quotes that lacks
 * every `>`, and a lazy line that lacks only list items' indentation, show
 * the same; one that lacks a nested quote's `>` but has its outer quote's, a
 * quote inside a list item, and a footnote definition's lazy line do not.
 */
function obsidianHold(document: Document, chain: Container[], from: number): boolean {
  if (document.dialect !== "obsidian") return false;
  const missing = chain.slice(from);
  if (missing.every((node) => node.type === "listItem")) return false;
  return !(from === 0 && chain.every((node) => node.type === "blockquote"));
}

export const containerRules: Record<string, Rule> = {
  "style/lazy-continuation": lazyContinuation,
  "style/quote-marker": quoteMarkerRule,
};
