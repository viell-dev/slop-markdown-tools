import type { Nodes } from "mdast";
import type { Document, Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { walk } from "../syntax/walk.js";
import { insideInlineHtml, normalizeLabel } from "./links.js";
import { optionsSchema } from "./shared.js";

const literal = (raw: string) => !/^[<![]/.test(raw);
/** Visit prose and literal links, never descendants of authored links or other syntax. */
function prose(
  document: Document,
  visit: (node: Nodes, html: [number, number][], block: Nodes) => void,
) {
  walk(document.tree, (block) => {
    if (!["paragraph", "heading", "tableCell"].includes(block.type)) return;
    const html = insideInlineHtml(block, document.dialect === "vitepress");
    const [blockStart, blockEnd] = range(block);
    const rawBlock = document.source.slice(blockStart, blockEnd);
    const ignored =
      /\[\[[^\]\r\n]*\]\]|<[^>\r\n]*>|^ {0,3}\[[^\]\r\n]+\]:[^\r\n]*<!--[^\r\n]*|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/gm;
    for (const match of rawBlock.matchAll(ignored)) {
      if (
        match[0].startsWith("\\") &&
        document.dialect !== "forgejo" &&
        document.dialect !== "gitea"
      )
        continue;
      html.push([blockStart + match.index, blockStart + match.index + match[0].length]);
    }
    const collect = (node: Nodes) => {
      if (node.type === "text" || node.type === "link") visit(node, html, block);
      else if (
        "children" in node &&
        ["paragraph", "heading", "tableCell", "emphasis", "strong", "delete"].includes(node.type)
      )
        node.children.forEach(collect);
    };
    collect(block);
  });
}
/**
 * The character just before `at`, whole when it is a surrogate pair. Callers
 * test it with a start-anchored pattern: on Node.js 26, V8 fails to match a
 * surrogate pair with a character class right before `$` in a `u` pattern.
 */
