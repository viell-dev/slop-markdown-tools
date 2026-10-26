import assert from "node:assert/strict";
import console from "node:console";
import { mkdirSync, writeFileSync } from "node:fs";
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

// Warm the measured sizes/paths before the baseline. Small warm-ups left a
// repeatable negative setup delta that could offset a retained source block.
for (let warm = 0; warm < 2; warm++) checkMemoryAnchors(createWorkspace(memoryFixture(1000).files));
const fixture = memoryFixture(1000);
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
