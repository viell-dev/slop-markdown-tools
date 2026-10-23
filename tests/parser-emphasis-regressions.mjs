import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { emphasisGraph } from "./parser-emphasis-graph.mjs";

export const emphasisMarker = "mdrefineHomogeneousAttention";
function flags(mode) {
  return mode === "fast"
    ? [emphasisMarker]
    : mode === "deferred"
      ? ["mdrefineDeferredInline"]
      : mode === "both"
        ? [emphasisMarker, "mdrefineDeferredInline"]
        : [];
}

/** Iterative lossless own-property/alias graph, with corresponding original
 * token/point/tuple names. No new-token allocation-order assumption is needed:
 * new objects receive ids when first reached from equivalent final roots.
 * Context references are explicit external vertices, not recursive parsers.
 */
function graphRecord(roots, seeds, contexts) {
  const ids = new Map(seeds);
  const external = new Map(contexts);
  const queued = new Set();
  const queue = [];
  let fresh = 0;
  function value(item) {
    if (item === undefined) return { undefined: true };
    if (typeof item === "number" && !Number.isFinite(item)) return { number: String(item) };
    if (typeof item === "number" && Object.is(item, -0)) return { number: "-0" };
    if (typeof item === "bigint") return { bigint: String(item) };
    if (typeof item === "function")
      throw new Error("Unexpected function in a token/point/AST record");
    if (item === null || typeof item !== "object") return item;
    if (external.has(item)) return { context: external.get(item) };
    if (!ids.has(item)) ids.set(item, `new:${fresh++}`);
    if (!queued.has(item)) {
      queued.add(item);
      queue.push(item);
    }
    return { reference: ids.get(item) };
  }
  const result = { roots: roots.map(value), objects: [] };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const item = queue[cursor];
    const properties = [];
    for (const key of Reflect.ownKeys(item)) {
      assert.equal(typeof key, "string", "A new symbolic token property needs an explicit oracle");
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      assert("value" in descriptor, "Do not invoke unknown token accessors to form an oracle");
      properties.push([
        key,
        descriptor.enumerable,
        descriptor.configurable,
        descriptor.writable,
        value(descriptor.value),
      ]);
    }
    result.objects.push({ id: ids.get(item), array: Array.isArray(item), properties });
  }
  return result;
}
export function losslessTree(tree) {
  return graphRecord([tree], [], []);
}

function directPipeline(lib, mode) {
  const constructs = [];
  if (mode === "cjk") constructs.push(...lib.cjkFriendlyExtension().insideSpan.null);
  if (mode !== "commonmark") constructs.push(...lib.gfmStrikethrough().insideSpan.null);
  constructs.push(lib.attention, lib.textResolver);
  return constructs;
}
function deduplicated(constructs) {
  return [...new Set(constructs.map((construct) => construct.resolveAll).filter(Boolean))];
}

/** Manufactured balanced event forests. This supplies effects of already
 * completed spans; it does NOT claim the source tokenizer emits every shape.
 * Marker serialization always uses the CURRENT actual token offset range.
 */
