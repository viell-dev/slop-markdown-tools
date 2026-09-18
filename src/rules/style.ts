import { visit } from "unist-util-visit";
import stringWidth from "string-width";
import type { Nodes } from "mdast";
import type { Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";

export function optionsSchema(properties: Record<string, unknown>) {
  return { type: "object", properties, additionalProperties: false };
}
function markerRule(type: "emphasis" | "strong", fallback: string): Rule {
  return {
    description: `Choose ${type} delimiters without reprinting their contents.`,
    kind: "style",
    phase: "inline",
    schema: optionsSchema({ marker: { enum: ["*", "_"] } }),
    check({ document, options }) {
      const findings: Finding[] = [];
      visit(document.tree, type, (node) => {
        const [start, end] = range(node);
        const size = type === "strong" ? 2 : 1;
        const marker = String(options.marker ?? fallback).repeat(size);
        const original = document.source.slice(start, end);
        if (original.startsWith(marker)) return;
        // Underscores cannot delimit intraword emphasis. Preserve these valid forms.
        if (
          marker.startsWith("_") &&
          (/\p{L}|\p{N}/u.test(document.source[start - 1] ?? "") ||
            /\p{L}|\p{N}/u.test(document.source[end] ?? ""))
        )
          return;
        for (const [a, b] of [
          [start, start + size],
          [end - size, end],
        ] as const) {
          findings.push({
            start: a,
            end: b,
            message: `Use ${JSON.stringify(marker)} for ${type}.`,
            edit: { start: a, end: b, text: marker },
          });
        }
      });
      return findings;
    },
  };
}

const wrap: Rule = {
  description: "Reflow paragraphs using display-column width and protected inline atoms.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({ width: { type: "integer", minimum: 20, maximum: 500 } }),
  check({ document, options, workspace }) {
    if (document.dialect === "obsidian" && workspace?.strictLineBreaks !== true) return [];
    const findings: Finding[] = [];
    const width = Number(options.width ?? 100);
    visit(document.tree, "paragraph", (node) => {
      const [start, end] = range(node);
      const original = document.source.slice(start, end);
      // Explicit breaks, callout headers, block IDs, multiline opaque syntax, and HTML are protected.
      if (
        node.children.some((child) => child.type === "break" || child.type === "html") ||
        /^\[![^\]]+\]/.test(original) ||
        /(?:^|\s)\^[\w-]+\s*$/.test(original)
      )
        return;
      const lineStart = document.source.lastIndexOf("\n", start - 1) + 1;
      const prefix = document.source.slice(lineStart, start);
      if (!/^[\s>\-*+\d.[\]xX)]*$/.test(prefix)) return;
      const continuation = prefix.replace(/(?:[-+*]|\d+[.)]|\[[xX ]\])(?=\s)/g, (value) =>
        " ".repeat(value.length),
      );
      const words: string[] = [];
      let unsupported = false;
      for (const child of node.children) {
        const [a, b] = range(child);
        const raw = document.source.slice(a, b);
        const lines = raw.split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i]!;
          if (continuation && line.startsWith(continuation))
            lines[i] = line.slice(continuation.length);
          else if (continuation && /^[\s>]/.test(line)) unsupported = true;
        }
        const value = lines.join(" ");
        if (child.type === "text") {
          // Preserve escaping and entities. Split only ordinary source whitespace.
          words.push(...value.split(/([ \t]+)/).filter(Boolean));
        } else {
          if (raw.includes("\n") && child.type !== "inlineCode") unsupported = true;
          words.push(value);
        }
      }
      if (unsupported) return;
      // Adjacent inline nodes without source whitespace form a single wrapping atom.
      const atoms: string[] = [];
      let current = "";
      for (const word of words) {
        if (/^[ \t]+$/.test(word)) {
          if (current) atoms.push(current);
          current = "";
        } else current += word;
      }
      if (current) atoms.push(current);
      const output: string[] = [];
      let line = "";
      let available = width - stringWidth(prefix);
      for (const atom of atoms) {
        const candidate = line ? `${line} ${atom}` : atom;
        // Never introduce a Markdown block by placing its marker at a physical line start.
        const marker = /^(?:[-+*]|\d+[.)]|#{1,6}|>|[-*_]{3,})$/.test(atom);
        if (line && stringWidth(candidate) > available && !marker) {
          output.push(line);
          line = atom;
          available = width - stringWidth(continuation);
        } else line = candidate;
      }
      if (line) output.push(line);
      const newline = document.source.includes("\r\n") ? "\r\n" : "\n";
      const replacement = output.join(newline + continuation);
      if (replacement !== original)
        findings.push({
          start,
          end,
          message: `Reflow paragraph to ${width} columns.`,
          edit: { start, end, text: replacement },
        });
    });
    return findings;
  },
};

