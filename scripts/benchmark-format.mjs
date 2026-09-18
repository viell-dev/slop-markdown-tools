import process from "node:process";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { createWorkspace, format } from "../dist/index.js";

const count = Number(process.argv[2] ?? 250);
if (!Number.isInteger(count) || count < 1) throw new Error("Count must be a positive integer.");
const source =
  "# Note\n\n" +
  (
    "A paragraph with **strong** and *emphasized* text and a [local link](note.md). ".repeat(12) +
    "\n\n"
  ).repeat(5);
const workspace = createWorkspace(
  { "note.md": source },
  { dialect: "obsidian", strictLineBreaks: true },
);
const options = {
  path: "note.md",
  workspace,
  config: {
    extends: ["recommended", "obsidian"],
    rules: { "style/wrap": ["warn", { width: 100, measure: "codepoints" }] },
  },
};
const normalized = format(source, options).output;
for (let i = 0; i < 10; i++) {
  format(source, options);
  format(normalized, options);
}
const results = {};
const digest = createHash("sha256");
for (const [name, input, expectedChanged] of [
  ["changed", source, true],
  ["unchanged", normalized, false],
]) {
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const result = format(input, options);
    if (
      result.output !== normalized ||
      result.changed !== expectedChanged ||
      result.diagnostics.length
    )
      throw new Error(`Unexpected ${name} formatting result.`);
    digest.update(JSON.stringify(result));
  }
  results[`${name}Ms`] = performance.now() - start;
}
process.stdout.write(
  JSON.stringify({
    count,
    sourceBytes: Buffer.byteLength(source),
    ...results,
    resultHash: digest.digest("hex"),
  }) + "\n",
);
