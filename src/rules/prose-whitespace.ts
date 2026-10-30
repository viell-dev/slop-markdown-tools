import type { Nodes } from "mdast";
import type { Document, Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { lineBounds } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { vitepressWhitespaceLiterals } from "../syntax/vitepress/projection.js";
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

/** Merge once, then query in logarithmic time even for overlapping literals. */
function membership(ranges: Range[]): (offset: number) => boolean {
  const merged: Range[] = [];
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return (offset) => {
    let low = 0;
    let high = merged.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (merged[middle]![0] <= offset) low = middle + 1;
      else high = middle;
    }
    return low > 0 && offset < merged[low - 1]![1];
  };
}

function headings(document: Document): Range[] {
  const result: Range[] = [];
  walk(document.tree, "heading", (node) => result.push(range(node)));
  return result;
}

export const proseSpace: Rule = {
  description: "Collapses repeated spaces between words without moving line breaks.",
  kind: "style",
  phase: "inline",
  schema: optionsSchema({}),
  check({ document }) {
    const findings: Finding[] = [];
    const { source } = document;
    const heading = membership(headings(document));
    const literal = membership(vitepressWhitespaceLiterals(document));
    // Measured once per physical line, so a long line with many runs stays linear.
    let lineStart = -1;
    let lineEnd = -1;
    let prefixEnd = 0;
    let contentEnd = 0;
    for (const [from, to] of prose(document)) {
      for (const match of source.slice(from, to).matchAll(/ {2,}/g)) {
        const start = from + match.index;
        const end = start + match[0].length;
        if (literal(start)) continue;
        if (start < lineStart || start > lineEnd) {
          [lineStart, lineEnd] = lineBounds(source, start, start);
          // The longest container prefix: a run after it cannot be indentation.
          prefixEnd =
            lineStart +
            /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(
              source.slice(lineStart, lineEnd),
            )![0].length;
          contentEnd = lineEnd;
          while (contentEnd > lineStart && /\s/.test(source[contentEnd - 1]!)) contentEnd--;
        }
        // Keep physical indentation, hard breaks and whitespace next to tabs/NBSP.
        if (
          (start <= prefixEnd && containerPrefix(source.slice(lineStart, start))) ||
          end >= contentEnd ||
          /\s/.test(source[start - 1] ?? "") ||
          /\s/.test(source[end] ?? "")
        )
          continue;
        findings.push({
          start,
          end,
          message: "Use one space between prose words.",
          ...(heading(start) ? {} : { edit: { start, end, text: " " } }),
        });
      }
    }
    return findings;
  },
};

export const noTabs: Rule = {
  description: "Reports tabs, and replaces those in prose with spaces.",
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
    const literal: Range[] = [...headings(document), ...vitepressWhitespaceLiterals(document)];
    const ignored: Range[] = [];
    const languages = new Set(
      ((options.ignoredCodeLanguages as string[] | undefined) ?? []).map((lang) =>
        lang.toLowerCase(),
      ),
    );
    walk(document.tree, (node) => {
      if (
        ["code", "inlineCode", "math", "inlineMath", "html", "yaml", "toml"].includes(node.type)
      ) {
        let [start, end] = range(node);
        if (node.type === "code") {
          [start, end] = lineBounds(source, start, end);
          if (options.codeBlocks === false || languages.has((node.lang ?? "").toLowerCase())) {
            ignored.push([start, end]);
          }
        }
        if (node.type === "inlineCode" && options.codeBlocks === false) ignored.push([start, end]);
        literal.push([start, end]);
      }
    });
    const inText = membership(text);
    const inLiteral = membership(literal);
    const inIgnored = membership(ignored);
    const findings: Finding[] = [];
    let lineStart = 0;
    let column = 0;
    let leading = true;
    let prefixEnd = 0;
    let contentEnd = 0;
    let measuredLine = -1;
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
        if (measuredLine !== lineStart) {
          measuredLine = lineStart;
          const end = lineBounds(source, start, start)[1];
          const line = source.slice(lineStart, end);
          prefixEnd =
            lineStart + /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(line)![0].length;
          contentEnd = end;
          while (contentEnd > lineStart && /\s/.test(source[contentEnd - 1]!)) contentEnd--;
        }
        if (!inIgnored(start)) {
          let replacement: string | undefined;
          if (!inLiteral(start)) {
            if (leading && document.dialect !== "obsidian") replacement = " ".repeat(width);
            else if (!leading && inText(start) && start >= prefixEnd && start + 1 < contentEnd) {
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
