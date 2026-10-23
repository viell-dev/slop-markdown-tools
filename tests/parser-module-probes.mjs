// Narrow in-memory regression probe. The optimized algorithms come from the
// production repair function, not a second implementation maintained by tests.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { rolldown } from "rolldown";
import { repairParserSource, sourceGuards } from "../scripts/parser-patches.mjs";

const kinds = {
  editMap: "editMap",
  text: "text",
  code: "code",
  attention: "attention",
  strike: "strike",
  autolink: "autolink",
  footnote: "footnote",
  cjk: "cjk",
};
const observerSource = `export const workStats = { reads: 0, writes: 0 };
export function resetWork() { workStats.reads = 0; workStats.writes = 0; }
export function observeEvents(events) {
  return new Proxy(events, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)) workStats.reads++;
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      if (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)) workStats.writes++;
      return Reflect.set(target, key, value, receiver);
    },
  });
}
`;

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
  const parent = ["editMap", "code", "attention"].includes(kind)
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
 * @param {"editMap"|"text"|"code"|"attention"|"strike"|"autolink"} kind
 * @param {"stock"|"fixed"} variant
 * @returns {Promise<Record<string, any>>}
 */
export async function loadParserModule(kind, variant) {
  const selected = await readReviewedSource(kind);
  const bundle = await rolldown({
    input: selected.filename,
    platform: "neutral",
    resolve: { conditionNames: ["import", "default"] },
    plugins: [
      {
        name: "count-actual-parser-array-work",
        resolveId(source) {
          if (source === "mdrefine:test-work") return source;
        },
        load(id) {
          if (id === "mdrefine:test-work") return observerSource;
        },
        transform(original, id) {
          if (id !== selected.filename) return;
          assert.equal(original, selected.source);
          let source = variant === "fixed" ? repairParserSource(kind, original) : original;
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
          source += '\nexport { workStats, resetWork, observeEvents } from "mdrefine:test-work";\n';
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
    probe = await import(
      `data:text/javascript;base64,${Buffer.from(generated.output[0].code).toString("base64")}`
    );
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
