# mdrefine

Lint and format Markdown for GitHub, Forgejo, Gitea, Obsidian, VitePress, or any
CommonMark renderer, with one configuration for both.

[![npm](https://img.shields.io/npm/v/mdrefine)](https://www.npmjs.com/package/mdrefine)
[![CI](https://github.com/viell-dev/slop-markdown-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/viell-dev/slop-markdown-tools/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/mdrefine)](LICENSE)

## Example

```markdown
Weather Station collects *temperature*, *humidity*, and *pressure* readings from a sensor board.

> [!note]
> Use matching firmware and page versions, or the page shows __no data__.

| Sensor | Unit |
|---|---|
| Temperature | °C |
```

`npx mdrefine format --write` with the `recommended` and `github` presets turns
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

mdrefine needs Node.js 22.12 or newer. Install it in the project that holds your
documents, then check them and apply the fixes:

```sh
npm install --save-dev --save-exact mdrefine@0.6.1
npx mdrefine lint
npx mdrefine format --write
```

`lint` reports what the rules find and never writes; `format --write` applies
the fixes. [Getting
started](https://viell-dev.github.io/slop-markdown-tools/quick-start.html)
compares the other forms of `format`, for previews and CI.

## Configure

Create `mdrefine.config.jsonc` at the root of the documents:

```jsonc
{
  "extends": ["recommended", "github"],
}
```

`recommended` wraps prose at 80 columns, writes consistent markers, aligns
tables, and checks links; see [what it
does](https://viell-dev.github.io/slop-markdown-tools/configuration.html#what-recommended-does).
Use `forgejo`, `codeberg`, `gitea`, `obsidian`, or `vitepress` in place of
`github` for documents rendered there.

To adopt an existing markdownlint or Prettier setup, run
`npx mdrefine config convert --write`. Without an mdrefine configuration, their
settings apply; `--no-competitor-config` turns that off. See [configuration
conversion](https://viell-dev.github.io/slop-markdown-tools/integrations.html#configuration-conversion-and-fallback).

## Features

- **One configuration for lint and format.** Style rules report in `lint` and
  fix in `format`; problem rules report what has no single correct repair.
- **Never changes what a document means.** Formatting edits only what its rules
  and configured code formatters target, keeps everything else byte for byte,
  and refuses an edit that would change what the document says.
- **Dialect-aware.** CommonMark, GitHub, Forgejo and Codeberg, Gitea, Obsidian,
  and VitePress: tables, math, wikilinks, and callouts are read as each renderer
  reads them.
- **Checks local links** and their heading and block fragments, with each
  renderer's anchors.
- **Extensible.** Plugins add rules, presets, and syntax, and a library runs the
  same engine without the command line.

mdrefine is meant to replace a general-purpose linter and formatter, such as
markdownlint and Prettier, for Markdown. [The
comparison](https://viell-dev.github.io/slop-markdown-tools/integrations.html#coming-from-prettier-or-markdownlint)
lists each of their checks with the rule that covers it and where it behaves
differently.

## Documentation

The [documentation site](https://viell-dev.github.io/slop-markdown-tools/)
describes the newest release:

- [Getting
  started](https://viell-dev.github.io/slop-markdown-tools/quick-start.html):
  install, configure, and run.
- [Examples](https://viell-dev.github.io/slop-markdown-tools/examples.html):
  documents before and after formatting; the package ships the same files.
- [Rules](https://viell-dev.github.io/slop-markdown-tools/rules.html): what each
  rule does, with examples.
- [Configuration](https://viell-dev.github.io/slop-markdown-tools/configuration.html)
  and the [command
  line](https://viell-dev.github.io/slop-markdown-tools/cli.html): every
  setting, option, and exit code.
- [Obsidian
  vaults](https://viell-dev.github.io/slop-markdown-tools/obsidian.html) and
  [integrations](https://viell-dev.github.io/slop-markdown-tools/integrations.html):
  CI, Git hooks, editors, and moving from Prettier or markdownlint.
- [Library API](https://viell-dev.github.io/slop-markdown-tools/api.html) and
  [plugins](https://viell-dev.github.io/slop-markdown-tools/plugins.html).
- [How it works and its
  limits](https://viell-dev.github.io/slop-markdown-tools/design.html#limits),
  including what is not covered yet.
- [Changelog](CHANGELOG.md).

## Status

mdrefine follows a [pre-1.0 versioning
policy](https://viell-dev.github.io/slop-markdown-tools/versions.html): a minor
release may change behavior and says how, and a patch release only fixes
defects. It is written and maintained by AI agents, and no person reviews the
code. Changes are accepted on their tests, CI on Linux and Windows, comparisons
of what GitHub and Obsidian show before and after formatting, and a semantic
check that refuses any formatting edit that would change a document's parsed
meaning.

## Contributing, security, and license

[CONTRIBUTING.md](CONTRIBUTING.md) explains how to report a defect and how to
make a change, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) what is expected of
everyone who takes part. Report vulnerabilities as [SECURITY.md](SECURITY.md)
describes. mdrefine is released under the [MIT license](LICENSE).
