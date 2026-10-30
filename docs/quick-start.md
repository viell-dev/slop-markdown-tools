# Getting started

## Install

mdrefine needs Node.js 22.12 or newer. Install the package in the project that
holds your documents:

```sh
npm install --save-dev --save-exact mdrefine@0.6.0
npx --no-install mdrefine --help
```

`npx` runs the `mdrefine` command from the project, and `--no-install` stops it
from downloading a package when the project has none; the examples below leave
it out. The exact version lets you choose when a release that formats
differently reaches your documents; see [versions](versions.md).

## Lint

Run the commands from the root of your documents, or point them there with
`--root`:

```sh
npx mdrefine lint
```

`lint` reports what the enabled rules find and never changes a file. Without
paths it checks every document of the workspace: each file ending in `.md` or
`.markdown` below the configuration file's directory, or else below the Git
repository or vault you run it in; see [which files are
processed](cli.md#which-files-are-processed). Add `--json` for a report that
scripts can read, or `--max-warnings 0` to fail on warnings too.

## Preview and write

```sh
npx mdrefine format
npx mdrefine format --diff
npx mdrefine format --write
npx mdrefine format --check
```

Bare `format` prints what formatting would change and exits `1` when any file
would change. `--diff` prints the same preview with exit `0` when no errors
remain and `--max-warnings` is not exceeded. `--check --diff` prints the diff
and fails on changes. `--write` writes the changes. `--check` writes nothing,
names each document that would change, and then exits with code `1`, which is
the check to run in CI. `format` changes only what its rules target, and refuses
any change that would alter what a document means. It can still report problems
that need a person, such as a broken link; remaining errors exit `1` in every
mode. Operational failures exit `2`. Stdin prints the formatted document by
default and does not fail merely because formatting changed it.

## Choose a preset and a dialect

Create `mdrefine.config.jsonc` at the root of your documents:

```jsonc
{
  "$schema": "./node_modules/mdrefine/config.schema.json",
  "extends": ["recommended", "github"],
  "ignore": ["vendor/**"],
}
```

The `$schema` line lets your editor complete and check the settings; see [JSON
Schema](configuration.md#json-schema).

`recommended` wraps prose at 80 columns; writes emphasis as `_text_`, strong
text as `**text**`, list items as `- item` and `1. item`, headings with `#`,
code fences with backticks, and thematic breaks as `---`; aligns tables; removes
trailing spaces and repeated blank lines; separates headings, lists, code
fences, and tables from adjacent blocks with a blank line where safe; ends every
file with a line break; and checks local links. It also warns about
[problems](rules.md) that show on the rendered page, such as a reference without
a definition, a skipped heading level, or an image without alternative text. The
second [preset](configuration.md#presets) names where your documents are
rendered and so their [dialect](dialects.md): replace `github` with `forgejo`
(or `codeberg`), `gitea`, `obsidian`, or `vitepress`. Match a VitePress site's
[renderer options](vitepress.md#renderer-options) explicitly. For plain
CommonMark, keep only `recommended` and add `"dialect": "commonmark"`.

Without a configuration file, documents are read as GitHub Markdown, or as
Obsidian notes inside a vault. The rules then come from a markdownlint or
Prettier configuration in the workspace, if there is one that mdrefine can read:
it [converts](configuration.md#competitor-configuration-fallback) their settings
and says so on stderr. Pass `--no-competitor-config` to leave them out. Without
such a configuration, the `recommended` rules apply. A configuration file is
still worth creating: it enables the rules for your renderer and makes the
dialect explicit. `npx mdrefine config convert --write` creates one from the
markdownlint or Prettier settings.

Change a rule under `rules`:

```jsonc
{
  "extends": ["recommended", "github"],
  "rules": {
    "style/wrap": ["warn", { "width": 100 }],
    "style/emphasis": "off",
  },
}
```

This wraps at 100 columns and leaves emphasis markers as they are.

## Next steps

- [Rules](rules.md): what each rule does, with examples.
- [Configuration](configuration.md): overrides, ignore patterns, plugins, and
  suppression comments.
- [Command line](cli.md): file selection, stdin, the JSON report, and exit
  codes.
- [Integrations](integrations.md): CI, Git hooks, editors, and moving from
  Prettier or markdownlint.
- [Obsidian vaults](obsidian.md) and [examples](examples.md) of documents before
  and after formatting.
