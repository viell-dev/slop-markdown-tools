import process from "node:process";
import { performance } from "node:perf_hooks";
import { createWorkspace, lint } from "../dist/index.js";
const count = Number(process.argv[2] ?? 1000);
if (!Number.isInteger(count) || count < 1) throw new Error("Count must be a positive integer.");
const files = Object.fromEntries(
  Array.from({ length: count }, (_, i) => [
    `notes/n${i}.md`,
    `# Note ${i}\n\nA short document with [another note](n${(i + 1) % count}.md).\n`,
  ]),
);
const start = performance.now();
const workspace = createWorkspace(files, { dialect: "obsidian", strictLineBreaks: true });
const indexed = performance.now();
const config = { extends: ["recommended", "obsidian"] };
for (const [path, source] of Object.entries(files)) lint(source, { path, config, workspace });
process.stdout.write(
  JSON.stringify({ count, indexMs: indexed - start, lintMs: performance.now() - indexed }) + "\n",
);
