// Compare actual stock exports with the production builder and repair functions.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { bundleParser } from "../../../scripts/build-parser.mjs";
import { loadParserModule } from "./parser-module-probes.mjs";

/** @typedef {typeof import("../../../src/syntax/parser.generated.js")} LabelAdapter */
/** @typedef {{eventReads: number, positiveHits: number, negativeHits: number, serializedCalls: number, serializedCharacters: number}} LabelWorkSnapshot */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isLabelRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {asserts value is LabelAdapter} */
function assertLabelAdapter(value) {
  assert(isLabelRecord(value), "Generated label adapter is not a namespace");
  for (const name of [
    "fromMarkdown",
    "gfm",
    "gfmAutolinkLiteral",
    "gfmFootnote",
    "gfmStrikethrough",
    "cjkFriendlyExtension",
  ])
    assert.equal(typeof value[name], "function", `Missing actual generated factory ${name}`);
}

/** @param {unknown} value @param {string} name @returns {number} */
function labelCounter(value, name) {
  assert(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    `Invalid actual label counter ${name}`,
  );
  return value;
}

/** @param {unknown} module @returns {LabelWorkSnapshot} */
function labelWorkSnapshot(module) {
  assert(isLabelRecord(module), "Missing actual label probe module");
  const stats = module.workStats;
  const labels = module.labelWork;
  assert(isLabelRecord(stats), "Missing actual array work counters");
  assert(isLabelRecord(labels), "Missing actual label work counters");
  return {
    eventReads: labelCounter(stats.reads, "eventReads"),
    positiveHits: labelCounter(labels.positiveHits, "positiveHits"),
    negativeHits: labelCounter(labels.negativeHits, "negativeHits"),
    serializedCalls: labelCounter(labels.serializedCalls, "serializedCalls"),
    serializedCharacters: labelCounter(labels.serializedCharacters, "serializedCharacters"),
  };
}

// Resolve the real utility through its declaring direct dependency, including
// strict pnpm. Do not add a hoisting-dependent top-level transitive import.
const fromFootnote = createRequire(
  createRequire(import.meta.url).resolve("micromark-extension-gfm-footnote"),
);
const { normalizeIdentifier } = await import(
  pathToFileURL(fromFootnote.resolve("micromark-util-normalize-identifier")).href
);

const stock = { fromMarkdown, gfm, gfmFootnote, cjkFriendlyExtension };
export const labelAutolinkProofPin = "![^(www.a.com\\](x]\n\n[^(www.a.com\\](x]: n\n";
export const labelModes = ["default", "fast", "deferred", "both"];
export function labelFlags(mode) {
  assert(labelModes.includes(mode));
  return mode === "fast"
    ? ["mdrefineBuiltinLabels"]
    : mode === "deferred"
      ? ["mdrefineDeferredInline"]
      : mode === "both"
        ? ["mdrefineBuiltinLabels", "mdrefineDeferredInline"]
        : [];
}

export function labelSources() {
  const nested = "[".repeat(12) + "x" + "]".repeat(12);
  const primary = [
    nested + "\n",
    "# " + nested + "\n",
    "[unused]: /url\n\n" + nested + "\n",
    nested + "\n\n[unused]: /url\n",
    "[^unused]: note\n\n" + nested + "\n",
    "]]]]]]]]]\n\n[^unused]: note\n",
    "![^missing]]]]]]]]\n\n[^unused]: note\n",
    "[a [b]](target) [a [b]][ref] ![a [b]](image) ![a [b]][ref]\n\n[ref]: /url\n",
    "[a [b]][]\n\n[a \\[b\\]]: /url\n",
    "[a\\[b\\]][r] [a\\]b][r]\n\n[r]: /url\n",
    '[label] [label][] [text][label] [text](url "title") [text](broken\n\n[label]: /url\n',
    "![^a] ![^missing] ![^a](url) ![^a][r]\n\n[^a]: note\n\n[r]: /url\n",
    "![^a\\]b]\n\n[^a\\]b]: note\n",
    "[outer [^not-a-footnote]]\n\n[unused]: /url\n",
    "[Θ] [ϴ] [θ] [ß] [😀] [a\t b]\n\n[θ]: /theta\n[ß]: /ss\n[😀]: /astral\n[a b]: /spaces\n",
    "[first\n second][r]\n\n[r]: /multiline\n",
    "[a `\\`[b]][r]\n\n[r]: /code\n",
    "[a `\\`][r]\n\n[r]: /code\n",
    "[a $\\$[b]][r] [a $x\\$][r] [a $$x\\$$][r]\n\n[r]: /math\n",
    "[a \\\n[b]][r]\n\n[r]: /hardbreak\n",
    "[a \\\n][r]\n\n[r]: /hardbreak\n",
    "> [a \\\n> [b]][r]\n\n[r]: /quote\n",
    "> [a \\\n> ][r]\n\n[r]: /quote\n",
    "[a \\\\[b]][r] [a \\\\\\[b]][r]\n\n[r]: /parity\n",
    labelAutolinkProofPin,
    "[*a* ~~b~~ &amp; <span>c</span> `d`][r] [[Note|name]]\n\n[r]: /mixed\n",
  ];
  // Apply newline/BOM variants only to six boundary-rich pins, not an exhaustive
  // Cartesian product of every source. All primary factors remain present.
  const variants = primary
    .slice(-6)
    .flatMap((source) => [
      source.replaceAll("\n", "\r\n"),
      source.replaceAll("\n", "\r"),
      "\ufeff" + source,
    ]);
  return [...new Set([...primary, ...variants])];
}

