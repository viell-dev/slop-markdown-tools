# Examples

The repository's
[`examples/`](https://github.com/viell-dev/slop-markdown-tools/tree/main/examples)
folder holds working examples, and the npm package ships the same files under
`node_modules/mdrefine/examples/`. The test suite compares every file and every
output shown on this page with what the tool produces, so the page cannot drift
from the tool's behavior.

Commands are written for a
[built checkout](quick-start.md#install-from-the-repository) and run from its
root. With an installed package, use `npx --no-install mdtools` in place of
`node dist/cli/main.js`.

## Start from a configuration

Four files hold a starting configuration, one for each hosting profile. Copy one
to the root of your documents as `mdtools.config.jsonc`:

- [`examples/github.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/github.jsonc)
  for repositories rendered by GitHub.
- [`examples/forgejo.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/forgejo.jsonc)
  for Codeberg and other Forgejo instances.
- [`examples/gitea.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/gitea.jsonc)
  for Gitea instances.
- [`examples/obsidian.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/obsidian.jsonc)
  for Obsidian vaults, with links written as vault-root paths.

Each wraps prose at 80 columns and chooses a link style.
[Configuration and rules](configuration.md) explains the options.

## Format a repository's documentation

`examples/workspaces/repository-docs/` holds a README and two guides twice:
`before/` as someone might write them, and `after/` exactly as `format --write`
leaves them. Its configuration selects the GitHub profile and enables two rules
that no preset turns on:

[`examples/workspaces/repository-docs/before/mdtools.config.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/repository-docs/before/mdtools.config.jsonc):

```jsonc
{
  // Documentation for a repository hosted on GitHub.
  "extends": ["recommended", "github"],
  "rules": {
    // Not part of a preset: turn underlined headings into "#" headings.
    "style/heading": "warn",
    // Write local links as ./relative paths, which editors can follow too.
    "links/path": ["warn", { "style": "relative", "leadingDot": true }],
  },
}
```

The README before formatting:

[`examples/workspaces/repository-docs/before/README.md`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/repository-docs/before/README.md):

````md
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

- [X] Publish readings every minute
- [ ] Keep a week of history
````

Preview the changes with `--diff`. To apply them with `--write`, copy `before/`
somewhere else first so that the example stays as it is.

```sh
node dist/cli/main.js format --root examples/workspaces/repository-docs/before --diff
```

The same README afterwards:

[`examples/workspaces/repository-docs/after/README.md`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/repository-docs/after/README.md):

````md
# Weather Station

Weather Station collects _temperature_, _humidity_, and _pressure_ readings from
a sensor board and publishes them as a small web page that updates every minute.

> [!NOTE]
> Use matching firmware and page versions, or the page shows **no data**.

## Usage

Follow the [setup guide](./docs/guide.md) first, then read the
[sensor reference](./docs/reference.md#pressure) to interpret the readings. The
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
````

Each change comes from one rule of the configuration:

- `style/wrap` reflowed prose to 80 columns. Tables, headings, and code blocks
  keep their lines.
- `style/emphasis` and `style/strong` chose `_` and `**`.
- `github/alert-marker` and `github/task-marker` normalized `[!note]` and `[X]`.
- `style/table` aligned the table.
- `links/path` put `./` in front of the links it could resolve.
- In `docs/guide.md`, `style/heading` turned an underlined heading into a `#`
  heading, and `docs/reference.md` gained its missing final newline.

One thing did not change: the link to `docs/calibration.md`, a file that does
not exist. Formatting never guesses a target, so linting the formatted tree
still reports it, and exits with status `1`:

```sh
node dist/cli/main.js lint --root examples/workspaces/repository-docs/after
```

```text
README.md:13:1: error links/valid: Missing local target: docs/calibration.md.
3 file(s) linted; 0 would change.
```

## Format an Obsidian vault

`examples/workspaces/obsidian-vault/` is a small vault, again as `before/` and
`after/`. The configuration sits at the vault root, next to `.obsidian/`, whose
`app.json` sets `"strictLineBreaks": true`; without that setting the tool
[does not reflow prose](obsidian.md#enable-source-wrapping).

[`examples/workspaces/obsidian-vault/before/mdtools.config.jsonc`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/obsidian-vault/before/mdtools.config.jsonc):

```jsonc
{
  // An Obsidian vault; this file sits at the vault root, next to .obsidian/.
  "extends": ["recommended", "obsidian"],
  // Templates contain placeholders, not prose. They stay valid link targets.
  "ignore": ["Templates/**"],
  "rules": {
    // Spell Markdown links as vault-root paths in angle brackets.
    "links/path": ["warn", { "style": "root", "brackets": "angle" }],
  },
}
```

The vault's home note before formatting:

[`examples/workspaces/obsidian-vault/before/Home.md`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/obsidian-vault/before/Home.md):

````md
# Home

This vault tracks the kitchen garden. Start with [[Tomatoes]] or jump straight to the [[Watering schedule#Summer|summer watering plan]].

> [!TIP] Reading the plant notes
> Every plant note begins with a summary callout and ends with a log. New notes start from the [plant template](Templates/Plant.md), which keeps them consistent.

## This week

- [X] Stake the tomatoes
- [ ] Order *more* seed trays

![[Tomatoes#^harvest]]
````

And afterwards:

[`examples/workspaces/obsidian-vault/after/Home.md`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/workspaces/obsidian-vault/after/Home.md):

````md
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
````

What to notice:

- The callout type is lowercase, its title stays on its line, and its body is
  wrapped inside the quote.
- `[[Tomatoes]]` is unchanged, because rewriting an unaliased wikilink would
  change the text a reader sees. The aliased wikilink and the embed show no
  target, so both now carry the vault-root path.
- The Markdown link to the template uses a vault-root path in angle brackets, as
  `links/path` is configured. The template itself is ignored: it is never linted
  or formatted, but links to it still resolve.
- In `Garden/Tomatoes.md`, the paragraph ending in `^harvest` is not reflowed,
  because a block identifier belongs to its paragraph's last line.
- `Garden/Watering schedule.md` links to a note named `Compost` that does not
  exist. As in the repository example, `lint` reports it before and after
  formatting.

## Write a plugin

`examples/plugin/` adds two house rules to the built-in ones. A problem rule
reports placeholder words and never edits. A style rule rewrites thematic breaks
as `---`, but only where that cannot change what the document means.
[Plugins and library API](plugins.md) describes the contract.

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
      rules: { "house/no-placeholder": "error", "house/thematic-break": "warn" },
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
        // Only `text` nodes are prose; code spans and code blocks are other node types.
        visit(document.tree, (node) => {
          if (node.type !== "text") return;
          // Search the source rather than `node.value`, so offsets stay exact
          // when the text contains escapes or character references.
          const start = node.position.start.offset;
          const source = document.source.slice(start, node.position.end.offset);
          for (const word of words) {
            for (let at = source.indexOf(word); at >= 0; at = source.indexOf(word, at + 1)) {
              findings.push({
                start: start + at,
                end: start + at + word.length,
                message: `Replace the placeholder "${word}" before publishing.`,
              });
            }
          }
        });
        return findings;
      },
    },
    "thematic-break": {
      description: "Write thematic breaks as three hyphens.",
      kind: "style",
      phase: "block",
      check({ document }) {
        const findings = [];
        const blocks = document.tree.children;
        for (const [index, node] of blocks.entries()) {
          if (node.type !== "thematicBreak") continue;
          const start = node.position.start.offset;
          const end = node.position.end.offset;
          if (document.source.slice(start, end) === "---") continue;
          // "---" directly below a paragraph would turn that paragraph into a
          // heading, and at the top of a document it could open front matter.
          // Only propose the edit after a blank line, where neither can happen.
          const previous = blocks[index - 1];
          const safe = previous && previous.position.end.line < node.position.start.line - 1;
          findings.push({
            start,
            end,
            message: "Write this thematic break as ---.",
            ...(safe ? { edit: { start, end, text: "---" } } : {}),
          });
        }
        return findings;
      },
    },
  },
};
```

The configuration loads the plugin, enables its preset, and passes options to
one rule:

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

````md
# Release checklist

Draft the announcement. TODO: add the download link.

Searching the notes with `grep TODO` is not reported: code is not prose.

***

Ask for a review before publishing.
````

Linting reports both, and does not report the `TODO` inside the code span:

```sh
node dist/cli/main.js lint --root examples/plugin
```

```text
notes/release-checklist.md:3:25: error house/no-placeholder: Replace the placeholder "TODO" before publishing.
notes/release-checklist.md:7:1: warn house/thematic-break: Write this thematic break as ---.
1 file(s) linted; 0 would change.
```

Formatting applies the style rule's edit and leaves the placeholder for a
person:

```sh
node dist/cli/main.js format --root examples/plugin --diff
```

```text
===================================================================
--- a/notes/release-checklist.md
+++ b/notes/release-checklist.md
@@ -3,7 +3,7 @@
 Draft the announcement. TODO: add the download link.
 
 Searching the notes with `grep TODO` is not reported: code is not prose.
 
-***
+---
 
 Ask for a review before publishing.
notes/release-checklist.md:3:25: error house/no-placeholder: Replace the placeholder "TODO" before publishing.
1 file(s) processed; 1 would change.
```

## Call the library

The library takes strings and returns strings; it never reads or writes files.
The scripts import `mdrefine` by name, which works in a checkout and wherever
the package is installed.

[`examples/library/format-string.mjs`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/library/format-string.mjs):

```js
// Format one Markdown string through the library API.
//
//   node examples/library/format-string.mjs
import { format } from "mdrefine";

const source = "A *short* note with __strong__ words and no final newline.";

// Without `config`, the recommended preset applies. Pass the same object you
// would write in mdtools.config.jsonc to choose a dialect or change rules.
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

To check links between documents, the host reads the files and passes them to
`createWorkspace()`:

[`examples/library/lint-folder.mjs`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/library/lint-folder.mjs):

```js
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
  files[name] = name.endsWith(".md") ? await readFile(absolute, "utf8") : null;
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

## Automate checks

A workflow for a repository that lists `mdrefine` in its `devDependencies` and
has an `mdtools.config.jsonc` at its root:

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

For scripts and agents, `--json` prints one report object instead of text.
[`summarize-report.mjs`](https://github.com/viell-dev/slop-markdown-tools/blob/main/examples/automation/summarize-report.mjs)
reads that report and counts diagnostics per rule:

```sh
node dist/cli/main.js lint --root examples/plugin --json | node examples/automation/summarize-report.mjs
```

```text
lint: 1 file(s), 2 diagnostic(s)
1 error house/no-placeholder in 1 file(s)
1 warn house/thematic-break in 1 file(s)
```

[CLI workflows](cli.md) covers file selection, exit codes, and stdin;
[configuration and rules](configuration.md) lists every rule and option.
