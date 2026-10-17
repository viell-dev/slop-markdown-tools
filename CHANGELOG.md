# Changelog

Notable changes to mdrefine, newest first. The format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow the
[versioning
policy](https://viell-dev.github.io/slop-markdown-tools/versions.html). Each
release's section is also its [GitHub
release](https://github.com/viell-dev/slop-markdown-tools/releases)'s notes; the
prereleases' notes there are longer than their entries here.

## Unreleased

### Upgrading from a prerelease

From `0.2.0-rc.2`:

- `format --write` refuses a read-only file on every platform, where Linux and
  macOS used to replace it: the file gets an `engine/unwritable-file` error and
  stays unchanged. Make the file writable to format it.
- One document that cannot be read or written, or that a rule was refused or
  failed on, no longer keeps `format --write` from writing the others. Every
  document that formatted is written, that one with the edits that were kept;
  each problem is reported for its own file, and the exit code is still `2`.
  Before, such a document kept every file from being written, and a file that
  failed while the batch was written stopped the run. Pass `--exclude` to leave
  a file alone.
- In the JSON report, `written` lists the files that were written instead of
  being `true` or `false`. A script that tested it as a boolean must test its
  length, because an empty list counts as true in JavaScript.
- A document that starts with a byte order mark gets its findings and edits at
  the right positions; before, it could be refused or get findings in the wrong
  places. In the library, `parse` now returns `document.source` without the
  mark, which the tree's positions already skipped.
- `mdtools-disable-next-line` and line numbers also count a carriage return
  alone as a line ending; before, such a directive could apply to the wrong
  line.
- A file locked by another program on Windows (`EBUSY`) is handled like one that
  may not be read, instead of stopping every command.
- A document that is not UTF-8 text gets an `engine/unreadable-file` error, and
  stdin that is not stops the command with exit code `2`. Before, such text was
  decoded with U+FFFD in place of what was not UTF-8, and `format --write` wrote
  those characters into the file. Save such files as UTF-8.
- `format --write` writes each file into the existing file instead of replacing
  it with a new one, so the file keeps its permissions, owner and group,
  attributes, creation time, and hard links. Before, a replaced file lost what
  Node.js cannot copy: the other names of a hard link kept the old content, and
  on Windows the file's own permissions were dropped, which could let more users
  read it. A crash or power failure during the write can now leave a file
  incomplete; see [what writing
  keeps](https://viell-dev.github.io/slop-markdown-tools/cli.html#what-writing-keeps).
- When a rule's edits would change a document's meaning, `format` keeps the
  other rules' edits, so `--diff` and the library's output show them, and
  reports that rule with `engine/unsafe-format` at the line where the meaning
  would first differ. Before, the whole document was left unchanged. Edits of
  two rules that overlap are applied in turn instead of refusing the document.
- A mistake on the command line, such as an unknown option or command or a
  missing option value, exits with code `2` instead of `1`, the code for
  findings, and so does `mdtools` without a command, which prints the help on
  stderr.
- The text output and the diff name files from the current directory instead of
  the workspace root. The JSON report keeps paths from the root and adds `root`.
- `config explain` names the configuration file `config` instead of `file`, adds
  the document's `path`, and refuses a document outside the workspace. `config`
  no longer accepts `--exclude`, `--json`, `--stdin-filepath`, and
  `--max-warnings`, which did nothing there.
- A rule that throws or returns invalid findings is skipped for that document
  with an `engine/rule-error` error, in `lint` as well, and the exit code is
  `2`. Before, `lint` stopped at the first such rule, and `format` reported it
  as `engine/unsafe-format`. A plugin rule with an invalid definition, such as
  `phase: "Inline"`, stops the command with exit code `2` where it used to be
  ignored, and a rule or preset named like a built-in property of every object,
  such as `toString`, is reported as unknown.
- `recommended` warns about six more problems, listed under Added. A check that
  runs `lint --max-warnings 0` fails on them until the documents are fixed or
  the rules are turned off.
- `.gitignore` files decide as in Git: a deeper file can include again what a
  higher one excludes, and patterns match letter case exactly on Linux. Files
  that were left out before can be linted now, and the reverse.
- `.markdown` files are documents, and a file named on the command line is read
  as Markdown whatever its name. A hook that passes every changed file should
  pass only the Markdown ones.
- An input that does not exist and contains `*`, `?`, `[`, or `{` is a pattern,
  and is an error only when it matches no document.
- `.npm-cache` is an ordinary directory, linted like any other unless
  `.gitignore` or `ignore` leaves it out.
- `style/wrap` wraps more: across line breaks in links, emphasis, and code
  spans, inside the text of links and emphasis, in the bodies of GitHub,
  Forgejo, and Gitea alerts, and before words such as `--config` or
  `**strong**`. A check that runs `format --check` fails on documents formatted
  by an earlier version until `format --write` runs once.

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
  follow the [versioning
  policy](https://viell-dev.github.io/slop-markdown-tools/versions.html). npm's
  `latest` tag names the newest stable release; release candidates no longer
  move it.

### Added

- `--quiet` reports errors only, and `rules` lists the rules of the
  configuration's plugins too, also as JSON with `--json`
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- Nine problem rules: `links/undefined-reference`, `links/unused-definition`,
  `links/empty`, `structure/heading-increment`, `content/image-alt`, and
  `content/table-columns` in `recommended`, and the optional
  `content/code-language`, `structure/single-title`, and
  `structure/duplicate-heading`
  ([#237](https://github.com/viell-dev/slop-markdown-tools/pull/237)).
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
- Glob patterns as inputs, such as `mdtools lint "docs/**/*.md"`, expanded by
  the CLI itself on every system
  ([#239](https://github.com/viell-dev/slop-markdown-tools/pull/239)).

### Changed

- A mistake on the command line exits with code `2`, as in ESLint and Prettier
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- The text output names files from the current directory, and the JSON report
  gives the workspace `root`
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- `format --check` names the files that would change
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- The help describes every command and lists only the options that each one
  reads, an unknown dialect gets the list of dialects, `lint --fix` points to
  `format --write`, `config explain` reports `config` and `path` and refuses
  documents outside the workspace, and the `obsidian/strict-line-breaks` message
  speaks to both command-line and library users
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- `format --write` refuses read-only files on every platform, and reports a file
  that fails with `engine/unwritable-file`
  ([#177](https://github.com/viell-dev/slop-markdown-tools/pull/177)).
- A file locked by another program on Windows counts as one that may not be
  read, in the CLI and in `createWorkspace` loaders
  ([#177](https://github.com/viell-dev/slop-markdown-tools/pull/177)).
- Documents and stdin that are not UTF-8 text are refused instead of being
  damaged, and `createWorkspace` treats a loader error with the code
  `ERR_ENCODING_INVALID_ENCODED_DATA` as an unreadable target
  ([#234](https://github.com/viell-dev/slop-markdown-tools/pull/234)).
- `format --write` writes into the existing file instead of replacing it, so
  that the file keeps its permissions, attributes, owner, creation time, and
  hard links, and writes the original content back when a write fails part way
  ([#234](https://github.com/viell-dev/slop-markdown-tools/pull/234),
  [#255](https://github.com/viell-dev/slop-markdown-tools/pull/255)).
- `format --write` writes every document that formatted, and reports a document
  that could not be read, formatted as configured, or written for its own file;
  the JSON report's `written` lists the files written
  ([#255](https://github.com/viell-dev/slop-markdown-tools/pull/255)).
- The documentation is restructured, with new pages for the rules, dialects,
  integrations, the library API, versions, and this changelog, and the release
  notes come from this file
  ([#238](https://github.com/viell-dev/slop-markdown-tools/pull/238)).
- When one rule's edits would change a document's meaning, `format` leaves out
  only that rule's edits and names the rule and the line, and it applies
  overlapping edits in turn
  ([#241](https://github.com/viell-dev/slop-markdown-tools/pull/241)).
- Plugin rule option schemas are compiled once instead of for every document
  ([#241](https://github.com/viell-dev/slop-markdown-tools/pull/241)).
- `.markdown` files are documents and link targets, and a file named on the
  command line is read as Markdown whatever its name
  ([#239](https://github.com/viell-dev/slop-markdown-tools/pull/239)).
- CI tests Node.js 22.12.0, the lowest supported version, where it tested the
  newest Node.js 22, and also tests Node.js 26
  ([#257](https://github.com/viell-dev/slop-markdown-tools/pull/257)).
- The documentation site describes the newest stable release instead of the
  unreleased state of `main`
  ([#257](https://github.com/viell-dev/slop-markdown-tools/pull/257)).
- `style/wrap` reflows a paragraph with a line break inside a link's text, an
  image description, emphasis, strong text, strikethrough, or a code span, and
  can break lines inside the text of links and emphasis
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).
- `style/wrap` wraps the body of a GitHub, Forgejo, or Gitea alert below the
  line with its marker, as it does for Obsidian callouts
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).

### Fixed

- `--dialect` works with an `.mjs` configuration that exports a frozen object
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- `--stdin-filepath` accepts a document inside a root that is reached through a
  link or a Windows junction
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- Documents and JSON configuration files that start with a byte order mark are
  read correctly
  ([#174](https://github.com/viell-dev/slop-markdown-tools/pull/174)).
- `style/wrap` leaves paragraphs as written instead of refusing the document
  when their first word is a bare block marker
  ([#196](https://github.com/viell-dev/slop-markdown-tools/pull/196)), when an
  Obsidian paragraph holds `==`, `[[`, or `]]` outside its highlights and links,
  or when the first line is lazy
  ([#200](https://github.com/viell-dev/slop-markdown-tools/pull/200)).
- `style/wrap` lets words that only start like a block marker, such as
  `--config`, `#tag`, or `-5`, begin a line, and keeps a table delimiter row
  from beginning one
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).
- `style/wrap` keeps a paragraph's first line from becoming a link reference
  definition, a thematic break, or display math instead of refusing the document
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).
- `style/wrap` counts a tab in a list item's prefix up to the next tab stop
  instead of as no width
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).
- A carriage return alone ends a line for suppression directives, diagnostic
  positions, callout titles, and `style/wrap`
  ([#196](https://github.com/viell-dev/slop-markdown-tools/pull/196),
  [#200](https://github.com/viell-dev/slop-markdown-tools/pull/200)).
- A rule that throws or returns invalid findings is reported as
  `engine/rule-error` for its document, and invalid plugin rules and names such
  as `toString` are rejected with a clear message
  ([#241](https://github.com/viell-dev/slop-markdown-tools/pull/241)).
- `.gitignore` files are applied as Git applies them, with negations in deeper
  files and letter case per platform
  ([#239](https://github.com/viell-dev/slop-markdown-tools/pull/239)).
- A file or directory named on the command line that is ignored gets a warning
  that says why, instead of being skipped without a word
  ([#239](https://github.com/viell-dev/slop-markdown-tools/pull/239)).
- A link into `dist`, `coverage`, `node_modules`, or another directory that is
  not processed, or through a symbolic link or junction, is checked on disk
  instead of being reported missing; one that leads outside the workspace root
  cannot be checked
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- An Obsidian block identifier counts only at the end of a block and holds
  letters, digits, and hyphens, in every rule that reads one
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- A vault's `.obsidian/app.json` that starts with a byte order mark is read
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- `links/notation` decodes percent escapes when it makes a wikilink
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- A link to a file that is not Markdown accepts any fragment, such as an image's
  `#gh-dark-mode-only` or a PDF's `#page=2`
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- An Obsidian wikilink never resolves to a folder
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- Obsidian links to a heading below another, `[[Note#Setup#Mobile]]`, are
  resolved ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- An Obsidian heading link matches the heading's source text, with its
  backticks, as well as its visible text
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
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
package ships examples. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.2.0-rc.2).

## 0.2.0-rc.1 - 2026-10-03

New `forgejo` and `gitea` dialects and presets, with `codeberg` as another name
for `forgejo`. Fragments are checked against the anchors that each renderer
generates, Forgejo and Gitea heading attributes are preserved, and
`forgejo/heading-id` reports ids that break rendering. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.2.0-rc.1).

## 0.1.0-rc.1 - 2026-09-21

Five built-in rules no longer propose edits that made formatting refuse ordinary
documents. Obsidian links match without regard to case, new line breaks follow a
document's first line ending, and applying many edits takes linear time.
[Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-rc.1).

## 0.1.0-beta.4 - 2026-09-18

`style/wrap` wraps an Obsidian callout's body directly below its title, and
reports a long title with `reportUnbreakable`. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.4).

## 0.1.0-beta.3 - 2026-09-18

`style/wrap`'s report options tell breakable prose from unbreakable atoms, and
formatting is more than twice as fast. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.3).

## 0.1.0-beta.2 - 2026-09-18

New `style/inline-code` and `structure/initial-heading` rules, the `measure`,
`reportUnreflowed`, and `reportUnbreakable` options of `style/wrap`, the
`resolve` settings, and `--exclude`. Link resolution fixes, and workspaces with
source loaders. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.2).

## 0.1.0-beta.1 - 2026-09-18

The first public release: `lint` and `format` for CommonMark, GitHub Markdown,
and Obsidian, with presets, overrides, suppression comments, plugins, and link
checks. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.1).
