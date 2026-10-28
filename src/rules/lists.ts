import type {
  Blockquote,
  FootnoteDefinition,
  Heading,
  List,
  ListItem,
  Nodes,
  Parents,
} from "mdast";
import type { Document, Finding, Rule } from "../core/types.js";
import { rendererProtections } from "../syntax/renderer-protections.js";
import { joinsTomlFrontMatter } from "../syntax/parse.js";
import { optionsSchema } from "./shared.js";
import { lineBreaks } from "../syntax/source.js";

/**
 * The list rules edit the markers of list items and the indentation that the
 * items' lines need. Each rule proposes one edit for each group of adjacent
 * lists outside other lists, which holds all its changes there, nested lists
 * included, so that an engine that applies some edits and holds others back
 * never applies half of a list's changes: a marker moved without its item's
 * lines would move the item's content.
 *
 * A list item's lines need as many columns of indentation as its marker,
 * the marker's indentation, and the space after it take up, counted from
 * where its container's part of the line starts. Lines with less are lazy
 * continuations of a paragraph. Changing those columns moves the item's
 * lines with them, and where that would change what a line belongs to, the
 * rule leaves the list as written.
 */

type Container = Blockquote | ListItem | FootnoteDefinition;

/** A physical line of the source, without its line break. */
interface Line {
  start: number;
  end: number;
}

interface Item {
  node: ListItem;
  list: ListGroup;
  index: number;
  /** The line indexes of the marker and of the item's last line. */
  first: number;
  last: number;
  marker: number;
  markerEnd: number;
  /** The number of an ordered item as written. */
  digits: string;
  /** The end of the whitespace after the marker. */
  spaceEnd: number;
  markerColumn: number;
  markerEndColumn: number;
  /** The columns of whitespace after the marker. */
  spacing: number;
  /** Whether nothing but whitespace follows the marker on its line. */
  blankFirst: boolean;
  /**
   * Where the item's part of its marker line starts, after the prefixes of
   * its containers, the columns of indentation before the marker, and the
   * columns that the item's other lines need from there. Undefined when the
   * marker line cannot be read exactly, such as when a tab spans a
   * container's prefix.
   */
  start?: number;
  offset?: number;
  width?: number;
}
interface ListGroup {
  node: List;
  items: Item[];
  /** The nearest block quote, list item, or footnote definition around it. */
  parent: Container | undefined;
  /** The list directly before it, which its first line could continue. */
  previous: ListGroup | undefined;
}
/** Adjacent lists outside other lists, with the lists nested in them. */
interface Unit {
  lists: ListGroup[];
  /** Runs of adjacent sibling lists of one kind, in the unit and nested in it. */
  runs: ListGroup[][];
  valid: boolean;
}
interface ContainerInfo {
  parent: Container | undefined;
  first: number;
  last: number;
}
/**
 * How one line passes through one of its containers. `content`: the line
 * continues inside the container from `end`. `blank`: only whitespace
 * follows `start`. `lazy`: the line lacks the container's prefix and
 * continues a paragraph. `unsupported`: a tab spans the prefix's end, or the
 * source does not have the expected shape.
 */
interface Level {
  node: Container;
  kind: "content" | "blank" | "lazy" | "unsupported";
  start: number;
  startColumn: number;
  end: number;
  endColumn: number;
  /** The columns of whitespace after `start`, for blank and lazy lines. */
  indent: number;
}
interface Matched {
  chain: Container[];
  levels: Level[];
}
interface Analysis {
  source: string;
  lines: Line[];
  units: Unit[];
  items: Map<ListItem, Item>;
  containers: Map<Container, ContainerInfo>;
  /**
   * Later lines of inline nodes that keep their whitespace, and lazy lines
   * whose margin supplies a renderer heading beyond the list (#554).
   */
  sensitive: Set<number>;
  match(line: number): Matched;
}
interface Op {
  start: number;
  end: number;
  text: string;
  /** What the change does, for the finding when it is the first one. */
  message?: string;
}

const tabStop = (column: number) => column + 4 - (column % 4);
const isSpace = (character: string | undefined) => character === " " || character === "\t";
/** The column reached from `column` at `from` after the characters up to `to`. */
function columnAt(source: string, from: number, to: number, column: number): number {
  for (let at = from; at < to; at++) column = source[at] === "\t" ? tabStop(column) : column + 1;
  return column;
}
function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const match of lineBreaks(source)) {
    lines.push({ start, end: match.index });
    start = match.index + match[0].length;
  }
  lines.push({ start, end: source.length });
  return lines;
}
const located = (node: Nodes) =>
  node.position?.start.offset !== undefined && node.position.end.offset !== undefined;
const isContainer = (node: Nodes): node is Container =>
  node.type === "blockquote" || node.type === "listItem" || node.type === "footnoteDefinition";

