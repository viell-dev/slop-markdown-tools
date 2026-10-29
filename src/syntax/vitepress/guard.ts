import type { Code } from "mdast";
import type Token from "markdown-it/lib/token.mjs";
import type { Document, Workspace } from "../../core/types.js";
import { walk } from "../walk.js";
import { frontmatterEnd } from "./reader.js";
import { vitepressTokens } from "./projection.js";
import { inlineElement, onlyWhitespace } from "./whitespace.js";
import { vitepressPage } from "./paths.js";

const newline = (text: string) => text.replace(/\r\n|\r/g, "\n");

/** VitePress's non-mdast reading, including Vue's newline-only element gaps. */
export function vitepressSemantics(
  document: Document,
  workspace?: Workspace,
  approved?: WeakMap<Code, string>,
  approvedFrontMatter?: string,
): unknown {
  const values = new Map<number, string>();
  if (approved)
    walk(document.tree, "code", (node) => {
      if (approved.has(node) && node.position)
        values.set(node.position.start.line - 1, approved.get(node)!);
    });
  const url = (value: string) => {
    const found = workspace?.resolve(document.path, value, "vitepress");
    return found?.status === "resolved" && typeof found.target === "string" && !found.unreadable
      ? {
          fragment: found.fragment ?? "",
          query: /\?[^#]*/.exec(value.split("#", 1)[0]!)?.[0] ?? "",
          target: found.target,
        }
      : value;
  };
  const tokenValue = (token: Token): unknown => {
    const attributes = token.attrs?.map(([name, value]) => [
      name,
      name === "src" ||
      (name === "href" &&
        (!vitepressPage(value) ||
          ((token.attrGet("target") !== null || token.attrGet("download") !== null) &&
            !value.startsWith("#"))))
        ? value
        : name === "href"
          ? url(value)
          : value,
    ]);
    let content = newline(token.content);
    if (token.type === "text") return { type: "text", content: content.replace(/[ \t\n]+/g, " ") };
    if (token.type === "inline") content = "";
    if (token.type === "fence" || token.type === "code_block") {
      const replacement = token.map ? values.get(token.map[0]) : undefined;
      content = replacement === undefined ? content.replace(/\n$/, "") : newline(replacement);
    }
    return {
      type: token.type,
      tag: token.tag,
      nesting: token.nesting,
      hidden: token.hidden,
      attributes,
      content,
      ...(token.type === "fence" ||
      token.type === "vitepress_alert_open" ||
      token.type.startsWith("container_")
        ? { info: token.info.trim() }
        : {}),
      ...(token.children ? { children: inline(token.children) } : {}),
      ...(token.type === "footnote_ref" ? { meta: token.meta as unknown } : {}),
    };
  };
  function inline(tokens: Token[]): unknown[] {
    const result: unknown[] = [];
    let text: string[] = [];
    let endsWithSpace = false;
    const flush = () => {
      if (text.length) result.push({ type: "text", content: text.join("") });
      text = [];
      endsWithSpace = false;
    };
    const add = (value: unknown) => {
      const current = value as { type?: string; content?: string };
      if (current.type === "text") {
        let content = current.content ?? "";
        if (endsWithSpace && content.startsWith(" ")) content = content.slice(1);
        if (content) {
          text.push(content);
          endsWithSpace = content.endsWith(" ");
        }
      } else {
        flush();
        result.push(value);
      }
    };
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!;
      if (onlyWhitespace(token)) {
        const from = index;
        let hasNewline = token.type === "softbreak" || /\n/.test(token.content);
        while (index + 1 < tokens.length) {
          const next = tokens[index + 1]!;
          if (!onlyWhitespace(next)) break;
          hasNewline ||= next.type === "softbreak" || /\n/.test(next.content);
          index++;
        }
        const before = tokens[from - 1];
        const after = tokens[index + 1];
        if (!(
          hasNewline &&
          before &&
          after &&
          inlineElement(before, true) &&
          inlineElement(after, false)
        ))
          add({ type: "text", content: " " });
      } else add(tokenValue(token));
    }
    flush();
    return result;
  }
  const end = frontmatterEnd(document.source);
  return {
    frontmatter: newline(
      end > 0 && approvedFrontMatter !== undefined
        ? approvedFrontMatter
        : document.source.slice(0, end),
    ),
    tokens: vitepressTokens(document).map(tokenValue),
  };
}
