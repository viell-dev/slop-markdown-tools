// Lint a workspace on disk through the library, choosing files as the CLI does.
//
// discoverWorkspace() from "mdrefine/node" finds the files, honors .gitignore
// files and the configuration's ignore patterns, leaves out nested
// repositories and what it may not read, and recognizes Obsidian vaults.
// options() then gives each document what the CLI passes to lint() and
// format(). Configuration files are not read: pass the configuration.
//
//   node examples/library/lint-workspace.mjs [folder]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "mdrefine";
import { discoverWorkspace } from "mdrefine/node";

const root = path.resolve(
  process.argv[2] ?? fileURLToPath(new URL("../workspaces/repository-docs/after", import.meta.url)),
);
const config = { extends: ["recommended", "github"] };

const discovery = await discoverWorkspace({ root, config });
for (const item of discovery.skipped) console.log(`skipped: ${item.message}`);
let errors = 0;
for (const name of discovery.selected) {
  for (const item of lint(discovery.read(name), discovery.options(name))) {
    if (item.severity === "error") errors += 1;
    console.log(
      `${name}:${item.line}:${item.column} ${item.severity} ${item.rule}: ${item.message}`,
    );
  }
}
console.log(`${errors} error(s) in ${discovery.selected.length} document(s)`);
process.exitCode = errors > 0 ? 1 : 0;
