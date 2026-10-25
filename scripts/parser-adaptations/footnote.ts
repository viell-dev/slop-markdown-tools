// Origin: micromark-extension-gfm-footnote@2.1.0, lib/syntax.js,
// tokenizePotentialGfmFootnoteCall. The fast tokenizer is a maintained local
// copy; dispatch, prefix caching and earlier-closer proofs are local additions.
import type { Code, Effects, State } from "micromark-util-types";
import type { Context, Event, Token } from "./types.js";
type Barrier = { index: number; event?: Event; type?: string };
declare const normalizeIdentifier: (value: string) => string;
declare const tokenizePotentialGfmFootnoteCallOriginal: (
  this: Context,
  effects: Effects,
  ok: State,
  nok: State,
) => State;
// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.

const mdrefineFootnotePrefixCaches = new WeakMap<Event[], WeakMap<Event, Barrier>>();
const mdrefineFootnoteClosers = new WeakMap<Token, number>();
const mdrefineFootnoteBarriers = new Set([
  "labelImage",
  "gfmFootnoteCall",
  "labelLink",
  "label",
  "image",
  "link",
]);

export function mdrefinePreviousFootnoteBarrier(events: Event[]) {
  let prefixes = mdrefineFootnotePrefixCaches.get(events);
  if (!prefixes) {
    prefixes = new WeakMap<Event, Barrier>();
    mdrefineFootnotePrefixCaches.set(events, prefixes);
  }
  let index = events.length;
  let result: Barrier | undefined;
  while (index--) {
    const event = events[index];
    const token = event[1];
    if (mdrefineFootnoteBarriers.has(token.type)) {
      result = { index, event, type: token.type };
      break;
    }
    const cached = prefixes.get(event);
    // The negative entry deliberately has no destination guard: contract (e)
    // says that retained no-barrier prefixes cannot acquire a barrier. Positive
    // identity/index/role guards also depend on (e); they are not a substitute.
    if (
      cached &&
      (cached.index === -1 ||
        (cached.index < index &&
          events[cached.index] === cached.event &&
          cached.event[1].type === cached.type))
    ) {
      result = cached;
      break;
    }
  }
  result ??= { index: -1 };
  if (events.length) prefixes.set(events[events.length - 1], result);
  return result.index < 0 ? undefined : result.event![1];
}

export function tokenizePotentialGfmFootnoteCall(
  this: Context,
  effects: Effects,
  ok: State,
  nok: State,
) {
  const defined = this.parser.gfmFootnotes || (this.parser.gfmFootnotes = []);
  // Stock's history scan has no token effects and cannot match an empty list.
  // This shortcut is safe on default and external-plugin paths as well.
  if (defined.length === 0) return start;
  const disabled = this.parser.constructs.disable.null;
  return (
    disabled.includes("mdrefineBuiltinLabels") && !disabled.includes("mdrefineDeferredInline")
      ? tokenizePotentialGfmFootnoteCallFast
      : tokenizePotentialGfmFootnoteCallOriginal
  ).call(this, effects, ok, nok);

  function start(code: Code) {
    return nok(code);
  }
}

export function tokenizePotentialGfmFootnoteCallFast(
  this: Context,
  effects: Effects,
  ok: State,
  nok: State,
) {
  // Retain the upstream tokenizer's captured context in its nested state.
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self = this;
  const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
  /** @type {Token} */
  let labelStart: Token | undefined;

  const candidate = mdrefinePreviousFootnoteBarrier(self.events);
  if (candidate?.type === "labelImage") labelStart = candidate;
  return start;

  /**
   * @type {State}
   */
  function start(code: Code) {
    if (!labelStart) return nok(code);
    const at = self.now().offset;
    const earlier = mdrefineFootnoteClosers.get(labelStart);
    // The earlier offset was a real top-level attempted ']' while this image
    // label was open. By (c)-(d), characterEscape and the absence of a prior
    // construct-ending backslash make it UNESCAPED; literal autolinks were
    // refused there under #542. A later raw ID contains that forbidden ']'.
    // Equal-offset retries contain no new closer and must still run normally.
    if (earlier !== undefined && earlier < at) return nok(code);
    mdrefineFootnoteClosers.set(labelStart, at);
    if (!labelStart._balanced) return nok(code);
    const id = normalizeIdentifier(
      self.sliceSerialize({
        start: labelStart.end,
        end: self.now(),
      }),
    );
    if (id.codePointAt(0) !== 94 || !defined.includes(id.slice(1))) {
      return nok(code);
    }
    effects.enter("gfmFootnoteCallLabelMarker");
    effects.consume(code);
    effects.exit("gfmFootnoteCallLabelMarker");
    return ok(code);
  }
}
