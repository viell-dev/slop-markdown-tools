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

With the [pre-commit](https://pre-commit.com/) framework, a hook in the
repository's `.pre-commit-config.yaml` installs mdrefine in an environment of
its own, with the computer's Node.js, and passes it the staged Markdown files;
it needs no `package.json`:

```yaml
repos:
  - repo: local
    hooks:
      - id: mdrefine
        name: mdrefine
        language: node
        additional_dependencies: ["mdrefine@0.6.0"]
        entry: mdrefine lint --max-warnings 0 --no-warn-ignored
        types: [markdown]
```

With [lefthook](https://lefthook.dev/), installed in the project next to
mdrefine, add to `lefthook.yml`:

```yaml
pre-commit:
  commands:
    mdrefine:
      glob: "*.{md,markdown}"
      run: npx --no-install mdrefine lint --max-warnings 0 --no-warn-ignored -- {staged_files}
```

Both skip the command when the commit changes no Markdown file, and lefthook's
glob also matches files in subdirectories.

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
Leave Markdown to mdrefine in this order:

1. Run `npx mdrefine config convert --write` to keep the style that Prettier
   gave your documents; [conversion and
   fallback](#configuration-conversion-and-fallback) describes what it carries
   over. Skip this step to use mdrefine's `recommended` preset instead.
2. Add both file extensions to `.prettierignore`:

   ```text
   **/*.md
   **/*.markdown
   ```

The order matters. Without an mdrefine configuration, mdrefine falls back to the
Prettier configuration, but not once `.prettierignore` excludes all Markdown:
Prettier then formats no Markdown in the workspace, so its options do not
describe your documents, and `config convert` and the fallback leave the
Prettier configuration out and say so. A `.prettierignore` counts as excluding
all Markdown only when that can be established, reading each entry as Prettier
does, as a gitignore pattern without regard to letter case:

- It counts when one entry by itself excludes every `.md` file, whatever its
  name and directory, such as `*.md`, `**/*.md`, `*.MD`, or `*`. An entry for
  `.markdown` is not needed: an entry for `.md` files alone is the usual way to
  leave Markdown to another tool.
- It does not count with only narrower entries, such as `docs/*.md`, or `/*.md`,
  which leaves the Markdown in subdirectories to Prettier.
- It never counts with a negated (`!`) entry or a character class such as
  `*.[mM][dD]`, because then it cannot be proved to leave Prettier no Markdown:
  `**/*.md` with `!README.md` does not count, nor even `**/*.md` with `!docs/`,
  which re-includes no document.

markdownlint and mdrefine can run side by side, but rules that overlap can
disagree, such as markdownlint's emphasis style (MD049) and `style/emphasis`.
Turn off in one tool what the other covers; the tables below list the overlaps.

## Coming from Prettier or markdownlint

mdrefine is meant to replace these tools for Markdown. The tables below list
every rule of markdownlint 0.42 and every Markdown option and formatting choice
of Prettier 3.9, with the mdrefine rule that covers each and where it behaves
differently. Each row follows the check's documented purpose, not the other
tool's known defects. A row that says "None yet" or "Not yet" links the issue
that tracks a missing part; keep the other tool for that check until it is done.

### Configuration conversion and fallback

Run `mdrefine config convert` to print an `mdrefine.config.jsonc`, or add
`--write` to create it where `lint` looks for the workspace's configuration; an
existing mdrefine configuration there is an error. The report on stderr lists
sources, files not used, omissions with reasons and applicable tracking issues,
resolved conflicts, and suggested extra checks. Review the result before
replacing your existing tools. [Convert a
configuration](cli.md#convert-a-configuration) describes its options.

Without an mdrefine configuration, the same conversion runs in memory. Use
`--no-competitor-config` to disable this fallback. `config explain <file>` shows
its sources and converted settings. The search stops at the same repository or
vault boundary as the ordinary configuration search. When none of the files
found can be used, the `recommended` preset applies, as without them; the
[notices](cli.md#competitor-fallback-notices) on stderr name each such file.

The result uses no preset. markdownlint's enabled checks map to their
counterparts, including its default rule set unless `default: false` is set.
Prettier enables its fixed styles. `proseWrap: "always"` enables wrapping at
`printWidth` (80 by default), `"never"` joins paragraph lines, and `"preserve"`
leaves wrapping off. Only stated markdownlint option values win fixed Prettier
styles; Prettier options win the settings they control. Missing behavior is
reported. Enabled markdownlint checks use `error`, matching its failing exit
status. Rules enabled only by Prettier use `warn`; `format --check` fails
regardless of severity. A markdownlint disable keeps an overlapping Prettier
style enabled. MD013 does not enable reflow: without Prettier wrapping,
paragraph lines are reported as unchecked, with a suggestion to enable
`style/wrap` at that width. The mapping follows intended behavior and retains
mdrefine's safety guards.

Fallback loading reads JSON, JSONC, and YAML, including markdownlint `extends`,
markdownlint-cli2 `config` (without one, a `.markdownlint.*` file or else
markdownlint's defaults, as markdownlint-cli2 uses), Prettier's `package.json`
or `package.yaml` key, Markdown overrides, and relevant `.editorconfig` values
only when a Prettier configuration exists. JavaScript and TypeScript
configurations are named without executing them and contribute nothing; the
explicit convert command loads them through Node.js. TOML and JSON5 are not
read, by either. An extensionless `.prettierrc` is read as YAML, as Prettier
reads it, so it can hold JSON; a JSON comment in it becomes part of the next key
in Prettier too, which ignores that setting, and conversion reports it. A file
that cannot be parsed is an error that names it. `.prettierignore` and
markdownlint-cli2 `ignores` and `globs` become `ignore`. Negated
`.prettierignore` patterns cannot be converted: `config convert` reports them
for manual migration and converts the other patterns, so review its `ignore`
before using it. The fallback, which has no such review, applies none of the
patterns of a `.prettierignore` with a negated entry: it checks the documents
that the file excludes rather than apply the exclusions without their
exceptions, which can leave nothing to check. `.markdownlintignore`, the ignore
file of markdownlint-cli and editor extensions, is not converted: beside a
markdownlint configuration in use, the documents it excludes are checked; add
its patterns to `ignore` in an mdrefine configuration. The
[notices](cli.md#competitor-fallback-notices) and `conversion.unused` say so.

Pattern conversion is bounded by source dialect. Prettier overrides,
EditorConfig sections, and markdownlint-cli2 globs support literal paths, `*`,
`?`, and whole-component `**`. Brace alternatives must be flat comma lists,
without nesting, empty alternatives, ranges, or `**` inside. Accepted escapes
are backslash followed by another backslash or one of `#`, `?`, `!`, `*`, `[`,
`]`, `{`, `}`, `(`, `)`, `+`, or `@`. Other escapes, character classes,
unescaped parentheses, quoted patterns, and whole-pattern complements are
reported with their source and pattern for manual migration rather than emitted.
Prettier brace patterns also retain their literal spelling, and terminal `/**`
also matches the file before that suffix. CLI2 negative globs are directory
exclusions, and their descendants are expanded before rebasing. When several
CLI2 positive globs need a combined selection, a literal comma outside braces or
a brace alternative cannot be represented in that union: the selection is
reported and omitted. A single positive glob keeps its ordinary meaning.

`.prettierignore` supports literal paths, `*`, `?`, whole-component `**`, the
same accepted escapes, root anchors, and directory suffixes; braces and
parentheses stay literal. Character classes, trailing whitespace, and negated
entries are reported rather than emitted. Prettier matches ignore patterns
without regard to letter case; converted patterns match case exactly. Conversion
reports this approximation once per `.prettierignore` file.

All subsets reject `.`, `..`, and empty path components, and absolute paths,
including Windows drive and UNC spellings on every platform. A leading `/` in
EditorConfig or `.prettierignore` is a source-root anchor, and a trailing `/` in
`.prettierignore` marks a directory; these are permitted boundaries rather than
empty components. Every emitted pattern is rebased into the destination subtree;
unrepresentable intersections are also reported for manual migration.

During the competitor fallback, markdownlint inline comments and Prettier ignore
comments and `requirePragma` apply. With an mdrefine configuration, including
one that `config convert` writes, they have no effect: migrate them to
mdrefine's own [suppression comments](configuration.md#suppression-comments).

markdownlint's `disable`, `enable`, `disable-line`, `disable-next-line`,
`disable-file`, and `enable-file` select enabled markdownlint checks by ID,
alias, or tag, without regard to case. File directives apply throughout the
file; other transitions start on their own line. `capture` saves one snapshot of
enabled checks, replacing the previous snapshot; `restore` restores it,
initially the file's configuration. `configure-file` merges JSON settings in
source order for the whole file and uses the configuration converter. Unknown
names or checks without counterparts suppress nothing and are reported once per
run, with a tracking issue where available.

Each rule retains its enabled competitor origins outside the configuration.
Disabling a markdownlint check leaves Prettier's choice active at warning
severity, using Prettier's own options in that region. Stated markdownlint
options still win where both sources are active. Each distinct set of active
checks is converted with Prettier's choices and the same file override patches.
The engine evaluates each distinct rule setting once per inspection and selects
its findings in the corresponding regions. This also recalculates dependent
options: disabling MD022 restores MD012's own blank-line maximum.

Shared destinations attribute findings to their source checks: `style/heading`
(MD003, MD019, MD021, MD023), `style/list-indent` (MD005, MD007, MD030), and
`style/table` (MD055, MD060). Table rows and list operations retain active check
diagnostics even when the construct starts in a suppressed region.
`style/block-spacing` (MD022, MD031, MD032, MD058) attributes findings to their
named block, and `structure/unspaced-heading` (MD018, MD020) distinguishes
ordinary and closed ATX candidates. A combined edit is withheld when it needs a
suppressed check; active diagnostics remain. For every rule, an edit crossing
regions is accepted only when each region proposes the same replacement and
authorizes its checks. This can leave a whole table or list as written when a
partial repair is unavailable. Every proposal still passes the ordinary edit and
semantic safety checks.

Prettier's `ignore` preserves the next parsed node; `ignore-start` and
`ignore-end` preserve a top-level range, with blank lines before the comments.
They prevent edits in that source even from a shared rule, while markdownlint
findings still report without edits. `requirePragma: true` limits Prettier
formatting to documents beginning with `<!-- @format -->` or
`<!-- @prettier -->`, also immediately after front matter; markdownlint checks
still run. `insertPragma` is not carried over.

### markdownlint rules

markdownlint enables its default rule set; template, proper-name, notation, and
column-style checks require configuration. mdrefine's presets enable fewer: a
rule that no preset in your configuration enables, such as
`structure/heading-punctuation`, needs an entry under `rules`. Each rule's
[page](rules.md) names its presets.

| markdownlint                             | mdrefine                                                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MD001 `heading-increment`                | [`structure/heading-increment`](rules/structure/heading-increment.md), with block quotes checked apart, and `frontMatterTitle`, off by default                                                                                           |
| MD003 `heading-style`                    | [`style/heading`](rules/style/heading.md), whose default converts underlined headings; `closing: "add"` writes closed ATX styles                                                                                                         |
| MD004 `ul-style`                         | [`style/list-marker`](rules/style/list-marker.md), with `consistent` and `sublist`                                                                                                                                                       |
| MD005 `list-indent`                      | [`style/list-indent`](rules/style/list-indent.md)                                                                                                                                                                                        |
| MD007 `ul-indent`                        | [`style/list-indent`](rules/style/list-indent.md)'s `nestedIndent`, `startIndented`, and `startIndent`                                                                                                                                   |
| MD009 `no-trailing-spaces`               | [`style/trailing-space`](rules/style/trailing-space.md): `hardBreakSpaces`, `listItemEmptyLines`, and report-only `codeBlocks`; strict cleanup outside hard breaks                                                                       |
| MD010 `no-hard-tabs`                     | [`style/no-tabs`](rules/style/no-tabs.md); literal content is report-only                                                                                                                                                                |
| MD011 `no-reversed-links`                | [`links/reversed`](rules/links/reversed.md)                                                                                                                                                                                              |
| MD012 `no-multiple-blanks`               | [`style/blank-lines`](rules/style/blank-lines.md), with `maximum`                                                                                                                                                                        |
| MD013 `line-length`                      | [`style/wrap`](rules/style/wrap.md), which wraps paragraphs instead of only reporting. [`content/line-length`](rules/content/line-length.md) reports headings, code blocks, and tables                                                   |
| MD014 `commands-show-output`             | [`content/shell-prompt`](rules/content/shell-prompt.md), for shell and unlabeled code blocks, with `$` and `%` prompts                                                                                                                   |
| MD018 `no-missing-space-atx`             | [`structure/unspaced-heading`](rules/structure/unspaced-heading.md), which leaves Obsidian tags and issue references alone                                                                                                               |
| MD019 `no-multiple-space-atx`            | [`style/heading`](rules/style/heading.md)                                                                                                                                                                                                |
| MD020 `no-missing-space-closed-atx`      | [`structure/unspaced-heading`](rules/structure/unspaced-heading.md), for paragraph text such as `#Heading#`                                                                                                                              |
| MD021 `no-multiple-space-closed-atx`     | [`style/heading`](rules/style/heading.md); removes closing `#` by default or normalizes retained separators                                                                                                                              |
| MD022 `blanks-around-headings`           | [`style/block-spacing`](rules/style/block-spacing.md), with `linesAbove`, `linesBelow`, and `includeFrontMatter`; counts that `style/blank-lines` would remove are refused                                                               |
| MD023 `heading-start-left`               | [`style/heading`](rules/style/heading.md); preserves container prefixes                                                                                                                                                                  |
| MD024 `no-duplicate-heading`             | [`structure/duplicate-heading`](rules/structure/duplicate-heading.md); `siblingsOnly` defaults to `true`                                                                                                                                 |
| MD025 `single-title`                     | [`structure/single-title`](rules/structure/single-title.md)                                                                                                                                                                              |
| MD026 `no-trailing-punctuation`          | [`structure/heading-punctuation`](rules/structure/heading-punctuation.md), which reads headings as renderers show them and leaves abbreviations, ellipses, and emoji shortcodes alone                                                    |
| MD027 `no-multiple-space-blockquote`     | [`style/quote-marker`](rules/style/quote-marker.md), with `listItems`                                                                                                                                                                    |
| MD028 `no-blanks-blockquote`             | [`structure/split-quote`](rules/structure/split-quote.md), except before an alert or callout                                                                                                                                             |
| MD029 `ol-prefix`                        | [`style/ordered-list`](rules/style/ordered-list.md); `same` repeats the existing start; conversion reports that `one` and `zero` start-number checks are not carried over, because the rendered first number is preserved                |
| MD030 `list-marker-space`                | [`style/list-indent`](rules/style/list-indent.md), with the same four spacings                                                                                                                                                           |
| MD031 `blanks-around-fences`             | [`style/block-spacing`](rules/style/block-spacing.md); outside list items and footnote definitions, as with `list_items: false`                                                                                                          |
| MD032 `blanks-around-lists`              | [`style/block-spacing`](rules/style/block-spacing.md)                                                                                                                                                                                    |
| MD033 `no-inline-html`                   | [`content/html-element`](rules/content/html-element.md), with `allowedElements` and `tableAllowedElements`                                                                                                                               |
| MD034 `no-bare-urls`                     | [`links/bare-url`](rules/links/bare-url.md)                                                                                                                                                                                              |
| MD035 `hr-style`                         | [`style/thematic-break`](rules/style/thematic-break.md), with exact break text or `consistent`                                                                                                                                           |
| MD036 `no-emphasis-as-heading`           | [`structure/emphasis-heading`](rules/structure/emphasis-heading.md), whatever the paragraph's line length                                                                                                                                |
| MD037 `no-space-in-emphasis`             | [`content/emphasis-spacing`](rules/content/emphasis-spacing.md), reported only where the parser reads emphasis once the spaces are gone; not a single `*` or `_` with spaces on both sides at both ends, such as `a * b * c`             |
| MD038 `no-space-in-code`                 | [`content/inline-code-spacing`](rules/content/inline-code-spacing.md), reported only, next to a letter or digit; not spaces that show syntax or indentation, as in `- `, or that a backtick at an end of the code needs                  |
| MD039 `no-space-in-links`                | [`links/text-spacing`](rules/links/text-spacing.md), reported only, because moving the spaces changes the link text and where they belong depends on the text around the link                                                            |
| MD040 `fenced-code-language`             | [`content/code-language`](rules/content/code-language.md)                                                                                                                                                                                |
| MD041 `first-line-heading`               | [`structure/initial-heading`](rules/structure/initial-heading.md)                                                                                                                                                                        |
| MD042 `no-empty-links`                   | [`links/empty`](rules/links/empty.md)                                                                                                                                                                                                    |
| MD043 `required-headings`                | [`structure/heading-template`](rules/structure/heading-template.md), checking the document's own outline only                                                                                                                            |
| MD044 `proper-names`                     | [`content/proper-names`](rules/content/proper-names.md), reported only, skipping inline code and, by default, code blocks                                                                                                                |
| MD045 `no-alt-text`                      | [`content/image-alt`](rules/content/image-alt.md), also HTML `<img>` without `alt`; `alt=""` marks a decorative image, and `aria-hidden="true"` counts outside GitHub                                                                    |
| MD046 `code-block-style`                 | [`style/code-block`](rules/style/code-block.md), with `consistent`, `fenced`, or `indented`; indented blocks are fenced where that is safe, outside VitePress, and other findings are reported only                                      |
| MD047 `single-trailing-newline`          | [`style/final-newline`](rules/style/final-newline.md)                                                                                                                                                                                    |
| MD048 `code-fence-style`                 | [`style/code-fence`](rules/style/code-fence.md)                                                                                                                                                                                          |
| MD049 `emphasis-style`                   | [`style/emphasis`](rules/style/emphasis.md). Includes `marker: "consistent"`                                                                                                                                                             |
| MD050 `strong-style`                     | [`style/strong`](rules/style/strong.md). Includes `marker: "consistent"`                                                                                                                                                                 |
| MD051 `link-fragments`                   | [`links/valid`](rules/links/valid.md), which also checks that local files exist. Includes `ignored_pattern` as `ignoredFragments`, and `exactCase`, the inverse of `ignore_case`: `ignore_case: true` is `exactCase: false`, the default |
| MD052 `reference-links-images`           | [`links/undefined-reference`](rules/links/undefined-reference.md), which also checks footnotes. Includes `shortcutSyntax`, and `ignoredLabels` with default `[]`                                                                         |
| MD053 `link-image-reference-definitions` | [`links/unused-definition`](rules/links/unused-definition.md), which also checks footnotes, with `ignoredDefinitions`                                                                                                                    |
| MD054 `link-image-style`                 | [`links/allowed-notation`](rules/links/allowed-notation.md)                                                                                                                                                                              |
| MD055 `table-pipe-style`                 | [`style/table`](rules/style/table.md), with `pipeStyle` for explicit borders, document consistency, or per-table consistency; required pipes are retained                                                                                |
| MD056 `table-column-count`               | [`content/table-columns`](rules/content/table-columns.md)                                                                                                                                                                                |
| MD058 `blanks-around-tables`             | [`style/block-spacing`](rules/style/block-spacing.md); next to blocks other than headings and lists where every renderer reads the same blocks                                                                                           |
| MD059 `descriptive-link-text`            | [`links/descriptive-text`](rules/links/descriptive-text.md), with `prohibited_texts` as `prohibitedTexts`, also for Obsidian wikilinks                                                                                                   |
| MD060 `table-column-style`               | [`style/table`](rules/style/table.md), aligned, compact, or tight, with `alignedDelimiter`. A formatter selects a target style rather than accepting `any`                                                                               |

markdownlint's comments such as `<!-- markdownlint-disable -->` correspond to
mdrefine's [suppression comments](configuration.md#suppression-comments), and
its custom rules to [plugins](plugins.md).

For the heading checks, markdownlint's `level`, `allow_preamble`, and
`front_matter_title` choices correspond to mdrefine's `level`, `allowPreamble`,
and `frontMatterTitle`. MD001 reads a front-matter title by default;
`structure/heading-increment` does so with `frontMatterTitle: true`, off by
default because the renderers that mdrefine supports do not show that title as a
heading. MD022's `lines_above`, `lines_below`, and `include_front_matter` are
`linesAbove`, `linesBelow`, and `includeFrontMatter`, with the same counts;
mdrefine refuses counts that `style/blank-lines` would remove, where
markdownlint leaves MD022 and MD012 to disagree. For duplicate headings, use
`siblingsOnly`; its default is `true`, so set it to `false` for whole-outline
checking. For fenced-code languages, use `allowedLanguages` and `languageOnly`,
corresponding to `allowed_languages` and `language_only`. For unused
definitions, use `ignoredDefinitions`, corresponding to `ignored_definitions`
with the same default, `["//"]`, for comments written as `[//]: # (comment)`;
`links/empty` takes it too, so that it does not report such a comment's `#`.
These are option mappings, not a promise of identical defaults or behavior:
initial-heading's and heading-increment's metadata-title recognition is off by
default, and the heading checks use Markdown headings with independent quote and
footnote outlines. See each rule's reference for its exact contract.

### Prettier

Prettier keeps Setext headings; conversion uses `style/heading` to normalize
them to ATX. mdrefine has no mode that keeps mixed Setext and ATX styles while
normalizing heading spacing. Wrapping also leaves paragraphs with hard line
breaks as written, where Prettier can wrap their individual lines.

Language-only options such as `semi`, `trailingComma`, `quoteProps`,
`jsxSingleQuote`, `bracketSpacing`, `bracketSameLine`, `arrowParens`,
`htmlWhitespaceSensitivity`, `vueIndentScriptAndStyle`, `objectWrap`,
`experimentalTernaries`, and `experimentalOperatorPosition` do not select a
Markdown rule. External embedded-code formatting needs explicit code tools.
Parser, plugin, range, and file-context settings are reported rather than
executed or used to change dialect detection.

| Prettier                                         | mdrefine                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proseWrap: "always"` and `printWidth`           | [`style/wrap`](rules/style/wrap.md) and its `width`                                                                                                                    |
| `proseWrap: "preserve"`, the default             | Turn `style/wrap` off and enable [`style/prose-space`](rules/style/prose-space.md)                                                                                     |
| `proseWrap: "never"`                             | [`style/wrap`](rules/style/wrap.md) with `mode: "never"`, preserving the same safety exceptions as wrapping                                                            |
| `tabWidth`, for nested lists                     | [`style/list-indent`](rules/style/list-indent.md)'s `nestedIndent`                                                                                                     |
| `useTabs`                                        | Nothing to set: Prettier indents Markdown with spaces either way                                                                                                       |
| `endOfLine`                                      | [`style/line-ending`](rules/style/line-ending.md), opt-in; literal content keeps its bytes                                                                             |
| `embeddedLanguageFormatting`                     | Opt-in [code formatters](configuration.md#code-formatters), selected by fence language                                                                                 |
| `singleQuote` and other title delimiters         | [`style/link-title`](rules/style/link-title.md): double, single, parentheses, or consistent; keeps delimiters where conversion would need escapes                      |
| `requirePragma` and `insertPragma`               | `requirePragma` applies during fallback; `insertPragma` is not carried over, and no pragma applies with an mdrefine configuration                                      |
| `<!-- prettier-ignore -->` and its start and end | Honored during fallback; with a written configuration use [`<!-- mdrefine-disable -->`](configuration.md#suppression-comments) and its relatives                       |
| `_` for emphasis, `**` for strong text           | [`style/emphasis`](rules/style/emphasis.md), [`style/strong`](rules/style/strong.md)                                                                                   |
| `#` headings without closing `#`                 | [`style/heading`](rules/style/heading.md), with one space after `#` and no heading-owned indentation                                                                   |
| `-` for bullets, alternating for adjacent lists  | [`style/list-marker`](rules/style/list-marker.md)                                                                                                                      |
| `1.` and numbering                               | [`style/ordered-list`](rules/style/ordered-list.md); `auto` repeats a number when the first two items share it, where Prettier counts up unless the second number is 1 |
| One space after list markers, list indentation   | [`style/list-indent`](rules/style/list-indent.md)                                                                                                                      |
| Backtick fences as short as the code allows      | [`style/code-fence`](rules/style/code-fence.md), which also removes space before the info string                                                                       |
| `---` for thematic breaks                        | [`style/thematic-break`](rules/style/thematic-break.md)                                                                                                                |
| Aligned tables                                   | [`style/table`](rules/style/table.md), with `padding: "alignment"` and display-column widths                                                                           |
| Trailing spaces removed, hard breaks kept        | [`style/trailing-space`](rules/style/trailing-space.md), with `hardBreakSpaces: 2` for exact two-space breaks                                                          |
| Repeated blank lines collapsed                   | [`style/blank-lines`](rules/style/blank-lines.md)                                                                                                                      |
| Blank lines around blocks                        | [`style/block-spacing`](rules/style/block-spacing.md), for headings, lists, fences, and tables                                                                         |
| Final newline                                    | [`style/final-newline`](rules/style/final-newline.md)                                                                                                                  |
| Code spans with the fewest backticks             | [`style/inline-code`](rules/style/inline-code.md)                                                                                                                      |
| One space after `>`                              | [`style/quote-marker`](rules/style/quote-marker.md)                                                                                                                    |
| Markers on lazy continuation lines               | [`style/lazy-continuation`](rules/style/lazy-continuation.md); footnote definitions keep their first line on the label's line                                          |
| One space in link reference definitions          | [`style/definition-spacing`](rules/style/definition-spacing.md); keeps multiline definitions and Obsidian spacing                                                      |
| YAML front matter                                | Covered by configuring an external [front matter formatter](configuration.md#front-matter-formatters)                                                                  |

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