const analyses = new WeakMap<Document, Analysis>();
/** Heading-owned spaces after every container's required prefix, including Setext underlines. */
export function headingIndentation(document: Document, node: Heading): [number, number][] {
  const analysis = analyze(document);
  const result: [number, number][] = [];
  const first = node.children[0]?.position?.start.line ?? node.position!.start.line;
  for (let line = first - 1; line < node.position!.end.line; line++) {
    if (analysis.sensitive.has(line)) continue;
    const { levels } = analysis.match(line);
    if (levels.some((level) => level.kind !== "content")) continue;
    const start = levels.at(-1)?.end ?? analysis.lines[line]!.start;
    const spaces = /^ {1,3}(?=\S)/.exec(document.source.slice(start, analysis.lines[line]!.end));
    if (spaces) result.push([start, start + spaces[0].length]);
  }
  return result;
}
/** The lists of a document and the means to read their lines, shared by the list rules. */
function analyze(document: Document): Analysis {
  const known = analyses.get(document);
  if (known) return known;
  const { source } = document;
  const lines = splitLines(source);
  const units: Unit[] = [];
  const items = new Map<ListItem, Item>();
  const containers = new Map<Container, ContainerInfo>();
  const sensitive = new Set<number>();
  /** The innermost container of each line, by line index. */
  const innermost: (Container | undefined)[] = [];

  // Renderers may read a list where the parser read text that starts with a
  // list marker, the blocks indented below it inside that list's last item,
  // and the block after those as more of its items (issue #191). Another
  // marker or indentation could move a list among them into or out of that
  // item, or join it to that list, so its group of lists stays as written.
  const misread = rendererProtections(document);
  // Such text can look safe to capture while its lazy margin supplies a
  // later Live Preview heading. Reuse feasibility's existing margin guard.
  for (const line of misread.headingLazyLines) sensitive.add(line);

  const visit = (node: Parents, parent: Container | undefined, unit: Unit | undefined) => {
    const children = node.children as Nodes[];
    let group: Unit | undefined;
    let run: ListGroup[] | undefined;
    let before: ListGroup | undefined;
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      if (!located(child)) {
        if (unit) unit.valid = false;
        continue;
      }
      const firstLine = child.position!.start.line - 1;
      let lastLine = child.position!.end.line - 1;
      // Defensively bound blocks by their siblings and containers, including
      // positions supplied by external mdast extensions.
      const next = children[index + 1];
      if (next && located(next)) lastLine = Math.min(lastLine, next.position!.start.line - 2);
      if (parent) lastLine = Math.min(lastLine, containers.get(parent)!.last);
      if (child.type === "list") {
        let target = unit;
        if (!target) {
          if (children[index - 1]?.type !== "list" || !group) {
            group = { lists: [], runs: [], valid: true };
            units.push(group);
          }
          target = group;
        }
        if (
          misread.nested.has(child) ||
          misread.next.has(child) ||
          misread.boundaryLists.has(child)
        )
          target.valid = false;
        const previous = children[index - 1];
        if (!run || previous?.type !== "list" || previous.ordered !== child.ordered) {
          run = [];
          target.runs.push(run);
        }
        const list: ListGroup = {
          node: child,
          items: [],
          parent,
          previous: children[index - 1]?.type === "list" ? before : undefined,
        };
        before = list;
        run.push(list);
        target.lists.push(list);
        for (const [position, entry] of child.children.entries()) {
          const item = readItem(entry, list, position, target);
          if (item) list.items.push(item);
        }
        visit(child, parent, target);
        continue;
      }
      run = undefined;
      if (isContainer(child)) {
        containers.set(child, { parent, first: firstLine, last: Math.max(firstLine, lastLine) });
        for (let line = firstLine; line <= lastLine; line++) innermost[line] = child;
        visit(child, child, unit);
        continue;
      }
      // Code and other blocks that hold text as written have no inline nodes.
      if (unit && !("value" in child)) collectInline(child, unit);
    }
  };
  /**
   * The later lines of nodes that keep the whitespace at the start of their
   * lines, such as code spans, math, and titles, and nodes without positions.
   */
  const collectInline = (node: Nodes, unit: Unit) => {
    if (!located(node)) {
      unit.valid = false;
      return;
    }
    const keeps =
      node.type === "definition" ||
      ("title" in node && typeof node.title === "string") ||
      ("value" in node &&
        typeof node.value === "string" &&
        node.type !== "text" &&
        node.type !== "html");
    if (keeps)
      for (let line = node.position!.start.line; line < node.position!.end.line; line++)
        sensitive.add(line);
    if ("children" in node)
      for (const child of node.children as Nodes[]) collectInline(child, unit);
  };
  const readItem = (
    node: ListItem,
    list: ListGroup,
    index: number,
    unit: Unit,
  ): Item | undefined => {
    if (!located(node)) {
      unit.valid = false;
      return undefined;
    }
    const marker = node.position!.start.offset!;
    const first = node.position!.start.line - 1;
    const line = lines[first]!;
    let markerEnd = marker;
    let digits = "";
    if (list.node.ordered) {
      digits = /^\d{1,9}/.exec(source.slice(marker, marker + 10))?.[0] ?? "";
      markerEnd = marker + digits.length;
      if (!digits || (source[markerEnd] !== "." && source[markerEnd] !== ")")) unit.valid = false;
      markerEnd++;
    } else {
      if (!"-+*".includes(source[marker] ?? "_")) unit.valid = false;
      markerEnd++;
    }
    let spaceEnd = markerEnd;
    while (spaceEnd < line.end && isSpace(source[spaceEnd])) spaceEnd++;
    const markerColumn = columnAt(source, line.start, marker, 0);
    const markerEndColumn = markerColumn + markerEnd - marker;
    const item: Item = {
      node,
      list,
      index,
      first,
      last: first,
      marker,
      markerEnd,
      digits,
      spaceEnd,
      markerColumn,
      markerEndColumn,
      spacing: columnAt(source, markerEnd, spaceEnd, markerEndColumn) - markerEndColumn,
      blankFirst: spaceEnd === line.end,
    };
    items.set(node, item);
    return item;
  };
  visit(document.tree, undefined, undefined);
  // Renderers without TOML front matter read its lines as a paragraph, which
  // a list directly below continues where it cannot interrupt one: a numbered
  // list that does not start at 1, or one whose first item starts with a blank
  // line (issue #333).
  const below = units[0]?.lists[0];
  if (below && joinsTomlFrontMatter(document.tree, below.node)) units[0]!.valid = false;
  for (const item of items.values()) item.last = containers.get(item.node)?.last ?? item.first;
  for (const unit of units)
    for (const list of unit.lists)
      for (const item of list.items)
        if (item.last < item.first || (list.items[item.index + 1]?.first ?? Infinity) <= item.last)
          unit.valid = false;

  const enclosing = (line: number) => {
    const chain: Container[] = [];
    for (let node = innermost[line]; node; node = containers.get(node)?.parent) chain.unshift(node);
    return chain;
  };
  const chains = new Map<number, Container[]>();
  /** A line with nothing but whitespace and `>`, which starts no container. */
  const blank = (line: number) => {
    const { start, end } = lines[line]!;
    const node = innermost[line];
    return (
      (!node || containers.get(node)!.first !== line) && /^[ \t>]*$/.test(source.slice(start, end))
    );
  };
  /**
   * The containers that a line passes through. A blank line belongs to every
   * container that the line before it is in, until a later line closes them,
   * though the tree ends a container at its last line with content: in a list
   * item that ends with indented code, a blank line's spaces beyond the code's
   * indentation become part of the code.
   */
  const open = (line: number): Container[] => {
    let from = line;
    while (from > 0 && !chains.has(from) && !chains.has(from - 1) && blank(from)) from--;
    for (let at = from; at <= line; at++) {
      if (chains.has(at)) continue;
      let chain = enclosing(at);
      const before = at > 0 && blank(at) ? chains.get(at - 1) : undefined;
      if (before && chain.every((node, index) => before[index] === node)) chain = before;
      chains.set(at, chain);
    }
    return chains.get(line)!;
  };
  const memo = new Map<number, Matched>();
  const match = (line: number): Matched => {
    const known = memo.get(line);
    if (known) return known;
    const chain = open(line);
    const levels: Level[] = [];
    const result = { chain, levels };
    memo.set(line, result);
    let at = lines[line]!.start;
    let column = 0;
    for (const node of chain) {
      const level = matchLevel(node, line, at, column);
      levels.push(level);
      if (level.kind !== "content") break;
      at = level.end;
      column = level.endColumn;
    }
    return result;
  };
  /** How `line`, from `start` at `column`, passes through the prefix of `node`. */
  const matchLevel = (node: Container, line: number, start: number, column: number): Level => {
    const { end: lineEnd } = lines[line]!;
    const level: Level = {
      node,
      kind: "unsupported",
      start,
      startColumn: column,
      end: start,
      endColumn: column,
      indent: 0,
    };
    const info = containers.get(node)!;
    if (node.type === "listItem") {
      const item = items.get(node);
      if (!item) return level;
      if (line === item.first) {
        if (!/^[ \t]*$/.test(source.slice(start, item.marker))) return level;
        const offset = item.markerColumn - column;
        if (offset > 3) return level;
        const content =
          item.blankFirst || item.spacing >= 5
            ? item.markerEndColumn + 1
            : item.markerEndColumn + item.spacing;
        item.start = start;
        item.offset = offset;
        item.width = content - column;
        if (item.blankFirst) return { ...level, kind: "content", end: lineEnd, endColumn: content };
        if (item.spacing >= 5) {
          // A tab right after the marker gives one of its columns to the marker.
          if (source[item.markerEnd] !== " ") return level;
          return { ...level, kind: "content", end: item.markerEnd + 1, endColumn: content };
        }
        return { ...level, kind: "content", end: item.spaceEnd, endColumn: content };
      }
      if (item.width === undefined) match(item.first);
      if (item.width === undefined) return level;
      return indented(level, item.width, lineEnd);
    }
    if (node.type === "blockquote") {
      let at = start;
      let reached = column;
      if (line === info.first) at = node.position!.start.offset!;
      else
        while (at < lineEnd && isSpace(source[at])) {
          const next = source[at] === "\t" ? tabStop(reached) : reached + 1;
          if (next - column > 3) break;
          reached = next;
          at++;
        }
      if (source[at] !== ">" || !/^[ \t]*$/.test(source.slice(start, at)))
        return /^[ \t]*$/.test(source.slice(start, lineEnd))
          ? { ...level, kind: "blank", indent: columnAt(source, start, lineEnd, column) - column }
          : line === info.first
            ? level
            : { ...level, kind: "lazy", indent: columnAt(source, start, at, column) - column };
      reached = columnAt(source, start, at, column) + 1;
      at++;
      if (source[at] === "\t") return level;
      if (source[at] === " ") {
        at++;
        reached++;
      }
      return { ...level, kind: "content", end: at, endColumn: reached };
    }
    // A footnote definition: its first line's content starts with its first
    // block, and its other lines need four columns.
    if (line === info.first) {
      const child = node.children[0];
      const end =
        child && located(child) && child.position!.start.line - 1 === line
          ? child.position!.start.offset!
          : lineEnd;
      return {
        ...level,
        kind: "content",
        end,
        endColumn: columnAt(source, start, end, column),
      };
    }
    return indented(level, 4, lineEnd);
  };
  /** A line that needs `width` columns of indentation to continue a container. */
  const indented = (level: Level, width: number, lineEnd: number): Level => {
    let at = level.start;
    let column = level.startColumn;
    if (/^[ \t]*$/.test(source.slice(at, lineEnd)))
      return {
        ...level,
        kind: "blank",
        indent: columnAt(source, at, lineEnd, column) - column,
      };
    while (column - level.startColumn < width && isSpace(source[at])) {
      const next = source[at] === "\t" ? tabStop(column) : column + 1;
      if (next - level.startColumn > width) return level;
      column = next;
      at++;
    }
    if (column - level.startColumn < width)
      return { ...level, kind: "lazy", indent: column - level.startColumn };
    return { ...level, kind: "content", end: at, endColumn: column };
  };
  const analysis = { source, lines, units, items, containers, sensitive, match };
  analyses.set(document, analysis);
  return analysis;
}

