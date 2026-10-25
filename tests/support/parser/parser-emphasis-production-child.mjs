// Its sole inspector session observes real compiled product files without hooks.
import assert from "node:assert/strict";
import { Session } from "node:inspector";
import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { pathToFileURL, URL } from "node:url";
import {
  assertBinding,
  assertSources,
  canonicalParserURL,
  hash,
  createCoverageDeltaReader,
  successFunctionRange,
} from "./parser-emphasis-production-support.mjs";

const report = { schema: 1, status: "failed", node: process.version, rows: [], failures: [] };
let session;
let post;
let request;

function flat(value) {
  // Complete field/value/order records without recursively serializing a deep
  // positioned tree. Object key order is immaterial; array order/presence isn't.
  const output = [];
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (item === null) output.push(["null"]);
    else if (Array.isArray(item)) {
      output.push(["array", item.length]);
      for (let index = item.length - 1; index >= 0; index--) {
        assert(Object.hasOwn(item, index), "Sparse AST array");
        pending.push(item[index]);
      }
    } else if (typeof item === "object") {
      const keys = Object.keys(item).sort();
      output.push(["object", keys]);
      for (let index = keys.length - 1; index >= 0; index--) pending.push(item[keys[index]]);
    } else {
      assert(
        ["string", "number", "boolean", "undefined"].includes(typeof item),
        "Unexpected AST value",
      );
      if (typeof item === "number") assert(Number.isFinite(item));
      output.push(typeof item === "undefined" ? ["undefined"] : [typeof item, item]);
    }
  }
  return output;
}

function failure(kind, id, error, extra = {}) {
  report.failures.push({ kind, id, message: error.message, stack: error.stack, ...extra });
}

const emptySyntax = { name: "emphasis-production-original", syntax: { micromark: {}, mdast: {} } };

