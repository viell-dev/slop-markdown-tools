import type Token from "markdown-it/lib/token.mjs";

/** Whether a token can border a whitespace-only Vue text node. */
export function inlineElement(token: Token, closing: boolean): boolean {
  if (token.nesting === (closing ? -1 : 1)) return true;
  if (
    ["code_inline", "image", "math_inline", "checkbox_input", "footnote_ref"].includes(token.type)
  )
    return true;
  if (token.type !== "html_inline") return false;
  return closing
    ? /^<\//.test(token.content) ||
        /\/>$/.test(token.content) ||
        /^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(
          token.content,
        )
    : /^<[^/!]/.test(token.content);
}
export function onlyWhitespace(token: Token): boolean {
  return token.type === "softbreak" || (token.type === "text" && /^[ \t\n]+$/.test(token.content));
}
/** Adding or removing a newline in one of these gaps changes Vue's output. */
export function hasVueElementGap(tokens: readonly Token[]): boolean {
  for (let index = 0; index < tokens.length; index++) {
    if (!onlyWhitespace(tokens[index]!)) continue;
    const before = tokens[index - 1];
    while (index + 1 < tokens.length && onlyWhitespace(tokens[index + 1]!)) index++;
    const after = tokens[index + 1];
    if (before && after && inlineElement(before, true) && inlineElement(after, false)) return true;
  }
  return false;
}