/** Fresh real-public-parse inputs, separate from synthetic effects schedules. */
export function freshPublicLabelSource(family, size) {
  assert(Number.isInteger(size) && size > 0);
  if (family === "core-empty") return "[".repeat(size) + "x" + "]".repeat(size) + "\n";
  if (family === "core-defined")
    return "[unused]: /url\n\n" + "[".repeat(size) + "x" + "]".repeat(size) + "\n";
  if (family === "negative") return "]".repeat(size) + "\n\n[^unused]: note\n";
  assert.equal(family, "image-defined");
  return "![^missing" + "]".repeat(size) + "\n\n[^unused]: note\n";
}

/** @type {Promise<LabelAdapter> | undefined} */
let adapterPromise;
/** @returns {Promise<LabelAdapter>} */
export function generatedLabelAdapter() {
  adapterPromise ??= bundleParser().then(async ({ code }) => {
    /** @type {unknown} */
    const namespace = await import(
      `data:text/javascript;base64,${Buffer.from(code + "\n//# sourceURL=mdrefine-label-adapter.mjs\n").toString("base64")}`
    );
    assertLabelAdapter(namespace);
    return namespace;
  });
  return adapterPromise;
}
function grammar(lib, mode) {
  if (mode === "commonmark") return { extensions: [], mdastExtensions: [] };
  if (mode === "footnote")
    return {
      extensions: [lib.gfmFootnote()],
      mdastExtensions: [gfmFootnoteFromMarkdown()],
    };
  assert(["gfm", "cjk"].includes(mode));
  return {
    extensions: [lib.gfm(), ...(mode === "cjk" ? [lib.cjkFriendlyExtension()] : [])],
    mdastExtensions: [gfmFromMarkdown()],
  };
}
function observer(records) {
  const capture = (events) =>
    records.push(JSON.stringify(events.map(([action, token]) => [action, token])));
  const tap = {
    previous() {
      capture(this.events);
      return false;
    },
    tokenize(_effects, _ok, nok) {
      capture(this.events);
      return nok;
    },
  };
  const text = {};
  for (const code of [33, 36, 42, 91, 93, 96, 120]) text[code] = tap;
  return {
    text,
    insideSpan: {
      null: [
        {
          resolveAll(events) {
            capture(events);
            return events;
          },
        },
      ],
    },
  };
}

