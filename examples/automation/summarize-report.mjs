// Summarize the JSON report of `mdtools lint --json` or `mdtools format --json`.
//
//   npx --no-install mdtools lint --json | node summarize-report.mjs
//
// The report is one object: { version, mode, files, written }, with a `skipped`
// list when the run left out a path it was not permitted to read. Each file has
// a `path`, its `diagnostics`, and for `format` a `changed` flag.
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const report = JSON.parse(input);

// One rule can be a warning in some files and an error in others, so count per severity.
const counts = new Map();
for (const file of report.files) {
  for (const item of file.diagnostics) {
    const key = `${item.severity} ${item.rule}`;
    const entry = counts.get(key) ?? { count: 0, files: new Set() };
    entry.count += 1;
    entry.files.add(file.path);
    counts.set(key, entry);
  }
}

const diagnostics = report.files.reduce((total, file) => total + file.diagnostics.length, 0);
console.log(`${report.mode}: ${report.files.length} file(s), ${diagnostics} diagnostic(s)`);
if (report.mode === "format") {
  // `changed` stays true for a file that `--write` has just formatted.
  const changed = report.files.filter((file) => file.changed).length;
  console.log(`${changed} file(s) ${report.written ? "were formatted" : "need formatting"}`);
}
for (const [key, entry] of [...counts].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${entry.count} ${key} in ${entry.files.size} file(s)`);
}
