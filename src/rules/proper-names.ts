import type { Nodes } from "mdast";
import type { Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { holds, optionsSchema } from "./shared.js";

/** Addresses are masked before matching names, including opaque and protocol-relative URLs. */
const urls =
  /(?<![a-z\d+.-])(?:[a-z][a-z\d+.-]*:|\/\/|www\.)[^\s<>]+|(?<![\w.+-])[\w.+-]+@[\w.-]+\.[a-z]+/giu;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const properNames: Rule = {
  description: "Report other capitalization of configured proper names in prose.",
  kind: "problem",
  schema: optionsSchema({
    names: { type: "array", items: { type: "string", minLength: 1 }, default: [] },
    codeBlocks: { type: "boolean", default: false },
    htmlElements: { type: "boolean", default: true },
  }),
  check({ document, options }) {
    const names = (options.names as string[] | undefined) ?? [];
    if (!names.length) return [];
    const allowed = new Set(names);
    const spellings = new Map<string, string[]>();
    const fold = (text: string) => text.toUpperCase().toLowerCase();
    for (const name of names) {
      const key = fold(name);
      spellings.set(key, [...(spellings.get(key) ?? []), name]);
    }
    const pattern = new RegExp(
      "(?<![\\p{L}\\p{M}\\p{N}\\p{Pc}])(?:" +
        [...names]
          .sort((a, b) => b.length - a.length)
          .map(escape)
          .join("|") +
        ")(?![\\p{L}\\p{M}\\p{N}\\p{Pc}])",
      "giu",
    );
    const findings: Finding[] = [];
    let text = "";
    // Each character's source span. Decoded text, such as an entity or an escape,
    // maps to its whole node, since its characters have no single source offset.
    let starts: number[] = [];
    let ends: number[] = [];
    let literalHtml: string | undefined;
    const append = (value: string, start: number, exact: boolean, spanEnd: number) => {
      text += value;
      for (let i = 0; i < value.length; i++) {
        starts.push(exact ? start + i : start);
        ends.push(exact ? start + i + 1 : spanEnd);
      }
    };
    const flush = () => {
      // Mask addresses once per prose run, before matching any configured name.
      const prose = text.replace(urls, (url) => " ".repeat(url.length));
      for (const match of prose.matchAll(pattern)) {
        const at = match.index;
        const end = at + match[0].length;
        if (allowed.has(match[0])) continue;
        findings.push({
          start: starts[at]!,
          end: ends[end - 1]!,
          message: `Use the configured capitalization ${spellings
            .get(fold(match[0]))!
            .map((name) => JSON.stringify(name))
            .join(" or ")} instead of ${JSON.stringify(match[0])}.`,
        });
      }
      text = "";
      starts = [];
      ends = [];
    };
    const visit = (node: Nodes): void => {
      const [start, end] = range(node);
      const raw = document.source.slice(start, end);
      if (node.type === "text" || node.type === "obsidianHighlight") {
        if (!literalHtml) append(node.value, start, raw === node.value, end);
      } else if (node.type === "image" || node.type === "imageReference") {
        flush();
        append(node.alt ?? "", start + 2, raw.slice(2).startsWith(node.alt ?? ""), end);
        flush();
      } else if (node.type === "wikiLink") {
        flush();
        // Unaliased targets remain addresses, including embeds.
        if (node.label) append(node.label, start + raw.indexOf("|") + 1, true, end);
        flush();
      } else if (node.type === "code") {
        flush();
        if (options.codeBlocks === true) {
          // The body starts after the opening fence's line break, of any kind.
          const opening = /^(?:`{3,}|~{3,})/.test(raw) ? /\r\n|\r|\n/.exec(raw) : null;
          let cursor = opening ? opening.index + opening[0].length : 0;
          for (const line of node.value.split("\n")) {
            const at = raw.indexOf(line, cursor);
            append(line, start + Math.max(cursor, at), at >= 0, end);
            cursor = Math.max(cursor, at) + line.length;
            append("\n", start + cursor, true, end);
            if (raw[cursor] === "\r") cursor++;
            if (raw[cursor] === "\n") cursor++;
          }
          flush();
        }
      } else if (node.type === "html") {
        if (options.htmlElements !== false) {
          // Read tags whole, including > inside quoted attribute values. Keep
          // literal-element state across separate inline HTML and text nodes.
          let copied = 0;
          for (const tag of raw.matchAll(/<!--[\s\S]*?(?:-->|$)|<(?:[^<>"']|"[^"]*"|'[^']*')*>/g)) {
            if (!literalHtml) append(raw.slice(copied, tag.index), start + copied, true, end);
            const name = /^<(\/?)([a-z][\w-]*)/i.exec(tag[0]);
            // A skipped element's body ends the prose run on both sides, so a name
            // cannot match across it, as in `Java<code>…</code>Script`.
            if (name?.[1] && name[2]?.toLowerCase() === literalHtml) {
              literalHtml = undefined;
              flush();
            } else if (
              !literalHtml &&
              !name?.[1] &&
              /^(?:script|style|code|pre)$/i.test(name?.[2] ?? "")
            ) {
              flush();
              literalHtml = name![2]!.toLowerCase();
            }
            copied = tag.index + tag[0].length;
          }
          if (!literalHtml) append(raw.slice(copied), start + copied, true, end);
        } else flush();
      } else if (node.type === "link" && !raw.startsWith("[")) {
        flush();
      } else if ("children" in node) {
        const block = [
          "root",
          "paragraph",
          "heading",
          "tableCell",
          "blockquote",
          "listItem",
        ].includes(node.type);
        if (block) flush();
        // Disabling HTML checks conservatively skips an inline HTML block's prose.
        if (
          options.htmlElements !== false ||
          !["paragraph", "heading", "tableCell"].includes(node.type) ||
          !holds(node, "html")
        )
          node.children.forEach(visit);
        if (block) flush();
      } else flush();
    };
    visit(document.tree);
    flush();
    return findings;
  },
};
