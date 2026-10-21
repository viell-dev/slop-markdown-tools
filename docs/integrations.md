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
    "*.{md,markdown}": [
      "mdtools format --write --no-warn-ignored",
      "mdtools lint --max-warnings 0 --no-warn-ignored"
    ]
  }
}
```

and run `npx lint-staged` from a pre-commit hook, for example through husky.
Without it, a `.git/hooks/pre-commit` script can lint the Markdown files that
the commit adds or changes:

```sh
#!/bin/sh
git diff --cached --name-only -z --diff-filter=ACMR -- '*.md' '*.markdown' |
  xargs -0 -r npx mdtools lint --max-warnings 0 --no-warn-ignored --
```

In both, `--no-warn-ignored` leaves out the
[warning](cli.md#which-files-are-processed) for a changed file that the tool
skips, such as one that the configuration's `ignore` patterns match.
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
library's [`ranges`](api.md#part-of-a-document). An editor that reads JSON
Schemas completes and checks the configuration file with the package's
[schema](configuration.md#json-schema).

## Next to Prettier or markdownlint

Prettier formats Markdown too, and two formatters undo each other's changes.
Leave Markdown to mdrefine by adding both file extensions to `.prettierignore`:

```text
**/*.md
**/*.markdown
```

markdownlint and mdrefine can run side by side, but rules that overlap can
disagree, such as markdownlint's emphasis style (MD049) and `style/emphasis`.
Turn off in one tool what the other covers; the table below lists the overlaps.

## Coming from Prettier or markdownlint

mdrefine is meant to replace these tools for Markdown, but it does not yet cover
everything they do. This table lists what has a rule today. Where it says "None
yet", keep the other tool for that check.

| Prettier or markdownlint                                                         | mdrefine                                                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `proseWrap: "always"` and `printWidth`; MD013 (line length)                      | [`style/wrap`](rules.md#stylewrap), which wraps instead of only reporting                             |
| `proseWrap: "preserve"`                                                          | Turn `style/wrap` off                                                                                 |
| `proseWrap: "never"`                                                             | None yet                                                                                              |
| `_` for emphasis; MD049 (emphasis style)                                         | [`style/emphasis`](rules.md#styleemphasis)                                                            |
| `**` for strong text; MD050 (strong style)                                       | [`style/strong`](rules.md#stylestrong)                                                                |
| `#` headings without closing `#`; MD003 (heading style)                          | [`style/heading`](rules.md#styleheading), whose default converts underlined ones, unlike Prettier     |
| Aligned or compact tables; MD055, MD060 (table style)                            | [`style/table`](rules.md#styletable), for tables outside lists and quotes                             |
| Blank lines between blocks; MD022, MD032 (blank lines around headings and lists) | [`style/block-spacing`](rules.md#styleblock-spacing), for headings and lists                          |
| Backtick code fences; MD046, MD048 (code block and fence style)                  | [`style/code-fence`](rules.md#stylecode-fence), which leaves indented code blocks as written          |
| `---` for thematic breaks; MD035                                                 | [`style/thematic-break`](rules.md#stylethematic-break)                                                |
| Trailing spaces; MD009                                                           | [`style/trailing-space`](rules.md#styletrailing-space), which keeps hard line breaks                  |
| Repeated blank lines; MD012                                                      | [`style/blank-lines`](rules.md#styleblank-lines), with a `maximum`                                    |
| Final newline; MD047                                                             | [`style/final-newline`](rules.md#stylefinal-newline)                                                  |
| MD041 (first line is a heading)                                                  | [`structure/initial-heading`](rules.md#structureinitial-heading)                                      |
| MD051 (link fragments)                                                           | [`links/valid`](rules.md#linksvalid), which also checks that local files exist                        |
| MD052 (reference labels are defined)                                             | [`links/undefined-reference`](rules.md#linksundefined-reference), which also checks footnotes         |
| MD053 (definitions are used)                                                     | [`links/unused-definition`](rules.md#linksunused-definition), which also checks footnotes             |
| MD042 (no empty links)                                                           | [`links/empty`](rules.md#linksempty)                                                                  |
| MD001 (heading levels go up by one)                                              | [`structure/heading-increment`](rules.md#structureheading-increment), with block quotes checked apart |
| MD025 (one top-level heading)                                                    | [`structure/single-title`](rules.md#structuresingle-title)                                            |
| MD024 (repeated headings)                                                        | [`structure/duplicate-heading`](rules.md#structureduplicate-heading)                                  |
| MD045 (image alternative text)                                                   | [`content/image-alt`](rules.md#contentimage-alt)                                                      |
| MD056 (table column count)                                                       | [`content/table-columns`](rules.md#contenttable-columns)                                              |
| MD040 (code block language)                                                      | [`content/code-language`](rules.md#contentcode-language)                                              |
| `-` for bullets; MD004 (list style)                                              | [`style/list-marker`](rules.md#stylelist-marker), with MD004's `consistent` and `sublist`             |
| `1.` and numbering; MD029 (ordered list prefix)                                  | [`style/ordered-list`](rules.md#styleordered-list); `same` stands for MD029's `one` and `zero`        |
| One space after list markers, list indentation; MD005, MD007, MD030              | [`style/list-indent`](rules.md#stylelist-indent), with MD030's spacing and MD007's `indent`           |
| Inline HTML, bare URLs; MD033, MD034                                             | None yet                                                                                              |
| Hard tabs; MD010                                                                 | None yet                                                                                              |
| Formatting the code inside code blocks                                           | Opt-in [code formatters](configuration.md#code-formatters), selected by fence language                |
| `<!-- prettier-ignore -->`, `<!-- markdownlint-disable -->`                      | [`<!-- mdtools-disable -->`](configuration.md#suppression-comments)                                   |
| Custom rules                                                                     | [Plugins](plugins.md)                                                                                 |

Prettier keeps line breaks by default (`proseWrap: "preserve"`), while
`recommended` wraps at 80 columns. `style/wrap` keeps the lines of
[site-generator syntax](dialects.md#what-each-dialect-reads) such as `:::note`
and `{% tab %}`; for other syntax that depends on its line breaks, turn the rule
off or use a suppression comment.

For the heading checks, markdownlint's `level`, `allow_preamble`, and
`front_matter_title` choices correspond to mdrefine's `level`, `allowPreamble`,
and `frontMatterTitle`. For duplicate headings, use `siblingsOnly`; its default
is `true`, so set it to `false` for whole-outline checking. For fenced-code
languages, use `allowedLanguages` and `languageOnly`, corresponding to
`allowed_languages` and `language_only`. These are option mappings, not a
promise of identical defaults or behavior: initial-heading's metadata-title
recognition is off by default, and the heading checks use Markdown headings with
independent quote and footnote outlines. See each rule's reference for its exact
contract.

## Agents and scripts

Read the [JSON report](cli.md#json-report) and the exit code, not the text
output, whose wording can change in any release. A diagnostic names its rule,
its position, and, for a style rule, the edit it proposes. A safe loop is:
`format --diff` to see the changes, `format --write` to apply them, then `lint`
again for what needs a person. The [examples](examples.md#automate-checks)
include a script that summarizes a report. To report a defect of the tool,
follow the [contribution
guide](https://github.com/viell-dev/slop-markdown-tools/blob/main/CONTRIBUTING.md#report-a-defect).