function characterBefore(source: string, at: number): string {
  const code = at >= 2 ? source.codePointAt(at - 2) : undefined;
  return code !== undefined && code > 0xffff ? String.fromCodePoint(code) : (source[at - 1] ?? "");
}
/** Deliberately conservative shared subset of literal/angle autolinks across hosts. */
function angleSafe(raw: string): boolean {
  return (
    /^(?:https?:\/\/|mailto:)?[A-Za-z0-9@%+._~:/?#=-]+$/.test(raw) &&
    !/[.,:;!?_-]$/.test(raw) &&
    !raw.includes("&") &&
    !raw.startsWith("www.")
  );
}
const barePattern =
  /https?:\/\/[^\s<>]+|www\.[^\s<>]+|(?<![A-Za-z0-9.!#$%&'*+/=?^_`{|}~-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}/g;

export const linkStyleRules: Record<string, Rule> = {
  "links/reversed": {
    description: "Reports likely reversed links, such as `(text)[https://example.com]`.",
    kind: "problem",
    schema: false,
    check({ document }) {
      const definitions = new Set<string>();
      walk(document.tree, "definition", (node) => definitions.add(node.identifier));
      const readable = new Uint8Array(document.source.length);
      // Inside a bare URL; the bracketed part may be one, as in `(text)[https://e.com]`,
      // but the parenthesis that opens a reversed link may not, as in `https://e.com/(a)[b.md]`.
      const inUrl = new Uint8Array(document.source.length);
      prose(document, (node, ignored) => {
        const [start, end] = range(node);
        if (node.type === "link") {
          if (!literal(document.source.slice(start, end))) return;
          inUrl.fill(1, start, end);
        } else
          for (const match of document.source.slice(start, end).matchAll(barePattern))
            inUrl.fill(1, start + match.index, start + match.index + match[0].length);
        for (let i = start; i < end; i++) {
          if (document.source[i] === "\\") i++;
          else if (!ignored.some(([from, to]) => i >= from && i < to)) readable[i] = 1;
        }
      });
      const findings: Finding[] = [];
      for (const match of document.source.matchAll(/\([^()\r\n]+\)\[([^[\]\s]+)\]/g)) {
        const label = match[1]!;
        const start = match.index;
        const end = start + match[0].length;
        if (
          !readable.slice(start, end).every(Boolean) ||
          inUrl[start] === 1 ||
          /^[\p{L}\p{N}\p{M}_$]/u.test(characterBefore(document.source, start)) ||
          document.source[end] === "]" ||
          definitions.has(normalizeLabel(label)) ||
          label.startsWith("^") ||
          !/^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|mailto:|[^@]+@[^@]+\.[^@]+|\.{0,2}\/|#\S)|\/|\.[A-Za-z][A-Za-z0-9]{0,9}(?:[#?].*)?$/.test(
            label,
          )
        )
          continue;
        findings.push({
          start,
          end,
          message: "Likely reversed link: write [text](destination) if a link was intended.",
        });
      }
      return findings;
    },
  },
  "links/bare-url": {
    description: "Writes bare URLs and email addresses as autolinks, in angle brackets.",
    kind: "style",
    phase: "inline",
    schema: false,
    check({ document }) {
      const findings: Finding[] = [];
      prose(document, (node, ignored, block) => {
        const [start, end] = range(node);
        const raw = document.source.slice(start, end);
        if (node.type === "link") {
          if (!literal(raw) || ignored.some(([from, to]) => start < to && end > from)) return;
          const text =
            node.children.length === 1 && node.children[0]?.type === "text"
              ? node.children[0].value
              : undefined;
          const equivalent = text === raw && (node.url === raw || node.url === `mailto:${raw}`);
          // Check source boundaries, even when the backslash is a separate text node.
          const boundarySafe =
            !/[\\<]/.test(document.source[start - 1] ?? "") && document.source[end] !== ">";
          // markdown-it's linkifier disagrees with the GFM literal reader at
          // these boundaries. Bracketing would add a link or change its extent.
          const projectionSafe =
            document.dialect !== "vitepress" ||
            (!/^[\p{L}\p{N}_+]/u.test(characterBefore(document.source, start)) &&
              !/[_~]/.test(document.source[end] ?? "") &&
              !/[#%@]$/.test(raw));
          // Obsidian accepts source heading names; the forges also support
          // versions whose heading IDs depend on source rather than rendered text.
          const headingSafe =
            block.type !== "heading" ||
            document.dialect === "github" ||
            document.dialect === "vitepress";
          findings.push({
            start,
            end,
            message: "Write this bare address as an autolink where rendering permits.",
            ...(equivalent && boundarySafe && projectionSafe && headingSafe && angleSafe(raw)
              ? { edit: { start, end, text: `<${raw}>` } }
              : {}),
          });
        } else {
          for (const match of raw.matchAll(barePattern)) {
            if (
              ignored.some(
                ([from, to]) =>
                  start + match.index < to && start + match.index + match[0].length > from,
              )
            )
              continue;
            // An angle-delimited attempt, including one with spaces, is already explicit.
            const before = raw.slice(0, match.index);
            if (before.lastIndexOf("<") > before.lastIndexOf(">") || /[\w@]$/.test(before))
              continue;
            findings.push({
              start: start + match.index,
              end: start + match.index + match[0].length,
              message: "Bare address; adding a link here may change rendering.",
            });
          }
        }
      });
      return findings;
    },
  },
  "links/allowed-notation": {
    description: "Reports the link and image forms that the options disallow.",
    kind: "style",
    phase: "inline",
    schema: optionsSchema(
      Object.fromEntries(
        ["autolink", "inline", "full", "collapsed", "shortcut", "urlInline"].map((name) => [
          name,
          { type: "boolean", default: true },
        ]),
      ),
    ),
    check({ document, options }) {
      const findings: Finding[] = [];
      walk(document.tree, (node) => {
        if (
          node.type !== "link" &&
          node.type !== "image" &&
          node.type !== "linkReference" &&
          node.type !== "imageReference"
        )
          return;
        const [start, end] = range(node);
        const raw = document.source.slice(start, end);
        // Bare autolink literals have their own rule.
        if (node.type === "link" && literal(raw)) return;
        const text =
          node.type === "link" && node.children.length === 1 && node.children[0]?.type === "text"
            ? node.children[0].value
            : undefined;
        const notation =
          node.type === "linkReference" || node.type === "imageReference"
            ? node.referenceType
            : raw.startsWith("<")
              ? "autolink"
              : "inline";
        const urlInline = notation === "inline" && node.type === "link" && text === node.url;
        if (options[notation] !== false && !(urlInline && options.urlInline === false)) return;
        const canFix =
          node.type === "link" &&
          notation === "inline" &&
          urlInline &&
          !node.title &&
          options.autolink !== false &&
          raw === `[${node.url}](${node.url})` &&
          /^https?:\/\//.test(node.url) &&
          angleSafe(node.url);
        findings.push({
          start,
          end,
          message: `Disallowed ${urlInline && options.urlInline === false ? "urlInline" : notation} link or image notation.`,
          ...(canFix ? { edit: { start, end, text: `<${node.url}>` } } : {}),
        });
      });
      return findings;
    },
  },
};
