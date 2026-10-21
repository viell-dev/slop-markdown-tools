import path from "node:path";
import { slug } from "github-slugger";
import type { VitePressOptions } from "../core/types.js";
import { readVitePress, frontmatterEnd } from "../syntax/vitepress/reader.js";
import { htmlAnchors, htmlTokens } from "./html.js";
import { lineStarts } from "../syntax/source.js";
import { splitByteOrderMark } from "../syntax/parse.js";

/** The slugger shared by VitePress 2 headings and rewritten link fragments. */
export function vitepressSlug(text: string, options: VitePressOptions = {}): string {
  if (options.anchor === "github") return slug(text);
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      // eslint-disable-next-line no-control-regex -- Match VitePress's deliberate removal of C0 controls.
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^(\d)/, "_$1")
      .toLowerCase()
  );
}
interface Heading {
  id: string;
  depth: number;
  start: number;
  end: number;
}
/** The actual heading text/attribute tokens, not mdast's approximation. */
function anchors(source: string, options: VitePressOptions) {
  source = splitByteOrderMark(source)[1];
  const tokens = readVitePress(source, options);
  const ids = new Set<string>();
  const used = new Set<string>();
  const next = new Map<string, number>();
  const headings: Heading[] = [];
  let complete = true;
  for (const [index, token] of tokens.entries()) {
    if (token.type === "heading_open") {
      if (
        tokens[index + 1]?.children?.some((child) => child.content.includes("$frontmatter")) &&
        token.attrGet("id") === null
      )
        complete = false;
      const explicit = token.attrGet("id");
      let id = explicit;
      if (id === null) {
        const text =
          tokens[index + 1]?.children
            ?.filter((child) => !["html_inline", "emoji"].includes(child.type))
            .map((child) => child.content)
            .join("") ?? "";
        const base = vitepressSlug(text, options);
        id = base;
        let suffix = next.get(base) ?? 1;
        while (used.has(id)) id = `${base}-${suffix++}`;
        next.set(base, suffix);
      }
      used.add(id);
      ids.add(id);
      if (token.map)
        headings.push({
          id,
          depth: Number(token.tag.slice(1)),
          start: token.map[0],
          end: token.map[1],
        });
    }
    const id = token.attrGet("id");
    if (id !== null) ids.add(id);
    const children = token.children ?? [];
    for (const child of children) {
      const id = child.attrGet("id");
      if (id !== null) ids.add(id);
    }
    for (const literal of [token, ...children])
      if (literal.type === "html_block" || literal.type === "html_inline")
        for (const id of htmlAnchors(htmlTokens(literal.content))) ids.add(id);
  }
  return { ids, headings, complete };
}
export interface VitePressAnchors {
  ids: Set<string>;
  /** False if any included text/selector was unavailable within the workspace. */
  complete: boolean;
}
/** Includes are text supplied by the host, never filesystem reads in the library. */
export function vitepressAnchors(
  source: string,
  filename: string,
  options: VitePressOptions,
  root: string,
  load: (name: string) => string | undefined,
): VitePressAnchors {
  let complete = true;
  let bytes = 0;
  let visits = 0;
  const expand = (text: string, file: string, ancestors: readonly string[]): string => {
    if (ancestors.length > 64 || ++visits > 10000 || (bytes += text.length) > 16 * 1024 * 1024) {
      complete = false;
      return "";
    }
    const starts = lineStarts(text);
    const fences = readVitePress(text, options)
      .filter((token) => token.type === "fence" && token.map)
      .map((token) => ({
        start: starts[token.map![0]] ?? text.length,
        end: starts[token.map![1]] ?? text.length,
      }));
    let fenceIndex = 0;
    return text.replace(
      /<!--\s*@include:\s*(.*?)\s*-->/g,
      (written: string, raw: string, offset: number) => {
        if (!raw) return written;
        const range = /\{(\d*),(\d*)\}$/.exec(raw);
        if (range) raw = raw.slice(0, range.index);
        const region = /#([^\s{]+)$/.exec(raw);
        if (region) raw = raw.slice(0, region.index);
        const target = path.posix.normalize(
          raw.startsWith("@")
            ? path.posix.join(
                root,
                raw.slice(/^[\\/]/.test(raw[1] ?? "") ? 2 : 1).replaceAll("\\", "/"),
              )
            : path.posix.join(path.posix.dirname(file), raw.replaceAll("\\", "/")),
        );
        if (target === ".." || target.startsWith("../") || path.posix.isAbsolute(target)) {
          complete = false;
          return written;
        }
        // VitePress leaves cycles as comments rather than recursively expanding them.
        if (target === file || ancestors.includes(target)) return written;
        let content = load(target);
        if (content === undefined) {
          complete = false;
          return written;
        }
        const markdown = path.posix.extname(target) === ".md";
        if (markdown && (region || !range)) {
          content = splitByteOrderMark(content)[1];
          content = content.slice(frontmatterEnd(content));
        }
        let lines = content.split("\n");
        if (region) {
          const regions = regionLines(lines, region[1]!);
          if (regions.length) lines = regions.flatMap((part) => lines.slice(part.start, part.end));
          else {
            const found = anchors(content, options).headings;
            const index = found.findIndex((heading) => heading.id === region[1]);
            const heading = found[index];
            if (!heading) {
              complete = false;
              return written;
            }
            const next = found
              .slice(index + 1)
              .find((candidate) => candidate.depth <= heading.depth);
            lines = lines.slice(heading.end, next?.start);
          }
        }
        if (range) {
          const start = range[1] ? Number(range[1]) : 1;
          const end = range[2] ? Number(range[2]) : lines.length;
          if (start < 1 || end < start || end > lines.length) {
            complete = false;
            return written;
          }
          lines = lines.slice(start - 1, end);
        }
        const expanded = expand(lines.join("\n"), target, [...ancestors, file]);
        const before = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);
        const after = text.slice(offset + written.length).split("\n", 1)[0]!;
        // Rebase marker comments separate standalone Markdown includes into blocks.
        // Inside code, inclusion remains literal code. The text need not be rebased
        // to collect anchors: link validation of an include belongs to its own file.
        while (fenceIndex < fences.length && fences[fenceIndex]!.end <= offset) fenceIndex++;
        const inside = fences[fenceIndex] && fences[fenceIndex]!.start <= offset;
        return markdown && !before.trim() && !after.trim() && !inside
          ? `\n\n${expanded}\n\n`
          : expanded;
      },
    );
  };
  const expanded = source.includes("@include") ? expand(source, filename, []) : source;
  const collected = anchors(expanded, options);
  return {
    ids: new Set([...collected.ids].map((id) => id.split("").join(""))),
    complete: complete && collected.complete,
  };
}

