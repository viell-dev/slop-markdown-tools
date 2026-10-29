import type { Nodes, Parents } from "mdast";
import type { Document } from "../core/types.js";
import type { ProtectionSource } from "./protection-source.js";
import { leaves } from "./protection-source.js";
import { interruptingHtml } from "./obsidian-html-protections.js";
import { escaped } from "./source.js";

interface Container {
  quotes: number;
  indent: number;
}

/** Remove only existing quote markers; a new quote can interrupt the paragraph. */
function withoutQuotes(line: string, quotes: number): string {
  let at = 0;
  for (let quote = 0; quote < quotes; quote++) {
    const marker = /^[ \t]{0,3}>[ \t]?/.exec(line.slice(at));
    if (!marker) break; // A paragraph may continue lazily without its markers.
    at += marker[0].length;
  }
  return line.slice(at);
}

function columns(text: string): number {
  let column = 0;
  for (const character of text) column += character === "\t" ? 4 - (column % 4) : 1;
  return column;
}

function content(line: string, container: Container): { text: string; indent: number } {
  const value = withoutQuotes(line, container.quotes);
  const margin = /^[ \t]*/.exec(value)![0];
  return { text: value.slice(margin.length), indent: columns(margin) - container.indent };
}

/** Goldmark collects paragraph lines before transforming them into a table (#661). */
function interrupts(text: string, indent: number): boolean {
  if (!text) return true;
  if (indent > 3) return false;
  const marker = /^(?:([-+*])|(\d{1,9})[.)])(?:[ \t]+(.*)|$)/.exec(text);
  return (
    (marker !== null && !!marker[3]?.trim() && (!!marker[1] || Number(marker[2]) === 1)) ||
    /^(?:>|#{1,6}(?:[ \t]|$)|`{3,}[^`]*$|~{3,})/.test(text) ||
    /^(?:=+|-+)[ \t]*$/.test(text) ||
    /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text) ||
    interruptingHtml.test(text)
  );
}

/** Split physical cells as Goldmark does, retaining escaped pipes in their cell. */
function cells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !escaped(value, value.length - 1)) value = value.slice(0, -1);
  const result: string[] = [];
  let start = 0;
  for (let at = 0; at < value.length; at++) {
    if (value[at] === "|" && !escaped(value, at)) {
      result.push(value.slice(start, at));
      start = at + 1;
    }
  }
  result.push(value.slice(start));
  return result;
}

/** Native forge readings absent from the GFM tree, shared by every edit producer. */
export function collectForgeProtections(
  document: Document,
  positions: ProtectionSource,
  tableText: Set<Nodes>,
  boundaryText: Set<Nodes>,
): void {
  if (document.dialect !== "forgejo" && document.dialect !== "gitea") return;
  const { source } = document;
  const { lineAround, lineStart, laterLines } = positions;
  const region = (node: Nodes, start: number, end: number): Nodes => ({
    ...node,
    position: {
      start: { ...node.position!.start, offset: start },
      end: { ...node.position!.end, offset: end },
    },
  });
  let tableUntil = 0;
  const visit = (parent: Parents, container: Container) => {
    for (let index = 0; index < parent.children.length; index++) {
      const node = parent.children[index]!;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      if (node.type === "table" && start >= tableUntil) {
        // GFM already owns ordinary body rows. The divergence starts at a line
        // that would continue Goldmark's paragraph-backed table: a list that
        // cannot interrupt it, or a lazy line below a table that ends a list
        // item or quote, which GFM ends the container at (#770).
        let until = end;
        for (let after = end; after < source.length;) {
          const from = after + (source.startsWith("\r\n", after) ? 2 : 1);
          if (from >= source.length) break;
          const to = lineAround(from)[1];
          const row = content(source.slice(from, to), container);
          if (interrupts(row.text, row.indent)) break;
          until = to;
          after = to;
        }
        if (until > end) {
          tableText.add(region(node, lineStart(start), until));
          tableUntil = until;
        }
      }
      if (node.type === "paragraph") {
        const lines: [number, number][] = [[start, Math.min(lineAround(start)[1], end)]];
        lines.push(...laterLines(start, end));
        for (let line = 1; line < lines.length; line++) {
          const [from, to] = lines[line]!;
          const delimiter = content(source.slice(from, to), container).text;
          const delimiters = cells(delimiter);
          if (!delimiters.every((cell) => /^[ \t]*:?-+:?[ \t]*$/.test(cell))) continue;
          const [headerFrom, headerTo] = lines[line - 1]!;
          const header = content(source.slice(headerFrom, headerTo), container).text;
          if (cells(header).length !== delimiters.length) continue;
          // Protect the boundary too: joining the introduction to the header
          // destroys the native table (#663). Earlier prose remains editable.
          let before = headerFrom;
          if (source[before - 1] === "\n") before--;
          if (source[before - 1] === "\r") before--;
          boundaryText.add(region(node, before, end));
          break;
        }
        const links = (inline: Nodes) => {
          if (inline.type === "link" && inline.position) {
            const a = inline.position.start.offset!;
            const b = inline.position.end.offset!;
            // Literal URLs can consume the backslash in the primary tree.
            // Goldmark still reads a single terminal backslash as a hard break
            // (#664); native runs of two or more are URL/text, not hard breaks.
            if (
              source[a] !== "[" &&
              source[a] !== "<" &&
              b < end &&
              source[b - 1] === "\\" &&
              source[b - 2] !== "\\" &&
              /[\r\n]/.test(source[b]!)
            ) {
              let before = b;
              while (before > a && source[before - 1] === "\\") before--;
              boundaryText.add(region(inline, before, b + (source.startsWith("\r\n", b) ? 2 : 1)));
            }
          }
          if ("children" in inline) for (const child of inline.children) links(child);
        };
        links(node);
      }
      if ("children" in node && !leaves.has(node.type)) {
        let nested = container;
        if (node.type === "blockquote") nested = { quotes: container.quotes + 1, indent: 0 };
        else if (node.type === "listItem") {
          const first = node.children[0]?.position?.start.offset;
          if (first !== undefined)
            nested = {
              quotes: container.quotes,
              indent: columns(
                withoutQuotes(source.slice(lineStart(first), first), container.quotes),
              ),
            };
        }
        visit(node, nested);
      }
    }
  };
  visit(document.tree, { quotes: 0, indent: 0 });
}
