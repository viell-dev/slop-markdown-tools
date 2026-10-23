import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import ts from "typescript";

/** @typedef {import("./parser-emphasis-production-cases.mjs").EmphasisRegistration} EmphasisRegistration */
/** @typedef {import("./parser-emphasis-production-cases.mjs").EmphasisProductionCase} EmphasisProductionCase */
/** @typedef {{hashes: Record<string, string>, sourceHashes: Record<string, string>, manifestFile: string, parserFile: string}} EmphasisBinding */
/** @typedef {{start: number, end: number, original: string, replacement: string}} EmphasisRegistrationSpan */
/** @typedef {EmphasisRegistrationSpan & {registration: EmphasisRegistration, normalHash: string, mutantHash: string}} EmphasisMutation */
/** @typedef {{root: string, mutation: EmphasisMutation, cleanup: () => Promise<void>}} EmphasisMutant */
/** @typedef {{schema: 1, sourceRoot: string, runtimeRoot: string, binding: EmphasisBinding, cases: EmphasisProductionCase[], mutation?: EmphasisMutation}} EmphasisCoverageRequest */
/** @typedef {{id: string, caseId: string, phase: string, dialect: string, sourceHash: string, source: string, calls: number, expectHit: boolean, astParity: boolean, treeHash: string, originalResolverTreeHash: string}} EmphasisCoverageRow */
/** @typedef {{kind: string, id: string, message: string, stack?: string, calls?: number, expectHit?: boolean} & Record<string, unknown>} EmphasisCoverageFailure */
/** @typedef {{schema: 1, status: "passed" | "failed", node: string, rows: EmphasisCoverageRow[], failures: EmphasisCoverageFailure[], parserURL?: string, normalParserHash?: string, observedParserHash?: string, mutation?: EmphasisMutation, hashesStable?: boolean, caseCount?: number}} EmphasisCoverageReport */
/** @typedef {{code: number, result: EmphasisCoverageReport, stderr: string}} EmphasisCoverageChild */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isEmphasisReportRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** @param {unknown} value @returns {value is number} */
function isEmphasisCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** @param {unknown} value @returns {value is string} */
function isEmphasisHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
/** @param {unknown} value @returns {value is EmphasisMutation} */
function isEmphasisMutation(value) {
  return (
    isEmphasisReportRecord(value) &&
    ["core", "text", "strike", "cjk"].some((name) => name === value.registration) &&
    isEmphasisCount(value.start) &&
    isEmphasisCount(value.end) &&
    value.end > value.start &&
    typeof value.original === "string" &&
    typeof value.replacement === "string" &&
    isEmphasisHash(value.normalHash) &&
    isEmphasisHash(value.mutantHash)
  );
}
/** @param {unknown} value @returns {value is EmphasisCoverageRow} */
function isEmphasisCoverageRow(value) {
  return (
    isEmphasisReportRecord(value) &&
    typeof value.id === "string" &&
    typeof value.caseId === "string" &&
    typeof value.phase === "string" &&
    typeof value.dialect === "string" &&
    typeof value.source === "string" &&
    isEmphasisHash(value.sourceHash) &&
    isEmphasisCount(value.calls) &&
    typeof value.expectHit === "boolean" &&
    typeof value.astParity === "boolean" &&
    isEmphasisHash(value.treeHash) &&
    isEmphasisHash(value.originalResolverTreeHash)
  );
}
/** @param {unknown} value @returns {value is EmphasisCoverageFailure} */
function isEmphasisCoverageFailure(value) {
  return (
    isEmphasisReportRecord(value) &&
    typeof value.kind === "string" &&
    typeof value.id === "string" &&
    typeof value.message === "string" &&
    (value.stack === undefined || typeof value.stack === "string") &&
    (value.calls === undefined || isEmphasisCount(value.calls)) &&
    (value.expectHit === undefined || typeof value.expectHit === "boolean")
  );
}
/** @param {unknown} value @returns {value is EmphasisCoverageReport} */
function isEmphasisCoverageReport(value) {
  if (
    !isEmphasisReportRecord(value) ||
    value.schema !== 1 ||
    !["passed", "failed"].some((status) => status === value.status) ||
    typeof value.node !== "string" ||
    !Array.isArray(value.rows) ||
    !value.rows.every(isEmphasisCoverageRow) ||
    !Array.isArray(value.failures) ||
    !value.failures.every(isEmphasisCoverageFailure)
  )
    return false;
  if (value.parserURL !== undefined && typeof value.parserURL !== "string") return false;
  if (value.normalParserHash !== undefined && !isEmphasisHash(value.normalParserHash)) return false;
  if (value.observedParserHash !== undefined && !isEmphasisHash(value.observedParserHash))
    return false;
  if (value.mutation !== undefined && !isEmphasisMutation(value.mutation)) return false;
  if (value.hashesStable !== undefined && typeof value.hashesStable !== "boolean") return false;
  if (value.caseCount !== undefined && !isEmphasisCount(value.caseCount)) return false;
  return true;
}
/** @param {unknown} value @returns {EmphasisCoverageReport} */
function readEmphasisCoverageReport(value) {
  assert(isEmphasisCoverageReport(value), "Malformed emphasis child JSON report");
  return value;
}

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const slash = (value) => value.replaceAll("\\", "/");

