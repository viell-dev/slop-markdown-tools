# Examples

The repository's
[`examples/`](https://github.com/viell-dev/slop-markdown-tools/tree/main/examples)
directory holds working examples, and the package ships the same files under
`node_modules/mdrefine/examples/`. The tests compare every file and output on
this page with the tool.

The commands run from the root of a [built
checkout](https://github.com/viell-dev/slop-markdown-tools/blob/main/CONTRIBUTING.md#set-up).
With the installed package, use `npx mdtools` in place of
`node dist/cli/main.js`.

## Start from a configuration

Copy one of four starting configurations to the root of your documents as
`mdtools.config.jsonc`:

- [`examples/github.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/github.jsonc)
  for repositories rendered by GitHub.
- [`examples/forgejo.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/forgejo.jsonc)
  for Codeberg and other Forgejo instances.
- [`examples/gitea.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/gitea.jsonc)
  for Gitea instances.
- [`examples/obsidian.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/obsidian.jsonc)
  for Obsidian vaults, with links written as vault-relative paths.

Each wraps prose at 80 columns and chooses a link style; see
[configuration](configuration.md).

## Format a repository's documentation

`examples/workspaces/repository-docs/` holds a README and two guides twice:
`before/` as someone might write them, and `after/` exactly as `format --write`
leaves them. The configuration adds a rule that no preset enables:

[`examples/workspaces/repository-docs/before/mdtools.config.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/repository-docs/before/mdtools.config.jsonc):

```jsonc
{
  // Documentation for a repository hosted on GitHub.
  "extends": ["recommended", "github"],
  "rules": {
    // Write local links as ./relative paths, which editors can follow too.
    "links/path": ["warn", { "style": "relative", "leadingDot": true }],
  },
}
```

The README before formatting:

[`examples/workspaces/repository-docs/before/README.md`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/repository-docs/before/README.md):

```md
# Weather Station

Weather Station collects *temperature*, *humidity*, and *pressure* readings from a sensor board and publishes them as a small web page that updates every minute.

> [!note]
> Use matching firmware and page versions, or the page shows __no data__.

## Usage

Follow the [setup guide](docs/guide.md) first, then read the [sensor reference](docs/reference.md#pressure) to interpret the readings. The [calibration notes](docs/calibration.md) explain how to correct a drifting sensor.

## Status

| Sensor | Unit | Supported |
|---|---|---|
| Temperature | °C | Yes |
| Humidity | % | Yes |
| Pressure | hPa | Since 1.2 |

* [X] Publish readings every minute
* [ ] Keep a week of history
```

Preview the changes with `--diff`. To try `--write`, copy `before/` elsewhere
first.

```sh
node dist/cli/main.js format --root examples/workspaces/repository-docs/before --diff
```

The same README afterwards:

[`examples/workspaces/repository-docs/after/README.md`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/repository-docs/after/README.md):

```md
# Weather Station

Weather Station collects _temperature_, _humidity_, and _pressure_ readings from
a sensor board and publishes them as a small web page that updates every minute.

> [!NOTE]
> Use matching firmware and page versions, or the page shows **no data**.

## Usage

Follow the [setup guide](./docs/guide.md) first, then read the [sensor
reference](./docs/reference.md#pressure) to interpret the readings. The
[calibration notes](docs/calibration.md) explain how to correct a drifting
sensor.

## Status

| Sensor      | Unit | Supported |
| ----------- | ---- | --------- |
| Temperature | °C   | Yes       |
| Humidity    | %    | Yes       |
| Pressure    | hPa  | Since 1.2 |

- [x] Publish readings every minute
- [ ] Keep a week of history
```

Each change comes from one rule of the configuration:

- `style/wrap` reflowed prose to 80 columns. Tables, headings, and code blocks
  keep their lines.
- `style/emphasis` and `style/strong` chose `_` and `**`.
- `github/alert-marker` and `github/task-marker` normalized `[!note]` and `[X]`.
- `style/list-marker` wrote the task list with `-`.
- `style/table` aligned the table.
- `links/path` put `./` in front of the links it could resolve.
- In `docs/guide.md`, `style/heading` turned an underlined heading into a `#`
  heading, `style/ordered-list` wrote `1)` as `1.`, `style/list-indent` left one
  space after each number and moved the code block in the second step with the
  step's text, and `style/code-fence` wrote the block's `~~~` fence with
  backticks.
- In `docs/reference.md`, `style/heading` removed the closing `##` of a heading,
  `style/blank-lines` removed two repeated blank lines, and
  `style/final-newline` added the missing final newline.

The link to `docs/calibration.md`, a file that does not exist, did not change.
Formatting never guesses a target, so `lint` still reports it and exits with
code `1`:

```sh
node dist/cli/main.js lint --root examples/workspaces/repository-docs/after
```

```text
examples/workspaces/repository-docs/after/README.md:13:1: error links/valid: Missing local target: docs/calibration.md.
3 file(s) linted; 1 error(s), 0 warning(s).
```

## Format an Obsidian vault

`examples/workspaces/obsidian-vault/` is a small vault, again as `before/` and
`after/`. The configuration sits at the vault's root, next to `.obsidian/`,
whose `app.json` sets `"strictLineBreaks": true`, which [wrapping
needs](obsidian.md#enable-wrapping).

[`examples/workspaces/obsidian-vault/before/mdtools.config.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/obsidian-vault/before/mdtools.config.jsonc):

```jsonc
{
  // An Obsidian vault; this file sits at the vault's root, next to .obsidian/.
  "extends": ["recommended", "obsidian"],
  // Templates contain placeholders, not prose. They stay valid link targets.
  "ignore": ["Templates/**"],
  "rules": {
    // Spell Markdown links as vault-relative paths in angle brackets.
    "links/path": ["warn", { "style": "root", "brackets": "angle" }],
  },
}
```

The vault's home note before formatting:

[`examples/workspaces/obsidian-vault/before/Home.md`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/obsidian-vault/before/Home.md):

```md
# Home

This vault tracks the kitchen garden. Start with [[Tomatoes]] or jump straight to the [[Watering schedule#Summer|summer watering plan]].

> [!TIP] Reading the plant notes
> Every plant note begins with a summary callout and ends with a log. New notes start from the [plant template](Templates/Plant.md), which keeps them consistent.

## This week

- [X] Stake the tomatoes
- [ ] Order *more* seed trays

![[Tomatoes#^harvest]]
```

And afterwards:

[`examples/workspaces/obsidian-vault/after/Home.md`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/obsidian-vault/after/Home.md):

```md
# Home

This vault tracks the kitchen garden. Start with [[Tomatoes]] or jump straight
to the [[Garden/Watering schedule#Summer|summer watering plan]].

> [!tip] Reading the plant notes
> Every plant note begins with a summary callout and ends with a log. New notes
> start from the [plant template](<Templates/Plant.md>), which keeps them
> consistent.

## This week

- [x] Stake the tomatoes
- [ ] Order _more_ seed trays

![[Garden/Tomatoes#^harvest]]
```

What to notice:

- The callout type is lowercase, its title stays on its line, and its body is
  wrapped inside the quote.
- `[[Tomatoes]]` is unchanged, because its target is its visible text. The
  labeled wikilink and the embed do not show their target, so both now carry the
  vault-relative path.
- The Markdown link to the template is vault-relative, in angle brackets. The
  template itself is ignored: never linted or formatted, but still a link
  target.
- In `Garden/Tomatoes.md`, the paragraph ending in `^harvest` is not reflowed,
  because a block identifier belongs to its paragraph's last line.
- `Garden/Watering schedule.md` links to a note `Compost` that does not exist,
  which `lint` reports before and after formatting.

## Write a plugin

`examples/plugin/` adds two rules. A problem rule reports placeholder words. A
style rule writes one space between a heading's `#` marks and its text, and
leaves underlined headings alone. [Plugins](plugins.md) describes the contract.

[`examples/plugin/rules.mjs`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/plugin/rules.mjs):

```js
// A plugin with one problem rule and one style rule.
//
// Problem rules report findings and never change a document. Style rules may
// attach an edit, which `mdtools format` applies after checking that the
// document still means the same thing.

/** Visit `node` and everything below it. */
function visit(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) visit(child, visitor);
}

/** @type {import("mdrefine").Plugin} */
export default {
  name: "house",
  presets: {
    recommended: {
      rules: { "house/no-placeholder": "error", "house/heading-space": "warn" },
    },
  },
  rules: {
    "no-placeholder": {
      description: "Report placeholder words left in prose.",
      kind: "problem",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          words: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
        },
      },
      check({ document, options }) {
        const words = options.words ?? ["TODO", "TBD"];
        const findings = [];
        // Only plain text is searched. Code is skipped on purpose, and so is syntax
        // that a dialect parses into a node of its own, such as an Obsidian highlight.
        visit(document.tree, (node) => {
          if (node.type !== "text") return;
          const start = node.position.start.offset;
          const end = node.position.end.offset;
          // `node.value` is the text a reader sees. Where the source spells it with
          // escapes or character references, offsets into it do not fit the source,
          // so the finding then covers the whole run of text.
          const exact = document.source.slice(start, end) === node.value;
          for (const word of words) {
            let at = node.value.indexOf(word);
            while (at >= 0) {
              findings.push({
                start: exact ? start + at : start,
                end: exact ? start + at + word.length : end,
                message: `Replace the placeholder "${word}" before publishing.`,
              });
              at = exact ? node.value.indexOf(word, at + word.length) : -1;
            }
          }
        });
        return findings;
      },
    },
    "heading-space": {
      description: "Write one space between a heading's # marks and its text.",
      kind: "style",
      phase: "block",
      check({ document }) {
        const findings = [];
        visit(document.tree, (node) => {
          if (node.type !== "heading" || !node.children.length) return;
          const start = node.position.start.offset;
          const text = node.children[0].position.start.offset;
          const marks = document.source.slice(start, text);
          const wanted = `${"#".repeat(node.depth)} `;
          // Only a "#" heading starts with its marks: an underlined heading
          // starts with its text, and so the check below leaves it alone. The
          // parser drops the blank space before a heading's text, so changing
          // it cannot change what the heading says.
          if (!/^#+[ \t]+$/.test(marks) || marks === wanted) return;
          findings.push({
            start,
            end: text,
            message: "Write one space after the heading's # marks.",
            edit: { start, end: text, text: wanted },
          });
        });
        return findings;
      },
    },
  },
};
```

The configuration loads the plugin, enables its preset, and sets one rule's
options:

[`examples/plugin/mdtools.config.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/plugin/mdtools.config.jsonc):

```jsonc
{
  // Load the plugin beside this file, then enable its preset after the built-in one.
  "plugins": ["./rules.mjs"],
  "extends": ["recommended", "house/recommended"],
  "rules": {
    // Options are checked against the schema the rule declares.
    "house/no-placeholder": ["error", { "words": ["TODO", "TBD", "FIXME"] }],
  },
}
```

A note that triggers both rules:

[`examples/plugin/notes/release-checklist.md`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/plugin/notes/release-checklist.md):

```md
# Release checklist

Draft the announcement. TODO: add the download link.

Searching the notes with `grep TODO` is not reported: code is not prose.

##   Before publishing

Ask for a review.
```

Linting reports both, but not the `TODO` inside the code span:

```sh
node dist/cli/main.js lint --root examples/plugin
```

```text
examples/plugin/notes/release-checklist.md:3:25: error house/no-placeholder: Replace the placeholder "TODO" before publishing.
examples/plugin/notes/release-checklist.md:7:1: warn house/heading-space: Write one space after the heading's # marks.
1 file(s) linted; 1 error(s), 1 warning(s).
```

Formatting applies the style rule's edit and leaves the placeholder to a person:

```sh
node dist/cli/main.js format --root examples/plugin --diff
```

```text
===================================================================
--- a/examples/plugin/notes/release-checklist.md
+++ b/examples/plugin/notes/release-checklist.md
@@ -3,7 +3,7 @@
 Draft the announcement. TODO: add the download link.
 
 Searching the notes with `grep TODO` is not reported: code is not prose.
 
-##   Before publishing
+## Before publishing
 
 Ask for a review.
examples/plugin/notes/release-checklist.md:3:25: error house/no-placeholder: Replace the placeholder "TODO" before publishing.
1 file(s) processed; 1 would change.
```

## Call the library

The [library](api.md) takes and returns strings; it never reads or writes files.
The scripts import `mdrefine` by name, which works in a checkout and wherever
the package is installed.

[`examples/library/format-string.mjs`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/library/format-string.mjs):

```js
// Format one Markdown string through the library API.
//
//   node examples/library/format-string.mjs
import { format } from "mdrefine";

const source = "A *short* note with __strong__ words and no final newline.";

// Without `config`, the recommended preset applies and the GitHub dialect is
// assumed. Pass the same object you would write in mdtools.config.jsonc to
// choose a dialect or change rules.
const result = format(source, {
  config: {
    extends: ["recommended", "github"],
    rules: { "style/wrap": ["warn", { width: 40 }] },
  },
});

// `output` is the formatted text and `changed` says whether it differs from the
// input. `diagnostics` lists what is still wrong afterwards; it is empty here.
console.log(result.output);
console.log(`changed: ${result.changed}; remaining diagnostics: ${result.diagnostics.length}`);
```

```sh
node examples/library/format-string.mjs
```

```text
A _short_ note with **strong** words and
no final newline.

changed: true; remaining diagnostics: 0
```

To check links between documents, the script reads the files and passes them to
`createWorkspace()`:

[`examples/library/lint-folder.mjs`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/library/lint-folder.mjs):

```js
// Lint every Markdown file in a folder through the library API.
//
// The library never reads or writes files. The host reads them and hands them
// to createWorkspace(), which is what lets rules check links between documents.
// This script reads everything below the folder; a real host would skip folders
// such as .git and node_modules, as the CLI does. lint-workspace.mjs leaves that
// to discoverWorkspace() from "mdrefine/node".
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
// file, named .md or .markdown as the CLI finds them, maps to its text; any
// other file maps to null, so that links to it still resolve.
const files = {};
for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const absolute = path.join(entry.parentPath, entry.name);
  const name = path.relative(folder, absolute).split(path.sep).join("/");
  files[name] = /\.(?:md|markdown)$/i.test(name) ? await readFile(absolute, "utf8") : null;
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
```

Without an argument, the script lints the formatted repository example and finds
its one broken link:

```sh
node examples/library/lint-folder.mjs
```

```text
README.md:13:1 error links/valid: Missing local target: docs/calibration.md.
1 error(s)
```

`mdrefine/node` finds and selects the files as the CLI does, and prepares each
document's options:

[`examples/library/lint-workspace.mjs`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/library/lint-workspace.mjs):

```js
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
```

```sh
node examples/library/lint-workspace.mjs
```

```text
README.md:13:1 error links/valid: Missing local target: docs/calibration.md.
1 error(s) in 3 document(s)
```

## Automate checks

A GitHub Actions workflow for a repository that lists `mdrefine` in its
`devDependencies`; [integrations](integrations.md#continuous-integration) covers
Forgejo:

[`examples/automation/github-actions.yml`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/automation/github-actions.yml):

```yaml
# Check Markdown on every pull request.
#
# Copy to .github/workflows/markdown.yml in a repository that lists mdrefine in
# its devDependencies and has an mdtools.config.jsonc at its root.
name: Markdown
on:
  pull_request:
permissions:
  contents: read
jobs:
  markdown:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      # Fails on any diagnostic, including warnings.
      - run: npx --no-install mdtools lint --max-warnings 0
      # Fails if any file is not formatted; never writes.
      - run: npx --no-install mdtools format --check
```

The script
[`summarize-report.mjs`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/automation/summarize-report.mjs)
reads a `--json` report and counts diagnostics per rule:

```sh
node dist/cli/main.js lint --root examples/plugin --json | node examples/automation/summarize-report.mjs
```

```text
lint: 1 file(s), 2 diagnostic(s)
1 error house/no-placeholder in 1 file(s)
1 warn house/heading-space in 1 file(s)
```