const table: Rule = {
  description: "Align GFM table cells while preserving their inline source.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({}),
  check({ document }) {
    const findings: Finding[] = [];
    visit(document.tree, "table", (node) => {
      const [start, end] = range(node);
      // Nested tables retain container prefixes until a dedicated container printer handles them.
      if (node.position!.start.column !== 1) return;
      const rows = node.children.map((row) =>
        row.children.map((cell) => {
          if (!cell.children.length) return "";
          const first = range(cell.children[0]!)[0];
          const last = range(cell.children.at(-1)!)[1];
          return document.source.slice(first, last);
        }),
      );
      const count = node.align?.length ?? rows[0]?.length ?? 0;
      if (rows.some((row) => row.length > count)) return;
      const widths = Array.from({ length: count }, (_, i) =>
        Math.max(3, ...rows.map((row) => stringWidth(row[i] ?? ""))),
      );
      const rendered = rows.map(
        (row) =>
          `| ${widths.map((width, i) => (row[i] ?? "") + " ".repeat(width - stringWidth(row[i] ?? ""))).join(" | ")} |`,
      );
      rendered.splice(
        1,
        0,
        `| ${widths
          .map((width, i) => {
            const align = node.align?.[i];
            return (
              (align === "left" || align === "center" ? ":" : "-") +
              "-".repeat(width - 2) +
              (align === "right" || align === "center" ? ":" : "-")
            );
          })
          .join(" | ")} |`,
      );
      const replacement = rendered.join(document.source.includes("\r\n") ? "\r\n" : "\n");
      if (replacement !== document.source.slice(start, end))
        findings.push({
          start,
          end,
          message: "Align table cells.",
          edit: { start, end, text: replacement },
        });
    });
    return findings;
  },
};

export const styleRules: Record<string, Rule> = {
  "style/wrap": wrap,
  "style/emphasis": markerRule("emphasis", "_"),
  "style/strong": markerRule("strong", "*"),
  "style/table": table,
  "style/final-newline": {
    description: "End nonempty documents with a newline.",
    kind: "style",
    phase: "document",
    schema: optionsSchema({}),
    check({ document: { source } }) {
      if (!source || source.endsWith("\n")) return [];
      return [
        {
          start: source.length,
          message: "Add a final newline.",
          edit: {
            start: source.length,
            end: source.length,
            text: source.includes("\r\n") ? "\r\n" : "\n",
          },
        },
      ];
    },
  },
  "style/heading": {
    description: "Use ATX headings.",
    kind: "style",
    phase: "block",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      visit(document.tree, "heading", (node) => {
        const [start, end] = range(node);
        if (document.source[start] === "#" || node.position!.start.column !== 1) return;
        const first = node.children[0];
        const last = node.children.at(-1);
        if (!first || !last) return;
        const text = document.source.slice(range(first)[0], range(last)[1]);
        if (text.includes("\n")) return;
        findings.push({
          start,
          end,
          message: "Use an ATX heading.",
          edit: { start, end, text: `${"#".repeat(node.depth)} ${text}` },
        });
      });
      return findings;
    },
  },
};

/** Collect source-positioned nodes for rule/plugin consumers. */
export function nodesOfType(
  document: { tree: import("mdast").Root },
  type: Nodes["type"],
): Nodes[] {
  const result: Nodes[] = [];
  visit(document.tree, (node) => {
    if (node.type === type) result.push(node);
  });
  return result;
}
