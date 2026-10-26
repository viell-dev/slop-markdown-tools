import assert from "node:assert/strict";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  getHeapCodeStatistics,
  getHeapSpaceStatistics,
  getHeapStatistics,
  writeHeapSnapshot,
} from "node:v8";
import { pathToFileURL, URL } from "node:url";
import { checkMemoryAnchors, collectGarbage, memoryFixture } from "./workspace-memory.mjs";

// Vitest prepares/validates this product before running the suite. An explicit
// alternate product is solely for bounded retention-mutant experiments.
const { createWorkspace } = await import(
  process.argv[2]
    ? pathToFileURL(process.argv[2]).href
    : new URL("../../dist/index.js", import.meta.url)
);

async function settledHeap() {
  // RegExp's legacy last-match state must not retain the most recent source.
  /-/.test("-");
  await collectGarbage();
  return process.memoryUsage().heapUsed;
}

const targetPaths = new Set();
const targetBasenames = new Set();
const sourceHashes = new Set();
/** @param {Record<string, () => string>} files */
function registerWorkload(files) {
  for (const [name, read] of Object.entries(files)) {
    assert(!targetPaths.has(name), `Memory workloads reused target path: ${name}`);
    const basename = path.posix.basename(name);
    assert(!targetBasenames.has(basename), `Memory workloads reused basename: ${basename}`);
    // Retain only a bounded digest. The raw generated source stays in this
    // synchronous call, which finishes before the baseline's collection.
    const hash = createHash("sha256").update(read()).digest("hex");
    assert(!sourceHashes.has(hash), `Memory workloads reused source content: ${name}`);
    targetPaths.add(name);
    targetBasenames.add(basename);
    sourceHashes.add(hash);
  }
}

// Keep warm-up paths, basenames and full source content distinct from measured
// inputs, while preserving construct kinds and sizes with filler substitutions.
for (let warm = 0; warm < 2; warm++) {
  const prefix = `warmup-${warm}-`;
  const filler = warm === 0 ? "x" : "y";
  const fixture = memoryFixture(1000, prefix, filler);
  registerWorkload(fixture.files);
  checkMemoryAnchors(createWorkspace(fixture.files), prefix);
}
const fixture = memoryFixture(1000);
registerWorkload(fixture.files);
assert(fixture.smallest > 1_000_000);
const before = await settledHeap();
const index = createWorkspace(fixture.files);
checkMemoryAnchors(index);
const reads = [...fixture.reads];
const after = await settledHeap();
const held = after - before;
const report = {
  issue: 413,
  stage: "after-fixed-measurement",
  measurement: "isolated-compiled-product",
  collection: { type: "major", execution: "async", flavor: "last-resort" },
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    architecture: process.arch,
    pid: process.pid,
  },
  run: { id: process.env.GITHUB_RUN_ID ?? null, sha: process.env.GITHUB_SHA ?? null },
  sample: { before, after, held, smallest: fixture.smallest, allowance: fixture.smallest / 3 },
  memory: process.memoryUsage(),
  heap: getHeapStatistics(),
  code: getHeapCodeStatistics(),
  spaces: getHeapSpaceStatistics(),
};

if (!(held < fixture.smallest / 3)) {
  try {
    const directory = `artifacts/workspace-memory/${process.pid}`;
    mkdirSync(directory, { recursive: true });
    // Numeric evidence precedes optional snapshot collection, which can itself
    // transform the heap. Full heaps require an isolated synthetic environment.
    writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2) + "\n");
    if (process.env.MDREFINE_MEMORY_HEAP_SNAPSHOT === "1")
      writeHeapSnapshot(`${directory}/heap.heapsnapshot`);
  } catch (error) {
    console.error("Could not capture retained-text failure (#413):", String(error));
  }
}

// Keep the actual workspace and its cached anchors live across the fixed sample.
// Successful answers must not come from rebuilding documents after collection.
checkMemoryAnchors(index);
assert.deepEqual([...fixture.reads], reads);
process.stdout.write(JSON.stringify(report) + "\n");
assert(held < fixture.smallest / 3, `Retained ${held} bytes; allowance ${fixture.smallest / 3}`);
