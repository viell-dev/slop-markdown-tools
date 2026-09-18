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
  description: "Reflow paragraphs using configurable width and protected inline atoms.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({
    width: { type: "integer", minimum: 20, maximum: 500 },
    measure: { enum: ["columns", "codepoints"] },
    reportUnreflowed: { type: "boolean" },
    reportUnbreakable: { type: "boolean" },
  }),
  check({ document, options, workspace }) {
    if (document.dialect === "obsidian" && workspace?.strictLineBreaks !== true) return [];
    const findings: Finding[] = [];
    const width = Number(options.width ?? 80);
    const measure =
      options.measure === "codepoints" ? (text: string) => [...text].length : stringWidth;
    const unit = options.measure === "codepoints" ? "code points" : "columns";
    visit(document.tree, "paragraph", (node) => {
      const [start, end] = range(node);
      const original = document.source.slice(start, end);
      const lineStart = document.source.lastIndexOf("\n", start - 1) + 1;
      const prefix = document.source.slice(lineStart, start);
      const reportSkipped = (reason: string) => {
        if (
          options.reportUnreflowed === true &&
          (prefix + original).split(/\r?\n/).some((line) => measure(line) > width)
        )
          findings.push({
            start,
            end,
            message: `Paragraph not reflowed: ${reason} (width ${width} ${unit}).`,
          });
      };
      const reason = node.children.some((child) => child.type === "break")
        ? "hard line break"
        : node.children.some((child) => child.type === "html")
          ? "inline HTML"
          : /^\[![^\]]+\]/.test(original)
            ? "callout header"
            : /(?:^|\s)\^[\w-]+\s*$/.test(original)
              ? "block identifier"
              : !/^[\s>\-*+\d.[\]xX)]*$/.test(prefix)
                ? "unsupported container prefix"
                : undefined;
      if (reason) {
        reportSkipped(reason);
        return;
      }
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
          if (raw.includes("\n")) unsupported = true;
          words.push(value);
        }
      }
      if (unsupported) {
        reportSkipped("multiline inline syntax or unsupported continuation");
        return;
      }
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
      // Decide breaks with a marker and its preceding atom already grouped.
      for (let i = 1; i < atoms.length; i++) {
        if (/^(?:[-+*]|\d+[.)]|#{1,6}|>|[-*_]{3,})$/.test(atoms[i]!)) {
          atoms.splice(i - 1, 2, `${atoms[i - 1]} ${atoms[i]}`);
          i--;
        }
      }
      const output: string[] = [];
      let line = "";
      let available = width - measure(prefix);
      for (const atom of atoms) {
        const candidate = line ? `${line} ${atom}` : atom;
        if (line && measure(candidate) > available) {
          output.push(line);
          line = atom;
          available = width - measure(continuation);
        } else line = candidate;
      }
      if (line) output.push(line);
      const newline = document.source.includes("\r\n") ? "\r\n" : "\n";
      const replacement = output.join(newline + continuation);
      if (replacement !== original)
        findings.push({
          start,
          end,
          message: `Reflow paragraph to ${width} ${unit}.`,
          edit: { start, end, text: replacement },
        });
      if (
        options.reportUnbreakable === true &&
        (prefix + replacement).split(/\r?\n/).some((line) => measure(line) > width)
      )
        findings.push({
          start,
          end,
          message: `Paragraph exceeds ${width} ${unit} because of an unbreakable atom.`,
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
  "style/inline-code": {
    description: "Join multiline code spans using their CommonMark rendered value.",
    kind: "style",
    phase: "inline",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      visit(document.tree, "inlineCode", (node) => {
        const [start, end] = range(node);
        if (!/[\r\n]/.test(document.source.slice(start, end))) return;
        const value = node.value.replace(/\r\n|\r|\n/g, " ");
        const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
        const marker = "`".repeat(longest + 1);
        const pad = /^`|`$/.test(value) || (/^ .* $/.test(value) && /[^ ]/.test(value)) ? " " : "";
        findings.push({
          start,
          end,
          message: "Join the code span onto one line.",
          edit: { start, end, text: `${marker}${pad}${value}${pad}${marker}` },
        });
      });
      return findings;
    },
  },
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
