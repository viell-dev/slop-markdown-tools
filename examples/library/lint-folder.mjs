// Lint every Markdown file in a folder through the library API.
//
// The library never reads or writes files. The host reads them and hands them
// to createWorkspace(), which is what lets rules check links between documents.
// This script reads everything below the folder; a real host would skip folders
// such as .git and node_modules, as the CLI does.
//
//   node examples/library/lint-folder.mjs [folder]
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspace, lint } from "mdrefine";

const folder = path.resolve(
  process.argv[2] ?? fileURLToPath(new URL("../workspaces/repository-docs/after", import.meta.url)),
);
const config = { extends: ["recommended", "github"] };

// Workspace keys are forward-slash paths relative to the folder. A Markdown
// file maps to its text; any other file maps to null, so that links to it
// still resolve.
const files = {};
for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const absolute = path.join(entry.parentPath, entry.name);
  const name = path.relative(folder, absolute).split(path.sep).join("/");
  files[name] = /\.md$/i.test(name) ? await readFile(absolute, "utf8") : null;
}
const workspace = createWorkspace(files, { dialect: "github" });

let errors = 0;
for (const name of Object.keys(files).sort()) {
  const source = files[name];
  if (source === null) continue;
  for (const item of lint(source, { path: name, config, workspace })) {
    if (item.severity === "error") errors += 1;
    console.log(
      `${name}:${item.line}:${item.column} ${item.severity} ${item.rule}: ${item.message}`,
    );
  }
}
console.log(`${errors} error(s)`);
process.exitCode = errors > 0 ? 1 : 0;
