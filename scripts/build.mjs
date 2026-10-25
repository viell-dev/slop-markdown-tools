import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { buildParser, writeIfChanged } from "./build-parser.mjs";

const defaultRoot = path.resolve(import.meta.dirname, "..");
const slash = (filename) => filename.split(path.sep).join("/");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const parserArtifacts = [
  "syntax/parser.generated.d.ts",
  "syntax/parser.generated.LICENSES.txt",
  "syntax/parser.generated.manifest.json",
  "syntax/parser.generated.js",
];

/** Read an owned tree without following links, including directory junctions.
 * @returns {Promise<string[]>}
 */
export async function ordinaryFiles(directory) {
  const files = [];
  async function visit(current) {
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    assert(!info.isSymbolicLink(), `Build tree contains a link: ${current}`);
    if (info.isDirectory()) {
      for (const entry of (await readdir(current)).sort()) await visit(path.join(current, entry));
    } else {
      assert(info.isFile(), `Build tree contains a non-file: ${current}`);
      files.push(slash(path.relative(directory, current)));
    }
  }
  await visit(directory);
  return files.sort();
}

function configuration(repositoryRoot) {
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(repositoryRoot, "tsconfig.build.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (error) => {
        throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
      },
    },
  );
  assert(config && !config.errors.length, "Invalid build configuration");
  assert.equal(path.resolve(config.options.outDir), path.join(repositoryRoot, "dist"));
  assert.equal(path.resolve(config.options.rootDir), path.join(repositoryRoot, "src"));
  return config;
}

/** The compiler's expected emitted names plus the four separately generated files. */
export function expectedDistFiles(repositoryRoot = defaultRoot) {
  const config = configuration(repositoryRoot);
  const files = config.fileNames.flatMap((filename) =>
    ts.getOutputFileNames(config, filename, !ts.sys.useCaseSensitiveFileNames),
  );
  return [
    ...new Set([
      ...files.map((filename) => slash(path.relative(config.options.outDir, filename))),
      ...parserArtifacts,
    ]),
  ].sort();
}

async function inputSnapshot(repositoryRoot, dependencyInputs = []) {
  const files = [
    ...(await ordinaryFiles(path.join(repositoryRoot, "src"))).map((file) => `src/${file}`),
    ...(await readdir(path.join(repositoryRoot, "scripts")))
      .filter((file) =>
        /^(?:build(?:-parser)?\.mjs|with-build\.mjs|parser-[^/]+\.(?:mjs|json))$/.test(file),
      )
      .map((file) => `scripts/${file}`),
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.build.json",
    ".nvmrc",
    ...dependencyInputs,
  ];
  return hash(
    JSON.stringify(
      await Promise.all(
        [...new Set(files)]
          .sort()
          .map(async (file) => [file, hash(await readFile(path.join(repositoryRoot, file)))]),
      ),
    ),
  );
}

export async function assertDistFiles(repositoryRoot = defaultRoot, actual) {
  assert.deepEqual(
    actual ?? (await ordinaryFiles(path.join(repositoryRoot, "dist"))),
    expectedDistFiles(repositoryRoot),
    "Build output differs from current source; run npm run build",
  );
}

