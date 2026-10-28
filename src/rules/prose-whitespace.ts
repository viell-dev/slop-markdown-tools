import type { Nodes } from "mdast";
import type { Document, Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { lineBounds } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { holds, inlineBlocks, optionsSchema, type Range } from "./shared.js";

/** Text leaves only: source delimiters, destinations, code and formulas stay literal.
 * Inline HTML can change whitespace display throughout its enclosing block.
 */
function prose(document: Document): Range[] {
  const result: Range[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === "text") {
      result.push(range(node));
      return;
    }
    if (
      node.type === "table" ||
      node.type === "image" ||
      node.type === "imageReference" ||
      (inlineBlocks.has(node.type) && holds(node, "html"))
    )
      return;
    if ("children" in node) node.children.forEach(visit);
  };
  visit(document.tree);
  return result;
}

/** A physical container prefix is indentation, even inside a multiline text range. */
function containerPrefix(text: string): boolean {
  return /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?$/.test(text);
}

export const proseSpace: Rule = {
  description: "Collapse repeated prose spaces without moving line breaks.",
  kind: "style",
  phase: "inline",
  schema: optionsSchema({}),
  check({ document }) {
    const findings: Finding[] = [];
    const { source } = document;
    for (const [from, to] of prose(document)) {
      for (const match of source.slice(from, to).matchAll(/ {2,}/g)) {
        const start = from + match.index;
        const end = start + match[0].length;
        // Keep physical indentation, hard breaks and whitespace next to tabs/NBSP.
        const [lineStart, lineEnd] = lineBounds(source, start, end);
        if (
          containerPrefix(source.slice(lineStart, start)) ||
          !/\S/.test(source.slice(end, lineEnd)) ||
          /\s/.test(source[start - 1] ?? "") ||
          /\s/.test(source[end] ?? "")
        )
          continue;
        findings.push({
          start,
          end,
          message: "Use one space between prose words.",
          edit: { start, end, text: " " },
        });
      }
    }
    return findings;
  },
};

export const noTabs: Rule = {
  description: "Report tabs and replace them where whitespace is not literal content.",
  kind: "style",
  phase: "inline",
  schema: optionsSchema({
    codeBlocks: { type: "boolean" },
    ignoredCodeLanguages: { type: "array", items: { type: "string" }, uniqueItems: true },
    spacesPerTab: { type: "integer", minimum: 0 },
  }),
  check({ document, options }) {
    const { source } = document;
    const text = prose(document);
    const literal: Range[] = [];
    const ignored: Range[] = [];
    walk(document.tree, (node) => {
      if (
        ["code", "inlineCode", "math", "inlineMath", "html", "yaml", "toml"].includes(node.type)
      ) {
        let [start, end] = range(node);
        if (node.type === "code") {
          [start, end] = lineBounds(source, start, end);
          if (
            options.codeBlocks === false ||
            (options.ignoredCodeLanguages as string[] | undefined)?.includes(node.lang ?? "")
          ) {
            ignored.push([start, end]);
          }
        }
        if (node.type === "inlineCode" && options.codeBlocks === false) ignored.push([start, end]);
        literal.push([start, end]);
      }
    });
    const contains = (ranges: Range[], offset: number) =>
      ranges.some(([a, b]) => a <= offset && offset < b);
    const findings: Finding[] = [];
    let lineStart = 0;
    let column = 0;
    let leading = true;
    for (let start = 0; start < source.length; start++) {
      const char = source[start];
      if (char === "\n" || char === "\r") {
        lineStart = start + 1;
        column = 0;
        leading = true;
        continue;
      }
      if (char === "\t") {
        const width = 4 - (column % 4);
        if (!contains(ignored, start)) {
          let replacement: string | undefined;
          if (!contains(literal, start)) {
            if (leading && document.dialect !== "obsidian") replacement = " ".repeat(width);
            else if (
              !leading &&
              contains(text, start) &&
              !containerPrefix(source.slice(lineStart, start)) &&
              /\S/.test(source.slice(start + 1, lineBounds(source, start, start)[1]))
            ) {
              const count = (options.spacesPerTab as number | undefined) ?? 1;
              // Deleting a separator must not join words.
              if (count > 0 || source[start - 1] === " " || source[start + 1] === " ")
                replacement = " ".repeat(count);
            }
          }
          findings.push({
            start,
            end: start + 1,
            message: "Replace the tab with spaces.",
            ...(replacement === undefined
              ? {}
              : { edit: { start, end: start + 1, text: replacement } }),
          });
        }
        column += width;
      } else {
        column++;
        if (char !== " ") leading = false;
      }
    }
    return findings;
  },
};