function fixture(lib, spec = {}) {
  const {
    marker = "*",
    opening = 4,
    closing = 4,
    twoWay = false,
    mode = "commonmark",
    k = 1,
    suffix = 2,
    interior = "data",
    selection = "fast",
    coordinates = false,
    noCloser,
    kind = "attention",
    duplicatePipeline = false,
  } = spec;
  let source = "";
  let line = 1;
  let column = 1;
  let previousWasCR = false;
  const raw = [];
  const named = new Map();
  const contexts = [];
  const pipeline = directPipeline(lib, mode);
  if (duplicatePipeline) pipeline.splice(pipeline.length - 1, 0, pipeline[0]);
  const context = {
    parser: { constructs: { disable: { null: flags(selection) }, insideSpan: { null: pipeline } } },
    sliceSerialize(token) {
      return source.slice(token.start.offset, token.end.offset);
    },
  };
  const child = { parser: context.parser, sliceSerialize: context.sliceSerialize };
  contexts.push([context, "root"], [child, "child"]);
  function point() {
    const offset = source.length;
    return { line, column, offset, _index: 0, _bufferIndex: offset };
  }
  function append(written) {
    // Same physical-prefix coordinates as split(/CRLF|CR|LF/), advanced once
    // per UTF-16 code unit instead of rescanning every previous token. This is
    // a synthetic fixture's coordinate builder, not parser position arithmetic.
    source += written;
    for (let index = 0; index < written.length; index++) {
      const code = written.charCodeAt(index);
      if (code === 13) {
        line++;
        column = 1;
      } else if (code === 10) {
        if (!previousWasCR) line++;
        column = 1;
      } else column++;
      previousWasCR = code === 13;
    }
  }
  function token(name, type, written, tokenFlags = {}, owner = context) {
    const start = point();
    append(written);
    const value = { type, start, end: point(), ...tokenFlags };
    const pair = [
      ["enter", value, owner],
      ["exit", value, owner],
    ];
    named.set(name, { token: value, pair, start: value.start, end: value.end });
    return pair;
  }
  function add(...args) {
    const pair = token(...args);
    raw.push(...pair);
    return pair;
  }
  const ownType = kind === "attention" ? "attentionSequence" : "strikethroughSequenceTemporary";
  if (noCloser) {
    if (noCloser !== "empty") add("prefix", "characterEscape", "p");
    if (["opening", "inert", "exit-only", "enter-closer"].includes(noCloser)) {
      const pair = token("own", ownType, kind === "attention" ? "****" : "~~", {
        _open: noCloser === "opening",
        _close: ["exit-only", "enter-closer"].includes(noCloser),
      });
      raw.push(...(noCloser === "exit-only" ? [pair[1]] : pair));
    }
    if (noCloser === "unrelated-close") add("unrelated", "codeText", "`x`", { _close: true });
    if (noCloser === "completed") {
      for (let index = 0; index < k; index++) add(`complete:${index}`, "codeText", "`x`");
    }
  } else {
    add("prefix", "characterEscape", "p");
    add("opening", "attentionSequence", marker.repeat(opening), { _open: true, _close: twoWay });
    if (interior === "data") {
      for (let index = 0; index < k; index++)
        add(`data:${index}`, "data", index % 2 ? "漢😀" : "a");
    } else if (interior === "completed") {
      for (let index = 0; index < k; index++) {
        const pair = token(`group:${index}`, "codeText", "`é`");
        raw.push(...pair);
      }
    } else if (interior === "forest") {
      add("text", "data", "é漢😀");
      add("break", "lineEnding", "\r\n");
      add("escape", "characterEscape", "\\*");
      add("entity", "characterReference", "&amp;");
      for (const type of ["codeText", "link", "image", "mathText"]) {
        const group = token(type, type, "xyz", {}, child);
        // A complete child-context group, with real source positions, is a
        // synthetic resolver shape. Actual source equivalents live below.
        raw.push(...group);
      }
    } else if (["matched-strike", "unmatched-strike"].includes(interior)) {
      add("strike-open", "strikethroughSequenceTemporary", "~~", { _open: true, _close: false });
      add("strike-text", "data", "a");
      if (interior === "matched-strike")
        add("strike-close", "strikethroughSequenceTemporary", "~~", { _open: false, _close: true });
    } else throw new Error(`Unknown interior ${interior}`);
    add("closing", "attentionSequence", marker.repeat(closing), { _open: twoWay, _close: true });
    for (let index = 0; index < suffix; index++) add(`suffix:${index}`, "characterEscape", "s");
    if (coordinates) {
      // Synthetic chunk-boundary arithmetic stress, not a fabricated claim of
      // tokenizer reachability. Stock is the sole endpoint arithmetic oracle.
      named.get("opening").token.end._index = 3;
      named.get("opening").token.end._bufferIndex = -1;
      named.get("closing").token.start._index = 8;
      named.get("closing").token.start._bufferIndex = -1;
    }
  }
  const events = lib.probe.observe(raw, "input");
  context.events = events;
  const seeds = [[events, "events"]];
  for (const [name, initial] of named) {
    seeds.push(
      [initial.token, `token:${name}`],
      [initial.start, `point:${name}:start`],
      [initial.end, `point:${name}:end`],
    );
    initial.pair.forEach((tuple, index) => seeds.push([tuple, `tuple:${name}:${index}`]));
  }
  return {
    source,
    context,
    pipeline,
    events,
    named,
    seeds,
    contexts,
    spec,
    record() {
      return graphRecord(
        [
          events,
          [...named.values()].map((entry) => entry.token),
          [...named.values()].flatMap((entry) => [entry.start, entry.end]),
        ],
        seeds,
        contexts,
      );
    },
  };
}