try {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    assert(input.length <= 8 * 1024 * 1024, "Oversized child request");
  }
  request = JSON.parse(input);
  assert.equal(request.schema, 1);
  assert(Array.isArray(request.cases) && request.cases.length > 0);
  const runtimeRoot = await assertBinding(request.runtimeRoot, request.binding, request.mutation);
  await assertSources(request.sourceRoot, request.binding);
  const targetURL = await canonicalParserURL(runtimeRoot, request.binding);
  report.parserURL = targetURL;
  report.normalParserHash = request.binding.hashes[request.binding.parserFile];
  report.observedParserHash = request.mutation?.mutantHash ?? report.normalParserHash;
  report.mutation = request.mutation;
  session = new Session();
  session.connect();
  post = (method, args = {}) =>
    new Promise((resolve, reject) => {
      session.post(method, args, (error, value) => (error ? reject(error) : resolve(value)));
    });
  await post("Profiler.enable");
  await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  const product = await import(pathToFileURL(path.join(runtimeRoot, "dist/index.js")).href);
  const syntax = await import(pathToFileURL(path.join(runtimeRoot, "dist/syntax/parse.js")).href);
  const adapter = await import(targetURL);
  assert.equal(product.parse, syntax.parse, "Public entry uses a different compiled parse module");

  const actualParserSource = await readFile(new URL(targetURL), "utf8");
  assert.equal(
    hash(actualParserSource),
    report.observedParserHash,
    "Parser changed before coverage catalog",
  );
  const expectedSuccessRange = successFunctionRange(actualParserSource);
  const initialCoverage = await post("Profiler.takePreciseCoverage");
  const successCoverage = createCoverageDeltaReader(
    initialCoverage,
    targetURL,
    expectedSuccessRange,
  );
  report.coverageCatalog = successCoverage.catalog;

  const capture = async (id, invoke, expectHit) => {
    // Validate identity/range even on discarded setup/Original-control traffic.
    successCoverage.read(await post("Profiler.takePreciseCoverage"));
    const value = invoke();
    const observed = successCoverage.read(await post("Profiler.takePreciseCoverage"));
    const calls = observed.calls;
    // This remains the actual positive assertion. An omitted function/script
    // means zero only after the real initial catalog was successfully established.
    // Mutants still get this one reachability failure and then complete AST parity.
    try {
      assert.equal(calls > 0, expectHit, `Production batch hit mismatch: ${id}`);
    } catch (error) {
      failure("reachability", id, error, { expectHit, calls });
    }
    return { value, calls, expectHit, id, coverageObservation: observed.observation };
  };

  const recordTree = (entry, phase, captured, actual, control) => {
    const actualFlat = flat(actual);
    const controlFlat = flat(control);
    let parity = true;
    try {
      assert.deepEqual(actualFlat, controlFlat, `Positioned AST mismatch ${entry.id}/${phase}`);
    } catch (error) {
      parity = false;
      failure("ast", `${entry.id}/${phase}`, error, { actual: actualFlat, control: controlFlat });
    }
    report.rows.push({
      id: captured.id,
      caseId: entry.id,
      phase,
      dialect: entry.dialect,
      sourceHash: hash(entry.source),
      source: entry.source,
      calls: captured.calls,
      coverageObservation: captured.coverageObservation,
      expectHit: captured.expectHit,
      astParity: parity,
      treeHash: hash(JSON.stringify(actualFlat)),
      originalResolverTreeHash: hash(JSON.stringify(controlFlat)),
    });
  };

  for (const entry of request.cases) {
    try {
      assert.equal(typeof entry.expectHit, "boolean");
      if (entry.kind === "generated") {
        const options = { extensions: [{ disable: { null: entry.markers } }] };
        const generated = await capture(
          `${entry.id}/primary`,
          () => adapter.fromMarkdown(entry.source, options),
          entry.expectHit,
        );
        const control = adapter.fromMarkdown(entry.source, {
          extensions: [{ disable: { null: ["mdrefineDeferredInline"] } }],
        });
        recordTree(entry, "generated", generated, generated.value, control);
        continue;
      }
      const plugins = entry.plugin ? [emptySyntax] : [];
      const make = (selected) =>
        product.parse(
          entry.source,
          entry.dialect,
          "reachability.md",
          selected,
          entry.vitepress ?? {},
        );
      const primaryExpected = entry.kind === "primary" ? entry.expectHit : !entry.plugin;
      const primary = await capture(`${entry.id}/primary`, () => make(plugins), primaryExpected);
      const control = make([emptySyntax]); // Outside measured window, Original first.
      recordTree(entry, "primary", primary, primary.value.tree, control.tree);
      if (entry.kind === "primary") continue;

      let fastRoot = primary.value.tree;
      let controlRoot = control.tree;
      let accessor;
      if (entry.kind === "yamlPlain") accessor = syntax.plainReading;
      else if (entry.kind === "tomlOther") accessor = syntax.otherReading;
      else if (entry.kind === "githubFile") accessor = syntax.githubFileReading;
      else if (entry.kind === "fileIdentity") accessor = syntax.githubFileReading;
      else if (entry.kind === "githubPlainFile") {
        fastRoot = syntax.plainReading(fastRoot);
        controlRoot = syntax.plainReading(controlRoot);
        assert.notEqual(fastRoot, primary.value.tree);
        accessor = syntax.githubFileReading;
      } else if (entry.kind === "eagerFrontMatter") {
        if (!entry.plugin) assert(primary.calls >= 2, "Both eager readings must actually batch");
        accessor = syntax.frontMatterReading;
      } else throw new Error(`Unknown reachability scenario ${entry.kind}`);

      const lazyExpected = entry.kind === "eagerFrontMatter" ? false : entry.expectHit;
      const selected = await capture(
        `${entry.id}/selected`,
        () => accessor(fastRoot),
        lazyExpected,
      );
      const original = accessor(controlRoot);
      if (entry.kind === "fileIdentity") assert.equal(selected.value, fastRoot);
      else if (entry.dialect === "vitepress" && entry.kind === "yamlPlain")
        assert.equal(selected.value, fastRoot);
      else if (entry.dialect === "vitepress" && entry.kind === "tomlOther")
        assert.equal(selected.value, undefined);
      else {
        assert(selected.value !== undefined, "Expected actual alternate reading");
        assert.notEqual(selected.value, fastRoot, "Expected distinct alternate root");
      }
      recordTree(entry, "selected", selected, selected.value, original);
      const cached = await capture(`${entry.id}/cached`, () => accessor(fastRoot), false);
      assert.equal(cached.value, selected.value, "Cached reading changed identity");
      recordTree(entry, "cached", cached, cached.value, original);
    } catch (error) {
      failure("case-execution", entry.id, error);
    }
  }
  await assertBinding(request.runtimeRoot, request.binding, request.mutation);
  await assertBinding(request.sourceRoot, request.binding);
  await assertSources(request.sourceRoot, request.binding);
  report.hashesStable = true;
  report.caseCount = request.cases.length;
  report.status = report.failures.length ? "failed" : "passed";
} catch (error) {
  failure("infrastructure", "child", error);
} finally {
  if (post) {
    try {
      await post("Profiler.stopPreciseCoverage");
    } catch (error) {
      failure("infrastructure", "stop-coverage", error);
    }
    try {
      await post("Profiler.disable");
    } catch (error) {
      failure("infrastructure", "disable-profiler", error);
    }
  }
  if (session) session.disconnect();
  if (report.failures.length) report.status = "failed";
  // Stdout is one JSON record, including all failures. No pass on missing data.
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}
