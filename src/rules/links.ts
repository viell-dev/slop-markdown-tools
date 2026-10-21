import path from "node:path";
import { walk } from "../syntax/walk.js";
import type { Definition, FootnoteDefinition, Nodes } from "mdast";
import type { Document, Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { changesForgeHeading } from "../workspace/heading-attributes.js";
import { splitDestination } from "../workspace/index.js";
import { giteaPyLine } from "./protections.js";
import { optionsSchema } from "./shared.js";

/**
 * What Gitea's `_.py` emphasis exception can see of a link destination: whether
 * it contains `_`, and whether its first `_` starts `_.py`. A delimiter earlier
 * on the line looks for the next `_` there.
 */
function giteaUnderscores(destination: string): string {
  return `${destination.includes("_")} ${/^[^_]*_\.py/.test(destination)}`;
}
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

/**
 * A Markdown link's destination as a wikilink's target, or undefined when a
 * wikilink cannot hold it. Obsidian takes a wikilink's text as the note's
 * name, so percent escapes are decoded: `My%20Note.md` is the note `My
 * Note.md`, which is right whether or not Obsidian decodes escapes in
 * wikilinks. A destination that does not decode, or whose decoded name holds
 * a character that a wikilink cannot contain, or that would change its meaning
 * there, stays a Markdown link.
 */
function wikiTarget(url: string): string | undefined {
  const hash = url.indexOf("#");
  const [name, fragment] = hash < 0 ? [url, undefined] : [url.slice(0, hash), url.slice(hash + 1)];
  let decodedName: string;
  let decodedFragment: string | undefined;
  try {
    decodedName = decodeURIComponent(name);
    decodedFragment = fragment === undefined ? undefined : decodeURIComponent(fragment);
  } catch {
    return undefined;
  }
  if (/[[\]|#^\r\n]/.test(decodedName) || decodedName.trim() !== decodedName) return undefined;
  if (decodedFragment !== undefined) {
    if (/[[\]|\r\n]/.test(decodedFragment)) return undefined;
    // An escaped `#` or `^` would become a separator or a block reference.
    const marks = (text: string) => text.replace(/[^#^]/g, "");
    if (marks(decodedFragment) !== marks(fragment!)) return undefined;
  }
  return decodedFragment === undefined ? decodedName : `${decodedName}#${decodedFragment}`;
}
/**
 * A label as CommonMark matches it: case folded, with its blank space
 * collapsed and trimmed. This is how the parser computes the `identifier` of
 * definitions and references, so the two compare equal.
 */
function normalizeLabel(label: string): string {
  return label
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/^ | $/g, "")
    .toLowerCase()
    .toUpperCase()
    .toLowerCase();
}
/**
 * A label's text as the parser reads it, from its source: without the block
 * quote markers and indentation that continue its lines inside a container.
 */
function labelText(source: string): string {
  return source.replace(/(\r\n|\r|\n)[ \t>]*/g, "$1");
}
/**
 * The end, after its `]`, of the link label that starts with the `[` at `at`
 * and ends before `limit`: the first unescaped `]`, with no unescaped `[`
 * before it, at most 999 characters, and something besides blank space.
 */
function labelEnd(source: string, at: number, limit: number): number | undefined {
  let blank = true;
  for (let i = at + 1; i < limit && i - at <= 1000; i++) {
    const char = source[i]!;
    if (char === "\\" && /[[\]\\]/.test(source[i + 1] ?? "")) {
      blank = false;
      i++;
    } else if (char === "[") return undefined;
    else if (char === "]") return blank ? undefined : i + 1;
    else if (!/[ \t\r\n]/.test(char)) blank = false;
  }
  return undefined;
}
/** A GFM footnote label after `^`: no blank space, and brackets only escaped. */
const footnoteLabel = /^\^((?:\\[[\]\\]|\\(?![[\]\\])|[^\s[\]\\]){1,999})$/;
/** Inline nodes whose text is read for brackets; any other node is syntax or a link of its own. */
const transparent = new Set(["emphasis", "strong", "delete"]);
/**
 * What before a reference's text makes it no reference to report: an ASCII
 * letter, digit, `_`, or `)`, as in the indexes `matrix[i][j]` and `f(x)[0][1]`
 * in prose, or a `]`, which continues a run like `[a][b][c]` that is reported
 * once, at its start.
 */
const notAfter = /[\w\])]/;
/** Characters that a backslash escapes. */
const asciiPunctuation = /[!-/:-@[-`{-~]/;
interface Reference {
  start: number;
  end: number;
  label: string;
  footnote: boolean;
}
/**
 * The full (`[text][label]`) and collapsed (`[label][]`) references, and with
 * `footnotes` the footnote references (`[^label]`), whose label has no
 * definition. The parser leaves these as plain text, so they are found in the
 * text of each paragraph, heading, and table cell, as CommonMark pairs its
 * brackets. Brackets in code, math, HTML, links, images, and other syntax, and
 * escaped ones, are not read.
 */
function undefinedReferences(
  document: Document,
  definitions: Set<string>,
  footnotes: Set<string> | undefined,
): Reference[] {
  const { source } = document;
  if (!source.includes("[")) return [];
  const references: Reference[] = [];
  const forge = document.dialect === "forgejo" || document.dialect === "gitea";
  // 1 where a character is text that the parser reads brackets in.
  const readable = new Uint8Array(source.length);
  const collect = (node: Nodes) => {
    if (!("children" in node)) return;
    for (const child of node.children)
      if (child.type === "text") {
        const [from, to] = range(child);
        for (let i = from; i < to; i++) {
          if (source[i] === "\\" && i + 1 < to && asciiPunctuation.test(source[i + 1]!)) i++;
          else readable[i] = 1;
        }
      } else if (transparent.has(child.type)) collect(child);
  };
  walk(document.tree, (node) => {
    if (node.type !== "paragraph" && node.type !== "heading" && node.type !== "tableCell") return;
    const [start, end] = range(node);
    // Searched in the block's own text, so that blocks without brackets cost no more than that.
    const text = source.slice(start, end);
    if (!text.includes("[")) return;
    collect(node);
    // Forgejo and Gitea render `\(...\)` and `\[...\]` as math, which GFM reads as text.
    if (forge)
      for (const [open, close] of [
        ["\\(", "\\)"],
        ["\\[", "\\]"],
      ] as const)
        for (let from = 0; ;) {
          const opening = text.indexOf(open, from);
          const closing = opening < 0 ? -1 : text.indexOf(close, opening + 2);
          if (closing < 0) break;
          readable.fill(0, start + opening, start + closing + 2);
          from = closing + 2;
        }
    const openers: number[] = [];
    // The opening bracket of the last full reference's label, which is not read again.
    let label = -1;
    for (let i = start; i < end; i++) {
      if (!readable[i]) continue;
      if (source[i] === "[") {
        openers.push(i);
        continue;
      }
      if (source[i] !== "]") continue;
      const opener = openers.pop();
      if (opener === undefined || opener === label) continue;
      let reference: Reference | undefined;
      if (source[i + 1] === "[" && readable[i + 1]) {
        if (source[i + 2] === "]" && readable[i + 2]) {
          // Collapsed: the text is the label.
          if (labelEnd(source, opener, i + 1) === i + 1)
            reference = {
              start: opener,
              end: i + 3,
              label: source.slice(opener + 1, i),
              footnote: false,
            };
        } else {
          const after = labelEnd(source, i + 1, end);
          if (after !== undefined && readable[after - 1]) {
            reference = {
              start: opener,
              end: after,
              label: source.slice(i + 2, after - 1),
              footnote: false,
            };
            label = i + 1;
          }
        }
        if (reference) {
          if (
            !definitions.has(normalizeLabel(labelText(reference.label))) &&
            !(opener > 0 && readable[opener - 1] && notAfter.test(source[opener - 1]!))
          )
            references.push(reference);
          continue;
        }
      }
      // A footnote label has at most 999 characters after its `^`.
      if (!footnotes || source[opener + 1] !== "^" || i - opener > 1001) continue;
      const footnote = footnoteLabel.exec(source.slice(opener + 1, i));
      if (footnote && !footnotes.has(normalizeLabel(footnote[1]!)))
        references.push({ start: opener, end: i + 1, label: footnote[1]!, footnote: true });
    }
  });
  return references;
}

/**
 * Whether a relative path already starts at the linking document's directory or above it.
 * A path such as `.gitignore` starts with a dot and is neither.
 */
function explicitlyRelative(path: string): boolean {
  return /^\.\.?(?:\/|$)/.test(path);
}

/** Names the first few of the paths that could not be read, and counts the rest. */
function named(paths: string[]): string {
  return paths.length > 3
    ? `${paths.slice(0, 3).join(", ")}, and ${paths.length - 3} more`
    : paths.join(", ");
}

/** The nodes inside table cells, where a `|` that is not escaped ends the cell. */
function inTableCells(tree: Nodes): Set<Nodes> {
  const nodes = new Set<Nodes>();
  walk(tree, "tableCell", (cell) => walk(cell, (child) => nodes.add(child)));
  return nodes;
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
        if (result.status === "missing" && result.outside !== undefined && result.vault)
          // The file is there, so "missing" would mislead: Obsidian cannot reach it.
          findings.push({
            start: range(node)[0],
            message: `Local target is outside the vault: ${url} (${result.outside} is not in ${result.vault}, where Obsidian looks).`,
          });
        else if (result.status === "missing" || result.status === "ambiguous")
          findings.push({
            start: range(node)[0],
            message: `${result.status === "missing" ? "Missing" : "Ambiguous"} local target: ${url}.`,
          });
        else if (result.status === "directory" && document.dialect === "obsidian")
          findings.push({ start: range(node)[0], message: `Local target is a directory: ${url}.` });
        else if (result.status === "unreadable") {
          // Neither found nor known to be missing: say what stood in the way.
          const limits = result.unreadable ?? [];
          // The rest of a vault that the workspace root is only a folder of.
          const outsideRoot = (name: string) => name === ".." || name.startsWith("../");
          const directories = limits.filter((name) => !outsideRoot(name));
          const reasons = [
            ...(directories.length ? [`cannot read ${named(directories)}`] : []),
            ...(limits.some(outsideRoot) ? ["the workspace root is only a part of the vault"] : []),
          ];
          findings.push({
            start: range(node)[0],
            message:
              result.leavesRoot !== undefined
                ? `Local target could not be checked: ${url} (${result.leavesRoot} leads outside the workspace root, which the tool does not read).`
                : result.target === undefined
                  ? `Local target could not be checked: ${url} (no readable match; ${reasons.join("; ")}).`
                  : `Fragment could not be checked: ${url} (cannot read ${result.target}).`,
          });
        } else if (result.status === "resolved" && !result.fragmentExists)
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
      let inCell: Set<Nodes> | undefined;
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
        // Found by name among the readable files only: a directory that could not
        // be read may hold another match, and a rewrite would choose between them.
        if (result.unreadable) return;
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
          // Obsidian counts a path from the note's vault, which need not be the root.
          const rooted = result.rooted ?? result.target;
          if (style === "root") target = rooted;
          else if (style === "relative")
            target = path.posix.relative(path.posix.dirname(document.path), result.target);
          else if (style === "shortest") {
            const basename = path.posix.basename(result.target);
            const resolved = workspace.resolve(document.path, basename, document.dialect, true);
            target =
              resolved.status === "resolved" &&
              resolved.target === result.target &&
              !resolved.unreadable
                ? basename
                : rooted;
          }
          if (document.dialect === "obsidian" && result.target.endsWith(".md")) {
            if (
              options.extension === "omit" ||
              ((options.extension ?? "preserve") === "preserve" && !parts.path.endsWith(".md"))
            )
              target = target.replace(/\.md$/, "");
            else if (options.extension === "include" && !target.endsWith(".md")) target += ".md";
          }
          if (style === "relative" && options.leadingDot === true && !explicitlyRelative(target))
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
          !explicitlyRelative(replacement) &&
          (verified.status !== "resolved" ||
            verified.target !== result.target ||
            verified.unreadable)
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
          verified.fragment !== result.fragment ||
          verified.unreadable
        )
          return;
        const [start, end] = range(node);
        if (node.type === "wikiLink") {
          if (/[[\]|\r\n]/.test(replacement)) return;
          if (!node.embed && node.label === undefined && replacement !== node.target) return;
          // Only the destination changes. The divider stays as written, `|` or
          // `\|`, which a table cell needs, and so do the label and an embed's size.
          const raw = document.source.slice(start, end);
          const open = node.embed ? 3 : 2;
          const divider = raw.indexOf("|", open);
          const targetEnd =
            divider < 0 ? raw.length - 2 : raw[divider - 1] === "\\" ? divider - 1 : divider;
          if (raw.slice(open, targetEnd) !== node.target) return;
          replacement = raw.slice(0, open) + replacement + raw.slice(targetEnd);
          if (replacement !== raw)
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
        // A file or folder name can hold a `|`, which would end a table cell.
        if (replacement.includes("|") && (inCell ??= inTableCells(document.tree)).has(node))
          replacement = replacement.replaceAll("|", "\\|");
        if (
          document.dialect === "gitea" &&
          (giteaPyLine(document, start, end) || replacement.includes("_.py")) &&
          giteaUnderscores(original) !== giteaUnderscores(replacement)
        )
          return;
        // On Forgejo, and Gitea before 1.26, the destination is part of the
        // heading's anchor, and text they read as attributes is no link there.
        if (changesForgeHeading(document, start, end)) return;
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
      let inCell: Set<Nodes> | undefined;
      walk(document.tree, (node) => {
        const [start, end] = range(node);
        const pipe = () => ((inCell ??= inTableCells(document.tree)).has(node) ? "\\|" : "|");
        let replacement: string | undefined;
        if (
          options.style === "markdown" &&
          node.type === "wikiLink" &&
          !node.embed &&
          node.label !== undefined
        ) {
          if (/[[\]<>\\\r\n]/.test(node.target ?? "") || /[*_`[\]\\]/.test(node.label)) return;
          const label = node.label.includes("|") ? node.label.replaceAll("|", pipe()) : node.label;
          replacement = `[${label}](<${node.target}>)`;
        } else if (
          options.style === "wiki" &&
          node.type === "link" &&
          !node.title &&
          node.children.length === 1 &&
          node.children[0]?.type === "text"
        ) {
          const label = node.children[0].value;
          const target = wikiTarget(node.url);
          if (target === undefined || /[[\]|\r\n]/.test(label)) return;
          replacement = `[[${target}${pipe()}${label}]]`;
        }
        const url = destination(node);
        if (!replacement || url === undefined) return;
        const result = workspace.resolve(
          document.path,
          url,
          document.dialect,
          node.type === "wikiLink",
        );
        // A target that is uncertain, because a directory could not be read, is left as written.
        if (result.status !== "resolved" || result.unreadable) return;
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
  "links/undefined-reference": {
    description:
      "Report full, collapsed, and footnote references whose label has no definition, which show as plain text.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const definitions = new Set<string>();
      const footnotes = new Set<string>();
      walk(document.tree, (node) => {
        if (node.type === "definition") definitions.add(node.identifier);
        if (node.type === "footnoteDefinition") footnotes.add(node.identifier);
      });
      // CommonMark has no footnotes: there `[^label]` is an ordinary shortcut reference.
      return undefinedReferences(
        document,
        definitions,
        document.dialect === "commonmark" ? undefined : footnotes,
      ).map(({ start, end, label, footnote }) => {
        const name = (footnote ? `^${label}` : labelText(label)).replace(/\s+/g, " ").trim();
        return {
          start,
          end,
          message: `${footnote ? "Footnote" : "Reference"} [${name}] has no definition and shows as plain text.`,
        };
      });
    },
  },
  "links/unused-definition": {
    description: "Report link and footnote definitions that no reference uses.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      // Link and footnote labels are kept apart, as `link:` and `footnote:` keys.
      const used = new Set<string>();
      const definitions: (Definition | FootnoteDefinition)[] = [];
      walk(document.tree, (node) => {
        // A shortcut reference `[label]` that has a definition is a reference node too.
        if (node.type === "linkReference" || node.type === "imageReference")
          used.add(`link:${node.identifier}`);
        else if (node.type === "footnoteReference") used.add(`footnote:${node.identifier}`);
        else if (node.type === "definition" || node.type === "footnoteDefinition")
          definitions.push(node);
      });
      const findings: Finding[] = [];
      const seen = new Set<string>();
      for (const node of definitions) {
        const footnote = node.type === "footnoteDefinition";
        const key = `${footnote ? "footnote" : "link"}:${node.identifier}`;
        const label = (node.label ?? node.identifier).replace(/\s+/g, " ").trim();
        const name = `[${footnote ? "^" : ""}${label}]`;
        const [start] = range(node);
        // CommonMark uses the first definition of a label; a later one is never used.
        if (seen.has(key))
          findings.push({
            start,
            message: `${footnote ? "Footnote" : "Definition"} ${name} repeats an earlier one, which references use instead.`,
          });
        else if (!used.has(key))
          findings.push({
            start,
            message: footnote
              ? `Footnote ${name} is not referenced${document.dialect === "github" ? ", and GitHub does not show it" : ""}.`
              : `Definition ${name} is not used by any reference.`,
          });
        seen.add(key);
      }
      return findings;
    },
  },
  "links/empty": {
    description: "Report links and images whose destination is empty or only #.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      // A reference has its definition's destination, which is reported once, at the definition.
      walk(document.tree, (node) => {
        if (node.type !== "link" && node.type !== "image" && node.type !== "definition") return;
        if (node.url !== "" && node.url !== "#") return;
        const what =
          node.type === "image"
            ? "Image source"
            : node.type === "definition"
              ? `Destination of definition [${(node.label ?? node.identifier).replace(/\s+/g, " ").trim()}]`
              : "Link destination";
        findings.push({
          start: range(node)[0],
          message:
            node.url === ""
              ? `${what} is empty.`
              : `${what} is only #${node.type === "link" ? ", which only leads to the top of the page" : ""}.`,
        });
      });
      return findings;
    },
  },
};
