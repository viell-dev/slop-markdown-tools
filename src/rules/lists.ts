import type { Blockquote, FootnoteDefinition, List, ListItem, Nodes, Parents } from "mdast";
import type { Document, Finding, Rule } from "../core/types.js";
import { optionsSchema } from "./style.js";

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
  /** Later lines of inline code, math, and other inline nodes that keep their whitespace. */
  sensitive: Set<number>;
  match(line: number): Matched;
}
interface Op {
  start: number;
  end: number;
  text: string;
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
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
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

  const visit = (node: Parents, parent: Container | undefined, unit: Unit | undefined) => {
    const children = node.children as Nodes[];
    let group: Unit | undefined;
    let run: ListGroup[] | undefined;
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      if (!located(child)) {
        if (unit) unit.valid = false;
        continue;
      }
      const firstLine = child.position!.start.line - 1;
      let lastLine = child.position!.end.line - 1;
      // A list item in a footnote definition can end past the next item's
      // start; a block ends before the next one starts.
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
        const previous = children[index - 1];
        if (!run || previous?.type !== "list" || previous.ordered !== child.ordered) {
          run = [];
          target.runs.push(run);
        }
        const list: ListGroup = { node: child, items: [], parent };
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
  /**
   * The containers that a line passes through. A blank line belongs to every
   * container that the line before it is in, until a later line closes them,
   * though the tree ends a container at its last line with content: in a list
   * item that ends with indented code, a blank line's spaces beyond the code's
   * indentation become part of the code.
   */
  const blank = (line: number) => {
    const { start, end } = lines[line]!;
    const node = innermost[line];
    return (
      (!node || containers.get(node)!.first !== line) && /^[ \t>]*$/.test(source.slice(start, end))
    );
  };
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
        if (!onlySpaces(source, level.start, level.start - change)) return false;
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
  const firstLine = Math.min(...unit.lists.map((list) => list.items[0]?.first ?? Infinity));
  const lastLine = Math.max(...unit.lists.map((list) => list.items.at(-1)?.last ?? -1));
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
      if (mode === "start") ops.push({ start: level.start, end: level.start - change, text: "" });
      else if (change > 0) ops.push({ start: level.end, end: level.end, text: " ".repeat(change) });
      else ops.push({ start: level.end + change, end: level.end, text: "" });
    }
  }
  return ops;
}
/** One finding for a unit's changes, with the edit that makes all of them. */
function unitFinding(source: string, ops: Op[], message: string): Finding | undefined {
  if (!ops.length) return undefined;
  ops.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < ops.length; index++)
    if (ops[index]!.start < ops[index - 1]!.end) return undefined;
  const start = ops[0]!.start;
  const end = Math.max(...ops.map((op) => op.end));
  let text = "";
  let cursor = start;
  for (const op of ops) {
    text += source.slice(cursor, op.start) + op.text;
    cursor = op.end;
  }
  text += source.slice(cursor, end);
  return { start, end, message, edit: { start, end, text } };
}

const bullets = ["-", "*", "+"] as const;
/** The marker after `marker` in the order `-`, `*`, `+`. */
const nextBullet = (marker: string) => bullets[(bullets.indexOf(marker as "-") + 1) % 3]!;
/** A line that reads as a thematic break. */
const thematicBreak = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

