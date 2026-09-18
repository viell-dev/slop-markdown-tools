import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import assert from "node:assert/strict";

const npm = process.env.npm_execpath;
assert(npm, "Run this check through npm run test:package.");
const directory = await mkdtemp(path.join(tmpdir(), "mdtools-package-"));
const repository = process.cwd();
function runNpm(args, cwd = repository) {
  return execFileSync(process.execPath, [npm, ...args], { cwd, encoding: "utf8" });
}
try {
  const packed = JSON.parse(
    runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory]),
  );
  // npm 12 keys results by package name; earlier npm versions return an array.
  const result = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  assert(
    result.files.every((file) =>
      /^(dist\/|docs\/|examples\/|README\.md$|LICENSE$|package\.json$)/.test(file.path),
    ),
  );
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
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
  const installed = path.join(directory, "node_modules", "@viell-dev", "markdown-tools");
  const version = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8")).version;
  const actual = execFileSync(
    process.execPath,
    [path.join(installed, "dist", "cli", "main.js"), "--version"],
    { encoding: "utf8", cwd: directory },
  );
  assert.equal(actual.trim(), version);
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import {format} from "@viell-dev/markdown-tools"; process.stdout.write(format("A *small* note.\\n").output);',
    ],
    { encoding: "utf8", cwd: directory },
  );
  assert.equal(output, "A _small_ note.\n");
  process.stdout.write(`Installed package ${version}: CLI and library smoke checks passed.\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
