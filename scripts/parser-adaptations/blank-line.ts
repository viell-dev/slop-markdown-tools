// Origin: micromark-core-commonmark@2.0.4, lib/blank-line.js and list.js's
// continuation check. The original grammar/check remains the fallback;
// tokenizer-local whitespace-suffix proofs are local (#859).
import type { Effects, State, TokenizeContext } from "micromark-util-types";
import type { Construct, Context, Point } from "./types.js";

declare const blankLine: Construct;

interface BlankSpan {
  start: Point;
  end: Point;
  blank: boolean;
}
const mdrefineBlankSpans = new WeakMap<TokenizeContext, BlankSpan>();

function mdrefineCursorBefore(left: Point, right: Point): boolean {
  return (
    left._index < right._index ||
    (left._index === right._index && left._bufferIndex <= right._bufferIndex)
  );
}

const mdrefineBlankProof: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    const start = this.now();
    const finish =
      (blank: boolean): State =>
      (code) => {
        // Capture before check() restores the cursor and temporary events. A
        // completed scan has consumed only spaces/tabs up to this witness.
        mdrefineBlankSpans.set(this, { start, end: this.now(), blank });
        return (blank ? ok : nok)(code);
      };
    return blankLine.tokenize.call(this, effects, finish(true), finish(false));
  },
};

// Internal source fragment, inserted into the reviewed upstream scope.
// Upstream MIT notices remain in parser.generated.LICENSES.txt.
export function mdrefineCheckBlankLine(
  this: Context,
  effects: Effects,
  onBlank: State,
  notBlank: State,
): State {
  const disabled = this.parser.constructs.disable.null;
  if (
    !disabled.includes("mdrefineBuiltinContainers") ||
    disabled.includes("mdrefineOriginalContainers")
  )
    return effects.check(blankLine, onBlank, notBlank);
  return (code) => {
    const at = this.now();
    const known = mdrefineBlankSpans.get(this);
    // Chunk cursors distinguish expanded tab positions that share an offset.
    // Tokenizer chunks are immutable; writes append, and restores may rewind.
    if (
      known &&
      at.line === known.start.line &&
      mdrefineCursorBefore(known.start, at) &&
      mdrefineCursorBefore(at, known.end)
    )
      return (known.blank ? onBlank : notBlank)(code);
    return effects.check(mdrefineBlankProof, onBlank, notBlank)(code);
  };
}