function run(lib, spec, record = true) {
  const value = fixture(lib, spec);
  const markers = [value.named.get("opening")?.token, value.named.get("closing")?.token];
  const stable = lib.probe.observe(value.events, "input");
  assert.equal(stable, value.events, "Observed views must remain stable");
  lib.probe.reset({
    record,
    context: value.context,
    markers: markers.every(Boolean) ? markers : undefined,
  });
  const resolve =
    spec.kind === "strike"
      ? (value.pipeline.find((construct) => lib.role(construct.resolveAll) === "strike")
          ?.resolveAll ?? lib.gfmStrikethrough().insideSpan.null[0].resolveAll)
      : lib.attentionResolver;
  assert.equal(resolve(value.events, value.context), value.events, "Original event-array identity");
  // Read counters before oracle/assertion traversals. Record-mode diagnostic
  // array copies add observer reads, so work bounds use record=false separately.
  const work = { ...lib.probe.work };
  const callbacks = [...lib.probe.callbacks];
  const writes = [...lib.probe.writes];
  const replacements = [...lib.probe.replacements];
  return { fixture: value, record: value.record(), work, callbacks, writes, replacements };
}
function cleanMarkers(result) {
  for (const name of ["opening", "closing"]) {
    const original = result.fixture.named.get(name);
    if (!original) continue;
    const remaining = original.token.end.offset - original.token.start.offset;
    if (remaining) {
      assert.equal(original.token.type, "data");
      assert(result.fixture.events.some((event) => event[1] === original.token));
      if (result.work.batchSuccesses) {
        for (const tuple of original.pair)
          assert(!result.fixture.events.includes(tuple), "Leftover tuple must be fresh");
      }
    } else {
      assert.equal(
        original.token.type,
        "attentionSequence",
        "Consumed off-array original retains raw type",
      );
      assert(!result.fixture.events.some((event) => event[1] === original.token));
    }
  }
}
function survivorTuples(result) {
  // Array.includes for each suffix tuple made this assertion quadratic at the
  // required >10k suffix size. Set.has tests the same object identity once.
  const surviving = new Set(result.fixture.events);
  for (const [name, original] of result.fixture.named) {
    if (name !== "prefix" && !name.startsWith("suffix:")) continue;
    for (const tuple of original.pair) assert(surviving.has(tuple), `Untouched tuple ${name}`);
    assert.equal(original.token.start, original.start);
    assert.equal(original.token.end, original.end);
  }
}
function firstPipeline(expected, actual) {
  assert(actual.work.batchSuccesses > 0, "This is a declared positive, not mere parity");
  assert.equal(actual.work.interiorCalls, 1, "Exactly one real first interior resolution");
  const callbacks = actual.callbacks.filter((entry) => entry.direct);
  const pipeline = deduplicated(actual.fixture.pipeline);
  assert.deepEqual(
    callbacks.map((entry) => entry.resolve),
    pipeline,
    "Actual deduplicated callback identities, once each",
  );
  assert(expected.callbacks.length > 0 && callbacks.length > 0);
  assert.deepEqual(
    callbacks[0].endpoints,
    expected.callbacks[0].endpoints,
    "The first real callback observes stock opener.end/closer.start after first-layer mutation",
  );
  assert.equal(callbacks[0].resolve, pipeline[0]);
}

