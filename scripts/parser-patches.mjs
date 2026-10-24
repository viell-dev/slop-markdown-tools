// Parser-only corrections; upstream source identities are deliberate review gates.
// Adapted dependency code retains its upstream MIT notices in the generated license artifact.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { repairLabelEnd, repairFootnoteSyntax } from "./parser-labels.mjs";

const specs = {
  labelEnd: {
    name: "micromark-core-commonmark",
    version: "2.0.4",
    relative: "lib/label-end.js",
    hash: "055ac0d7f62144011730fbd5bf81ee6f4cb40bdd8428b44d2f0febd3f1ea4364",
  },
  footnoteSyntax: {
    name: "micromark-extension-gfm-footnote",
    version: "2.1.0",
    relative: "lib/syntax.js",
    hash: "5fd8d63fcbb9918a0f7b92f2ba6adea3845e9cbf7f1e74ee239f4d018943ef6b",
  },
  editMap: {
    name: "micromark-util-edit-map",
    version: "1.0.0",
    relative: "index.js",
    hash: "0a29b60e6299a7b17e57e3c185014ad9bfe5a0ad6fd1365ce14605d6d299cbf0",
  },
  footnote: {
    name: "mdast-util-from-markdown",
    version: "2.1.0",
    relative: "lib/index.js",
    hash: "dd0cd20672558ab4ca548b4f7e442e850863228915fff8eafd6d987d29fb107b",
  },
  text: {
    name: "micromark",
    version: "4.0.3",
    relative: "lib/initialize/text.js",
    hash: "1c5682291dbb6cea7f95edeb6d50421238b91752c9e0fb9485bdde44628ce090",
  },
  code: {
    name: "micromark-core-commonmark",
    version: "2.0.4",
    relative: "lib/code-text.js",
    hash: "6e59e9b77a76a825c8cd142b0a2f0495aa5122da271770cb09322456a5207451",
  },
  attention: {
    name: "micromark-core-commonmark",
    version: "2.0.4",
    relative: "lib/attention.js",
    hash: "cd9329ed32379acf1e80e427124f25648fba7722886ecc0de3c5dc8551268ee4",
  },
  autolink: {
    name: "micromark-extension-gfm-autolink-literal",
    version: "2.1.0",
    relative: "lib/syntax.js",
    hash: "2b45c68982c1f80daf125b709faba88803b131a0d710b0374dd309495a74efeb",
  },
  strike: {
    name: "micromark-extension-gfm-strikethrough",
    version: "2.1.0",
    relative: "lib/syntax.js",
    hash: "293e9b13a554fe569efd096cd7f1c3f4d6da861f30bba701e8b923f621181250",
  },
  cjk: {
    name: "micromark-extension-cjk-friendly",
    version: "2.0.2",
    relative: "dist/ext/attention.js",
    hash: "32a4319b1ee61c02fcf1febe995668abaa6fa2e5c033d48099182543df5e408a",
  },
};

