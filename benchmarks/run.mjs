// Measure how fast the built package lints and formats synthetic documents.
//
//   npm run benchmark              full run, a Markdown report on stdout
//   npm run benchmark -- --json    the same measurements as JSON
//   npm run benchmark -- --quick   tiny inputs and one sample, to check that it runs
//
// docs/benchmarks.md explains what each measurement means and how to read it.
import process from "node:process";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import * as prettier from "prettier";
import { createWorkspace, format, lint, parse } from "../dist/index.js";
import { longDocument, repositoryDocs, vault } from "./corpus.mjs";
import { markdown } from "./report.mjs";

const flags = process.argv.slice(2);
const unknown = flags.filter((flag) => !["--quick", "--json"].includes(flag));
if (unknown.length) throw new Error(`Unknown option: ${unknown.join(" ")}`);
const quick = flags.includes("--quick");
const json = flags.includes("--json");
// Every size is a multiple of the smallest, so the scaling tables compare like with like.
const sizes = quick
  ? { samples: 1, files: [6, 12, 24], bytes: [4_000, 8_000, 16_000] }
  : { samples: 5, files: [125, 500, 2000], bytes: [16_000, 128_000, 1_024_000] };
const repository = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(repository, "dist/cli/main.js");
const manifest = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));

const results = [];
const digest = createHash("sha256");
const progress = (text) => process.stderr.write(`${text}\n`);
const byteLength = (sources) =>
  sources.reduce((total, source) => total + Buffer.byteLength(source), 0);
/** Time `run` `samples` times, after one untimed warm-up unless told otherwise; `prepare` is never timed. */
async function measure(run, { samples = sizes.samples, prepare, warm = true } = {}) {
  const times = [];
  for (let index = warm ? -1 : 0; index < samples; index++) {
    await prepare?.();
    const start = performance.now();
    await run();
    if (index >= 0) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const middle = times.length >> 1;
  return {
    median: times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2,
    min: times[0],
    max: times.at(-1),
  };
}
function record(group, id, label, measured, extra = {}) {
  results.push({ id: `${group}.${id}`, group, label, ...extra, ms: measured });
  progress(`  ${label}: ${Math.round(measured.median)} ms`);
}

/** Format every file of a corpus once, checking that the corpus behaves as intended. */
function formatAll(corpus, files, expectChanges) {
  const workspace = createWorkspace(files, corpus.workspace);
  const outputs = {};
  for (const [name, source] of Object.entries(files)) {
    const result = format(source, { path: name, config: corpus.config, workspace });
    if (result.diagnostics.length || (result.changed && !expectChanges))
      throw new Error(`Unexpected formatting result for ${name}.`);
    outputs[name] = result.output;
  }
  return outputs;
}
/** Parse, lint, and format one corpus through the library, with no file access. */
async function library(group, corpus, { reference = false } = {}) {
  const entries = Object.entries(corpus.files);
  const size = { files: entries.length, bytes: byteLength(Object.values(corpus.files)) };
  progress(`${group}: ${size.files} files, ${size.bytes} bytes`);
  const options = (name, workspace) => ({ path: name, config: corpus.config, workspace });
  const formatted = formatAll(corpus, corpus.files, true);
  for (const output of Object.values(formatted)) digest.update(output);

  record(
    group,
    "parse",
    "Parse only",
    await measure(() =>
      entries.forEach(([name, source]) => parse(source, corpus.workspace.dialect, name)),
    ),
    size,
  );
  // Each sample builds a new workspace, as each CLI run does: nothing is cached between runs.
  record(
    group,
    "lint",
    "Lint",
    await measure(() => {
      const workspace = createWorkspace(corpus.files, corpus.workspace);
      for (const [name, source] of entries) lint(source, options(name, workspace));
    }),
    size,
  );
  record(
    group,
    "format-changes",
    "Format, every file needs changes",
    await measure(() => formatAll(corpus, corpus.files, true)),
    size,
  );
  record(
    group,
    "format-clean",
    "Format, every file already formatted",
    await measure(() => formatAll(corpus, formatted, false)),
    { files: size.files, bytes: byteLength(Object.values(formatted)) },
  );
  if (reference)
    record(
      group,
      "prettier",
      "Prettier on the same files, for comparison",
      await measure(async () => {
        for (const [, source] of entries)
          await prettier.format(source, {
            parser: "markdown",
            proseWrap: "always",
            printWidth: 80,
          });
      }),
      size,
    );
  return formatted;
}

/** Put a corpus on disk and run CLI processes on it, as a user or a CI job does. */
async function onDisk(corpus, use) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mdtools-benchmark-"));
  const memoryFile = path.join(root, ".peak-memory");
  const write = async (files) => {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), source);
    }
  };
  const run = (args, { memory = false, command = [cli] } = {}) => {
    const preload = [
      "--import",
      pathToFileURL(path.join(repository, "benchmarks/peak-memory.mjs")).href,
    ];
    const result = spawnSync(process.execPath, [...(memory ? preload : []), ...command, ...args], {
      cwd: root,
      stdio: "ignore",
      env: { ...process.env, MDTOOLS_BENCHMARK_MEMORY: memoryFile },
    });
    if (result.status !== 0)
      throw new Error(`mdtools ${args.join(" ")} exited with ${result.status}.`);
  };
  /** The most memory one more run of the command holds, including Node.js itself. */
  const peakMemory = async (args, options) => {
    run(args, { ...options, memory: true });
    return Number(await readFile(memoryFile, "utf8")) * 1024;
  };
  try {
    // The .git directory marks the workspace boundary, as it does in a real checkout.
    await write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "mdtools.config.json": JSON.stringify(corpus.config),
      ...corpus.extraFiles,
    });
    await use({ write, run, peakMemory });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function commandLine(corpus, formatted) {
  const names = Object.keys(corpus.files);
  const size = { files: names.length, bytes: byteLength(Object.values(corpus.files)) };
  progress(`cli: ${size.files} files, ${size.bytes} bytes`);
  await onDisk(corpus, async ({ write, run, peakMemory }) => {
    const scenario = async (id, label, args, { files, counted = size, command } = {}) => {
      const prepare = files && (() => write(files));
      const measured = await measure(() => run(args, { command }), { prepare });
      await prepare?.();
      const peakMemoryBytes = await peakMemory(args, { command });
      record("cli", id, label, measured, { ...counted, peakMemoryBytes });
    };
    await scenario("node", "Start Node.js and exit, for comparison", ["-e", "0"], {
      counted: {},
      command: [],
    });
    await scenario("version", "Start the CLI and print its version", ["--version"], {
      counted: {},
    });
    await write(corpus.files);
    // Warnings do not fail lint, so an unformatted workspace still exits with 0.
    await scenario("lint", "Lint the workspace", ["lint"]);
    await scenario("lint-one", "Lint one file of the workspace", ["lint", names[1]], {
      counted: { files: 1, bytes: Buffer.byteLength(corpus.files[names[1]]) },
    });
    await scenario(
      "format-write",
      "Format and write, every file needs changes",
      ["format", "--write"],
      { files: corpus.files },
    );
    await write(formatted);
    await scenario("format-check", "Check formatting, every file already formatted", [
      "format",
      "--check",
    ]);
  });
}

