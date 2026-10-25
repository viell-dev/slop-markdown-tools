// Narrow in-memory regression probe. The optimized algorithms come from the
// production repair function, not a second implementation maintained by tests.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { rolldown } from "rolldown";
import { repairParserSource, sourceGuards } from "../../../scripts/parser-patches.mjs";

const kinds = {
  editMap: "editMap",
  text: "text",
  code: "code",
  attention: "attention",
  strike: "strike",
  autolink: "autolink",
  footnote: "footnote",
  labelEnd: "labelEnd",
  footnoteSyntax: "footnoteSyntax",
  cjk: "cjk",
};
const observerSource = `export const workStats = { reads: 0, writes: 0 };
export function resetWork() { workStats.reads = 0; workStats.writes = 0; }
const observedEventArrays = new WeakMap();
export function observeEvents(events) {
  const existing = observedEventArrays.get(events);
  if (existing) return existing;
  const observed = new Proxy(events, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)) workStats.reads++;
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      if (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)) workStats.writes++;
      return Reflect.set(target, key, value, receiver);
    },
  });
  // Both calls with the raw array and calls with its already observed view must
  // return exactly one view. Event tuples/tokens/points are never wrapped/cloned.
  observedEventArrays.set(events, observed);
  observedEventArrays.set(observed, observed);
  return observed;
}
`;

// Test counters/delegation only: the tokenizer/cache algorithms remain the
// actual stock or production-repaired source selected below.
const labelObserverSource =
  observerSource +
  `
export const labelWork = { positiveHits: 0, negativeHits: 0, serializedCalls: 0, serializedCharacters: 0 };
export function resetLabelWork() {
  for (const key of Object.keys(labelWork)) labelWork[key] = 0;
}
export function serializeLabel(context, ...args) {
  const value = Reflect.apply(context.sliceSerialize, context, args);
  labelWork.serializedCalls++;
  labelWork.serializedCharacters += value.length;
  return value;
}
`;

function labelOnce(source, before, after) {
  // Match the same source tokens across the fragment compiler's whitespace.
  const pattern = new RegExp(
    before
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+"),
    "g",
  );
  assert.equal([...source.matchAll(pattern)].length, 1, `Changed label probe anchor: ${before}`);
  return source.replace(pattern, () => after);
}

/**
 * Counter insertion and one-mechanism mutants of ACTUAL repaired functions.
 * @param {string} source
 * @param {string} kind
 * @param {"stock"|"fixed"} variant
 * @param {"none"|"nested"|"prefix"|"closer"} mutant
 */
function labelInstrumentation(source, kind, variant, mutant) {
  assert(["labelEnd", "footnoteSyntax"].includes(kind));
  if (variant === "stock") assert.equal(mutant, "none");
  if (variant === "fixed") {
    if (mutant === "nested") {
      assert.equal(kind, "labelEnd");
      source = labelOnce(
        source,
        '  const mdrefineFastLabels = disabled.includes("mdrefineBuiltinLabels") && !disabled.includes("mdrefineDeferredInline");',
        "  const mdrefineFastLabels = false; // Only the nested-opener mechanism is disabled.",
      );
    }
    if (mutant === "prefix") {
      assert.equal(kind, "footnoteSyntax");
      source = labelOnce(
        source,
        "    const cached = prefixes.get(event);",
        "    const cached = undefined; // Only prefix reuse is disabled; writes remain.",
      );
    }
    if (mutant === "closer") {
      assert.equal(kind, "footnoteSyntax");
      source = labelOnce(
        source,
        "    if (earlier !== undefined && earlier < at) return nok(code);",
        "    // Only the earlier-closer decline is disabled; its recording/cache remain.",
      );
    }
    if (kind === "footnoteSyntax")
      source = labelOnce(
        source,
        "      result = cached;\n      break;",
        "      if (cached.index < 0) labelWork.negativeHits++;\n      else labelWork.positiveHits++;\n      result = cached;\n      break;",
      );
  }
  // A stable Proxy is returned on EVERY access to a particular raw events
  // array. Event tuples/tokens/points are never wrapped, replaced or cloned.
  if (kind === "footnoteSyntax") {
    assert(source.includes("self.events"));
    source = source.replaceAll("self.events", "observeEvents(self.events)");
  }
  assert(source.includes("self.sliceSerialize("));
  source = source.replaceAll("self.sliceSerialize(", "serializeLabel(self, ");
  return (
    'import { observeEvents, serializeLabel, labelWork } from "mdrefine:test-work";\n' + source
  );
}

