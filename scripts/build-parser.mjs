import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { rolldown } from "rolldown";
import { repairReviewedParserSource, sourceGuards } from "./parser-patches.mjs";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const defaultRoot = path.dirname(scriptDirectory);
const names = {
  runtime: "parser.generated.js",
  declaration: "parser.generated.d.ts",
  manifest: "parser.generated.manifest.json",
  licenses: "parser.generated.LICENSES.txt",
};
const expectedExports = [
  "cjkFriendlyExtension",
  "fromMarkdown",
  "gfm",
  "gfmAutolinkLiteral",
  "gfmStrikethrough",
];
const expectedImporters = [
  "micromark-core-commonmark/lib/setext-underline.js",
  "micromark/lib/initialize/document.js",
  "micromark/lib/initialize/text.js",
];
const entrySource = `export { fromMarkdown } from "mdast-util-from-markdown";
export { gfm } from "micromark-extension-gfm";
export { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
export { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
export { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
`;
const provenance = {
  editMap: "micromark/micromark#249: retain the untouched event prefix",
  footnote: "mdrefine#280: include GFM footnote indentation in list-tail scanning",
  text: "micromark/micromark#233 and #238: compact adjacent data events",
  code: "micromark/micromark#238: compact code-span data without changing padding",
  attention:
    "micromark/micromark#239 walked prefix; local exact-state opener groups and original-resolver compatibility",
  autolink:
    "micromark-extension-gfm-autolink-literal#14: guard cached jumps by index, token identity, label type and current unbalanced state before jumping; keep the positive cache private in a WeakMap",
  strike:
    "local walked-prefix and equal-length opener groups; retain original-resolver compatibility",
  cjk: "retain CJK tokenization and original resolver; share the local fast attention resolver",
};

const hash = (text) => createHash("sha256").update(text).digest("hex");
const slash = (filename) => filename.replaceAll("\\", "/");
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const virtualRegions = new Map([
  ["mdrefine:entry", "mdrefine:entry"],
  ["mdrefine:edit-map", "mdrefine:edit-map"],
  // Rolldown 1.2.14 emits this helper even when it is absent from chunk.modules.
  ["\0rolldown/runtime.js", "\\0rolldown/runtime.js"],
]);

/**
 * Check Rolldown's physical-path output channel against the reviewed graph.
 * Source URLs, banners and ordinary string contents are not path provenance.
 * @param {string} code
 * @param {ReadonlySet<string>} graphLabels
 */
export function assertPortableRegions(code, graphLabels) {
  let regions = 0;
  for (const match of code.matchAll(/^\/\/#region([^\r\n]*)/gm)) {
    assert(match[1].startsWith(" "), "Malformed parser region header");
    const label = match[1].slice(1);
    assert(label, "Missing parser region label");
    if (![...virtualRegions.values()].includes(label)) {
      assert(
        !path.posix.isAbsolute(label) &&
          !path.win32.isAbsolute(label) &&
          !/^[a-z]:/i.test(label) &&
          !label.includes("\\") &&
          !label.includes(":") &&
          label.split("/").every((part) => part && part !== "." && part !== ".."),
        `Nonportable parser region label: ${label}`,
      );
    }
    assert(graphLabels.has(label), `Unexpected parser region label: ${label}`);
    regions++;
  }
  assert(regions, "Missing parser region headers");
}

/** @param {string} filename */
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
    if (parent === directory) throw new Error(`Cannot identify the package containing ${filename}`);
    directory = parent;
  }
}

function productionEntry(root) {
  let exported = root.metadata.exports?.["."] ?? root.metadata.exports;
  if (typeof exported !== "string") exported = exported?.default;
  assert.equal(
    typeof exported,
    "string",
    `Missing reviewed production export in ${root.metadata.name}`,
  );
  return path.resolve(root.directory, exported);
}

async function identifyInput(filename) {
  const root = await packageForFile(filename);
  const relative = slash(path.relative(root.directory, filename));
  assert(relative && !relative.startsWith("../") && !path.isAbsolute(relative));
  assert(!relative.startsWith("dev/"), "Unexpected development parser input");
  return {
    root,
    input: {
      file: `${root.metadata.name}@${root.metadata.version}/${relative}`,
      sha256: hash(await readFile(filename)),
    },
  };
}

