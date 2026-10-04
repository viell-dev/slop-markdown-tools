# Examples

Working examples of configuring, running, and extending Markdown Tools. The
[examples page](https://viell-dev.github.io/slop-markdown-tools/examples.html)
walks through each one with its input and output. The integration tests run
every example, so what is here matches what the tool does.

Run the commands below from a built checkout (`npm ci && npm run build`). In a
project that installs the package, the same files are under
`node_modules/mdrefine/examples/`, and `npx --no-install mdtools` replaces
`node dist/cli/main.js`.

## Starting configurations

Copy one to the root of your documents as `mdtools.config.jsonc`.

| File                               | For                                         |
| ---------------------------------- | ------------------------------------------- |
| [`github.jsonc`](github.jsonc)     | Repositories rendered by GitHub             |
| [`forgejo.jsonc`](forgejo.jsonc)   | Codeberg and other Forgejo instances        |
| [`gitea.jsonc`](gitea.jsonc)       | Gitea instances                             |
| [`obsidian.jsonc`](obsidian.jsonc) | Obsidian vaults, with vault-root link paths |

## Workspaces before and after formatting

Each workspace has a `before/` tree as someone might have written it and an
`after/` tree holding exactly what `format --write` turns it into. Both contain
one broken link on purpose: formatting never guesses a target, so `lint` still
reports it afterwards.

- [`workspaces/repository-docs/`](workspaces/repository-docs/) is a README and
  two guides for a repository on GitHub.
- [`workspaces/obsidian-vault/`](workspaces/obsidian-vault/) is a small vault
  with wikilinks, an embed, callouts, a block reference, and an ignored template
  folder.

```sh
node dist/cli/main.js lint --root examples/workspaces/repository-docs/before
node dist/cli/main.js format --root examples/workspaces/repository-docs/before --diff
```

Preview with `--diff` as above. To try `--write`, copy a `before/` tree
somewhere else first, so that the example stays as it is.

## Plugin

[`plugin/`](plugin/) holds a configuration, a plugin with one problem rule and
one style rule, and a note that triggers both.

```sh
node dist/cli/main.js lint --root examples/plugin
node dist/cli/main.js format --root examples/plugin --diff
```

## Library

Scripts that call the library instead of the CLI. They import `mdrefine` by
name, which works inside this repository and wherever the package is installed.

```sh
node examples/library/format-string.mjs
node examples/library/lint-folder.mjs
```

[`format-string.mjs`](library/format-string.mjs) formats one string.
[`lint-folder.mjs`](library/lint-folder.mjs) reads a folder of GitHub Markdown,
builds the workspace that link checks need, and prints diagnostics. Without an
argument it reads `workspaces/repository-docs/after`.

## Automation

- [`automation/github-actions.yml`](automation/github-actions.yml) checks
  Markdown on every pull request.
- [`automation/summarize-report.mjs`](automation/summarize-report.mjs) reads the
  `--json` report and counts diagnostics per rule:

```sh
node dist/cli/main.js lint --root examples/plugin --json | node examples/automation/summarize-report.mjs
```
