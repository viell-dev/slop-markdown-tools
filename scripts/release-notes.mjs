// Print the section of CHANGELOG.md for one version: the notes of its GitHub release.
//
//   node scripts/release-notes.mjs VERSION
//
// The section starts at the heading "## VERSION", which may also be written "## [VERSION]" and
// is usually followed by the date, and ends before the next "## " heading. A missing or empty
// section is an error, so that a release cannot be published without notes. The Release
// workflow runs this script.
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const version = process.argv[2];
if (!version) {
  process.stderr.write("Usage: node scripts/release-notes.mjs VERSION\n");
  process.exit(2);
}
/** Whether a line is the heading of the version's section. */
function heads(line) {
  if (!line.startsWith("## ")) return false;
  let rest = line.slice(3);
  if (rest.startsWith("[")) rest = rest.slice(1);
  if (!rest.startsWith(version)) return false;
  const after = rest.slice(version.length);
  return after === "" || [" ", "\t", "]"].includes(after[0]);
}
const lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split(/\r?\n/);
const start = lines.findIndex(heads);
if (start < 0) {
  process.stderr.write(
    `CHANGELOG.md has no section for ${version}. Rename "## Unreleased" to "## ${version} - YYYY-MM-DD".\n`,
  );
  process.exit(1);
}
const next = lines.findIndex((line, index) => index > start && line.startsWith("## "));
// GitHub shows every line break of a release's notes, so the lines of a paragraph or a list
// item, which the changelog wraps at 80 columns, are joined. Code blocks stay as they are.
const joined = [];
let fence = false;
let open = false;
for (const line of lines.slice(start + 1, next < 0 ? lines.length : next)) {
  const text = line.trim();
  const isFence = text.startsWith("```");
  if (isFence) fence = !fence;
  const block = !text || fence || isFence || /^(?:[#>|]|[-*+] |\d+[.)] )/.test(text);
  if (open && !block) joined[joined.length - 1] += ` ${text}`;
  else joined.push(line);
  // Paragraph text and list items continue on the next line; headings, tables, and code do not.
  open = Boolean(text) && !fence && !isFence && !/^[#|]/.test(text);
}
const notes = joined.join("\n").trim();
if (!notes) {
  process.stderr.write(`The section of CHANGELOG.md for ${version} is empty.\n`);
  process.exit(1);
}
process.stdout.write(`${notes}\n`);
