// Origin: micromark-core-commonmark@2.0.4, lib/attention.js, resolveAllAttention.
// This is its maintained local fast copy. Opener groups, no-closer cleanup,
// homogeneous batching and the audited resolver registry are local additions.
import type { Construct, Context, Event, Opener, Point, Resolver, Token } from "./types.js";
declare const push: (events: Event[], items: Event[]) => Event[];
declare const splice: (events: Event[], start: number, remove: number, items: Event[]) => void;
declare const resolveAll: (constructs: Construct[], events: Event[], context: Context) => Event[];
declare const movePoint: (point: Point, offset: number) => void;
declare const resolveAllAttention: Resolver;
// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.
export function resolveAllAttentionFast(events: Event[], context: Context) {
  if (mdrefineHandleAttentionFast(events, context)) return events;
  let index = -1;
  /** @type {Array<Event>} */
  let nextEvents: Event[];
  const left: Event[] = [];
  let read = 0;
  const openers = new AttentionOpeners(context);

  // Walk through all events.
  //
  // Note: performance of this is fine on an mb of normal markdown, but it’s
  // a bottleneck for malicious stuff.
  while (++index < left.length + events.length - read) {
    while (left.length < index + 2 && read < events.length) left.push(events[read++]);
    if (
      left[index][0] === "exit" &&
      left[index][1].type === "attentionSequence" &&
      left[index][1]._open
    )
      openers.add(index, left[index][1]);
    // Find a token that can close.
    if (
      left[index][0] === "enter" &&
      left[index][1].type === "attentionSequence" &&
      left[index][1]._close
    ) {
      const open = openers.find(left[index][1]);

      // Now walk back to find an opener.
      if (open !== undefined) {
        // Find a token that can open the closer.
        if (
          left[open][0] === "exit" &&
          left[open][1].type === "attentionSequence" &&
          left[open][1]._open &&
          // If the markers are the same:
          context.sliceSerialize(left[open][1]).charCodeAt(0) ===
            context.sliceSerialize(left[index][1]).charCodeAt(0)
        ) {
          // If the opening can close or the closing can open,
          // and the close size *is not* a multiple of three,
          // but the sum of the opening and closing size *is* multiple of three,
          // then don’t match.
          if (
            (left[open][1]._close || left[index][1]._open) &&
            (left[index][1].end.offset - left[index][1].start.offset) % 3 &&
            !(
              (left[open][1].end.offset -
                left[open][1].start.offset +
                left[index][1].end.offset -
                left[index][1].start.offset) %
              3
            )
          ) {
            continue;
          }

          // Number of markers to use from the sequence.
          const use =
            left[open][1].end.offset - left[open][1].start.offset > 1 &&
            left[index][1].end.offset - left[index][1].start.offset > 1
              ? 2
              : 1;
          const start = {
            ...left[open][1].end,
          };
          const end = {
            ...left[index][1].start,
          };
          movePoint(start, -use);
          movePoint(end, use);
          const openingSequence: Token = {
            type: use > 1 ? "strongSequence" : "emphasisSequence",
            start,
            end: {
              ...left[open][1].end,
            },
          };
          const closingSequence: Token = {
            type: use > 1 ? "strongSequence" : "emphasisSequence",
            start: {
              ...left[index][1].start,
            },
            end,
          };
          const text: Token = {
            type: use > 1 ? "strongText" : "emphasisText",
            start: {
              ...left[open][1].end,
            },
            end: {
              ...left[index][1].start,
            },
          };
          const group: Token = {
            type: use > 1 ? "strong" : "emphasis",
            start: {
              ...openingSequence.start,
            },
            end: {
              ...closingSequence.end,
            },
          };
          left[open][1].end = {
            ...openingSequence.start,
          };
          left[index][1].start = {
            ...closingSequence.end,
          };
          nextEvents = [];

          // If there are more markers in the opening, add them before.
          if (left[open][1].end.offset - left[open][1].start.offset) {
            nextEvents = push(nextEvents, [
              ["enter", left[open][1], context],
              ["exit", left[open][1], context],
            ]);
          }

          // Opening.
          nextEvents = push(nextEvents, [
            ["enter", group, context],
            ["enter", openingSequence, context],
            ["exit", openingSequence, context],
            ["enter", text, context],
          ]);

          // Always populated by defaults.

          // Between.
          nextEvents = push(
            nextEvents,
            resolveAll(
              context.parser.constructs.insideSpan.null,
              left.slice(open + 1, index),
              context,
            ),
          );

          // Closing.
          nextEvents = push(nextEvents, [
            ["exit", text, context],
            ["enter", closingSequence, context],
            ["exit", closingSequence, context],
            ["exit", group, context],
          ]);

          /** @type {number} */
          let offset = 0;

          // If there are more markers in the closing, add them after.
          if (left[index][1].end.offset - left[index][1].start.offset) {
            offset = 2;
            nextEvents = push(nextEvents, [
              ["enter", left[index][1], context],
              ["exit", left[index][1], context],
            ]);
          }
          openers.removeFrom(open - 1);
          if (nextEvents[0]?.[1].type === "attentionSequence" && nextEvents[0][1]._open)
            openers.add(open, nextEvents[0][1]);
          splice(left, open - 1, index - open + 3, nextEvents);
          index = open + nextEvents.length - offset - 2;
        }
      }
    }
  }

  splice(events, 0, read, left);
  // Remove remaining sequences.
  index = -1;
  while (++index < events.length) {
    if (events[index][1].type === "attentionSequence") {
      events[index][1].type = "data";
    }
  }
  return events;
}

