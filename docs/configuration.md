# Configuration and rules

## Loading and precedence

Discovery searches upward from `--root` or the working directory for
`mdtools.config.jsonc`, `mdtools.config.json`, or `mdtools.config.mjs`. It stops
at a Git repository, an Obsidian vault, or the filesystem root. Multiple config
files in one directory are an error. `--config` chooses one explicitly. The
configuration directory is the workspace root unless `--root` overrides it.

JSONC permits comments and trailing commas. JavaScript configuration exports a
default object. JavaScript configs and plugins execute code with the caller's
permissions; load trusted code only. Unknown configuration keys, rule IDs,
preset names, and invalid built-in rule options are errors.

Presets merge in listed order, followed by the configuration's own settings,
followed by matching `overrides` in order. Each rule setting replaces the
previous setting as a whole. Paths in overrides and ignores use forward slashes
relative to the workspace root. Presets can extend other presets; cycles are
rejected. Config files do not implicitly cascade or merge across directories.

`--dialect` replaces the top-level dialect; an explicit file override still
takes precedence. `config explain <file>` prints the resolved configuration and
its source file.

```jsonc
{
  "extends": ["recommended", "github"],
  "ignore": ["generated/**"],
  "overrides": [
    {
      "files": ["vault/**/*.md"],
      "dialect": "obsidian",
      "rules": { "style/emphasis": "off" },
    },
  ],
}
```

For Obsidian reflow, use a workspace rooted at the vault so `.obsidian/app.json`
can be inspected. Multiple vaults with independent settings should be processed
separately.

## Dialects

`dialect` selects the renderer whose rules apply: `commonmark`, `github`,
`forgejo`, `gitea`, or `obsidian`. `codeberg` is an alias for `forgejo`, because
Codeberg runs Forgejo's renderer; aliases are accepted wherever a dialect is
named and resolve to the canonical name in `config explain` and plugin
documents.

GitHub and Forgejo share tables, task lists, strikethrough, footnotes, literal
autolinks, `$` math, and the five `[!NOTE]`-style alert types. Forgejo
additionally renders definition lists (`Term` followed by a line starting with
`: `), `\(...\)` and `\[...\]` math, and `[[target|text]]` shortlinks, and
generates heading anchors differently: every run of characters other than
letters, numbers, and `_` becomes one hyphen, so `## test.0.1` is `#test-0-1` on
Forgejo and `#test01` on GitHub. The Forgejo dialect keeps those constructs on
their original lines, leaves emphasis markers and code spans inside `\(...\)`
unchanged, and validates fragments against Forgejo anchors. The GitHub rules
apply to both dialects.

Gitea, from which Forgejo was forked, renders the same definition lists and
shortlinks. It parses `\(...\)` and `\[...\]` math only when an administrator
enables them with `MATH_CODE_BLOCK_DETECTION`, as was the default before
Gitea 1.24; a document cannot reveal that setting, so the Gitea dialect keeps
those constructs on their lines too. Gitea's heading anchors follow GitHub's:
punctuation is deleted, so `## test.0.1` is `#test01`. Gitea 1.26 and later give
repeated headings the same anchor; the `-1`, `-2` suffixes of earlier versions
are still accepted. Gitea 1.26 and later also render `__init__.py` literally
instead of as emphasis, including in headings, whose anchor is then
`#__init__py`. Whether underscores delimit emphasis depends on the rest of the
line, so on a line containing `_.py` the Gitea dialect leaves emphasis markers
unchanged and keeps link destinations whose rewrite would change their
underscores. It does not reflow such a paragraph unless all its underscores are
inside code spans and it contains no `$` or `\(` math. The GitHub rules apply to
Gitea as well. Gitea renders repository files with soft line breaks by default;
if an instance adds `new-line-hard-break` to `RENDER_OPTIONS_REPO_FILE`, disable
`style/wrap`.

