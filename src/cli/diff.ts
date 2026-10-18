import { diffArrays, formatPatch, type StructuredPatchHunk } from "diff";

/** Lines of context around each change, as `diff`'s `createTwoFilesPatch` shows them. */
const context = 4;
/**
 * The most lines, of both texts together, that one run of the line diff
 * compares. Its cost grows with the lines it compares times the lines that
 * changed, so this limit keeps the cost of the whole diff in proportion to the
 * length of the texts.
 */
const limit = 100;

/** The lines of `text`, each with its line break, split where `diff` splits them. */
function lines(text: string): string[] {
  const result: string[] = [];
  for (let start = 0; start < text.length;) {
    const end = text.indexOf("\n", start) + 1 || text.length;
    result.push(text.slice(start, end));
    start = end;
  }
  return result;
}

/** Lines `oldStart` to `oldEnd` of the old text, which became `newStart` to `newEnd` of the new. */
interface Region {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

/**
 * Where a line occurs: its places in the new text, how many of them the scan
 * has passed, and how often it occurs in the old text.
 */
interface Occurrences {
  places: number[];
  passed: number;
  old: number;
}

/**
 * The longest chain of `pairs`, which are in increasing order of their first
 * item, whose second items increase too.
 */
function chain(pairs: [number, number][]): [number, number][] {
  // The pair that ends the longest chain of each length so far, and each pair's predecessor.
  const ends: number[] = [];
  const previous: number[] = [];
  pairs.forEach(([, place], index) => {
    let low = 0;
    for (let high = ends.length; low < high;) {
      const middle = (low + high) >> 1;
      if (pairs[ends[middle]!]![1] < place) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? ends[low - 1]! : -1;
    ends[low] = index;
  });
  const result: [number, number][] = [];
  for (let index = ends.at(-1) ?? -1; index >= 0; index = previous[index]!)
    result.push(pairs[index]!);
  return result.reverse();
}

/**
 * The regions where `after` differs from `before`, in order, each followed by
 * a line that both texts share, unless it reaches their ends.
 *
 * Lines that occur once in each text, in the same order in both, are anchors
 * that the texts keep, as in patience diff, so that a region never reaches past
 * an unchanged paragraph or heading. Between anchors, at a difference, the
 * texts agree again at the nearest pair of equal lines: the one that skips the
 * fewest lines of both texts together. An index of where each line occurs in
 * `after` finds that pair in time proportional to the lines it skips, so the
 * scan takes time in proportion to the length of the texts, however much
 * changed. No line of a region equals a line of the other text's part of it,
 * since that pair would have been nearer.
 */
function regions(before: string[], after: string[]): Region[] {
  const occurrences = new Map<string, Occurrences>();
  after.forEach((line, index) => {
    const entry = occurrences.get(line);
    if (entry) entry.places.push(index);
    else occurrences.set(line, { places: [index], passed: 0, old: 0 });
  });
  for (const line of before) {
    const entry = occurrences.get(line);
    if (entry) entry.old++;
  }
  const anchors = chain(
    before.flatMap((line, index): [number, number][] => {
      const entry = occurrences.get(line);
      return entry?.old === 1 && entry.places.length === 1 ? [[index, entry.places[0]!]] : [];
    }),
  );
  /** The first place of `line` in `after` at or after `from`, which never decreases. */
  const next = (line: string, from: number) => {
    const entry = occurrences.get(line);
    if (!entry) return undefined;
    while ((entry.places[entry.passed] ?? Infinity) < from) entry.passed++;
    return entry.places[entry.passed];
  };
  const found: Region[] = [];
  let anchor = 0;
  for (let oldLine = 0, newLine = 0; oldLine < before.length || newLine < after.length;) {
    if (before[oldLine] === after[newLine]) {
      oldLine++;
      newLine++;
      continue;
    }
    while ((anchors[anchor]?.[0] ?? Infinity) < oldLine) anchor++;
    // The region ends at the next anchor, or at the ends of the texts, unless a pair is nearer.
    const [oldLimit, newLimit] = anchors[anchor] ?? [before.length, after.length];
    let oldEnd = oldLimit;
    let newEnd = newLimit;
    let skipped = oldEnd - oldLine + newEnd - newLine;
    for (let line = oldLine; line < oldLimit && line - oldLine < skipped; line++) {
      const place = next(before[line]!, newLine);
      if (place !== undefined && place < newLimit && line - oldLine + place - newLine < skipped) {
        skipped = line - oldLine + place - newLine;
        oldEnd = line;
        newEnd = place;
      }
    }
    found.push({ oldStart: oldLine, oldEnd, newStart: newLine, newEnd });
    oldLine = oldEnd;
    newLine = newEnd;
  }
  return found;
}

/** Lines that both texts keep (" "), that the old text loses ("-"), or that the new gains ("+"). */
interface Run {
  kind: " " | "-" | "+";
  count: number;
}

/**
 * The runs of lines that turn `before` into `after`. The line diff, which
 * finds the fewest lines to remove and add, compares each group of nearby
 * regions that fits within the limit, so that a pair of equal lines that only
 * happens to be the nearest, such as two blank lines, does not decide how a
 * change is shown. A group's lines run on to the next group, or to the ends,
 * so that texts with one group get the diff of the whole texts. A region
 * larger than the limit has no line in common with the other text's part of
 * it, so the line diff would remove and add it whole, as this does.
 */
function runs(before: string[], after: string[]): Run[] {
  const result: Run[] = [];
  const add = (kind: Run["kind"], count: number) => {
    const last = result.at(-1);
    if (count === 0) return;
    if (last?.kind === kind) last.count += count;
    else result.push({ kind, count });
  };
  const found = regions(before, after);
  add(" ", found[0]?.oldStart ?? before.length);
  for (let index = 0; index < found.length;) {
    const first = found[index]!;
    const size = (region: Region) =>
      region.oldEnd - first.oldStart + region.newEnd - first.newStart;
    let end = index + 1;
    while (end < found.length && size(found[end]!) <= limit) end++;
    const last = found[end - 1]!;
    const oldEnd = found[end]?.oldStart ?? before.length;
    const newEnd = found[end]?.newStart ?? after.length;
    if (size(last) > limit) {
      add("-", last.oldEnd - first.oldStart);
      add("+", last.newEnd - first.newStart);
      add(" ", oldEnd - last.oldEnd);
    } else
      for (const change of diffArrays(
        before.slice(first.oldStart, oldEnd),
        after.slice(first.newStart, newEnd),
      ))
        add(change.added ? "+" : change.removed ? "-" : " ", change.count);
    index = end;
  }
  return result;
}

/**
 * The hunks of `changes`, as `diff`'s `structuredPatch` makes them: up to
 * `context` kept lines on each side of a change, and one hunk for changes
 * whose contexts touch.
 */
function hunks(before: string[], after: string[], changes: Run[]): StructuredPatchHunk[] {
  const result: StructuredPatchHunk[] = [];
  let hunk: StructuredPatchHunk | undefined;
  /** Adds a line to the hunk as a patch shows it, and marks a last line without a line break. */
  const show = (prefix: Run["kind"], line: string) => {
    if (line.endsWith("\n")) hunk!.lines.push(prefix + line.slice(0, -1));
    else hunk!.lines.push(prefix + line, "\\ No newline at end of file");
    if (prefix !== "+") hunk!.oldLines++;
    if (prefix !== "-") hunk!.newLines++;
  };
  let oldLine = 0;
  let newLine = 0;
  changes.forEach((run, index) => {
    if (run.kind === " ") {
      if (hunk) {
        // When another change follows within twice the context, the hunk takes it in.
        const shown =
          run.count <= 2 * context && index < changes.length - 1
            ? run.count
            : Math.min(run.count, context);
        for (const line of before.slice(oldLine, oldLine + shown)) show(" ", line);
        if (shown < run.count || index === changes.length - 1) {
          result.push(hunk);
          hunk = undefined;
        }
      }
      oldLine += run.count;
      newLine += run.count;
      return;
    }
    if (!hunk) {
      // The kept lines before the change, which the previous run holds.
      const leading = Math.min(changes[index - 1]?.count ?? 0, context);
      hunk = {
        oldStart: oldLine - leading + 1,
        oldLines: 0,
        newStart: newLine - leading + 1,
        newLines: 0,
        lines: [],
      };
      for (const line of before.slice(oldLine - leading, oldLine)) show(" ", line);
    }
    if (run.kind === "-") {
      for (const line of before.slice(oldLine, oldLine + run.count)) show("-", line);
      oldLine += run.count;
    } else {
      for (const line of after.slice(newLine, newLine + run.count)) show("+", line);
      newLine += run.count;
    }
  });
  if (hunk) result.push(hunk);
  return result;
}

/**
 * A unified diff that turns `before` into `after`, with the headers and hunks
 * of `diff`'s `createTwoFilesPatch`. That function compares the whole texts,
 * at a cost that grows with their length times the number of changed lines, so
 * that rewrapping a long document took minutes to show. This one compares only
 * the regions that changed and their neighbours. Where it removes and adds
 * other lines than a comparison of the whole texts would, both diffs turn
 * `before` into `after`.
 */
export function unifiedDiff(
  oldFileName: string,
  newFileName: string,
  before: string,
  after: string,
): string {
  const oldLines = lines(before);
  const newLines = lines(after);
  return formatPatch({
    oldFileName,
    newFileName,
    oldHeader: undefined,
    newHeader: undefined,
    hunks: hunks(oldLines, newLines, runs(oldLines, newLines)),
  });
}