/** A tab among the whitespace and container markers that start the rest of a line. */
function structuralTab(source: string, from: number, to: number): boolean {
  const prefix = /^(?:[ \t>]|(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$))*/.exec(source.slice(from, to))![0];
  return prefix.includes("\t");
}
const onlySpaces = (source: string, from: number, to: number) =>
  from <= to && /^ *$/.test(source.slice(from, to));
/**
 * Whether a lazy line can join its item: once the item needs fewer columns,
 * the line may have enough and continue the item's paragraph from inside it.
 * Text that starts with a letter, or a number that is no list marker, does
 * that; anything else could start a block there, and inline code or math
 * would keep the indentation that the line no longer has.
 */
function lazySafe(analysis: Analysis, line: number, level: Level): boolean {
  const { source, lines } = analysis;
  const text = source.slice(level.start, lines[line]!.end).trimStart();
  return (
    !analysis.sensitive.has(line) &&
    !text.includes("|") &&
    /^(?:\p{L}|[0-9]+(?![.)0-9]))/u.test(text)
  );
}
/**
 * Whether the item's column changes are possible without moving content: an
 * item's lines must be read exactly, and none of the lines around it may
 * start or stop belonging to it. `delta` gives the change of each item's
 * column, `minimum` the fewest columns that an item can need once the list
 * rules are done, and `siblings` says whether the other items of the list
 * move to the start of their container's part of the line too.
 */