const attentionOpeners = String.raw`
class AttentionOpeners {
  constructor(context) { this.context = context; this.groups = new Map(); this.active = []; }
  add(index, token) {
    const marker = this.context.sliceSerialize(token).charCodeAt(0);
    let groups = this.groups.get(marker);
    if (!groups) { groups = Array.from({ length: 6 }, () => []); this.groups.set(marker, groups); }
    const remainder = (token.end.offset - token.start.offset) % 3;
    const bucket = groups[(token._close ? 3 : 0) + remainder];
    const entry = { index, token, bucket };
    bucket.push(entry); this.active.push(entry);
  }
  removeFrom(index) {
    while (this.active.length && this.active.at(-1).index >= index) {
      const entry = this.active.pop();
      if (entry.bucket.pop() !== entry) throw new Error("Invalid attention opener stack");
    }
  }
  find(token) {
    const marker = this.context.sliceSerialize(token).charCodeAt(0);
    const groups = this.groups.get(marker);
    if (!groups) return;
    const remainder = (token.end.offset - token.start.offset) % 3;
    let best;
    for (let group = 0; group < 6; group++) {
      if ((group >= 3 || token._open) && remainder && (group % 3 + remainder) % 3 === 0) continue;
      const entry = groups[group].at(-1);
      if (entry && (best === undefined || entry.index > best)) best = entry.index;
    }
    return best;
  }
}
`;
const strikeOpeners = String.raw`
class StrikeOpeners {
  constructor() { this.groups = new Map(); this.active = []; }
  add(index, token) {
    const size = token.end.offset - token.start.offset;
    let bucket = this.groups.get(size);
    if (!bucket) { bucket = []; this.groups.set(size, bucket); }
    const entry = { index, token, bucket };
    bucket.push(entry); this.active.push(entry);
  }
  removeFrom(index) {
    while (this.active.length && this.active.at(-1).index >= index) {
      const entry = this.active.pop();
      if (entry.bucket.pop() !== entry) throw new Error("Invalid strike opener stack");
    }
  }
  find(token) { return this.groups.get(token.end.offset - token.start.offset)?.at(-1)?.index; }
}
`;
const compactText = String.raw`    let index = 0;
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
`;
const compactCode = String.raw`  // PR238: compact the selected code-text region, retaining padding and suffixes.
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
`;
const guardedAutolink = String.raw`// Keep the new positive cache private: token properties are observable by extensions.
const mdrefineUnbalancedLabelSkips = new WeakMap();
function previousUnbalanced(events) {
  let index = events.length;
  let result = false;
  while (index--) {
    const token = events[index][1];
    if ((token.type === "labelLink" || token.type === "labelImage") && !token._balanced) { result = true; break; }
    if (token._gfmAutolinkLiteralWalkedInto) { result = false; break; }
    const skip = mdrefineUnbalancedLabelSkips.get(token);
    // The destination must still witness an unbalanced label before any jump.
    // Rechecking it only after skipping can miss newly intervening labels.
    if (skip !== undefined && skip.index < index && events[skip.index] !== undefined && events[skip.index][1] === skip.token && (skip.token.type === "labelLink" || skip.token.type === "labelImage") && !skip.token._balanced) index = skip.index + 1;
  }
  if (events.length > 0) {
    if (!result) events[events.length - 1][1]._gfmAutolinkLiteralWalkedInto = true;
    else if (index >= 0) mdrefineUnbalancedLabelSkips.set(events[events.length - 1][1], { index, token: events[index][1] });
  }
  return result;
}
`;

