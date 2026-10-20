# Configuration

One configuration controls both `lint` and `format`. Without a configuration
file, the `recommended` preset applies and the dialect is
[assumed](dialects.md#the-assumed-dialect).

## Configuration files

The file is named `mdtools.config.jsonc`, `mdtools.config.json`,
`mdtools.config.mjs`, `mdtools.config.js`, or `mdtools.config.cjs`. The CLI
looks for it in the directory given with `--root`, or else the current
directory, and then in each directory above, up to the first one that is a Git
repository (holds `.git`) or an Obsidian vault (holds `.obsidian`), or the
filesystem root. Two configuration files in one directory are an error.
`--config` names a file explicitly. The directory of the configuration file is
the workspace root unless `--root` names another; without a configuration file,
it is the repository or vault where the search stopped, or else the current
directory. Configuration files do not cascade: a file in a subdirectory is not
merged with one above it.

JSONC allows comments and trailing commas. A JSON or JSONC file may start with a
byte order mark, and a syntax error in one is reported with its line and column.
A JavaScript file exports the configuration as its default export, or as
`module.exports` in CommonJS; Node.js reads an `.mjs` file as an ES module, a
`.cjs` file as CommonJS, and a `.js` file as the nearest `package.json` declares
with `type`, or by its syntax when none does. JavaScript configuration and
plugins run with your permissions, so load only code you trust. Unknown keys,
rule IDs, and preset names are errors, and so are rule options that the rule
does not accept; the message names the setting, as in
`"extends[1]" must be a preset name, not 5`.

```jsonc
{
  "extends": ["recommended", "github"],
  "ignore": ["generated/**"],
  "rules": { "style/wrap": ["warn", { "width": 100 }] },
  "overrides": [
    { "files": ["vault/**/*.md"], "rules": { "style/emphasis": "off" } },
  ],
}
```

| Key         | Value                                          | Purpose                                                              |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `$schema`   | A string                                       | Ignored by the tool; gives an editor the [JSON Schema](#json-schema) |
| `extends`   | A preset name or a list of them                | [Presets](#presets) to start from                                    |
| `dialect`   | A [dialect](dialects.md) name                  | The renderer whose syntax documents are read in                      |
| `rules`     | Rule IDs and settings                          | [Rules and severity](#rules-and-severity)                            |
| `overrides` | Objects with `files`, and `dialect` or `rules` | [Settings for some files](#overrides)                                |
| `ignore`    | Path patterns                                  | [Documents not to process](#ignored-files-and-link-targets)          |
| `resolve`   | `{ "gitIgnored": …, "nestedRepositories": … }` | [More link targets](#ignored-files-and-link-targets)                 |
| `plugins`   | Files or package names                         | [Plugins](#plugins) to load                                          |

### JSON Schema

The configuration's JSON Schema lets an editor that reads JSON Schemas, such as
Visual Studio Code, complete and check the settings. The package ships it as
`config.schema.json`, matching the installed version; name it with `$schema`,
relative to the configuration file:

```jsonc
{
  "$schema": "./node_modules/mdrefine/config.schema.json",
  "extends": ["recommended", "github"],
}
```

The documentation site serves the schema of the version it documents at
`https://viell-dev.github.io/slop-markdown-tools/config.schema.json`, an address
that stays the same. In a JavaScript configuration file, a type annotation in a
comment gives an editor the same help:

```js
/** @type {import("mdrefine").Config} */
export default { extends: ["recommended", "github"] };
```

The schema describes the form of each setting. Rule IDs, preset names, and rule
options are checked when the tool runs, against the rules and presets of the
loaded plugins. The library exports the same schema as
[`configSchema`](api.md#other-exports).

## Presets

A **preset** is a named set of rule settings. The **dialect** is a separate
setting: it names the renderer whose syntax documents are read in, such as
GitHub's or Obsidian's, and so decides what counts as a table, a link, or a line
break. Each preset except `recommended` also sets a dialect. The
[rules](rules.md) page shows which presets enable each rule.

Presets are starting points with opinionated defaults, not a fixed style. Every
rule can be turned off or given another severity, and a rule whose choice
documents reasonably differ on, such as the emphasis marker or the wrapping
width, takes options for it; the [rules](rules.md) list them with their
defaults.

| Preset        | Sets the dialect | For                                                                                                             |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `recommended` | No               | Any document: wrapping at 80 columns, markers, blank space, tables, valid links, problems that show on the page |
| `github`      | `github`         | Documents rendered by GitHub                                                                                    |
| `forgejo`     | `forgejo`        | Documents rendered by Forgejo, such as on Codeberg                                                              |
| `codeberg`    | `forgejo`        | The `forgejo` preset under another name                                                                         |
| `gitea`       | `gitea`          | Documents rendered by Gitea                                                                                     |
| `obsidian`    | `obsidian`       | An Obsidian vault                                                                                               |

Without `extends`, the configuration starts from `recommended`. `extends` names
one preset or lists several, and replaces that default, so name both, as in
`["recommended", "github"]`; `"extends": "github"` starts from `github` alone,
and `"extends": []` enables no rules. Presets apply in the order listed, then
the configuration's own settings, then each matching override in order. A later
setting for a rule replaces an earlier one as a whole, options included. A
plugin's presets are named with the plugin's name as a prefix, such as
`sample/recommended`, and presets may extend other presets; a cycle is an error.

`recommended` enables [`style/block-spacing`](rules.md#styleblock-spacing) at
`warn`, adding a blank line between headings or lists and adjacent blocks where
safe. `lint` reports missing separators, and `format` adds them. To keep compact
spacing, set `"rules": { "style/block-spacing": "off" }`.

## Rules and severity

A rule's setting is its severity, `"off"`, `"warn"`, or `"error"`, or a list of
the severity and the rule's options, as in `["warn", { "width": 100 }]`; a list
of the severity alone, `["warn"]`, keeps the rule's default options. The [rules
reference](rules.md) lists every rule and its options.

`format` applies the edits of every enabled style rule, whether its severity is
`warn` or `error`. Problem rules only report. Errors make `lint` and `format`
exit with code `1`; warnings do so only beyond `--max-warnings`.

## Dialect

`dialect` sets the dialect of every document, and an override can set another
for some of them. `codeberg` is accepted as another name for `forgejo`.
`--dialect` on the command line replaces the dialect of the configuration and
its presets, though not one set by a matching override. When neither the
configuration, its presets and overrides, nor `--dialect` names one, the dialect
is [assumed](dialects.md#the-assumed-dialect).

## Overrides

Each entry of `overrides` applies its `dialect` and `rules` to the documents
that match one of its `files` patterns:

```jsonc
{
  "extends": ["recommended", "github"],
  "overrides": [
    {
      "files": ["CHANGELOG.md", "generated/**"],
      "rules": { "style/wrap": "off" },
    },
  ],
}
```

Patterns are globs, such as `docs/**/*.md`, matched against paths relative to
the workspace root, with forward slashes. A pattern matches files whose names
start with a dot, too. Patterns match letter case exactly on every system, so
that a configuration selects the same files in CI on Linux as on Windows or
macOS, where patterns on the command line and, in most repositories,
`.gitignore` files [ignore case](cli.md#which-files-are-processed).

## Ignored files and link targets

`ignore` lists path patterns, written like those of overrides, for documents
that are never linted or formatted. They remain link targets, so links to them
are still checked.

The CLI also leaves out what Git ignores, decided [as Git decides
it](cli.md#which-files-are-processed), nested Git repositories, symbolic links,
and the directories `.git`, `.obsidian`, `node_modules`, `dist`, and `coverage`.
`resolve` makes two of these available as link targets, without ever selecting
them for linting or formatting:

```jsonc
{
  "resolve": { "gitIgnored": true, "nestedRepositories": true },
}
```

Both default to `false`. The Markdown files of such a target are read only when
a link's fragment needs checking.

The directories that the CLI does not visit, and the targets of symbolic links
and junctions, are still link targets: a link that names a path in or through
them is checked on disk. A path whose real location lies outside the workspace
root is not read and is reported as not checkable. A Git-ignored directory stays
out unless `resolve.gitIgnored` asks for it, whatever its name, and an Obsidian
search by note name does not look in these directories.

## Plugins

`plugins` lists plugins to load, as strings:

```jsonc
{
  "plugins": ["./rules.mjs", "sample-plugin"],
  "extends": ["recommended", "local/recommended"],
  "rules": { "sample/no-placeholder": "error" },
}
```

An entry that starts with `.` or is an absolute path names a file, relative to
the configuration file's directory. Any other entry names a package, found from
the configuration file as Node.js finds an `import`. A plugin adds rules and
presets, named with the plugin's name as a prefix: above, the file's plugin
calls itself `local` and the package's plugin `sample`. Only a configuration
file can name plugins; the CLI has no option for them.

A plugin runs with your permissions when the configuration is loaded. A plugin
that cannot be loaded stops the command with exit code `2`.
[Plugins](plugins.md) describes how to write one and how a package is found.

## Suppression comments

```markdown
<!-- mdtools-disable style/wrap -->

Keep the wrapping in this region.

<!-- mdtools-enable style/wrap -->

<!-- mdtools-disable-next-line style/emphasis -->
Keep *this* delimiter.
```

`mdtools-disable` turns rules off from the comment on, and `mdtools-enable`
turns them on again; without rule names, they apply to every rule. A named
enable also removes that rule's suppression after an all-rule disable, leaving
other rules suppressed. It does not enable a rule that the configuration turns
off. `mdtools-disable-next-line` applies to the next line only, even when it is
blank, so place it directly above the line. A suppressed rule reports nothing
there and changes nothing that touches the region, so a paragraph that crosses
into it is left as written. A directive inside code is code, not a directive.

## Inspect the result

`config explain` prints, as JSON, the configuration in effect for one document:
the workspace `root`, the configuration file as `config` (or `null`), the
document's `path` from the root with forward slashes, and the `effective`
settings, with the dialect assumed for that document and the overrides that
match it. The document need not exist, but like an input of `lint` it must lie
inside the workspace.

```sh
npx mdtools config explain notes/example.md
```

It reads `--config`, `--root`, and `--dialect`, before or after `explain`.
