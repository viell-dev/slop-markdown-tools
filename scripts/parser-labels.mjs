// Parser-only #94 corrections. Production calls these only after the main
// parser-patches.mjs name/version/raw-SHA guards. Preserve upstream MIT notices.
import assert from "node:assert/strict";
import { parserAdaptationSource } from "./parser-adaptations.mjs";

function once(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one label source anchor: ${before}`);
  return source.replace(before, () => after);
}

// Appended verbatim to BOTH adapted upstream modules. These preconditions are
// part of the optimization, not merely destination-cache guard conditions.
const contract = String.raw`
// mdrefine #94: trusted-built-in label proof contract; not arbitrary extensions.
// (a) Core definition.js is the only writer of parser.defined. factoryLabel
// rejects bare '[' and escapes only '[', backslash and ']'. normalizeIdentifier
// preserves these characters (no case mapping introduces one). A definition ID
// containing '[' therefore has an odd run of backslashes before that marker.
// (b) The stock GFM footnote-definition tokenizer is the only writer of
// parser.gfmFootnotes. Its labels have no whitespace or unescaped '[' or ']'.
// (c) characterEscape is enabled in every opted-in grammar; no builtin disables
// it. A genuine nested opener/attempted closer is not an escaped marker.
// (d) No trusted text construct ends in a backslash immediately before a label
// '[' or an attempted ']' while that label is open. Hard-break escapes end at a
// line ending; code, math, HTML, references and Obsidian literals end otherwise.
// GFM literal autolinks can end in a backslash, but are refused inside an open
// label. This also relies on #542 previousUnbalanced having no false negatives.
// (e) Text events change only by appends, attempt rollback truncation, code/math
// resolution within their own construct, or label/footnote suffix resolution
// from its opener with a new ending link/image/gfmFootnoteCall barrier. Nothing
// is retyped INTO a barrier in a retained prefix. resolveAllLabelEnd runs after
// tokenization; Obsidian has no resolvers and CJK only resolveAll. Thus a stale
// prefix is hidden by the new ending barrier; a no-barrier prefix cannot gain
// an earlier barrier. Destination identity/role guards alone do not prove this.
// A new builtin text construct, resolver, disable entry or definition writer
// requires re-proving (a)-(e), or keeping its grammar off mdrefineBuiltinLabels.
// External syntax and raw callers keep the original NONEMPTY-dictionary path.
// Empty dictionary shortcuts are independent: stock lookup/scan cannot succeed
// and has no token effects, so they are safe without the trusted marker too.
`;

/** @param {string} source @returns {string} */
export function repairLabelEnd(source) {
  let result = once(
    source,
    "  const labelStarts = self._labelStarts;",
    '  const labelStarts = self._labelStarts;\n  const disabled = self.parser.constructs.disable.null;\n  const mdrefineFastLabels = disabled.includes("mdrefineBuiltinLabels") && !disabled.includes("mdrefineDeferredInline");',
  );
  result = once(
    result,
    "      labelStarts.pop();\n    }",
    "      labelStarts.pop();\n      if (mdrefineFastLabels && labelStarts.length) mdrefineNestedLabels.add(labelStarts[labelStarts.length - 1]);\n    }",
  );
  result = once(
    result,
    "    defined = self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize({",
    "    // Empty definitions never match, on either marker path. With a nonempty\n    // dictionary, only trusted builtins may use the nested-opener proof.\n    defined = self.parser.defined.length > 0 && (!mdrefineFastLabels || !mdrefineNestedLabels.has(labelStart)) && self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize({",
  );
  result = once(
    result,
    "    labelStarts.pop();\n    return ok(code);",
    "    labelStarts.pop();\n    if (mdrefineFastLabels && labelStarts.length) mdrefineNestedLabels.add(labelStarts[labelStarts.length - 1]);\n    return ok(code);",
  );
  return (
    result +
    "\n" +
    contract +
    "\n// A popped child leaves an even-backslash bare '[' in its parent's raw label.\nconst mdrefineNestedLabels = new WeakSet();\n"
  );
}

/** @param {string} source @returns {string} */
export function repairFootnoteSyntax(source) {
  const signature = "function tokenizePotentialGfmFootnoteCall(effects, ok, nok) {";
  const renamed = once(
    source,
    signature,
    "function tokenizePotentialGfmFootnoteCallOriginal(effects, ok, nok) {",
  );
  return renamed + "\n" + contract + "\n" + parserAdaptationSource("footnote");
}