function inside(root, target) {
  const relative = path.relative(root, target);
  assert(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
  );
  return relative;
}

async function regularFiles(root, folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    const stat = await lstat(filename);
    assert(!stat.isSymbolicLink(), `Unexpected link inside dist: ${filename}`);
    if (stat.isDirectory()) result.push(...(await regularFiles(root, filename)));
    else {
      assert(stat.isFile(), `Unexpected non-file in dist: ${filename}`);
      result.push(slash(inside(root, filename)));
    }
  }
  return result.sort();
}

// Source-map-to-current-source binding is additional to hashes. This does not
// independently recompile TypeScript; exact emit/build checks remain separate.
/**
 * @param {string} repositoryRoot
 * @returns {Promise<EmphasisBinding>}
 */
export async function productionBinding(repositoryRoot) {
  const root = await realpath(repositoryRoot);
  const dist = path.join(root, "dist");
  assert(!(await lstat(dist)).isSymbolicLink(), "Dist root must be the owned regular directory");
  inside(root, await realpath(dist));
  const files = await regularFiles(root, dist);
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const file of files) hashes[file] = hash(await readFile(path.join(root, file)));
  const manifestFile = "dist/syntax/parser.generated.manifest.json";
  const manifest = JSON.parse(await readFile(path.join(root, manifestFile), "utf8"));
  assert.equal(
    hashes["dist/syntax/parser.generated.js"],
    manifest.runtimeSha256,
    "Stale generated runtime",
  );
  assert.equal(hashes["dist/syntax/parser.generated.d.ts"], manifest.declarationSha256);
  assert.equal(hashes["dist/syntax/parser.generated.LICENSES.txt"], manifest.licensesSha256);
  assert(Array.isArray(manifest.localSources));
  assert.deepEqual(
    manifest.localSources.map(({ file }) => file),
    [
      "scripts/build-parser.mjs",
      "scripts/parser-patches.mjs",
      "scripts/parser-labels.mjs",
      "scripts/parser-packages.json",
      "src/syntax/parser.generated.d.ts",
    ],
    "Review changed local parser generator catalog",
  );
  /** @type {Record<string, string>} */
  const sourceHashes = {};
  for (const input of manifest.localSources) {
    const filename = await realpath(path.resolve(root, input.file));
    inside(root, filename);
    const digest = hash(await readFile(filename));
    assert.equal(digest, input.sha256, `Stale local parser source ${input.file}`);
    sourceHashes[input.file] = digest;
  }
  for (const file of files.filter((value) => value.endsWith(".js.map"))) {
    const filename = path.join(root, file);
    const map = JSON.parse(await readFile(filename, "utf8"));
    assert.equal(map.sourceRoot ?? "", "");
    assert.equal(map.sources.length, map.sourcesContent.length);
    for (let index = 0; index < map.sources.length; index++) {
      const source = await realpath(path.resolve(path.dirname(filename), map.sources[index]));
      const relative = slash(inside(root, source));
      assert(
        relative.startsWith("src/") && relative.endsWith(".ts"),
        `Unexpected mapped source ${relative}`,
      );
      const bytes = await readFile(source);
      assert.equal(
        map.sourcesContent[index],
        bytes.toString("utf8"),
        `Stale inline source ${relative}`,
      );
      sourceHashes[relative] = hash(bytes);
    }
  }
  for (const file of ["dist/index.js", "dist/syntax/parse.js", "dist/syntax/parse.js.map"])
    assert(hashes[file]);
  for (const file of ["src/index.ts", "src/syntax/parse.ts"]) assert(sourceHashes[file]);
  const helper = await readFile(path.join(root, "dist/syntax/parser.generated.js"), "utf8");
  registrationSpans(helper); // Enforce all four actual emitted registration shapes.
  assert.equal(helper.split("function mdrefineReplaceAttentionRegion(").length, 2);
  return { hashes, sourceHashes, manifestFile, parserFile: "dist/syntax/parser.generated.js" };
}

