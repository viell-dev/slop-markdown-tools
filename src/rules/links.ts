import path from "node:path";
import { walk } from "../syntax/walk.js";
import type { Nodes } from "mdast";
import type { Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { splitDestination } from "../workspace/index.js";
import { optionsSchema } from "./style.js";

function destination(node: Nodes): string | undefined {
  if (node.type === "wikiLink") return node.target;
  if (node.type === "link" || node.type === "image" || node.type === "definition") return node.url;
  return undefined;
}
/** Locate an inline destination within a parsed link, retaining labels and optional titles. */
function destinationRange(raw: string): [number, number] | undefined {
  let bracket = 0;
  let opening = -1;
  for (let i = raw.startsWith("!") ? 1 : 0; i < raw.length; i++) {
    if (raw[i] === "\\") {
      i++;
      continue;
    }
    if (raw[i] === "[") bracket++;
    if (raw[i] === "]" && --bracket === 0 && raw[i + 1] === "(") {
      opening = i + 2;
      break;
    }
  }
  if (opening < 0) return undefined;
  while (/\s/.test(raw[opening] ?? "")) opening++;
  if (raw[opening] === "<") {
    for (let i = opening + 1; i < raw.length; i++) {
      if (raw[i] === "\\") {
        i++;
        continue;
      }
      if (raw[i] === ">") return [opening, i + 1];
    }
    return undefined;
  }
  let depth = 0;
  for (let i = opening; i < raw.length; i++) {
    const char = raw[i]!;
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "(") depth++;
    if ((char === ")" && depth-- === 0) || /\s/.test(char)) return [opening, i];
  }
  return undefined;
}

