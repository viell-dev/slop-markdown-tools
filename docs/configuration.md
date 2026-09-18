# Configuration and rules

## Loading and precedence

Discovery searches upward from `--root` or the working directory for `mdtools.config.jsonc`,
`mdtools.config.json`, or `mdtools.config.mjs`. It stops at a Git repository, an Obsidian vault, or
the filesystem root. Multiple config files in one directory are an error. `--config` chooses one
explicitly. The configuration directory is the workspace root unless `--root` overrides it.

JSONC permits comments and trailing commas. JavaScript configuration exports a default object.
JavaScript configs and plugins execute code with the caller's permissions; load trusted code only.
Unknown configuration keys, rule IDs, preset names, and invalid built-in rule options are errors.

Presets merge in listed order, followed by the configuration's own settings, followed by matching
`overrides` in order. Each rule setting replaces the previous setting as a whole. Paths in overrides
and ignores use forward slashes relative to the workspace root. Presets can extend other presets;
cycles are rejected. Config files do not implicitly cascade or merge across directories.

`--dialect` replaces the top-level dialect; an explicit file override still takes precedence.
`config explain <file>` prints the resolved configuration and its source file.

```jsonc
{
  "extends": ["recommended", "github"],
  "ignore": ["generated/**"],
  "overrides": [
    {
      "files": ["vault/**/*.md"],
      "dialect": "obsidian",
      "rules": { "style/emphasis": "off" },
    },
  ],
}
```

For Obsidian reflow, use a workspace rooted at the vault so `.obsidian/app.json` can be inspected.
Multiple vaults with independent settings should be processed separately.

## Presets

| Preset        | Dialect   | Enabled rules                                                                                  |
| ------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `recommended` | Unchanged | Wrap at 80, `_` emphasis, `**` strong, final newline, valid links                              |
| `github`      | GitHub    | Table alignment, lowercase completed task marker, uppercase alert marker                       |
| `obsidian`    | Obsidian  | Table alignment, task marker, lowercase callout type, duplicate block IDs, soft-break settings |

An omitted `extends` selects `recommended`. Explicit `extends` replaces that default, so use
`["recommended", "obsidian"]` for both. `extends: []` enables nothing. Severity is `off`, `warn`, or
`error`; supply options as `["warn", { ... }]`. Both `warn` and `error` style rules format when
enabled. Problem rules report findings and never become formatting edits.

## Built-in rules

| Rule                          | Kind    | Options                                                   |
| ----------------------------- | ------- | --------------------------------------------------------- |
| `style/wrap`                  | Style   | `width`: integer 20–500, default 80                       |
| `style/emphasis`              | Style   | `marker`: `_` (default) or `*`                            |
| `style/strong`                | Style   | `marker`: `*` (default) or `_`                            |
| `style/final-newline`         | Style   | None; adds a missing final newline                        |
| `style/table`                 | Style   | None; aligns top-level GFM tables                         |
| `style/heading`               | Style   | None; converts eligible Setext headings to ATX            |
| `links/valid`                 | Problem | None; local files and heading/block fragments             |
| `links/path`                  | Style   | `style`, `brackets`, `extension`, `leadingDot`; see below |
| `links/notation`              | Style   | `style`: `markdown` or `wiki`; Obsidian only              |
| `github/task-marker`          | Style   | None; `[X]` becomes `[x]`                                 |
| `github/alert-marker`         | Style   | None; known GitHub alert types become uppercase           |
| `obsidian/callout-marker`     | Style   | None; Obsidian callout types become lowercase             |
| `obsidian/block-reference`    | Problem | None; duplicate trailing `^block-id` markers              |
| `obsidian/strict-line-breaks` | Problem | None; report unverified/incompatible reflow settings      |

## Link policies

```jsonc
{
  "extends": ["recommended", "obsidian"],
  "rules": {
    "links/path": ["warn", { "style": "root", "brackets": "angle", "extension": "preserve" }],
  },
}
```