/**
 * @param {string} root
 * @param {EmphasisBinding} binding
 * @param {EmphasisMutation} [mutation]
 * @returns {Promise<string>}
 */
export async function assertBinding(root, binding, mutation) {
  const canonical = await realpath(root);
  assert(!(await lstat(path.join(canonical, "dist"))).isSymbolicLink());
  inside(canonical, await realpath(path.join(canonical, "dist")));
  const files = await regularFiles(canonical, path.join(canonical, "dist"));
  assert.deepEqual(files, Object.keys(binding.hashes).sort(), "Dist file catalog changed");
  for (const file of files) {
    const expected =
      mutation && file === binding.parserFile ? mutation.mutantHash : binding.hashes[file];
    assert.equal(
      hash(await readFile(path.join(canonical, file))),
      expected,
      `Runtime changed: ${file}`,
    );
  }
  return canonical;
}

/**
 * @param {string} root
 * @param {EmphasisBinding} binding
 * @returns {Promise<void>}
 */
export async function assertSources(root, binding) {
  for (const [file, expected] of Object.entries(binding.sourceHashes))
    assert.equal(hash(await readFile(path.join(root, file))), expected, `Source changed: ${file}`);
}

/**
 * @param {string} source
 * @returns {Record<EmphasisRegistration, EmphasisRegistrationSpan>}
 */