export const linkRules: Record<string, Rule> = {
  "links/valid": {
    description: "Check local link destinations and dialect-specific heading/block references.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document, workspace }) {
      const findings: Finding[] = [];
      // The parser only produces reference nodes for labels that have a
      // definition; undefined references stay plain text.
      walk(document.tree, (node) => {
        const url = destination(node);
        if (url === undefined || !workspace) return;
        const result = workspace.resolve(
          document.path,
          url,
          document.dialect,
          node.type === "wikiLink",
        );
        if (result.status === "missing" || result.status === "ambiguous")
          findings.push({
            start: range(node)[0],
            message: `${result.status === "missing" ? "Missing" : "Ambiguous"} local target: ${url}.`,
          });
        else if (result.status === "directory" && document.dialect === "obsidian")
          findings.push({ start: range(node)[0], message: `Local target is a directory: ${url}.` });
        else if (result.status === "resolved" && !result.fragmentExists)
          findings.push({ start: range(node)[0], message: `Missing fragment in ${url}.` });
      });
      return findings;
    },
  },
  "links/path": {
    description: "Rewrite verified local destinations using the configured path and bracket style.",
    kind: "style",
    phase: "inline",
    schema: optionsSchema({
      style: { enum: ["relative", "root", "shortest", "preserve"] },
      brackets: { enum: ["angle", "bare", "preserve"] },
      extension: { enum: ["include", "omit", "preserve"] },
      leadingDot: { type: "boolean" },
    }),
    check({ document, options, workspace }) {
      const findings: Finding[] = [];
      walk(document.tree, (node) => {
        const url = destination(node);
        if (url === undefined || !workspace) return;
        const result = workspace.resolve(
          document.path,
          url,
          document.dialect,
          node.type === "wikiLink",
        );
        if (result.status !== "resolved" || !result.target || !result.fragmentExists) return;
        const parts = splitDestination(url);
        let target = parts.path;
        const style = options.style ?? "preserve";
        // Vault roots and extensionless Markdown are renderer-specific; don't change other dialects.
        if (
          document.dialect !== "obsidian" &&
          (style === "root" || style === "shortest" || options.extension === "omit")
        )
          return;
        if (parts.path) {
          if (style === "root") target = result.target;
          else if (style === "relative")
            target = path.posix.relative(path.posix.dirname(document.path), result.target);
          else if (style === "shortest") {
            const basename = path.posix.basename(result.target);
            const resolved = workspace.resolve(document.path, basename, document.dialect, true);
            target =
              resolved.status === "resolved" && resolved.target === result.target
                ? basename
                : result.target;
          }
          if (document.dialect === "obsidian" && result.target.endsWith(".md")) {
            if (
              options.extension === "omit" ||
              ((options.extension ?? "preserve") === "preserve" && !parts.path.endsWith(".md"))
            )
              target = target.replace(/\.md$/, "");
            else if (options.extension === "include" && !target.endsWith(".md")) target += ".md";
          }
          if (style === "relative" && options.leadingDot === true && !target.startsWith("."))
            target = `./${target}`;
        }
        // Encode reserved path characters before reattaching a separately parsed fragment.
        const hash = url.indexOf("#");
        const encodedPath =
          target === parts.path
            ? hash < 0
              ? url
              : url.slice(0, hash)
            : target.replaceAll("%", "%25").replaceAll("#", "%23");
        let replacement =
          encodedPath +
          (hash < 0
            ? ""
            : target === parts.path
              ? url.slice(hash)
              : `#${parts.fragment.replaceAll("%", "%25")}`);
        // A relative basename can collide with a vault-root path. Make the
        // relative spelling explicit before proposing an identity-changing edit.
        let verified = workspace.resolve(
          document.path,
          replacement,
          document.dialect,
          node.type === "wikiLink",
        );
        if (
          style === "relative" &&
          parts.path &&
          !replacement.startsWith(".") &&
          (verified.status !== "resolved" || verified.target !== result.target)
        ) {
          replacement = `./${replacement}`;
          verified = workspace.resolve(
            document.path,
            replacement,
            document.dialect,
            node.type === "wikiLink",
          );
        }
        if (
          verified.status !== "resolved" ||
          verified.target !== result.target ||
          verified.fragment !== result.fragment
        )
          return;
        const [start, end] = range(node);
        if (node.type === "wikiLink") {
          if (/[[\]|\r\n]/.test(replacement)) return;
          if (!node.embed && node.label === undefined && replacement !== node.target) return;
          replacement = `${node.embed ? "!" : ""}[[${replacement}${node.label === undefined ? "" : `|${node.label}`}]]`;
          if (replacement !== document.source.slice(start, end))
            findings.push({
              start,
              end,
              message: "Normalize wikilink destination.",
              edit: { start, end, text: replacement },
            });
          return;
        }
        if (node.type === "definition") return; // Definitions are validated; retain their exact layout in this release.
        const raw = document.source.slice(start, end);
        const span = destinationRange(raw);
        if (!span) return; // Autolinks have no parenthesized destination.
        const original = raw.slice(...span);
        const angle =
          options.brackets === "angle" ||
          ((options.brackets ?? "preserve") === "preserve" && original.startsWith("<"));
        if (angle)
          replacement = `<${replacement.replaceAll("<", "%3C").replaceAll(">", "%3E").replaceAll("\\", "%5C")}>`;
        else
          replacement = replacement
            .replaceAll(" ", "%20")
            .replaceAll("(", "%28")
            .replaceAll(")", "%29")
            .replaceAll("<", "%3C")
            .replaceAll(">", "%3E");
        if (original !== replacement)
          findings.push({
            start: start + span[0],
            end: start + span[1],
            message: "Normalize link destination.",
            edit: { start: start + span[0], end: start + span[1], text: replacement },
          });
      });
      return findings;
    },
  },
  "links/notation": {
    description: "Convert plain-label Obsidian links between Markdown and wikilink notation.",
    kind: "style",
    phase: "inline",
    schema: optionsSchema({ style: { enum: ["markdown", "wiki"] } }),
    check({ document, options, workspace }) {
      if (document.dialect !== "obsidian" || !workspace) return [];
      const findings: Finding[] = [];
      walk(document.tree, (node) => {
        const [start, end] = range(node);
        let replacement: string | undefined;
        if (
          options.style === "markdown" &&
          node.type === "wikiLink" &&
          !node.embed &&
          node.label !== undefined
        ) {
          if (/[[\]<>\\\r\n]/.test(node.target ?? "") || /[*_`[\]\\]/.test(node.label)) return;
          replacement = `[${node.label}](<${node.target}>)`;
        } else if (
          options.style === "wiki" &&
          node.type === "link" &&
          !node.title &&
          node.children.length === 1 &&
          node.children[0]?.type === "text"
        ) {
          const label = node.children[0].value;
          if (/[[\]|\r\n]/.test(node.url + label)) return;
          replacement = `[[${node.url}|${label}]]`;
        }
        const url = destination(node);
        if (
          !replacement ||
          url === undefined ||
          workspace.resolve(document.path, url, document.dialect, node.type === "wikiLink")
            .status !== "resolved"
        )
          return;
        findings.push({
          start,
          end,
          message: `Use ${String(options.style)} link notation.`,
          edit: { start, end, text: replacement },
        });
      });
      return findings;
    },
  },
};
