// Origin: micromark@4.0.3, lib/initialize/document.js, writeToChild's lazy-line
// spanning-token search. The predicate and backward fallback are upstream's;
// the private, positive witness cache is local (#796).
import type { Event, Token } from "./types.js";

const mdrefineLazyContinuations = new WeakMap<Event[], { index: number; token: Token }>();

function mdrefineSpansLine(token: Token, offset: number): boolean {
  return token.start.offset < offset && (!token.end || token.end.offset > offset);
}

// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.
export function mdrefineContinuesLazy(events: Event[], lineStartOffset: number): boolean {
  const known = mdrefineLazyContinuations.get(events);
  // Resolvers can replace/reorder events or close/change a token. A surviving
  // member that still spans this boundary proves the original search succeeds.
  if (
    known &&
    events[known.index]?.[1] === known.token &&
    mdrefineSpansLine(known.token, lineStartOffset)
  )
    return true;
  let index = events.length;
  while (index--) {
    const token = events[index][1];
    if (mdrefineSpansLine(token, lineStartOffset)) {
      mdrefineLazyContinuations.set(events, { index, token });
      return true;
    }
  }
  // Absence says nothing about a later write. Never memoize a negative result.
  mdrefineLazyContinuations.delete(events);
  return false;
}
