# Integrations

## Continuous integration

Two commands check a workspace without writing anything. Each fails with exit
code `1` when it finds something, and with `2` when it cannot do its job:

```sh
npx mdtools lint --max-warnings 0
npx mdtools format --check
```

The [examples](examples.md#automate-checks) include a complete GitHub Actions
workflow that runs both on every pull request; copy it to
`.github/workflows/markdown.yml`. Forgejo Actions, on Codeberg and other Forgejo
instances, runs the same workflow from `.forgejo/workflows/`: set `runs-on` to a
label that the instance's runners offer, and check that the actions it uses are
available there.

## Git hooks

The CLI reads files from the working tree, not the staged content of the index.
Pass it the files that a commit changes, and never run it with an empty list,
which would check the whole workspace.

With [lint-staged](https://github.com/lint-staged/lint-staged), which passes the
staged files that match a pattern, keeps unstaged changes out of the way while
it runs, and adds what the commands changed to the commit, configure it in
`package.json`:

```json
{
  "lint-staged": {
    "*.md": ["mdtools format --write", "mdtools lint --max-warnings 0"]
  }
}
```

and run `npx lint-staged` from a pre-commit hook, for example through husky.
Without it, a `.git/hooks/pre-commit` script can lint the Markdown files that
the commit adds or changes:

```sh
#!/bin/sh
git diff --cached --name-only -z --diff-filter=ACMR -- '*.md' |
  xargs -0 -r npx mdtools lint --max-warnings 0 --
```

`--diff-filter=ACMR` leaves out deleted files, which would be an error as paths.
`xargs -r` skips the command when no file changed. `--` keeps a file name that
starts with `-` from being read as an option. This hook checks each file as it
is on disk, including changes that are not staged.

## Editors

There is no editor extension or language server. An editor that can format a
buffer through an external command can run
`npx mdtools format - --stdin-filepath path/of/the/file.md`, which reads the
buffer from stdin and prints the formatted text; the path gives the buffer its
file's configuration, dialect, and link targets. Exit code `1` means that
findings remain, and the output is still the formatted text; with `2`, keep the
buffer as it was.
`npx mdtools lint - --stdin-filepath path/of/the/file.md --json` returns the
findings with their positions. An editor that formats a selection can use the
library's [`ranges`](api.md#part-of-a-document).

## Next to Prettier or markdownlint

Prettier formats Markdown too, and two formatters undo each other's changes.
Leave Markdown to mdrefine by adding this line to `.prettierignore`:

```text
**/*.md
```

markdownlint and mdrefine can run side by side, but rules that overlap can
disagree, such as markdownlint's emphasis style (MD049) and `style/emphasis`.
Turn off in one tool what the other covers; the table below lists the overlaps.

## Coming from Prettier or markdownlint

mdrefine is meant to replace these tools for Markdown, but it does not yet cover
everything they do. This table lists what has a rule today. Where it says "None
yet", keep the other tool for that check.

| Prettier or markdownlint                                                         | mdrefine                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `proseWrap: "always"` and `printWidth`; MD013 (line length)                      | [`style/wrap`](rules.md#stylewrap), which wraps instead of only reporting      |
| `proseWrap: "preserve"`                                                          | Turn `style/wrap` off                                                          |
| `proseWrap: "never"`                                                             | None yet                                                                       |
| `_` for emphasis; MD049 (emphasis style)                                         | [`style/emphasis`](rules.md#styleemphasis)                                     |
| `**` for strong text; MD050 (strong style)                                       | [`style/strong`](rules.md#stylestrong)                                         |
| `#` headings; MD003 (heading style)                                              | [`style/heading`](rules.md#styleheading), for `#` headings only                |
| Aligned tables; MD055 (table pipe style)                                         | [`style/table`](rules.md#styletable), for tables outside lists and quotes      |
| Blank lines between blocks; MD022, MD032 (blank lines around headings and lists) | [`style/block-spacing`](rules.md#styleblock-spacing), for headings and lists   |
| Final newline; MD047                                                             | [`style/final-newline`](rules.md#stylefinal-newline)                           |
| MD041 (first line is a heading)                                                  | [`structure/initial-heading`](rules.md#structureinitial-heading)               |
| MD051 (link fragments)                                                           | [`links/valid`](rules.md#linksvalid), which also checks that local files exist |
| List markers, numbering, and indentation; MD004, MD005, MD007, MD029, MD030      | None yet                                                                       |
| Code block and fence style; MD040, MD046, MD048                                  | None yet                                                                       |
| `---` for thematic breaks; MD035                                                 | None yet; the [plugin example](examples.md#write-a-plugin) adds one            |
| Trailing spaces, tabs, repeated blank lines; MD009, MD010, MD012                 | None yet                                                                       |
| Heading levels and duplicates; MD001, MD024, MD025                               | None yet                                                                       |
| Inline HTML, bare URLs, image text; MD033, MD034, MD045                          | None yet                                                                       |
| Formatting the code inside code blocks                                           | None yet                                                                       |
| `<!-- prettier-ignore -->`, `<!-- markdownlint-disable -->`                      | [`<!-- mdtools-disable -->`](configuration.md#suppression-comments)            |
| Custom rules                                                                     | [Plugins](plugins.md)                                                          |

## Agents and scripts

Read the [JSON report](cli.md#json-report) and the exit code, not the text
output, whose wording can change in any release. A diagnostic names its rule,
its position, and, for a style rule, the edit it proposes. A safe loop is:
`format --diff` to see the changes, `format --write` to apply them, then `lint`
again for what needs a person. The [examples](examples.md#automate-checks)
include a script that summarizes a report. To report a defect of the tool,
follow the
[contribution guide](https://github.com/viell-dev/slop-markdown-tools/blob/main/CONTRIBUTING.md#report-a-defect).
