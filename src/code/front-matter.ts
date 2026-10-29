import type { Yaml, Literal } from "mdast";
export interface Toml extends Literal {
  type: "toml";
}
declare module "mdast" {
  interface RootContentMap {
    toml: Toml;
  }
}
import type { Document, Edit } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { applyEdits } from "../core/engine.js";
import { lineEnding } from "../syntax/source.js";

/** Replace only a closed metadata body's source, retaining both delimiter lines. */
export function frontMatterBody(document: Document, node: Yaml | Toml): string {
  if (document.dialect !== "vitepress") return node.value;
  const opening = /^(?:---|\+\+\+)[ \t]*(?:\r\n|\r|\n)/.exec(node.value);
  const closing = /(?:\r\n|\r|\n)(?:---|\+\+\+)[ \t]*(?:\r\n|\r|\n)?$/.exec(node.value);
  if (!opening || !closing) return node.value;
  return node.value.slice(opening[0].length, Math.max(opening[0].length, closing.index));
}
export function frontMatterEdits(
  document: Document,
  node: Yaml | Toml,
  output: string,
): { value: string; choices: Edit[][] } | undefined {
  const [start, end] = range(node);
  const original = document.source.slice(start, end);
  const opening = /^(?:---|\+\+\+)[ \t]*(?:\r\n|\r|\n)/.exec(original);
  const closing = /(?:\r\n|\r|\n)(?:---|\+\+\+)[ \t]*(?:\r\n|\r|\n)?$/.exec(original);
  if (!opening || !closing) return undefined;
  const newline = lineEnding(document.source);
  const value = output
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n$/, "")
    .replaceAll("\n", newline);
  const edit = {
    start: start + opening[0].length,
    end: start + closing.index + closing[0].match(/^(?:\r\n|\r|\n)/)![0].length,
    text: value === "" ? "" : value + newline,
  };
  return {
    value:
      document.dialect === "vitepress"
        ? applyEdits(original, [{ ...edit, start: edit.start - start, end: edit.end - start }])
        : value,
    choices: [[edit]],
  };
}
