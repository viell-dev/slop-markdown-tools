# CLI workflows

Examples use the built checkout. The installed executable is named `mdtools`;
`node dist/cli/main.js` invokes the same CLI without a global installation.

## Select files

With no file arguments, commands process the workspace. Pass files or
directories to narrow the selection while retaining the workspace for link
resolution:

```sh
node dist/cli/main.js lint --root /path/to/documents /path/to/documents/notes/example.md
node dist/cli/main.js format --root /path/to/documents /path/to/documents/notes --diff
```

Input paths are absolute or relative to the current working directory. The CLI
honors `.gitignore` and configuration ignore patterns, skips symlinks and nested
repositories, and does not expand path globs itself. See the
[selection details](configuration.md#selection-output-and-exit-codes).

A directory that the tool is not permitted to read is skipped with a warning
that names it, and the rest of the workspace is processed. Naming such a
directory as an input is an error. See
[paths that cannot be read](configuration.md#paths-that-cannot-be-read).
Versions up to `0.2.0-rc.1` stopped every command instead.

Use a caller or Git hook to choose changed or staged paths and pass them as
explicit file arguments. The CLI processes working-tree contents, not the Git
index. Pass paths as separate arguments (after `--` when they could begin with
`-`), retain `--root` for workspace-wide link resolution, and skip the
invocation when the selection is empty: no file arguments means the whole
workspace.

```sh
node dist/cli/main.js lint --exclude generated
node dist/cli/main.js format --exclude notes/archive.md --exclude vendor --diff
```

Repeat `--exclude <path>` to omit exact files or directory subtrees from any
file selection. Exclusions are literal paths relative to the current directory
(or absolute paths), must be inside the workspace, and do not remove link
targets from the index. They cannot be combined with stdin. Config ignores and
repository boundaries still apply to all selections.

## Use an explicit configuration

```sh
node dist/cli/main.js lint --root /path/to/documents --config /path/to/mdtools.config.jsonc
node dist/cli/main.js config --root /path/to/documents explain /path/to/documents/notes/example.md
node dist/cli/main.js rules
```

`config explain` shows the configuration resolved for a document, including path
overrides and the dialect in use. `rules` lists available rules. JavaScript
configuration and plugins execute code with the caller's permissions, so load
trusted code only.

`--dialect <name>` selects the dialect for one invocation of `lint`, `format`,
or `config`, replacing the configuration's top-level dialect. When neither the
configuration nor `--dialect` names a dialect, the commands assume `obsidian` if
the workspace root is an Obsidian vault and `github` otherwise, also for stdin;
version 0.2.0-rc.1 and earlier assumed `commonmark`. See
[dialects](configuration.md#dialects).

## Check documents in CI

After installing and building the checkout, run both checks against your
document workspace:

```sh
node dist/cli/main.js lint --root /path/to/documents --max-warnings 0
node dist/cli/main.js format --root /path/to/documents --check
```

Lint catches enabled problem and style rules. Format checking verifies that the
formatter would leave the selected documents unchanged. Neither command writes.
The [examples](examples.md#automate-checks) include a GitHub Actions workflow
that runs both checks on every pull request, and a script that summarizes a JSON
report.

## Work with agents and scripts

```sh
node dist/cli/main.js lint --root /path/to/documents --json
node dist/cli/main.js format --root /path/to/documents --check --json
```

JSON output contains file results and diagnostics with rule IDs, severity,
messages, and source positions. When the run skipped a directory or a settings
file that it was not permitted to read, the report also has a `skipped` list.
Each entry has the `path` relative to the workspace root, a `type` of
`directory` or `file`, the system's error `code`, and a `message` saying what
follows from it. The field is absent when nothing was skipped, and versions up
to `0.2.0-rc.1` never print it. Exit code `0` means success, `1` means a lint or
formatting check failed, and `2` means a configuration, execution, or safety
failure. Warnings fail only when they exceed `--max-warnings`. A selected
document that the tool is not permitted to read is reported with an
`engine/unreadable-file` error for that file; the other files are processed,
nothing is written, and the exit code is `2`. Versions up to `0.2.0-rc.1`
stopped without a report.

For a formatting pass, inspect a diff, apply it with `--write`, then run the
checks again. Report reproducible document defects using a synthetic example;
see [contributing](contributing.md). Automatic issue reporting is not built in.

## Read from stdin

```sh
node dist/cli/main.js format - --stdin-filepath notes/example.md < input.md > output.md
```

`--stdin-filepath` supplies the path used for configuration and link resolution.
Stdin formatting writes Markdown to stdout and diagnostics to stderr unless
`--json` is selected. It cannot be combined with `--write`.
