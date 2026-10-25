// This extra-export, instrumented graph is NOT unchanged-dist V8 reachability.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { rolldown } from "rolldown";
import { repairReviewedParserSource, sourceGuards } from "../../../scripts/parser-patches.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const here = createRequire(path.join(root, "package.json"));
const slash = (value) => value.replaceAll("\\", "/");
const hash = (value) => createHash("sha256").update(value).digest("hex");
function once(source, before, after) {
  assert.equal(source.split(before).length, 2, `Changed emphasis test anchor: ${before}`);
  return source.replace(before, after);
}
function body(source, signature, change) {
  const at = source.indexOf(signature);
  assert(at >= 0 && source.indexOf(signature, at + signature.length) < 0, signature);
  const end = source.indexOf("\n}", at);
  assert(end > at, signature);
  return source.slice(0, at) + change(source.slice(at, end + 2)) + source.slice(end + 2);
}
async function packageForFile(filename) {
  let directory = path.dirname(filename);
  while (true) {
    try {
      return {
        directory,
        metadata: JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")),
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, filename);
    directory = parent;
  }
}
function productionEntry(packageRoot) {
  let entry = packageRoot.metadata.exports?.["."] ?? packageRoot.metadata.exports;
  if (typeof entry !== "string") entry = entry?.default;
  assert.equal(typeof entry, "string");
  return path.resolve(packageRoot.directory, entry);
}

// Native resolveAll still performs function-identity deduplication and calls the
// real functions. The injected line only records that exact call site.
const resolveAllGuard = {
  name: "micromark-util-resolve-all",
  version: "2.0.1",
  relative: "index.js",
  hash: "fa3b71cedce7b6f31ae68720dccfd561b7191e3d7280663cee1400a2dd38698c",
};
const statsSource = String.raw`
export const work = Object.create(null);
export const callbacks = [];
export const rawCalls = [];
export const writes = [];
export const replacements = [];
export const interiors = [];
let record = false;
let watchedContext;
let watchedMarkers;
const views = new WeakMap();
const labels = new WeakMap();
const frames = [];
export function count(key, amount = 1) { work[key] = (work[key] || 0) + amount; }
export function observe(array, label = "scratch") {
  if (views.has(array)) return views.get(array);
  let splice;
  const view = new Proxy(array, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)) count(label + "Reads");
      if (key === "splice") {
        splice ??= function (...args) { count(label + "SpliceCalls"); return Reflect.apply(Reflect.get(target, key, receiver), receiver, args); };
        return splice;
      }
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      if (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)) {
        count(label + "Writes");
        if (record && label === "input") writes.push({ index: Number(key), value });
      } else if (record && label === "input" && key === "length") writes.push({ length: value });
      return Reflect.set(target, key, value, receiver);
    },
  });
  views.set(array, view); views.set(view, view);
  labels.set(array, label); labels.set(view, label);
  return view;
}
export function reset(options = {}) {
  for (const key of Object.keys(work)) delete work[key];
  for (const values of [callbacks, rawCalls, writes, replacements, interiors, frames]) values.length = 0;
  record = options.record ?? false;
  watchedContext = options.context;
  watchedMarkers = options.markers;
}
export function serialize(context, token, ...args) {
  const value = context.sliceSerialize(token, ...args);
  count("serializeCalls"); count("serializedCharacters", value.length);
  return value;
}
export function interiorSlice(array, ...args) {
  count("interiorCopies");
  return array.slice(...args);
}
export function callback(resolve, events, context) {
  count("callbackCalls");
  if (!record) return;
  const frame = frames.at(-1);
  if (frame && !frame.root) frame.root = events;
  const markers = context === watchedContext ? watchedMarkers : undefined;
  callbacks.push({ resolve, events, context, direct: frame?.root === events,
    endpoints: markers ? [structuredClone(markers[0].end), structuredClone(markers[1].start)] : undefined,
    input: [...events],
  });
}
export function raw(kind, events, context) {
  count(kind + "Calls");
  if (record) rawCalls.push({ kind, events, context, input: [...events],
    points: [...new Set(events.map((event) => event[1]))].map((token) => ({ token,
      start: token.start, end: token.end,
      startValue: structuredClone(token.start), endValue: structuredClone(token.end),
      record: { ...token, start: { ...token.start }, end: { ...token.end } },
    })),
  });
}
export function beginInterior(opening, closing) {
  count("interiorCalls");
  const frame = { opening, closing, root: undefined };
  frames.push(frame); interiors.push(frame);
}
export function endInterior() { frames.pop(); }
export function replacement(events, from, to, output) {
  count("replacements");
  if (record) replacements.push({ events, from, to, output: [...output],
    oldLength: events.length, oldSuffix: events.slice(to), delta: output.length - (to - from),
    writeStart: writes.length,
  });
}
`;

const mutants = new Set([
  "none",
  "serialize-each-layer",
  "interior-each-layer",
  "interior-copy-each-layer",
  "scratch-no-closer",
  "registry-before-empty",
  "chunked-replacement",
  "backward-only",
  "forward-only",
  "positive-delta",
  "reuse-leftovers",
  "clean-consumed",
  "generic-close",
]);
function mutate(source, kind, mutant) {
  if (mutant === "none") return source;
  if (mutant === "scratch-no-closer") {
    if (kind === "attention")
      return once(source, "  if (mdrefineHandleAttentionFast(events, context)) return events;", "");
    if (kind === "strike")
      return once(source, "    if (mdrefineHandleStrikeNoCloser(events)) return events;", "");
    return source;
  }
  if (mutant === "generic-close" && kind === "strike")
    return body(source, "function mdrefineHandleStrikeNoCloser(events) {", (section) =>
      once(
        section,
        '    if (event[1].type !== "strikethroughSequenceTemporary") continue;',
        '    if (event[1].type !== "strikethroughSequenceTemporary" && !event[1]._close) continue;',
      ),
    );
  if (kind !== "attention") return source;
  if (mutant === "serialize-each-layer")
    return once(
      source,
      "    const use = currentOpening > 1 && currentClosing > 1 ? 2 : 1;",
      "    context.sliceSerialize(opening); context.sliceSerialize(closing);\n    const use = currentOpening > 1 && currentClosing > 1 ? 2 : 1;",
    );
  if (mutant === "interior-each-layer")
    return once(
      source,
      "    if (interior === undefined) {",
      '    if (interior !== undefined) {\n      mdrefineProbe.count("interiorCalls");\n      interior = resolveAll(insideSpan, interior, context);\n    }\n    if (interior === undefined) {',
    );
  if (mutant === "interior-copy-each-layer")
    return once(
      source,
      "    if (interior === undefined) {",
      '    if (interior !== undefined) interior = mdrefineProbe.observe(mdrefineProbe.interiorSlice(interior), "interior");\n    if (interior === undefined) {',
    );
  if (mutant === "registry-before-empty")
    return once(
      source,
      "function mdrefineHandleAttentionFast(events, context) {",
      "function mdrefineHandleAttentionFast(events, context) {\n  mdrefineKnownHomogeneousPipeline(context.parser.constructs.insideSpan.null);",
    );
  if (mutant === "chunked-replacement")
    return body(
      source,
      "function mdrefineReplaceAttentionRegion(events, from, to, output) {",
      () =>
        "function mdrefineReplaceAttentionRegion(events, from, to, output) {\n  splice(events, from, to - from, output);\n}",
    );
  if (mutant === "backward-only")
    return once(
      source,
      "    for (let index = to; index < oldLength; index++) {",
      "    for (let index = oldLength - 1; index >= to; index--) {",
    );
  if (mutant === "forward-only")
    return once(
      source,
      "    for (let index = oldLength - 1; index >= to; index--) {",
      "    for (let index = to; index < oldLength; index++) {",
    );
  if (mutant === "positive-delta")
    return once(
      source,
      "  const delta = output.length - (to - from);",
      "  const delta = Math.max(1, output.length - (to - from));",
    );
  if (mutant === "reuse-leftovers") {
    source = once(
      source,
      '    output.push(["enter", opening, context], ["exit", opening, context]);',
      "    output.push(events[open], events[open + 1]);",
    );
    return once(
      source,
      '  if (remainingClosing) output.push(["enter", closing, context], ["exit", closing, context]);',
      "  if (remainingClosing) output.push(events[close], events[close + 1]);",
    );
  }
  if (mutant === "clean-consumed") {
    source = once(
      source,
      '  if (remainingOpening) opening.type = "data";',
      '  opening.type = "data";',
    );
    return once(
      source,
      '  if (remainingClosing) closing.type = "data";',
      '  closing.type = "data";',
    );
  }
  if (mutant === "generic-close")
    return body(source, "function mdrefineHandleAttentionFast(events, context) {", (section) =>
      once(
        section,
        '    if (event[1].type !== "attentionSequence") continue;',
        '    if (event[1].type !== "attentionSequence" && !event[1]._close) continue;',
      ),
    );
  throw new Error(`Unimplemented emphasis mutant ${mutant}`);
}
function instrument(source, kind, variant, mutant) {
  if (variant === "fixed") source = mutate(source, kind, mutant);
  if (kind === "attention") {
    const signature = "function resolveAllAttention(events, context) {";
    source = once(
      source,
      signature,
      signature + '\n  mdrefineProbe.raw("attention", events, context);',
    );
    if (variant === "stock")
      source += "\nexport const mdrefineResolveAttention = resolveAllAttention;\n";
    if (variant === "fixed") {
      source = body(source, "function mdrefineHandleAttentionFast(events, context) {", (section) =>
        once(
          once(
            once(
              section,
              "    const event = events[index];",
              '    mdrefineProbe.count("attentionPreludeVisits");\n    const event = events[index];',
            ),
            "      while (++index < events.length) {",
            '      while (++index < events.length) {\n        mdrefineProbe.count("cleanupVisits");',
          ),
          '          events[index][1].type = "data";',
          '          mdrefineProbe.count("cleanupAssignments");\n          events[index][1].type = "data";',
        ),
      );
      source = once(
        source,
        "function mdrefineResolveHomogeneousAttention(events, context, open, close) {",
        'function mdrefineResolveHomogeneousAttention(events, context, open, close) {\n  mdrefineProbe.count("batchAttempts");',
      );
      source = once(
        source,
        "    layers.push({ openingSequence, closingSequence, text, group });",
        '    mdrefineProbe.count("layers");\n    layers.push({ openingSequence, closingSequence, text, group });',
      );
      source = once(
        source,
        "      interior = resolveAll(insideSpan, events.slice(open + 2, close), context);",
        "      mdrefineProbe.beginInterior(opening, closing);\n      interior = resolveAll(insideSpan, events.slice(open + 2, close), context);\n      mdrefineProbe.endInterior();",
      );
      source = once(
        source,
        "  mdrefineReplaceAttentionRegion(events, open, close + 2, output);",
        '  mdrefineProbe.count("batchSuccesses");\n  mdrefineProbe.replacement(events, open, close + 2, output);\n  mdrefineReplaceAttentionRegion(events, open, close + 2, output);',
      );
      source = once(
        source,
        "function mdrefineKnownHomogeneousPipeline(constructs) {",
        'function mdrefineKnownHomogeneousPipeline(constructs) {\n  mdrefineProbe.count("registryCalls");',
      );
      source = once(
        source,
        "  const seen = new Set();",
        '  mdrefineProbe.count("registrySets");\n  const seen = new Set();',
      );
      source = once(
        source,
        "function mdrefineBalancedAttentionEvents(events, from, to) {",
        'function mdrefineBalancedAttentionEvents(events, from, to) {\n  mdrefineProbe.count("balanceScans");',
      );
      source = once(
        source,
        "  const layers = [];",
        '  const layers = mdrefineProbe.observe([], "layers");',
      );
      source = once(
        source,
        "  const output = [];",
        '  const output = mdrefineProbe.observe([], "output");',
      );
      source = once(
        source,
        "  const stack = [];",
        '  const stack = mdrefineProbe.observe([], "balance");',
      );
      source +=
        "\nexport const mdrefineTestRole = (resolve) => mdrefineHomogeneousResolverRoles.get(resolve);\n";
    } else source += "\nexport const mdrefineTestRole = () => undefined;\n";
  }
  if (kind === "strike") {
    const signature = "function resolveAllStrikethrough(events, context) {";
    source = once(
      source,
      signature,
      signature + '\n    mdrefineProbe.raw("strike", events, context);',
    );
    if (variant === "fixed")
      source = body(source, "function mdrefineHandleStrikeNoCloser(events) {", (section) =>
        once(
          once(
            once(
              section,
              "    const event = events[index];",
              '    mdrefineProbe.count("strikePreludeVisits");\n    const event = events[index];',
            ),
            "    while (++index < events.length) {",
            '    while (++index < events.length) {\n      mdrefineProbe.count("cleanupVisits");',
          ),
          '        events[index][1].type = "data";',
          '        mdrefineProbe.count("cleanupAssignments");\n        events[index][1].type = "data";',
        ),
      );
  }
  if (kind === "cjk")
    source = once(
      source,
      "function resolveAllAttention(events, context) {",
      'function resolveAllAttention(events, context) {\n  mdrefineProbe.raw("attention", events, context);',
    );
  // Observe actual scratch allocations too; an early-return regression must
  // not disappear merely because the input proxy sees linear traffic.
  if (variant === "fixed" && ["attention", "strike"].includes(kind)) {
    source = once(
      source,
      "const left = [];",
      'const left = mdrefineProbe.observe([], "left"); mdrefineProbe.count("leftAllocations");',
    );
    source = source.replaceAll(
      "new AttentionOpeners(context)",
      '(mdrefineProbe.count("openerAllocations"), new AttentionOpeners(context))',
    );
    source = source.replaceAll(
      "new StrikeOpeners()",
      '(mdrefineProbe.count("openerAllocations"), new StrikeOpeners())',
    );
  }
  if (["attention", "strike", "cjk"].includes(kind)) {
    // Match the complete member receiver first: plain-context replacement
    // would otherwise turn this.context.sliceSerialize into this.mdrefineProbe.
    source = source
      .replaceAll("this.context.sliceSerialize(", "mdrefineProbe.serialize(this.context, ")
      .replaceAll("context.sliceSerialize(", "mdrefineProbe.serialize(context, ");
    assert(!source.includes("this.mdrefineProbe."), "Corrupt emphasis instrumentation receiver");
  }
  // Observe the actual slice produced for a real inner pipeline, in both
  // stock and fixed. Stable views preserve tuple/token/point identity; this is
  // instrumentation of its real work, not a replacement interior resolver.
  for (const [slice, delegate] of [
    ["events.slice(open + 2, close)", "mdrefineProbe.interiorSlice(events, open + 2, close)"],
    ["events.slice(open + 1, index)", "mdrefineProbe.interiorSlice(events, open + 1, index)"],
    ["left.slice(open + 1, index)", "mdrefineProbe.interiorSlice(left, open + 1, index)"],
  ])
    source = source.replaceAll(slice, `mdrefineProbe.observe(${delegate}, "interior")`);
  return 'import * as mdrefineProbe from "mdrefine:emphasis-work";\n' + source;
}

const loaded = new Map();
/** Test-only full parser graph; never writes a generated product artifact. */
export function emphasisGraph(variant, mutant = "none") {
  assert(["stock", "fixed"].includes(variant));
  assert(mutants.has(mutant));
  assert(variant === "fixed" || mutant === "none");
  const key = `${variant}/${mutant}`;
  if (!loaded.has(key)) loaded.set(key, build(variant, mutant));
  return loaded.get(key);
}
async function build(variant, mutant) {
  const from = await packageForFile(here.resolve("mdast-util-from-markdown"));
  const micromark = await packageForFile(createRequire(productionEntry(from)).resolve("micromark"));
  const core = await packageForFile(
    createRequire(productionEntry(micromark)).resolve("micromark-core-commonmark"),
  );
  const attention = path.join(core.directory, "lib", "attention.js");
  const text = path.join(micromark.directory, "lib", "initialize", "text.js");
  const factories = new Map();
  for (const name of [
    "mdast-util-from-markdown",
    "micromark-extension-gfm",
    "micromark-extension-gfm-strikethrough",
    "micromark-extension-cjk-friendly",
  ])
    factories.set(name, productionEntry(await packageForFile(here.resolve(name))));
  const seen = new Map();
  const editMaps = new Map();
  const entry = `export { fromMarkdown } from "mdast-util-from-markdown";
export { gfm } from "micromark-extension-gfm";
export { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
export { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
export { attention, mdrefineResolveAttention as attentionResolver, mdrefineTestRole as role } from "mdrefine:core-attention";
export { resolver as textResolver } from "mdrefine:probe-text";
export * as probe from "mdrefine:emphasis-work";
`;
  const bundle = await rolldown({
    cwd: root,
    input: "mdrefine:emphasis-entry",
    platform: "neutral",
    resolve: { conditionNames: ["import", "default"] },
    plugins: [
      {
        name: "actual-reviewed-emphasis-graph",
        async resolveId(source, importer) {
          if (["mdrefine:emphasis-entry", "mdrefine:emphasis-work"].includes(source)) return source;
          if (source === "mdrefine:core-attention") return attention;
          if (source === "mdrefine:probe-text") return text;
          if (importer === "mdrefine:emphasis-entry" && factories.has(source))
            return factories.get(source);
          if (source !== "micromark-util-edit-map" || variant === "stock") return;
          assert(importer && path.isAbsolute(importer));
          const packageRoot = await packageForFile(createRequire(importer).resolve(source));
          const filename = path.join(packageRoot.directory, "index.js");
          const raw = await readFile(filename, "utf8");
          const repaired = repairReviewedParserSource("editMap", raw, packageRoot.metadata);
          if (editMaps.has(filename)) assert.equal(editMaps.get(filename), repaired);
          editMaps.set(filename, repaired);
          assert.equal(editMaps.size, 1, "Review duplicate physical EditMap sources");
          return "mdrefine:probe-edit-map";
        },
        load(id) {
          if (id === "mdrefine:emphasis-entry") return entry;
          if (id === "mdrefine:emphasis-work") return statsSource;
          if (id === "mdrefine:probe-edit-map") return [...editMaps.values()][0];
        },
        async transform(raw, id) {
          if (slash(id).endsWith(`/${resolveAllGuard.name}/${resolveAllGuard.relative}`)) {
            const packageRoot = await packageForFile(id);
            assert.equal(packageRoot.metadata.name, resolveAllGuard.name);
            assert.equal(packageRoot.metadata.version, resolveAllGuard.version);
            assert.equal(hash(raw), resolveAllGuard.hash);
            return (
              'import * as mdrefineProbe from "mdrefine:emphasis-work";\n' +
              once(
                raw,
                "      events = resolve(events, context)",
                "      mdrefineProbe.callback(resolve, events, context)\n      events = resolve(events, context)",
              )
            );
          }
          for (const [kind, guard] of Object.entries(sourceGuards)) {
            if (kind === "editMap" || !slash(id).endsWith(`/${guard.name}/${guard.relative}`))
              continue;
            const packageRoot = await packageForFile(id);
            assert.equal(packageRoot.metadata.name, guard.name);
            assert.equal(packageRoot.metadata.version, guard.version);
            assert.equal(hash(raw), guard.hash);
            assert(!seen.has(kind), `Review extra physical ${kind} copy`);
            seen.set(kind, {
              file: `${guard.name}@${guard.version}/${guard.relative}`,
              hash: guard.hash,
            });
            let source =
              variant === "fixed"
                ? repairReviewedParserSource(kind, raw, packageRoot.metadata)
                : raw;
            if (["attention", "strike", "text", "cjk"].includes(kind))
              source = instrument(source, kind, variant, mutant);
            return source;
          }
        },
      },
    ],
  });
  try {
    const generated = await bundle.generate({ format: "esm", comments: true });
    assert.equal(generated.output.length, 1);
    const chunk = generated.output[0];
    assert.equal(chunk.type, "chunk");
    assert.deepEqual(chunk.imports, []);
    assert.deepEqual(chunk.dynamicImports, []);
    for (const required of ["attention", "strike", "text", "cjk"])
      assert(seen.has(required), required);
    // Assert the REAL adopted registration identities, not a synthetic registry.
    if (variant === "fixed") assert.equal(editMaps.size, 1);
    for (const filename of Object.keys(chunk.modules).filter((file) => path.isAbsolute(file))) {
      const relative = path.relative(await realpath(root), await realpath(filename));
      assert(
        relative &&
          !relative.startsWith(`..${path.sep}`) &&
          relative !== ".." &&
          !path.isAbsolute(relative),
      );
    }
    // Keep thrown function frames short without a file write or changing the
    // actual algorithm. Labels are deterministic validated variant/mutant ids.
    const code = `${chunk.code}\n//# sourceURL=mdrefine-emphasis-probe-${variant}-${mutant}.mjs\n`;
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
    if (variant === "fixed") {
      assert.equal(module.role(module.attentionResolver), "attention");
      assert.equal(module.role(module.textResolver.resolveAll), "text");
      assert.equal(module.role(module.gfmStrikethrough().insideSpan.null[0].resolveAll), "strike");
      assert.equal(
        module.role(module.cjkFriendlyExtension().insideSpan.null[0].resolveAll),
        "attention",
      );
    }
    return {
      ...module,
      diagnostics: { variant, mutant, rawInputs: [...seen.values()], generatedSha256: hash(code) },
    };
  } finally {
    await bundle.close();
  }
}
