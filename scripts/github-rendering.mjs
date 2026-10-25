// Compare GitHub's rendering of generated documents before and after formatting (issue #303).
//
//   node scripts/github-rendering.mjs [--seeds 1,2,3,4,5] [--seed N|none] [--documents 25] [--out DIR]
//
// Defaults to authored fixtures and the realistic profile at fixed seeds 1–5. Explicit
// --profile adversarial selects fresh-seed weekly/manual discovery, never a merge/release gate.
// Reports include the profile and actual seeds so every observation can be reproduced.
// Each document is formatted with the presets recommended and github, and a document that
// formatting changes is rendered before and after by GitHub's Markdown API in two modes:
//
// - `markdown` renders a file and keeps soft line breaks, but leaves out GitHub's task lists,
//   alerts, and math, whose markers it shows as text. For this mode the document is formatted
//   without github/task-marker and github/alert-marker, whose edits only those features hide.
// - `gfm` renders a comment: it has those features, but writes every line break as <br>, which
//   the comparison counts as a space.
//
// The HTML is compared after normalizeHtml, without the random ID that GitHub writes into each
// response. Realistic differences always fail. Adversarial differences can be listed with an
// issue in renderer-known-differences.json; known sources are replayed and stale entries fail.
// So does a run in which formatting changed no document, which compared
// nothing. Each document that renders differently is written to DIR (default
// artifacts/github-rendering) as before.md, after-MODE.md, and the HTML of both. The report, in
// Markdown, goes to standard output.
//
// Needs a build (npm run build) and an authenticated gh: GH_TOKEN in GitHub Actions, or
// `gh auth login`. GitHub asks for one request at a time and a pause between those that use
// POST, so the requests are made one after the other, a second apart: 150 documents make up
// to 600 requests and take ten to fifteen minutes. The Rendering workflow runs this every
// week, and by hand with `gh workflow run rendering.yml`.
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { format, parse } from "../dist/index.js";
import { documentSeed, generateDocument, normalizeGithubHtml } from "./rendering.mjs";
import { rendererSettings } from "./renderer-settings.mjs";
import { classifyDifferences, knownSources } from "./renderer-differences.mjs";
import { githubFixtures } from "../tests/fixtures/renderers/common.mjs";
import {
  createRendererReport,
  startDocument,
  validateRendererReport,
} from "./renderer-evidence.mjs";

const usage =
  "Usage: node scripts/github-rendering.mjs [--profile realistic|adversarial] [--seeds 1,2,3,4,5] [--seed N|none|random] [--documents 25] [--out DIR]\n";
/** The run's settings from its arguments. */
function settings(argv) {
  const values = { COUNT: "25" };
  let out = path.join("artifacts", "github-rendering");
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = [argv[index], argv[index + 1]];
    if (value === undefined) throw new Error(usage);
    if (name === "--profile") values.PROFILE = value;
    else if (name === "--seeds") values.SEEDS = value;
    else if (name === "--seed") values.SEED = value;
    else if (name === "--documents") values.COUNT = value;
    else if (name === "--out" && value !== "") out = value;
    else throw new Error(usage);
  }
  return { ...rendererSettings(values), out };
}

