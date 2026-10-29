// Origin: micromark-core-commonmark@2.0.4, lib/html-flow.js, tokenizeHtmlFlow.
// This local predicate lets the kind 7 start refuse a line directly below
// paragraph text, which only another construct's interrupt can have ended.
import type { Event } from "./types.js";
// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.
// #770: walk back past the line ending and indentation, as the GFM table's own
// start does, and report whether the flow's previous construct is content.
export function mdrefineFollowsContent(events: Event[]) {
  let index = events.length;
  while (index--) {
    const token = events[index][1];
    if (token.type !== "lineEnding" && token.type !== "linePrefix")
      return events[index][0] === "exit" && token.type === "content";
  }
  return false;
}