function feasible(
  analysis: Analysis,
  list: ListGroup,
  delta: Map<Item, number>,
  mode: "start" | "end",
  minimum: (item: Item) => number,
  siblings: "move" | "stay",
): boolean {
  const { source, lines } = analysis;
  for (const item of list.items) analysis.match(item.first);
  for (const item of list.items) {
    const change = delta.get(item) ?? 0;
    if (!change) continue;
    if (item.width === undefined) return false;
    for (const line of linesWithBlanks(analysis, item.first + 1, item.last)) {
      const { chain, levels } = analysis.match(line);
      const at = chain.indexOf(item.node);
      if (at < 0) {
        if (line > item.last) continue;
        return false;
      }
      const level = levels[at];
      if (!level) {
        const last = levels.at(-1);
        if (!last || last.kind === "unsupported") return false;
        if (last.kind === "blank" && !blankFeasible(analysis, line, chain, levels.length - 1))
          return false;
        continue;
      }
      if (level.kind === "unsupported") return false;
      if (level.kind === "blank") {
        if (!blankFeasible(analysis, line, chain, at)) return false;
        continue;
      }
      if (level.kind === "lazy") {
        if (change < 0 && level.indent >= minimum(item) && !lazySafe(analysis, line, level))
          return false;
        continue;
      }
      const lineEnd = lines[line]!.end;
      if (mode === "start") {
        if (change < 0 && !onlySpaces(source, level.start, level.start - change)) return false;
        if (structuralTab(source, level.start, lineEnd)) return false;
      } else {
        if (change < 0 && !onlySpaces(source, level.end + change, level.end)) return false;
        if (structuralTab(source, level.end + Math.min(0, change), lineEnd)) return false;
      }
    }
    if (change < 0 && !captureFree(analysis, item, change, minimum, siblings)) return false;
  }
  return true;
}
/**
 * The items and footnote definitions whose prefixes a blank line's
 * whitespace stands for, from the level where the line is blank down to the
 * deepest container still open there; a block quote that the line has no `>`
 * for ends there. Undefined when an item's columns are not known.
 */