Forgejo, and Gitea before 1.26, build a heading's anchor from the source of its
last line as written, before any Markdown in it is read. Link destinations,
image syntax, emphasis markers, character references, and inline HTML tags are
part of the anchor, and a heading underlined with `===` or `---` gets the anchor
of its last text line only. `## Link [text](https://example.com/page) end` is
`#link-text-https-example-com-page-end` on Forgejo and
`#link-texthttpsexamplecompage-end` on Gitea 1.25, `## Strong __init__ end` is
`#strong-__init__-end` on both, and `## A <span>B</span>` is `#a-span-b-span`
and `#a-spanbspan`. The opening and closing `#` sequences, the blank space
around the text, block quote and list prefixes, and a trailing attribute block
are not part of the line. GitHub, and Gitea 1.26 and later, build the anchor
from the rendered text instead: `#link-text-end`, `#strong-init-end`, and
`#a-b`, with the text of every line of an underlined heading. GitHub keeps the
tags that it shows as text, such as `<script>`, in the anchor. The Gitea dialect
accepts the anchors of both Gitea generations.

Forgejo and Gitea read a `{...}` block that ends a heading as attributes instead
of text. `## Install {#setup}` renders as "Install" with the anchor `#setup` and
no `#install`; `## Usage {.note}` keeps the generated anchor `#usage`. The
Forgejo and Gitea dialects validate fragments against those anchors. A block
holds `#id`, `.class`, and `name=value` items, such as
`{#setup .note data-level=2}`, and ends the heading's line or, in a heading
underlined with `===` or `---`, its last text line; after a closing `#` sequence
it still counts (`## Install ## {#setup}`). A block that is not valid, that is
followed by more text, or whose `{` is escaped with a backslash stays heading
text. A custom anchor must be linked exactly as written, including its case, and
it is never numbered: a later `## Setup` heading is also `#setup`, not
`#setup-1`. GitHub and Obsidian show the block as text, so the other dialects
keep it in heading anchors and heading names. An `id` that is not text, such as
`{id=5}`, `{id=true}`, or a list, has no anchor on Gitea 1.26 and later, and
Forgejo, and Gitea before 1.26, render nothing for the whole document; the
Forgejo and Gitea presets report it with `forgejo/heading-id`. Quote the value
(`{id="5"}`) or use `{#5}` instead.

Formatting with the Forgejo or Gitea dialect leaves a block as written:
`{#bare data-x=__init__}` is a valid block, and `{#bare data-x=**init**}` is
heading text without the anchor `#bare`. A change can also create a block:
`## *Mode {.a*}` is emphasis, while `## _Mode {.a_}` is a heading with a class.
`style/emphasis`, `style/strong`, and `links/path` therefore change nothing from
the first `{` of a heading's last text line on. `style/inline-code` does not
join a code span that spans lines of a heading, and `style/heading` escapes a
`#` run in front of the block (`# Run \## {#id}`), which would otherwise end the
heading there.

## Presets

| Preset        | Dialect   | Enabled rules                                                                                  |
| ------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `recommended` | Unchanged | Wrap at 80, `_` emphasis, `**` strong, final newline, valid links                              |
| `github`      | GitHub    | Table alignment, lowercase completed task marker, uppercase alert marker                       |
| `forgejo`     | Forgejo   | The `github` rules and `forgejo/heading-id`                                                    |
| `codeberg`    | Forgejo   | Alias of `forgejo`                                                                             |
| `gitea`       | Gitea     | The `github` rules and `forgejo/heading-id`                                                    |
| `obsidian`    | Obsidian  | Table alignment, task marker, lowercase callout type, duplicate block IDs, soft-break settings |

An omitted `extends` selects `recommended`. Explicit `extends` replaces that
default, so use `["recommended", "obsidian"]` for both. `extends: []` enables
nothing. Severity is `off`, `warn`, or `error`; supply options as
`["warn", { ... }]`. Both `warn` and `error` style rules format when enabled.
Problem rules report findings and never become formatting edits.

## Built-in rules

| Rule                          | Kind    | Options                                                                |
| ----------------------------- | ------- | ---------------------------------------------------------------------- |
| `style/wrap`                  | Style   | `width`, `measure`, `reportUnreflowed`, `reportUnbreakable`; see below |
| `style/inline-code`           | Style   | None; joins multiline code spans, opt-in                               |
| `style/emphasis`              | Style   | `marker`: `_` (default) or `*`                                         |
| `style/strong`                | Style   | `marker`: `*` (default) or `_`                                         |
| `style/final-newline`         | Style   | None; adds a missing final newline                                     |
| `style/table`                 | Style   | None; aligns top-level GFM tables                                      |
| `style/heading`               | Style   | None; converts eligible Setext headings to ATX                         |
| `links/valid`                 | Problem | None; local files and heading/block fragments                          |
| `links/path`                  | Style   | `style`, `brackets`, `extension`, `leadingDot`; see below              |
| `links/notation`              | Style   | `style`: `markdown` or `wiki`; Obsidian only                           |
| `github/task-marker`          | Style   | None; `[X]` becomes `[x]`                                              |
| `github/alert-marker`         | Style   | None; known alert types become uppercase on GitHub, Forgejo, and Gitea |
| `forgejo/heading-id`          | Problem | None; heading ids that are not text, which break rendering on Forgejo  |
| `obsidian/callout-marker`     | Style   | None; Obsidian callout types become lowercase                          |
| `obsidian/block-reference`    | Problem | None; duplicate trailing `^block-id` markers                           |
| `obsidian/strict-line-breaks` | Problem | None; report unverified/incompatible reflow settings                   |

