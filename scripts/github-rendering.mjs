// Compare GitHub's rendering of generated documents before and after formatting (issue #303).
//
//   node scripts/github-rendering.mjs [--seeds 1,2,3,4,5] [--seed N] [--documents 25] [--out DIR]
//
// Each run seed stands for --documents documents, generated as scripts/rendering.mjs describes
// with all of GitHub's syntax. The fixed seeds are followed by one new seed, random unless
// --seed names it; the report names it, so that a finding can be reproduced. Each document is
// formatted with the presets recommended and github, and a document that formatting changes is
// rendered before and after by GitHub's Markdown API in two modes:
//
// - `markdown` renders a file and keeps soft line breaks, but leaves out GitHub's task lists,
//   alerts, and math, whose markers it shows as text. For this mode the document is formatted
//   without github/task-marker and github/alert-marker, whose edits only those features hide.
// - `gfm` renders a comment: it has those features, but writes every line break as <br>, which
//   the comparison counts as a space.
//
// The HTML is compared after normalizeHtml, without the random ID that GitHub writes into each
// response. A document that renders differently and that KNOWN does not list fails the run, and
// so does a listed document of the fixed seeds that renders alike, because what its entry
// tracks may be fixed. Each document that renders differently is written to DIR (default
// artifacts/github-rendering) as before.md, after-MODE.md, and the HTML of both. The report, in
// Markdown, goes to standard output.
//
// Needs a build (npm run build) and an authenticated gh: GH_TOKEN in GitHub Actions, or
// `gh auth login`. GitHub asks for one request at a time and a pause between those that use
// POST, so the requests are made one after the other, a second apart: 150 documents make up
// to 600 requests and take ten to fifteen minutes. The Rendering workflow runs this every
// week, and by hand with `gh workflow run rendering.yml`.
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { format } from "../dist/index.js";
import { documentSeed, generateDocument, normalizeHtml } from "./rendering.mjs";

/**
 * Documents of the fixed seeds that render differently, with the issue that tracks each. The
 * documents of a seed change with the generator and with formatting; check the entries again
 * when either changes. The comment after an entry is a smaller input that shows the difference.
 */
const known = [
  // "> > [!note]" becomes "> > [!NOTE]"; GitHub shows the marker of a nested quote as text.
  { seed: 1, index: 1, issue: 334 },
  // ">> [!Important]" becomes ">> [!IMPORTANT]", shown as text in a nested quote.
  { seed: 2, index: 10, issue: 334 },
  // "> [!Important] glacier" becomes "> [!IMPORTANT] glacier"; GitHub shows a marker followed by
  // text on its line as text.
  { seed: 3, index: 14, issue: 334 },
];

const usage =
  "Usage: node scripts/github-rendering.mjs [--seeds 1,2,3,4,5] [--seed N] [--documents 25] [--out DIR]\n";
/** The run's settings from its arguments. */
function settings(argv) {
  const result = {
    seeds: [1, 2, 3, 4, 5],
    seed: randomInt(1, 2 ** 32),
    documents: 25,
    out: path.join("artifacts", "github-rendering"),
  };
  const number = (text) => {
    if (!/^\d{1,10}$/.test(text ?? "") || Number(text) >= 2 ** 32) throw new Error(usage);
    return Number(text);
  };
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = [argv[index], argv[index + 1]];
    if (value === undefined) throw new Error(usage);
    if (name === "--seeds") result.seeds = value === "" ? [] : value.split(",").map(number);
    else if (name === "--seed") result.seed = number(value);
    else if (name === "--documents") result.documents = number(value);
    else if (name === "--out" && value !== "") result.out = value;
    else throw new Error(usage);
  }
  return result;
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
/** GitHub's HTML for `text` in `mode`. A failed request is tried again, after longer waits. */
async function render(text, mode) {
  for (let attempt = 1; ; attempt++) {
    await delay(Math.max(0, lastRequest + pause - Date.now()));
    lastRequest = Date.now();
    const { status, stdout, stderr } = await gh({ text, mode });
    if (status === 0) return stdout;
    if (attempt === 5) throw new Error(`gh api markdown failed: ${stderr}`);
    process.stderr.write(
      `gh api markdown failed: ${stderr}\nTrying again in ${attempt} minutes.\n`,
    );
    await delay(60000 * attempt);
  }
}
/** The HTML as compared: without the response's ID, and in `gfm` mode without <br>. */
function compared(html, mode) {
  const text = html.replace(/[0-9a-f]{32}/g, "ID");
  return normalizeHtml(mode === "gfm" ? text.replace(/<br\s*\/?>/g, " ") : text);
}

const config = { extends: ["recommended", "github"] };
const modes = [
  ["markdown", { ...config, rules: { "github/task-marker": "off", "github/alert-marker": "off" } }],
  ["gfm", config],
];
/** The renderings of `source` in each mode in which formatting changes it. */
async function renderings(source) {
  const result = [];
  for (const [mode, modeConfig] of modes) {
    const output = format(source, { config: modeConfig }).output;
    if (output === source) continue;
    const before = await render(source, mode);
    const after = await render(output, mode);
    result.push({
      mode,
      output,
      before,
      after,
      differs: compared(before, mode) !== compared(after, mode),
    });
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
const runSeeds = [...options.seeds, options.seed];
const results = [];
for (const seed of runSeeds)
  for (let index = 0; index < options.documents; index++) {
    const source = generateDocument(documentSeed(seed, index), "github");
    results.push({ seed, index, source, modes: await renderings(source) });
  }

const name = (item) => `${item.seed}/${item.index}`;
const differing = results.filter((result) => result.modes.some((mode) => mode.differs));
const listed = new Map(known.map((entry) => [name(entry), entry]));
const unexpected = differing.filter((result) => !listed.has(name(result)));
const stale = known.filter(
  (entry) =>
    options.seeds.includes(entry.seed) &&
    entry.index < options.documents &&
    !differing.some((result) => name(result) === name(entry)),
);
rmSync(options.out, { recursive: true, force: true });
for (const result of differing) {
  const folder = path.join(options.out, `${result.seed}-${result.index}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "before.md"), result.source);
  for (const { mode, output, before, after } of result.modes) {
    writeFileSync(path.join(folder, `after-${mode}.md`), output);
    writeFileSync(path.join(folder, `before-${mode}.html`), before);
    writeFileSync(path.join(folder, `after-${mode}.html`), after);
  }
}

const changed = results.filter((result) => result.modes.length > 0).length;
const lines = [
  "## GitHub's rendering before and after formatting",
  "",
  `Seeds ${options.seeds.join(", ") || "(none)"} and the new seed **${options.seed}**, ${options.documents} documents each: ${results.length} documents, ${changed} changed by formatting, ${differing.length} rendered differently, ${differing.length - unexpected.length} of them known.`,
  "",
  "Reproduce with:",
  "",
  "```sh",
  `node scripts/github-rendering.mjs --seeds "${options.seeds.join(",")}" --seed ${options.seed} --documents ${options.documents}`,
  "```",
];
if (unexpected.length || stale.length) lines.push("");
for (const result of unexpected) {
  const modeNames = result.modes.filter((mode) => mode.differs).map((mode) => mode.mode);
  lines.push(`- Document ${name(result)} renders differently in mode ${modeNames.join(" and ")}.`);
}
for (const entry of stale)
  lines.push(
    `- Document ${name(entry)} renders alike now; check issue ${entry.issue} and remove its entry.`,
  );
process.stdout.write(lines.join("\n") + "\n");
process.exit(unexpected.length || stale.length ? 1 : 0);