function blankPath(analysis: Analysis, chain: Container[], from: number) {
  const path: (Item | undefined)[] = [];
  let width = 0;
  for (const node of chain.slice(from)) {
    if (node.type === "blockquote") break;
    if (node.type === "footnoteDefinition") {
      path.push(undefined);
      width += 4;
      continue;
    }
    const item = analysis.items.get(node);
    if (item?.width === undefined) return undefined;
    path.push(item);
    width += item.width;
  }
  return { items: path, width };
}
/** Whether a blank line can keep its whitespace beyond its containers' prefixes. */
function blankFeasible(analysis: Analysis, line: number, chain: Container[], from: number) {
  const path = blankPath(analysis, chain, from);
  if (!path) return false;
  const level = analysis.match(line).levels[from]!;
  return (
    !path.items.length ||
    !analysis.source.slice(level.start, analysis.lines[line]!.end).includes("\t")
  );
}
/** The line indexes from `first` to `last`, and the blank lines after them. */
function* linesWithBlanks(analysis: Analysis, first: number, last: number) {
  const { source, lines } = analysis;
  for (let line = first; line <= last; line++) yield line;
  for (let line = last + 1; line < lines.length; line++) {
    if (!/^[ \t>]*$/.test(source.slice(lines[line]!.start, lines[line]!.end))) break;
    yield line;
  }
}
/**
 * Whether the line after an item that needs fewer columns stays out of it:
 * the next item of its list, unless that moves too, or the first line after
 * the item that its container continues with.
 */
function captureFree(
  analysis: Analysis,
  item: Item,
  change: number,
  minimum: (item: Item) => number,
  siblings: "move" | "stay",
): boolean {
  const { source, lines } = analysis;
  const next = item.list.items[item.index + 1];
  if (next) {
    if (siblings === "move") return true;
    return next.offset !== undefined && next.offset < item.width! + change;
  }
  const { parent } = item.list;
  const last = parent ? analysis.containers.get(parent)!.last : lines.length - 1;
  for (let line = item.last + 1; line <= last; line++) {
    let start = lines[line]!.start;
    let column = 0;
    if (parent) {
      const { chain, levels } = analysis.match(line);
      const at = chain.indexOf(parent);
      if (at < 0) return false;
      const level = levels[at];
      const reached = level ?? levels.at(-1);
      if (!reached || reached.kind === "unsupported") return false;
      if (reached.kind === "blank") continue;
      if (!level || level.kind === "lazy") return true;
      start = level.end;
      column = level.endColumn;
    }
    const text = source.slice(start, lines[line]!.end);
    if (/^[ \t]*$/.test(text)) continue;
    const indent = /^[ \t]*/.exec(text)![0];
    return columnAt(source, start, start + indent.length, column) - column < minimum(item);
  }
  return true;
}
/**
 * The changes to the lines of items whose columns change by `delta`: the
 * columns are removed or added at the start of each item's part of a line,
 * or at its end, where its content starts. A blank line in code keeps the
 * whitespace that the code holds there.
 */
function shiftOps(
  analysis: Analysis,
  unit: Unit,
  delta: Map<Item, number>,
  mode: "start" | "end",
): Op[] {
  const ops: Op[] = [];
  if (![...delta.values()].some(Boolean)) return ops;
  const { lines } = analysis;
  let firstLine = Infinity;
  let lastLine = -1;
  for (const { items } of unit.lists) {
    firstLine = Math.min(firstLine, items[0]?.first ?? Infinity);
    lastLine = Math.max(lastLine, items.at(-1)?.last ?? -1);
  }
  for (const line of linesWithBlanks(analysis, firstLine, lastLine)) {
    const { chain, levels } = analysis.match(line);
    for (const [at, level] of levels.entries()) {
      if (level.kind === "blank") {
        // The whitespace beyond the prefixes of the containers still open
        // stays: in code, it is part of the code.
        const path = blankPath(analysis, chain, at);
        if (!path) break;
        const change = path.items.reduce((sum, item) => sum + ((item && delta.get(item)) ?? 0), 0);
        const indent =
          level.indent >= path.width
            ? level.indent + change
            : Math.min(level.indent, path.width + change);
        if (change && indent !== level.indent)
          ops.push({ start: level.start, end: lines[line]!.end, text: " ".repeat(indent) });
        break;
      }
      if (level.kind !== "content") break;
      if (level.node.type !== "listItem") continue;
      const item = analysis.items.get(level.node)!;
      const change = delta.get(item) ?? 0;
      if (!change || line === item.first) continue;
      if (mode === "start")
        ops.push(
          change > 0
            ? { start: level.start, end: level.start, text: " ".repeat(change) }
            : { start: level.start, end: level.start - change, text: "" },
        );
      else if (change > 0) ops.push({ start: level.end, end: level.end, text: " ".repeat(change) });
      else ops.push({ start: level.end + change, end: level.end, text: "" });
    }
  }
  return ops;
}
/**
 * One finding for a unit's changes, with the edit that makes all of them and
 * the message of the first change that has one.
 */
