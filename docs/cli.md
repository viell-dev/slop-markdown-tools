# Command line

The command is `mdrefine`; with the package installed in a project, run it as
`npx mdrefine`.

## Commands

| Command                 | What it does                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lint [paths…]`         | Reports the findings of the enabled rules. Never writes.                                                       |
| `format [paths…]`       | Prints a diff and fails on changes; lists changes with `--check`, or writes with `--write`.                    |
| `config explain <file>` | Prints the configuration in effect for one document; see [configuration](configuration.md#inspect-the-result). |
| `config convert`        | Prints a converted markdownlint/Prettier configuration; `--write` creates it exclusively.                      |
| `rules`                 | Lists the built-in rules and those of the configuration's plugins.                                             |
| `help [command]`        | Prints help. `--help` works for every command, and `--version` prints the version.                             |

Help and the version are printed on stdout, with exit code `0`. Without a
command, `mdrefine` prints the help on stderr, followed by
`mdrefine: no command given; try mdrefine lint`, and exits with code `2`, as it
does for every mistake on the command line, such as an unknown option. `config`
without `explain` or `convert` does the same with its own help.

`rules` prints one line per rule, sorted by ID: its ID, kind, and description,
separated by tabs. The descriptions of the built-in rules are those of the
[rules](rules.md) index. It looks for the configuration from the current
directory, as `lint` does, or searches from `--root <directory>`, or reads the
one that `--config` names. With `--json` it prints `{ "rules": [...] }`, in the
same order, each rule an object with its `id`, `kind`, and `description`.

With configured [code formatters](configuration.md#code-formatters), every
`format` mode also formats selected fenced code. `lint` checks Markdown rules
and does not run those tools; use `format --check` to check their formatting. A
failed tool reports `engine/code-formatter` and exits with `2`, retaining that
block and keeping other safe edits.

## Options

`lint` and `format` take these options; the second column says which. For
`format`, `--check --diff` combines the two, and `--write` cannot be combined
with either.

| Option                    | Commands         | Meaning                                                                                                                                                       |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--root <directory>`      | `lint`, `format` | The workspace root; see [the workspace root](#the-workspace-root).                                                                                            |
| `--no-competitor-config`  | `lint`, `format` | Do not use markdownlint or Prettier settings when there is no mdrefine configuration; see the [fallback](configuration.md#competitor-configuration-fallback). |
| `--config <file>`         | `lint`, `format` | Use this configuration file instead of searching for one.                                                                                                     |
| `--dialect <name>`        | `lint`, `format` | Read documents in this [dialect](dialects.md), replacing the configuration's own `dialect`.                                                                   |
| `--exclude <path>`        | `lint`, `format` | Leave out a file or a directory. Repeat it for more.                                                                                                          |
| `--json`                  | `lint`, `format` | Print one [JSON report](#json-report) on stdout instead of text.                                                                                              |
| `--quiet`                 | `lint`, `format` | Report errors only. Warnings are left out of the output, the JSON report, and the counts, `--max-warnings` included.                                          |
| `--no-warn-ignored`       | `lint`, `format` | Leave out the warning for a named file or directory that is [ignored](#which-files-are-processed).                                                            |
| `--stdin-filepath <file>` | `lint`, `format` | The path of the document read from [stdin](#read-from-stdin).                                                                                                 |
| `--max-warnings <count>`  | `lint`, `format` | Exit with code `1` when there are more warnings than this.                                                                                                    |
| `--check`                 | `format`         | Exit with code `1`, naming the documents, when any would change. Writes nothing.                                                                              |
| `--diff`                  | `format`         | Print a unified diff; changes alone exit `0`. Combine with `--check` to fail on changes.                                                                      |
| `--write`                 | `format`         | Write the changes.                                                                                                                                            |

### The workspace root

The workspace is the set of documents that a command checks, and the files that
their links can reach. Its root is the directory that `--root` names. Without
it, the root is the directory of the configuration file that the search finds;
without one, the Git repository or vault where the search stopped; and else the
current directory. Paths in the output and the JSON report are relative to the
current directory and to the root, respectively.

Bare `format` on files prints a unified diff and exits `1` if any document would
change, or `0` if none would. Explicit `format --diff` is an exit-`0` preview
when no errors remain and `--max-warnings` is not exceeded.
`format --check --diff` prints the diff and fails on changes. `--check` alone
lists the files instead. `--json` omits the diff and uses the same exit codes.
Stdin keeps its own output and exit behavior, described below.

`mdrefine check` and `mdrefine fix` are usage errors that suggest
`format --check` and `format --write`. Likewise, `lint --check`, `lint --write`
and `lint --fix` suggest the matching `format` mode.

## Which files are processed

Without paths, a command processes every document of the
[workspace](#the-workspace-root), including files above the current directory
when run from a subdirectory. Paths, absolute or relative to the current
directory, narrow the selection to those files and directories; the rest of the
workspace still counts for checking links.

- Files whose names end in `.md` or `.markdown`, in any case, are documents. A
  file named on the command line is read as Markdown whatever its name. Other
  files can still be link targets.
- Files that Git ignores or that match the configuration's `ignore` patterns are
  not processed, and nested Git repositories, symbolic links, and the
  directories `.git`, `.obsidian`, `node_modules`, `dist`, and `coverage` are
  not visited; see [ignored
  files](configuration.md#ignored-files-and-link-targets). A symbolic link named
  on the command line is an error. A file or directory named on the command line
  that these leave out is skipped with a warning that says why, such as
  `Skipped ignored input: generated/x.md (in generated, which "generated/" in .gitignore matches)`,
  and the exit code does not change. `--no-warn-ignored` leaves this warning
  out, so that a hook or script can pass every changed file without repeating
  the ignore rules; the JSON report still lists the input in `skipped`, and the
  other warnings, such as the one for a workspace root that Git ignores, still
  print.
- Git's ignore rules apply as Git applies them, including the global excludes
  file and files that Git tracks; see [how Git ignore rules are
  applied](#how-git-ignore-rules-are-applied).
- A path that does not exist and contains `*`, `?`, `[`, or `{` is a pattern,
  such as `"docs/**/*.md"`, which the CLI expands itself, so it works quoted in
  PowerShell, cmd, and npm scripts. It is relative to the current directory,
  separates directories with `/` on every system, where `\` escapes the next
  character, matches names that start with a dot, and ignores case on Windows
  and macOS. It selects the documents that it matches; one that matches none is
  an error.
- `--exclude` takes literal paths, not patterns, relative to the current
  directory or absolute, inside the workspace. It leaves out a file, or a
  directory with everything in it, which still count as link targets. A path
  that does not exist excludes nothing; one that the tool may not examine is an
  error. It cannot be combined with stdin.

To check only the files that changed, pass them as arguments; see [Git
hooks](integrations.md#git-hooks).

### How Git ignore rules are applied

Git's ignore rules apply as in Git. A path is checked against each `.gitignore`
from the deepest up to the repository's top level, including those above the
workspace root, then the repository's `.git/info/exclude`, then the global
excludes file (`core.excludesFile`, by default `~/.config/git/ignore`), and the
first with a pattern that matches decides. So a negated pattern includes a file
again, but nothing below an excluded directory can be included, and nothing in a
workspace root that Git ignores is processed, except files that Git tracks,
which it never ignores. Inside a nested repository only its own rules and
settings apply, and outside a repository only the workspace's `.gitignore`
files. The tool asks Git, in each repository, which global excludes file it
reads, whether it ignores letter case (`core.ignorecase`, which Git turns on
when it creates a repository on a file system that ignores case, as Windows and
macOS do by default), and which files it tracks. Without Git installed, that
file is not read, tracked files are ignored like the others, and letter case is
ignored on Windows and macOS and not elsewhere. The configuration's `ignore` and
`overrides` patterns match case exactly on every system, so that a shared
configuration applies to the same files everywhere.

## Read from stdin

With `-` as its only path, or `--stdin-filepath` without paths, `lint` and
`format` read one document from stdin. Combining `--stdin-filepath` with any
path other than `-` is a usage error (exit `2`):

```sh
npx mdrefine format - --stdin-filepath notes/example.md < input.md > output.md
```

`--stdin-filepath` gives the document's path, which decides its configuration,
dialect, and links. It must lie inside the workspace; without it the path is
`stdin.md` at the workspace root. Ignore rules apply to the path that
`--stdin-filepath` gives as to a [named file](#which-files-are-processed), also
where no file or folder of it exists yet: for an ignored path, `lint -` reports
nothing and `format -` prints the document unchanged, both with the
`Skipped ignored input` warning, which `--no-warn-ignored` leaves out. A nested
repository is no such rule: a path in one is read as that repository's document.
`format -` prints the formatted document on stdout, or the diff with `--diff`,
or nothing with `--check` alone, while `--check --diff` prints the diff and
fails on changes; it cannot be combined with `--write`. `lint -` prints its
findings. Neither prints a summary line. Stdin must be [UTF-8
text](#files-that-cannot-be-read-or-written), with or without a byte order mark;
anything else stops the command with exit code `2` and a message such as
`mdrefine: stdin is not UTF-8 text (it starts with a UTF-16LE byte order mark)`.

The redirection above, in a POSIX shell or in `cmd`, passes the bytes unchanged.
PowerShell has no `<` operator, and text that it pipes into a program gains a
line break at its end, or CRLF line endings when piped line by line; Windows
PowerShell 5.1 also replaces characters outside ASCII and writes `>` output as
UTF-16, which the tool refuses to read. In PowerShell, run the redirection
through `cmd`:

```powershell
cmd /c "npx mdrefine format - --stdin-filepath notes/example.md < input.md > output.md"
```

## Output

Without `--json`, findings go to stderr, one per line, as
`path:line:column: severity rule: message`. The path leads from the current
directory to the document, with forward slashes, as Prettier names files, so
that a terminal or an editor can open it. `format` prints its diff on stdout
with the same paths, so that `patch -p1` or `git apply` applies it in the same
directory. `format --check` names each document that would change, one per line
after the findings; `--check --diff` prints the diff instead of that list. A
preview ends with a hint to use `--write` to apply changes. A run selecting no
documents prints a short notice on stderr, including with `--json`, without
changing its exit code. A run over files prints a summary on stderr:

| Command          | Summary                                       |
| ---------------- | --------------------------------------------- |
| `lint`           | `3 file(s) linted; 1 error(s), 2 warning(s).` |
| `format`         | `3 file(s) processed; 1 would change.`        |
| `format --write` | `3 file(s) processed; 1 written.`             |

Both add `; 1 could not be read` when a selected document [could not be
read](#files-that-cannot-be-read-or-written), and `format --write` adds
`; 1 could not be written`. Warnings about the run itself, such as a skipped
directory, are printed as `mdrefine: warning: …`, with paths from the current
directory as well, and an error that stops the run, a mistake on the command
line included, as `mdrefine: …`. These lines are for people; a script should
read the JSON report and the exit code.

### JSON report

`--json` prints one object:

```json
{
  "version": "0.6.0",
  "mode": "lint",
  "root": "/home/user/project",
  "files": [
    {
      "path": "notes/release-checklist.md",
      "diagnostics": [
        {
          "start": 149,
          "end": 154,
          "message": "Write one space after the heading's # marks.",
          "edit": { "start": 149, "end": 154, "text": "## " },
          "rule": "house/heading-space",
          "severity": "warn",
          "line": 7,
          "column": 1
        }
      ]
    }
  ],
  "written": []
}
```

- `version` is the tool's version, and `mode` is `lint` or `format`.
- `root` is the workspace root, as an absolute path in the form of the system.
- `files` has one entry per selected document: its `path`, relative to the
  workspace root with forward slashes, and its `diagnostics`, without warnings
  when `--quiet` is given. With `format`, `changed` says whether the document
  changed or would change. With stdin, `format` adds `output`, the formatted
  text, unless `--check` is given.
- `written` lists the paths of the files that `format --write` wrote, in the
  order of `files`. It is empty for `lint`, for `format` without `--write`, and
  when nothing was written. A file whose entry has `changed` but that is not
  listed was not written, and its diagnostics say why.
- `skipped` appears only when something was skipped: one entry per directory,
  settings file, or ignored input, with `path`, `type` (`directory` or `file`),
  the system's error `code`, `INVALID` for content that could not be used, or
  `IGNORED` for a named input that is ignored, and a `message`. Paths in both
  are relative to the workspace root.

A diagnostic has the `rule`, the `severity` (`warn` or `error`), the `message`,
and its position: `start` and optional `end` as offsets into the text, and
`line` and `column`, both counted from 1. Offsets and columns count UTF-16 code
units, as JavaScript strings do. Initial byte order marks count in offsets but
not visible columns. A style rule's diagnostic can carry the `edit` it proposes,
with `start`, `end`, and the replacement `text`. In a `format` report, positions
refer to the formatted text. Besides the rules, the engine reports
`engine/unsafe-format` for edits that it could not apply safely (see the [safety
model](design.md#safety-model)), `engine/rule-error` for a rule that failed on a
document (see [rules](plugins.md#rules)), `engine/code-formatter` for a failed
or unsafe code tool, `engine/unreadable-file`, and `engine/unwritable-file`.

## Exit codes

| Code | Meaning                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | Done: no errors, no more warnings than `--max-warnings`, and nothing to change for bare `format` on files or `format --check`. Also after help or the version.                                   |
| `1`  | Errors were found, there were more warnings than `--max-warnings`, or bare `format` on files or `format --check` found a document to change.                                                     |
| `2`  | The command could not do its job: a mistake on the command line; a configuration, path, or plugin error; a rule that failed; or a document that could not be formatted safely, read, or written. |

Warnings alone never fail a command without `--max-warnings`. `format` also
reports problem rules: remaining error diagnostics exit `1` in every mode,
including `--diff` and `--write`. Operational failures take precedence and exit
`2`. `format --write` writes every document it formatted, also when another
document cannot be read or written; each problem is reported for its own file,
and the exit code is then `2`. A document with a rule whose edits were refused,
or that a rule failed on, is written with the other rules' edits.

A directory that cannot be read is skipped with a warning, and a document that
cannot be read or written is reported for its own file; see [reliability
details](#reliability-details).

## Configuration commands

`config explain <file>` prints, as JSON, the configuration in effect for one
document; [inspect the result](configuration.md#inspect-the-result) describes
its fields. It reads `--config`, `--no-competitor-config`, `--root`, and
`--dialect`, before or after `explain`.

### Competitor fallback notices

When `lint`, `format`, or `config explain` runs on the [competitor
fallback](configuration.md#competitor-configuration-fallback), it prints notices
on stderr, with paths from the workspace root: one line for each markdownlint or
Prettier configuration file that it found and does not use, with the reason, and
one line that names the files it uses and counts the conversion notes, as in:

```text
mdrefine: not using prettier.config.mjs: the fallback does not run JavaScript or TypeScript; "mdrefine config convert" can convert it
mdrefine: no mdrefine configuration; using markdownlint settings from .markdownlint.json (3 conversion note(s): mdrefine config explain <file>; opt out: --no-competitor-config)
```

When it uses none of the files it found, the last line says that the defaults
apply instead. A `.prettierignore` with a negated (`!`) entry, which conversion
cannot express, is not used either: none of its patterns apply, so the documents
it excludes are checked, and a line says so:

```text
mdrefine: not using .prettierignore: its negated entries (!README.md) cannot be converted, so none of its patterns apply and the documents it excludes are checked; "mdrefine config convert" reports them for manual migration
```

`config convert` instead converts the other patterns of such a file and reports
the negated entries. With `lint` and `format`, `--quiet` leaves the notices out;
`config explain` takes no `--quiet`. The notices never go to stdout, so the JSON
report of `--json` is unchanged.

With the fallback, `config explain` adds a `conversion` object to its JSON:

| Field           | Meaning                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`        | The converted settings, which use no preset; `{}` when no file could be used and the defaults apply.                                         |
| `sources`       | The files whose settings were converted, as absolute paths.                                                                                  |
| `unused`        | The files that were found and not used, each as `{ "file", "reason" }`.                                                                      |
| `omitted`       | The settings that were not carried over or only in part, with the reason and any issue that tracks the missing part.                         |
| `conflicts`     | The settings of the two tools that disagreed, and which one won.                                                                             |
| `suggestions`   | mdrefine checks worth considering that the competitor configuration does not enable.                                                         |
| `compatibility` | The original competitor settings and the competitor checks behind each converted rule, which the fallback uses to honor competitor comments. |

`rules` accepts `--no-competitor-config` too. Its list describes the available
rules rather than the effective settings, so it does not print fallback notices;
use `config explain` to inspect conversion and its report.

### Convert a configuration

`config convert` converts the markdownlint and Prettier configurations that the
search finds, as the fallback does, and prints the result on stdout as an
`mdrefine.config.jsonc`. It runs JavaScript and TypeScript configurations, which
the fallback never does. Its report goes to stderr: each file converted, each
file not used and why, the settings not carried over with their reasons and the
issues that track them, the conflicts it resolved, and suggested checks.

| Option               | Meaning                                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--root <directory>` | Search from this directory, and write the file there. Without it, see below.                                                                                                                                                                                     |
| `--write`            | Create `mdrefine.config.jsonc` instead of printing it, and print its path, from the current directory, on stderr, as in `mdrefine: created ../mdrefine.config.jsonc`. An existing mdrefine configuration in that directory is an error, and no file is replaced. |

Without `--root`, the search starts from the current directory, and the file
goes where `lint` run from there looks for the workspace's configuration: beside
the mdrefine configuration that the search finds, else at the root of the Git
repository or vault where the search stopped, else in the current directory. The
written configuration then takes the place of the fallback that `lint` used from
that directory, so it applies the same settings to the same documents. With
`--root` naming a subdirectory, it is a configuration for that subtree, whose
patterns are rebased into it, and `lint` finds it only from that directory or
below.

`config convert` accepts only `--root` and `--write`. The other configuration
options, such as `--config`, choose what `config explain` reads, and are usage
errors with `convert`, before or after it. So is a `--root` that does not exist
or is not a directory. These errors, finding no configuration to convert, and
finding only files that it cannot use end the command with exit code `2`.

## Reliability details

These sections describe what happens when the file system refuses a read or a
write, and what writing keeps of each file.

### Files that cannot be read or written

A directory that the system does not let the tool read is skipped: it is
reported once as a warning, or in the report's `skipped` list, and the rest of
the workspace is processed. This includes a directory that can be listed but not
entered or the reverse, one whose `.gitignore` cannot be read, and a nested
repository whose `.git/info/exclude` cannot be read. The warning does not change
the exit code and is not counted by `--max-warnings`. A link into a skipped
directory is reported as not checkable rather than missing; see
[`links/valid`](rules/links/valid.md). Naming the directory, or a path inside
it, on the command line is an error. To leave a directory out without a warning,
list it in a `.gitignore`.

A selected document that cannot be read gets an `engine/unreadable-file` error;
the other documents are processed, and written with `--write`, and the exit code
is `2`. The system errors `EACCES` and `EPERM` count as not being permitted to
read, and so does `EBUSY`, which Windows reports for a file that another program
has locked. Any other read error stops the run with exit code `2`. So do a root,
configuration file, or path on the command line that does not exist, cannot be
read, or is of the wrong kind, as in `Input does not exist: notes/absent.md`,
and a configuration file that cannot be read or a directory that refuses the
search for one. A file of Git's ignore rules that applies to the root, such as a
`.gitignore` above it, that cannot be read stops the run too.

Documents are read as UTF-8, with or without a byte order mark. The tool does
not guess another encoding: a guess can be wrong, and the supported renderers
read Markdown as UTF-8. A selected document that is not UTF-8 text gets the same
`engine/unreadable-file` error, with a message that says what was found, as in
`The file is not UTF-8 text (byte 0xE9 on line 1 is not valid UTF-8) and was not linted.`
So does a file that starts with a UTF-16 or UTF-32 byte order mark, which
Windows PowerShell 5.1 writes for `>`, and a file that contains a NUL byte, as
UTF-16 text without a mark does. Save such a file as UTF-8 to process it. A link
to a heading in it is reported as `Fragment could not be checked`.

A vault's `.obsidian/app.json` that cannot be read, or that is not valid JSON,
gets a warning, and the vault's notes are not wrapped. When the system does not
let the tool find out whether a directory is a vault, the command stops with
exit code `2`, because reading notes in another dialect is not safe.

`format --write` writes each changed file in place, into the existing file,
which keeps everything about the file but its content; see
[below](#what-writing-keeps). Before it writes a file, it checks that the file
may be written and that its directory lets it create a trial file. A file that
fails the check gets an `engine/unwritable-file` error, such as
`The file may not be written (EACCES: permission denied); the file is unchanged.`,
and is left alone; the other files are still written. A read-only file fails the
check on every platform, and the tool never makes a file writable to write it. A
failure that the check cannot foresee, such as a file that another program has
locked on Windows or a full disk, is reported for that file in the same way.
Either way the file is not listed in `written`, and the exit code is `2`.

### What writing keeps

Writing into the existing file keeps everything about it except its content and
its modification time: its permissions, including access control entries of its
own, its owner and group, attributes such as Hidden, extended attributes,
alternate data streams such as the mark of a downloaded file, its creation time,
and its other names if it has hard links. A file whose two names are both
selected documents is written once and counted for each.

Writing in place is not atomic, and the tool makes up for that as far as it can.
Before it writes a file, it writes a trial file of the same size beside it,
holding random bytes, and removes it again, which shows that the new content
fits on the disk. Just before writing, it checks through the open file that the
file still holds exactly the bytes it read. If writing then fails part way, it
writes those bytes back and says whether that worked, as in
`The file could not be written (EIO: i/o error), and its content from before formatting was written back.`
or, when that fails too,
`… and writing its content from before formatting back failed too (EIO: i/o error); it may be incomplete.`

Nothing protects a file from a crash of the computer or a power failure while it
is being written. The file can then be left incomplete, with part of the new
content and part of the old, and a later run cannot repair it; keep documents
that matter in version control or a backup. A program that reads the file at
that moment can see it half written too. A crash during the trial write can
leave the trial file behind; it is named `.mdrefine-` followed by a random name
and `.tmp`, holds no document text, and can be deleted.
