import type { Definition } from "mdast";
import type { Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { escaped } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { changesForgeHeading } from "../workspace/heading-attributes.js";
import { optionsSchema } from "./shared.js";

const definitionLabel = /^\[(?:\\[\s\S]|[^\]\\])*\]:/;

/** The positioned parser represents an explicit empty title as null too. */
function emptyTitle(raw: string, definition: boolean): boolean {
  const suffix = (
    definition ? /[ \t\r\n](?:""|''|\(\))[ \t]*$/ : /[ \t\r\n](?:""|''|\(\))[ \t\r\n]*\)$/
  ).exec(raw);
  if (!suffix) return false;
  // A destination may itself be '' or (). Require a preceding destination,
  // including <> for an empty URL, before recognizing the final empty token.
  const start = definition
    ? definitionLabel.exec(raw)?.[0].length
    : raw.lastIndexOf("](", suffix.index) + 2;
  return start !== undefined && start > 0 && raw.slice(start, suffix.index).trim().length > 0;
}

/** The title is the final delimited token, not a quoted part of the destination. */
function titleRange(raw: string, definition: boolean): [number, number] | undefined {
  let end = raw.length;
  while (end && /\s/.test(raw[end - 1]!)) end--;
  if (!definition) end--; // The inline link's closing parenthesis.
  while (end && /\s/.test(raw[end - 1]!)) end--;
  const close = raw[end - 1];
  const open = close === ")" ? "(" : close;
  if (open !== '"' && open !== "'" && open !== "(") return;
  for (let i = end - 2; i >= 0; i--) {
    if (raw[i] === open && !escaped(raw, i)) return [i, end];
  }
  return;
}

export const linkTitle: Rule = {
  description: "Writes link and image titles with one kind of delimiter, double quotes by default.",
  kind: "style",
  phase: "inline",
  schema: optionsSchema({ delimiter: { enum: ["double", "single", "parentheses", "consistent"] } }),
  check({ document, options }) {
    const findings: Finding[] = [];
    let preferred =
      options.delimiter === "consistent" ? undefined : (options.delimiter ?? "double");
    walk(document.tree, (node) => {
      if (node.type !== "link" && node.type !== "image" && node.type !== "definition") return;
      const [start, end] = range(node);
      const raw = document.source.slice(start, end);
      if (node.title == null && !emptyTitle(raw, node.type === "definition")) return;
      // commonmark.js leaves a definition with a tab as visible source, where
      // other renderers read a definition. Changing even just delimiters would
      // change that text.
      if (node.type === "definition" && raw.includes("\t")) return;
      const span = titleRange(raw, node.type === "definition");
      if (!span) return;
      const [a, b] = span;
      const current = raw[a] === '"' ? "double" : raw[a] === "'" ? "single" : "parentheses";
      preferred ??= current;
      if (current === preferred) return;
      const open = preferred === "double" ? '"' : preferred === "single" ? "'" : "(";
      const close = preferred === "parentheses" ? ")" : open;
      const body = raw.slice(a + 1, b - 1);
      // Prefer the existing delimiter to adding escapes. Existing escapes and
      // entities stay byte-for-byte intact, including escaped old delimiters.
      for (let i = 0; i < body.length; i++) {
        if ((body[i] === open || body[i] === close) && !escaped(body, i)) return;
      }
      if (changesForgeHeading(document, start + a, start + b)) return;
      findings.push({
        start: start + a,
        end: start + b,
        message: "Use the configured title delimiters.",
        edit: { start: start + a, end: start + b, text: open + body + close },
      });
    });
    return findings;
  },
};

/** Locate just the separators, without reconstructing a destination or label. */
function separators(raw: string, node: Definition): [number, number][] {
  // Multiline definitions keep their lines. commonmark.js 0.31.2 reads a
  // definition separated by a tab as text, where GitHub, markdown-it and the
  // positioned parser read a definition, so replacing the tab would change
  // that reading.
  if (/[\t\r\n]/.test(raw)) return [];
  const label = definitionLabel.exec(raw);
  if (!label || label[0].startsWith("[^")) return [];
  const result: [number, number][] = [];
  // No space at all, as in `[a]:https://example.com`, is a definition for
  // GitHub, commonmark.js, markdown-it and the positioned parser alike, so the
  // separator may be inserted. Lines are never joined: `raw` has none.
  const after = /^ */.exec(raw.slice(label[0].length))![0];
  result.push([label[0].length, label[0].length + after.length]);
  if (node.title != null || emptyTitle(raw, true)) {
    const title = titleRange(raw, true);
    if (title) {
      let a = title[0];
      while (a && /[ \t]/.test(raw[a - 1]!)) a--;
      if (a > 0 && !/[\r\n]/.test(raw[a - 1]!)) result.push([a, title[0]]);
    }
  }
  return result;
}

export const definitionSpacing: Rule = {
  description: "Writes one space after a link reference definition's colon and before its title.",
  kind: "style",
  phase: "inline",
  schema: optionsSchema({}),
  check({ document }) {
    // Live Preview gives tabs and multiline/nested labels their own reading.
    // Keep Obsidian definitions intact, as style/wrap does for these lines.
    if (document.dialect === "obsidian") return [];
    const findings: Finding[] = [];
    walk(document.tree, "definition", (node) => {
      const [start, end] = range(node);
      const raw = document.source.slice(start, end);
      for (const [a, b] of separators(raw, node)) {
        if (raw.slice(a, b) === " ") continue;
        findings.push({
          start: start + a,
          end: start + b,
          message: "Use one space between reference definition parts.",
          edit: { start: start + a, end: start + b, text: " " },
        });
      }
    });
    return findings;
  },
};