/** Actual stock and actual generated exports, with trusted observer opt-in. */
export async function verifyLabelGraphs(mode, sources = labelSources()) {
  const fixed = await generatedLabelAdapter();
  assert.equal(typeof fixed.gfmFootnote, "function", "B1 sixth factory must exist");
  const aggregate = [fixed.gfm().text[93]].flat();
  const standalone = [fixed.gfmFootnote().text[93]].flat();
  const potential = standalone.find((entry) => entry.name === "gfmPotentialFootnoteCall");
  assert(
    potential && aggregate.some((entry) => entry.tokenize === potential.tokenize),
    "B1 same bundled factory module",
  );
  let observations = 0;
  for (const source of sources)
    for (const marker of labelModes) {
      const snapshots = { stock: [], fixed: [] };
      const trees = {};
      for (const [name, lib] of [
        ["stock", stock],
        ["fixed", fixed],
      ]) {
        const options = grammar(lib, mode);
        trees[name] = lib.fromMarkdown(source, {
          ...options,
          extensions: [
            ...options.extensions,
            observer(snapshots[name]),
            { disable: { null: labelFlags(marker) } },
          ],
        });
      }
      assert.deepEqual(
        trees.fixed,
        trees.stock,
        `Raw positioned AST: ${mode}/${marker}/${JSON.stringify(source)}`,
      );
      if (["gfm", "cjk"].includes(mode) && source === labelAutolinkProofPin) {
        const hasCall = (node) => node.type === "footnoteReference" || node.children?.some(hasCall);
        assert(
          hasCall(trees.stock) && hasCall(trees.fixed),
          "Backslash/autolink proof pin must actually make a footnote call",
        );
      }
      assert.deepEqual(
        snapshots.fixed,
        snapshots.stock,
        `Enumerable token/point observations: ${mode}/${marker}/${JSON.stringify(source)}`,
      );
      assert(snapshots.fixed.length > 0, "The read-only observer must actually execute");
      observations += snapshots.fixed.length;
    }
  return {
    sources: sources.length,
    astComparisons: sources.length * labelModes.length,
    observations,
  };
}

/** An arbitrary bare-bracket definition is outside the trusted built-in proof. */
export async function verifyCustomDefinitionFallback() {
  const fixed = await generatedLabelAdapter();
  const source = "[a [b]]\n";
  const customId = normalizeIdentifier("a [b]");
  const writeDefinition = () => ({
    text: {
      [93]: {
        previous() {
          if (!this.parser.defined.includes(customId)) this.parser.defined.push(customId);
          return false;
        },
        tokenize(_effects, _ok, nok) {
          return nok;
        },
      },
    },
  });
  const expected = stock.fromMarkdown(source, { extensions: [writeDefinition()] });
  const containsReference = (node) =>
    node.type === "linkReference" || node.children?.some(containsReference);
  assert(containsReference(expected), "Custom dictionary control must create a real reference");
  for (const marker of ["default", "deferred", "both"])
    assert.deepEqual(
      fixed.fromMarkdown(source, {
        extensions: [writeDefinition(), { disable: { null: labelFlags(marker) } }],
      }),
      expected,
      `Original nonempty custom-dictionary path: ${marker}`,
    );
  return { cases: 3 };
}

const modules = new Map();
async function mechanismModule(kind, variant, mutant) {
  const key = `${kind}:${variant}:${mutant}`;
  if (!modules.has(key)) modules.set(key, loadParserModule(kind, variant, { labelMutant: mutant }));
  return modules.get(key);
}
function potentialTokenizer(module) {
  const construct = [module.gfmFootnote().text[93]]
    .flat()
    .find((entry) => entry.name === "gfmPotentialFootnoteCall");
  assert(construct && typeof construct.tokenize === "function");
  assert.equal(
    construct.tokenize,
    module.mdrefinePotentialFootnoteCall,
    "Test-only export must be the actual factory's tokenizer at code 93",
  );
  return construct.tokenize;
}
const point = (offset) => ({
  line: 1,
  column: offset + 1,
  offset,
  _index: 0,
  _bufferIndex: offset,
});
const clone = (value) => JSON.parse(JSON.stringify(value));