async function packageRoot(filename) {
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
    if (parent === directory) throw new Error(`No package for ${filename}`);
    directory = parent;
  }
}

/**
 * @param {string} kind
 * @returns {Promise<{filename: string, source: string, metadata: {name: string, version: string}} >}
 */
export async function readReviewedSource(kind) {
  const here = createRequire(import.meta.url);
  const from = await packageRoot(here.resolve("mdast-util-from-markdown"));
  const micromark = await packageRoot(
    createRequire(path.join(from.directory, "index.js")).resolve("micromark"),
  );
  const parent = ["editMap", "code", "attention", "labelEnd"].includes(kind)
    ? createRequire(path.join(micromark.directory, "index.js"))
    : here;
  const spec = sourceGuards[kinds[kind]];
  const root = kind === "text" ? micromark : await packageRoot(parent.resolve(spec.name));
  const filename = path.join(root.directory, spec.relative);
  const source = await readFile(filename, "utf8");
  assert.equal(root.metadata.name, spec.name);
  assert.equal(root.metadata.version, spec.version);
  assert.equal(createHash("sha256").update(source).digest("hex"), spec.hash);
  return { filename, source, metadata: root.metadata };
}

/** @typedef {{ work: number, signature: string[], arrayIdentity: boolean, survivorIdentity: boolean }} WorkResult */

/**
 * @param {"editMap"|"text"|"code"|"attention"|"strike"|"autolink"|"labelEnd"|"footnoteSyntax"} kind
 * @param {"stock"|"fixed"} variant
 * @param {{labelMutant?: "none"|"nested"|"prefix"|"closer"}} [options]
 * @returns {Promise<Record<string, any>>}
 */
export async function loadParserModule(kind, variant, options = {}) {
  const selected = await readReviewedSource(kind);
  const coreAttention = variant === "fixed" ? await readReviewedSource("attention") : undefined;
  const labelKind = ["labelEnd", "footnoteSyntax"].includes(kind);
  assert(labelKind || options.labelMutant === undefined);
  const bundle = await rolldown({
    input: selected.filename,
    platform: "neutral",
    resolve: { conditionNames: ["import", "default"] },
    plugins: [
      {
        name: "count-actual-parser-array-work",
        resolveId(source) {
          if (source === "mdrefine:test-work") return source;
          if (source === "mdrefine:core-attention") {
            assert(coreAttention, "Unexpected corrected-core import in a stock probe");
            return coreAttention.filename;
          }
        },
        load(id) {
          if (id === "mdrefine:test-work") return labelKind ? labelObserverSource : observerSource;
        },
        transform(original, id) {
          if (id !== selected.filename) {
            if (id !== coreAttention?.filename) return;
            assert.equal(original, coreAttention.source);
            return repairParserSource("attention", original);
          }
          assert.equal(original, selected.source);
          let source = variant === "fixed" ? repairParserSource(kind, original) : original;
          if (labelKind)
            source = labelInstrumentation(source, kind, variant, options.labelMutant ?? "none");
          if (variant === "fixed" && ["attention", "strike"].includes(kind)) {
            // Observe scratch-array traffic as well as the input array. Counting
            // input reads alone could miss a quadratic rewrite moved into `left`.
            assert.equal(source.split("const left = [];").length, 2);
            source =
              'import { observeEvents as observeWorkArray } from "mdrefine:test-work";\n' +
              source.replace("const left = [];", "const left = observeWorkArray([]);");
          }
          if (kind === "attention" && variant === "stock")
            source += "\nexport const mdrefineResolveAttention = resolveAllAttention;\n";
          if (kind === "autolink")
            source += "\nexport const mdrefineUnbalanced = previousUnbalanced;\n";
          if (kind === "footnoteSyntax")
            source +=
              "\nexport const mdrefinePotentialFootnoteCall = tokenizePotentialGfmFootnoteCall;\n";
          source += '\nexport { workStats, resetWork, observeEvents } from "mdrefine:test-work";\n';
          if (labelKind)
            source += '\nexport { labelWork, resetLabelWork } from "mdrefine:test-work";\n';
          return source;
        },
      },
    ],
  });
  let probe;
  try {
    const generated = await bundle.generate({ format: "esm", comments: false });
    assert.equal(generated.output.length, 1);
    assert.deepEqual(generated.output[0].imports, []);
    const code = generated.output[0].code;
    const digest = createHash("sha256").update(code).digest("hex").slice(0, 16);
    const labeled = `${code}\n//# sourceURL=mdrefine-module-${kind}-${variant}-${options.labelMutant ?? "none"}-${digest}.mjs\n`;
    probe = await import(`data:text/javascript;base64,${Buffer.from(labeled).toString("base64")}`);
  } finally {
    await bundle.close();
  }
  return probe;
}

