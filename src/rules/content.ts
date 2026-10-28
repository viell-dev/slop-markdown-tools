import { walk } from "../syntax/walk.js";
import type { Html } from "mdast";
import type { Dialect, Document, Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { tableContainerBoundary } from "../syntax/site-generator.js";
import { lineStarts } from "../syntax/source.js";
import { htmlAttribute, htmlFlow, htmlTokens, rawText } from "../workspace/html.js";
import type { HtmlToken } from "../workspace/html.js";
import { optionsSchema } from "./shared.js";

/** `|100` or `|100x50` at the end of an Obsidian image's text sets its size, not its text. */
const obsidianSize = /\|\d+(?:x\d+)?$/;

/**
 * Whether an HTML `<img>` start tag gives alternative text or hides the image
 * from assistive technology: any `alt` attribute, `alt=""` included, which
 * marks a decorative image, or `aria-hidden="true"`. GitHub's sanitizer removes
 * `aria-hidden` and keeps `alt`, as its Markdown API showed on 2026-10-28;
 * Forgejo 16.0.6 and Gitea 28.2.0 keep both. In VitePress, Vue can bind `alt`
 * (`:alt`, `v-bind:alt`) or spread an object of attributes (`v-bind`).
 */
function describedImage(attributes: string, dialect: Dialect): boolean {
  const names = dialect === "vitepress" ? ["alt", ":alt", "v-bind:alt", "v-bind"] : ["alt"];
  if (names.some((name) => htmlAttribute(attributes, name) !== undefined)) return true;
  return (
    dialect !== "github" &&
    htmlAttribute(attributes, "aria-hidden")?.trim().toLowerCase() === "true"
  );
}

/**
 * The source offset of an offset in a raw HTML node's value. Inside a block
 * quote or list item the value leaves out each line's container prefix, which
 * the source line keeps before it; a line that cannot be matched maps to the
 * node's start.
 */
function sourceOffset(document: Document, node: Html, offset: number): number {
  const [start, end] = range(node);
  const raw = document.source.slice(start, end);
  if (raw === node.value) return start + offset;
  const valueStarts = lineStarts(node.value);
  const rawStarts = lineStarts(raw);
  let line = valueStarts.length - 1;
  while (line > 0 && valueStarts[line]! > offset) line--;
  const lineText = (text: string, starts: number[]) =>
    text.slice(starts[line], starts[line + 1] ?? text.length).replace(/[\r\n]+$/, "");
  const valueLine = lineText(node.value, valueStarts);
  const rawLine = lineText(raw, rawStarts);
  if (rawStarts[line] === undefined || !rawLine.endsWith(valueLine)) return start;
  return start + rawStarts[line]! + rawLine.length - valueLine.length + offset - valueStarts[line]!;
}

export const contentRules: Record<string, Rule> = {
  "content/image-alt": {
    description: "Report images, Markdown or HTML, without alternative text.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      // Obsidian's `![[image.png]]` embeds are wikilinks, which have no place for the text.
      walk(document.tree, (node) => {
        if (node.type !== "image" && node.type !== "imageReference") return;
        let alt = node.alt ?? "";
        if (document.dialect === "obsidian") alt = alt.replace(obsidianSize, "");
        if (alt.trim()) return;
        const [start, end] = range(node);
        findings.push({
          start,
          end,
          message: "Add alternative text to the image, for readers who cannot see it.",
        });
      });
      // GitHub's tag filter shows raw-text start tags such as `<textarea>` as
      // text, so the HTML after them is read as elements.
      const raw = document.dialect !== "github";
      const report = (node: Html, token: HtmlToken & { name: string }) => {
        if (
          token.name !== "img" ||
          token.close ||
          describedImage(token.attributes, document.dialect)
        )
          return;
        findings.push({
          start: sourceOffset(document, node, token.start),
          end: sourceOffset(document, node, token.end),
          message:
            'Add an alt attribute to the HTML image, for readers who cannot see it, or alt="" if it is decorative.',
        });
      };
      walk(document.tree, (node, _index, parent) => {
        if (node.type === "html" && htmlFlow(node, parent)) {
          for (const token of htmlTokens(node.value, { rawText: raw }))
            if (token.name !== undefined) report(node, token);
          return;
        }
        if (node.type !== "paragraph" && node.type !== "heading" && node.type !== "tableCell")
          return;
        // Each inline HTML node is one tag, comment, or declaration; a raw-text
        // element's content runs to its end tag, across the text between them.
        let inside: string | undefined;
        walk(node, "html", (html) => {
          for (const token of htmlTokens(html.value, { rawText: false })) {
            if (token.name === undefined) continue;
            if (inside !== undefined) {
              if (token.close && token.name === inside) inside = undefined;
              continue;
            }
            if (raw && !token.close && rawText.has(token.name)) inside = token.name;
            else report(html, token);
          }
        });
      });
      return findings;
    },
  },
  "content/table-columns": {
    description: "Report table rows with more or fewer cells than the header row.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      walk(document.tree, "table", (node) => {
        const boundary = tableContainerBoundary(document.source, node);
        const [header, ...rows] = boundary < 0 ? node.children : node.children.slice(0, boundary);
        const columns = header?.children.length ?? 0;
        for (const row of rows) {
          const cells = row.children.length;
          if (cells === columns) continue;
          const [start, end] = range(row);
          const counted = `Row has ${cells} ${cells === 1 ? "cell" : "cells"} and the header ${columns}`;
          findings.push({
            start,
            end,
            message:
              cells > columns
                ? `${counted}; ${cells - columns === 1 ? "the extra cell is" : "the extra cells are"} not shown.`
                : `${counted}; the row is shown with ${columns - cells === 1 ? "an empty cell" : "empty cells"} added.`,
          });
        }
      });
      return findings;
    },
  },
  "content/code-language": {
    description: "Check fenced code block languages and their info strings.",
    kind: "problem",
    schema: optionsSchema({
      allowedLanguages: { type: "array", items: { type: "string", minLength: 1 }, default: [] },
      languageOnly: { type: "boolean", default: false },
    }),
    check({ document, options }) {
      const languages = (options.allowedLanguages as string[] | undefined) ?? [];
      const allowed = languages.length ? new Set(languages) : undefined;
      const findings: Finding[] = [];
      walk(document.tree, "code", (node) => {
        const [start] = range(node);
        // An indented code block starts with its indentation, and has no place for a language.
        const fence = document.source[start];
        if (
          (node.lang && (!allowed || allowed.has(node.lang)) && !options.languageOnly) ||
          (fence !== "`" && fence !== "~")
        )
          return;
        let end = start;
        while (document.source[end] === fence) end++;
        const marker = document.source.slice(start, end);
        if (!node.lang) {
          findings.push({
            start,
            end,
            message: `Name the code block's language after its opening fence, such as ${marker}sh, or ${marker}text for plain text.`,
          });
          return;
        }
        let infoEnd = end;
        while (
          infoEnd < document.source.length &&
          document.source[infoEnd] !== "\r" &&
          document.source[infoEnd] !== "\n"
        )
          infoEnd++;
        const info = document.source.slice(end, infoEnd);
        if (allowed && !allowed.has(node.lang)) {
          const name = /\S+/u.exec(info);
          const at = end + (name?.index ?? 0);
          findings.push({
            start: at,
            end: at + (name?.[0].length ?? info.length),
            message: `Code language "${node.lang}" is not allowed by allowedLanguages.`,
          });
        }
        if (
          options.languageOnly &&
          (!/^\S+$/u.test(info) || (document.dialect === "vitepress" && info !== node.lang))
        ) {
          findings.push({
            start: end,
            end: infoEnd,
            message:
              "Use only the language name in the code fence's info string, without surrounding whitespace.",
          });
        }
      });
      return findings;
    },
  },
};