export function registrationSpans(source) {
  const ast = ts.createSourceFile(
    "parser.generated.js",
    source,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(ast.parseDiagnostics.length, 0, "Invalid production JS");
  /** @type {Partial<Record<EmphasisRegistration, EmphasisRegistrationSpan>>} */
  const spans = {};
  let calls = 0;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "mdrefineRegisterHomogeneousResolver"
    ) {
      calls++;
      assert.equal(node.arguments.length, 2);
      const [value, role] = node.arguments;
      assert(ts.isStringLiteral(role));
      /** @type {EmphasisRegistration | undefined} */
      let name;
      if (role.text === "attention" && ts.isExpressionStatement(node.parent)) {
        if (ts.isIdentifier(value)) name = "core";
        else if (ts.isPropertyAccessExpression(value) && value.name.text === "resolveAll")
          name = "cjk";
      } else if (
        ts.isPropertyAssignment(node.parent) &&
        node.parent.name.getText(ast) === "resolveAll"
      ) {
        if (
          role.text === "text" &&
          ts.isCallExpression(value) &&
          ts.isIdentifier(value.expression) &&
          /^createResolver(?:\$\d+)?$/.test(value.expression.text) &&
          value.arguments.length === 0
        )
          name = "text";
        else if (role.text === "strike" && ts.isIdentifier(value)) name = "strike";
      }
      assert(name, `Unreviewed registration shape: ${node.getText(ast)}`);
      assert(!spans[name], `Duplicate ${name} registration`);
      spans[name] = {
        start: node.getStart(ast),
        end: node.end,
        original: source.slice(node.getStart(ast), node.end),
        replacement: source.slice(value.getStart(ast), value.end),
      };
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(calls, 4, "Missing/unexpected emitted registrations");
  assert.deepEqual(Object.keys(spans).sort(), ["cjk", "core", "strike", "text"]);
  assert(spans.core && spans.text && spans.strike && spans.cjk, "Incomplete registration spans");
  return { core: spans.core, text: spans.text, strike: spans.strike, cjk: spans.cjk };
}

/**
 * @param {string} repositoryRoot
 * @param {EmphasisBinding} binding
 * @param {EmphasisRegistration} registration
 * @returns {Promise<EmphasisMutant>}
 */
export async function createRegistrationMutant(repositoryRoot, binding, registration) {
  const sourceRoot = await realpath(repositoryRoot);
  await assertBinding(sourceRoot, binding);
  await assertSources(sourceRoot, binding);
  const folder = await mkdtemp(path.join(tmpdir(), "mdrefine-emphasis-registration-"));
  const owned = await realpath(folder);
  const tempParent = await realpath(tmpdir());
  assert.equal(path.dirname(owned), tempParent);
  const parser = await readFile(path.join(sourceRoot, binding.parserFile), "utf8");
  const span = registrationSpans(parser)[registration];
  assert(span, `Unknown registration ${registration}`);
  const mutant = parser.slice(0, span.start) + span.replacement + parser.slice(span.end);
  const mutation = {
    registration,
    ...span,
    normalHash: hash(parser),
    mutantHash: hash(mutant),
  };
  assert.notEqual(mutation.normalHash, mutation.mutantHash);
  try {
    for (const file of Object.keys(binding.hashes)) {
      const destination = path.resolve(owned, file);
      inside(owned, destination);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(sourceRoot, file), destination);
    }
    await writeFile(path.join(owned, "package.json"), '{"type":"module","private":true}\n', {
      flag: "wx",
    });
    // Resolution-only link: never mutate/chmod anything under node_modules.
    const modules = await realpath(path.join(sourceRoot, "node_modules"));
    const link = path.join(owned, "node_modules");
    await symlink(modules, link, process.platform === "win32" ? "junction" : "dir");
    assert.equal(await realpath(link), modules);
    const target = path.resolve(owned, binding.parserFile);
    inside(owned, target);
    assert(!(await lstat(target)).isSymbolicLink());
    await writeFile(target, mutant);
    await assertBinding(owned, binding, mutation);
    return {
      root: owned,
      mutation,
      async cleanup() {
        assert.equal(await realpath(owned), owned);
        assert.equal(path.dirname(owned), tempParent);
        assert(path.basename(owned).startsWith("mdrefine-emphasis-registration-"));
        // Unlink the owned junction itself before recursive removal; do not
        // enumerate/delete or follow its installed dependency target.
        assert((await lstat(link)).isSymbolicLink());
        assert.equal(await realpath(link), modules);
        await rm(link, { recursive: false });
        await rm(owned, { recursive: true });
      },
    };
  } catch (error) {
    // On setup failure, leave the owned location identifiable for inspection.
    error.message += ` (owned mutant directory retained: ${owned})`;
    throw error;
  }
}

/**
 * @param {EmphasisCoverageRequest} request
 * @returns {Promise<EmphasisCoverageChild>}
 */
export async function runCoverageChild(request) {
  const childFile = fileURLToPath(
    new URL("./parser-emphasis-production-child.mjs", import.meta.url),
  );
  const env = { ...process.env };
  // A fresh child owns its inspector session and has no Vitest/V8 loader or
  // auto-coverage options inherited through the environment.
  for (const key of [
    "NODE_OPTIONS",
    "NODE_V8_COVERAGE",
    "VITEST",
    "VITEST_WORKER_ID",
    "VITEST_POOL_ID",
  ])
    delete env[key];
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [childFile],
      {
        cwd: request.sourceRoot,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && (typeof error.code !== "number" || error.killed || error.signal))
          return reject(error);
        try {
          /** @type {unknown} */
          const parsed = JSON.parse(stdout);
          const result = readEmphasisCoverageReport(parsed);
          assert.equal(result.schema, 1);
          resolve({ code: error?.code ?? 0, result, stderr });
        } catch (parseError) {
          parseError.message += `\nchild stdout: ${stdout}\nchild stderr: ${stderr}`;
          reject(parseError);
        }
      },
    );
    child.stdin.on("error", reject);
    child.stdin.end(JSON.stringify(request));
  });
}

/**
 * @param {string} root
 * @param {EmphasisBinding} binding
 * @returns {Promise<string>}
 */
export async function canonicalParserURL(root, binding) {
  return pathToFileURL(await realpath(path.join(root, binding.parserFile))).href;
}