function once(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one source anchor: ${before}`);
  return source.replace(before, after);
}
function section(source, startText, endText, replacement) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `Missing source section: ${startText}`);
  return source.slice(0, start) + replacement(source.slice(start, end)) + source.slice(end);
}
function rewriteAttention(source) {
  return (
    section(source, "function resolveAllAttention(events, context) {", "\n/**", (original) => {
      const cleanup = original.indexOf("  // Remove remaining sequences.");
      assert(cleanup > 0);
      let walk = original.slice(0, cleanup);
      walk = once(
        walk,
        "  let nextEvents;",
        "  let nextEvents;\n  const left = []; let read = 0; const openers = new AttentionOpeners(context);",
      );
      walk = walk
        .replaceAll("events[", "left[")
        .replaceAll("events.slice(", "left.slice(")
        .replaceAll("splice(events, ", "splice(left, ");
      walk = once(
        walk,
        "while (++index < events.length) {",
        "while (++index < left.length + events.length - read) {\n    while (left.length < index + 2 && read < events.length) left.push(events[read++]);",
      );
      walk = once(
        walk,
        "    // Find a token that can close.",
        '    if (left[index][0] === "exit" && left[index][1].type === "attentionSequence" && left[index][1]._open) openers.add(index, left[index][1]);\n    // Find a token that can close.',
      );
      walk = once(walk, "let open = index;", "const open = openers.find(left[index][1]);");
      walk = once(walk, "while (open--) {", "if (open !== undefined) {");
      walk = once(
        walk,
        "          splice(left, open - 1, index - open + 3, nextEvents);",
        '          openers.removeFrom(open - 1);\n          if (nextEvents[0]?.[1].type === "attentionSequence" && nextEvents[0][1]._open) openers.add(open, nextEvents[0][1]);\n          splice(left, open - 1, index - open + 3, nextEvents);',
      );
      walk = once(
        walk,
        "          index = open + nextEvents.length - offset - 2;\n          break;",
        "          index = open + nextEvents.length - offset - 2;",
      );
      const fast = (walk + "  splice(events, 0, read, left);\n" + original.slice(cleanup)).replace(
        "function resolveAllAttention(",
        "function resolveAllAttentionFast(",
      );
      return (
        'function resolveAllAttention(events, context) {\n  return context.parser.constructs.disable.null.includes("mdrefineDeferredInline") ? resolveAllAttentionOriginal(events, context) : resolveAllAttentionFast(events, context);\n}\n' +
        original.replace("function resolveAllAttention(", "function resolveAllAttentionOriginal(") +
        fast +
        attentionOpeners
      );
    }) + "\nexport const mdrefineResolveAttention = resolveAllAttention;\n"
  );
}
function rewriteStrike(source) {
  const rewritten = section(
    source,
    "  function resolveAllStrikethrough(events, context) {",
    "\n  /**",
    (original) => {
      const cleanup = original.indexOf("    index = -1;", original.indexOf("while (++index"));
      assert(cleanup > 0);
      let walk = original.slice(0, cleanup);
      walk = once(
        walk,
        "    let index = -1;",
        "    let index = -1; const left = []; let read = 0; const openers = new StrikeOpeners();",
      );
      walk = walk
        .replaceAll("events[", "left[")
        .replaceAll("events.slice(", "left.slice(")
        .replaceAll("splice(events, ", "splice(left, ");
      walk = once(
        walk,
        "while (++index < events.length) {",
        "while (++index < left.length + events.length - read) {\n      while (left.length < index + 2 && read < events.length) left.push(events[read++]);",
      );
      walk = once(
        walk,
        "      // Find a token that can close.",
        '      if (left[index][0] === "exit" && left[index][1].type === "strikethroughSequenceTemporary" && left[index][1]._open) openers.add(index, left[index][1]);\n      // Find a token that can close.',
      );
      walk = once(walk, "let open = index;", "const open = openers.find(left[index][1]);");
      walk = once(walk, "while (open--) {", "if (open !== undefined) {");
      walk = once(
        walk,
        "            splice(left, open - 1, index - open + 3, nextEvents);",
        "            openers.removeFrom(open - 1);\n            splice(left, open - 1, index - open + 3, nextEvents);",
      );
      walk = once(
        walk,
        "            index = open + nextEvents.length - 2;\n            break;",
        "            index = open + nextEvents.length - 2;",
      );
      const fast = (
        walk +
        "    splice(events, 0, read, left);\n" +
        original.slice(cleanup)
      ).replace("function resolveAllStrikethrough(", "function resolveAllStrikethroughFast(");
      return (
        '  function resolveAllStrikethrough(events, context) {\n    return context.parser.constructs.disable.null.includes("mdrefineDeferredInline") ? resolveAllStrikethroughOriginal(events, context) : resolveAllStrikethroughFast(events, context);\n  }\n' +
        original.replace(
          "function resolveAllStrikethrough(",
          "function resolveAllStrikethroughOriginal(",
        ) +
        fast
      );
    },
  );
  return rewritten + strikeOpeners;
}
/** @param {string} kind @param {string} source @returns {string} */
function repair(kind, source) {
  if (kind === "labelEnd") return repairLabelEnd(source);
  if (kind === "footnoteSyntax") return repairFootnoteSyntax(source);
  if (kind === "editMap")
    return once(source, "    vecs.push(events.slice());\n    events.length = 0;\n", "");
  if (kind === "footnote")
    return once(
      source,
      'tailEvent[1].type === "listItemIndent")',
      'tailEvent[1].type === "listItemIndent" || tailEvent[1].type === "gfmFootnoteDefinitionIndent")',
    );
  if (kind === "text") {
    const at = source.indexOf("function resolveAllText");
    const start = source.indexOf("    let index = -1;", at);
    const end = source.indexOf("    return extraResolver", start);
    assert(at >= 0 && start > at && end > start);
    return registerTextResolverIdentity(source.slice(0, start) + compactText + source.slice(end));
  }
  if (kind === "code")
    return section(
      source,
      "  // Merge adjacent spaces and data.",
      "  return events;",
      () => compactCode,
    );
  if (kind === "autolink") {
    const at = source.indexOf("function previousUnbalanced(events)");
    assert(at > 0 && source.indexOf("function ", at + 10) === -1);
    return source.slice(0, at) + guardedAutolink;
  }
  if (kind === "attention")
    return addAttentionFastPaths(rewriteAttention(source), attentionFastPathsSource);
  if (kind === "strike") return addStrikeNoCloserPath(rewriteStrike(source), strikeNoCloserSource);
  if (kind === "cjk")
    return registerCjkResolverIdentity(
      'import { mdrefineResolveAttention } from "mdrefine:core-attention";\n' +
        once(
          source,
          "resolveAll: resolveAllAttention,",
          'resolveAll(events, context) { return context.parser.constructs.disable.null.includes("mdrefineDeferredInline") ? resolveAllAttention(events, context) : mdrefineResolveAttention(events, context); },',
        ),
    );
  throw new Error(`Unknown repair ${kind}`);
}

/**
 * Validate the reviewed dependency identity before applying anchored corrections.
 * @param {string} kind
 * @param {string} source
 * @param {{name: string, version: string}} metadata
 * @returns {string}
 */
export function repairReviewedParserSource(kind, source, metadata) {
  const guard = specs[kind];
  assert(guard, `Unknown parser correction ${kind}`);
  assert.equal(metadata.name, guard.name);
  assert.equal(metadata.version, guard.version, `Review changed ${kind} package version`);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    guard.hash,
    `Review changed ${kind} package source`,
  );
  return repair(kind, source);
}

export { specs as sourceGuards, repair as repairParserSource };

// Exact two-run batching and no-closer cleanup; source guards above stay unchanged.
const attentionFastPathsSource = String.raw`
function mdrefineHandleAttentionFast(events, context) {
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

function mdrefineResolveHomogeneousAttention(events, context, open, close) {
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
  ) return false;
  // Validate actual source, not artificial same-chunk endpoint coordinates.
  // A legitimate run ending at EOF/EOL/tab/NUL can have _bufferIndex === -1.
  // Stock's exact movePoint arithmetic below must remain unchanged even when
  // it produces unusual _bufferIndex values at such a boundary.
  const left = context.sliceSerialize(opening);
  const right = context.sliceSerialize(closing);
  const marker = left.charCodeAt(0);
  if (left.length !== openingSize || right.length !== closingSize || (marker !== 42 && marker !== 95)) return false;
  for (let index = 0; index < left.length; index++) if (left.charCodeAt(index) !== marker) return false;
  for (let index = 0; index < right.length; index++) if (right.charCodeAt(index) !== marker) return false;
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
    ) break;
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
  ) return false;
  // All shape/source checks precede the registry allocation and any mutation.
  const insideSpan = context.parser.constructs.insideSpan.null;
  if (!mdrefineKnownHomogeneousPipeline(insideSpan)) return false;

  const layers = [];
  let currentOpening = openingSize;
  let currentClosing = closingSize;
  let interior;
  for (let layer = 0; layer < layerCount; layer++) {
    const use = currentOpening > 1 && currentClosing > 1 ? 2 : 1;
    const start = { ...opening.end };
    const end = { ...closing.start };
    movePoint(start, -use);
    movePoint(end, use);
    const openingSequence = {
      type: use > 1 ? "strongSequence" : "emphasisSequence",
      start,
      end: { ...opening.end },
    };
    const closingSequence = {
      type: use > 1 ? "strongSequence" : "emphasisSequence",
      start: { ...closing.start },
      end,
    };
    const text = {
      type: use > 1 ? "strongText" : "emphasisText",
      start: { ...opening.end },
      end: { ...closing.start },
    };
    const group = {
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
  const output = [];
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
  for (const event of interior) output.push(event);
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

// Preserve the supplied array and every surviving event tuple. The real first
// interior pass may compact enough events to make delta negative: choose the
// non-overlapping move direction from the actual final sizes. No splice,
// chunked insertion, or unbounded argument/array spread is used.
function mdrefineReplaceAttentionRegion(events, from, to, output) {
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

// Exact audited function identities; no token properties or public caches.
const mdrefineHomogeneousResolverRoles = new WeakMap();
export function mdrefineRegisterHomogeneousResolver(resolve, role) {
  mdrefineHomogeneousResolverRoles.set(resolve, role);
  return resolve;
}
mdrefineRegisterHomogeneousResolver(resolveAllAttention, "attention");

function mdrefineKnownHomogeneousPipeline(constructs) {
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

function mdrefineBalancedAttentionEvents(events, from, to) {
  const stack = [];
  for (let index = from; index < to; index++) {
    const [phase, token] = events[index];
    if (phase === "enter") stack.push(token);
    else if (phase !== "exit" || stack.pop() !== token) return false;
  }
  return stack.length === 0;
}
`;
const strikeNoCloserSource = String.raw`
function mdrefineHandleStrikeNoCloser(events) {
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
`;
function addAttentionFastPaths(corrected, attentionFastPathsSource) {
  // Preserve wrapper precedence: DeferredInline -> Original before any new
  // scan or cleanup; raw generated callers keep the current matching path.
  corrected = once(
    corrected,
    "function resolveAllAttentionFast(events, context) {",
    "function resolveAllAttentionFast(events, context) {\n  if (mdrefineHandleAttentionFast(events, context)) return events;",
  );
  return corrected + "\n" + attentionFastPathsSource;
}

function addStrikeNoCloserPath(corrected, strikeNoCloserSource) {
  corrected = once(
    corrected,
    "function resolveAllStrikethroughFast(events, context) {",
    "function resolveAllStrikethroughFast(events, context) {\n    if (mdrefineHandleStrikeNoCloser(events)) return events;",
  );
  corrected = once(
    corrected,
    "    resolveAll: resolveAllStrikethrough\n",
    '    resolveAll: mdrefineRegisterHomogeneousResolver(resolveAllStrikethrough, "strike")\n',
  );
  return registryImport + corrected + "\n" + strikeNoCloserSource;
}

function registerTextResolverIdentity(corrected) {
  // Only the EXPORTED no-extra resolver. Do not mark initializer text/string
  // callbacks, which can carry resolveAllLineSuffixes.
  return (
    registryImport +
    once(
      corrected,
      "  resolveAll: createResolver()\n",
      '  resolveAll: mdrefineRegisterHomogeneousResolver(createResolver(), "text")\n',
    )
  );
}

function registerCjkResolverIdentity(corrected) {
  corrected = once(
    corrected,
    'import { mdrefineResolveAttention } from "mdrefine:core-attention";',
    'import { mdrefineResolveAttention, mdrefineRegisterHomogeneousResolver } from "mdrefine:core-attention";',
  );
  // Kept after initialization; register the actual corrected method identity,
  // retaining its original-resolver branch for external syntax plugins.
  return corrected + '\nmdrefineRegisterHomogeneousResolver(attention.resolveAll, "attention");\n';
}

const registryImport =
  'import { mdrefineRegisterHomogeneousResolver } from "mdrefine:core-attention";\n';