function activeWriterTemporary(file) {
  const match = /(?:^|\/)\.[^/]+\.([1-9]\d*)\.[0-9a-f-]{36}\.tmp$/.exec(file);
  if (!match) return false;
  try {
    process.kill(Number(match[1]), 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function outputSnapshot(repositoryRoot, producing = false) {
  const files = (await ordinaryFiles(path.join(repositoryRoot, "dist"))).filter(
    (file) => !producing || !activeWriterTemporary(file),
  );
  await assertDistFiles(repositoryRoot, files);
  return treeSnapshot(path.join(repositoryRoot, "dist"), files);
}

async function treeSnapshot(directory, files) {
  return hash(
    JSON.stringify(
      await Promise.all(
        files.map(async (file) => [file, hash(await readFile(path.join(directory, file)))]),
      ),
    ),
  );
}

/** Fresh preparation; no durable cache, and no recursive deletion of live output. */
export async function buildProduct(repositoryRoot = defaultRoot) {
  repositoryRoot = await realpath(repositoryRoot);
  const before = await inputSnapshot(repositoryRoot);
  // Check the complete live tree before any publication or pruning can follow a link.
  await ordinaryFiles(path.join(repositoryRoot, "dist"));
  // Keep the same depth as dist so TypeScript's relative source-map paths stay
  // correct after publication. Each invocation owns exactly one staging tree.
  const staging = await mkdtemp(path.join(repositoryRoot, ".mdrefine-build-"));
  try {
    const parser = await buildParser({
      repositoryRoot,
      outputDirectory: path.join(staging, "syntax"),
    });
    const require = createRequire(path.join(repositoryRoot, "package.json"));
    const compiler = require.resolve("typescript/bin/tsc");
    const compilerInputs = [
      compiler,
      path.join(path.dirname(compiler), "../lib/_tsc.js"),
      path.join(path.dirname(compiler), "../package.json"),
    ];
    const dependencyHashes = [
      ...parser.inputHashes,
      ...(await Promise.all(
        compilerInputs.map(async (file) => [file, hash(await readFile(file))]),
      )),
    ];
    execFileSync(process.execPath, [compiler, "-p", "tsconfig.build.json", "--outDir", staging], {
      cwd: repositoryRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    const expected = expectedDistFiles(repositoryRoot);
    assert.deepEqual(await ordinaryFiles(staging), expected, "Unexpected staged build output");
    const stagedOutputs = await treeSnapshot(staging, expected);
    for (const [file, digest] of dependencyHashes)
      assert.equal(
        hash(await readFile(file)),
        digest,
        "Installed build input changed during preparation",
      );
    assert.equal(
      await inputSnapshot(repositoryRoot),
      before,
      "Build inputs changed during preparation",
    );
    const dependencies = [
      ...new Set(
        [...parser.inputFiles, ...compilerInputs].map((file) =>
          slash(path.relative(repositoryRoot, file)),
        ),
      ),
    ].sort();
    const inputs = await inputSnapshot(repositoryRoot, dependencies);
    const existing = await ordinaryFiles(path.join(repositoryRoot, "dist"));
    for (const file of existing) {
      // Another deterministic parser writer owns these temporary files. Never
      // remove them; a consumer waits for all writers before verifying output.
      if (!expected.includes(file) && !activeWriterTemporary(file))
        await rm(path.join(repositoryRoot, "dist", file), { force: true });
    }
    // Individual replacements are atomic; the directory as a whole is not.
    // Publish the runtime last, after its companions and product files.
    const runtime = "syntax/parser.generated.js";
    for (const file of [...expected.filter((file) => file !== runtime), runtime])
      await writeIfChanged(
        path.join(repositoryRoot, "dist", file),
        await readFile(path.join(staging, file), "utf8"),
      );
    const outputs = await outputSnapshot(repositoryRoot, true);
    assert.equal(outputs, stagedOutputs, "Published output differs from this build's staged bytes");
    assert.equal(
      await inputSnapshot(repositoryRoot, dependencies),
      inputs,
      "Build inputs changed during publication",
    );
    return {
      schemaVersion: 1,
      repositoryRoot,
      node: process.version,
      dependencies,
      inputs,
      outputs,
    };
  } finally {
    const resolved = await realpath(staging);
    assert.equal(path.dirname(resolved), repositoryRoot, "Unsafe build staging cleanup");
    assert(path.basename(resolved).startsWith(".mdrefine-build-"));
    await ordinaryFiles(resolved);
    await rm(resolved, { recursive: true, force: true });
  }
}

/** Internal consumers require the live orchestrator's exact build identity. */
export async function verifyBuild(repositoryRoot = defaultRoot) {
  const receipt = process.env.MDREFINE_BUILD_RECEIPT;
  assert(
    receipt,
    "Missing build context; use the standalone npm command or scripts/with-build.mjs",
  );
  const context = JSON.parse(await readFile(receipt, "utf8"));
  assert.equal(context.schemaVersion, 1);
  assert.equal(
    context.repositoryRoot,
    await realpath(repositoryRoot),
    "Build belongs to another checkout",
  );
  assert.equal(context.node, process.version, "Build belongs to another Node.js version");
  process.kill(context.ownerPid, 0);
  assert.equal(
    await inputSnapshot(context.repositoryRoot, context.dependencies),
    context.inputs,
    "Build inputs changed; start a fresh standalone command",
  );
  assert.equal(
    await outputSnapshot(context.repositoryRoot),
    context.outputs,
    "Build output changed; start a fresh standalone command",
  );
  return context;
}

if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  await buildProduct();
  process.stdout.write("Product build ready (fresh staged output).\n");
}
