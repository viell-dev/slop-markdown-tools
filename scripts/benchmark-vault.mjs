import process from "node:process";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { createWorkspace, format, lint, parse, semanticFingerprint } from "../dist/index.js";

// A synthetic Obsidian vault of interlinked notes that all need reflow and
// marker changes. Reports per-stage library timings; excludes discovery and I/O.
const count = Number(process.argv[2] ?? 2000);
if (!Number.isInteger(count) || count < 1) throw new Error("Count must be a positive integer.");
const note = (i) =>
  `# Note ${i}\n\n` +
  Array.from(
    { length: 6 },
    (_, p) =>
      `Paragraph ${p} links to [[n${(i + p + 1) % count}]] and [[n${(i + 2 * p + 3) % count}#Details|details]] with *emphasis* and __strong__ words that continue past the configured width so that reflow is needed here.\n`,
  ).join("\n") +
  `\n## Details\n\nA closing paragraph with a block id. ^block-${i}\n`;
const files = Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${i}.md`, note(i)]));
const bytes = Object.values(files).reduce((sum, source) => sum + Buffer.byteLength(source), 0);
const config = { extends: ["recommended", "obsidian"] };
const workspace = createWorkspace(files, { dialect: "obsidian", strictLineBreaks: true });
const time = (fn) => {
  const start = performance.now();
  const value = fn();
  return [performance.now() - start, value];
};
const entries = Object.entries(files);
for (const [path, source] of entries.slice(0, 50)) format(source, { path, config, workspace });
const [parseMs] = time(() => entries.map(([path, source]) => parse(source, "obsidian", path)));
const [fingerprintMs] = time(() =>
  entries.map(([path, source]) => semanticFingerprint(parse(source, "obsidian", path), workspace)),
);
const [lintMs, lintResults] = time(() =>
  entries.map(([path, source]) => lint(source, { path, config, workspace })),
);
const [formatMs, formatResults] = time(() =>
  entries.map(([path, source]) => format(source, { path, config, workspace })),
);
const [unchangedMs] = time(() =>
  formatResults.map((result, i) =>
    format(result.output, { path: entries[i][0], config, workspace }),
  ),
);
const digest = createHash("sha256");
for (const result of formatResults) digest.update(JSON.stringify(result));
for (const result of lintResults) digest.update(JSON.stringify(result));
if (formatResults.some((result) => !result.changed || result.diagnostics.length))
  throw new Error("Every note should change without diagnostics.");
process.stdout.write(
  JSON.stringify({
    count,
    bytes,
    parseMs: Math.round(parseMs),
    fingerprintMs: Math.round(fingerprintMs),
    lintMs: Math.round(lintMs),
    formatMs: Math.round(formatMs),
    unchangedMs: Math.round(unchangedMs),
    resultHash: digest.digest("hex"),
  }) + "\n",
);