export class AttentionOpeners {
  declare context: Context;
  declare groups: Map<number, Opener[][]>;
  declare active: Opener[];
  constructor(context: Context) {
    this.context = context;
    this.groups = new Map();
    this.active = [];
  }
  add(index: number, token: Token) {
    const marker = this.context.sliceSerialize(token).charCodeAt(0);
    let groups = this.groups.get(marker);
    if (!groups) {
      groups = Array.from({ length: 6 }, () => []);
      this.groups.set(marker, groups);
    }
    const remainder = (token.end.offset - token.start.offset) % 3;
    const bucket = groups[(token._close ? 3 : 0) + remainder];
    const entry = { index, token, bucket };
    bucket.push(entry);
    this.active.push(entry);
  }
  removeFrom(index: number) {
    while (this.active.length && this.active.at(-1)!.index >= index) {
      const entry = this.active.pop()!;
      if (entry.bucket.pop() !== entry) throw new Error("Invalid attention opener stack");
    }
  }
  find(token: Token) {
    const marker = this.context.sliceSerialize(token).charCodeAt(0);
    const groups = this.groups.get(marker);
    if (!groups) return;
    const remainder = (token.end.offset - token.start.offset) % 3;
    let best;
    for (let group = 0; group < 6; group++) {
      if ((group >= 3 || token._open) && remainder && ((group % 3) + remainder) % 3 === 0) continue;
      const entry = groups[group].at(-1);
      if (entry && (best === undefined || entry.index > best)) best = entry.index;
    }
    return best;
  }
}

export function mdrefineHandleAttentionFast(events: Event[], context: Context) {
  const batch = context.parser.constructs.disable.null.includes("mdrefineHomogeneousAttention");
  let hasSequence = false;
  let hasCloser = false;
  let shape = batch;
  let sequenceEvents = 0;
  let open = -1;
  let close = -1;
  // One shared pre-scan: no-closer detection and the potential batch shape.
  // In particular, a nested call with no raw sequences returns after this scan,
  // without a registry Set, scratch array, or a second event traversal.
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event[1].type !== "attentionSequence") continue;
    hasSequence = true;
    sequenceEvents++;
    if (event[0] === "enter" && event[1]._close) {
      hasCloser = true;
      // Without batch opt-in, finding a real closer is enough to hand off to
      // the existing matching algorithm; the pre-scan need not finish.
      if (!batch) return false;
    }
    if (!shape) continue;
    if (event[0] === "exit") {
      if (index !== open + 1 && index !== close + 1) shape = false;
      continue;
    }
    if (
      event[0] !== "enter" ||
      events[index + 1]?.[0] !== "exit" ||
      events[index + 1][1] !== event[1] ||
      event[2] !== context ||
      events[index + 1][2] !== context
    ) {
      shape = false;
      continue;
    }
    if (open < 0) open = index;
    else if (close < 0) close = index;
    else shape = false;
  }
  if (!hasCloser) {
    if (hasSequence) {
      // Exact original cleanup. Do not clear flags or replace any tuple,
      // token, point, or the array. A closing exit without an entering closer
      // cannot match in either the stock or existing Fast walk.
      let index = -1;
      while (++index < events.length) {
        if (events[index][1].type === "attentionSequence") {
          events[index][1].type = "data";
        }
      }
    }
    return true;
  }
  if (!shape || sequenceEvents !== 4 || open < 0 || close <= open + 2) return false;
  return mdrefineResolveHomogeneousAttention(events, context, open, close);
}

