// Origin: micromark-extension-gfm-strikethrough@2.1.0, lib/syntax.js,
// gfmStrikethrough's nested resolveAllStrikethrough. This maintained fast copy
// adds local walked-prefix/opener groups and no-closer cleanup.
import type { Construct, Context, Event, Opener, Token } from "./types.js";
declare const splice: (events: Event[], start: number, remove: number, items: Event[]) => void;
declare const resolveAll: (constructs: Construct[], events: Event[], context: Context) => Event[];
// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.
export function resolveAllStrikethroughFast(events: Event[], context: Context) {
  if (mdrefineHandleStrikeNoCloser(events)) return events;
  let index = -1;
  const left: Event[] = [];
  let read = 0;
  const openers = new StrikeOpeners();

  // Walk through all events.
  while (++index < left.length + events.length - read) {
    while (left.length < index + 2 && read < events.length) left.push(events[read++]);
    if (
      left[index][0] === "exit" &&
      left[index][1].type === "strikethroughSequenceTemporary" &&
      left[index][1]._open
    )
      openers.add(index, left[index][1]);
    // Find a token that can close.
    if (
      left[index][0] === "enter" &&
      left[index][1].type === "strikethroughSequenceTemporary" &&
      left[index][1]._close
    ) {
      const open = openers.find(left[index][1]);

      // Now walk back to find an opener.
      if (open !== undefined) {
        // Find a token that can open the closer.
        if (
          left[open][0] === "exit" &&
          left[open][1].type === "strikethroughSequenceTemporary" &&
          left[open][1]._open &&
          // If the sizes are the same:
          left[index][1].end.offset - left[index][1].start.offset ===
            left[open][1].end.offset - left[open][1].start.offset
        ) {
          left[index][1].type = "strikethroughSequence";
          left[open][1].type = "strikethroughSequence";

          /** @type {Token} */
          const strikethrough: Token = {
            type: "strikethrough",
            start: Object.assign({}, left[open][1].start),
            end: Object.assign({}, left[index][1].end),
          };

          /** @type {Token} */
          const text: Token = {
            type: "strikethroughText",
            start: Object.assign({}, left[open][1].end),
            end: Object.assign({}, left[index][1].start),
          };

          // Opening.
          /** @type {Array<Event>} */
          const nextEvents: Event[] = [
            ["enter", strikethrough, context],
            ["enter", left[open][1], context],
            ["exit", left[open][1], context],
            ["enter", text, context],
          ];
          const insideSpan = context.parser.constructs.insideSpan.null;
          if (insideSpan) {
            // Between.
            splice(
              nextEvents,
              nextEvents.length,
              0,
              resolveAll(insideSpan, left.slice(open + 1, index), context),
            );
          }

          // Closing.
          splice(nextEvents, nextEvents.length, 0, [
            ["exit", text, context],
            ["enter", left[index][1], context],
            ["exit", left[index][1], context],
            ["exit", strikethrough, context],
          ]);
          openers.removeFrom(open - 1);
          splice(left, open - 1, index - open + 3, nextEvents);
          index = open + nextEvents.length - 2;
        }
      }
    }
  }
  splice(events, 0, read, left);
  index = -1;
  while (++index < events.length) {
    if (events[index][1].type === "strikethroughSequenceTemporary") {
      events[index][1].type = "data";
    }
  }
  return events;
}

export class StrikeOpeners {
  declare groups: Map<number, Opener[]>;
  declare active: Opener[];
  constructor() {
    this.groups = new Map();
    this.active = [];
  }
  add(index: number, token: Token) {
    const size = token.end.offset - token.start.offset;
    let bucket = this.groups.get(size);
    if (!bucket) {
      bucket = [];
      this.groups.set(size, bucket);
    }
    const entry = { index, token, bucket };
    bucket.push(entry);
    this.active.push(entry);
  }
  removeFrom(index: number) {
    while (this.active.length && this.active.at(-1)!.index >= index) {
      const entry = this.active.pop()!;
      if (entry.bucket.pop() !== entry) throw new Error("Invalid strike opener stack");
    }
  }
  find(token: Token) {
    return this.groups.get(token.end.offset - token.start.offset)?.at(-1)?.index;
  }
}

export function mdrefineHandleStrikeNoCloser(events: Event[]) {
  let hasSequence = false;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event[1].type !== "strikethroughSequenceTemporary") continue;
    hasSequence = true;
    // This is the stock matcher gate, not any '_close' field on any token.
    if (event[0] === "enter" && event[1]._close) return false;
  }
  if (hasSequence) {
    // Exact original cleanup; no flags, points, tokens or tuples are replaced.
    let index = -1;
    while (++index < events.length) {
      if (events[index][1].type === "strikethroughSequenceTemporary") {
        events[index][1].type = "data";
      }
    }
  }
  return true;
}