## Document structure

Enable `structure/initial-heading` explicitly with severity `warn` or `error`;
no preset enables it. It accepts no options and reports problems without
changing content. Use path `overrides` to exempt generated documents or trees
with different conventions.

`structure/initial-heading` skips YAML/TOML front matter and requires a level-1
heading as the first content block. Both ATX and Setext headings count; use
`style/heading` separately to require ATX spelling. Empty documents are
reported. Comments and other content before the title are not skipped.

Filename/title matching, metadata placement, and guesses about accidental
Markdown markers are consumer policies. Implement those checks through
[rule plugins](plugins.md#rule-plugins), which receive the document source,
parsed tree, and path. Modified-date updates belong in a consumer wrapper or
library workflow; formatting rules must preserve document meaning.

## Wrapping and inline code

`style/wrap` accepts widths from 20 through 500 and defaults to `width: 80` and
`measure: "columns"` (display columns). Set `measure: "codepoints"` to count
Unicode scalar values instead; astral characters count once and combining marks
count separately. Container prefixes count toward the width in either mode.

`reportUnreflowed: true` reports breakable over-width lines in paragraphs
protected by hard breaks, block IDs, inline HTML, callout headers, Forgejo or
Gitea definition lists, display math, line-spanning inline syntax, or the Gitea
`_.py` emphasis exception, or unsupported multiline syntax or containers.
`reportUnbreakable: true` reports overflow from an atom that cannot be split,
including in protected paragraphs. Whitespace inside a link, code span, or other
protected inline node is not a wrapping opportunity, nor is whitespace inside a
Forgejo or Gitea `\(...\)` expression or `[[...]]` shortlink written on one
line. A protected paragraph with both breakable prose and an over-width atom can
report both causes; an atom-only overflow does not trigger `reportUnreflowed`.
Hard-break markers are excluded from protected-line width. An Obsidian callout
title is one indivisible physical line: an over-width title follows
`reportUnbreakable`, even when it contains spaces. Body prose is classified
separately. A block ID does not make its whole paragraph indivisible. Both
options default to false, propose no edits, and use the rule's severity. Use
severity `error` or `--max-warnings 0` to make these diagnostics fail a check;
`--check` does not change rule settings.

Enable `style/inline-code` to join multiline code spans before paragraph reflow.
This opt-in rule handles single and multiple backticks, including list and quote
containers. It preserves the parsed code value, converting each line ending to
one space under CommonMark's code-span rules. Other code whitespace remains
significant. It is useful for Obsidian editors that display split spans
differently from Reading view.

## Link policies

```jsonc
{
  "extends": ["recommended", "obsidian"],
  "rules": {
    "links/path": ["warn", { "style": "root", "brackets": "angle", "extension": "preserve" }],
  },
}
```

`style` accepts `preserve` (default), `relative`, `root`, or `shortest`. `root`
means vault-relative, without a leading slash, and is available only for
Obsidian. `shortest` uses the basename if it resolves uniquely, otherwise the
vault-relative path. `leadingDot: true` prefixes ordinary relative paths with
`./`. Filesystem absolute paths are not generated.

`brackets` accepts `preserve` (default), `angle`, or `bare`. Spaces in bare
Markdown destinations are percent-encoded. `extension` accepts `preserve`
(default), `include`, or `omit`; omission is Obsidian specific. Fragments are
resolved according to the dialect, separately from percent-decoded filenames. On
GitHub, Forgejo, and Gitea, a fragment written with the `user-content-` prefix
that the renderers add to every anchor reaches the same anchor as one without,
and is validated the same way. Anchors written as HTML, the `id` of any element
and the `name` of an `<a>`, such as `<a name="install"></a>` before a heading,
are valid fragments on those three dialects; GitHub matches them without regard
to case, Forgejo and Gitea exactly as written. HTML inside comments and code is
not an anchor. Already compliant destinations retain their percent-encoding
spelling, including literal `?` and `%` in resolving Obsidian paths. Newly
generated paths encode literal percent signs and hashes to preserve target
identity.

Path edits require a resolved target and valid fragment. Unaliased ordinary
wikilinks retain their target spelling because changing it may change the
visible label. Reference definitions are validated but their source spelling is
currently preserved.

`links/notation` converts simple explicit-label wikilinks to Markdown links and
plain-text Markdown links to wikilinks. Titles, rich labels, unaliased
wikilinks, and embeds are preserved. A note embed is not interchangeable with a
Markdown image. Do not enable notation conversion and path rewriting for the
same link in one pass: overlapping edits are reported; run those policies in
separate passes.

Network URLs are recognized but never fetched. Website-root paths and
query-bearing destinations in CommonMark, GitHub, Forgejo, and Gitea are outside
local resolution. Missing or ambiguous targets are reported, never guessed.
Obsidian resolution uses explicit `./` or `../` paths as source-relative;
otherwise an exact vault-root match precedes an exact source-relative match,
followed by unique suffix matching. Multiple candidates within the chosen tier
remain ambiguous. Relative rewrites use `./` when needed to avoid a vault-root
collision. Existing directories get a distinct diagnostic in Obsidian; they are
not rewritten to README or index notes. CommonMark, GitHub, Forgejo, and Gitea
directory links are accepted because a hosting site can serve them.
Shortest-name/alias resolution is not a complete clone of Obsidian.

## Suppressions

```markdown
<!-- mdtools-disable style/wrap -->

Keep the wrapping in this region.

<!-- mdtools-enable style/wrap -->

<!-- mdtools-disable-next-line style/emphasis -->
Keep *this* delimiter.
```

Omit rule names to disable all rules. A disabled region suppresses edits
intersecting it; a paragraph spanning a disabled line is therefore preserved as
a whole. An enable directive closes matching disabled regions; `enable` without
names closes all. Directives inside code are ordinary code. `disable-next-line`
targets the immediately following physical line, including a blank line; place
it directly above the content to suppress.

## Selection, output, and exit codes

Commands accept explicit files/directories, or no paths to select the workspace.
The CLI honors `.gitignore` files and configured ignore patterns. Config-ignored
documents remain available for link resolution. Git-ignored content and nested
repositories are not indexed by default. To make their files available only as
link targets, set:

```jsonc
{
  "resolve": { "gitIgnored": true, "nestedRepositories": true },
}
```

These options are independent and default to false. They never select those
files for linting or formatting, including when a path is supplied explicitly.
Markdown targets are read and parsed only for fragment checks; attachments need
only a discovered file entry. Built-in traversal exclusions still apply. `.git`,
`.obsidian`, `node_modules`, `.npm-cache`, `dist`, and `coverage` are excluded
from traversal, as are symlinks. Nested Git repositories are traversed for
targets only when opted in. Explicit symlink inputs are rejected. Shell-expanded
globs work; the CLI does not expand path globs.

`lint --json` and `format --json` print a single object with `version`, `mode`,
`files`, and `written`. Each file carries diagnostics with rule ID, severity,
message, offsets, and one-based line/column locations. Source offsets and
columns use JavaScript UTF-16 units; wrapping widths use display columns.
Formatting diagnostics refer to the resulting source. `written` records whether
the requested write phase was allowed, not how many files changed; inspect each
file's `changed` field.

`format --diff` is the default for file input. `--check`, `--diff`, and
`--write` are mutually exclusive. `format - --stdin-filepath notes/example.md`
reads stdin with configuration and resolution context; it cannot be used with
`--write`.

| Exit | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | Completed; no errors or failed formatting check                                 |
| `1`  | Lint errors, exceeded `--max-warnings`, or changes required by `format --check` |
| `2`  | Configuration, execution, or formatting safety failure                          |

Warnings do not fail a command unless `--max-warnings` is supplied. A successful
formatting command can still report remaining lint problems. Inspect its exit
code and diagnostics. An unsafe-format diagnostic blocks the complete batch's
write phase. An I/O error during writing can leave earlier files written;
replacement is atomic per file, not a workspace-wide transaction.
