// Origin: micromark-core-commonmark@2.0.4, lib/code-text.js, resolveCodeText's
// "Merge adjacent spaces and data" section. This local compaction replacement
// retains the upstream padding preparation and suffix events in the host scope.
import type { Event } from "./types.js";
declare const events: Event[];
declare let index: number;
declare let enter: number | undefined;
declare const headEnterIndex: number;
declare let tailExitIndex: number;
// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.
// PR238: compact the selected code-text region, retaining padding and suffixes.
index = headEnterIndex - 1;
tailExitIndex++;
let length = headEnterIndex;
while (++index <= tailExitIndex) {
  if (enter === undefined) {
    if (index !== tailExitIndex && events[index][1].type !== "lineEnding") enter = index;
    else if (index !== tailExitIndex) events[length++] = events[index];
  } else if (index === tailExitIndex || events[index][1].type === "lineEnding") {
    events[enter][1].type = "codeTextData";
    if (index !== enter + 2) events[enter][1].end = events[index - 1][1].end;
    events[length++] = events[enter];
    events[length++] = events[enter + 1];
    enter = undefined;
    if (index !== tailExitIndex) events[length++] = events[index];
  }
}
events.splice(length, tailExitIndex - length);

export {};