/** `gh api markdown` with `body`: its exit status and output. */
function gh(body) {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", ["api", "markdown", "--input", "-"], { windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) =>
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      }),
    );
    child.stdin.end(JSON.stringify(body));
  });
}
const pause = 1000;
let lastRequest = 0;
/** When the token's request limit resets, in milliseconds since the epoch, or in a minute. */
function rateLimitReset() {
  const { stdout } = spawnSync("gh", ["api", "rate_limit", "--jq", ".resources.core.reset"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const seconds = Number(stdout?.trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now() + 60000;
}
let limitWaits = 0;
/**
 * GitHub's HTML for `text` in `mode`. A failed request is tried again, after longer waits. When
 * the token's request limit is spent, as when runs overlap, the request waits for the limit to
 * reset, at least a minute and at most an hour, once in a run, so that the run still fits in the
 * workflow's time limit.
 */
async function render(text, mode) {
  for (let attempt = 1; ; attempt++) {
    await delay(Math.max(0, lastRequest + pause - Date.now()));
    lastRequest = Date.now();
    const { status, stdout, stderr } = await gh({ text, mode });
    if (status === 0) return stdout;
    if (/rate limit/i.test(stderr) && limitWaits < 1) {
      limitWaits++;
      const wait = Math.min(Math.max(rateLimitReset() - Date.now() + 5000, 60000), 3600000);
      process.stderr.write(
        `${stderr}\nWaiting ${Math.ceil(wait / 60000)} minutes for the request limit to reset.\n`,
      );
      await delay(wait);
      attempt--;
      continue;
    }
    if (attempt === 5) throw new Error(`gh api markdown failed: ${stderr}`);
    process.stderr.write(
      `gh api markdown failed: ${stderr}\nTrying again in ${attempt} minutes.\n`,
    );
    await delay(60000 * attempt);
  }
}
/** The HTML as compared: without the response's ID, and in `gfm` mode without <br>. */
function compared(html, mode, source) {
  return normalizeGithubHtml(html, mode, parse(source, "github").tree);
}

const config = { extends: ["recommended", "github"] };
const modes = [
  ["markdown", { ...config, rules: { "github/task-marker": "off", "github/alert-marker": "off" } }],
  ["gfm", config],
];
/** The renderings of `source` in each mode in which formatting changes it. */
async function renderings(source, record) {
  const result = [];
  for (const [mode, modeConfig] of modes) {
    const output = format(source, { config: modeConfig }).output;
    const changed = output !== source;
    if (!changed) {
      record.views.push({ name: mode, changed, status: "unchanged" });
      continue;
    }
    const before = await render(source, mode);
    const after = await render(output, mode);
    result.push({
      mode,
      output,
      before,
      after,
      differs: compared(before, mode, source) !== compared(after, mode, output),
    });
    record.views.push({ name: mode, changed, status: "compared" });
  }
  return result;
}

let options;
try {
  options = settings(process.argv.slice(2));
} catch (error) {
  process.stderr.write(error.message);
  process.exit(2);
}
const results = [];
rmSync(options.out, { recursive: true, force: true });
mkdirSync(options.out, { recursive: true });
const report = createRendererReport("github", options);
report.identity = { service: "GitHub Markdown API", version: "externally-uncontrolled" };
const checkpoint = () =>
  writeFileSync(path.join(options.out, "report.json"), JSON.stringify(report, null, 2) + "\n");
const cases = githubFixtures.map(({ name, source }) => ({ name: `fixture-${name}`, source }));
for (const seed of options.seeds)
  for (let index = 0; index < options.count; index++) {
    const source = generateDocument(documentSeed(seed, index), "github", options.profile);
    cases.push({ name: `generated-${seed}-${index}`, source });
  }
if (options.profile === "adversarial")
  knownSources("github").forEach((source, index) => cases.push({ name: `known-${index}`, source }));
try {
  for (const [mode] of modes) {
    assert.notEqual(
      compared(await render("First text.\n", mode), mode, "First text.\n"),
      compared(await render("Changed text.\n", mode), mode, "Changed text.\n"),
    );
    report.controls.push({ name: `${mode}-text-difference`, passed: true });
  }
  for (const { name, source } of cases) {
    const record = startDocument(report, name, 80);
    const rendered = await renderings(source, record);
    record.changed = record.views.some((view) => view.changed);
    record.completed = true;
    if (rendered.length) report.compared++;
    results.push({ name, source, modes: rendered });
  }
} finally {
  checkpoint();
}

const name = (item) => item.name;
const differing = results.filter((result) => result.modes.some((mode) => mode.differs));
const { unexpected, known, stale } = classifyDifferences(
  "github",
  options.profile,
  differing.flatMap((result) =>
    result.modes
      .filter((mode) => mode.differs)
      .map((mode) => ({
        name: result.name,
        source: result.source,
        output: mode.output,
        view: mode.mode,
      })),
  ),
);
for (const result of differing) {
  const folder = path.join(options.out, result.name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "before.md"), result.source);
  for (const { mode, output, before, after } of result.modes) {
    writeFileSync(path.join(folder, `after-${mode}.md`), output);
    writeFileSync(path.join(folder, `before-${mode}.html`), before);
    writeFileSync(path.join(folder, `after-${mode}.html`), after);
  }
}

const changed = results.filter((result) => result.modes.length > 0).length;
mkdirSync(options.out, { recursive: true });
Object.assign(report, { unexpected, known, stale });
checkpoint();
validateRendererReport(report, options, "github");
const lines = [
  "## GitHub's rendering before and after formatting",
  "",
  `Profile **${options.profile}**, seeds ${options.seeds.join(", ") || "(none)"}, ${options.count} documents per seed plus fixtures: ${results.length} documents, ${changed} changed by formatting, ${differing.length} rendered differently; ${known.length} known view differences.`,
  "",
  "Reproduce with:",
  "",
  "```sh",
  `node scripts/github-rendering.mjs --profile ${options.profile} --seeds "${options.seeds.join(",")}" --seed none --documents ${options.count}`,
  "```",
];
if (unexpected.length || stale.length || !changed) lines.push("");
if (!changed) lines.push("- Formatting changed no document, so nothing was compared.");
for (const result of unexpected) {
  lines.push(`- Document ${name(result)} renders differently in mode ${result.view}.`);
}
for (const entry of stale)
  lines.push(
    `- A known ${entry.view} difference is stale; check issue ${entry.issue} and remove its entry.`,
  );
process.stdout.write(lines.join("\n") + "\n");
process.exit(unexpected.length || stale.length || !changed ? 1 : 0);