export async function verifyEmphasisIdentity() {
  const stock = await emphasisGraph("stock");
  const fixed = await emphasisGraph("fixed");
  const cases = [
    { opening: 4, closing: 5, groups: 2 },
    { opening: 5, closing: 4, groups: 2 },
    { opening: 5, closing: 8, groups: 3 },
    { opening: 4, closing: 4, twoWay: true, groups: 2 },
    { opening: 5, closing: 5, twoWay: true, groups: 3 },
    { opening: 4, closing: 5, twoWay: true, groups: 0, decline: true },
    { opening: 5, closing: 6, twoWay: true, groups: 2 },
  ];
  let comparisons = 0;
  for (const marker of ["*", "_"])
    for (const item of cases)
      for (const coordinates of [false, true]) {
        const spec = { ...item, marker, coordinates, duplicatePipeline: true };
        const expected = run(stock, spec);
        const actual = run(fixed, spec);
        assert.deepEqual(actual.record, expected.record, JSON.stringify(spec));
        const groupCount = actual.fixture.events.filter(
          ([phase, token]) => phase === "enter" && ["strong", "emphasis"].includes(token.type),
        ).length;
        assert.equal(groupCount, item.groups);
        survivorTuples(actual);
        cleanMarkers(actual);
        if (item.decline) assert.equal(actual.work.batchSuccesses ?? 0, 0);
        else firstPipeline(expected, actual);
        comparisons++;
      }
  for (const mode of ["commonmark", "gfm", "cjk"])
    for (const interior of mode === "commonmark"
      ? ["forest", "completed"]
      : ["forest", "completed", "matched-strike", "unmatched-strike"]) {
      const spec = { opening: 5, closing: 6, twoWay: true, mode, interior, k: 3 };
      const expected = run(stock, spec);
      const actual = run(fixed, spec);
      assert.deepEqual(actual.record, expected.record, `${mode}/${interior}`);
      cleanMarkers(actual);
      survivorTuples(actual);
      firstPipeline(expected, actual);
      comparisons++;
    }
  return { comparisons };
}

export async function verifyReplacementDirections(mutant = "none") {
  const stock = await emphasisGraph("stock");
  const fixed = await emphasisGraph("fixed", mutant);
  let comparisons = 0;
  for (const k of [1, 7, 8, 128])
    for (const suffix of [0, 2, 5001]) {
      const spec = { k, suffix };
      const expected = run(stock, spec);
      const actual = run(fixed, spec);
      // Deliberately corrupted large suffixes can make assert's automatic
      // object diff dominate the check. Compare the same complete graph while
      // keeping its failure diagnostic bounded by the fixture description.
      assert(
        isDeepStrictEqual(actual.record, expected.record),
        `Signed replacement k=${k},suffix=${suffix}`,
      );
      survivorTuples(actual);
      cleanMarkers(actual);
      firstPipeline(expected, actual);
      assert.equal(actual.replacements.length, 1);
      const replacement = actual.replacements[0];
      assert.equal(
        replacement.delta,
        14 - 2 * k,
        "Delta is derived from actual registered text compaction",
      );
      const writes = actual.writes.slice(replacement.writeStart);
      const suffixSet = new Set(replacement.oldSuffix);
      const counts = new Map();
      for (const entry of writes)
        if (suffixSet.has(entry.value)) counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1);
      for (const tuple of replacement.oldSuffix)
        assert.equal(
          counts.get(tuple) ?? 0,
          replacement.delta === 0 ? 0 : 1,
          "Each untouched suffix tuple moves at most once",
        );
      assert(
        writes.every((entry) => entry.index === undefined || entry.index >= replacement.from),
        "No prefix write",
      );
      const outputWrites = writes.filter(
        (entry) =>
          entry.index >= replacement.from &&
          entry.index < replacement.from + replacement.output.length,
      );
      assert.equal(
        outputWrites.length,
        replacement.output.length,
        "Exactly one assignment per final output tuple",
      );
      if (replacement.delta < 0) {
        const truncation = writes.findLastIndex((entry) => entry.length !== undefined);
        assert.equal(truncation, writes.length - 1, "Shrink truncates after forward output writes");
      }
      const first = actual.fixture.named.get("data:0");
      const last = actual.fixture.named.get(`data:${k - 1}`);
      assert(
        actual.fixture.events.includes(first.pair[0]) &&
          actual.fixture.events.includes(first.pair[1]),
      );
      assert.equal(first.token.start, first.start);
      assert.equal(
        first.token.end,
        last.end,
        "Text compaction borrows the final data endpoint object",
      );
      comparisons++;
    }
  return { comparisons };
}

