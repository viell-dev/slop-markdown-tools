# Changelog

Notable changes to mdrefine, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers
follow the
[versioning policy](https://viell-dev.github.io/slop-markdown-tools/versions.html).
Each release's section is also its
[GitHub release](https://github.com/viell-dev/slop-markdown-tools/releases)'s
notes; the prereleases' notes there are longer than their entries here.

## Unreleased

### Upgrading from a prerelease

From `0.2.0-rc.2`:

- `format --write` refuses a read-only file on every platform, where Linux and
  macOS used to replace it, and writes nothing when a file that would change may
  not be written. Make the file writable, or pass `--exclude` for it.
- A file that fails while the batch is written no longer stops the run: it gets
  an `engine/unwritable-file` error, the other files are written, and the exit
  code is `2`.
- A document that starts with a byte order mark gets its findings and edits at
  the right positions; before, it could be refused or get findings in the wrong
  places. In the library, `parse` now returns `document.source` without the
  mark, which the tree's positions already skipped.
- `mdtools-disable-next-line` and line numbers also count a carriage return
  alone as a line ending; before, such a directive could apply to the wrong
  line.
- A file locked by another program on Windows (`EBUSY`) is handled like one that
  may not be read, instead of stopping every command.

From `0.2.0-rc.1` or earlier, also:

- When nothing names a dialect, documents are read as GitHub Markdown, or as
  Obsidian notes inside a vault, where they used to be read as CommonMark. Name
  `"dialect": "commonmark"` to keep the old reading. The library's `lint`,
  `format`, `resolveConfig`, and `createWorkspace` assume `github` as well.
- `$…$` is math only under the conditions of each dialect's renderer; before,
  any text between two `$` signs was. Text that was left alone because of that
  is now wrapped and restyled like other prose.
- A directory that may not be read is skipped with a warning, and a selected
  document that may not be read gets an `engine/unreadable-file` error, where
  both used to stop the command with exit code `2` and no report. An
  `.obsidian/app.json` that cannot be read or is not valid JSON gives a warning,
  and the vault is not wrapped.
- In a vault below the workspace root, Obsidian links resolve from the vault's
  root and reach only its files. A workspace root inside a vault no longer
  counts as the whole vault, so links that the rest of the vault could affect
  are not rewritten.
- A plugin package is resolved as an `import` from the configuration file, with
  the conditions given to Node.js, so a package with both an `import` and a
  `require` entry loads through `import`.
- In the library, a source loader given to `createWorkspace` can be called more
  than once for the same file and must return the same text each time, and one
  that throws `EACCES` or `EPERM` makes the file unreadable instead of stopping
  the run.
- The `lint` summary counts errors and warnings, and messages about paths,
  configuration files, and plugins are worded differently. Exit codes and the
  JSON report keep their meaning.

From every prerelease:

- The command line, the configuration, the JSON report, and the library now
  follow the
  [versioning policy](https://viell-dev.github.io/slop-markdown-tools/versions.html).
  npm's `latest` tag names the newest stable release; release candidates no
  longer move it.

### Added

- `style/block-spacing` separates headings and lists from the blocks around them
  with a blank line
  ([#190](https://github.com/viell-dev/slop-markdown-tools/pull/190)).
- `lint` and `format` accept `ranges` to work on parts of a document, and
  `format` returns their `scope`
  ([#188](https://github.com/viell-dev/slop-markdown-tools/pull/188),
  [#195](https://github.com/viell-dev/slop-markdown-tools/pull/195)).
- `mdrefine/node` exports `discoverWorkspace()`, the CLI's discovery of files,
  with the example `examples/library/lint-workspace.mjs`
  ([#189](https://github.com/viell-dev/slop-markdown-tools/pull/189)).

### Changed

- `format --write` checks that every changed file may be written before it
  writes any, refuses read-only files on every platform, and reports a file that
  fails with `engine/unwritable-file`
  ([#177](https://github.com/viell-dev/slop-markdown-tools/pull/177)).
- A file locked by another program on Windows counts as one that may not be
  read, in the CLI and in `createWorkspace` loaders
  ([#177](https://github.com/viell-dev/slop-markdown-tools/pull/177)).

### Fixed

- Documents and JSON configuration files that start with a byte order mark are
  read correctly
  ([#174](https://github.com/viell-dev/slop-markdown-tools/pull/174)).
- `style/wrap` leaves paragraphs as written instead of refusing the document
  when their first word is a bare block marker
  ([#196](https://github.com/viell-dev/slop-markdown-tools/pull/196)), when an
  Obsidian paragraph holds `==`, `[[`, or `]]` outside its highlights and links,
  or when the first line is lazy
  ([#200](https://github.com/viell-dev/slop-markdown-tools/pull/200)).
- A carriage return alone ends a line for suppression directives, diagnostic
  positions, callout titles, and `style/wrap`
  ([#196](https://github.com/viell-dev/slop-markdown-tools/pull/196),
  [#200](https://github.com/viell-dev/slop-markdown-tools/pull/200)).
- The type declaration of `defaultDialect` describes vaults anywhere in a
  workspace ([#184](https://github.com/viell-dev/slop-markdown-tools/pull/184)),
  and the CLI guide explains stdin in PowerShell
  ([#182](https://github.com/viell-dev/slop-markdown-tools/pull/182)).

## 0.2.0-rc.2 - 2026-10-06

When nothing names a dialect, GitHub Markdown is assumed, or the Obsidian
dialect inside a vault. Vaults are recognized anywhere in a workspace, and their
links resolve within them. Directories and files that may not be read no longer
stop a run. `$` math follows each renderer. Plugin packages resolve like an
`import`. Messages are clearer, link checks need about half the memory, and the
package ships examples.
[Release notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.2.0-rc.2).

## 0.2.0-rc.1 - 2026-10-03

New `forgejo` and `gitea` dialects and presets, with `codeberg` as another name
for `forgejo`. Fragments are checked against the anchors that each renderer
generates, Forgejo and Gitea heading attributes are preserved, and
`forgejo/heading-id` reports ids that break rendering.
[Release notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.2.0-rc.1).

## 0.1.0-rc.1 - 2026-09-21

Five built-in rules no longer propose edits that made formatting refuse ordinary
documents. Obsidian links match without regard to case, new line breaks follow a
document's first line ending, and applying many edits takes linear time.
[Release notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-rc.1).

## 0.1.0-beta.4 - 2026-09-18

`style/wrap` wraps an Obsidian callout's body directly below its title, and
reports a long title with `reportUnbreakable`.
[Release notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.4).

## 0.1.0-beta.3 - 2026-09-18

`style/wrap`'s report options tell breakable prose from unbreakable atoms, and
formatting is more than twice as fast.
[Release notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.3).

## 0.1.0-beta.2 - 2026-09-18

New `style/inline-code` and `structure/initial-heading` rules, the `measure`,
`reportUnreflowed`, and `reportUnbreakable` options of `style/wrap`, the
`resolve` settings, and `--exclude`. Link resolution fixes, and workspaces with
source loaders.
[Release notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.2).

## 0.1.0-beta.1 - 2026-09-18

The first public release: `lint` and `format` for CommonMark, GitHub Markdown,
and Obsidian, with presets, overrides, suppression comments, plugins, and link
checks.
[Release notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.1).
