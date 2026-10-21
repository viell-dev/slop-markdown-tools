import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";

// Syntax only, adapted from markdown-it-mathjax3 4.3.2. See THIRD_PARTY_NOTICES.
// Keep its delimiter decisions, including its treatment of the first potential
// closing dollar; no MathJax evaluation belongs in the portable parser.
function delimiter(state: StateInline, at: number) {
  const before = state.src.charCodeAt(at - 1);
  const after = state.src.charCodeAt(at + 1);
  return {
    open: after !== 0x20 && after !== 0x09,
    close: before !== 0x20 && before !== 0x09 && !(after >= 0x30 && after <= 0x39),
  };
}
function inline(state: StateInline, silent: boolean): boolean {
  if (state.src[state.pos] !== "$") return false;
  if (!delimiter(state, state.pos).open) {
    if (!silent) state.pending += "$";
    state.pos++;
    return true;
  }
  const start = state.pos + 1;
  let end = start;
  while ((end = state.src.indexOf("$", end)) !== -1) {
    let previous = end - 1;
    while (state.src[previous] === "\\") previous--;
    if ((end - previous) % 2 === 1) break;
    end++;
  }
  if (end < 0 || end === start || !delimiter(state, end).close) {
    const empty = end === start;
    if (!silent) state.pending += empty ? "$$" : "$";
    state.pos = start + (empty ? 1 : 0);
    return true;
  }
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.markup = "$";
    token.content = state.src.slice(start, end);
  }
  state.pos = end + 1;
  return true;
}
function block(state: StateBlock, start: number, end: number, silent: boolean): boolean {
  let at = state.bMarks[start]! + state.tShift[start]!;
  let limit = state.eMarks[start]!;
  if (at + 2 > limit || state.src.slice(at, at + 2) !== "$$") return false;
  if (silent) return true;
  let first = state.src.slice(at + 2, limit);
  let found = first.trim().endsWith("$$");
  if (found) first = first.trim().slice(0, -2);
  let next = start;
  let last = "";
  while (!found) {
    if (++next >= end) break;
    at = state.bMarks[next]! + state.tShift[next]!;
    limit = state.eMarks[next]!;
    if (at < limit && state.tShift[next]! < state.blkIndent) break;
    if (state.src.slice(at, limit).trim().endsWith("$$")) {
      last = state.src.slice(at, state.src.lastIndexOf("$$", limit - 1));
      found = true;
    }
  }
  state.line = next + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content =
    (first.trim() ? first + "\n" : "") +
    state.getLines(start + 1, next, state.tShift[start]!, true) +
    (last.trim() ? last : "");
  token.map = [start, state.line];
  token.markup = "$$";
  return true;
}
/** Register the syntax used by markdown-it-mathjax3, without its renderer. */
export function mathSyntax(parser: MarkdownIt): void {
  parser.inline.ruler.after("escape", "math_inline", inline);
  parser.block.ruler.after("blockquote", "math_block", block, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
}
