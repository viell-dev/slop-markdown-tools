# Integrations

## Continuous integration

Two commands check a workspace without writing anything. Each fails with exit
code `1` when it finds something, and with `2` when it cannot do its job:

```sh
npx mdrefine lint --max-warnings 0
npx mdrefine format --check
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
      "mdrefine format --write --no-warn-ignored",
      "mdrefine lint --max-warnings 0 --no-warn-ignored"
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
  xargs -0 -r npx mdrefine lint --max-warnings 0 --no-warn-ignored --
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
`npx mdrefine format - --stdin-filepath path/of/the/file.md`, which reads the
buffer from stdin and prints the formatted text; the path gives the buffer its
file's configuration, dialect, and link targets. Exit code `1` means that
findings remain, and the output is still the formatted text; with `2`, keep the
buffer as it was.
`npx mdrefine lint - --stdin-filepath path/of/the/file.md --json` returns the
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
Turn off in one tool what the other covers; the tables below list the overlaps.

## Coming from Prettier or markdownlint

mdrefine is meant to replace these tools for Markdown, but it does not yet cover
everything they do. The tables below list every rule of markdownlint 0.42 and
every Markdown option and formatting choice of Prettier 3.9, with the mdrefine
rule that covers each. "None yet" and "Not yet" link the issue that tracks the
missing part; keep the other tool for that check until it is done. The issues
follow each check's documented purpose, not the other tool's known defects.

### markdownlint rules

markdownlint enables every rule by default. mdrefine's presets enable fewer: a
rule that no preset in your configuration enables, such as
`structure/heading-punctuation`, needs an entry under `rules`. Each rule's
[section](rules.md) names its presets.

| markdownlint                             | mdrefine                                                                                                                                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MD001 `heading-increment`                | [`structure/heading-increment`](rules.md#structureheading-increment), with block quotes checked apart. Not yet a front-matter title ([#699](https://github.com/viell-dev/slop-markdown-tools/issues/699))                                            |
| MD003 `heading-style`                    | [`style/heading`](rules.md#styleheading), whose default converts underlined headings; after 0.5.0, `closing: "add"` also writes closed ATX styles                                                                                                    |
| MD004 `ul-style`                         | [`style/list-marker`](rules.md#stylelist-marker), with `consistent` and `sublist`                                                                                                                                                                    |
| MD005 `list-indent`                      | [`style/list-indent`](rules.md#stylelist-indent)                                                                                                                                                                                                     |
| MD007 `ul-indent`                        | [`style/list-indent`](rules.md#stylelist-indent)'s `nestedIndent`; after 0.5.0, `startIndented` and `startIndent`                                                                                                                                    |
| MD009 `no-trailing-spaces`               | [`style/trailing-space`](rules.md#styletrailing-space): after 0.5.0, `hardBreakSpaces`, `listItemEmptyLines`, and report-only `codeBlocks`; strict cleanup outside hard breaks                                                                       |
| MD010 `no-hard-tabs`                     | [`style/no-tabs`](rules.md#styleno-tabs), after 0.5.0; literal content is report-only                                                                                                                                                                |
| MD011 `no-reversed-links`                | [`links/reversed`](rules.md#linksreversed), after 0.5.0                                                                                                                                                                                              |
| MD012 `no-multiple-blanks`               | [`style/blank-lines`](rules.md#styleblank-lines), with `maximum`                                                                                                                                                                                     |
| MD013 `line-length`                      | [`style/wrap`](rules.md#stylewrap), which wraps paragraphs instead of only reporting. After 0.5.0, [`content/line-length`](rules.md#contentline-length) reports headings, code blocks and tables                                                     |
| MD014 `commands-show-output`             | [`content/shell-prompt`](rules.md#contentshell-prompt), for shell and unlabeled code blocks, with `$` and `%` prompts                                                                                                                                |
| MD018 `no-missing-space-atx`             | [`structure/unspaced-heading`](rules.md#structureunspaced-heading), which leaves Obsidian tags and issue references alone                                                                                                                            |
| MD019 `no-multiple-space-atx`            | [`style/heading`](rules.md#styleheading), after 0.5.0                                                                                                                                                                                                |
| MD020 `no-missing-space-closed-atx`      | [`structure/unspaced-heading`](rules.md#structureunspaced-heading), for paragraph text such as `#Heading#`                                                                                                                                           |
| MD021 `no-multiple-space-closed-atx`     | [`style/heading`](rules.md#styleheading), after 0.5.0; removes closing `#` by default or normalizes retained separators                                                                                                                              |
| MD022 `blanks-around-headings`           | [`style/block-spacing`](rules.md#styleblock-spacing). Not yet `lines_above` and `lines_below` ([#679](https://github.com/viell-dev/slop-markdown-tools/issues/679))                                                                                  |
| MD023 `heading-start-left`               | [`style/heading`](rules.md#styleheading), after 0.5.0; preserves container prefixes                                                                                                                                                                  |
| MD024 `no-duplicate-heading`             | [`structure/duplicate-heading`](rules.md#structureduplicate-heading); `siblingsOnly` defaults to `true`                                                                                                                                              |
| MD025 `single-title`                     | [`structure/single-title`](rules.md#structuresingle-title)                                                                                                                                                                                           |
| MD026 `no-trailing-punctuation`          | [`structure/heading-punctuation`](rules.md#structureheading-punctuation), which reads headings as renderers show them and leaves abbreviations, ellipses, and emoji shortcodes alone                                                                 |
| MD027 `no-multiple-space-blockquote`     | None yet ([#682](https://github.com/viell-dev/slop-markdown-tools/issues/682))                                                                                                                                                                       |
| MD028 `no-blanks-blockquote`             | [`structure/split-quote`](rules.md#structuresplit-quote), except before an alert or callout                                                                                                                                                          |
| MD029 `ol-prefix`                        | [`style/ordered-list`](rules.md#styleordered-list); `same` stands for `one` and `zero` in lists that start at 1 or 0, because the first number is never changed                                                                                      |
| MD030 `list-marker-space`                | [`style/list-indent`](rules.md#stylelist-indent), with the same four spacings                                                                                                                                                                        |
| MD031 `blanks-around-fences`             | [`style/block-spacing`](rules.md#styleblock-spacing), after 0.5.0; outside list items and footnote definitions, as with `list_items: false`                                                                                                          |
| MD032 `blanks-around-lists`              | [`style/block-spacing`](rules.md#styleblock-spacing)                                                                                                                                                                                                 |
| MD033 `no-inline-html`                   | [`content/html-element`](rules.md#contenthtml-element), with `allowedElements` and `tableAllowedElements`                                                                                                                                            |
| MD034 `no-bare-urls`                     | [`links/bare-url`](rules.md#linksbare-url), after 0.5.0                                                                                                                                                                                              |
| MD035 `hr-style`                         | [`style/thematic-break`](rules.md#stylethematic-break), after 0.5.0 with exact break text or `consistent`                                                                                                                                            |
| MD036 `no-emphasis-as-heading`           | [`structure/emphasis-heading`](rules.md#structureemphasis-heading), whatever the paragraph's line length                                                                                                                                             |
| MD037 `no-space-in-emphasis`             | [`content/emphasis-spacing`](rules.md#contentemphasis-spacing), reported only where the parser reads emphasis once the spaces are gone; not a single `*` or `_` with spaces on both sides at both ends, such as `a * b * c`                          |
| MD038 `no-space-in-code`                 | [`content/inline-code-spacing`](rules.md#contentinline-code-spacing), reported only, next to a letter or digit; not spaces that show syntax or indentation, as in `- `, or that a backtick at an end of the code needs                               |
| MD039 `no-space-in-links`                | [`links/text-spacing`](rules.md#linkstext-spacing), reported only, because moving the spaces changes the link text and where they belong depends on the text around the link                                                                         |
| MD040 `fenced-code-language`             | [`content/code-language`](rules.md#contentcode-language)                                                                                                                                                                                             |
| MD041 `first-line-heading`               | [`structure/initial-heading`](rules.md#structureinitial-heading)                                                                                                                                                                                     |
| MD042 `no-empty-links`                   | [`links/empty`](rules.md#linksempty)                                                                                                                                                                                                                 |
| MD043 `required-headings`                | None yet ([#692](https://github.com/viell-dev/slop-markdown-tools/issues/692))                                                                                                                                                                       |
| MD044 `proper-names`                     | None yet ([#693](https://github.com/viell-dev/slop-markdown-tools/issues/693))                                                                                                                                                                       |
| MD045 `no-alt-text`                      | [`content/image-alt`](rules.md#contentimage-alt), also HTML `<img>` without `alt`; `alt=""` marks a decorative image, and `aria-hidden="true"` counts outside GitHub                                                                                 |
| MD046 `code-block-style`                 | [`style/code-fence`](rules.md#stylecode-fence) formats fences. Not yet choosing between fenced and indented blocks ([#695](https://github.com/viell-dev/slop-markdown-tools/issues/695))                                                             |
| MD047 `single-trailing-newline`          | [`style/final-newline`](rules.md#stylefinal-newline)                                                                                                                                                                                                 |
| MD048 `code-fence-style`                 | [`style/code-fence`](rules.md#stylecode-fence)                                                                                                                                                                                                       |
| MD049 `emphasis-style`                   | [`style/emphasis`](rules.md#styleemphasis). Includes `marker: "consistent"` (unreleased)                                                                                                                                                             |
| MD050 `strong-style`                     | [`style/strong`](rules.md#stylestrong). Includes `marker: "consistent"` (unreleased)                                                                                                                                                                 |
| MD051 `link-fragments`                   | [`links/valid`](rules.md#linksvalid), which also checks that local files exist. Includes `ignored_pattern` as `ignoredFragments`, and `exactCase`, the inverse of `ignore_case`: `ignore_case: true` is `exactCase: false`, the default (unreleased) |
| MD052 `reference-links-images`           | [`links/undefined-reference`](rules.md#linksundefined-reference), which also checks footnotes. Includes `shortcutSyntax`, and `ignoredLabels` with default `[]` (unreleased)                                                                         |
| MD053 `link-image-reference-definitions` | [`links/unused-definition`](rules.md#linksunused-definition), which also checks footnotes, with `ignoredDefinitions`                                                                                                                                 |
| MD054 `link-image-style`                 | [`links/allowed-notation`](rules.md#linksallowed-notation), after 0.5.0                                                                                                                                                                              |
| MD055 `table-pipe-style`                 | [`style/table`](rules.md#styletable), with `pipeStyle` for explicit borders, document consistency, or per-table consistency; required pipes are retained                                                                                             |
| MD056 `table-column-count`               | [`content/table-columns`](rules.md#contenttable-columns)                                                                                                                                                                                             |
| MD058 `blanks-around-tables`             | [`style/block-spacing`](rules.md#styleblock-spacing); next to blocks other than headings and lists after 0.5.0, where every renderer reads the same blocks                                                                                           |
| MD059 `descriptive-link-text`            | [`links/descriptive-text`](rules.md#linksdescriptive-text), with `prohibited_texts` as `prohibitedTexts`, also for Obsidian wikilinks                                                                                                                |
| MD060 `table-column-style`               | [`style/table`](rules.md#styletable), aligned, compact, or tight, with `alignedDelimiter`. A formatter selects a target style rather than accepting `any`                                                                                            |

`style/table` leaves tables inside lists and block quotes as written
([#710](https://github.com/viell-dev/slop-markdown-tools/issues/710)).
markdownlint's comments such as `<!-- markdownlint-disable -->` correspond to
mdrefine's [suppression comments](configuration.md#suppression-comments), and
its custom rules to [plugins](plugins.md).

For the heading checks, markdownlint's `level`, `allow_preamble`, and
`front_matter_title` choices correspond to mdrefine's `level`, `allowPreamble`,
and `frontMatterTitle`. For duplicate headings, use `siblingsOnly`; its default
is `true`, so set it to `false` for whole-outline checking. For fenced-code
languages, use `allowedLanguages` and `languageOnly`, corresponding to
`allowed_languages` and `language_only`. For unused definitions, use
`ignoredDefinitions`, corresponding to `ignored_definitions` with the same
default, `["//"]`, for comments written as `[//]: # (comment)`; `links/empty`
takes it too, so that it does not report such a comment's `#`. These are option
mappings, not a promise of identical defaults or behavior: initial-heading's
metadata-title recognition is off by default, and the heading checks use
Markdown headings with independent quote and footnote outlines. See each rule's
reference for its exact contract.

### Prettier

| Prettier                                         | mdrefine                                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proseWrap: "always"` and `printWidth`           | [`style/wrap`](rules.md#stylewrap) and its `width`                                                                                                                                                    |
| `proseWrap: "preserve"`, the default             | Turn `style/wrap` off and enable [`style/prose-space`](rules.md#styleprose-space), after 0.5.0                                                                                                        |
| `proseWrap: "never"`                             | After 0.5.0, [`style/wrap`](rules.md#stylewrap) with `mode: "never"`, preserving the same safety exceptions as wrapping                                                                               |
| `tabWidth`, for nested lists                     | [`style/list-indent`](rules.md#stylelist-indent)'s `nestedIndent`                                                                                                                                     |
| `useTabs`                                        | Nothing to set: Prettier indents Markdown with spaces either way                                                                                                                                      |
| `endOfLine`                                      | None yet ([#712](https://github.com/viell-dev/slop-markdown-tools/issues/712)); each document keeps its line endings                                                                                  |
| `embeddedLanguageFormatting`                     | Opt-in [code formatters](configuration.md#code-formatters), selected by fence language                                                                                                                |
| `singleQuote` and other title delimiters         | [`style/link-title`](rules.md#stylelink-title), after 0.5.0: double, single, parentheses, or consistent; keeps delimiters where conversion would need escapes                                         |
| `requirePragma` and `insertPragma`               | None yet ([#721](https://github.com/viell-dev/slop-markdown-tools/issues/721))                                                                                                                        |
| `<!-- prettier-ignore -->` and its start and end | [`<!-- mdrefine-disable -->`](configuration.md#suppression-comments) and its relatives                                                                                                                |
| `_` for emphasis, `**` for strong text           | [`style/emphasis`](rules.md#styleemphasis), [`style/strong`](rules.md#stylestrong)                                                                                                                    |
| `#` headings without closing `#`                 | [`style/heading`](rules.md#styleheading). After 0.5.0, one space after `#` and no heading-owned indentation                                                                                           |
| `-` for bullets, alternating for adjacent lists  | [`style/list-marker`](rules.md#stylelist-marker)                                                                                                                                                      |
| `1.` and numbering                               | [`style/ordered-list`](rules.md#styleordered-list); `auto` repeats a number when the first two items share it, where Prettier counts up unless the second number is 1                                 |
| One space after list markers, list indentation   | [`style/list-indent`](rules.md#stylelist-indent)                                                                                                                                                      |
| Backtick fences as short as the code allows      | [`style/code-fence`](rules.md#stylecode-fence); removing space before the info string is unreleased                                                                                                   |
| `---` for thematic breaks                        | [`style/thematic-break`](rules.md#stylethematic-break)                                                                                                                                                |
| Aligned tables                                   | [`style/table`](rules.md#styletable), with `padding: "alignment"` and display-column widths. Not yet tables in lists and quotes ([#710](https://github.com/viell-dev/slop-markdown-tools/issues/710)) |
| Trailing spaces removed, hard breaks kept        | [`style/trailing-space`](rules.md#styletrailing-space), after 0.5.0 with `hardBreakSpaces: 2` for exact two-space breaks                                                                              |
| Repeated blank lines collapsed                   | [`style/blank-lines`](rules.md#styleblank-lines)                                                                                                                                                      |
| Blank lines around blocks                        | [`style/block-spacing`](rules.md#styleblock-spacing), for headings and lists, and after 0.5.0 for fences and tables                                                                                   |
| Final newline                                    | [`style/final-newline`](rules.md#stylefinal-newline)                                                                                                                                                  |
| Code spans with the fewest backticks             | [`style/inline-code`](rules.md#styleinline-code) (unreleased)                                                                                                                                         |
| One space after `>`                              | None yet ([#682](https://github.com/viell-dev/slop-markdown-tools/issues/682))                                                                                                                        |
| Markers on lazy continuation lines               | None yet ([#713](https://github.com/viell-dev/slop-markdown-tools/issues/713))                                                                                                                        |
| One space in link reference definitions          | [`style/definition-spacing`](rules.md#styledefinition-spacing), after 0.5.0; keeps multiline definitions and Obsidian spacing                                                                         |
| YAML front matter                                | None yet ([#718](https://github.com/viell-dev/slop-markdown-tools/issues/718))                                                                                                                        |

Prettier keeps line breaks by default (`proseWrap: "preserve"`), while
`recommended` wraps at 80 columns. `style/wrap` keeps the lines of
[site-generator syntax](dialects.md#what-each-dialect-reads) such as `:::note`
and `{% tab %}`; for other syntax that depends on its line breaks, turn the rule
off or use a suppression comment.

## Agents and scripts

Read the [JSON report](cli.md#json-report) and the exit code, not the text
output, whose wording can change in any release. A diagnostic names its rule,
its position, and, for a style rule, the edit it proposes. A safe loop is:
`format --diff` to see the changes, `format --write` to apply them, then `lint`
again for what needs a person. The [examples](examples.md#automate-checks)
include a script that summarizes a report. To report a defect of the tool,
follow the [contribution
guide](https://github.com/viell-dev/slop-markdown-tools/blob/main/CONTRIBUTING.md#report-a-defect).