export function mdrefineResolveHomogeneousAttention(
  events: Event[],
  context: Context,
  open: number,
  close: number,
) {
  const opening = events[open][1];
  const closing = events[close][1];
  if (!opening._open || !closing._close) return false;
  const openingSize = opening.end.offset - opening.start.offset;
  const closingSize = closing.end.offset - closing.start.offset;
  if (
    !Number.isSafeInteger(openingSize) ||
    !Number.isSafeInteger(closingSize) ||
    Math.min(openingSize, closingSize) < 4 ||
    opening.end.offset > closing.start.offset
  )
    return false;
  // Validate actual source, not artificial same-chunk endpoint coordinates.
  // A legitimate run ending at EOF/EOL/tab/NUL can have _bufferIndex === -1.
  // Stock's exact movePoint arithmetic below must remain unchanged even when
  // it produces unusual _bufferIndex values at such a boundary.
  const left = context.sliceSerialize(opening);
  const right = context.sliceSerialize(closing);
  const marker = left.charCodeAt(0);
  if (
    left.length !== openingSize ||
    right.length !== closingSize ||
    (marker !== 42 && marker !== 95)
  )
    return false;
  for (let index = 0; index < left.length; index++)
    if (left.charCodeAt(index) !== marker) return false;
  for (let index = 0; index < right.length; index++)
    if (right.charCodeAt(index) !== marker) return false;
  // Simulate only stock's two-candidate grammar before any mutation. It may
  // consume unequal/two-way runs and may stop with both runs still present.
  // No other raw candidate exists that could change this matcher choice.
  let remainingOpening = openingSize;
  let remainingClosing = closingSize;
  let layerCount = 0;
  while (remainingOpening && remainingClosing) {
    if (
      (opening._close || closing._open) &&
      remainingClosing % 3 &&
      (remainingOpening + remainingClosing) % 3 === 0
    )
      break;
    const use = remainingOpening > 1 && remainingClosing > 1 ? 2 : 1;
    remainingOpening -= use;
    remainingClosing -= use;
    layerCount++;
  }
  // In particular, a first-layer rule-of-three block declines before any
  // mutation/callback. Tiny reductions keep the existing matcher as well.
  if (layerCount < 2) return false;
  if (
    !mdrefineBalancedAttentionEvents(events, 0, open) ||
    !mdrefineBalancedAttentionEvents(events, open + 2, close) ||
    !mdrefineBalancedAttentionEvents(events, close + 2, events.length)
  )
    return false;
  // All shape/source checks precede the registry allocation and any mutation.
  const insideSpan = context.parser.constructs.insideSpan.null;
  if (!mdrefineKnownHomogeneousPipeline(insideSpan)) return false;

  const layers = [];
  let currentOpening = openingSize;
  let currentClosing = closingSize;
  let interior: Event[] | undefined;
  for (let layer = 0; layer < layerCount; layer++) {
    const use = currentOpening > 1 && currentClosing > 1 ? 2 : 1;
    const start = { ...opening.end };
    const end = { ...closing.start };
    movePoint(start, -use);
    movePoint(end, use);
    const openingSequence: Token = {
      type: use > 1 ? "strongSequence" : "emphasisSequence",
      start,
      end: { ...opening.end },
    };
    const closingSequence: Token = {
      type: use > 1 ? "strongSequence" : "emphasisSequence",
      start: { ...closing.start },
      end,
    };
    const text: Token = {
      type: use > 1 ? "strongText" : "emphasisText",
      start: { ...opening.end },
      end: { ...closing.start },
    };
    const group: Token = {
      type: use > 1 ? "strong" : "emphasis",
      start: { ...openingSequence.start },
      end: { ...closingSequence.end },
    };
    opening.end = { ...openingSequence.start };
    closing.start = { ...closingSequence.end };
    if (interior === undefined) {
      // One real call at stock's first reduction point, with the same input
      // tuples and original-run endpoint mutations already visible.
      // This call's actual cost is R(interior), not assumed linear.
      interior = resolveAll(insideSpan, events.slice(open + 2, close), context);
    }
    layers.push({ openingSequence, closingSequence, text, group });
    currentOpening -= use;
    currentClosing -= use;
  }
  const output: Event[] = [];
  if (remainingOpening) {
    // Stock retains the original token but creates fresh leftover tuples on
    // every reduction. Reusing events[open]/events[open+1] would be inexact.
    output.push(["enter", opening, context], ["exit", opening, context]);
  }
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index];
    output.push(
      ["enter", layer.group, context],
      ["enter", layer.openingSequence, context],
      ["exit", layer.openingSequence, context],
      ["enter", layer.text, context],
    );
  }
  for (const event of interior!) output.push(event);
  for (const layer of layers) {
    output.push(
      ["exit", layer.text, context],
      ["enter", layer.closingSequence, context],
      ["exit", layer.closingSequence, context],
      ["exit", layer.group, context],
    );
  }
  if (remainingClosing) output.push(["enter", closing, context], ["exit", closing, context]);
  mdrefineReplaceAttentionRegion(events, open, close + 2, output);
  // The original walk has no further raw candidate to match, then performs
  // its final left-to-right cleanup. Fully consumed tokens remain raw off-array.
  if (remainingOpening) opening.type = "data";
  if (remainingClosing) closing.type = "data";
  return true;
}

