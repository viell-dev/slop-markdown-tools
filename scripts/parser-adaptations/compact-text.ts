// Origin: micromark@4.0.3, lib/initialize/text.js, createResolver's nested
// resolveAllText data-merging loop. This local compaction replacement leaves
// the upstream extraResolver callback in the host scope.
import type { Event } from "./types.js";
declare const events: Event[];
// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.
let index = 0;
let length = 0;
while (index < events.length) {
  const enter = index;
  if (events[index][1].type === "data") {
    index += 2;
    while (index < events.length && events[index][1].type === "data") index++;
    if (index !== enter + 2) events[enter][1].end = events[index - 1][1].end;
    events[length++] = events[enter];
    events[length++] = events[enter + 1];
  } else events[length++] = events[index++];
}
events.length = length;

export {};