/** @typedef {{startOffset: number, endOffset: number}} EmphasisFunctionRange */
/** @param {string} source @returns {EmphasisFunctionRange} */
export function successFunctionRange(source) {
  const ast = ts.createSourceFile(
    "parser.generated.js",
    source,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(ast.parseDiagnostics.length, 0);
  /** @type {EmphasisFunctionRange[]} */
  const found = [];
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "mdrefineReplaceAttentionRegion") {
      assert(node.body, "Missing actual success function body");
      found.push({ startOffset: node.getStart(ast), endOffset: node.end });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(found.length, 1, "Missing/ambiguous emitted success function declaration");
  const range = found[0];
  assert(range, "Missing emitted success range");
  return range;
}

/**
 * @param {unknown} initial
 * @param {string} targetURL
 * @param {EmphasisFunctionRange} expectedRange
 * @returns {{catalog: Readonly<{targetURL: string, scriptId: string, functionName: string, startOffset: number, endOffset: number}>, read: (snapshot: unknown) => {calls: number, observation: "script-omitted" | "function-omitted" | "reported"}}}
 */
export function createCoverageDeltaReader(initial, targetURL, expectedRange) {
  const name = "mdrefineReplaceAttentionRegion";
  assert(Number.isSafeInteger(expectedRange?.startOffset) && expectedRange.startOffset >= 0);
  assert(
    Number.isSafeInteger(expectedRange?.endOffset) &&
      expectedRange.endOffset > expectedRange.startOffset,
  );
  const startOffset = expectedRange.startOffset;
  const endOffset = expectedRange.endOffset;
  const validRange = (range) => {
    assert(
      range && Number.isSafeInteger(range.startOffset) && Number.isSafeInteger(range.endOffset),
    );
    assert(range.startOffset >= 0 && range.endOffset > range.startOffset);
    assert(Number.isSafeInteger(range.count) && range.count >= 0, "Invalid V8 call count");
  };
  const sameRange = (range) => range?.startOffset === startOffset && range.endOffset === endOffset;
  const scriptsFor = (snapshot) => {
    assert(snapshot && Array.isArray(snapshot.result), "Missing actual V8 result array");
    const scripts = snapshot.result.filter((script) => script.url === targetURL);
    assert(scripts.length <= 1, "Ambiguous target script in V8 coverage");
    return scripts;
  };
  const find = (script) => {
    assert(Array.isArray(script.functions), "Missing target script function array");
    // A renamed function at the exact established range must not be mistaken
    // for an omitted target; neither may a same-name function at a wrong range.
    const found = script.functions.filter(
      (fn) => fn.functionName === name || sameRange(fn.ranges?.[0]),
    );
    assert(found.length <= 1, "Ambiguous target success function in V8 coverage");
    if (!found.length) return undefined;
    const fn = found[0];
    assert.equal(fn.functionName, name, "Success function renamed at established range");
    assert(Array.isArray(fn.ranges) && fn.ranges.length > 0, "Missing function range");
    const outer = fn.ranges[0];
    validRange(outer);
    assert(sameRange(outer), "Success function range changed");
    for (const range of fn.ranges) {
      validRange(range);
      assert(range.startOffset >= outer.startOffset && range.endOffset <= outer.endOffset);
    }
    // Initial uncalled function can have isBlockCoverage=false; after a real
    // call it can be true with nested ranges. Only its outer range is identity.
    assert.equal(typeof fn.isBlockCoverage, "boolean");
    return outer.count;
  };
  const initialScripts = scriptsFor(initial);
  assert.equal(initialScripts.length, 1, "Initial actual target catalog is missing");
  const scriptId = initialScripts[0].scriptId;
  assert.equal(typeof scriptId, "string");
  assert(scriptId.length > 0);
  assert.notEqual(
    find(initialScripts[0]),
    undefined,
    "Initial actual success function catalog is missing",
  );
  const catalog = Object.freeze({
    targetURL,
    scriptId,
    functionName: name,
    startOffset,
    endOffset,
  });
  return {
    catalog,
    read(snapshot) {
      const scripts = scriptsFor(snapshot);
      if (!scripts.length) return { calls: 0, observation: "script-omitted" };
      assert.equal(
        scripts[0].scriptId,
        scriptId,
        "Target script identity changed during coverage session",
      );
      const calls = find(scripts[0]);
      return calls === undefined
        ? { calls: 0, observation: "function-omitted" }
        : { calls, observation: "reported" };
    },
  };
}
