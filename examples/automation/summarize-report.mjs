// Summarize the JSON report of `mdtools lint --json` or `mdtools format --json`.
//
//   npx --no-install mdtools lint --json | node summarize-report.mjs
//
// The report is one object: { version, mode, files, written }. Each file has a
// `path`, its `diagnostics`, and for `format` a `changed` flag.
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const report = JSON.parse(input);

const byRule = new Map();
for (const file of report.files) {
  for (const item of file.diagnostics) {
    const entry = byRule.get(item.rule) ?? { severity: item.severity, count: 0, files: new Set() };
    entry.count += 1;
    entry.files.add(file.path);
    byRule.set(item.rule, entry);
  }
}

const diagnostics = report.files.reduce((total, file) => total + file.diagnostics.length, 0);
console.log(`${report.mode}: ${report.files.length} file(s), ${diagnostics} diagnostic(s)`);
if (report.mode === "format") {
  const changed = report.files.filter((file) => file.changed).length;
  console.log(`${changed} file(s) need formatting`);
}
for (const [rule, entry] of [...byRule].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${entry.count} ${entry.severity} ${rule} in ${entry.files.size} file(s)`);
}
