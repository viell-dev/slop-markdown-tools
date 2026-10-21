import type { Code } from "mdast";
import type { Document, Edit } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { codeFence } from "../syntax/fences.js";
import { lineBreak, lineEnd, lineEnding, lineStart } from "../syntax/source.js";

/** Alternative safe reconstructions; the caller must verify the complete tree. */
export function codeEdits(
  document: Document,
  node: Code,
  output: string,
  normalize: boolean,
): { value: string; choices: Edit[][] } | undefined {
  const { source } = document;
  const fence = codeFence(source, node);
  if (!fence || fence.marker === "$") return undefined;
  const [, end] = range(node);
  const newline = lineEnding(source);
  const normalized = output.replace(/\r\n|\r/g, "\n");
  const value = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const openEnd = lineEnd(source, fence.open[1]);
  const afterOpen =
    openEnd + (source.startsWith("\r\n", openEnd) ? 2 : openEnd < source.length ? 1 : 0);
  const contentEnd = fence.close ? lineStart(source, fence.close[0]) : end;
  const rawPrefix = source.slice(lineStart(source, fence.open[0]), fence.open[0]);
  const prefix = rawPrefix
    .replace(/\[\^[^\]]+\]:[ \t]*/g, "    ")
    .replace(/[-+*]|\d{1,9}[.)]/g, (marker) => " ".repeat(marker.length));
  const prefixes = [prefix];
  if (fence.close) prefixes.push(source.slice(contentEnd, fence.close[0]));
  // A content line's exact stripped prefix is useful for unusual container
  // indentation. Its suffix must be the parser's corresponding literal value.
  const bodyLines = source.slice(afterOpen, contentEnd).split(lineBreak);
  const originalValues = node.value.split(lineBreak);
  for (let index = 0; index < originalValues.length; index++) {
    const literal = originalValues[index]!;
    const written = bodyLines[index];
    if (literal.length && written?.endsWith(literal)) {
      prefixes.push(written.slice(0, -literal.length));
      break;
    }
  }
  let longest = 0;
  for (const line of value.split("\n")) {
    const run = /^[ \t]*(`+|~+)/.exec(line)?.[1];
    if (run?.[0] === fence.marker) longest = Math.max(longest, run.length);
  }
  const length = Math.max(normalize ? 3 : fence.open[1] - fence.open[0], longest + 1);
  const marker = fence.marker.repeat(length);
  const closingMarker = fence.marker.repeat(
    !normalize && fence.close ? Math.max(length, fence.close[1] - fence.close[0]) : length,
  );
  const choices = [...new Set(prefixes)].map((continuation) => {
    const body =
      value === ""
        ? ""
        : value
            .split("\n")
            .map((line) => continuation + line)
            .join(newline) + newline;
    const opening = marker + source.slice(fence.open[1], openEnd);
    const ending = source.slice(openEnd, afterOpen) || (body !== "" ? newline : "");
    const closing = fence.close
      ? source.slice(contentEnd, fence.close[0]) + closingMarker + source.slice(fence.close[1], end)
      : "";
    // One edit also handles an empty body and a longer closing run at the same
    // position, without proposing overlapping insertion and replacement edits.
    return [{ start: fence.open[0], end, text: opening + ending + body + closing }];
  });
  // mdast retains CR and CRLF in literal code values, unlike ordinary text's
  // fingerprint. Match the document's reinserted line endings exactly.
  return { value: value.replaceAll("\n", newline), choices };
}
