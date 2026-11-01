# Upgrading

This page lists the releases whose upgrade needs steps, newest first. Each
section says who is affected, what changed, what to do, and how to check the
result. A release that is not listed needs nothing beyond installing it, and the
[changelog](changelog.md) lists every change.

When you skip releases, follow the section of each listed release between your
version and the new one, oldest first. Install the exact version, as the
[installation](quick-start.md#install) does, so that you choose when a release
reaches your documents; see [versions](versions.md).

## 0.6.0

### Workspaces with markdownlint or Prettier settings

**Who:** a workspace without an mdrefine configuration file that has a
markdownlint or Prettier configuration.

**What changed:** mdrefine converts those settings and uses them instead of the
`recommended` preset, so `lint` and `format` can report other rules, at other
severities, ignore other files, and exit differently. `lint` and `format` say so
on stderr, unless given `--quiet`:

```text
mdrefine: no mdrefine configuration; using Prettier settings from .prettierrc (2 conversion note(s): mdrefine config explain <file>; opt out: --no-competitor-config)
```

The [fallback](configuration.md#fallback-to-markdownlint-and-prettier) describes
which files it reads and which it leaves out.

**Steps:** choose one.

- To keep the `recommended` preset, create `mdrefine.config.jsonc` at the root
  of your documents, with the preset for where they render:

  ```jsonc
  {
    "extends": ["recommended", "github"],
  }
  ```

  Passing `--no-competitor-config` to every command has the same effect without
  a file.

- To adopt the converted settings, write them to a configuration file and review
  it:

  ```sh
  npx mdrefine config convert --write
  ```

**Check:** `npx mdrefine lint` no longer prints the `no mdrefine configuration`
line, and `npx mdrefine config explain README.md` names your file under
`config`.

### Scripts that run `format` without a mode

**Who:** scripts and CI jobs that run `mdrefine format` on files without
`--write`, `--check`, or `--diff`.

**What changed:** bare `format` prints the diff and exits `1` when a file would
change. Standard input is unchanged: it prints the formatted document and does
not fail because formatting changed it.

**Steps:** for a preview that exits `0` when only formatting would change, run
`format --diff`. To fail a check on unformatted files, run `format --check`, or
`format --check --diff` to see the diff as well.

**Check:** run the script on a document that formatting changes, and compare its
exit code with what the script expects. The [exit codes](cli.md#exit-codes) list
every case.

## 0.5.0

### The `mdtools` names

**Who:** anyone who used the command `mdtools`, a configuration file named
`mdtools.config.*`, or `mdtools-` suppression comments. These were the names
before 0.4.1, which deprecated them in favor of the `mdrefine` names.

**What changed:** the command is `mdrefine`. A file named
`mdtools.config.jsonc`, `.json`, `.mjs`, `.js`, or `.cjs` is no longer found,
and the old comments are ordinary HTML comments that suppress nothing.
Formatting does not rename files or rewrite comments.

**Steps:**

1. Run `mdrefine` instead of `mdtools` in scripts, Git hooks, CI, and editor
   settings.
2. Rename the configuration file from `mdtools.config.*` to `mdrefine.config.*`,
   keeping its extension.
3. Replace the comment prefixes: `mdtools-disable` with `mdrefine-disable`,
   `mdtools-disable-next-line` with `mdrefine-disable-next-line`, and
   `mdtools-enable` with `mdrefine-enable`.

**Check:** a search for `mdtools`, such as `git grep -n mdtools`, finds nothing
that you meant to keep, and `npx mdrefine config explain README.md` names the
renamed file under `config`.