/**
 * @param {"editMap"|"text"|"code"|"attention"|"strike"|"autolink"} kind
 * @param {"stock"|"fixed"} variant
 * @returns {Promise<(count: number) => WorkResult>}
 */
export async function createOperationProbe(kind, variant) {
  const probe = await loadParserModule(kind, variant);
  return (count) => {
    const markers = new WeakMap();
    const context = {
      parser: { constructs: { disable: { null: [] }, insideSpan: { null: [] } } },
      sliceSerialize: (token) => markers.get(token) ?? "",
    };
    let offset = 0;
    const point = (at) => ({ line: 1, column: at + 1, offset: at, _index: 0, _bufferIndex: at });
    const token = (type, width = 1, flags = {}) => {
      const start = point(offset);
      offset += width;
      const value = { type, start, end: point(offset), ...flags };
      markers.set(value, type === "strikethroughSequenceTemporary" ? "~~" : "*");
      return value;
    };
    const pair = (value) => [
      ["enter", value, context],
      ["exit", value, context],
    ];
    const raw = [];
    if (kind === "editMap") raw.push(...pair(token("data")));
    else if (kind === "autolink") raw.push(...pair(token("labelLink", 1, { _balanced: false })));
    else if (kind === "code") {
      const group = token("codeText", 0);
      raw.push(["enter", group, context], ...pair(token("codeTextSequence")));
      for (let index = 0; index < count; index++)
        raw.push(
          ...pair(token("codeTextData")),
          ...pair(token("space")),
          ...pair(token("codeTextData")),
          ...pair(token("lineEnding")),
        );
      raw.push(...pair(token("codeTextSequence")), ["exit", group, context]);
    } else if (kind === "text") {
      for (let index = 0; index < count; index++)
        raw.push(...pair(token("data")), ...pair(token("data")), ...pair(token("characterEscape")));
    } else {
      const type = kind === "attention" ? "attentionSequence" : "strikethroughSequenceTemporary";
      for (let index = 0; index < count; index++)
        raw.push(
          ...pair(token("data")),
          ...pair(token(type, kind === "strike" ? 2 : 1, { _close: true, _open: false })),
        );
    }
    const firstEvent = raw[0];
    const events = probe.observeEvents(raw);
    context.events = events;
    probe.resetWork();
    let returned = events;
    if (kind === "editMap") {
      for (let index = 0; index < count; index++) {
        const changes = new probe.EditMap();
        changes.add(events.length, 0, pair(token("data")));
        changes.consume(events);
      }
    } else if (kind === "autolink") {
      for (let index = 0; index < count; index++) {
        events.push(...pair(token("data")));
        assert.equal(probe.mdrefineUnbalanced(events), true);
      }
    } else if (kind === "text") returned = probe.resolver.resolveAll(events, context);
    else if (kind === "code") returned = probe.codeText.resolve(events, context);
    else if (kind === "attention") returned = probe.mdrefineResolveAttention(events, context);
    else returned = probe.gfmStrikethrough().insideSpan.null[0].resolveAll(events, context);
    // Snapshot before verification reads so assertions do not inflate measured work.
    const work = Number(probe.workStats.reads) + Number(probe.workStats.writes);
    return {
      work,
      arrayIdentity: returned === events,
      survivorIdentity: events[0] === firstEvent,
      signature: events.map(
        ([event, value]) => `${event}:${value.type}:${value.start.offset}-${value.end.offset}`,
      ),
    };
  };
}