// The region grammar follows VitePress's regions.ts. See THIRD_PARTY_NOTICES.
const regionMarkers = [
  [
    /^\s*(?:\/\/\s*#?|(?:--|::|@?[rR][eE][mM])\s*#)region\b\s*(.*?)\s*$/,
    /^\s*(?:\/\/\s*#?|(?:--|::|@?[rR][eE][mM])\s*#)endregion\b\s*(.*?)\s*$/,
  ],
  [
    /^\s*#\s*(?:#\s*|pragma\s+)?[rR]egion\b\s*(.*?)\s*$/,
    /^\s*#\s*(?:#\s*|pragma\s+)?[eE]nd ?[rR]egion\b\s*(.*?)\s*$/,
  ],
  [/^\s*<!--\s*#?region\b\s*(.*?)\s*-->/, /^\s*<!--\s*#?endregion\b\s*(.*?)\s*-->/],
  [/^\s*\/\*\s*#region\b\s*(.*?)\s*\*\//, /^\s*\/\*\s*#endregion\b\s*(.*?)\s*\*\//],
  [/^\s*\(\*\s*#region\b\s*(.*?)\s*\*\)/, /^\s*\(\*\s*#endregion\b\s*(.*?)\s*\*\)/],
  [
    /^\s*"\/{2,}\s*#region\b\s*(.*?)":\s*"",?\s*$/,
    /^\s*"\/{2,}\s*#endregion\b\s*(.*?)":\s*"",?\s*$/,
  ],
] as const;
function regionLines(lines: string[], wanted: string): { start: number; end: number }[] {
  const open: { name: string; start: number; style: number }[] = [];
  const found: { start: number; end: number }[] = [];
  const unquote = (name: string) => (/^".*"$/.test(name) ? name.slice(1, -1) : name);
  for (const [index, line] of lines.entries()) {
    if (!/region/i.test(line)) continue;
    let started = false;
    for (const [style, [start]] of regionMarkers.entries()) {
      const match = start.exec(line);
      if (!match) continue;
      open.push({ name: unquote(match[1]!), start: index + 1, style });
      started = true;
      break;
    }
    if (started || !open.length) continue;
    for (const [style, [, end]] of regionMarkers.entries()) {
      const match = end.exec(line);
      if (!match) continue;
      const name = unquote(match[1]!);
      const at = open.findLastIndex((entry) =>
        name ? entry.name === name : entry.style === style,
      );
      if (at >= 0) {
        const closed = open[at]!;
        open.length = at;
        if (closed.name === wanted && !open.some((entry) => entry.name === wanted))
          found.push({ start: closed.start, end: index });
      }
      break;
    }
  }
  return found;
}