export async function verifyLargeReplacement(mutant = "none") {
  const stock = await emphasisGraph("stock");
  const fixed = await emphasisGraph("fixed", mutant);
  // Only two layers; large completed interior output triggers chunked splice's
  // 10k branch without a huge stock nesting cost. This is synthetic, not timing.
  const spec = { interior: "completed", k: 6000, suffix: 5001 };
  const expected = run(stock, spec);
  const actual = run(fixed, spec);
  assert.deepEqual(actual.record, expected.record);
  firstPipeline(expected, actual);
  survivorTuples(actual);
  const replacement = actual.replacements[0];
  assert(replacement.output.length > 10000 && replacement.oldSuffix.length > 10000);
  const suffixSet = new Set(replacement.oldSuffix);
  const moves = actual.writes
    .slice(replacement.writeStart)
    .filter((entry) => suffixSet.has(entry.value)).length;
  assert.equal(
    moves,
    replacement.oldSuffix.length,
    "One suffix move per tuple even beyond chunk limit",
  );
  return { comparisons: 1 };
}

export async function verifyNoCloser(kind, mutant = "none") {
  const stock = await emphasisGraph("stock");
  const fixed = await emphasisGraph("fixed", mutant);
  let comparisons = 0;
  for (const noCloser of ["empty", "completed", "opening", "inert", "unrelated-close", "exit-only"])
    for (const selection of ["default", "fast"]) {
      const spec = {
        kind,
        noCloser,
        selection,
        k: 32,
        mode: kind === "strike" ? "gfm" : "commonmark",
      };
      const expected = run(stock, spec, false);
      const actual = run(fixed, spec, false);
      assert.deepEqual(actual.record, expected.record, `${kind}/${noCloser}/${selection}`);
      const initial = [...actual.fixture.named.values()];
      for (const entry of initial) {
        assert.equal(entry.token.start, entry.start);
        assert.equal(entry.token.end, entry.end);
        for (const tuple of entry.pair)
          if (noCloser !== "exit-only" || tuple[0] === "exit")
            assert(actual.fixture.events.includes(tuple));
      }
      const work = actual.work;
      assert.equal(
        work[`${kind}PreludeVisits`] ?? 0,
        actual.fixture.events.length,
        "Exactly one pre-scan",
      );
      const own = ["opening", "inert", "exit-only"].includes(noCloser);
      assert.equal(work.cleanupVisits ?? 0, own ? actual.fixture.events.length : 0);
      assert.equal(work.cleanupAssignments ?? 0, own ? 1 : 0);
      for (const key of [
        "registryCalls",
        "registrySets",
        "balanceScans",
        "serializeCalls",
        "leftAllocations",
        "openerAllocations",
        "inputWrites",
        "leftWrites",
        "inputSpliceCalls",
        "leftSpliceCalls",
        "batchAttempts",
        "interiorCalls",
        "interiorCopies",
      ])
        assert.equal(work[key] ?? 0, 0, `${kind}/${noCloser} forbidden work: ${key}`);
      comparisons++;
    }
  const matchingSpec = {
    kind,
    noCloser: "enter-closer",
    selection: "fast",
    mode: kind === "strike" ? "gfm" : "commonmark",
  };
  const original = run(stock, matchingSpec, false);
  const ordinary = run(fixed, matchingSpec, false);
  assert.deepEqual(ordinary.record, original.record);
  assert.equal(
    ordinary.work.leftAllocations,
    1,
    "A real entering closer still reaches ordinary matching when no batch is possible",
  );
  comparisons++;
  return { comparisons };
}

export async function emphasisWork(mutant = "none") {
  const fixed = await emphasisGraph("fixed", mutant);
  const results = [];
  for (const width of [32, 128]) {
    const spec = { opening: width, closing: width, interior: "completed", k: width, suffix: width };
    const expected = run(await emphasisGraph("stock"), spec, false);
    const actual = run(fixed, spec, false);
    assert.deepEqual(actual.record, expected.record, `Work family width ${width}`);
    assert.equal(actual.work.batchSuccesses, 1);
    results.push(actual.work);
  }
  assert.equal(results[0].interiorCalls, 1, "Repeated interior callbacks forbidden");
  assert.equal(results[1].interiorCalls, 1, "Repeated interior callbacks forbidden");
  assert.equal(
    results[0].serializeCalls,
    2,
    "Marker serialization must happen only once per original run",
  );
  assert.equal(
    results[1].serializeCalls,
    2,
    "Marker serialization must happen only once per original run",
  );
  assert.equal(results[0].interiorCopies, 1, "Interior copying must happen once");
  assert.equal(results[1].interiorCopies, 1, "Interior copying must happen once");
  assert.equal(results[0].serializedCharacters, 64);
  assert.equal(results[1].serializedCharacters, 256);
  const volume = (work) =>
    Object.entries(work)
      .filter(([key]) => key.endsWith("Reads") || key.endsWith("Writes"))
      .reduce((sum, [, value]) => sum + value, 0);
  assert(volume(results[0]) > 0);
  assert(
    volume(results[1]) / volume(results[0]) < 6,
    "Fourfold marker/interior/suffix growth remains bounded",
  );
  return { comparisons: 2 };
}

