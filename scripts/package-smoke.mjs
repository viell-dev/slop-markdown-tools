import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  copyFile,
  lstat,
  readFile,
  realpath,
  rename,
  writeFile,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import assert from "node:assert/strict";
import { assertDistFiles, verifyBuild } from "./build.mjs";

// Only an invocation-owned, unchanged build may bypass prepack. Consumer
// installations below still use the actual tarball, never the checkout tree.
await verifyBuild();

const npm = process.env.npm_execpath;
assert(npm, "Run this check through npm run test:package.");
/**
 * The pnpm that installs the package in a strict layout, where each package
 * sees only the dependencies that it declares. npm fetches it into the
 * repository's cache, so nothing is installed globally.
 */
const pnpm = "pnpm@12.14.0";
const directory = await realpath(await mkdtemp(path.join(tmpdir(), "mdrefine-package-")));
const repository = await realpath(process.cwd());
const relativeDirectory = path.relative(repository, directory);
assert(
  path.isAbsolute(relativeDirectory) || relativeDirectory.startsWith(`..${path.sep}`),
  "Installed consumers must be outside the checkout's dependency lookup tree",
);
// In particular, require() must not recover undeclared checkout dependencies
// through a caller's Node.js search-path override.
const consumerEnvironment = { ...process.env, NODE_PATH: "" };
const cache = path.join(repository, ".npm-cache");
const manifest = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
const named = (entry = "") => JSON.stringify(`${manifest.name}${entry}`);
function runNpm(args, cwd = repository, input) {
  return execFileSync(process.execPath, [npm, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: consumerEnvironment,
  });
}
function runNode(args, cwd, input) {
  return execFileSync(process.execPath, args, {
    cwd,
    input,
    encoding: "utf8",
    env: consumerEnvironment,
  });
}
/** A TypeScript consumer of the published types, as an ES module. */
const consumerModule = `import {
  builtInRules, configSchema, format, lint, parse, presets, resolveConfig, unifiedDiff,
  type Config, type Dialect, type JsonSchema, type Plugin, type ProcessOptions, type WikiLink, type FormatResult, type CodeFormatter,
} from ${named()};
import { discoverWorkspace, formatWithCode, type DiscoverOptions, type Skipped, type WorkspaceDiscovery, type CodeFormatOptions } from ${named("/node")};
const schema: JsonSchema = { type: "object", properties: { level: { type: "integer" } } };
const plugin: Plugin = { name: "consumer", rules: { sample: {
  description: "Exercise the public types", kind: "problem", schema,
  check: ({ document }) => document.tree.children.length ? [] : [{ start: 0, message: "Empty" }],
} }, syntax: {
  micromark: { text: { [0x25]: { tokenize(effects, ok, nok) {
    return code => {
      if (code !== 0x25) return nok(code);
      effects.enter("data"); effects.consume(code); effects.exit("data");
      return ok;
    };
  } } } },
  mdast: { transforms: [tree => tree] },
} };
// Settings written as constants are read-only, which a configuration may be.
const config = {
  $schema: "./node_modules/mdrefine/config.schema.json",
  extends: "recommended",
  rules: { "style/wrap": ["warn"], "consumer/sample": ["error", { level: 1 }] },
} as const satisfies Config;
const options: ProcessOptions = { config, plugins: [plugin], defaultDialect: "obsidian" };
const output: string = format("Text", options).output;
const patch: string = unifiedDiff("a/note.md", "b/note.md", "Text", output); void patch;
const assumed: Dialect = resolveConfig({ ...options, defaultDialect: "codeberg" }).dialect; void assumed;
void lint(output, { config: presets.github });
void parse("100%", "github", "plugin.md", [plugin]);
// @ts-expect-error The tables that every caller shares are read-only.
builtInRules["style/wrap"] = builtInRules["style/emphasis"]!;
void configSchema.properties;
const discoverOptions: DiscoverOptions = { root: ".", inputs: [], documents: { "a.md": "Text" } };
const discovery: WorkspaceDiscovery = await discoverWorkspace(discoverOptions);
const skipped: readonly Skipped[] = discovery.skipped; void skipped;
const prepared: ProcessOptions = discovery.options("a.md"); void prepared;
const codeTool: CodeFormatter = { id: "javascript", languages: ["js"], command: "formatter", args: [] };
const codeOptions: CodeFormatOptions = { config: { codeFormatters: [codeTool] }, cwd: "." };
const codeResult: Promise<FormatResult> = formatWithCode("Text", codeOptions); void codeResult;
for (const node of parse(output, "obsidian").tree.children) {
  if (node.type === "paragraph") for (const child of node.children) {
    if (child.type === "wikiLink") { const link: WikiLink = child; const target: string = link.target; void target; }
  }
}
`;
/** The same package from a CommonJS module, whose imports become require() calls. */
const consumerCommonJs = `import { format, unifiedDiff, type Config } from ${named()};
import { discoverWorkspace, formatWithCode } from ${named("/node")};
const config: Config = { extends: ["recommended"] };
const output: string = format("Text", { config }).output;
const patch: string = unifiedDiff("a/note.md", "b/note.md", "Text", output);
void output; void discoverWorkspace; void patch; void formatWithCode;
`;
/** What every installation of the package must do, whatever its layout. */
async function checkInstalled(project) {
  for (const mode of ["module", "commonjs"]) {
    const parserLoad =
      mode === "module"
        ? `import { parse } from ${named()};`
        : `const { parse } = require(${named()});`;
    // GFM bundles table/task-list tokenizers; VitePress imports those two
    // packages directly. Exercise both with builtin and external syntax.
    const source =
      "| A | B |\n| - | - |\n| a | b |\n\n- [x] Done\n\n~~gone~~ www.example.com [^a]\n\n[^a]: Note\n";
    runNode(
      [
        `--input-type=${mode}`,
        "-e",
        `${parserLoad}
const assert = ${mode === "module" ? '(await import("node:assert/strict")).default' : 'require("node:assert/strict")'};
for (const dialect of ["github", "vitepress"]) for (const external of [false, true]) {
  let transformed = false;
  const plugins = external ? [{name:"consumer", syntax:{micromark:{}, mdast:{transforms:[tree => {transformed=true; return tree;}]}}}] : [];
  const document = parse(${JSON.stringify(source)}, dialect, "consumer.md", plugins);
  const nodes = [];
  const visit = node => { nodes.push(node); for (const child of node.children ?? []) visit(child); };
  visit(document.tree);
  for (const type of ["table", "delete", "link", "footnoteDefinition", "footnoteReference"])
    assert(nodes.some(node => node.type === type), dialect + ": " + type);
  assert(nodes.some(node => node.type === "listItem" && node.checked === true));
  assert.equal(transformed, external);
  if (dialect === "vitepress") {
    const cjk = parse("中文**字。**", dialect, "cjk.md", plugins).tree.children[0];
    assert(cjk.children.some(node => node.type === "strong"));
  }
}`,
      ],
      project,
    );
    const load =
      mode === "module"
        ? `import { unifiedDiff } from ${named()};`
        : `const { unifiedDiff } = require(${named()});`;
    assert.equal(
      runNode(
        [
          `--input-type=${mode}`,
          "-e",
          `${load} process.stdout.write(unifiedDiff("a/note.md", "b/note.md", "before\\n", "after\\n"));`,
        ],
        project,
      ),
      `${"=".repeat(67)}\n--- a/note.md\n+++ b/note.md\n@@ -1,1 +1,1 @@\n-before\n+after\n`,
    );
    const workspaceLoad =
      mode === "module"
        ? `import { createWorkspace } from ${named()};`
        : `const { createWorkspace } = require(${named()});`;
    const target = "---\ntitle: |\n  ```js\n---\n# Body\n";
    assert.equal(
      runNode(
        [
          `--input-type=${mode}`,
          "-e",
          `${workspaceLoad}
const workspace = createWorkspace({"Target.md": ${JSON.stringify(target)}});
process.stdout.write(JSON.stringify(["github", "commonmark"].map(dialect =>
  workspace.resolve("From.md", "Target.md#body", dialect).fragmentExists)));`,
        ],
        project,
      ),
      "[true,false]",
    );
  }
  assert.equal(
    runNode(
      [
        "--input-type=module",
        "-e",
        `import {format} from ${named()}; process.stdout.write(format("A *small* note.\\n").output);`,
      ],
      project,
    ),
    "A _small_ note.\n",
  );
  // CommonJS loads the ES modules with require(), and the JSON files that the package exports.
  assert.equal(
    runNode(
      [
        "--input-type=commonjs",
        "-e",
        `const {format} = require(${named()}); const {discoverWorkspace,formatWithCode} = require(${named("/node")});
const schema = require(${named("/config.schema.json")}); const {version} = require(${named("/package.json")});
process.stdout.write([format("A *small* note.\\n").output.trim(), typeof discoverWorkspace, typeof formatWithCode, schema.title, version].join("|"));`,
      ],
      project,
    ),
    `A _small_ note.|function|function|mdrefine configuration|${manifest.version}`,
  );
  // The filesystem entry discovers the consumer's own documents.
  await writeFile(path.join(project, "note.md"), "A *small* note.\n");
  assert.equal(
    runNode(
      [
        "--input-type=module",
        "-e",
        `import {format} from ${named()}; import {discoverWorkspace} from ${named("/node")};
const d = await discoverWorkspace({root: ".", inputs: ["note.md"]});
process.stdout.write(d.selected.join(",") + ":" + format(d.read("note.md"), d.options("note.md")).output);`,
      ],
      project,
    ),
    "note.md:A _small_ note.\n",
  );
  // A configured command runs through the installed Node entry, including its
  // runtime process-spawning dependencies in pnpm's strict layout.
  await writeFile(
    path.join(project, "formatter.mjs"),
    'import process from "node:process"; process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("const x = 1;\\n"));\n',
  );
  const fence = "`".repeat(3);
  const codeSource = `${fence}js\nconst x=1\n${fence}\n`;
  assert.equal(
    runNode(
      [
        "--input-type=module",
        "-e",
        `import {formatWithCode} from ${named("/node")};
const result = await formatWithCode(${JSON.stringify(codeSource)}, {cwd:process.cwd(), config:{extends:[],codeFormatters:[{id:"probe",languages:["js"],command:process.execPath,args:["./formatter.mjs"]}]}});
if(result.diagnostics.length) throw new Error(JSON.stringify(result.diagnostics));
process.stdout.write(result.output);`,
      ],
      project,
    ),
    `${fence}js\nconst x = 1;\n${fence}\n`,
  );
  // The command finds its own dependencies from where it is installed.
  const command = path.join(project, "node_modules", manifest.name, manifest.bin.mdrefine);
  assert.equal(
    runNode([command, "format", "-", "--root", project], project, "A *small* note.\n"),
    "A _small_ note.\n",
  );
  for (const suffix of process.platform === "win32" ? ["", ".cmd", ".ps1"] : [""])
    await assert.rejects(lstat(path.join(project, "node_modules/.bin", `mdtools${suffix}`)), {
      code: "ENOENT",
    });
  await writeFile(path.join(project, "consumer.mts"), consumerModule);
  await writeFile(path.join(project, "consumer.cts"), consumerCommonJs);
  execFileSync(
    process.execPath,
    [
      path.join(repository, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--exactOptionalPropertyTypes",
      "--module",
      "NodeNext",
      "--target",
      "ES2023",
      "consumer.mts",
      "consumer.cts",
      // This artifact is internal, but it ships. Check it explicitly so public
      // declarations cannot hide a dangling build-only type forward.
      await realpath(
        path.join(project, "node_modules", manifest.name, "dist/syntax/parser.generated.d.ts"),
      ),
    ],
    { cwd: project, stdio: "inherit", env: consumerEnvironment },
  );
}
try {
  const packed = JSON.parse(
    runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory]),
  );
  // npm 12 keys results by package name; earlier npm versions return an array.
  const result = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  await assertDistFiles(
    repository,
    result.files
      .filter((file) => file.path.startsWith("dist/"))
      .map((file) => file.path.slice("dist/".length))
      .sort(),
  );
  assert(
    result.files.every(
      (file) => !file.path.includes("mdtools") && !/^dist\/cli\/deprecations\./.test(file.path),
    ),
    "Retired naming files must not ship; build from a clean checkout after source removal",
  );
  assert(
    result.files.every((file) =>
      /^(dist\/|docs\/[^/]+\.md$|examples\/|(?:README|CHANGELOG|CODE_OF_CONDUCT|CONTRIBUTING|SECURITY)\.md$|LICENSE$|THIRD_PARTY_NOTICES$|config\.schema\.json$|package\.json$)/.test(
        file.path,
      ),
    ),
  );
  for (const required of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/syntax/parser.generated.js",
    "dist/syntax/parser.generated.d.ts",
    "dist/syntax/parser.generated.manifest.json",
    "dist/syntax/parser.generated.LICENSES.txt",
    "dist/node.js",
    "dist/node.d.ts",
    "dist/cli/main.js",
    "config.schema.json",
    "LICENSE",
    "THIRD_PARTY_NOTICES",
    "README.md",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "examples/README.md",
    "examples/workspaces/obsidian-vault/before/.obsidian/app.json",
  ])
    assert(
      result.files.some((file) => file.path === required),
      `Missing packed file: ${required}`,
    );
  const tarball = path.join(directory, result.filename);

  // npm's layout, where dependencies of dependencies are hoisted next to them.
  const hoisted = path.join(directory, "npm");
  await mkdir(hoisted);
  await writeFile(
    path.join(hoisted, "package.json"),
    JSON.stringify({ private: true, type: "module", scripts: { cli: "mdrefine" } }),
  );
  runNpm(
    ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache],
    hoisted,
  );
  const installed = path.join(hoisted, "node_modules", manifest.name);
  const metadata = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  assert.equal(metadata.version, manifest.version);
  assert.deepEqual(metadata.bin, { mdrefine: "dist/cli/main.js" });
  assert(
    (await readFile(path.join(installed, metadata.bin.mdrefine), "utf8")).startsWith(
      "#!/usr/bin/env node\n",
    ),
  );
  // npm scripts exercise the actual installed .bin shim on Windows and POSIX.
  assert.equal(
    runNpm(["run", "--silent", "cli", "--", "--version"], hoisted).trim(),
    manifest.version,
  );
  assert.equal(
    runNpm(["exec", "--no", "--", "mdrefine", "--version"], hoisted).trim(),
    manifest.version,
  );
  assert.equal(
    runNpm(
      ["run", "--silent", "cli", "--", "format", "-", "--root", hoisted],
      hoisted,
      "A *small* note.\n",
    ),
    "A _small_ note.\n",
  );
  // A shipped example imports the package by name from inside the installed package.
  assert.equal(
    runNode([path.join(installed, "examples", "library", "format-string.mjs")], hoisted),
    "A _short_ note with **strong** words and\nno final newline.\n\nchanged: true; remaining diagnostics: 0\n",
  );
  await checkInstalled(hoisted);

  // pnpm's layout without hoisting: a dependency that the package uses, its
  // type declarations included, must be one that it declares.
  const strict = path.join(directory, "pnpm");
  await mkdir(strict);
  await writeFile(
    path.join(strict, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { [manifest.name]: `file:../${result.filename}` },
    }),
  );
  runNpm(
    [
      "exec",
      "--yes",
      `--package=${pnpm}`,
      "--cache",
      cache,
      "--",
      "pnpm",
      "install",
      "--ignore-scripts",
      "--no-frozen-lockfile",
      "--config.hoist=false",
      "--config.public-hoist-pattern=",
      `--config.store-dir=${path.join(cache, "pnpm-store")}`,
      `--config.cache-dir=${path.join(cache, "pnpm-cache")}`,
      "--reporter=silent",
    ],
    strict,
  );
  await checkInstalled(strict);

  // Upgrade from the deprecation release, then migrate the user's config/comment.
  // npm must remove the retired shim as well as install the current command.
  const upgrade = path.join(directory, "upgrade");
  await mkdir(upgrade);
  await writeFile(path.join(upgrade, "package.json"), JSON.stringify({ private: true }));
  runNpm(
    ["install", "mdrefine@0.4.1", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache],
    upgrade,
  );
  assert.equal(runNpm(["exec", "--no", "--", "mdtools", "--version"], upgrade).trim(), "0.4.1");
  const oldConfig = path.join(upgrade, "mdtools.config.json");
  const note = path.join(upgrade, "note.md");
  const oldSource = "<!-- mdtools-disable style/emphasis -->\n\nA *legacy* note.\n";
  await writeFile(oldConfig, JSON.stringify({ extends: [], rules: { "style/emphasis": "error" } }));
  await writeFile(note, oldSource);
  runNpm(
    ["exec", "--no", "--", "mdrefine", "lint", "--max-warnings", "0", "--root", upgrade, "note.md"],
    upgrade,
  );
  runNpm(
    ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache],
    upgrade,
  );
  assert.equal(
    runNpm(["exec", "--no", "--", "mdrefine", "--version"], upgrade).trim(),
    manifest.version,
  );
  for (const suffix of process.platform === "win32" ? ["", ".cmd", ".ps1"] : [""])
    await assert.rejects(lstat(path.join(upgrade, "node_modules/.bin", `mdtools${suffix}`)), {
      code: "ENOENT",
    });
  const unmigrated = spawnSync(
    process.execPath,
    [
      npm,
      "exec",
      "--no",
      "--",
      "mdrefine",
      "lint",
      "--json",
      "--max-warnings",
      "0",
      "--root",
      upgrade,
      "note.md",
    ],
    { cwd: upgrade, encoding: "utf8", env: consumerEnvironment },
  );
  assert.equal(unmigrated.status, 1, unmigrated.stderr);
  assert(
    JSON.parse(unmigrated.stdout).files[0].diagnostics.some(
      (item) => item.rule === "style/emphasis",
    ),
  );
  await rename(oldConfig, path.join(upgrade, "mdrefine.config.json"));
  await writeFile(note, oldSource.replace("mdtools-disable", "mdrefine-disable"));
  runNpm(
    ["exec", "--no", "--", "mdrefine", "lint", "--max-warnings", "0", "--root", upgrade, "note.md"],
    upgrade,
  );

  if (process.argv.includes("--retain")) {
    const artifacts = path.join(repository, "artifacts");
    await mkdir(artifacts, { recursive: true });
    const content = await readFile(tarball);
    await copyFile(tarball, path.join(artifacts, result.filename));
    await writeFile(
      path.join(artifacts, "SHA256SUMS"),
      `${createHash("sha256").update(content).digest("hex")}  ${result.filename}\n`,
    );
    await writeFile(
      path.join(artifacts, "package-manifest.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
  process.stdout.write(
    `Installed ${manifest.name}@${manifest.version} with npm and with ${pnpm}: executable, library, require(), and consumer types passed.\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
