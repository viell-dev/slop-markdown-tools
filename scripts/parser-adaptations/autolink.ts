// Origin: micromark-extension-gfm-autolink-literal@2.1.0, lib/syntax.js,
// previousUnbalanced. This local replacement adds a private positive cache
// and checks destination index, identity, label role and balance before jumps.
import type { Event, Token } from "./types.js";
// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.
// Keep the new positive cache private: token properties are observable by extensions.
const mdrefineUnbalancedLabelSkips = new WeakMap<Token, { index: number; token: Token }>();
export function previousUnbalanced(events: Event[]) {
  let index = events.length;
  let result = false;
  while (index--) {
    const token = events[index][1];
    if ((token.type === "labelLink" || token.type === "labelImage") && !token._balanced) {
      result = true;
      break;
    }
    if (token._gfmAutolinkLiteralWalkedInto) {
      result = false;
      break;
    }
    const skip = mdrefineUnbalancedLabelSkips.get(token);
    // The destination must still witness an unbalanced label before any jump.
    // Rechecking it only after skipping can miss newly intervening labels.
    if (
      skip !== undefined &&
      skip.index < index &&
      events[skip.index] !== undefined &&
      events[skip.index][1] === skip.token &&
      (skip.token.type === "labelLink" || skip.token.type === "labelImage") &&
      !skip.token._balanced
    )
      index = skip.index + 1;
  }
  if (events.length > 0) {
    if (!result) events[events.length - 1][1]._gfmAutolinkLiteralWalkedInto = true;
    else if (index >= 0)
      mdrefineUnbalancedLabelSkips.set(events[events.length - 1][1], {
        index,
        token: events[index][1],
      });
  }
  return result;
}
