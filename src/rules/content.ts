import { walk } from "../syntax/walk.js";
import type { Finding, Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { tableContainerBoundary } from "../syntax/site-generator.js";
import { lineBreak } from "../syntax/source.js";
import { optionsSchema } from "./shared.js";
import { properNames } from "./proper-names.js";

/** `|100` or `|100x50` at the end of an Obsidian image's text sets its size, not its text. */
const obsidianSize = /\|\d+(?:x\d+)?$/;

/**
 * The languages of shell commands and of shell sessions, whose prompts mark
 * the commands. Another language's code can start a line with `$` or `%`,
 * such as TeX's comments or math.
 */
const shellLanguages = new Set([
  "bash",
  "console",
  "csh",
  "dash",
  "fish",
  "ksh",
  "sh",
  "sh-session",
  "shell",
  "shell-session",
  "shellsession",
  "tcsh",
  "terminal",
  "zsh",
]);
/** A command after a `$` or `%` prompt and blank space. */
const prompted = /^[ \t]*([$%])[ \t]+\S/;
/** A line that ends in a backslash that is not escaped, which continues the command below it. */
const continued = /(?:^|[^\\])(?:\\\\)*\\$/;
/**
 * The prompt that every command in code starts with, when the code holds no
 * output: each line that is not blank is a command after a prompt, or a line
 * that a backslash continues the command of. `#` is no prompt, because shell
 * code starts its comments with it, and a session shows output with it.
 */
function promptOnly(code: string): string | undefined {
  let prompt: string | undefined;
  let continuation = false;
  for (const line of code.split(lineBreak)) {
    if (!line.trim()) {
      continuation = false;
      continue;
    }
    if (!continuation) {
      const found = prompted.exec(line)?.[1];
      if (!found) return undefined;
      prompt = prompt === undefined || prompt === found ? found : "";
    }
    continuation = continued.test(line);
  }
  return prompt;
}

export const contentRules: Record<string, Rule> = {
  "content/proper-names": properNames,
  "content/image-alt": {
    description: "Report images without alternative text.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      // Obsidian's `![[image.png]]` embeds are wikilinks, which have no place for the text.
      walk(document.tree, (node) => {
        if (node.type !== "image" && node.type !== "imageReference") return;
        let alt = node.alt ?? "";
        if (document.dialect === "obsidian") alt = alt.replace(obsidianSize, "");
        if (alt.trim()) return;
        const [start, end] = range(node);
        findings.push({
          start,
          end,
          message: "Add alternative text to the image, for readers who cannot see it.",
        });
      });
      return findings;
    },
  },
  "content/table-columns": {
    description: "Report table rows with more or fewer cells than the header row.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      walk(document.tree, "table", (node) => {
        const boundary = tableContainerBoundary(document.source, node);
        const [header, ...rows] = boundary < 0 ? node.children : node.children.slice(0, boundary);
        const columns = header?.children.length ?? 0;
        for (const row of rows) {
          const cells = row.children.length;
          if (cells === columns) continue;
          const [start, end] = range(row);
          const counted = `Row has ${cells} ${cells === 1 ? "cell" : "cells"} and the header ${columns}`;
          findings.push({
            start,
            end,
            message:
              cells > columns
                ? `${counted}; ${cells - columns === 1 ? "the extra cell is" : "the extra cells are"} not shown.`
                : `${counted}; the row is shown with ${columns - cells === 1 ? "an empty cell" : "empty cells"} added.`,
          });
        }
      });
      return findings;
    },
  },
  "content/shell-prompt": {
    description:
      "Report shell code blocks whose every command has a prompt and that show no output.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      walk(document.tree, "code", (node) => {
        if (node.lang && !shellLanguages.has(node.lang.toLowerCase())) return;
        const prompt = promptOnly(node.value);
        if (prompt === undefined) return;
        const [start, end] = range(node);
        findings.push({
          start,
          end,
          message: `Every command in the code block starts with ${prompt ? `a "${prompt}" prompt` : "a prompt"} and the block shows no output; remove the prompts, which get in the way of copying the commands.`,
        });
      });
      return findings;
    },
  },
  "content/code-language": {
    description: "Check fenced code block languages and their info strings.",
    kind: "problem",
    schema: optionsSchema({
      allowedLanguages: { type: "array", items: { type: "string", minLength: 1 }, default: [] },
      languageOnly: { type: "boolean", default: false },
    }),
    check({ document, options }) {
      const languages = (options.allowedLanguages as string[] | undefined) ?? [];
      const allowed = languages.length ? new Set(languages) : undefined;
      const findings: Finding[] = [];
      walk(document.tree, "code", (node) => {
        const [start] = range(node);
        // An indented code block starts with its indentation, and has no place for a language.
        const fence = document.source[start];
        if (
          (node.lang && (!allowed || allowed.has(node.lang)) && !options.languageOnly) ||
          (fence !== "`" && fence !== "~")
        )
          return;
        let end = start;
        while (document.source[end] === fence) end++;
        const marker = document.source.slice(start, end);
        if (!node.lang) {
          findings.push({
            start,
            end,
            message: `Name the code block's language after its opening fence, such as ${marker}sh, or ${marker}text for plain text.`,
          });
          return;
        }
        let infoEnd = end;
        while (
          infoEnd < document.source.length &&
          document.source[infoEnd] !== "\r" &&
          document.source[infoEnd] !== "\n"
        )
          infoEnd++;
        const info = document.source.slice(end, infoEnd);
        if (allowed && !allowed.has(node.lang)) {
          const name = /\S+/u.exec(info);
          const at = end + (name?.index ?? 0);
          findings.push({
            start: at,
            end: at + (name?.[0].length ?? info.length),
            message: `Code language "${node.lang}" is not allowed by allowedLanguages.`,
          });
        }
        if (
          options.languageOnly &&
          (!/^\S+$/u.test(info) || (document.dialect === "vitepress" && info !== node.lang))
        ) {
          findings.push({
            start: end,
            end: infoEnd,
            message:
              "Use only the language name in the code fence's info string, without surrounding whitespace.",
          });
        }
      });
      return findings;
    },
  },
};