function unitFinding(source: string, ops: Op[]): Finding | undefined {
  if (!ops.length) return undefined;
  ops.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < ops.length; index++)
    if (ops[index]!.start < ops[index - 1]!.end) return undefined;
  const start = ops[0]!.start;
  const end = ops.at(-1)!.end;
  let text = "";
  let cursor = start;
  for (const op of ops) {
    text += source.slice(cursor, op.start) + op.text;
    cursor = op.end;
  }
  text += source.slice(cursor, end);
  const message = ops.find((op) => op.message)?.message ?? "Format the list.";
  return { start, end, message, edit: { start, end, text } };
}

const bullets = ["-", "*", "+"] as const;
/** The marker after `marker` in the order `-`, `*`, `+`. */
const nextBullet = (marker: string) => bullets[(bullets.indexOf(marker as "-") + 1) % 3]!;
/** A line that reads as a thematic break. */
const thematicBreak = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/** The number of bullet lists that a list is nested in. */
function bulletDepth(analysis: Analysis, list: ListGroup): number {
  let depth = 0;
  for (let node = list.parent; node; node = analysis.containers.get(node)?.parent)
    if (node.type === "listItem" && !analysis.items.get(node)?.list.node.ordered) depth++;
  return depth;
}
/**
 * The marker that each bullet list of a document gets before lists that
 * follow one another alternate: the configured one, the first list's with
 * `consistent`, or with `sublist` the first list's at each depth, unless the
 * depth above has that marker, in which case the next one.
 */
function bulletMarkers(analysis: Analysis, marker: string): (list: ListGroup) => string {
  if (marker !== "consistent" && marker !== "sublist") return () => marker;
  const { source } = analysis;
  const lists = analysis.units.flatMap((unit) =>
    unit.lists.filter(
      (list) => !list.node.ordered && bullets.includes(source[list.items[0]?.marker ?? -1] as "-"),
    ),
  );
  const written = (list: ListGroup) => source[list.items[0]!.marker]!;
  if (marker === "consistent") {
    const first = lists[0] ? written(lists[0]) : "-";
    return () => first;
  }
  const byDepth: string[] = [];
  const depths = new Map(lists.map((list) => [list, bulletDepth(analysis, list)]));
  for (const list of lists) {
    const depth = depths.get(list)!;
    // The lists that a list is nested in come before it.
    if (byDepth[depth] !== undefined) continue;
    const own = written(list);
    byDepth[depth] = depth && own === byDepth[depth - 1] ? nextBullet(own) : own;
  }
  return (list) => byDepth[depths.get(list) ?? 0] ?? "-";
}

const listMarker: Rule = {
  description: "Use one bullet list marker, and the next one for a list that follows another.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({ marker: { enum: [...bullets, "consistent", "sublist"] } }),
  check({ document, options }) {
    const analysis = analyze(document);
    const { source, lines } = analysis;
    const base = bulletMarkers(analysis, String((options.marker as string | undefined) ?? "-"));
    const findings: Finding[] = [];
    for (const unit of analysis.units) {
      if (!unit.valid) continue;
      const target = new Map<Item, string>();
      const runOf = new Map<Item, ListGroup[]>();
      for (const run of unit.runs) {
        if (run[0]!.node.ordered) continue;
        const preferred = base(run[0]!);
        run.forEach((list, index) => {
          for (const item of list.items) {
            target.set(item, index % 2 ? nextBullet(preferred) : preferred);
            runOf.set(item, run);
          }
        });
      }
      // A run keeps its markers where a new one would turn a line into a
      // thematic break, also together with the markers of lists nested on it.
      const kept = new Set<ListGroup[]>();
      const byLine = new Map<number, Item[]>();
      for (const item of target.keys())
        byLine.set(item.first, [...(byLine.get(item.first) ?? []), item]);
      for (let changed = true; changed;) {
        changed = false;
        for (const [line, onLine] of byLine) {
          const marked = (item: Item) =>
            kept.has(runOf.get(item)!) ? source[item.marker]! : target.get(item)!;
          if (onLine.every((item) => marked(item) === source[item.marker])) continue;
          const { start, end } = lines[line]!;
          let text = source.slice(start, end);
          for (const item of onLine)
            text =
              text.slice(0, item.marker - start) +
              marked(item) +
              text.slice(item.marker - start + 1);
          if (onLine.some((item) => thematicBreak.test(text.slice(item.marker - start)))) {
            for (const item of onLine)
              if (marked(item) !== source[item.marker]) kept.add(runOf.get(item)!);
            changed = true;
          }
        }
      }
      const ops: Op[] = [];
      for (const [item, marker] of target)
        if (!kept.has(runOf.get(item)!) && source[item.marker] !== marker)
          ops.push({
            start: item.marker,
            end: item.marker + 1,
            text: marker,
            message: `Use ${JSON.stringify(marker)} as the bullet list marker.`,
          });
      const finding = unitFinding(source, ops);
      if (finding) findings.push(finding);
    }
    return findings;
  },
};