/** Narrow identity mutants are rejected by the original-reference oracle,
 * independently of work bounds or changed final text/position values.
 */
export async function verifyEmphasisIdentityMutant(mutant) {
  assert(["reuse-leftovers", "clean-consumed"].includes(mutant));
  const stock = await emphasisGraph("stock");
  const fixed = await emphasisGraph("fixed", mutant);
  const spec = { opening: 4, closing: mutant === "reuse-leftovers" ? 5 : 4 };
  const expected = run(stock, spec);
  const actual = run(fixed, spec);
  cleanMarkers(actual);
  assert.deepEqual(actual.record, expected.record, "Complete original-reference identity oracle");
  return { comparisons: 1 };
}

export function emphasisSources() {
  const sources = new Set();
  for (const marker of ["*", "_"])
    for (const [a, b] of [
      [4, 4],
      [5, 5],
      [4, 5],
      [5, 4],
      [5, 8],
      [5, 6],
      [16, 17],
      [17, 16],
    ]) {
      const left = marker.repeat(a),
        right = marker.repeat(b);
      for (const text of [
        "x",
        "é漢😀",
        "a &amp; \\* `x` [y](u) ![z](v)",
        "a ~~b~~ c",
        "a ~~b c",
        "a\nb",
      ])
        sources.add(left + text + right);
      for (const suffix of ["", "\n", "\r", "\r\n", "\t", "\0", " midline"])
        sources.add(left + "x" + right + suffix);
      sources.add("# " + left + "x" + right + "\n");
      sources.add(
        "| " + left + "x" + right + " | b |\n|---|---|\n| " + left + "y" + right + " | z |\n",
      );
      sources.add("> " + left + "a\n> b" + right + "\n");
      sources.add("- " + left + "a\n  b" + right + "\n");
      sources.add("a" + left + "b" + right + "c\n");
      sources.add(left + "a\0" + right);
    }
  for (let width = 1; width <= 17; width++) {
    sources.add("*".repeat(width) + "x" + "*".repeat(width));
    sources.add("_".repeat(width) + "x" + "_".repeat(width));
  }
  for (const source of ["****x****", "*****x*****", "****a\nb****", "> *****a\n> b*****\n"])
    for (const newline of ["\n", "\r", "\r\n"])
      sources.add("\ufeff" + source.replaceAll("\n", newline));
  return [...sources];
}
function parserOptions(lib, mode, selection) {
  const extensions =
    mode === "commonmark"
      ? []
      : [lib.gfm(), ...(mode === "cjk" ? [lib.cjkFriendlyExtension()] : [])];
  extensions.push({ disable: { null: flags(selection) } });
  return { extensions, ...(mode === "commonmark" ? {} : { mdastExtensions: gfmFromMarkdown() }) };
}
function pipelineIdentity(lib, context, options) {
  const pipeline = deduplicated(context.parser.constructs.insideSpan.null);
  const allowed = new Set([lib.attentionResolver, lib.textResolver.resolveAll]);
  for (const extension of options.extensions)
    for (const construct of extension.insideSpan?.null ?? [])
      if (construct.resolveAll) allowed.add(construct.resolveAll);
  for (const resolve of pipeline)
    assert(allowed.has(resolve), "Pipeline contains an unexpected actual function identity");
  assert.equal(pipeline.at(-1), lib.textResolver.resolveAll);
  for (const resolve of pipeline)
    assert(["attention", "strike", "text"].includes(lib.role(resolve)));
}
function firstTokenizingCalls(calls) {
  const seen = new Set();
  return calls.filter((call) => {
    let fresh = false;
    for (const item of call.points)
      if (item.record.type === "attentionSequence" && !seen.has(item.token)) {
        seen.add(item.token);
        fresh = true;
      }
    return fresh;
  });
}
function tokenizerCallRecord(call) {
  const seeds = [
    [call.events, "events"],
    [call.input, "initial-tuples"],
  ];
  const contexts = new Map([[call.context, "root"]]);
  for (let index = 0; index < call.points.length; index++) {
    const entry = call.points[index];
    seeds.push(
      [entry.token, `token:${index}`],
      [entry.start, `point:${index}:start`],
      [entry.end, `point:${index}:end`],
    );
  }
  for (let index = 0; index < call.input.length; index++) {
    const tuple = call.input[index];
    seeds.push([tuple, `tuple:${index}`]);
    if (!contexts.has(tuple[2])) contexts.set(tuple[2], `child:${contexts.size}`);
  }
  return graphRecord(
    [
      call.events,
      call.input,
      call.points.map((entry) => entry.token),
      call.points.flatMap((entry) => [entry.start, entry.end]),
    ],
    seeds,
    contexts,
  );
}

