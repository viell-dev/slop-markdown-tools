import type { Nodes, Root } from "mdast";
import type { Document, Edit } from "../core/types.js";
import { lineStarts } from "./source.js";
import { walk } from "./walk.js";
import { startsWithMarker } from "./parse.js";

type Range = [number, number];
const found = new WeakMap<Root, Range[]>();
const structural = new Set([
  "style/block-spacing",
  "style/blank-lines",
  "style/list-indent",
  "style/list-marker",
  "style/ordered-list",
  "style/table",
  "style/heading",
  "style/wrap",
]);
// Properly indented blocks inside an item/definition have explicit containment.
// Their genuinely lazy physical lines are handled separately below.
const containers = new Set(["root", "blockquote"]);
const continuations = new Set([
  "list",
  "blockquote",
  "html",
  "table",
  "code",
  "footnoteDefinition",
  "definition",
]);

/** General conservative block-boundary policy; existing native-specific guards remain. */
function boundaries(document: Document): Range[] {
  const cached = found.get(document.tree);
  if (cached) return cached;
  const { source } = document;
  const starts = lineStarts(source);
  const ranges: Range[] = [];
  const rows = (from: number, to = from) => {
    const start = starts[from - 1],
      end = starts[to] ?? source.length;
    if (start !== undefined && start < end) ranges.push([start, end]);
  };
  const text = (node: Nodes) =>
    node.type === "paragraph" ||
    (node.type === "heading" &&
      node.position &&
      node.position.end.line >
        (node.children.at(-1)?.position?.end.line ?? node.position.start.line));
  const leading = (value: string) => /^[ \t>]*/.exec(value)![0];
  const column = (value: string) => {
    let result = 0;
    for (const char of value) result = char === "\t" ? result + 4 - (result % 4) : result + 1;
    return result;
  };
  // Literal code interiors are not Markdown boundary candidates.
  const code = new Uint8Array(starts.length);
  walk(document.tree, (node, _index, parent) => {
    if (node.type === "code" && node.position)
      for (let line = node.position.start.line + 1; line <= node.position.end.line; line++)
        code[line - 1] = 1;
    if (containers.has(node.type) && "children" in node) {
      for (let index = 1; index < node.children.length; index++) {
        const before = node.children[index - 1]!,
          after = node.children[index]!;
        if (
          !before.position ||
          !after.position ||
          before.position.end.line + 1 !== after.position.start.line
        )
          continue;
        if (
          node.type === "blockquote" &&
          index === 1 &&
          before.type === "paragraph" &&
          startsWithMarker(
            source.slice(before.position.start.offset, before.position.end.offset),
            before,
          )
        )
          continue;
        if (
          (continuations.has(after.type) && text(before)) ||
          (continuations.has(before.type) && text(after))
        )
          rows(before.position.end.line, after.position.start.line);
      }
    }
    if (node.type !== "paragraph" || !node.position) return;
    const start = node.position.start.offset;
    if (start === undefined) return;
    const prefix = source.slice(starts[node.position.start.line - 1], start);
    const quotes = (prefix.match(/>/g) ?? []).length;
    const margin = column(prefix);
    for (let line = node.position.start.line + 1; line <= node.position.end.line; line++) {
      const value = source
        .slice(starts[line - 1], starts[line] ?? source.length)
        .replace(/[\r\n]+$/, "");
      const lead = leading(value);
      const ordered = /^(\d{1,9})[.)][ \t]+\S/.exec(value.slice(lead.length));
      const lazyQuote = (lead.match(/>/g) ?? []).length < quotes;
      const lazyList = parent?.type === "listItem" && column(lead) < margin;
      if (lazyQuote || lazyList || (ordered && Number(ordered[1]) !== 1)) rows(line - 1, line);
    }
  });
  for (let index = 0; index < starts.length; index++) {
    if (code[index]) continue;
    const value = source.slice(starts[index], starts[index + 1] ?? source.length);
    if (!value.includes("\t")) continue;
    let at = 0,
      container = false;
    while (at < value.length) {
      if (value[at] === " " || value[at] === "\t") {
        if (container && value[at] === "\t") {
          rows(index + 1);
          break;
        }
        at++;
        continue;
      }
      if (value[at] === ">") {
        container = true;
        at++;
        continue;
      }
      const marker = /^(?:[-+*]|\d{1,9}[.)])(?=[ \t])/.exec(value.slice(at, at + 12));
      if (!marker) break;
      container = true;
      at += marker[0].length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range);
  }
  found.set(document.tree, merged);
  return merged;
}

/** Only the actually changed portion counts; copied safe prefixes/suffixes remain editable. */
export function ambiguousObsidianEdit(document: Document, rule: string, edit: Edit): boolean {
  if (document.dialect !== "obsidian" || !structural.has(rule)) return false;
  let { start, end } = edit;
  const before = document.source.slice(start, end),
    after = edit.text;
  if (before === after) return false;
  let prefix = 0,
    suffix = 0;
  const shorter = Math.min(before.length, after.length);
  while (prefix < shorter && before[prefix] === after[prefix]) prefix++;
  while (suffix < shorter - prefix && before.at(-1 - suffix) === after.at(-1 - suffix)) suffix++;
  start += prefix;
  end -= suffix;
  const ranges = boundaries(document);
  let low = 0,
    high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle]![1] < start || (start !== end && ranges[middle]![1] === start))
      low = middle + 1;
    else high = middle;
  }
  const range = ranges[low];
  return (
    range !== undefined &&
    (start === end ? range[0] <= start && start <= range[1] : start < range[1] && end > range[0])
  );
}
