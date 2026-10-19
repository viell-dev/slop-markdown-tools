# Changelog

Notable changes to mdrefine, newest first. The format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow the
[versioning
policy](https://viell-dev.github.io/slop-markdown-tools/versions.html). Each
release's section is also its [GitHub
release](https://github.com/viell-dev/slop-markdown-tools/releases)'s notes; the
prereleases' notes there are longer than their entries here.

## Unreleased

### Fixed

- In the Obsidian dialect, `style/wrap` keeps an inline footnote, `^[…]`, on one
  line, and keeps the lines of a paragraph with one that spans lines. Live
  Preview shows an inline footnote whose text spans lines as Markdown source,
  and the rule broke lines inside it.
- In the Obsidian dialect, `style/emphasis` and `style/strong` keep the markers
  of a paragraph, heading, or table cell whose text holds a `*` or `_` that is
  not a marker, as in `snake_case` or `5 * 3`. Obsidian's Reading view pairs
  such a character with a later one: after `snake_case and *em*` became
  `snake_case and _em_`, Reading view showed `case and _em` as emphasis.
- `links/path` with `leadingDot` keeps `./` before a name that starts with a
  dot, such as `./.gitignore` or `./.github/`, and adds it there. Before, it
  took such a path for one that already started with `./` and removed the `./`
  ([#365](https://github.com/viell-dev/slop-markdown-tools/pull/365)).

## 0.2.4 - 2026-10-19

### Fixed

- In the Forgejo and Gitea dialects, no rule changes a definition description
  any more, a line starting with `: ` below its term, or the blocks indented
  below it. Forgejo and Gitea read the description as blocks, where the parser
  reads text: `style/emphasis` changed code in a fenced block there and the
  anchor of a heading, and the list rules moved a list out of the description
  ([#354](https://github.com/viell-dev/slop-markdown-tools/pull/354)).

## 0.2.3 - 2026-10-19

### Fixed

- `style/block-spacing` adds no blank line below a list whose last item ends in
  a fenced code block without its closing fence. Renderers put that line into
  the code, while the parser does not, so the safety check did not see the
  change ([#351](https://github.com/viell-dev/slop-markdown-tools/pull/351)).
- `style/block-spacing` adds no blank line between text that the parser reads as
  an underlined heading in place of a list, at the end of a list item or block
  quote, and text on the line below it. Renderers read that text as more of the
  list item's text, and the blank line split it off
  ([#351](https://github.com/viell-dev/slop-markdown-tools/pull/351)).
- `links/path` and `links/notation` write a `|` in a table cell as `\|`, because
  one that is not escaped ends the cell. Before, `links/path` wrote every
  wikilink it rewrote with a plain `|`, so that it also reported one whose
  destination already had the configured form, and wrote a `|` from a file or
  folder name into a new destination; `links/notation` wrote a plain `|` into a
  new wikilink or Markdown label. The safety check refused those edits, and with
  them all of the rule's other edits in the document. `links/path` now changes
  only a wikilink's destination and keeps the rest as written, also outside
  tables ([#349](https://github.com/viell-dev/slop-markdown-tools/pull/349)).

## 0.2.2 - 2026-10-18

### Fixed

- Formatting leaves a list that the parser reads as text as written, with the
  blocks indented below it and the list after them. The parser reads a list that
  does not start at 1, or an empty item, as text at the start of a list item or
  block quote below a paragraph and after an indented code block, where GitHub
  reads a list. Before, `style/ordered-list` and `style/list-marker` joined the
  next list to it, `style/list-indent` moved a list out of its items,
  `style/emphasis` changed what GitHub shows as code, `style/heading` made a
  heading of it, and `style/block-spacing` made it loose. Every rule's edits in
  such text are now left out, plugins' too. `style/block-spacing` now separates
  text from a list such as `- 1. Step`, which the parser reads as GitHub does
  ([#341](https://github.com/viell-dev/slop-markdown-tools/pull/341)).
- `style/wrap` leaves a paragraph as written when a code span in it continues on
  an indented lazy continuation line, as after `>* ` without a space. Before,
  the safety check refused all of the rule's edits in such a document
  ([#340](https://github.com/viell-dev/slop-markdown-tools/pull/340)).
- `github/alert-marker` no longer capitalizes a marker that GitHub shows as
  text: in a block quote inside another quote or a list, with text after the
  marker on its line, or with nothing below it. Before, the visible text changed
  ([#337](https://github.com/viell-dev/slop-markdown-tools/pull/337)).
- `style/wrap` and `style/inline-code` keep a code span written across lines as
  written when a line inside it ends with a backslash. Where its backticks do
  not pair, as on GitHub after an unpaired longer run, that backslash is a hard
  line break, which joining turned into a literal backslash
  ([#337](https://github.com/viell-dev/slop-markdown-tools/pull/337)).
- `style/thematic-break` no longer writes `---` directly below display math,
  which GitHub builds from a paragraph and read as a heading
  ([#337](https://github.com/viell-dev/slop-markdown-tools/pull/337)).
- Formatting no longer changes what GitHub, Forgejo, Gitea, and Obsidian show
  for the block directly below TOML front matter. They read the front matter's
  lines as a paragraph, which that block can continue or underline as a heading:
  `style/thematic-break` wrote `---` there, which made the front matter a
  heading, and `style/heading` split such a heading in two. The safety check now
  also compares the reading without TOML front matter, and the rules leave such
  a block as written
  ([#338](https://github.com/viell-dev/slop-markdown-tools/pull/338)).

## 0.2.1 - 2026-10-18

### Fixed

- The Obsidian dialect reads strikethrough with two tildes only, as Obsidian
  shows it; `~a~` is text there. Before, `style/emphasis` left emphasis that the
  misread strikethrough covered unchanged
  ([#327](https://github.com/viell-dev/slop-markdown-tools/pull/327)).
- `style/emphasis` and `style/strong` no longer change markers that GitHub reads
  otherwise than the parser: after an earlier emphasis, in `~~b *c~~ d*`, where
  GitHub shows the asterisks as text; next to tildes, in `x~~*b b*~~`, where a
  `_` would be text on GitHub; and in runs of markers that the parser pairs
  otherwise than CommonMark, as in `xab***a* a*y`. Each rewrite changed what
  GitHub showed while the safety check, which uses the parser's reading, saw no
  change ([#327](https://github.com/viell-dev/slop-markdown-tools/pull/327)).

## 0.2.0 - 2026-10-18

The first stable release. It holds everything in the earlier prereleases, and
the changes since `0.2.0-rc.3` listed here. From this release on, npm's `latest`
tag names the newest stable release, and prereleases stay under `rc` and `beta`;
the [versioning
policy](https://viell-dev.github.io/slop-markdown-tools/versions.html) says what
a version number promises.

### Upgrading from a prerelease

From `0.2.0-rc.3`:

- In the Obsidian dialect, `format` no longer breaks lines inside the text of a
  link, and joins link text that is written across lines, also where
  `0.2.0-rc.3` broke it. Notes that `0.2.0-rc.3` formatted change again: run
  `format --write` once after upgrading.
- A document from stdin whose `--stdin-filepath` is ignored is no longer
  processed: `lint -` reports nothing and `format -` prints it unchanged, with a
  warning. In `mdrefine/node`, `discoverWorkspace` no longer selects `documents`
  whose paths are ignored but lists them in `skipped`.

From an earlier prerelease, also read the upgrade notes of
[0.2.0-rc.3](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.2.0-rc.3).

### Added

- `--no-warn-ignored` leaves out the warning for a file or directory named on
  the command line that the tool skips as ignored, for hooks and scripts that
  pass every changed file. The JSON report still lists it in `skipped`
  ([#311](https://github.com/viell-dev/slop-markdown-tools/pull/311)).

### Fixed

- `format --diff`, which `format` also does for files by default, takes about as
  long as `format --check` when formatting changes lines throughout a long
  document. Before, building the diff took time in proportion to the document's
  length times its changed lines: two minutes for a generated document of 8,000
  wrapped paragraphs that took four seconds to check
  ([#315](https://github.com/viell-dev/slop-markdown-tools/pull/315)).
- A document from stdin whose `--stdin-filepath` the configuration, Git, or
  discovery ignores is left out as a named file is: `lint -` reports nothing,
  `format -` prints the document unchanged, and a warning says why. Before, it
  was linted and formatted, so an editor's format-on-save rewrote a document
  that the configuration says to leave alone. In the library, `documents` that
  ignore rules leave out are no longer selected
  ([#316](https://github.com/viell-dev/slop-markdown-tools/pull/316)).
- Stdin in a workspace root that Git ignores no longer warns that the root's
  files are not processed
  ([#316](https://github.com/viell-dev/slop-markdown-tools/pull/316)).
- In the Obsidian dialect, `style/wrap` keeps the text of a link on one line and
  moves the link whole to the next line where it does not fit, and joins link
  text written across lines. Obsidian's Live Preview shows a link whose text
  spans lines as Markdown source. `0.2.0-rc.3` broke lines inside link text in
  every dialect; elsewhere it still does, as GitHub, Forgejo, and Gitea render
  such links
  ([#312](https://github.com/viell-dev/slop-markdown-tools/pull/312)).
- Lists and block quotes below a first line of `---` or `+++` that no later line
  closes are read as lists and block quotes, as renderers show them. Before, the
  parser read them as paragraphs, and `style/wrap` joined them to the line
  above, which GitHub then showed as text
  ([#309](https://github.com/viell-dev/slop-markdown-tools/pull/309)).
- `style/thematic-break` and `style/heading` with `setext` no longer write a
  line of `---` alone below such a first line of `---`, which made front matter
  of everything between the two lines. The safety check refused every edit of
  the rule in such a document
  ([#309](https://github.com/viell-dev/slop-markdown-tools/pull/309)).

## 0.2.0-rc.3 - 2026-10-18

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
- `recommended` formats more, so `format --check` and `lint` report documents
  that it used to accept until `format --write` runs once. It removes trailing
  spaces, except hard line breaks, and repeated blank lines; writes code fences
  with backticks and thematic breaks as `---`; turns underlined headings into
  `#` headings and removes closing `#` sequences; and aligns tables. To keep a
  form, turn its rule off or set its option, such as
  `"style/heading": ["warn", { "closing": "keep" }]`.
- `.gitignore` files decide as in Git: a deeper file can include again what a
  higher one excludes, and patterns match letter case exactly unless the
  repository's `core.ignorecase` is on, as Git sets it on Windows and macOS.
  Files that were left out before can be linted now, and the reverse.
- Git's other ignore rules apply too: `.gitignore` files above the workspace
  root, `.git/info/exclude`, and the global excludes file, while a file that Git
  tracks is never ignored. With `--root` on a folder of a repository, or with a
  global excludes file, files that were linted before can be left out now, and a
  tracked file that a pattern matches is linted.
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
- In the library, `resolveConfig` takes one options object,
  `{ path, config, plugins, defaultDialect }`, as `lint` and `format` do, so
  their options serve as they are. A call with the four separate arguments of
  the prereleases throws an error that says so.
- `presets`, `builtInRules`, `dialects`, `dialectAliases`, and `configSchema`
  are frozen, and a change to them throws a `TypeError`; change a copy instead.
- In the library's types, `WikiLink`, `ObsidianComment`, and `ObsidianHighlight`
  replace `ObsidianLiteral`, `Rule.schema` is a `JsonSchema` instead of Ajv's
  schema type, and the lists and records in `Config` are read-only: replace a
  list or the `rules` of a configuration instead of changing it in place.
- `format` throws an error that the workspace throws, such as a loader's `EIO`,
  as `lint` does, instead of reporting it as `engine/unsafe-format`.
- A plugin named `engine` is rejected.
- `recommended` formats lists: `*` and `+` bullets become `-`, `1)` becomes
  `1.`, numbers are made consistent, and each item gets one space after its
  marker and no indentation before it. `format --check` fails on lists written
  otherwise until they are formatted or the list rules are turned off.
- `style/wrap` no longer joins the lines of a paragraph that has a line starting
  with `:::`, `{%`, or `{{`, but lines that an earlier version joined stay
  joined: split them again where a site generator reads them by line.
- A document whose front matter would end inside a code block, an HTML block, or
  display math can get `engine/unsafe-format` errors, and exit code `2`, from
  `format`, where the rules used to change it.

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

- `style/list-marker`, `style/ordered-list`, and `style/list-indent`, in
  `recommended`, write bullets as `-` and numbers as `1.` with consistent
  numbering and one space after each marker, and move each item's lines with its
  text. Their options cover markdownlint's MD004, MD007, MD029, and MD030
  ([#275](https://github.com/viell-dev/slop-markdown-tools/pull/275)).
- `--quiet` reports errors only, and `rules` lists the rules of the
  configuration's plugins too, also as JSON with `--json`
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- The CLI finds `mdtools.config.js` and `mdtools.config.cjs`, `extends` accepts
  a single preset name, and a rule's setting can be its severity alone in a
  list, as in `["warn"]`. The package ships the configuration's JSON Schema as
  `config.schema.json`, which the documentation site serves as well, for editors
  to complete and check configuration files
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- The library loads with `require()`, exports `mdrefine/package.json`, and has a
  doc comment for every export; the package lists `keywords`
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- Nine problem rules: `links/undefined-reference`, `links/unused-definition`,
  `links/empty`, `structure/heading-increment`, `content/image-alt`, and
  `content/table-columns` in `recommended`, and the optional
  `content/code-language`, `structure/single-title`, and
  `structure/duplicate-heading`
  ([#237](https://github.com/viell-dev/slop-markdown-tools/pull/237)).
- `style/block-spacing` separates headings and lists from the blocks around them
  with a blank line
  ([#190](https://github.com/viell-dev/slop-markdown-tools/pull/190)).
- Four style rules in `recommended`: `style/code-fence`, `style/thematic-break`,
  `style/blank-lines`, and `style/trailing-space`, with markdownlint's choices
  as options. `style/heading` also removes closing `#` sequences and can write
  underlined headings (options `closing` and `style`), `style/table` can write
  compact tables (option `style`), and both join `recommended`
  ([#267](https://github.com/viell-dev/slop-markdown-tools/pull/267)).
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
- Configuration and rule option errors name the setting as it is written, in
  plain words, and list the allowed values, as in
  `"extends[1]" must be a preset name, not 5`; a JSON syntax error gives its
  line and column
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- `resolveConfig` takes an options object, the exported tables are frozen and
  typed read-only, and the types of Obsidian nodes and rule schemas are their
  own ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
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
- Many repeated headings, and many emphases on one line, no longer take time
  that grows with the square of their number on Forgejo and Gitea, and `ignore`
  and `overrides` patterns are compiled once instead of for every path
  ([#273](https://github.com/viell-dev/slop-markdown-tools/pull/273)).
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
- `style/wrap` reflows a paragraph whose code span goes on in a line that starts
  with spaces or tabs, and joins the span without them, as `style/inline-code`
  does ([#288](https://github.com/viell-dev/slop-markdown-tools/pull/288)).
- `style/wrap` leaves a paragraph as written when one of its lines starts with
  `:::`, `{%`, or `{{`, such as a Docusaurus admonition or a Liquid tag, keeps a
  word that starts with them from starting a line, and keeps a template tag that
  one line holds whole. Site generators read these by line
  ([#298](https://github.com/viell-dev/slop-markdown-tools/pull/298)).
- The plugin example's style rule writes one space after a heading's `#` marks,
  because `style/thematic-break` now does what it did
  ([#267](https://github.com/viell-dev/slop-markdown-tools/pull/267)).

### Fixed

- `style/wrap`, the other rules that leave the line of an alert's or callout's
  marker alone, and the safety check recognize a marker written with an escape
  or a character reference, such as `\[!NOTE]` or `&#91;!TIP]`, which GitHub
  renders as an alert. Before, `style/wrap` joined the body onto such a marker,
  and GitHub showed an ordinary quote
  ([#298](https://github.com/viell-dev/slop-markdown-tools/pull/298)).
- A document whose front matter would end at a `---` or `+++` inside a code
  block, an HTML block, or display math that a line of the front matter opens is
  read with that block, and formatting keeps its meaning both with and without
  the front matter. Before, rules could change the block's content, such as a
  `___` in code into `---`, which GitHub shows
  ([#298](https://github.com/viell-dev/slop-markdown-tools/pull/298)).
- `style/wrap` wraps a paragraph that starts with a linked image, such as a
  badge, unless it opens a block quote. Before, it was left as written, as if it
  started with a callout's marker
  ([#298](https://github.com/viell-dev/slop-markdown-tools/pull/298)).
- A plugin rule's option schema of `false` refuses options, and an asynchronous
  schema (`$async`) is refused when the rule set is built instead of crashing
  Node.js after the run
  ([#297](https://github.com/viell-dev/slop-markdown-tools/pull/297)).
- A heading whose code span is written across lines gets the anchor that GitHub
  gives it, so a correct link to it is no longer reported missing, and the
  library's `textContent` reads such a code span as renderers show it
  ([#293](https://github.com/viell-dev/slop-markdown-tools/pull/293)).
- `--dialect` works with an `.mjs` configuration that exports a frozen object
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- `--stdin-filepath` accepts a document inside a root that is reached through a
  link or a Windows junction
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- The configuration and command-line pages say that configuration patterns match
  letter case on every system, while `.gitignore` files and input patterns
  ignore it on Windows and macOS
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- `format` stops on an error of the workspace, as `lint` does, instead of
  reporting it as `engine/unsafe-format`, and a plugin named `engine`, whose
  findings would pass for the engine's own, is rejected
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- `parse` reads a document in the dialect that an alias such as `codeberg`
  stands for, so Forgejo's rules apply to it, and the type declarations no
  longer need `@types/mdast` from another package, which a strict installation
  such as pnpm's does not provide
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- Documents and JSON configuration files that start with a byte order mark are
  read correctly
  ([#174](https://github.com/viell-dev/slop-markdown-tools/pull/174)).
- `style/heading` keeps link reference definitions directly above an underlined
  heading, which it used to replace with the heading, so that the document was
  refused ([#267](https://github.com/viell-dev/slop-markdown-tools/pull/267)).
- `style/final-newline` adds no line ending, and `style/block-spacing` no blank
  line, where it would become part of an unclosed HTML or Obsidian comment, and
  `style/final-newline` none where it would add a line to a code block without
  its closing fence; such documents used to be refused
  ([#267](https://github.com/viell-dev/slop-markdown-tools/pull/267)).
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
- Git's ignore rules apply from the repository's top level, also above the
  workspace root, together with `.git/info/exclude` and the global excludes
  file. Inside a nested repository only its own rules apply, and none applies to
  a file that Git tracks
  ([#273](https://github.com/viell-dev/slop-markdown-tools/pull/273)).
- Git's ignore rules match letter case as each repository's `core.ignorecase`
  says, and each repository, also a nested one, uses the global excludes file
  that its own settings name
  ([#287](https://github.com/viell-dev/slop-markdown-tools/pull/287)).
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
- `style/emphasis` and `style/strong` leave the text of a collapsed or shortcut
  reference, such as `[*Title*][]`, as written, because that text is also the
  label that matches the definition, and likewise text in brackets that the new
  markers would make match one. Before, all of the rule's edits in the document
  were refused
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/emphasis`, `style/strong`, `style/inline-code`, and
  `style/block-spacing` no longer propose edits that change the parse in rare
  places, where their edits were refused: crossed or shared markers, as in
  `*a _b* c_` or `*****a***`, markers next to dollar math or across the line of
  a callout's or alert's marker, code spans whose joined line would form an
  Obsidian highlight or wikilink, change that line, or pair with earlier
  backticks, a table below one that ends in a list item or block quote, and a
  list in a quote that ends in an empty footnote definition
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/inline-code` leaves out the spaces and tabs that start a code span's
  next line when it joins the span, as CommonMark and GitHub do; before,
  `npm run` continued by an indented `build` became `npm run    build`, which
  changed what GitHub shows. The safety check compares code spans the same way
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/inline-code` and the safety check read a code span as GitHub shows it
  where a line break is at its edge, and on a lazy continuation line, one
  without its block quote's `>` or its list item's indentation, whose spaces and
  tabs GitHub keeps in the span. Before, the rule could change what GitHub
  shows, such as `npm run    build` into `npm run build`, and the safety check
  did not notice. Outside the GitHub dialect, a span on such an indented lazy
  line stays split, because commonmark.js leaves those spaces out. `style/wrap`
  now also reflows a paragraph whose code span has a line break at its edge
  ([#291](https://github.com/viell-dev/slop-markdown-tools/pull/291)).
- `style/wrap` keeps a dollar from the edge of a line where it could begin or
  end math there: in Obsidian a word that ends in `$` stays with the word after
  it, and on GitHub and in Obsidian a word that starts with `$` stays with the
  word before it. Before, such a paragraph was refused in Obsidian
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/wrap` leaves a paragraph as written when its second line is a table
  delimiter row, in every dialect with tables. Directly below a table that ends
  in a list item or block quote, the parser reads another table as such a
  paragraph, and joining its lines removed a table that GitHub shows
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/wrap` keeps a run of `=` or `-` that starts the body of an alert or
  callout together with the next word. Alone on a line, it would underline the
  marker's line as a heading, and the paragraph was refused
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
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