// This is an explicit SYNTHETIC effects schedule, not a second parser. Actual
// tokenizers own their state/stack/balance decisions. Source serialization is
// delegated to this one-line context's raw offsets; normalization stays actual.
function schedule(source, flags, footnotes = ["UNRELATED"]) {
  let cursor = 0;
  let status;
  const events = [];
  const tokens = [];
  const starts = [];
  const ends = [];
  const traces = [];
  const opened = [];
  const retainedTuples = [];
  const context = {
    events,
    _labelStarts: [],
    parser: {
      defined: ["UNRELATED"],
      gfmFootnotes: [...footnotes],
      constructs: { disable: { null: flags } },
    },
    now() {
      return point(cursor);
    },
    sliceSerialize(token) {
      return source.slice(token.start.offset, token.end.offset);
    },
  };
  function token(type, start, end, fields = {}) {
    const value = { type, start: point(start), end: point(end), ...fields };
    tokens.push(value);
    starts.push(value.start);
    ends.push(value.end);
    return value;
  }
  function pair(value) {
    for (const action of ["enter", "exit"]) {
      const event = [action, value, context];
      retainedTuples.push({ event, index: events.length, token: value });
      events.push(event);
    }
  }
  function data(start, end) {
    pair(token("data", start, end));
  }
  const effects = {
    enter(type) {
      const value = { type, start: point(cursor) };
      opened.push(value);
      events.push(["enter", value, context]);
      traces.push(["enter", clone(value)]);
      return value;
    },
    consume(code) {
      assert.equal(source.charCodeAt(cursor), code);
      cursor++;
    },
    exit(type) {
      const value = opened.pop();
      assert(value && value.type === type, "Synthetic effect nesting");
      value.end = point(cursor);
      events.push(["exit", value, context]);
      traces.push(["exit", clone(value)]);
      return value;
    },
    attempt() {
      throw new Error("This mechanism schedule contains no resource/full-reference attempt");
    },
    check() {
      throw new Error("Unexpected tokenizer check in the bounded schedule");
    },
  };
  const ok = (code) => {
    status = { result: "ok", code };
  };
  const nok = (code) => {
    status = { result: "nok", code };
  };
  return {
    context,
    events,
    tokens,
    token,
    pair,
    data,
    effects,
    traces,
    at(offset) {
      cursor = offset;
    },
    call(tokenize, code, following, hasAfter) {
      status = undefined;
      const length = events.length;
      const first = tokenize.call(context, effects, ok, nok);
      assert.equal(typeof first, "function", "Actual tokenizer must return its start state");
      const next = first(code);
      if (hasAfter) {
        assert.equal(typeof next, "function", "Core start must return the actual after state");
        next(following);
      } else assert.equal(next, undefined, "Footnote schedule reaches its terminal callback");
      assert(status, "Actual terminal callback must execute");
      assert.equal(opened.length, 0);
      if (status.result === "nok") events.length = length; // Real attempt rollback shape.
      return clone(status);
    },
    observation(statuses) {
      assert.equal(context.events, events);
      assert(
        tokens.every((value, index) => value.start === starts[index] && value.end === ends[index]),
      );
      assert(
        retainedTuples.every(
          ({ event, index, token }) => events[index] === event && event[1] === token,
        ),
      );
      return {
        statuses,
        tokens: tokens.map(clone),
        events: events.map(([action, value]) => [action, clone(value)]),
        traces: clone(traces),
        stack: context._labelStarts.map((value) => tokens.indexOf(value)),
        parserKeys: Object.keys(context.parser).sort(),
        defined: [...context.parser.defined],
        footnotes: [...context.parser.gfmFootnotes],
        flags: [...context.parser.constructs.disable.null],
        sameArray: context.events === events,
        samePointIdentities: true,
        sameTupleAndTokenIdentities: true,
      };
    },
  };
}

/**
 * @param {"core"|"positive"|"negative"|"closer"} family
 * @param {"stock"|"fixed"} variant
 * @param {number} size
 * @param {"default"|"fast"|"deferred"|"both"} [mode]
 * @param {"none"|"nested"|"prefix"|"closer"} [mutant]
 * @param {boolean} [empty]
 */
export async function labelMechanism(
  family,
  variant,
  size,
  mode = "fast",
  mutant = "none",
  empty = false,
) {
  assert(Number.isInteger(size) && size >= 2);
  const kind = family === "core" ? "labelEnd" : "footnoteSyntax";
  const module = await mechanismModule(kind, variant, mutant);
  module.resetWork();
  module.resetLabelWork();
  const prefix =
    family === "core" ? "[".repeat(size) + "x" : family === "negative" ? "a" : "![^missing";
  const source = prefix + "]".repeat(size);
  const state = schedule(source, labelFlags(mode), empty ? [] : ["UNRELATED"]);
  if (empty) state.context.parser.defined = [];
  const rawEvents = state.events;
  const view = module.observeEvents(rawEvents);
  assert.equal(module.observeEvents(rawEvents), view, "Stable raw-array view");
  assert.equal(module.observeEvents(view), view, "Stable observed-array view");
  assert.notEqual(module.observeEvents([...rawEvents]), view, "New arrays get new views");
  let tokenize;
  let stack;
  if (family === "core") {
    stack = state.context._labelStarts;
    for (let index = 0; index < size; index++)
      stack.push(state.token("labelLink", index, index + 1));
    tokenize = module.labelEnd.tokenize;
  } else {
    if (family !== "negative") {
      const image = state.token("labelImage", 0, 2, { _balanced: family === "closer" });
      state.pair(image);
    }
    state.data(family === "negative" ? 0 : 2, prefix.length);
    assert.equal(view[0], rawEvents[0]);
    assert.equal(view[0][1], rawEvents[0][1]);
    tokenize = potentialTokenizer(module);
  }
  assert.equal(typeof tokenize, "function");
  // Discard only setup observer reads, never cache state or source history.
  module.resetWork();
  module.resetLabelWork();
  const statuses = [];
  for (let index = 0; index < size; index++) {
    state.at(prefix.length + index);
    statuses.push(state.call(tokenize, 93, index + 1 === size ? null : 93, family === "core"));
    if (family !== "core") state.data(prefix.length + index, prefix.length + index + 1);
  }
  const work = labelWorkSnapshot(module);
  if (family === "core") {
    assert.equal(state.context._labelStarts, stack);
    assert.equal(stack.length, 1, "The last balanced opener remains until a following attempt");
    assert.equal(stack[0], state.tokens[0]);
    assert(state.tokens.every((token) => token._balanced === true));
  }
  assert(statuses.every(({ result }) => result === "nok"));
  return { work, sourceLength: source.length, observation: state.observation(statuses) };
}

