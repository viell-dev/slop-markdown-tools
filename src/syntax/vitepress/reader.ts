import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { componentPlugin } from "@mdit-vue/plugin-component";
import { attrs } from "@mdit/plugin-attrs";
import { container } from "@mdit/plugin-container";
import { fullEmoji } from "@mdit/plugin-emoji";
import { footnote } from "@mdit/plugin-footnote";
import { tasklist } from "@mdit/plugin-tasklist";
import cjkFriendly from "markdown-it-cjk-friendly";
import type { VitePressOptions } from "../../core/types.js";
import { lineStarts } from "../source.js";
import { mathSyntax } from "./math.js";

export const containerNames = [
  "tip",
  "info",
  "warning",
  "danger",
  "details",
  "note",
  "important",
  "caution",
  "raw",
  "v-pre",
  "code-group",
] as const;
const parsers = new Map<string, MarkdownIt>();

/** gray-matter's lexical boundary; metadata is kept opaque, never evaluated. */
export function frontmatterEnd(source: string): number {
  if (!/^---(?!-)/.test(source)) return 0;
  const starts = lineStarts(source);
  for (let index = 1; index < starts.length; index++) {
    const at = starts[index]!;
    if (source.startsWith("---", at)) return starts[index + 1] ?? source.length;
  }
  return source.length;
}
/** Blank bytes without moving physical line or UTF-16 offsets. */
export function blank(source: string): string {
  return source.replace(/[^\r\n]/g, " ");
}

// VitePress retains written entities for heading text. This follows its
// restoreEntities/text_join plugin, including the single-token case.
function restoreEntities(parser: MarkdownIt): void {
  parser.core.ruler.at("text_join", (state) => {
    const content = (token: Token) =>
      token.info === "entity"
        ? token.markup
        : token.info === "escape" && token.content === "&"
          ? "&amp;"
          : token.content;
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      const children: Token[] = [];
      for (const token of block.children) {
        if (token.type === "text_special") token.type = "text";
        const previous = children.at(-1);
        if (token.type === "text" && previous?.type === "text") {
          token.content = content(previous) + content(token);
          token.info = "";
          token.markup = "";
          children[children.length - 1] = token;
        } else children.push(token);
      }
      block.children = children;
    }
  });
}

function parserFor(options: VitePressOptions): MarkdownIt {
  const key = JSON.stringify([
    options.math === true,
    options.attrs !== false,
    options.footnote !== false,
    options.tasklist !== false,
    options.cjkFriendlyEmphasis !== false,
    options.customContainers ?? [],
  ]);
  const cached = parsers.get(key);
  if (cached) return cached;
  const parser = new MarkdownIt({ html: true, linkify: true });
  parser.linkify.set({ fuzzyLink: false });
  restoreEntities(parser);
  for (const name of new Set([...containerNames, ...(options.customContainers ?? [])]))
    parser.use(container, { name });
  parser.core.ruler.after("block", "vitepress_alerts", (state) => {
    const recognized = new Set([
      "tip",
      "info",
      "warning",
      "danger",
      "note",
      "important",
      "caution",
      ...(options.customContainers ?? []),
    ]);
    const quotes: Token[] = [];
    let pending = 0;
    for (const token of state.tokens) {
      if (token.type === "blockquote_open") quotes.push(token);
      else if (token.type === "blockquote_close") {
        if (quotes.pop()?.type === "vitepress_alert_open") {
          token.type = "vitepress_alert_close";
          token.tag = "div";
        }
        pending = Math.min(pending, quotes.length);
      } else if (token.type === "inline") {
        // Opening order matters: an outer quote consumes its marker before
        // an inner quote sees that same first inline token. Each is visited once.
        while (pending < quotes.length) {
          const quote = quotes[pending++]!;
          const match = /^\[!([\w-]+)\]([^\n\r]*)/.exec(token.content);
          if (!match || !recognized.has(match[1]!.toLowerCase())) continue;
          quote.type = "vitepress_alert_open";
          quote.tag = "div";
          quote.info = match[1]!.toLowerCase() + "\n" + match[2]!.trim();
          token.content = token.content.slice(match[0].length).trimStart();
        }
      }
    }
  });
  if (options.attrs !== false)
    parser.use(attrs, {
      rule: [
        "inline",
        "table",
        "list",
        "heading",
        "hr",
        "softbreak",
        "blockInfo",
        "blockEnd",
        "tasklist",
      ],
    });
  parser.use(fullEmoji);
  if (options.tasklist !== false) parser.use(tasklist);
  if (options.footnote !== false) parser.use(footnote);
  if (options.cjkFriendlyEmphasis !== false) parser.use(cjkFriendly);
  if (options.math) parser.use(mathSyntax);
  parser.use(componentPlugin);
  parser.block.ruler.before("fence", "vitepress_snippet", (state, start, _end, silent) => {
    const at = state.bMarks[start]! + state.tShift[start]!;
    if (state.sCount[start]! - state.blkIndent >= 4 || !state.src.startsWith("<<<", at))
      return false;
    if (silent) return true;
    const token = state.push("vitepress_snippet", "", 0);
    token.content = state.src.slice(at, state.eMarks[start]);
    token.map = [start, start + 1];
    state.line = start + 1;
    return true;
  });
  parser.block.ruler.before(
    "paragraph",
    "vitepress_toc",
    (state, start, _end, silent) => {
      const at = state.bMarks[start]! + state.tShift[start]!;
      if (!/^\[\[toc\]\]/i.test(state.src.slice(at, state.eMarks[start]))) return false;
      if (silent) return true;
      const token = state.push("vitepress_toc", "", 0);
      token.content = state.src.slice(at, state.eMarks[start]);
      token.map = [start, start + 1];
      state.line = start + 1;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );
  if (parsers.size >= 16) parsers.delete(parsers.keys().next().value!);
  parsers.set(key, parser);
  return parser;
}

/** Synchronous syntax only: no file reads, Vue compilation, or MathJax rendering. */
export function readVitePress(source: string, options: VitePressOptions = {}): Token[] {
  const end = frontmatterEnd(source);
  return parserFor(options).parse(blank(source.slice(0, end)) + source.slice(end), {});
}
