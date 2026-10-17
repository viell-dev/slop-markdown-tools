# Command line

The command is `mdtools`; with the package installed in a project, run it as
`npx mdtools`.

| Command                 | What it does                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lint [paths…]`         | Reports the findings of the enabled rules. Never writes.                                                       |
| `format [paths…]`       | Formats documents: prints a diff (the default), checks with `--check`, or writes with `--write`.               |
| `config explain <file>` | Prints the configuration in effect for one document; see [configuration](configuration.md#inspect-the-result). |
| `rules`                 | Lists the built-in rules, not those of plugins, one per line: ID, kind, and description, separated by tabs.    |
| `help [command]`        | Prints help. `--help` works for every command, and `--version` prints the version.                             |

## Options

`lint` and `format` accept these options; the last three are for `format` only
and exclude one another.

| Option                    | Meaning                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--root <directory>`      | The workspace root. Without it, the configuration file's directory; else the Git repository or vault where the search for one stopped; else the current directory. |
| `--config <file>`         | Use this configuration file instead of searching for one.                                                                                                          |
| `--dialect <name>`        | Read documents in this [dialect](dialects.md), replacing the configuration's own `dialect`.                                                                        |
| `--exclude <path>`        | Leave out a file or a directory. Repeat it for more.                                                                                                               |
| `--json`                  | Print one [JSON report](#json-report) on stdout instead of text.                                                                                                   |
| `--stdin-filepath <file>` | The path of the document read from [stdin](#read-from-stdin).                                                                                                      |
| `--max-warnings <count>`  | Exit with code `1` when there are more warnings than this.                                                                                                         |
| `--check`                 | Exit with code `1` when a document would change. Writes nothing.                                                                                                   |
| `--diff`                  | Print the changes as a unified diff. The default for files.                                                                                                        |
| `--write`                 | Write the changes.                                                                                                                                                 |

## Which files are processed

Without paths, a command processes every document of the workspace. Paths,
absolute or relative to the current directory, narrow the selection to those
files and directories; the rest of the workspace still counts for checking
links.

- Files whose names end in `.md` or `.markdown`, in any case, are documents. A
  file named on the command line is read as Markdown whatever its name. Other
  files can still be link targets.
- Files that `.gitignore` excludes or that match the configuration's `ignore`
  patterns are not processed, and nested Git repositories, symbolic links, and
  the directories `.git`, `.obsidian`, `node_modules`, `dist`, and `coverage`
  are not visited; see [ignored
  files](configuration.md#ignored-files-and-link-targets). A symbolic link named
  on the command line is an error. A file or directory named on the command line
  that these leave out is skipped with a warning that says why, such as
  `Skipped ignored input: generated/x.md (in generated, which "generated/" in .gitignore matches)`,
  and the exit code does not change.
- `.gitignore` files apply as in Git: the deepest one with a pattern that
  matches a path decides, so a negated pattern there includes a file again, but
  nothing below an excluded directory can be included. Letter case is ignored on
  Windows and macOS, as Git does there by default, and not elsewhere. The
  configuration's `ignore` and `overrides` patterns match case exactly on every
  system, so that a shared configuration applies to the same files everywhere.
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

## Read from stdin

With `-` as its only path, a command reads one document from stdin:

```sh
npx mdtools format - --stdin-filepath notes/example.md < input.md > output.md
```

`--stdin-filepath` gives the document's path, which decides its configuration,
dialect, and links. It must lie inside the workspace; without it the path is
`stdin.md` at the workspace root. `format -` prints the formatted document on
stdout, or the diff with `--diff`, or nothing with `--check`; it cannot be
combined with `--write`. `lint -` prints its findings. Neither prints a summary
line. Stdin must be [UTF-8 text](#files-that-cannot-be-read-or-written), with or
without a byte order mark; anything else stops the command with exit code `2`
and a message such as
`mdtools: stdin is not UTF-8 text (it starts with a UTF-16LE byte order mark)`.

The redirection above, in a POSIX shell or in `cmd`, passes the bytes unchanged.
PowerShell has no `<` operator, and text that it pipes into a program gains a
line break at its end, or CRLF line endings when piped line by line; Windows
PowerShell 5.1 also replaces characters outside ASCII and writes `>` output as
UTF-16, which the tool refuses to read. In PowerShell, run the redirection
through `cmd`:

```powershell
cmd /c "npx mdtools format - --stdin-filepath notes/example.md < input.md > output.md"
```

## Output

Without `--json`, findings go to stderr, one per line, as
`path:line:column: severity rule: message`. `format` prints its diff on stdout.
A run over files ends with one summary line on stderr:

| Command          | Summary                                       |
| ---------------- | --------------------------------------------- |
| `lint`           | `3 file(s) linted; 1 error(s), 2 warning(s).` |
| `format`         | `3 file(s) processed; 1 would change.`        |
| `format --write` | `3 file(s) processed; 1 written.`             |

Both add `; 1 could not be read` when a selected document [could not be
read](#files-that-cannot-be-read-or-written), and `format --write` adds
`; 1 could not be written`. Warnings about the run itself, such as a skipped
directory, are printed as `mdtools: warning: …`, and an error that stops the run
as `mdtools: …`. These lines are for people; a script should read the JSON
report and the exit code.

### JSON report

`--json` prints one object:

```json
{
  "version": "0.2.0",
  "mode": "lint",
  "files": [
    {
      "path": "notes/release-checklist.md",
      "diagnostics": [
        {
          "start": 149,
          "end": 152,
          "message": "Write this thematic break as ---.",
          "edit": { "start": 149, "end": 152, "text": "---" },
          "rule": "house/thematic-break",
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
- `files` has one entry per selected document: its `path`, relative to the
  workspace root with forward slashes, and its `diagnostics`. With `format`,
  `changed` says whether the document changed or would change. With stdin,
  `format` adds `output`, the formatted text, unless `--check` is given.
- `written` lists the paths of the files that `format --write` wrote, in the
  order of `files`. It is empty for `lint`, for `format` without `--write`, and
  when nothing was written. A file whose entry has `changed` but that is not
  listed was not written, and its diagnostics say why.
- `skipped` appears only when something was skipped: one entry per directory,
  settings file, or ignored input, with `path`, `type` (`directory` or `file`),
  the system's error `code`, `INVALID` for content that could not be used, or
  `IGNORED` for a named input that is ignored, and a `message`.

A diagnostic has the `rule`, the `severity` (`warn` or `error`), the `message`,
and its position: `start` and optional `end` as offsets into the text, and
`line` and `column`, both counted from 1. Offsets and columns count UTF-16 code
units, as JavaScript strings do. A style rule's diagnostic can carry the `edit`
it proposes, with `start`, `end`, and the replacement `text`. In a `format`
report, positions refer to the formatted text. Besides the rules, the engine
reports `engine/unsafe-format` for edits that it could not apply safely (see the
[safety model](design.md#safety-model)), `engine/rule-error` for a rule that
failed on a document (see [rules](plugins.md#rules)), `engine/unreadable-file`,
and `engine/unwritable-file`.

## Exit codes

| Code | Meaning                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Done: no errors, no more warnings than `--max-warnings`, and nothing to change for `format --check`.                                                              |
| `1`  | Errors were found, there were more warnings than `--max-warnings`, or `format --check` found a document to change.                                                |
| `2`  | The command could not do its job: a configuration, path, or plugin error, a rule that failed, or a document that could not be formatted safely, read, or written. |

Warnings alone never fail a command without `--max-warnings`. `format` can
succeed and still report problems that only a person can fix, so read its
findings too. `format --write` writes every document it formatted, also when
another document cannot be read or written; each problem is reported for its own
file, and the exit code is then `2`. A document with a rule whose edits were
refused, or that a rule failed on, is written with the other rules' edits.

## Files that cannot be read or written

A directory that the system does not let the tool read is skipped: it is
reported once as a warning, or in the report's `skipped` list, and the rest of
the workspace is processed. This includes a directory that can be listed but not
entered or the reverse, and one whose `.gitignore` cannot be read. The warning
does not change the exit code and is not counted by `--max-warnings`. A link
into a skipped directory is reported as not checkable rather than missing; see
[`links/valid`](rules.md#linksvalid). Naming the directory, or a path inside it,
on the command line is an error. To leave a directory out without a warning,
list it in a `.gitignore`.

A selected document that cannot be read gets an `engine/unreadable-file` error;
the other documents are processed, and written with `--write`, and the exit code
is `2`. The system errors `EACCES` and `EPERM` count as not being permitted to
read, and so does `EBUSY`, which Windows reports for a file that another program
has locked. Any other read error stops the run with exit code `2`. So do a root,
configuration file, or path on the command line that does not exist, cannot be
read, or is of the wrong kind, as in `Input does not exist: notes/absent.md`,
and a configuration file that cannot be read or a directory that refuses the
search for one.

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
leave the trial file behind; it is named `.mdtools-` followed by a random name
and `.tmp`, holds no document text, and can be deleted.