/** Nonstandard later-matching footnote ID: the deferred/default path must serialize it. */
export async function customFootnoteSchedule(mode) {
  assert(["default", "deferred", "both"].includes(mode));
  const source = "![^missing]]";
  const result = {};
  for (const variant of ["stock", "fixed"]) {
    const module = await mechanismModule("footnoteSyntax", variant, "none");
    const state = schedule(source, labelFlags(mode), [normalizeIdentifier("missing]")]);
    const image = state.token("labelImage", 0, 2, { _balanced: true });
    state.pair(image);
    state.data(2, source.length - 2);
    const statuses = [];
    for (let index = 0; index < 2; index++) {
      state.at(source.length - 2 + index);
      statuses.push(state.call(potentialTokenizer(module), 93, null, false));
      if (index === 0) state.data(source.length - 2, source.length - 1);
    }
    assert.deepEqual(
      statuses.map(({ result }) => result),
      ["nok", "ok"],
    );
    result[variant] = state.observation(statuses);
  }
  assert.deepEqual(result.fixed, result.stock);
  return { cases: 1 };
}

/** Retained-prefix mutations are tested ONLY on the original fallback path. */
export async function barrierMutationFallback(mode, family) {
  assert(["default", "deferred", "both"].includes(mode));
  assert(["positive", "negative"].includes(family));
  const result = {};
  for (const variant of ["stock", "fixed"]) {
    const module = await mechanismModule("footnoteSyntax", variant, "none");
    module.resetLabelWork();
    const source = "![^abcdef]";
    const state = schedule(source, labelFlags(mode), [normalizeIdentifier("abcdef")]);
    const initial = state.token(family === "positive" ? "labelImage" : "data", 0, 2, {
      _balanced: false,
    });
    const middle = state.token("data", 2, 4);
    const tail = state.token("data", 4, 6);
    for (const token of [initial, middle, tail]) state.pair(token);
    const retainedTail = state.events.at(-1);
    state.at(source.length - 1);
    const first = state.call(potentialTokenizer(module), 93, null, false);
    if (family === "positive") {
      // Same cached destination identity/role, but a nearer stopping barrier.
      initial._balanced = true;
      middle.type = "labelLink";
    } else {
      // A previously negative prefix has gained an actual image barrier.
      initial.type = "labelImage";
      initial._balanced = true;
    }
    state.data(6, source.length - 1);
    assert.equal(state.events[5], retainedTail, "Old tail tuple retained in place");
    // Same-offset retry prevents the separate earlier-closer mechanism from
    // concealing a bad cache decision. Such history mutation is deliberately
    // outside the opted-in builtin grammar; default/fallback must stay stock.
    state.at(source.length - 1);
    const second = state.call(potentialTokenizer(module), 93, null, false);
    assert.deepEqual(
      [first.result, second.result],
      family === "positive" ? ["nok", "nok"] : ["nok", "ok"],
    );
    assert.equal(module.labelWork.positiveHits, 0);
    assert.equal(module.labelWork.negativeHits, 0);
    result[variant] = state.observation([first, second]);
  }
  assert.deepEqual(result.fixed, result.stock);
  return { cases: 1 };
}
