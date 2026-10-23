// Parser-only corrections; upstream source identities are deliberate review gates.
// Adapted dependency code retains its upstream MIT notices in the generated license artifact.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const specs = {
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
    return source.slice(0, start) + compactText + source.slice(end);
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
  if (kind === "attention") return rewriteAttention(source);
  if (kind === "strike") return rewriteStrike(source);
  if (kind === "cjk")
    return (
      'import { mdrefineResolveAttention } from "mdrefine:core-attention";\n' +
      once(
        source,
        "resolveAll: resolveAllAttention,",
        'resolveAll(events, context) { return context.parser.constructs.disable.null.includes("mdrefineDeferredInline") ? resolveAllAttention(events, context) : mdrefineResolveAttention(events, context); },',
      )
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
