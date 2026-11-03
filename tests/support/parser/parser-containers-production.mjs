import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { builtinContainers, nestedList, originalContainers } from "./parser-containers.mjs";

const sha256 = (source) => createHash("sha256").update(source).digest("hex");
function once(source, before, after) {
  assert.equal(source.split(before).length, 2, `Changed container production anchor: ${before}`);
  return source.replace(before, () => after);
}

export function verifyNestedTree(tree, count, length) {
  assert.equal(tree.position.end.offset, length);
  const pending = [[tree, 0]];
  let lists = 0;
  let items = 0;
  let texts = 0;
  let depth = 0;
  while (pending.length) {
    const [node, parentDepth] = pending.pop();
    const currentDepth = parentDepth + (node.type === "list" ? 1 : 0);
    depth = Math.max(depth, currentDepth);
    if (node.type === "list") lists++;
    if (node.type === "listItem") items++;
    if (node.type === "text") {
      assert.equal(node.value, "x");
      texts++;
    }
    for (const child of node.children ?? []) pending.push([child, currentDepth]);
  }
  assert.deepEqual(
    { lists, items, texts, depth },
    { lists: count, items: count, texts: count, depth: count },
  );
  assert.equal(tree.children.at(-1).type, "html");
  assert.equal(tree.children.at(-1).value, "<h1>");
}

/** Instrument only an in-memory copy of the actual hash-bound built runtime. */
export async function verifyContainerProduction(mutant = "none") {
  assert(["none", "missing", "cache", "descendants"].includes(mutant));
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
  const runtimeSha256 = sha256(runtime);
  assert.equal(runtimeSha256, manifest.runtimeSha256);
  for (const filename of [
    "scripts/parser-adaptations/blank-line.ts",
    "scripts/parser-adaptations/list-prepare.ts",
  ]) {
    const entry = manifest.localSources.find((item) => item.file === filename);
    assert(entry, `Missing container source binding: ${filename}`);
    assert.equal(
      sha256(await readFile(new URL(`../../../${filename}`, import.meta.url))),
      entry.sha256,
    );
  }
  let source = once(
    runtime,
    "function tokenizeBlankLine(effects, ok, nok) {",
    `function tokenizeBlankLine(effects, ok, nok) {
    const original = effects;
    effects = { ...effects, consume(code) { mdrefineContainerWork.blankCodes++; original.consume(code); } };`,
  );
  source = once(
    source,
    "function compile(events) {",
    "function compile(events) { mdrefineContainerWork.rawEvents += events.length;",
  );
  assert.equal(source.split("while (++index <= end) {").length, 3);
  source = source.replaceAll(
    "while (++index <= end) {",
    "while (++index <= end) { mdrefineContainerWork.listVisits++;",
  );
  source = once(
    source,
    "const listEvents = events.splice(start);",
    "const listEvents = events.splice(start); mdrefineContainerWork.listAppends += listEvents.length + insertions.length;",
  );
  source = once(
    source,
    "prepared.push(events[index]);",
    "prepared.push(events[index]); mdrefineContainerWork.listAppends++;",
  );
  source = once(
    source,
    "prepared.push(events[at]);",
    "prepared.push(events[at]); mdrefineContainerWork.listAppends++;",
  );
  source = once(
    source,
    "prepared.push(event);",
    "{ prepared.push(event); mdrefineContainerWork.listAppends++; }",
  );
  source = once(
    source,
    "const containerEnds = /* @__PURE__ */ new Map();",
    "mdrefineContainerWork.fastLists++; const containerEnds = new Map();",
  );
  source = once(
    source,
    "return (known.blank ? onBlank : notBlank)(code);",
    "{ mdrefineContainerWork.blankHits++; return (known.blank ? onBlank : notBlank)(code); }",
  );
  if (mutant === "missing")
    source = once(
      source,
      "const builtin = mdrefinePrepareLists(events);",
      "const builtin = undefined;",
    );
  if (mutant === "cache")
    source = once(
      source,
      "const known = mdrefineBlankSpans.get(this);",
      "const known = undefined;",
    );
  if (mutant === "descendants")
    source = once(source, "if (exit !== void 0) index = exit - 1;", "if (false) index = exit - 1;");
  source +=
    "\nconst mdrefineContainerWork = { rawEvents: 0, blankCodes: 0, listVisits: 0, listAppends: 0, fastLists: 0, blankHits: 0 }; export { mdrefineContainerWork };\n";
  const probe = await import(
    `data:text/javascript;base64,${Buffer.from(source + `\n//# sourceURL=mdrefine-container-${mutant}-${sha256(source)}.mjs\n`).toString("base64")}`
  );
  const read = (count, extension) => {
    for (const key of Object.keys(probe.mdrefineContainerWork))
      probe.mdrefineContainerWork[key] = 0;
    const input = nestedList(count);
    const tree = probe.fromMarkdown(input, {
      extensions: [probe.gfm(), extension],
      mdastExtensions: [gfmFromMarkdown()],
    });
    verifyNestedTree(tree, count, input.length);
    return {
      tree,
      work: { count, bytes: Buffer.byteLength(input), ...probe.mdrefineContainerWork },
    };
  };
  const results = [40, 160].map((count) => read(count, builtinContainers).work);
  for (const sample of results) {
    assert(sample.fastLists > 0, "production container helper was not reached");
    if (mutant !== "cache") assert(sample.blankHits > 0, "production blank cache was not reached");
  }
  // Four times the depth means about sixteen times the source bytes/events.
  for (const key of ["blankCodes", "listVisits", "listAppends"])
    assert(
      results[1][key] / results[0][key] < 20,
      `production container ${key} work grew ${results[1][key] / results[0][key]} times`,
    );
  const builtin = read(12, builtinContainers);
  for (const extension of [{}, originalContainers]) {
    const fallback = read(12, extension);
    assert.deepEqual(fallback.tree, builtin.tree);
    assert.equal(fallback.work.fastLists, 0, "external/unmarked grammar used list shortcut");
    assert.equal(fallback.work.blankHits, 0, "external/unmarked grammar used blank shortcut");
    assert(fallback.work.blankCodes > builtin.work.blankCodes);
    assert(fallback.work.listVisits > builtin.work.listVisits);
  }
  return { runtimeSha256, results };
}