async function correctSource(kind, source, filename) {
  const root = await packageForFile(filename);
  const corrected = repairReviewedParserSource(kind, source, root.metadata);
  return {
    root,
    source: `/*! mdrefine parser adaptation: ${provenance[kind]}. See ${names.licenses}. */\n${corrected}`,
  };
}

async function readLicense(root) {
  // Read actual entry casing before opening a path: Windows otherwise accepts
  // "license" for an upstream "LICENSE" and records different provenance.
  const entries = new Set(await readdir(root.directory));
  for (const filename of ["license", "LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    if (!entries.has(filename)) continue;
    try {
      const original = await readFile(path.join(root.directory, filename), "utf8");
      // Preserve the actual upstream text, including its line endings, so each
      // packed section can be checked against the reviewed source-file hash.
      return { filename, hash: hash(original), text: original };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Missing bundled license text for ${root.metadata.name}`);
}

/**
 * Generate the complete adapter and its distribution metadata in memory.
 * The graph, source guards and licenses are checked before any output is written.
 * @param {{ repositoryRoot?: string }} [options]
 */
export async function bundleParser(options = {}) {
  const repositoryRoot = await realpath(path.resolve(options.repositoryRoot ?? defaultRoot));
  const resolveFromRoot = createRequire(path.join(repositoryRoot, "package.json"));
  const bundlerRoot = await packageForFile(resolveFromRoot.resolve("rolldown"));
  assert.equal(bundlerRoot.metadata.version, "1.2.14", "Review changed parser bundler");
  const factories = new Map();
  for (const name of [
    "mdast-util-from-markdown",
    "micromark-extension-gfm",
    "micromark-extension-gfm-autolink-literal",
    "micromark-extension-gfm-strikethrough",
    "micromark-extension-cjk-friendly",
  ]) {
    factories.set(name, productionEntry(await packageForFile(resolveFromRoot.resolve(name))));
  }
  const micromarkRoot = await packageForFile(
    createRequire(factories.get("mdast-util-from-markdown")).resolve("micromark"),
  );
  const coreRoot = await packageForFile(
    createRequire(productionEntry(micromarkRoot)).resolve("micromark-core-commonmark"),
  );
  const coreAttention = path.join(coreRoot.directory, "lib", "attention.js");
  /** @typedef {Awaited<ReturnType<typeof correctSource>> & { kind: keyof typeof sourceGuards, filename: string }} Correction */
  /** @type {Map<string, Correction>} */
  const transformed = new Map();
  /** @type {Map<string, Correction>} */
  const redirected = new Map();
  const editMapImporters = [];
  const counts = new Map();
  const bundle = await rolldown({
    cwd: repositoryRoot,
    input: "mdrefine:entry",
    platform: "neutral",
    resolve: { conditionNames: ["import", "default"] },
    plugins: [
      {
        name: "mdrefine-reviewed-parser-corrections",
        async resolveId(source, importer) {
          if (source === "mdrefine:entry") return source;
          if (source === "mdrefine:core-attention") return coreAttention;
          if (importer === "mdrefine:entry" && factories.has(source)) return factories.get(source);
          if (source !== "micromark-util-edit-map") return;
          assert(importer && path.isAbsolute(importer));
          const root = await packageForFile(createRequire(importer).resolve(source));
          const filename = path.join(root.directory, "index.js");
          const correction = await correctSource(
            "editMap",
            await readFile(filename, "utf8"),
            filename,
          );
          const previous = redirected.get(filename);
          if (previous) assert.equal(previous.source, correction.source);
          redirected.set(filename, { kind: "editMap", filename, ...correction });
          // Record logical package identity, independently of hoisted/pnpm physical locations.
          const parent = await packageForFile(importer);
          editMapImporters.push(
            `${parent.metadata.name}/${slash(path.relative(parent.directory, importer))}`,
          );
          return "mdrefine:edit-map";
        },
        load(id) {
          if (id === "mdrefine:entry") return entrySource;
          if (id !== "mdrefine:edit-map") return;
          assert.equal(redirected.size, 1, "Review unexpected EditMap dependency copies");
          return [...redirected.values()][0].source;
        },
        async transform(source, id) {
          for (const [kind, guard] of Object.entries(sourceGuards)) {
            if (kind === "editMap" || !slash(id).endsWith(`/${guard.name}/${guard.relative}`))
              continue;
            const correction = await correctSource(kind, source, id);
            counts.set(kind, (counts.get(kind) ?? 0) + 1);
            transformed.set(id, { kind, filename: id, ...correction });
            return correction.source;
          }
        },
      },
    ],
  });
  try {
    const generated = await bundle.generate({
      format: "esm",
      comments: true,
      banner: `/*! Generated by scripts/build-parser.mjs. Local corrections: ${names.manifest}. Bundled MIT notices: ${names.licenses}. */`,
    });
    assert.equal(generated.output.length, 1);
    const chunk = generated.output[0];
    assert.equal(chunk.type, "chunk");
    assert.deepEqual(chunk.imports, []);
    assert.deepEqual(chunk.dynamicImports, []);
    assert.deepEqual([...chunk.exports].sort(compare), expectedExports);
    assert.deepEqual(Object.fromEntries([...counts].sort(([a], [b]) => compare(a, b))), {
      attention: 1,
      autolink: 1,
      cjk: 1,
      code: 1,
      footnote: 1,
      strike: 1,
      text: 1,
    });
    assert.equal(redirected.size, 1);
    assert.equal(transformed.size, 7);
    assert.deepEqual(editMapImporters.sort(compare), expectedImporters);

    const modules = Object.keys(chunk.modules);
    assert(modules.includes("mdrefine:edit-map"));

    assert(!modules.some((id) => id.startsWith("node:")));
    assert.equal(modules.length, 78, "Review changed parser module graph");
    const physicalModules = new Set(modules.filter((id) => path.isAbsolute(id)));
    for (const id of modules) {
      assert(
        physicalModules.has(id) || virtualRegions.has(id),
        `Unexpected parser virtual module: ${id}`,
      );
    }
    const regionLabels = new Set(virtualRegions.values());
    const roots = new Map();
    /** @type {Map<string, { file: string, sha256: string }>} */
    const inputs = new Map();
    for (const filename of [...physicalModules, ...redirected.keys()]) {
      const canonical = await realpath(filename);
      const relative = path.relative(repositoryRoot, canonical);
      assert(
        relative &&
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative),
        "Parser graph input resolves outside the repository root; install its dependencies inside the checkout",
      );
      const { root, input } = await identifyInput(canonical);
      if (physicalModules.has(filename)) {
        // Redirected EditMap remains a licensed source input, not an emitted module.
        assert.notEqual(
          root.metadata.name,
          "micromark-util-edit-map",
          "Unadapted EditMap remains in parser graph",
        );
        regionLabels.add(slash(relative));
      }
      const previous = inputs.get(input.file);
      if (previous)
        assert.equal(previous.sha256, input.sha256, `Different sources share ${input.file}`);
      inputs.set(input.file, input);
      roots.set(root.directory, root);
    }
    const packages = [];
    const licenseSections = [];
    for (const root of roots.values()) {
      assert.equal(root.metadata.license, "MIT", `Review changed license: ${root.metadata.name}`);
      const license = await readLicense(root);
      packages.push({
        name: root.metadata.name,
        version: root.metadata.version,
        license: root.metadata.license,
        licenseFile: license.filename,
        licenseSha256: license.hash,
      });
      licenseSections.push({
        id: `${root.metadata.name}@${root.metadata.version}`,
        text: license.text,
      });
    }
    packages.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
    const expectedPackages = JSON.parse(
      await readFile(new URL("parser-packages.json", import.meta.url), "utf8"),
    );
    expectedPackages.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
    assert.deepEqual(packages, expectedPackages, "Review changed parser package/license graph");
    assert.equal(packages.length, 34);
    assertPortableRegions(chunk.code, regionLabels);

    const localSources = [];
    for (const [file, url] of [
      ["scripts/build-parser.mjs", new URL(import.meta.url)],
      ["scripts/parser-patches.mjs", new URL("parser-patches.mjs", import.meta.url)],
      ["scripts/parser-packages.json", new URL("parser-packages.json", import.meta.url)],
      [
        "src/syntax/parser.generated.d.ts",
        new URL("../src/syntax/parser.generated.d.ts", import.meta.url),
      ],
    ]) {
      localSources.push({ file, sha256: hash(await readFile(url)) });
    }
    const patches = [...redirected.values(), ...transformed.values()]
      .map(({ kind, source }) => ({
        kind,
        file: `${sourceGuards[kind].name}@${sourceGuards[kind].version}/${sourceGuards[kind].relative}`,
        originalSha256: sourceGuards[kind].hash,
        correctedSha256: hash(source),
        provenance: provenance[kind],
      }))
      .sort((a, b) => compare(a.kind, b.kind));
    const licenses = [
      "mdrefine internal parser adapter: bundled third-party MIT licenses\n",
      ...licenseSections
        .sort((a, b) => compare(a.id, b.id))
        .map(
          ({ id, text }) =>
            `------------------------------------------------------------------------\n${id}\n------------------------------------------------------------------------\n\n${text}${text.endsWith("\n") ? "" : "\n"}`,
        ),
    ].join("\n");
    const declaration = await readFile(
      new URL("../src/syntax/parser.generated.d.ts", import.meta.url),
      "utf8",
    );
    const manifest = {
      schemaVersion: 1,
      bundler: { name: "rolldown", version: bundlerRoot.metadata.version },
      resolution: { platform: "neutral", conditions: ["import", "default"] },
      exports: expectedExports,
      runtimeSha256: hash(chunk.code),
      declarationSha256: hash(declaration),
      licensesSha256: hash(licenses),
      moduleCount: modules.length,
      editMapImporters: expectedImporters,
      transformCounts: Object.fromEntries([...counts].sort(([a], [b]) => compare(a, b))),
      localSources,
      inputs: [...inputs.values()].sort((a, b) => compare(a.file, b.file)),
      patches,
      packages,
    };
    return { code: chunk.code, declaration, licenses, manifest };
  } finally {
    await bundle.close();
  }
}

/** @param {string} filename @param {string} contents */
async function hasContents(filename, contents) {
  try {
    return (await readFile(filename, "utf8")) === contents;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Replace one complete artifact atomically, retaining its timestamp when unchanged.
 * Each builder owns its temporary file; concurrent deterministic builders can replace
 * the same destination safely. Publication callers must await the full build.
 * @param {string} filename
 * @param {string} contents
 */
async function writeIfChanged(filename, contents) {
  if (await hasContents(filename, contents)) return false;
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  );
  const temporaryFile = await open(temporary, "wx");
  try {
    try {
      await temporaryFile.writeFile(contents);
    } finally {
      await temporaryFile.close();
    }
    if (await hasContents(filename, contents)) return false;
    try {
      await rename(temporary, filename);
      return true;
    } catch (error) {
      // Windows can reject a concurrent replacement after another builder won.
      // Accept only the exact complete artifact; never delete or copy over it.
      if (
        ["EPERM", "EACCES", "EEXIST"].includes(error.code) &&
        (await hasContents(filename, contents))
      ) {
        return false;
      }
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Shared production/Vitest builder. Importing this module never writes output.
 * @param {{ repositoryRoot?: string, outputDirectory?: string }} [options]
 */
export async function buildParser(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRoot);
  const outputDirectory = path.resolve(
    options.outputDirectory ?? path.join(repositoryRoot, "dist", "syntax"),
  );
  const result = await bundleParser({ repositoryRoot });
  /** @type {Array<[string, string]>} */
  const artifacts = [
    [names.declaration, result.declaration],
    [names.licenses, result.licenses],
    [names.manifest, `${JSON.stringify(result.manifest, null, 2)}\n`],
    // Publish the runtime only after its companions are complete.
    [names.runtime, result.code],
  ];
  /** @type {string[]} */
  const changed = [];
  for (const [name, contents] of artifacts) {
    if (await writeIfChanged(path.join(outputDirectory, name), contents)) changed.push(name);
  }
  return { outputDirectory, changed, manifest: result.manifest };
}

async function invokedAsMain() {
  if (!process.argv[1]) return false;
  const scriptPath = await realpath(fileURLToPath(import.meta.url));
  try {
    return (await realpath(process.argv[1])) === scriptPath;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

if (await invokedAsMain()) {
  buildParser().then(
    ({ changed }) =>
      process.stdout.write(`Parser adapter ready (${changed.length} artifacts changed).\n`),
    (error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    },
  );
}