/** Lint and format corpora of other sizes: the cost per file should stay the same. */
async function moreFiles(count, measuredMain) {
  const id = (step) => `${count}-${step}`;
  if (measuredMain) {
    const { peakMemoryBytes } = results.find((result) => result.id === "cli.lint");
    for (const step of ["lint", "format-changes"]) {
      const { label, files, bytes, ms } = results.find(
        (result) => result.id === `repository.${step}`,
      );
      results.push({
        id: `files.${id(step)}`,
        group: "files",
        label,
        files,
        bytes,
        ...(step === "lint" ? { peakMemoryBytes } : {}),
        ms,
      });
    }
    return;
  }
  const corpus = repositoryDocs(count);
  const entries = Object.entries(corpus.files);
  const size = { files: entries.length, bytes: byteLength(Object.values(corpus.files)) };
  progress(`files: ${size.files} files, ${size.bytes} bytes`);
  // Memory is the one cost that grows with the workspace as a whole, so it comes from the CLI.
  let peakMemoryBytes;
  await onDisk(corpus, async ({ write, peakMemory }) => {
    await write(corpus.files);
    peakMemoryBytes = await peakMemory(["lint"]);
  });
  // The engine is warm by now, and these runs are long: fewer samples, no warm-up.
  const samples = Math.ceil(sizes.samples / 2);
  record(
    "files",
    id("lint"),
    "Lint",
    await measure(
      () => {
        const workspace = createWorkspace(corpus.files, corpus.workspace);
        for (const [name, source] of entries)
          lint(source, { path: name, config: corpus.config, workspace });
      },
      { samples, warm: false },
    ),
    { ...size, samples, peakMemoryBytes },
  );
  record(
    "files",
    id("format-changes"),
    "Format, every file needs changes",
    await measure(() => formatAll(corpus, corpus.files, true), { samples, warm: false }),
    { ...size, samples },
  );
}

const [small, medium, large] = sizes.files;
const main = repositoryDocs(medium);
const formattedMain = await library("repository", main, { reference: true });
await library("vault", vault(medium));
await commandLine(main, formattedMain);
await moreFiles(small);
await moreFiles(medium, true);
await moreFiles(large);
// One larger document: the cost per kilobyte should stay the same.
for (const bytes of sizes.bytes) {
  const source = longDocument(bytes);
  const config = { extends: ["recommended", "github"] };
  const size = { files: 1, bytes: Buffer.byteLength(source) };
  progress(`document: ${size.bytes} bytes`);
  record(
    "document",
    `${bytes}-format-changes`,
    "Format, the document needs changes",
    await measure(() => {
      if (format(source, { config }).diagnostics.length) throw new Error("Unexpected diagnostics.");
    }),
    size,
  );
}

const report = {
  package: `${manifest.name}@${manifest.version}`,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  cpu: `${os.cpus()[0]?.model.trim() ?? "unknown CPU"}, ${os.availableParallelism()} logical CPUs`,
  quick,
  samples: sizes.samples,
  prettier: prettier.version,
  // Identical for any two builds that format the corpora identically.
  outputHash: digest.digest("hex"),
  results,
};
if (json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
else process.stdout.write(markdown(report));
