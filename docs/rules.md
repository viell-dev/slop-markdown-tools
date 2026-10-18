# Rules

A rule is either a **style** rule or a **problem** rule. A style rule checks how
something is written and proposes an edit, which `format` applies and `lint`
reports. A problem rule reports a defect that has no single correct repair, and
never edits. `format` applies an edit only when the document still means the
same afterwards; see [how it works](design.md#safety-model).

Enable and configure rules under `rules` in the
[configuration](configuration.md#rules-and-severity). `npx mdtools rules` lists
the built-in rules and those of the configuration's [plugins](plugins.md).

🎨 marks a style rule, whose findings `format` fixes, and 🔍 a problem rule,
which is reported only. ✅ is yes and ❌ no. Each rule's section names its
presets, dialects, and options.

| Rule                          | Kind | `recommended` | Dialect preset | Options |
| ----------------------------- | :--: | :-----------: | :------------: | :-----: |
| `content/code-language`       | 🔍   | ❌            | ❌             | ❌      |
| `content/image-alt`           | 🔍   | ✅            | ❌             | ❌      |
| `content/table-columns`       | 🔍   | ✅            | ❌             | ❌      |
| `forgejo/heading-id`          | 🔍   | ❌            | ✅ (error)     | ❌      |
| `github/alert-marker`         | 🎨   | ❌            | ✅             | ❌      |
| `github/task-marker`          | 🎨   | ❌            | ✅             | ❌      |
| `links/empty`                 | 🔍   | ✅            | ❌             | ❌      |
| `links/notation`              | 🎨   | ❌            | ❌             | ✅      |
| `links/path`                  | 🎨   | ❌            | ❌             | ✅      |
| `links/undefined-reference`   | 🔍   | ✅            | ❌             | ❌      |
| `links/unused-definition`     | 🔍   | ✅            | ❌             | ❌      |
| `links/valid`                 | 🔍   | ✅ (error)    | ❌             | ❌      |
| `obsidian/block-reference`    | 🔍   | ❌            | ✅ (error)     | ❌      |
| `obsidian/callout-marker`     | 🎨   | ❌            | ✅             | ❌      |
| `obsidian/strict-line-breaks` | 🔍   | ❌            | ✅             | ❌      |
| `structure/duplicate-heading` | 🔍   | ❌            | ❌             | ❌      |
| `structure/heading-increment` | 🔍   | ✅            | ❌             | ❌      |
| `structure/initial-heading`   | 🔍   | ❌            | ❌             | ❌      |
| `structure/single-title`      | 🔍   | ❌            | ❌             | ❌      |
| `style/blank-lines`           | 🎨   | ✅            | ❌             | ✅      |
| `style/block-spacing`         | 🎨   | ❌            | ❌             | ❌      |
| `style/code-fence`            | 🎨   | ✅            | ❌             | ✅      |
| `style/emphasis`              | 🎨   | ✅            | ❌             | ✅      |
| `style/final-newline`         | 🎨   | ✅            | ❌             | ❌      |
| `style/heading`               | 🎨   | ✅            | ❌             | ✅      |
| `style/inline-code`           | 🎨   | ❌            | ❌             | ❌      |
| `style/list-indent`           | 🎨   | ✅            | ❌             | ✅      |
| `style/list-marker`           | 🎨   | ✅            | ❌             | ✅      |
| `style/ordered-list`          | 🎨   | ✅            | ❌             | ✅      |
| `style/strong`                | 🎨   | ✅            | ❌             | ✅      |
| `style/table`                 | 🎨   | ✅            | ✅             | ✅      |
| `style/thematic-break`        | 🎨   | ✅            | ❌             | ✅      |
| `style/trailing-space`        | 🎨   | ✅            | ❌             | ✅      |
| `style/wrap`                  | 🎨   | ✅            | ❌             | ✅      |

A preset enables its rules as warnings, unless the rule's section says error.
The `codeberg` preset is the `forgejo` preset under another name. In a dialect
that a rule's section does not name, the rule finds nothing.

## `content/code-language`

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reports a fenced code block that does not name its language after the opening
fence. GitHub, Forgejo, Gitea, and Obsidian highlight code by the language its
fence names; name `text` for plain text. Indented code blocks have no place for
a language and are not reported.

Reported:

````markdown
```
npm test
```
````

Not reported:

````markdown
```sh
npm test
```
````

## `content/image-alt`

**Problem rule**, reported only. Presets: `recommended`. Dialects: all. Options:
none.

Reports an image without alternative text, the text between the brackets of
`![text](chart.png)`. Screen readers read it in place of the image, and browsers
show it when the image does not load. Text that is only blank space counts as
none. In the Obsidian dialect, a size after `|`, as in `![|100](chart.png)`, is
not text, and embeds such as `![[chart.png]]` are not reported, because they
have no place for text. HTML `<img>` elements are not checked.

Reported:

```markdown
![](sales-by-month.png)
```

Not reported:

```markdown
![Sales by month, rising from March](sales-by-month.png)
```

## `content/table-columns`

**Problem rule**, reported only. Presets: `recommended`. Dialects: all but
CommonMark. Options: none.

Reports a table row with more or fewer cells than the header row. As the GFM
specification requires, renderers drop the extra cells of a longer row without a
trace and fill a shorter row with empty cells, so the table does not show what
its source says. A `|` separates cells inside code and wikilinks too, unless it
is escaped as `\|`.

Reported, because the last row has three cells:

```markdown
| Name | Size |
| ---- | ---- |
| a    | 1    |
| b    | 2    | 3 |
```

Not reported:

```markdown
| Name    | Size |
| ------- | ---- |
| a       | 1    |
| `b\|c`  | 2    |
```

## `forgejo/heading-id`

**Problem rule**, reported only. Presets: `forgejo`, `gitea` (error). Dialects:
Forgejo, Gitea. Options: none.

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

**Style rule**, fixed by `format`. Presets: `github`, `forgejo`, `gitea`.
Dialects: GitHub, Forgejo, Gitea. Options: none.

Writes the type of a GitHub alert in capitals. The renderers accept any case for
the five types `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`, and their
documentation spells them in capitals. Other types are not alerts there and are
left as written, and so is a marker written with an escape or a character
reference, such as `\[!note]`. So is a marker that GitHub shows as text: one in
a block quote inside another quote or a list, one followed by text on its line,
and one with nothing below it in the quote.

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

**Style rule**, fixed by `format`. Presets: `github`, `forgejo`, `gitea`,
`obsidian`. Dialects: all but CommonMark. Options: none.

Writes the mark of a completed task as a lowercase `x`.

Before:

```markdown
- [X] Write the guide
```

After:

```markdown
- [x] Write the guide
```

## `links/empty`

**Problem rule**, reported only. Presets: `recommended`. Dialects: all. Options:
none.

Reports a link or image whose destination is empty, as in `[guide]()`, or only
`#`, which leads to the top of the page. Both are usually placeholders that were
never filled in. A reference definition with such a destination is reported
once, at the definition, rather than at each reference to it. Obsidian wikilinks
are not checked.

Reported:

```markdown
See the [setup guide](#) and the [changelog]().
```

Not reported:

```markdown
See the [setup guide](#setup).
```

## `links/notation`

**Style rule**, fixed by `format`. Presets: none. Dialects: Obsidian. Options:
`style`, required.

Converts Obsidian links between Markdown and wikilink notation. The `style`
option is required; without it the rule does nothing.

- `"markdown"` turns a wikilink with its own label, `[[target|label]]`, into
  `[label](<target>)`.
- `"wiki"` turns a Markdown link whose label is plain text into
  `[[target|label]]`.

Only links whose target exists are converted. Titles, labels with formatting,
wikilinks without a label, and embeds are left as written: a wikilink without a
label shows its target as text, and a note embed is not the same thing as a
Markdown image. A new wikilink decodes percent escapes, because Obsidian takes
its text as the note's name: `[x](My%20Note.md)` becomes `[[My Note.md|x]]`. A
destination that does not decode, or whose name would hold `|`, `[`, `]`, `#`,
or `^`, stays as written.

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

**Style rule**, fixed by `format`. Presets: none. Dialects: all; some options
Obsidian only. Options: `style`, `brackets`, `extension`, `leadingDot`.

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
is only part of a vault (see [Obsidian
vaults](obsidian.md#a-workspace-root-inside-a-vault)).

With `{ "style": "relative", "leadingDot": true }` in `README.md`, before:

```markdown
See the [guide](docs/guide.md#setup).
```

After:

```markdown
See the [guide](./docs/guide.md#setup).
```

## `links/undefined-reference`

**Problem rule**, reported only. Presets: `recommended`. Dialects: all;
footnotes all but CommonMark. Options: none.

Reports a reference whose label has no definition in the document: a full
reference `[text][label]`, a collapsed reference `[label][]`, and, in every
dialect but CommonMark, a footnote reference `[^label]`. The renderer shows such
a reference as plain text, brackets and all. Labels match as the renderer
matches them, without regard to case or to how much blank space separates words.

A shortcut reference, `[label]` alone, is not reported, because brackets in
prose are usually just brackets. Neither are brackets directly after a letter,
digit, `_`, or `)`, as in `matrix[i][j]`, which are indexes rather than
references, nor brackets in code, math, HTML, or links, nor escaped ones (`\[`).
A run of brackets such as `[a][b][c]` is reported once, at its start.

Reported, when neither a definition `[setup]: …` nor a footnote `[^1]: …`
exists:

```markdown
See the [installation guide][setup] and [setup][].[^1]
```

Not reported:

```markdown
See the [installation guide][Setup] and press [Enter].

[setup]: install.md
```

## `links/unused-definition`

**Problem rule**, reported only. Presets: `recommended`. Dialects: all. Options:
none.

Reports a reference definition or footnote that no reference in the document
uses. A definition that only a shortcut reference `[label]` uses counts as used.
A second definition of the same label is reported too, because the renderers use
the first. GitHub leaves footnotes that nothing references off the page.

Reported, at `[old-setup]`:

```markdown
See the [guide][setup].

[setup]: install.md
[old-setup]: old/install.md
```

Not reported:

```markdown
See the [guide][setup] and the [changelog].

[setup]: install.md
[changelog]: CHANGELOG.md
```

## `links/valid`

**Problem rule**, reported only. Presets: `recommended` (error). Dialects: all.
Options: none.

Reports a local link, image, wikilink, embed, or reference definition whose
target does not exist, and a fragment (`#heading`, `#^block`) that its target
does not have. The anchors that a fragment can reach depend on the dialect; see
[heading anchors](dialects.md#heading-anchors). Only a Markdown file's fragments
are checked: an image, a PDF, or a source file accepts any, such as
`#gh-dark-mode-only`, `#page=2`, or `#L10-L20`. A target that is missing or
ambiguous is reported, never guessed. A link into a directory that the CLI does
not visit, such as `dist`, or through a symbolic link is checked on disk; see
[ignored files](configuration.md#ignored-files-and-link-targets).

| Message                                | Meaning                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Missing local target: …`              | No file matches.                                                                                             |
| `Ambiguous local target: …`            | Several files match, such as two notes whose names differ only by case.                                      |
| `Missing fragment in …`                | The target exists but has no such heading, block, or anchor.                                                 |
| `Local target is a directory: …`       | Obsidian Markdown links only; other dialects accept a link to a directory, which a site can serve.           |
| `Local target is outside the vault: …` | Obsidian only: the path leaves the note's vault, where Obsidian cannot follow it.                            |
| `Local target could not be checked: …` | A directory that may hold it could not be read, the root is only part of a vault, or a link leaves the root. |
| `Fragment could not be checked: …`     | The target exists but could not be read.                                                                     |

URLs with a scheme, such as `https:`, are never fetched or checked. Outside the
Obsidian dialect, a destination that starts with `/` or contains `?` depends on
the website, and is not checked either.

In the Obsidian dialect, links resolve as in Obsidian: a path that starts with
`./` or `../` counts from the note; otherwise an exact path from the vault's
root comes first, then an exact path from the note, then a note found by its
name or by the end of its path. Several matches at the first level that finds
any are ambiguous. A wikilink never resolves to a directory, so the search goes
on to a note of that name. Note names and headings match without regard to case;
block identifiers match exactly. A heading matches by the text it shows or as
its source writes it, such as ``#`move` `` for ``### `move` ``, and
`#Setup#Mobile` names a heading below another one.

Reported when `docs/guide.md` does not exist, or has no heading named "Setup":

```markdown
See the [guide](docs/guide.md#setup).
```

## `obsidian/block-reference`

**Problem rule**, reported only. Presets: `obsidian` (error). Dialects:
Obsidian. Options: none.

Reports a block identifier that a note uses more than once: `^` and Latin
letters, digits, and hyphens at the end of a paragraph or heading, or alone on
the line after a list or quote, as Obsidian defines it. A link to `#^id` can
reach only one of them.

Reported, on the second paragraph:

```markdown
First idea. ^idea

Second idea. ^idea
```

## `obsidian/callout-marker`

**Style rule**, fixed by `format`. Presets: `obsidian`. Dialects: Obsidian.
Options: none.

Writes the type of an Obsidian callout in lowercase, custom types included. The
title and the body are left as written, and so is a marker written with an
escape or a character reference, such as `\[!TIP]`.

Before:

```markdown
> [!TIP] Reading the notes
```

After:

```markdown
> [!tip] Reading the notes
```

## `obsidian/strict-line-breaks`

**Problem rule**, reported only. Presets: `obsidian`. Dialects: Obsidian.
Options: none.

Reports, once per note, that `style/wrap` leaves the note as written because the
vault's "Strict line breaks" setting is not known to be on. Without that
setting, Obsidian's Reading view shows every line break in a paragraph, so
joining or breaking lines would change what the note looks like. The setting is
`"strictLineBreaks": true` in the vault's `.obsidian/app.json`; the tool reads
it and never changes it. The finding is at line 1, and its message begins
`Obsidian's "Strict line breaks" setting is not known to be on`. See [Obsidian
vaults](obsidian.md#enable-wrapping).

## `structure/duplicate-heading`

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reports a heading with the same text as an earlier heading under the same parent
heading. Two "Setup" sections side by side make a table of contents ambiguous,
and a link to `#setup` reaches only the first. The same heading under different
parents, as in a guide with a section per platform, is not reported. Headings
are compared by their text as the reader sees it: formatting does not count,
case does. As for `structure/heading-increment`, the headings of a block quote
or a footnote are checked among themselves.

Reported:

```markdown
# Install

## Setup

## Setup
```

Not reported:

```markdown
# Linux

## Setup

# Windows

## Setup
```

## `structure/heading-increment`

**Problem rule**, reported only. Presets: `recommended`. Dialects: all. Options:
none.

Reports a heading more than one level deeper than the heading before it, such as
a level-3 heading directly after a level-1 heading. Readers who move through a
document by its headings, with a screen reader or a table of contents, rely on
the levels to show how sections nest. The first heading may have any level.

The headings of a block quote, which is also how callouts and alerts are
written, and of a footnote are checked among themselves: a callout can start
with a level-3 heading under any heading, and its headings do not count for the
document's.

Reported:

```markdown
# Install

### Requirements
```

Not reported:

```markdown
# Install

## Requirements

> [!NOTE]
>
> ### Older versions
```

## `structure/initial-heading`

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Requires the first block of a document, after optional YAML or TOML front
matter, to be a level-1 heading. Underlined (`===`) headings count as well as
`#` headings; [`style/heading`](#styleheading) turns them into `#` headings. An
empty document is reported. Comments and other content before the title are not
skipped. Use [overrides](configuration.md#overrides) to exempt generated
documents.

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

## `structure/single-title`

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reports a second level-1 heading in a document. A document has one title, and
further level-1 headings usually belong one level down. A `title` key in YAML or
TOML front matter counts as the title; every level-1 heading is then reported.
As for `structure/heading-increment`, the headings of a block quote or a
footnote are checked among themselves.

Reported:

```markdown
# Install

# Configure
```

Not reported:

```markdown
---
title: Install
---

## Requirements
```

## `style/blank-lines`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `maximum`.

Collapses blank lines in a row to at most `maximum` of them, and removes blank
lines at the start and at the end of a document. The option `maximum` is an
integer of at least 1; the default is 1. The line break that ends the last line
stays; [`style/final-newline`](#stylefinal-newline) adds it where it is missing.
Inside a block quote, a line of only `>` markers is a blank line, and repeated
ones are removed the same way.

Before, with three blank lines between the blocks and two at the end:

```markdown
# Setup



Install the package.


```

After:

```markdown
# Setup

Install the package.
```

These blank lines are left as written, because they are content there or their
number changes what the document means:

- Inside code blocks, HTML blocks, math blocks, front matter, and Obsidian
  comments, also in one that runs to the end of the document without its closing
  fence or marker.
- At the start of a document, when the line below them is `---` or `+++`, which
  would then open front matter.
- Next to a blank line with other block quote markers or indentation, such as
  `>` next to an empty line, which belong to different block quotes.
- In a block quote, below the last block of a list, list item, or footnote that
  the parser counts them toward: there it reads a list as loose when two or more
  follow and as tight when one does.

## `style/block-spacing`

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options: none.

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
- A list that ends inside an HTML comment or another HTML block without its end
  marker, which would take the blank line in.
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
- Directly below a table that ends in a list item or block quote: text whose
  second line is a table delimiter row. The parser reads a table there as text,
  where GitHub reads a table, and a blank line would make it a table for the
  parser too.
- In a block quote, below a list whose last item ends in an empty footnote
  definition, such as `> - [^1]:`. The parser would count the new line of `>` as
  part of the item and read the list as loose.

## `style/code-fence`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `marker`.

Writes the fences of a fenced code block with one marker, and as long as its
content allows: three characters, or one more than the longest line inside that
holds only the marker, which would otherwise close the block. The option
`marker` is ``"```"`` (the default), `"~~~"`, or `"consistent"`, which takes the
marker of the document's first fence. The info string and the content are left
as written.

Before:

```markdown
~~~sh
npm test
~~~
```

After:

````markdown
```sh
npm test
```
````

Indented code blocks have no fence and are left as written. So is a `~~~` fence
whose info string contains a backtick, because a backtick fence cannot have one.

## `style/emphasis`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `marker`.

Writes emphasis with one marker. The option `marker` is `"_"` (the default) or
`"*"`. With `_`, emphasis inside a word keeps `*`, because `_` cannot mark
emphasis there.

Before:

```markdown
Use *emphasis* sparingly, as in un*believ*able.
```

After:

```markdown
Use _emphasis_ sparingly, as in un*believ*able.
```

Markers are left as written where new ones could change how the text parses, and
so are the exceptions of [Forgejo and Gitea](dialects.md#forgejo-and-gitea):

- A new marker that would touch another `*` or `_`, or be separated from one
  only by `~`.
- Text with a `*` or `_` that did not pair, as in `*a _b* c_`, or with a run of
  markers that two emphases share, as in `*****a***`. There markers change only
  where the rule can tell that every pair stays the same.
- The text of a collapsed or shortcut reference, such as `[*Title*][]` or
  `[*Title*]`, which is also its label, and text in brackets that would match a
  definition's label with the new markers.
- A marker right after a `$` on GitHub, Forgejo, and Gitea, where a `_` after
  the dollar decides whether dollar math ends there.
- Emphasis that begins on the line of an alert's or a callout's marker and ends
  below it.
- Emphasis whose text holds a run of tildes that could mark strikethrough, one
  or two tildes or in Obsidian two, while the paragraph holds another: GitHub
  can read strikethrough there and the markers as text.
- A `_`, old or new, that only tildes separate from a letter or digit, as in
  `x~~_b_~~`, which GitHub reads as inside a word.
- Text whose markers CommonMark pairs otherwise than the parser, as in
  `xab***a* a*y`: GitHub follows CommonMark, so the parser misread the text.

## `style/final-newline`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: none.

Ends a document that is not empty with a line break, using the document's own
line ending. A file whose last line has no line break is changed; an empty file
is not. Nothing is added where the line break would become part of the last
block: an HTML comment or another HTML block without its end marker, an Obsidian
comment without its closing `%%`, or a code or math block without its closing
fence whose last line is blank space.

## `style/heading`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `style`, `closing`.

Writes headings in one style and without closing `#` sequences. By default it
turns a heading underlined with `===` or `---` into a `#` heading of the same
level, and removes the closing sequence of a `#` heading with the blank space
around it.

| Option    | Values                              | Default    |
| --------- | ----------------------------------- | ---------- |
| `style`   | `"atx"`, `"setext"`, `"consistent"` | `"atx"`    |
| `closing` | `"remove"`, `"keep"`                | `"remove"` |

- `style`: `atx` writes `#` headings. `setext` underlines headings of levels 1
  and 2 and keeps `#` for deeper levels, which cannot be underlined.
  `consistent` follows the document's first heading: `setext` when it is
  underlined, otherwise `atx`.
- `closing`: `keep` leaves the closing sequences of `#` headings as written.

Before:

```markdown
Installation
------------

## Usage ##
```

After:

```markdown
## Installation

## Usage
```

A trailing run of `#` in the text of an underlined heading is escaped, so that
it is not taken for a closing sequence. Underlined headings of more than one
line, those inside lists or block quotes, and one directly below TOML front
matter, whose lines renderers without TOML front matter read as part of the
heading, are left as written. On Forgejo and Gitea, a closing sequence after an
attribute block such as `{#id}` stays, because Gitea before 1.26 reads the block
only when the sequence follows it.

With `setext`, a `#` heading is underlined only where its text can stand on a
line of its own as the same heading: at the start of a line of the document, not
in a list or block quote, below a blank line or at the start of the document,
because directly below text its line would continue the paragraph. It keeps its
`#` when its text starts like another block, such as a list item, block quote,
thematic break, fence, HTML, or link reference definition, when it contains `|`,
which `---` below it could make a table, or when it ends with a backslash, and
on Forgejo and Gitea when it contains `{`. Below a first line of `---` that no
line closes, a level-2 underline has at least four `-`, because `---` would
close it as front matter.

## `style/inline-code`

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options: none.

Joins a code span that is written across lines onto one line. A line break
inside a code span renders as a space, so the content stays the same, and the
spaces and tabs that start the next line are left out, as CommonMark and GitHub
leave them out. On a lazy continuation line, one without its block quote's `>`
or its list item's indentation, GitHub keeps them in the span, and so does the
joined span; commonmark.js leaves them out, so outside the GitHub dialect such a
span stays split. Some editors, such as Obsidian's Live Preview, show a split
code span differently from the rendered page. `style/wrap` joins such a code
span only in a paragraph that it wraps, and this rule also elsewhere, such as in
a paragraph with a hard line break. The exceptions of [Forgejo and
Gitea](dialects.md#forgejo-and-gitea) apply, and a span stays split where the
joined line would read differently:

- In Obsidian, where an `==` or `[[` left as text on the joined lines could open
  a highlight or wikilink.
- Where joining would move text onto the line of an alert's or a callout's
  marker, which holds an Obsidian callout's title.
- Where the joined span needs a different number of backticks than it has, and
  an earlier run of that many in the same paragraph would pair with them.
- Where a line inside the span ends with a backslash: where its backticks do not
  pair, as on GitHub after an unpaired longer run, that backslash is a hard line
  break. `style/wrap` keeps such a paragraph as written too.

Before:

```markdown
Run `npm run
build` before the tests.
```

After:

```markdown
Run `npm run build` before the tests.
```

## `style/list-indent`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: spaces after markers, `nestedIndent`.

Puts the configured spaces, one by default, between a list marker and the item's
text, and starts each item where its container's text starts: at the start of
the line, after a block quote's `>`, or under the text of the list item that
holds it. The item's other lines move by as many columns as its text, so its
paragraphs, code blocks, and nested lists stay inside it as they were.

| Option                   | Values                 | Default               |
| ------------------------ | ---------------------- | --------------------- |
| `bulletSpaces`           | An integer from 1 to 4 | `1`                   |
| `orderedSpaces`          | An integer from 1 to 4 | `1`                   |
| `bulletSpacesMultiline`  | An integer from 1 to 4 | `bulletSpaces`        |
| `orderedSpacesMultiline` | An integer from 1 to 4 | `orderedSpaces`       |
| `nestedIndent`           | An integer from 1 to 8 | Under the item's text |

- `bulletSpaces` and `orderedSpaces`: the spaces after the marker of a bullet
  item and of a numbered one. As in markdownlint's MD030, the `Multiline`
  options take their place in a list where an item has more than one line or
  blank lines separate the items.
- `nestedIndent`: the columns from an item's marker to the marker of a list
  nested in it, like markdownlint's MD007 `indent`. A nested marker can stand
  from its item's text to three columns further, and the rule keeps it there:
  `4` puts it two columns in under `- item` and one under `1. item`. A nested
  list that starts on its item's line, as in `- - item`, stays there, and one
  that follows another list stays out of that list's last item.

With the defaults, before:

```markdown
-   Unpack the board.

    Keep the box for returns.
1.  Connect the sensor.
     - Use the short cable.
```

After:

```markdown
- Unpack the board.

  Keep the box for returns.
1. Connect the sensor.
   - Use the short cable.
```

These are left as written:

- An item that starts with indented code, five or more spaces after the marker;
  the code depends on that spacing.
- A list where moving an item would move another line into it. Here `Text`
  follows the list, and below `- Item` it would be the item's second paragraph:

  ```markdown
  -   Item

    Text
  ```

  The same goes for a line that continues the item's paragraph without the
  item's indentation, where that line would start a list, a code span, or
  another block once inside the item.
- A list with a tab in an item's indentation, such as one that Obsidian indented
  with tabs.
- A list directly below TOML front matter that cannot interrupt a paragraph: a
  numbered list that does not start at 1, or one whose first item starts with a
  blank line, and the lists that directly follow it. Renderers without TOML
  front matter read the front matter's lines as a paragraph, which such a list
  continues as text. `style/list-marker` and `style/ordered-list` leave these
  lists as written too.

## `style/list-marker`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `marker`.

Writes every bullet list with one marker.

| Option   | Values                                              | Default |
| -------- | --------------------------------------------------- | ------- |
| `marker` | `"-"`, `"*"`, `"+"`, `"consistent"`, or `"sublist"` | `"-"`   |

- `consistent`: the marker of the document's first bullet list, as in
  markdownlint's MD004.
- `sublist`: each level of nesting keeps the marker of its first list, unless
  the level above has that marker, in which case it gets the next one, as with
  MD004's `sublist`. A level counts the bullet lists that a list is nested in.

A bullet list that directly follows another one is a separate list only because
its marker differs, so it gets the next marker in the order `-`, `*`, `+`, and
the list after that the first one again. A list whose new marker would make a
line read as a thematic break, as `+ - -` would with `-`, keeps its markers, and
so do the lists next to it. So does a list directly below TOML front matter
whose first item starts with a blank line, as for
[`style/list-indent`](#stylelist-indent).

Before:

```markdown
* Milk
* Bread

+ Plates
```

After:

```markdown
- Milk
- Bread

* Plates
```

## `style/ordered-list`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `delimiter`, `numbering`.

Writes the numbers of ordered lists with one delimiter and numbers the items
consistently.

| Option      | Values                             | Default  |
| ----------- | ---------------------------------- | -------- |
| `delimiter` | `"."`, `")"`, or `"consistent"`    | `"."`    |
| `numbering` | `"auto"`, `"ordered"`, or `"same"` | `"auto"` |

- `delimiter`: `consistent` is the delimiter of the document's first ordered
  list. As with bullet markers, an ordered list that directly follows another
  one keeps a different delimiter.
- `numbering`: `ordered` counts up from the first number, and `same` repeats it
  in every item. `auto` repeats it when the first two items have the same
  number, as in `1.`, `1.`, `1.`, and counts up otherwise. These are
  markdownlint's MD029 `one_or_ordered`, `ordered`, and, for lists that start at
  1 or 0, `one` and `zero`.

The first number never changes, because the rendered list starts at it. When a
number gets wider or narrower, as from `9.` to `10.`, the item's other lines
move with its text. A list keeps its numbers where that would move a line into
or out of an item, as for [`style/list-indent`](#stylelist-indent), and where
the numbers are written with leading zeros, as in `01.`, or would need more than
nine digits. A list directly below TOML front matter that does not start at 1,
or whose first item starts with a blank line, keeps its delimiter and numbers,
as for `style/list-indent`.

Before:

```markdown
1) Unpack the board.
2) Connect the sensor.
2) Power it on.
```

After:

```markdown
1. Unpack the board.
2. Connect the sensor.
3. Power it on.
```

## `style/strong`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `marker`.

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

**Style rule**, fixed by `format`. Presets: `recommended`, `github`, `forgejo`,
`gitea`, `obsidian`. Dialects: all but CommonMark. Options: `style`.

Aligns a table: every cell of a column is padded to the column's width, measured
in display columns, and the delimiter row keeps each column's alignment. The
option `style` is `"aligned"` (the default) or `"compact"`, which writes one
space on each side of a cell's text and delimiters of three characters, such as
`| :-- | --: |`. The text of each cell is left as written, and so is the number
of cells in each row. A table inside a list or block quote, and one with a row
that has more cells than its header, are left as written.

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

## `style/thematic-break`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `marker`.

Writes thematic breaks with one marker. The option `marker` is `"---"` (the
default), `"***"`, `"___"`, or `"consistent"`, which takes the character of the
document's first break. Blank space before and after the break stays.

Before:

```markdown
Text.

* * *
```

After:

```markdown
Text.

---
```

A break is left as written where the new marker would change what the document
means:

- With `---`, directly below a paragraph, a link reference definition, or
  display math, which `---` would underline as a heading; GitHub builds display
  math from a paragraph.
- On the line of a list item whose marker is the new marker's character, as in
  `- ***` with `---`: `- ---` is one thematic break, not a list item.
- At the start of a document, with `---`, which would open front matter if a
  later line of `---` closed it, and a `---` that site generators read as the
  start of front matter.
- With `---`, at the start of a line below a first line of `---` that no line
  closes, which `---` would close as front matter.
- Directly below TOML front matter, a break that is or would become `---`,
  because renderers without TOML front matter read the front matter's lines as a
  paragraph that `---` underlines as a heading; see the [safety
  model](design.md#safety-model).

## `style/trailing-space`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `hardBreak`.

Removes spaces and tabs at the end of lines. A hard line break written as two or
more spaces keeps them. The option `hardBreak` is `"keep"` (the default) or
`"backslash"`, which writes such a break as a backslash, so that it is visible
in the source.

With `{ "hardBreak": "backslash" }`, before, with two spaces after `one`:

```markdown
Line one  
line two
```

After:

```markdown
Line one\
line two
```

Blank space is left as written where it is content: in code blocks, except on
their fence lines, and in HTML, math, front matter, Obsidian comments, code
spans, and link titles and labels that span lines. With `"backslash"`, a break
stays as spaces where a backslash would change what the line says: after another
backslash, after a literal autolink such as `www.example.com`, which would take
the backslash into its address, on the title line of an alert or callout, in a
paragraph that starts like a link reference definition (`[label]:`), and on
Forgejo and Gitea inside `\(...\)` math.

## `style/wrap`

**Style rule**, fixed by `format`. Presets: `recommended`. Dialects: all.
Options: `width`, `measure`, `reportUnreflowed`, `reportUnbreakable`.

Reflows each paragraph so that its lines fill the width without exceeding it. A
line break inside a paragraph renders as a space, so the rendered text stays the
same, and short lines keep diffs small. Lines are broken at spaces in the text,
also in the text of a link, emphasis, strong text, or strikethrough. A code
span, an image, math, a link's destination, a template tag on one line such as
`{% data x %}` or `{{ title }}`, and a word longer than the line stay whole and
can overflow; a code span or an image description written across lines is joined
onto one, without the spaces and tabs that start its next line, as renderers
read it. In Obsidian, the text of a link stays whole and is joined onto one line
too, because Live Preview shows a link whose text spans lines as its Markdown
source. List markers, block quote markers, and indentation count toward the
width, a tab up to the next multiple of four columns.

A word that would start a block at the start of a line, such as a list marker,
`#`, `>`, a run of `-` or `=`, or a table delimiter row such as `|---|`, stays
on the line before it, and so does a word that starts with `:::`, `{%`, or `{{`.
A word that only starts like one, such as `--config`, `#tag`, or `-5`, can start
a line. The first line keeps more than one word when its first word alone would
open a block, such as `***` or `$$`, or, in the body below the line of an
alert's or callout's marker, would underline that line as a heading, such as
`==` or `--`. It also keeps a paragraph that starts like a link reference
definition (`[Note]: see …`) from becoming one. On GitHub and in Obsidian, a
word that starts with `$` stays on the line before it when a `$` comes earlier
in the paragraph, and in Obsidian a word that ends in `$`, such as a lone `$`,
stays on the line after it when a `$` comes later: at the edge of a line, a
dollar can begin or end math that it cannot begin or end next to a space.

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
  that cannot be split, also in paragraphs left as written. The line of an
  alert's or a callout's marker counts as one such piece, even when it contains
  spaces.

The two report options propose no edits and use the rule's severity. To make
them fail a check, set the rule to `error` or pass `--max-warnings 0`;
`format --check` checks only for edits.

A paragraph is left as written when joining or breaking its lines could change
what it means, that is, when it:

- has a hard line break, inline HTML, or a block identifier (`^id`) at its end;
- has a line break that is content, inside math, inline HTML, an Obsidian
  comment, or a link's destination or title;
- has lines whose container markers the tool cannot reproduce;
- opens a block quote with an alert or callout marker such as `[!NOTE]` in the
  CommonMark dialect; in the other dialects only the line with the marker, and
  an Obsidian callout's title on it, stays as it is, and the body is wrapped. A
  paragraph elsewhere that starts with a linked image, `[![…](…)](…)`, is
  wrapped;
- starts with a bare `-`, `+`, `*`, `1.`, `1)`, `#`, or `>` followed by more
  words, which joining would turn into a block;
- starts directly below a link reference definition without that definition's
  container markers;
- has a table delimiter row such as `| - |` as its second line, in the dialects
  with tables: such a paragraph is usually a table that the parser reads as text
  (see [the safety model](design.md#safety-model));
- has a line that starts with `:::`, `{%`, or `{{`, which [site
  generators](dialects.md#what-each-dialect-reads) read by line;
- holds, in the Obsidian dialect, `==`, `[[`, or `]]` outside its highlights and
  wikilinks, because joining lines could create one.

In the Obsidian dialect, the rule wraps only with the vault's [strict line
breaks](obsidian.md#enable-wrapping). [Forgejo and
Gitea](dialects.md#forgejo-and-gitea) add their own cases.

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
