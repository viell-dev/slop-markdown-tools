import { walk } from "../syntax/walk.js";
import stringWidth from "string-width";
import type { Nodes } from "mdast";
import type { Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";

export function optionsSchema(properties: Record<string, unknown>) {
  return { type: "object", properties, additionalProperties: false };
}
/** Any CommonMark line ending, including a lone carriage return. */
const lineBreak = /\r\n|\r|\n/;
/** The document's line ending, taken from its first line break. */
function lineEnding(source: string): string {
  return lineBreak.exec(source)?.[0] ?? "\n";
}
function markerRule(type: "emphasis" | "strong", fallback: string): Rule {
  return {
    description: `Choose ${type} delimiters without reprinting their contents.`,
    kind: "style",
    phase: "inline",
    schema: optionsSchema({ marker: { enum: ["*", "_"] } }),
    check({ document, options }) {
      const findings: Finding[] = [];
      walk(document.tree, type, (node) => {
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
        // A new marker touching the same character, outside or inside the
        // node, would merge into one delimiter run and change the parse.
        const neighbours = [start - 1, end, start + size, end - size - 1].map(
          (index) => document.source[index],
        );
        if (neighbours.includes(marker[0]!)) return;
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

// Whitespace inside an inline node is protected; only text-node whitespace can wrap.
function wrappingAtoms(words: string[], extraOpener?: RegExp): string[] {
  const atoms: string[] = [];
  let current = "";
  for (const word of words) {
    if (/^[ \t]+$/.test(word)) {
      if (current) atoms.push(current);
      current = "";
    } else current += word;
  }
  if (current) atoms.push(current);
  // Keep atoms that would open a block or underline a Setext heading at the
  // start of a line attached to the preceding atom.
  for (let i = 1; i < atoms.length; i++) {
    if (lineOpener.test(atoms[i]!) || extraOpener?.test(atoms[i]!)) {
      atoms.splice(i - 1, 2, `${atoms[i - 1]} ${atoms[i]}`);
      i--;
    }
  }
  // An atom ending in an unescaped backslash would become a hard break at the
  // end of a line; keep it attached to the following atom.
  for (let i = 0; i < atoms.length - 1; i++) {
    if (/(?:^|[^\\])(?:\\\\)*\\$/.test(atoms[i]!)) {
      atoms.splice(i, 2, `${atoms[i]} ${atoms[i + 1]}`);
      i--;
    }
  }
  return atoms;
}
// List markers, ATX and Setext heading markers, block quotes, thematic breaks,
// fences, math, Obsidian comments, HTML blocks, and footnote definitions.
const lineOpener =
  /^(?:[-+*]|\d+[.)]|#{1,6}|>|[-*_]{3,}|-{2,}|=+|~{3,}|`{3,}|\$\$|%%|<[!?/A-Za-z]|\[\^[^\]]+\]:)/;
// Forgejo additionally opens definition descriptions with `:` and
// display math with `\[`.
// A definition description is `:` followed by at least one space or tab, so
// only a bare `:` atom could open one at the start of a reflowed line.
const forgejoLineOpener = /^(?::$|\\\[)/;

type Range = [number, number];
/** Split text at source whitespace, except inside protected source ranges. */
function splitWords(text: string, base: number, ranges: Range[]): string[] {
  if (!ranges.length) return text.split(/([ \t]+)/).filter(Boolean);
  const words: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/[ \t]+/g)) {
    const at = base + match.index;
    if (ranges.some(([from, to]) => at > from && at < to)) continue;
    if (match.index > cursor) words.push(text.slice(cursor, match.index));
    words.push(match[0]);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) words.push(text.slice(cursor));
  return words;
}
/**
 * Forgejo syntax that GFM parses as prose. A line starting with `:` and a
 * space turns the preceding lines into a definition list and `\[` opens
 * display math, so such paragraphs keep their lines. `\(...\)` math and `[[...]]`
 * shortlinks are recognized within one physical line: a pair on one line
 * becomes an unbreakable atom, and a pair split across lines, which reflow
 * could join, protects the whole paragraph.
 */
function forgejoProtections(
  source: string,
  start: number,
  end: number,
): { ranges: Range[]; reason?: string } {
  const ranges: Range[] = [];
  for (const line of source.slice(start, end).split(lineBreak)) {
    const content = line.replace(/^[ \t>]+/, "");
    if (/^:[ \t]/.test(content)) return { ranges, reason: "Forgejo definition list" };
    if (content.startsWith("\\[")) return { ranges, reason: "Forgejo display math" };
  }
  for (const [open, close] of [
    ["\\(", "\\)"],
    ["[[", "]]"],
  ] as const) {
    let from = start;
    for (;;) {
      const opener = source.indexOf(open, from);
      if (opener < 0 || opener >= end) break;
      const closer = source.indexOf(close, opener + open.length);
      if (closer < 0 || closer >= end) break;
      if (lineBreak.test(source.slice(opener, closer)))
        return { ranges, reason: `Forgejo ${open}...${close} syntax spanning lines` };
      ranges.push([opener, closer + close.length]);
      from = closer + close.length;
    }
  }
  return { ranges };
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
    // Detect the line ending once; scanning the whole source per paragraph is quadratic.
    const newline = lineEnding(document.source);
    walk(document.tree, "paragraph", (node, index, parent) => {
      const [paragraphStart, end] = range(node);
      let start = paragraphStart;
      let children = node.children;
      // A task item's paragraph range can begin at the checkbox, and its first
      // text node can begin with the separator. Wrap only the content after them.
      if (children[0]) {
        start = Math.max(start, range(children[0])[0]);
        while (start < end && /[ \t]/.test(document.source[start]!)) start++;
      }
      let original = document.source.slice(start, end);
      let calloutHeader =
        document.dialect === "obsidian" &&
        parent?.type === "blockquote" &&
        index === 0 &&
        /^\[![\w-]+\]/.test(original);
      let lineStart = start;
      while (lineStart > 0 && !/[\r\n]/.test(document.source[lineStart - 1]!)) lineStart--;
      let prefix = document.source.slice(lineStart, start);
      const continuation = prefix.replace(/(?:[-+*]|\d+[.)]|\[[xX ]\])(?=\s)/g, (value) =>
        " ".repeat(value.length),
      );
      if (calloutHeader) {
        const headerBreak = lineBreak.exec(original);
        const headerEnd = headerBreak ? start + headerBreak.index : end;
        const header = document.source.slice(start, headerEnd);
        const bodyStart = headerEnd + (headerBreak?.[0].length ?? 0) + continuation.length;
        const bodyLines = headerBreak
          ? original.slice(headerBreak.index + headerBreak[0].length).split(lineBreak)
          : [];
        const supported =
          bodyLines.every((line) => line.startsWith(continuation)) &&
          !children.some((child) => {
            const [a, b] = range(child);
            return child.type !== "text" && a < bodyStart && b > bodyStart;
          });
        // Keep unusual continuations and inline syntax spanning the boundary untouched.
        if (supported) {
          if (options.reportUnbreakable === true && measure(prefix + header) > width)
            findings.push({
              start,
              end: start + header.length,
              message: `Paragraph exceeds ${width} ${unit} because of an unbreakable atom.`,
            });
          if (!headerBreak) return;
          start = bodyStart;
          original = document.source.slice(start, end);
          children = children.filter((child) => range(child)[1] > start);
          prefix = continuation;
          calloutHeader = false;
        }
      }
      const extraOpener = document.dialect === "forgejo" ? forgejoLineOpener : undefined;
      let protectedRanges: Range[] = [];
      const reportUnbreakable = () =>
        findings.push({
          start,
          end,
          message: `Paragraph exceeds ${width} ${unit} because of an unbreakable atom.`,
        });
      const reportSkipped = (reason: string) => {
        if (options.reportUnreflowed !== true && options.reportUnbreakable !== true) return;
        let breakable = false;
        let unbreakable = false;
        let offset = start;
        let childIndex = 0;
        for (const line of original.split(/(?<=\n|\r(?!\n))/)) {
          const content = line.replace(/(?:\r\n|\r|\n)$/, "");
          const container =
            offset === start
              ? ""
              : continuation && content.startsWith(continuation)
                ? continuation
                : (content.match(/^[ \t>]+/)?.[0] ?? "");
          const linePrefix = offset === start ? prefix : container;
          // An Obsidian title occupies one physical line, even when it contains spaces.
          if (calloutHeader && offset === start) {
            if (measure(prefix + content) > width) unbreakable = true;
            offset += line.length;
            continue;
          }
          const words: string[] = [];
          while (childIndex < children.length && range(children[childIndex]!)[1] <= offset)
            childIndex++;
          for (let i = childIndex; i < children.length; i++) {
            const child = children[i]!;
            const [a, b] = range(child);
            if (a >= offset + content.length) break;
            if (child.type === "break") continue;
            const from = Math.max(a, offset + container.length);
            const raw = document.source.slice(from, Math.min(b, offset + content.length));
            if (!raw) continue;
            words.push(...(child.type === "text" ? splitWords(raw, from, protectedRanges) : [raw]));
          }
          const atoms = wrappingAtoms(words, extraOpener);
          const available = width - measure(linePrefix);
          if (measure(words.join("").trimEnd()) > available) {
            if (atoms.length > 1) breakable = true;
            if (atoms.some((atom) => measure(atom) > available)) unbreakable = true;
          }
          offset += line.length;
        }
        if (options.reportUnreflowed === true && breakable)
          findings.push({
            start,
            end,
            message: `Paragraph not reflowed: ${reason} (width ${width} ${unit}).`,
          });
        if (options.reportUnbreakable === true && unbreakable) reportUnbreakable();
      };
      const reason = children.some((child) => child.type === "break")
        ? "hard line break"
        : children.some((child) => child.type === "html")
          ? "inline HTML"
          : /^\[![^\]]+\]/.test(original)
            ? "callout header"
            : /(?:^|\s)\^[\w-]+\s*$/.test(original)
              ? "block identifier"
              : !/^[\s>\-*+\d.[\]xX)]*$/.test(prefix)
                ? "unsupported container prefix"
                : undefined;
      // Protections are computed first so that skipped paragraphs still
      // classify one-line math and shortlinks as single atoms in diagnostics.
      const protections =
        document.dialect === "forgejo"
          ? forgejoProtections(document.source, start, end)
          : { ranges: [] as Range[] };
      protectedRanges = protections.ranges;
      if (reason ?? protections.reason) {
        reportSkipped((reason ?? protections.reason)!);
        return;
      }
      const words: string[] = [];
      let unsupported = false;
      for (const child of children) {
        const [a, b] = range(child);
        const from = Math.max(a, start);
        const raw = document.source.slice(from, b);
        // Odd pieces are the line breaks, so each line's source offset is known.
        const pieces = raw.split(/(\r\n|\r|\n)/);
        const lines: string[] = [];
        let at = from;
        for (let i = 0; i < pieces.length; i += 2) {
          let line = pieces[i]!;
          let lineAt = at;
          at += line.length + (pieces[i + 1]?.length ?? 0);
          if (i > 0 && continuation && line.startsWith(continuation)) {
            line = line.slice(continuation.length);
            lineAt += continuation.length;
          } else if (i > 0 && continuation && /^[\s>]/.test(line)) unsupported = true;
          if (child.type !== "text") {
            lines.push(line);
            continue;
          }
          // Preserve escaping and entities. Split only ordinary source whitespace.
          if (i > 0) words.push(" ");
          words.push(...splitWords(line, lineAt, protectedRanges));
        }
        if (child.type !== "text") {
          if (raw.includes("\n")) unsupported = true;
          words.push(lines.join(" "));
        }
      }
      if (unsupported) {
        reportSkipped("multiline inline syntax or unsupported continuation");
        return;
      }
      const atoms = wrappingAtoms(words, extraOpener);
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
        (prefix + replacement).split(lineBreak).some((line) => measure(line) > width)
      )
        reportUnbreakable();
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
    const newline = lineEnding(document.source);
    walk(document.tree, "table", (node) => {
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
      // Keep each row's own cell count: adding cells to a short row changes the parsed table.
      const rendered = rows.map(
        (row) =>
          `| ${row.map((cell, i) => cell + " ".repeat(widths[i]! - stringWidth(cell))).join(" | ")} |`,
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
      const replacement = rendered.join(newline);
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
      walk(document.tree, "inlineCode", (node) => {
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
      if (!source || /[\r\n]$/.test(source)) return [];
      return [
        {
          start: source.length,
          message: "Add a final newline.",
          edit: { start: source.length, end: source.length, text: lineEnding(source) },
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
      walk(document.tree, "heading", (node) => {
        const [start, end] = range(node);
        if (document.source[start] === "#" || node.position!.start.column !== 1) return;
        const first = node.children[0];
        const last = node.children.at(-1);
        if (!first || !last) return;
        let text = document.source.slice(range(first)[0], range(last)[1]);
        if (/[\r\n]/.test(text)) return;
        // A trailing run of # after whitespace would become an ATX closing
        // sequence and disappear from the heading; escape its first character.
        text = text.replace(/(^|\s)(#+)$/, "$1\\$2");
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
  walk(document.tree, (node) => {
    if (node.type === type) result.push(node);
  });
  return result;
}
