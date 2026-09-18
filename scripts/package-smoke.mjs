import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import assert from "node:assert/strict";

const npm = process.env.npm_execpath;
assert(npm, "Run this check through npm run test:package.");
const directory = await mkdtemp(path.join(tmpdir(), "mdtools-package-"));
const repository = process.cwd();
const manifest = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
function runNpm(args, cwd = repository, input) {
  return execFileSync(process.execPath, [npm, ...args], { cwd, input, encoding: "utf8" });
}
try {
  const packed = JSON.parse(
    runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory]),
  );
  // npm 12 keys results by package name; earlier npm versions return an array.
  const result = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  assert(
    result.files.every((file) =>
      /^(dist\/|docs\/(?:releases\/)?[^/]+\.md$|examples\/|(?:README|CONTRIBUTING|SECURITY)\.md$|LICENSE$|package\.json$)/.test(
        file.path,
      ),
    ),
  );
  for (const required of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/cli/main.js",
    "LICENSE",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
  ])
    assert(
      result.files.some((file) => file.path === required),
      `Missing packed file: ${required}`,
    );
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module", scripts: { cli: "mdtools" } }),
  );
  runNpm(
    [
      "install",
      path.join(directory, result.filename),
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      path.join(repository, ".npm-cache"),
    ],
    directory,
  );
  const installed = path.join(directory, "node_modules", manifest.name);
  const metadata = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  assert.equal(metadata.version, manifest.version);
  assert.equal(metadata.bin.mdtools, "dist/cli/main.js");
  assert(
    (await readFile(path.join(installed, metadata.bin.mdtools), "utf8")).startsWith(
      "#!/usr/bin/env node\n",
    ),
  );
  // npm scripts exercise the actual installed .bin shim on Windows and POSIX.
  assert.equal(
    runNpm(["run", "--silent", "cli", "--", "--version"], directory).trim(),
    manifest.version,
  );
  assert.equal(
    runNpm(
      ["run", "--silent", "cli", "--", "format", "-", "--root", directory],
      directory,
      "A *small* note.\n",
    ),
    "A _small_ note.\n",
  );
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {format} from ${JSON.stringify(manifest.name)}; process.stdout.write(format("A *small* note.\\n").output);`,
    ],
    { encoding: "utf8", cwd: directory },
  );
  assert.equal(output, "A _small_ note.\n");
  const consumer = path.join(directory, "consumer.mts");
  await writeFile(
    consumer,
    `import { format, parse, type Plugin } from ${JSON.stringify(manifest.name)};
const plugin: Plugin = { name: "consumer", rules: { sample: {
  description: "Exercise the public types", kind: "problem",
  check: ({ document }) => document.tree.children.length ? [] : [{ start: 0, message: "Empty" }],
} } };
const output: string = format("Text", { plugins: [plugin] }).output;
for (const node of parse(output, "obsidian").tree.children) {
  if (node.type === "paragraph") for (const child of node.children) {
    if (child.type === "wikiLink") { const target: string | undefined = child.target; void target; }
  }
}
`,
  );
  execFileSync(
    process.execPath,
    [
      path.join(repository, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--target",
      "ES2023",
      consumer,
    ],
    { cwd: directory, stdio: "inherit" },
  );
  if (process.argv.includes("--retain")) {
    const artifacts = path.join(repository, "artifacts");
    await mkdir(artifacts, { recursive: true });
    const tarball = await readFile(path.join(directory, result.filename));
    await copyFile(path.join(directory, result.filename), path.join(artifacts, result.filename));
    await writeFile(
      path.join(artifacts, "SHA256SUMS"),
      `${createHash("sha256").update(tarball).digest("hex")}  ${result.filename}\n`,
    );
    await writeFile(
      path.join(artifacts, "package-manifest.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
  process.stdout.write(
    `Installed ${manifest.name}@${manifest.version}: executable, library, and consumer types passed.\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