/** The numbers that `numbering` gives a list's items, or undefined to keep them. */
function renumbered(digits: string[], numbering: string): string[] | undefined {
  if (digits.length < 2 || digits.some((value) => value.length > 1 && value.startsWith("0")))
    return undefined;
  const first = Number(digits[0]);
  const same = numbering === "same" || (numbering !== "ordered" && Number(digits[1]) === first);
  const numbers = digits.map((_, index) => (index === 0 ? first : same ? first : first + index));
  if (numbers.some((value) => value > 999_999_999)) return undefined;
  return numbers.map((value, index) => (index === 0 ? digits[0]! : String(value)));
}

const orderedList: Rule = {
  description: "Use one delimiter after list numbers, and number list items consistently.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({
    delimiter: { enum: [".", ")", "consistent"] },
    numbering: { enum: ["auto", "ordered", "same"] },
  }),
  check({ document, options }) {
    const analysis = analyze(document);
    const { source } = analysis;
    let preferred = String((options.delimiter as string | undefined) ?? ".");
    if (preferred === "consistent") {
      // The delimiter of the document's first ordered list.
      const first = analysis.units
        .flatMap((unit) => unit.lists)
        .find((list) => list.node.ordered && list.items.length);
      preferred = source[(first?.items[0]?.markerEnd ?? 0) - 1] === ")" ? ")" : ".";
    }
    const other = preferred === "." ? ")" : ".";
    const numbering = String((options.numbering as string | undefined) ?? "auto");
    const { indentLists } = rendererProtections(document);
    const findings: Finding[] = [];
    for (const unit of analysis.units) {
      if (!unit.valid) continue;
      const retainIndent = unit.lists.some(({ node }) => indentLists.has(node));
      const delimiter = new Map<ListGroup, string>();
      for (const run of unit.runs)
        if (run[0]!.node.ordered)
          run.forEach((list, index) => delimiter.set(list, index % 2 ? other : preferred));
      const ops: Op[] = [];
      const delta = new Map<Item, number>();
      for (const list of unit.lists) {
        if (!list.node.ordered) continue;
        const digits = list.items.map((item) => item.digits);
        let numbers = renumbered(digits, numbering) ?? digits;
        const changes = new Map<Item, number>();
        for (const item of list.items) {
          const change = numbers[item.index]!.length - item.digits.length;
          if (change) changes.set(item, change);
        }
        const minimum = (item: Item) => numbers[item.index]!.length + 2;
        if (changes.size) {
          // The marker line's content moves with the number; a tab after it
          // would change its width instead.
          const readable = [...changes.keys()].every(
            (item) => !structuralTab(source, item.markerEnd, analysis.lines[item.first]!.end),
          );
          if (
            retainIndent ||
            !readable ||
            !feasible(analysis, list, changes, "end", minimum, "stay")
          ) {
            numbers = digits;
            changes.clear();
          }
        }
        for (const [item, change] of changes) delta.set(item, change);
        const mark = delimiter.get(list) ?? preferred;
        for (const item of list.items) {
          const text = numbers[item.index]! + mark;
          if (source.slice(item.marker, item.markerEnd) === text) continue;
          ops.push({
            start: item.marker,
            end: item.markerEnd,
            text,
            message:
              source[item.markerEnd - 1] !== mark
                ? `Use ${JSON.stringify(mark)} after list item numbers.`
                : `Number this list item ${numbers[item.index]}.`,
          });
        }
      }
      for (const op of shiftOps(analysis, unit, delta, "end")) ops.push(op);
      const finding = unitFinding(source, ops);
      if (finding) findings.push(finding);
    }
    return findings;
  },
};

/** The columns from an item's marker to its text. */
const reachOf = (item: Item, spacing = item.spacing) =>
  item.markerEnd - item.marker + (item.blankFirst || item.spacing >= 5 ? 1 : spacing);
const spaces = { type: "integer", minimum: 1, maximum: 4 };