export function mdrefineReplaceAttentionRegion(
  events: Event[],
  from: number,
  to: number,
  output: Event[],
) {
  const oldLength = events.length;
  const delta = output.length - (to - from);
  if (delta > 0) {
    events.length = oldLength + delta;
    for (let index = oldLength - 1; index >= to; index--) {
      events[index + delta] = events[index];
    }
  } else if (delta < 0) {
    for (let index = to; index < oldLength; index++) {
      events[index + delta] = events[index];
    }
  }
  for (let index = 0; index < output.length; index++) events[from + index] = output[index];
  events.length = oldLength + delta;
}

const mdrefineHomogeneousResolverRoles = new WeakMap<Resolver, string>();

export function mdrefineRegisterHomogeneousResolver(resolve: Resolver, role: string) {
  mdrefineHomogeneousResolverRoles.set(resolve, role);
  return resolve;
}

export function mdrefineKnownHomogeneousPipeline(constructs: Construct[]) {
  if (!Array.isArray(constructs)) return false;
  const seen = new Set();
  let lastRole;
  for (const construct of constructs) {
    const resolve = construct.resolveAll;
    // Same function-identity deduplication as micromark-util-resolve-all.
    if (!resolve || seen.has(resolve)) continue;
    seen.add(resolve);
    const role = mdrefineHomogeneousResolverRoles.get(resolve);
    if (role === undefined) return false;
    lastRole = role;
  }
  return lastRole === "text";
}

export function mdrefineBalancedAttentionEvents(events: Event[], from: number, to: number) {
  const stack: Token[] = [];
  for (let index = from; index < to; index++) {
    const [phase, token] = events[index];
    if (phase === "enter") stack.push(token);
    else if (phase !== "exit" || stack.pop() !== token) return false;
  }
  return stack.length === 0;
}

mdrefineRegisterHomogeneousResolver(resolveAllAttention, "attention");
