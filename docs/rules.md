# Rules

A rule is either a **style** rule or a **problem** rule. A style rule checks how
something is written and proposes an edit, which `format` applies and `lint`
reports. A problem rule reports a defect that has no single correct repair, and
never edits. `format` applies an edit only when the document still means the
same afterwards; see [how it works](design.md#safety-model).

Enable and configure rules under `rules` in the
[configuration](configuration.md#rules-and-severity). `npx mdtools rules` lists
the built-in rules; [plugins](plugins.md) can add more.

| Rule                          | Kind    | `format` fixes | Presets                                  | Dialects                        | Options                                                     |
| ----------------------------- | ------- | -------------- | ---------------------------------------- | ------------------------------- | ----------------------------------------------------------- |
| `forgejo/heading-id`          | Problem | No             | `forgejo`, `gitea` (error)               | Forgejo, Gitea                  | None                                                        |
| `github/alert-marker`         | Style   | Yes            | `github`, `forgejo`, `gitea`             | GitHub, Forgejo, Gitea          | None                                                        |
| `github/task-marker`          | Style   | Yes            | `github`, `forgejo`, `gitea`, `obsidian` | All but CommonMark              | None                                                        |
| `links/notation`              | Style   | Yes            | None                                     | Obsidian                        | `style`, required                                           |
| `links/path`                  | Style   | Yes            | None                                     | All; some options Obsidian only | `style`, `brackets`, `extension`, `leadingDot`              |
| `links/valid`                 | Problem | No             | `recommended` (error)                    | All                             | None                                                        |
| `obsidian/block-reference`    | Problem | No             | `obsidian` (error)                       | Obsidian                        | None                                                        |
| `obsidian/callout-marker`     | Style   | Yes            | `obsidian`                               | Obsidian                        | None                                                        |
| `obsidian/strict-line-breaks` | Problem | No             | `obsidian`                               | Obsidian                        | None                                                        |
| `structure/initial-heading`   | Problem | No             | None                                     | All                             | None                                                        |
| `style/block-spacing`         | Style   | Yes            | None                                     | All                             | None                                                        |
| `style/emphasis`              | Style   | Yes            | `recommended`                            | All                             | `marker`                                                    |
| `style/final-newline`         | Style   | Yes            | `recommended`                            | All                             | None                                                        |
| `style/heading`               | Style   | Yes            | None                                     | All                             | None                                                        |
| `style/inline-code`           | Style   | Yes            | None                                     | All                             | None                                                        |
| `style/strong`                | Style   | Yes            | `recommended`                            | All                             | `marker`                                                    |
| `style/table`                 | Style   | Yes            | `github`, `forgejo`, `gitea`, `obsidian` | All but CommonMark              | None                                                        |
| `style/wrap`                  | Style   | Yes            | `recommended`                            | All                             | `width`, `measure`, `reportUnreflowed`, `reportUnbreakable` |

A preset enables its rules as warnings, unless the table says error. The
`codeberg` preset is the `forgejo` preset under another name. In a dialect that
the Dialects column does not name, the rule finds nothing.

## `forgejo/heading-id`

Reports a heading attribute block whose `id` is not text, such as `{id=5}`,
`{id=true}`, or a list. Forgejo, and Gitea before 1.26, render nothing at all
for a document that contains one; Gitea 1.26 and later render the heading
without an anchor. Quote the value (`{id="5"}`) or write `{#5}`.
[Dialects](dialects.md#forgejo-and-gitea) describes attribute blocks.

Reported:

```markdown
## Install {id=5}
```

Not reported:

```markdown
## Install {id="5"}
```

## `github/alert-marker`

Writes the type of a GitHub alert in capitals. The renderers accept any case for
the five types `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`, and their
documentation spells them in capitals. Other types are not alerts there and are
left as written.

Before:

```markdown
> [!note]
> Read this first.
```

After:

```markdown
> [!NOTE]
> Read this first.
```

## `github/task-marker`

Writes the mark of a completed task as a lowercase `x`.

Before:

```markdown
- [X] Write the guide
```

After:

```markdown
- [x] Write the guide
```

## `links/notation`

Converts Obsidian links between Markdown and wikilink notation. The `style`
option is required; without it the rule does nothing.

- `"markdown"` turns a wikilink with its own label, `[[target|label]]`, into
  `[label](<target>)`.
- `"wiki"` turns a Markdown link whose label is plain text into
  `[[target|label]]`.

Only links whose target exists are converted. Titles, labels with formatting,
wikilinks without a label, and embeds are left as written: a wikilink without a
label shows its target as text, and a note embed is not the same thing as a
Markdown image.

With `"style": "markdown"`, before:

```markdown
See [[Garden/Plan|the plan]].
```

After:

```markdown
See [the plan](<Garden/Plan>).
```

With `links/path` also on, a link that both change gets its notation first and
its path in the next pass, the same result as running them one after the other.

## `links/path`

Rewrites the destination of a local link to the configured spelling. A link is
rewritten only when its target exists and its fragment, if any, is found, and
only when the new destination leads to the same file and fragment.

| Option       | Values                                             | Default      |
| ------------ | -------------------------------------------------- | ------------ |
| `style`      | `"preserve"`, `"relative"`, `"root"`, `"shortest"` | `"preserve"` |
| `brackets`   | `"preserve"`, `"angle"`, `"bare"`                  | `"preserve"` |
| `extension`  | `"preserve"`, `"include"`, `"omit"`                | `"preserve"` |
| `leadingDot` | `true` or `false`                                  | `false`      |

- `style`: `relative` counts the path from the linking document. `root` writes
  it vault-relative, that is from the vault's root directory, without a leading
  slash. `shortest` writes only the note's name when that name finds the same
  note, and otherwise the vault-relative path. `root` and `shortest` apply in
  the Obsidian dialect only.
- `brackets`: `angle` writes the destination in `<…>`; `bare` writes it without,
  with spaces percent-encoded.
- `extension`: whether the path to a Markdown file ends in `.md`. `omit` applies
  in the Obsidian dialect only.
- `leadingDot`: with `relative`, start a path with `./` when it does not start
  with `.`.

A relative path also gets `./` when it would otherwise name a different file at
the vault's root. A destination that already has the configured spelling keeps
its percent-encoding; a new path encodes `%` and `#`, so that it names the same
file. Absolute filesystem paths are never written. These are left as written: a
wikilink without a label, whose target is also its visible text; reference
definitions, which are checked but not rewritten; autolinks; and links whose
target is uncertain because a directory could not be read or the workspace root
is only part of a vault (see
[Obsidian vaults](obsidian.md#a-workspace-root-inside-a-vault)).

With `{ "style": "relative", "leadingDot": true }` in `README.md`, before:

```markdown
See the [guide](docs/guide.md#setup).
```

After:

```markdown
See the [guide](./docs/guide.md#setup).
```

## `links/valid`

Reports a local link, image, wikilink, embed, or reference definition whose
target does not exist, and a fragment (`#heading`, `#^block`) that its target
does not have. The anchors that a fragment can reach depend on the dialect; see
[heading anchors](dialects.md#heading-anchors). A target that is missing or
ambiguous is reported, never guessed.

| Message                                | Meaning                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Missing local target: …`              | No file matches.                                                                                       |
| `Ambiguous local target: …`            | Several files match, such as two notes whose names differ only by case.                                |
| `Missing fragment in …`                | The target exists but has no such heading, block, or anchor.                                           |
| `Local target is a directory: …`       | Obsidian only. Other dialects accept a link to a directory, which a hosting site can serve.            |
| `Local target is outside the vault: …` | Obsidian only: the path leaves the note's vault, where Obsidian cannot follow it.                      |
| `Local target could not be checked: …` | A directory that may hold the target could not be read, or the workspace root is only part of a vault. |
| `Fragment could not be checked: …`     | The target exists but could not be read.                                                               |

URLs with a scheme, such as `https:`, are never fetched or checked. Outside the
Obsidian dialect, a destination that starts with `/` or contains `?` depends on
the website, and is not checked either.

In the Obsidian dialect, links resolve as in Obsidian: a path that starts with
`./` or `../` counts from the note; otherwise an exact path from the vault's
root comes first, then an exact path from the note, then a note found by its
name or by the end of its path. Several matches at the first level that finds
any are ambiguous. Note names and headings match without regard to case; block
identifiers match exactly.

Reported when `docs/guide.md` does not exist, or has no heading named "Setup":

```markdown
See the [guide](docs/guide.md#setup).
```

## `obsidian/block-reference`

Reports a block identifier (`^id` at the end of a paragraph) that a note uses
more than once. A link to `#^id` can reach only one of them.

Reported, on the second paragraph:

```markdown
First idea. ^idea

Second idea. ^idea
```

## `obsidian/callout-marker`

Writes the type of an Obsidian callout in lowercase, custom types included. The
title and the body are left as written.

Before:

```markdown
> [!TIP] Reading the notes
```

After:

```markdown
> [!tip] Reading the notes
```

## `obsidian/strict-line-breaks`

Reports, once per note, that `style/wrap` leaves the note as written because the
vault's "Strict line breaks" setting is not known to be on. Without that
setting, Obsidian's Reading view shows every line break in a paragraph, so
joining or breaking lines would change what the note looks like. The setting is
`"strictLineBreaks": true` in the vault's `.obsidian/app.json`; the tool reads
it and never changes it. The finding is at line 1, and its message begins
`Obsidian strictLineBreaks is not verified true`. See
[Obsidian vaults](obsidian.md#enable-wrapping).

## `structure/initial-heading`

Requires the first block of a document, after optional YAML or TOML front
matter, to be a level-1 heading. Underlined (`===`) headings count as well as
`#` headings; enable `style/heading` to require `#`. An empty document is
reported. Comments and other content before the title are not skipped. Use
[overrides](configuration.md#overrides) to exempt generated documents.

Reported:

```markdown
Some text before the title.

# Title
```

Not reported:

```markdown
---
title: Notes
---

# Notes
```

## `style/block-spacing`

Separates every heading and every list from the blocks before and after it with
a blank line, in the document and in block quotes at any depth. It adds one
blank line where there is none and keeps the blank lines that are already there.
Inside a block quote, the new line holds the quote's `>` markers.

Before:

```markdown
# Setup
Install the package.
- Run the command.
```

After:

```markdown
# Setup

Install the package.

- Run the command.
```

Nothing is added at the start or the end of a document, and these places are
left as written, because a blank line there would change what the document means
or what a comment applies to:

- Blocks inside a list item or a footnote definition. A blank line between the
  blocks of a list item makes the list loose, which changes how it renders.
- Front matter and the block below it.
- A heading or list directly below an HTML comment or below a
  `mdtools-disable-next-line` directive, which apply to the line below them.
- The line that opens a callout or alert, such as `> [!NOTE]`, and the block
  directly below it.
- In the Obsidian dialect, a block identifier on a line of its own (`^id`)
  directly below a heading or list, which Obsidian may attach to the block
  above.
- Directly below text or a link reference definition: a list or quote whose
  first line continues with another list marker, as in `- 2. Step` or `- -`, and
  a heading underlined with `===` or `---`. The parser can read such a line
  differently there than below a blank line.

## `style/emphasis`

Writes emphasis with one marker. The option `marker` is `"_"` (the default) or
`"*"`. With `_`, emphasis inside a word keeps `*`, because `_` cannot mark
emphasis there. A marker that would touch another `*` or `_` and change how the
text parses is left as written, and so are the exceptions of
[Forgejo and Gitea](dialects.md#forgejo-and-gitea).

Before:

```markdown
Use *emphasis* sparingly, as in un*believ*able.
```

After:

```markdown
Use _emphasis_ sparingly, as in un*believ*able.
```

## `style/final-newline`

Ends a document that is not empty with a line break, using the document's own
line ending. A file whose last line has no line break is changed; an empty file
is not.

## `style/heading`

Turns a heading underlined with `===` or `---` into a `#` heading of the same
level. A trailing run of `#` in the text is escaped, so that it is not taken for
a closing sequence. Headings of more than one line, and headings inside lists or
block quotes, are left as written.

Before:

```markdown
Installation
------------
```

After:

```markdown
## Installation
```

## `style/inline-code`

Joins a code span that is written across lines onto one line. A line break
inside a code span renders as a space, so the content stays the same. Some
editors, such as Obsidian's Live Preview, show a split code span differently
from the rendered page, and `style/wrap` leaves a paragraph with a split code
span as written. The exceptions of
[Forgejo and Gitea](dialects.md#forgejo-and-gitea) apply.

Before:

```markdown
Run `npm run
build` before the tests.
```

After:

```markdown
Run `npm run build` before the tests.
```

## `style/strong`

Writes strong emphasis with one marker. The option `marker` is `"*"` (the
default) or `"_"`. The exceptions of `style/emphasis` apply.

Before:

```markdown
A __bold__ claim.
```

After:

```markdown
A **bold** claim.
```

## `style/table`

Aligns a table: every cell of a column is padded to the column's width, measured
in display columns, and the delimiter row keeps each column's alignment. The
text of each cell is left as written, and so is the number of cells in each row.
A table inside a list or block quote, and one with a row that has more cells
than its header, are left as written.

Before:

```markdown
| Sensor | Unit |
|:--|--:|
| Temperature | °C |
```

After:

```markdown
| Sensor      | Unit |
| :---------- | ---: |
| Temperature | °C   |
```

## `style/wrap`

Reflows each paragraph so that its lines fill the width without exceeding it. A
line break inside a paragraph renders as a space, so the rendered text stays the
same, and short lines keep diffs small. Lines are broken only at spaces in the
text: a link, a code span, math, or a word longer than the line stays whole and
can overflow. List markers, block quote markers, and indentation count toward
the width.

| Option              | Values                        | Default     |
| ------------------- | ----------------------------- | ----------- |
| `width`             | An integer from 20 to 500     | `80`        |
| `measure`           | `"columns"` or `"codepoints"` | `"columns"` |
| `reportUnreflowed`  | `true` or `false`             | `false`     |
| `reportUnbreakable` | `true` or `false`             | `false`     |

- `measure`: `columns` counts display columns, so a wide character such as `漢`
  counts two. `codepoints` counts Unicode code points: a character outside the
  Basic Multilingual Plane counts once, and a combining mark counts by itself.
- `reportUnreflowed`: report a paragraph that is too wide but left as written,
  with the reason.
- `reportUnbreakable`: report a line that stays too wide because of something
  that cannot be split, also in paragraphs left as written. An Obsidian
  callout's title line counts as one such piece, even when it contains spaces.

The two report options propose no edits and use the rule's severity. To make
them fail a check, set the rule to `error` or pass `--max-warnings 0`;
`format --check` checks only for edits.

A paragraph is left as written when joining or breaking its lines could change
what it means, that is, when it:

- has a hard line break, inline HTML, or a block identifier (`^id`) at its end;
- has inline syntax, such as a link or a code span, that spans lines, or lines
  whose container markers the tool cannot reproduce;
- starts with an alert or callout marker such as `[!NOTE]`; in an Obsidian
  callout, only the title line stays as it is, and the body is wrapped;
- starts with a bare `-`, `+`, `*`, `1.`, `1)`, `#`, or `>` followed by more
  words, which joining would turn into a block;
- starts directly below a link reference definition without that definition's
  container markers;
- holds, in the Obsidian dialect, `==`, `[[`, or `]]` outside its highlights and
  wikilinks, because joining lines could create one.

In the Obsidian dialect, the rule wraps only with the vault's
[strict line breaks](obsidian.md#enable-wrapping).
[Forgejo and Gitea](dialects.md#forgejo-and-gitea) add their own cases.

With `{ "width": 40 }`, before:

```markdown
Wrapping keeps lines short, so that a change to one sentence shows up as a small diff.
```

After:

```markdown
Wrapping keeps lines short, so that a
change to one sentence shows up as a
small diff.
```