/** Actual full tokenizer graph: raw flags and every stock point field come
 * from real fromMarkdown contexts, then both AST and retained final tokens are
 * checked. This is still an instrumented graph, not dist coverage evidence.
 */
export async function verifyEmphasisTokenizer(mode, sources = emphasisSources()) {
  const stock = await emphasisGraph("stock");
  const fixed = await emphasisGraph("fixed");
  let comparisons = 0,
    nativeCoordinateCases = 0;
  for (const source of sources) {
    const expectedOptions = parserOptions(stock, mode, "fast");
    stock.probe.reset({ record: true });
    const expected = stock.fromMarkdown(source, expectedOptions);
    const oldCalls = [...stock.probe.rawCalls].filter(
      (entry) =>
        entry.kind === "attention" &&
        entry.points.some(({ record }) => record.type === "attentionSequence"),
    );
    for (const selection of ["default", "fast", "deferred", "both"]) {
      const options = parserOptions(fixed, mode, selection);
      fixed.probe.reset({ record: true });
      const actual = fixed.fromMarkdown(source, options);
      assert.deepEqual(
        losslessTree(actual),
        losslessTree(expected),
        `${mode}/${selection}/${JSON.stringify(source)}`,
      );
      const ownCalls = [...fixed.probe.rawCalls].filter(
        (entry) =>
          entry.kind === "attention" &&
          entry.points.some(({ record }) => record.type === "attentionSequence"),
      );
      // Compare first actual observations by raw token identity. Batch
      // deliberately removes later no-op callbacks; their counts cannot match.
      const firstRuns = (calls) => {
        const seen = new Set();
        const rows = [];
        for (const call of calls)
          for (const item of call.points) {
            if (item.record.type !== "attentionSequence" || seen.has(item.token)) continue;
            seen.add(item.token);
            rows.push({
              before: item.record,
              after: item.token,
              initialStart: item.start,
              initialEnd: item.end,
              initialStartValue: item.startValue,
              initialEndValue: item.endValue,
            });
          }
        return rows;
      };
      const original = firstRuns(oldCalls),
        repaired = firstRuns(ownCalls);
      assert.deepEqual(
        losslessTree(repaired),
        losslessTree(original),
        "Actual tokenizer flag/point/off-array run observations",
      );
      const originalCalls = firstTokenizingCalls(oldCalls),
        actualCalls = firstTokenizingCalls(ownCalls);
      assert.equal(actualCalls.length, originalCalls.length, "First actual tokenizing call groups");
      for (let index = 0; index < actualCalls.length; index++)
        assert.deepEqual(
          tokenizerCallRecord(actualCalls[index]),
          tokenizerCallRecord(originalCalls[index]),
          "Actual final event tuples, original off-array tokens, point aliases and context references",
        );
      for (const call of ownCalls)
        if (selection === "fast") pipelineIdentity(fixed, call.context, options);
      if (
        original.some(
          (row) =>
            row.initialEndValue._bufferIndex === -1 || row.initialStartValue._bufferIndex === -1,
        )
      )
        nativeCoordinateCases++;
      if (["deferred", "both"].includes(selection))
        assert.equal(fixed.probe.work.batchSuccesses ?? 0, 0);
      comparisons++;
    }
  }
  assert(
    nativeCoordinateCases > 0,
    "Real tokenizer boundary coordinates must actually be exercised",
  );
  return { comparisons, sources: sources.length, nativeCoordinateCases };
}

