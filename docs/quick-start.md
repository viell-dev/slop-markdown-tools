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

The commands work the same in PowerShell and cmd, apart from reading a file
through stdin with `<`, which the [command line](cli.md#read-from-stdin) page
covers.

### Without a Node.js project

`npm install` in a folder without `package.json` creates `package.json`,
`package-lock.json`, and a `node_modules` folder there. In a repository of
another language, add `node_modules/` to its `.gitignore`, or use one of these
instead:

- Run it once, without installing it in the folder:

  ```sh
  npx mdrefine@0.6.0 lint
  ```

- Install it once for every folder, and run `mdrefine` without `npx`:

  ```sh
  npm install --global mdrefine@0.6.0
  mdrefine lint
  ```

For an Obsidian vault, see [install for a
vault](obsidian.md#install-for-a-vault).

### Other package managers

| Package manager | Install                                           | Run                  |
| --------------- | ------------------------------------------------- | -------------------- |
| pnpm            | `pnpm add --save-dev --save-exact mdrefine@0.6.0` | `pnpm exec mdrefine` |
| Yarn            | `yarn add --dev --exact mdrefine@0.6.0`           | `yarn mdrefine`      |
| Bun             | `bun add --dev --exact mdrefine@0.6.0`            | `bunx mdrefine`      |

Use the command in the "Run" column where the pages say `npx mdrefine`.

## Choose where your documents render

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

`extends` names **presets**, sets of rule settings. `recommended` checks and
formats any Markdown; see [what it
does](configuration.md#what-recommended-does). The second preset names where
your documents are rendered, which sets their **dialect**: the syntax they are
read in, such as GitHub's alerts or Obsidian's wikilinks. Use the line for your
renderer:

| Documents rendered by       | `extends`                      | Also                                                           |
| --------------------------- | ------------------------------ | -------------------------------------------------------------- |
| GitHub                      | `["recommended", "github"]`    |                                                                |
| Codeberg or another Forgejo | `["recommended", "forgejo"]`   |                                                                |
| Gitea                       | `["recommended", "gitea"]`     |                                                                |
| Obsidian                    | `["recommended", "obsidian"]`  | Put the file next to `.obsidian/`; see [vaults](obsidian.md)   |
| VitePress                   | `["recommended", "vitepress"]` | Match its [renderer options](vitepress.md#renderer-options)    |
| Another CommonMark renderer | `["recommended"]`              | Add `"dialect": "commonmark"`; there is no `commonmark` preset |

## Lint

Run the commands from the root of your documents, or point them there with
`--root`:

```sh
npx mdrefine lint
```

`lint` reports what the enabled rules find and never changes a file. With the
[README's example](https://github.com/viell-dev/slop-markdown-tools#example)
saved as `README.md`, it prints:

```text
README.md:1:1: warn style/wrap: Reflow paragraph to 80 columns.
README.md:1:26: warn style/emphasis: Use "_" for emphasis.
README.md:1:38: warn style/emphasis: Use "_" for emphasis.
README.md:1:41: warn style/emphasis: Use "_" for emphasis.
README.md:1:50: warn style/emphasis: Use "_" for emphasis.
README.md:1:57: warn style/emphasis: Use "_" for emphasis.
README.md:1:66: warn style/emphasis: Use "_" for emphasis.
README.md:3:5: warn github/alert-marker: Use NOTE for the callout type.
README.md:4:62: warn style/strong: Use "**" for strong.
README.md:4:71: warn style/strong: Use "**" for strong.
README.md:6:1: warn style/table: Format table padding and pipes.
1 file(s) linted; 0 error(s), 11 warning(s).
```

Each line gives the file, line, and column, the severity, the rule, and what to
change. Add `--json` for a report that scripts can read, or `--max-warnings 0`
to fail on warnings too.

Without paths, the commands check every document of the workspace: each file
ending in `.md` or `.markdown` below the configuration file's directory, or else
below the Git repository or vault you run them in. See [which files are
processed](cli.md#which-files-are-processed).

## Preview and write

| Command          | Writes files | Prints                      | Exits `1` when                        |
| ---------------- | ------------ | --------------------------- | ------------------------------------- |
| `lint`           | No           | Findings                    | It finds errors                       |
| `format`         | No           | The diff                    | A file would change, or errors remain |
| `format --diff`  | No           | The diff                    | Errors remain                         |
| `format --check` | No           | The files that would change | A file would change, or errors remain |
| `format --write` | Yes          | How many files it wrote     | Errors remain                         |

Each of them also exits `1` with more warnings than `--max-warnings` allows, and
`2` when it cannot run, such as with a configuration that is not valid. Run
`format --check` in CI, or `format --check --diff` to see the diff as well. Read
from stdin, `format` prints the formatted document instead, and does not fail
only because formatting changed it.

```sh
npx mdrefine format
npx mdrefine format --write
```

`format` changes only what its rules target, and refuses any change that would
alter what a document means. It can still report problems that need a person,
such as a broken link, which remain errors after `--write`.

## No configuration file?

Without a configuration file, documents are read as GitHub Markdown, or as
Obsidian notes inside a vault. The rules then come from a markdownlint or
Prettier configuration in the workspace, if there is one that mdrefine can read:
it [converts](configuration.md#competitor-configuration-fallback) their settings
and says so on stderr. Pass `--no-competitor-config` to leave them out. Without
such a configuration, the `recommended` rules apply. A configuration file is
still worth creating: it enables the rules for your renderer and makes the
dialect explicit. `npx mdrefine config convert --write` creates one from the
markdownlint or Prettier settings.

## Change a rule

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