`style` accepts `preserve` (default), `relative`, `root`, or `shortest`. `root` means
vault-relative, without a leading slash, and is available only for Obsidian. `shortest` uses the
basename if it resolves uniquely, otherwise the vault-relative path. `leadingDot: true` prefixes
ordinary relative paths with `./`. Filesystem absolute paths are not generated.

`brackets` accepts `preserve` (default), `angle`, or `bare`. Spaces in bare Markdown destinations
are percent-encoded. `extension` accepts `preserve` (default), `include`, or `omit`; omission is
Obsidian specific. Fragments are resolved according to the dialect, separately from percent-decoded
filenames.

Path edits require a resolved target and valid fragment. Unaliased ordinary wikilinks retain their
target spelling because changing it may change the visible label. Reference definitions are
validated but their source spelling is currently preserved.

`links/notation` converts simple explicit-label wikilinks to Markdown links and plain-text Markdown
links to wikilinks. Titles, rich labels, unaliased wikilinks, and embeds are preserved. A note embed
is not interchangeable with a Markdown image. Do not enable notation conversion and path rewriting
for the same link in one pass: overlapping edits are reported; run those policies in separate
passes.

Network URLs are recognized but never fetched. Website-root paths and query-bearing destinations in
CommonMark/GitHub are outside local resolution. Missing or ambiguous targets are reported, never
guessed. The conservative Obsidian resolver may report ambiguity where a particular Obsidian version
would select one candidate; shortest-name/alias resolution is not a complete clone of the app.

## Suppressions

<!-- prettier-ignore -->
```markdown
<!-- mdtools-disable style/wrap -->

Keep the wrapping in this region.

<!-- mdtools-enable style/wrap -->

<!-- mdtools-disable-next-line style/emphasis -->
Keep *this* delimiter.
```

Omit rule names to disable all rules. A disabled region suppresses edits intersecting it; a
paragraph spanning a disabled line is therefore preserved as a whole. An enable directive closes
matching disabled regions; `enable` without names closes all. Directives inside code are ordinary
code. `disable-next-line` targets the immediately following physical line, including a blank line;
place it directly above the content to suppress.

## Selection, output, and exit codes

Commands accept explicit files/directories, or no paths to select the workspace. The CLI honors
`.gitignore` files and configured ignore patterns. Config-ignored documents remain available for
link resolution; Git-ignored content is not indexed. `.git`, `.obsidian`, `node_modules`,
`.npm-cache`, `dist`, and `coverage` are excluded from traversal, as are nested Git repositories and
symlinks. Explicit symlink inputs are rejected. Shell-expanded globs work; the CLI does not expand
path globs.

`lint --json` and `format --json` print a single object with `version`, `mode`, `files`, and
`written`. Each file carries diagnostics with rule ID, severity, message, offsets, and one-based
line/column locations. Source offsets and columns use JavaScript UTF-16 units; wrapping widths use
display columns. Formatting diagnostics refer to the resulting source. `written` records whether the
requested write phase was allowed, not how many files changed; inspect each file's `changed` field.

`format --diff` is the default for file input. `--check`, `--diff`, and `--write` are mutually
exclusive. `format - --stdin-filepath notes/example.md` reads stdin with configuration and
resolution context; it cannot be used with `--write`.

| Exit | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | Completed; no errors or failed formatting check                                 |
| `1`  | Lint errors, exceeded `--max-warnings`, or changes required by `format --check` |
| `2`  | Configuration, execution, or formatting safety failure                          |

Warnings do not fail a command unless `--max-warnings` is supplied. A successful formatting command
can still report remaining lint problems. Inspect its exit code and diagnostics. An unsafe-format
diagnostic blocks the complete batch's write phase. An I/O error during writing can leave earlier
files written; replacement is atomic per file, not a workspace-wide transaction.

🤖 Generated with GPT-6 via Codex
