import type { Code } from "mdast";
import type Token from "markdown-it/lib/token.mjs";
import type { Document, Workspace } from "../../core/types.js";
import { walk } from "../walk.js";
import { frontmatterEnd } from "./reader.js";
import { vitepressTokens } from "./projection.js";

const newline = (text: string) => text.replace(/\r\n|\r/g, "\n");
const element = (token: Token, closing: boolean) =>
  token.nesting === (closing ? -1 : 1) ||
  ["code_inline", "image", "math_inline", "emoji", "checkbox_input", "footnote_ref"].includes(
    token.type,
  ) ||
  (token.type === "html_inline" && (closing ? /^<\// : /^<[^/!]/).test(token.content));

/** VitePress's non-mdast reading, including Vue's newline-only element gaps. */
export function vitepressSemantics(
  document: Document,
  workspace?: Workspace,
  approved?: WeakMap<Code, string>,
): unknown {
  const values = new Map<number, string>();
  if (approved)
    walk(document.tree, "code", (node) => {
      if (approved.has(node) && node.position)
        values.set(node.position.start.line - 1, approved.get(node)!);
    });
  const url = (value: string) => {
    const found = workspace?.resolve(document.path, value, "vitepress");
    return found?.status === "resolved" ? `${found.target}#${found.fragment ?? ""}` : value;
  };
  const tokenValue = (token: Token): unknown => {
    const attributes = token.attrs?.map(([name, value]) => [
      name,
      name === "href" || name === "src" ? url(value) : value,
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
      ...(token.type === "fence" || token.type.startsWith("container_")
        ? { info: token.info.trim() }
        : {}),
      ...(token.children ? { children: inline(token.children) } : {}),
      ...(token.type === "footnote_ref" ? { meta: token.meta as unknown } : {}),
    };
  };
  function inline(tokens: Token[]): unknown[] {
    const result: unknown[] = [];
    const add = (value: unknown) => {
      const current = value as { type?: string; content?: string };
      const previous = result.at(-1) as { type?: string; content?: string } | undefined;
      if (current.type === "text" && previous?.type === "text")
        previous.content = (previous.content ?? "") + current.content;
      else result.push(value);
    };
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!;
      if (
        token.type === "softbreak" ||
        (token.type === "text" && /^[ \t\n]+$/.test(token.content))
      ) {
        const from = index;
        let hasNewline = token.type === "softbreak" || /\n/.test(token.content);
        while (index + 1 < tokens.length) {
          const next = tokens[index + 1]!;
          if (
            next.type !== "softbreak" &&
            !(next.type === "text" && /^[ \t\n]+$/.test(next.content))
          )
            break;
          hasNewline ||= next.type === "softbreak" || /\n/.test(next.content);
          index++;
        }
        const before = tokens[from - 1];
        const after = tokens[index + 1];
        if (!(hasNewline && before && after && element(before, true) && element(after, false)))
          add({ type: "text", content: " " });
      } else add(tokenValue(token));
    }
    return result;
  }
  const end = frontmatterEnd(document.source);
  return {
    frontmatter: newline(document.source.slice(0, end)),
    tokens: vitepressTokens(document).map(tokenValue),
  };
}
