# mdrefine

Lint and format Markdown for GitHub, Forgejo, Gitea, Obsidian, or any CommonMark
renderer, with one configuration for both.

[![npm](https://img.shields.io/npm/v/mdrefine)](https://www.npmjs.com/package/mdrefine)
[![CI](https://github.com/viell-dev/slop-markdown-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/viell-dev/slop-markdown-tools/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/mdrefine)](LICENSE)

mdrefine is meant to replace a general-purpose linter and formatter, such as
markdownlint and Prettier, for Markdown. It does not cover all of their checks
yet; [the
comparison](https://viell-dev.github.io/slop-markdown-tools/integrations.html#coming-from-prettier-or-markdownlint)
shows which have a rule.

- **One configuration for lint and format.** Style rules report in `lint` and
  fix in `format`; problem rules report what has no single correct repair.
- **Changes only what its rules target.** Everything else stays byte for byte as
  written, and an edit that would change a document's parsed meaning is refused.
- **Dialect-aware.** CommonMark, GitHub, Forgejo and Codeberg, Gitea, and
  Obsidian: tables, math, wikilinks, and callouts are read as each renderer
  reads them.
- **Checks local links** and their heading and block fragments, with each
  renderer's anchors.
- **Extensible.** Plugins add rules, presets, and syntax, and a library runs the
  same engine without the command line.

## Example

```markdown
Weather Station collects *temperature*, *humidity*, and *pressure* readings from a sensor board.

> [!note]
> Use matching firmware and page versions, or the page shows __no data__.

| Sensor | Unit |
|---|---|
| Temperature | °C |
```

`npx mdtools format --write` with the `recommended` and `github` presets turns
it into:

```markdown
Weather Station collects _temperature_, _humidity_, and _pressure_ readings from
a sensor board.

> [!NOTE]
> Use matching firmware and page versions, or the page shows **no data**.

| Sensor      | Unit |
| ----------- | ---- |
| Temperature | °C   |
```

## Install

mdrefine needs Node.js 22.12 or newer. The package is `mdrefine`, and its
command is `mdtools`:

```sh
npm install --save-dev --save-exact mdrefine@0.2.6
npx mdtools lint
npx mdtools format --diff
npx mdtools format --write
npx mdtools format --check
```

`lint` reports and never writes. `format` shows a diff, writes with `--write`,
and with `--check` fails when a document would change.

## Configure

`mdtools.config.jsonc` at the root of the documents:

```jsonc
{
  "extends": ["recommended", "github"],
}
```

`recommended` wraps prose at 80 columns; writes emphasis as `_text_`, strong
text as `**text**`, list items as `- item` and `1. item`, headings with `#`,
code fences with backticks, and thematic breaks as `---`; aligns tables; removes
trailing spaces and repeated blank lines; separates headings and lists from
adjacent blocks with a blank line where safe; ends files with a line break; and
checks links. It also warns about references without a definition, unused
definitions, empty links, skipped heading levels, images without alternative
text, and table rows with the wrong number of cells. Use `forgejo`, `codeberg`,
`gitea`, or `obsidian` in place of `github` for documents rendered there.

## Documentation

The [documentation](https://viell-dev.github.io/slop-markdown-tools/) starts
with [getting
started](https://viell-dev.github.io/slop-markdown-tools/quick-start.html) and
covers the [rules](https://viell-dev.github.io/slop-markdown-tools/rules.html),
configuration, the command line, Obsidian vaults, CI and editors, the library
and plugins, and [what is not covered
yet](https://viell-dev.github.io/slop-markdown-tools/design.html#limits). The
package ships working
[examples](https://viell-dev.github.io/slop-markdown-tools/examples.html) and
the [changelog](CHANGELOG.md).

## Status

mdrefine follows a [pre-1.0 versioning
policy](https://viell-dev.github.io/slop-markdown-tools/versions.html): a minor
release may change behavior and says how, and a patch release only fixes
defects. It is written and maintained by AI agents, and no person reviews the
code. Changes are accepted on their tests, CI on Linux and Windows, and a
semantic check that refuses any formatting edit that would change a document's
parsed meaning.

## Contributing, security, and license

[CONTRIBUTING.md](CONTRIBUTING.md) explains how to report a defect and how to
make a change, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) what is expected of
everyone who takes part. Report vulnerabilities as [SECURITY.md](SECURITY.md)
describes. mdrefine is released under the [MIT license](LICENSE).