const listMarker: Rule = {
  description: "Use one bullet list marker, and the next one for a list that follows another.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({ marker: { enum: [...bullets] } }),
  check({ document, options }) {
    const analysis = analyze(document);
    const { source, lines } = analysis;
    const preferred = String(options.marker ?? "-");
    const findings: Finding[] = [];
    for (const unit of analysis.units) {
      if (!unit.valid) continue;
      const target = new Map<Item, string>();
      const runOf = new Map<Item, ListGroup[]>();
      for (const run of unit.runs) {
        if (run[0]!.node.ordered) continue;
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
          ops.push({ start: item.marker, end: item.marker + 1, text: marker });
      ops.sort((a, b) => a.start - b.start);
      const finding = unitFinding(
        source,
        ops,
        `Use ${JSON.stringify(ops[0]?.text ?? preferred)} as the bullet list marker.`,
      );
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
  const numbers = digits.map((value, index) =>
    index === 0 ? first : same ? first : first + index,
  );
  if (numbers.some((value) => value > 999_999_999)) return undefined;
  return numbers.map((value, index) => (index === 0 ? digits[0]! : String(value)));
}

const orderedList: Rule = {
  description: "Use one delimiter after list numbers, and number list items consistently.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({
    delimiter: { enum: [".", ")"] },
    numbering: { enum: ["auto", "ordered", "same"] },
  }),
  check({ document, options }) {
    const analysis = analyze(document);
    const { source } = analysis;
    const preferred = String(options.delimiter ?? ".");
    const other = preferred === "." ? ")" : ".";
    const numbering = String(options.numbering ?? "auto");
    const findings: Finding[] = [];
    for (const unit of analysis.units) {
      if (!unit.valid) continue;
      const delimiter = new Map<ListGroup, string>();
      for (const run of unit.runs)
        if (run[0]!.node.ordered)
          run.forEach((list, index) => delimiter.set(list, index % 2 ? other : preferred));
      const ops: Op[] = [];
      const delta = new Map<Item, number>();
      let message: string | undefined;
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
          if (!readable || !feasible(analysis, list, changes, "end", minimum, "stay")) {
            numbers = digits;
            changes.clear();
          }
        }
        for (const [item, change] of changes) delta.set(item, change);
        const mark = delimiter.get(list) ?? preferred;
        for (const item of list.items) {
          const text = numbers[item.index]! + mark;
          if (source.slice(item.marker, item.markerEnd) === text) continue;
          ops.push({ start: item.marker, end: item.markerEnd, text });
          if (message === undefined)
            message =
              source[item.markerEnd - 1] !== mark
                ? `Use ${JSON.stringify(mark)} after list item numbers.`
                : `Number this list item ${numbers[item.index]}.`;
        }
      }
      ops.push(...shiftOps(analysis, unit, delta, "end"));
      ops.sort((a, b) => a.start - b.start);
      const finding = unitFinding(source, ops, message ?? "Renumber the list.");
      if (finding) findings.push(finding);
    }
    return findings;
  },
};

const listIndent: Rule = {
  description: "Start list items at their container's edge with one space after the marker.",
  kind: "style",
  phase: "block",
  schema: optionsSchema({}),
  check({ document }) {
    const analysis = analyze(document);
    const { source, lines } = analysis;
    const findings: Finding[] = [];
    for (const unit of analysis.units) {
      if (!unit.valid) continue;
      const ops: Op[] = [];
      const delta = new Map<Item, number>();
      for (const list of unit.lists) {
        // Reading the first item's marker line also reads the others'.
        for (const item of list.items) analysis.match(item.first);
        const marks: Op[] = [];
        const changes = new Map<Item, number>();
        let possible = true;
        for (const item of list.items) {
          if (item.width === undefined || item.start === undefined) {
            possible = false;
            break;
          }
          const offset = item.offset!;
          // One space, unless the item starts with indented code, which
          // depends on the spacing, or with a blank line, which has none.
          const spacing = item.blankFirst || item.spacing >= 5 ? 0 : item.spacing - 1;
          if (!offset && !spacing) continue;
          const lineEnd = lines[item.first]!.end;
          if (
            (offset && !onlySpaces(source, item.start, item.marker)) ||
            (spacing && !onlySpaces(source, item.markerEnd, item.spaceEnd)) ||
            structuralTab(source, item.start, lineEnd)
          ) {
            possible = false;
            break;
          }
          if (offset) marks.push({ start: item.start, end: item.marker, text: "" });
          if (spacing) marks.push({ start: item.markerEnd, end: item.spaceEnd, text: " " });
          changes.set(item, -(offset + spacing));
        }
        if (!possible || !changes.size) continue;
        const minimum = (item: Item) =>
          (!list.node.ordered ? 1 : item.index ? 2 : item.digits.length + 1) + 1;
        if (!feasible(analysis, list, changes, "start", minimum, "move")) continue;
        ops.push(...marks);
        for (const [item, change] of changes) delta.set(item, change);
      }
      ops.push(...shiftOps(analysis, unit, delta, "start"));
      const finding = unitFinding(
        source,
        ops,
        "Start each list item at its container's edge, with one space after the marker.",
      );
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