const listIndent: Rule = {
  description: "Indent list items consistently, with the configured spaces after the marker.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({
    bulletSpaces: spaces,
    orderedSpaces: spaces,
    bulletSpacesMultiline: spaces,
    orderedSpacesMultiline: spaces,
    nestedIndent: { type: "integer", minimum: 1, maximum: 8 },
    startIndented: { type: "boolean" },
    startIndent: { type: "integer", minimum: 0 },
  }),
  check({ document, options }) {
    const analysis = analyze(document);
    const { source, lines } = analysis;
    const bullet = Number(options.bulletSpaces ?? 1);
    const ordered = Number(options.orderedSpaces ?? 1);
    const spacing = {
      bullet: [bullet, Number(options.bulletSpacesMultiline ?? bullet)],
      ordered: [ordered, Number(options.orderedSpacesMultiline ?? ordered)],
    };
    const nested = options.nestedIndent === undefined ? undefined : Number(options.nestedIndent);
    const initial = options.startIndented === true ? Number(options.startIndent ?? 2) : 0;
    if (initial >= 4) return [];
    const { indentLists } = rendererProtections(document);
    const findings: Finding[] = [];
    for (const unit of analysis.units) {
      if (!unit.valid || unit.lists.some(({ node }) => indentLists.has(node))) continue;
      const ops: Op[] = [];
      const delta = new Map<Item, number>();
      // The columns from each item's marker to its text once the rule is done,
      // and the fewest columns that its lines can need then.
      const reach = new Map<Item, number>();
      const lowest = new Map<Item, number>();
      for (const list of unit.lists) {
        // Below text an indented marker can be a continuation; preserve that
        // boundary rather than guessing.
        const first = list.items[0]!;
        if (initial > 0 && (!list.parent || list.parent.type !== "listItem")) {
          if (
            first.first > 0 &&
            /\S/.test(
              source
                .slice(lines[first.first - 1]!.start, lines[first.first - 1]!.end)
                .replace(/^[ \t>]*/, ""),
            )
          )
            continue;
        }
        for (const item of list.items) analysis.match(item.first);
        // As in markdownlint, a list whose items each take one line, with no
        // blank line between them, gets the spacing for single lines.
        const single = list.items.every(
          (item, index) =>
            item.first === item.last && (!index || item.first === list.items[index - 1]!.last + 1),
        );
        const wanted = spacing[list.node.ordered ? "ordered" : "bullet"][single ? 0 : 1]!;
        const holder =
          list.parent?.type === "listItem" ? analysis.items.get(list.parent) : undefined;
        // A nested list starts under its item's text, or as many columns from
        // the item's marker as configured, where CommonMark lets it start. On
        // the item's own marker line, columns before the nested marker would
        // be the item's spacing, so a list that starts there stays. A first
        // line that the last item of the list before it would continue would
        // join that item.
        const before = list.previous?.items.at(-1);
        const indent =
          nested !== undefined && holder && list.items[0]?.first !== holder.first
            ? Math.max(
                0,
                Math.min(
                  3,
                  nested - (reach.get(holder) ?? reachOf(holder)),
                  (before ? (lowest.get(before) ?? 0) : Infinity) - 1,
                ),
              )
            : holder
              ? 0
              : // A list after another one must not reach that list's last item,
                // which a list left as written would otherwise take it into.
                Math.max(0, Math.min(initial, (before ? (lowest.get(before) ?? 0) : Infinity) - 1));
        const marks: Op[] = [];
        const changes = new Map<Item, number>();
        let possible = true;
        for (const item of list.items) {
          if (item.width === undefined || item.start === undefined) {
            possible = false;
            break;
          }
          const offset = item.offset!;
          // The spacing stays where the item starts with indented code, which
          // depends on it, or with a blank line, which has none.
          const keep = item.blankFirst || item.spacing >= 5;
          const target = keep ? item.spacing : wanted;
          if (offset === indent && target === item.spacing) continue;
          const lineEnd = lines[item.first]!.end;
          if (
            (offset !== indent && !onlySpaces(source, item.start, item.marker)) ||
            (target !== item.spacing && !onlySpaces(source, item.markerEnd, item.spaceEnd)) ||
            structuralTab(source, item.start, lineEnd)
          ) {
            possible = false;
            break;
          }
          const count = (value: number) => (value === 1 ? "one space" : `${value} spaces`);
          if (offset !== indent)
            marks.push({
              start: item.start,
              end: item.marker,
              text: " ".repeat(indent),
              message: indent
                ? `Indent the list marker by ${count(indent)}.`
                : "Remove the indentation before the list marker.",
            });
          if (target !== item.spacing)
            marks.push({
              start: item.markerEnd,
              end: item.spaceEnd,
              text: " ".repeat(target),
              message: `Put ${count(target)} after the list marker.`,
            });
          const change = indent - offset + (keep ? 0 : target - item.spacing);
          if (change) changes.set(item, change);
        }
        const minimum = (item: Item) =>
          indent +
          (!list.node.ordered ? 1 : item.index ? 2 : item.digits.length + 1) +
          (item.blankFirst || item.spacing >= 5 ? 1 : wanted);
        const accepted =
          possible &&
          marks.length > 0 &&
          feasible(analysis, list, changes, "start", minimum, "move");
        for (const item of list.items) {
          reach.set(item, accepted ? reachOf(item, wanted) : reachOf(item));
          const narrowest =
            (!list.node.ordered ? 1 : item.index ? 2 : item.digits.length + 1) +
            (item.blankFirst || item.spacing >= 5 ? 1 : accepted ? wanted : item.spacing);
          lowest.set(item, (accepted ? indent : (item.offset ?? 0)) + narrowest);
        }
        if (!accepted) continue;
        for (const op of marks) ops.push(op);
        for (const [item, change] of changes) delta.set(item, change);
      }
      for (const op of shiftOps(analysis, unit, delta, "start")) ops.push(op);
      const finding = unitFinding(source, ops);
      if (finding) findings.push(finding);
    }
    return findings;
  },
};

export const listRules: Record<string, Rule> = {
  "style/list-indent": listIndent,
  "style/list-marker": listMarker,
  "style/ordered-list": orderedList,
};
