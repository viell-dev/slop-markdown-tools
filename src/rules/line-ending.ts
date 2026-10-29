import type { Finding, Rule } from "../core/types.js";
import { semanticFingerprint } from "../core/semantics.js";
import { otherReading, parse, range } from "../syntax/parse.js";
import { lineEnding } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { vitepressWhitespaceLiterals } from "../syntax/vitepress/projection.js";
import { optionsSchema } from "./shared.js";

export const lineEndingRule: Rule = {
  description: "Use a configured line ending outside literal content.",
  kind: "style",
  phase: "document",
  schema: optionsSchema({ endOfLine: { enum: ["lf", "crlf", "cr", "auto"] } }),
  check({ document, options, workspace }) {
    const source = document.source;
    const style = typeof options.endOfLine === "string" ? options.endOfLine : "lf";
    const ending =
      style === "auto"
        ? lineEnding(source)
        : style === "crlf"
          ? "\r\n"
          : style === "cr"
            ? "\r"
            : "\n";
    const opaque: [number, number][] = vitepressWhitespaceLiterals(document);
    const alternative = otherReading(document.tree);
    for (const tree of alternative ? [document.tree, alternative] : [document.tree])
      walk(tree, (node) => {
        if (["code", "html", "math", "yaml", "toml"].includes(node.type)) opaque.push(range(node));
      });
    opaque.sort((a, b) => a[0] - b[0]);
    const findings: Finding[] = [];
    let cursor = 0;
    let until = 0;
    // Keep each contiguous newline run atomic: partial CR/LF edits can merge
    // two physical breaks into a single CRLF at a protected boundary.
    for (const match of source.matchAll(/(?:\r\n|\r|\n)+/g)) {
      while (cursor < opaque.length && opaque[cursor]![0] < match.index + match[0].length) {
        until = Math.max(until, opaque[cursor++]![1]);
      }
      const text = match[0].replace(/\r\n|\r|\n/g, ending);
      if (match[0] === text || match.index < until) continue;
      findings.push({
        start: match.index,
        end: match.index + match[0].length,
        message: `Use ${style.toUpperCase()} line endings.`,
        edit: { start: match.index, end: match.index + match[0].length, text },
      });
    }
    if (!findings.length) return [];
    const pieces: string[] = [];
    let at = 0;
    for (const finding of findings) {
      pieces.push(source.slice(at, finding.start), finding.edit!.text);
      at = finding.end!;
    }
    pieces.push(source.slice(at));
    const tried = parse(pieces.join(""), document.dialect, document.path, [], document.vitepress);
    if (semanticFingerprint(tried, workspace) !== semanticFingerprint(document, workspace))
      return findings.map((finding) => ({
        start: finding.start,
        end: finding.end!,
        message: "Keep line endings to preserve the document's meaning.",
      }));
    return findings;
  },
};
