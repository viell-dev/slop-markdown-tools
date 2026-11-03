// Origin: mdast-util-from-markdown@2.1.0, lib/index.js, compile/prepareList.
// Item ranges, spread and tail handling follow upstream with #280's footnote
// indentation fix. Indexed descendant skips and one final merge are local (#859).
import type { Context, Event, Point, Token } from "./types.js";

type SpreadToken = Token & { _spread?: boolean };
type OpenItem = Omit<Token, "end"> & { _spread: boolean; end?: Point | undefined };
interface ListRange {
  start: number;
  end: number;
}
interface Insertion {
  at: number;
  event: Event;
}

// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.
export function mdrefinePrepareLists(events: Event[]): Event[] | undefined {
  const disabled = (events[0]?.[2] as Context | undefined)?.parser.constructs.disable.null;
  if (
    !disabled?.includes("mdrefineBuiltinContainers") ||
    disabled.includes("mdrefineOriginalContainers")
  )
    return;
  const containerEnds = new Map<number, number>();
  const containers: number[] = [];
  const lists: ListRange[] = [];
  for (let at = 0; at < events.length; at++) {
    const [kind, token] = events[at];
    if (
      token.type === "listOrdered" ||
      token.type === "listUnordered" ||
      token.type === "blockQuote"
    ) {
      if (kind === "enter") containers.push(at);
      else {
        const start = containers.pop();
        // An unexpected extension/event shape keeps the original preparation.
        // No event or token has been changed during this indexing pass.
        if (start === undefined || events[start][1] !== token) return;
        containerEnds.set(start, at);
        if (token.type !== "blockQuote") lists.push({ start, end: at });
      }
    }
  }
  if (containers.length) return;
  if (!lists.length) return events.slice();
  const insertions: Insertion[] = [];
  // Same closing-event/postorder sequence as upstream. Raw indices never shift.
  for (const { start, end } of lists) prepareList(start, end);
  const byIndex = new Map<number, Event[]>();
  for (const insertion of insertions) {
    let entries = byIndex.get(insertion.at);
    if (!entries) byIndex.set(insertion.at, (entries = []));
    entries.push(insertion.event);
  }
  const prepared: Event[] = [];
  for (let at = 0; at < events.length; at++) {
    const before = byIndex.get(at);
    if (before) for (const event of before) prepared.push(event);
    prepared.push(events[at]);
  }
  return prepared;

  function prepareList(start: number, end: number): void {
    let index = start - 1;
    let containerBalance = -1;
    let listSpread = false;
    let listItem: OpenItem | undefined;
    let lineIndex: number | undefined;
    let firstBlankLineIndex: number | undefined;
    let atMarker: boolean | undefined;
    while (++index <= end) {
      const event = events[index];
      switch (event[1].type) {
        case "listUnordered":
        case "listOrdered":
        case "blockQuote": {
          if (event[0] === "enter") {
            containerBalance++;
            // Inner containers reset atMarker but do no bookkeeping for this
            // list. Visit their exit next, preserving the balance transition.
            if (containerBalance > 0) {
              const exit = containerEnds.get(index);
              if (exit !== undefined) index = exit - 1;
            }
          } else containerBalance--;
          atMarker = undefined;
          break;
        }
        case "lineEndingBlank": {
          if (event[0] === "enter") {
            if (listItem && !atMarker && !containerBalance && !firstBlankLineIndex)
              firstBlankLineIndex = index;
            atMarker = undefined;
          }
          break;
        }
        case "linePrefix":
        case "listItemValue":
        case "listItemMarker":
        case "listItemPrefix":
        case "listItemPrefixWhitespace":
          break;
        default:
          atMarker = undefined;
      }
      if (
        (!containerBalance && event[0] === "enter" && event[1].type === "listItemPrefix") ||
        (containerBalance === -1 &&
          event[0] === "exit" &&
          (event[1].type === "listUnordered" || event[1].type === "listOrdered"))
      ) {
        if (listItem) {
          let tailIndex = index;
          lineIndex = undefined;
          while (tailIndex--) {
            const tailEvent = events[tailIndex];
            if (tailEvent[1].type === "lineEnding" || tailEvent[1].type === "lineEndingBlank") {
              if (tailEvent[0] === "exit") continue;
              if (lineIndex) {
                events[lineIndex][1].type = "lineEndingBlank";
                listSpread = true;
              }
              tailEvent[1].type = "lineEnding";
              lineIndex = tailIndex;
            } else if (
              tailEvent[1].type !== "linePrefix" &&
              tailEvent[1].type !== "blockQuotePrefix" &&
              tailEvent[1].type !== "blockQuotePrefixWhitespace" &&
              tailEvent[1].type !== "blockQuoteMarker" &&
              tailEvent[1].type !== "listItemIndent" &&
              tailEvent[1].type !== "gfmFootnoteDefinitionIndent"
            )
              break;
          }
          if (firstBlankLineIndex && (!lineIndex || firstBlankLineIndex < lineIndex))
            listItem._spread = true;
          listItem.end = Object.assign({}, lineIndex ? events[lineIndex][1].start : event[1].end);
          insertions.push({ at: lineIndex || index, event: ["exit", listItem as Token, event[2]] });
        }
        if (event[1].type === "listItemPrefix") {
          listItem = {
            // Upstream's compiler-only token is absent from micromark's map.
            type: "listItem" as Token["type"],
            _spread: false,
            start: Object.assign({}, event[1].start),
            end: undefined,
          };
          // Like upstream, an item is open until the next prefix/list exit.
          // Every item is closed before the prepared events are returned.
          insertions.push({ at: index, event: ["enter", listItem as Token, event[2]] });
          firstBlankLineIndex = undefined;
          atMarker = true;
        }
      }
    }
    (events[start][1] as SpreadToken)._spread = listSpread;
  }
}