export async function verifyEmphasisDeclines() {
  const stock = await emphasisGraph("stock");
  const fixed = await emphasisGraph("fixed");
  let comparisons = 0;
  for (const selection of ["default", "deferred", "both"]) {
    const spec = { selection, opening: 8, closing: 8 };
    const expected = run(stock, spec);
    const actual = run(fixed, spec);
    assert.deepEqual(actual.record, expected.record);
    assert.equal(actual.work.batchSuccesses ?? 0, 0);
    comparisons++;
  }
  // Unknown same-name identity and incompatible order are not granted purity.
  for (const mutation of ["unknown", "reordered"]) {
    const fixtures = [fixture(stock), fixture(fixed)];
    const results = [];
    for (const [lib, value] of [
      [stock, fixtures[0]],
      [fixed, fixtures[1]],
    ]) {
      const state = [];
      if (mutation === "unknown")
        value.pipeline.splice(0, 0, {
          resolveAll: function resolveAllAttention(events, context) {
            assert.equal(context, value.context);
            state.push({
              endpoints: [
                globalThis.structuredClone(value.named.get("opening").token.end),
                globalThis.structuredClone(value.named.get("closing").token.start),
              ],
              events: losslessTree(events.map(([phase, token]) => [phase, token])),
            });
            return events;
          },
        });
      else value.pipeline.reverse();
      lib.probe.reset({ record: true });
      assert.equal(lib.attentionResolver(value.events, value.context), value.events);
      results.push({ record: value.record(), batches: lib.probe.work.batchSuccesses ?? 0, state });
    }
    assert.deepEqual(results[1].record, results[0].record);
    assert.deepEqual(
      results[1].state,
      results[0].state,
      "Unknown stateful callback observes stock layer sequence",
    );
    if (mutation === "unknown") assert.equal(results[1].state.length, 2);
    assert.equal(results[1].batches, 0);
    comparisons++;
  }
  return { comparisons };
}

export async function verifyActualNulAndAsciiFlanking() {
  const rows = [];
  for (const mode of ["commonmark", "gfm", "cjk"]) {
    const stock = await emphasisGraph("stock");
    const fixed = await emphasisGraph("fixed");
    for (const marker of ["*", "_"])
      for (const width of [4, 5]) {
        const run = marker.repeat(width);
        for (const [suffixName, suffix] of [
          ["NUL", "\0"],
          ["replacement", "\uFFFD"],
          ["ASCII", "z"],
        ]) {
          const source = run + "alpha" + run + suffix;
          const results = [];
          for (const lib of [stock, fixed]) {
            const extensions =
              mode === "commonmark"
                ? []
                : [lib.gfm(), ...(mode === "cjk" ? [lib.cjkFriendlyExtension()] : [])];
            extensions.push({ disable: { null: ["mdrefineHomogeneousAttention"] } });
            lib.probe.reset({ record: true });
            const tree = lib.fromMarkdown(source, { extensions });
            const seen = new Set();
            const records = [];
            for (const call of lib.probe.rawCalls) {
              if (call.kind !== "attention") continue;
              for (const item of call.points) {
                if (item.record.type !== "attentionSequence" || seen.has(item.token)) continue;
                seen.add(item.token);
                // Snapshot was taken on actual resolver entry, before its token
                // mutation/cleanup. Serialize the saved actual points, not the
                // now-consumed live token or manufactured coherent coordinates.
                records.push({
                  start: item.record.start.offset,
                  flags: [item.record._open, item.record._close],
                  written: call.context.sliceSerialize(item.record),
                });
              }
            }
            records.sort((left, right) => left.start - right.start);
            assert.equal(records.length, 2, "Expected two actual tokenizer delimiter runs");
            assert.deepEqual(records[0], { start: 0, flags: [true, false], written: run });
            const closing =
              suffixName === "ASCII"
                ? marker === "_"
                  ? [false, false]
                  : [true, true]
                : [false, true];
            assert.deepEqual(records[1], { start: width + 5, flags: closing, written: run });
            results.push({ tree: losslessTree(tree), records });
          }
          assert.deepEqual(
            results[1],
            results[0],
            "Actual stock/fixed token flags and positioned trees",
          );
          rows.push({ mode, marker, width, suffix: suffixName, flags: results[0].records });
        }
      }
  }
  return { cases: rows.length, rows };
}
