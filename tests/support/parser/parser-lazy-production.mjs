import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { readReviewedSource } from "./parser-module-probes.mjs";

function once(source, before, after) {
  assert.equal(source.split(before).length, 2, `Changed lazy-line production anchor: ${before}`);
  return source.replace(before, () => after);
}

/** Count execution of the actual built closed bundle; dist is never modified. */
export async function verifyLazyLineProduction(mutant = "none") {
  const runtime = await readFile(
    new URL("../../../dist/syntax/parser.generated.js", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(
    await readFile(
      new URL("../../../dist/syntax/parser.generated.manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const runtimeSha256 = createHash("sha256").update(runtime).digest("hex");
  assert.equal(runtimeSha256, manifest.runtimeSha256);
  let source = once(
    runtime,
    "function mdrefineContinuesLazy(events, lineStartOffset) {",
    "function mdrefineContinuesLazyProduction(events, lineStartOffset) {\nmdrefineLazyProbe.hits++;",
  );
  if (mutant === "cache")
    source = once(
      source,
      "const known = mdrefineLazyContinuations.get(events);",
      "const known = undefined;",
    );
  if (mutant === "missing") {
    const original = (await readReviewedSource("document")).source;
    const start = original.indexOf("      let index = childFlow.events.length;");
    const end = original.indexOf("\n\n      // Note: this algorithm for moving events", start);
    assert(start >= 0 && end > start);
    const search = original.slice(start, end);
    assert.equal(search.split("return;").length, 2);
    source = once(
      source,
      "mdrefineContinuesLazy(childFlow.events, lineStartOffset)",
      "mdrefineOriginalLazySearch(childFlow.events, lineStartOffset)",
    );
    source += `\nfunction mdrefineOriginalLazySearch(events, lineStartOffset) {\nconst childFlow = { events };\n${search.replace("return;", "return true;")}\nreturn false;\n}\n`;
  }
  assert(["none", "cache", "missing"].includes(mutant));
  // A stable view only counts indexed reads; events, tokens and points pass
  // through by identity. The algorithm remains the actual generated function.
  source += `
const mdrefineLazyProbe = { hits: 0, reads: 0 };
const mdrefineLazyViews = new WeakMap();
function mdrefineContinuesLazy(events, offset) {
 let view = mdrefineLazyViews.get(events);
 if (!view) {
  view = new Proxy(events, { get(target, key, receiver) {
   if (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)) mdrefineLazyProbe.reads++;
   return Reflect.get(target, key, receiver);
  }});
  mdrefineLazyViews.set(events, view);
 }
 return mdrefineContinuesLazyProduction(view, offset);
}
export { mdrefineLazyProbe };
`;
  const digest = createHash("sha256").update(source).digest("hex");
  const probe = await import(
    `data:text/javascript;base64,${Buffer.from(source + `\n//# sourceURL=mdrefine-lazy-production-${mutant}-${digest}.mjs\n`).toString("base64")}`
  );
  const results = [];
  for (const count of [40, 160]) {
    probe.mdrefineLazyProbe.hits = 0;
    probe.mdrefineLazyProbe.reads = 0;
    const input = "- a\n" + "line\n".repeat(count);
    const tree = probe.fromMarkdown(input, {
      extensions: [probe.gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].type, "list");
    assert.equal(
      tree.children[0].children[0].children[0].children[0].value,
      "a\n" + "line\n".repeat(count).trimEnd(),
    );
    assert.equal(tree.position.end.offset, input.length);
    assert(probe.mdrefineLazyProbe.hits > 0, "production lazy-line helper was not reached");
    results.push({
      count,
      hits: probe.mdrefineLazyProbe.hits,
      reads: probe.mdrefineLazyProbe.reads,
    });
  }
  const growth = results[1].reads / results[0].reads;
  assert(growth < 6, `production lazy-line work grew ${growth} times`);
  return { runtimeSha256, results };
}
