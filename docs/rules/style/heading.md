# `style/heading`

Writes headings in one style, by default as `#` headings without closing `#`
sequences, with one space after the opening hashes and no indentation.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `style`, `closing`.

Before:

```markdown
Installation
------------

##  Usage  ##
```

After:

```markdown
## Installation

## Usage
```

| Option    | Values                              | Default    |
| --------- | ----------------------------------- | ---------- |
| `style`   | `"atx"`, `"setext"`, `"consistent"` | `"atx"`    |
| `closing` | `"remove"`, `"keep"`, `"add"`       | `"remove"` |

- `style`: `atx` writes `#` headings, turning a heading underlined with `===` or
  `---` into a `#` heading of the same level. `setext` underlines headings of
  levels 1 and 2 and keeps `#` for deeper levels, which cannot be underlined.
  `consistent` follows the document's first heading: `setext` when it is
  underlined, otherwise `atx`.
- `closing`: `remove` removes the closing sequence of a `#` heading with the
  blank space around it. `keep` retains existing closing sequences, with one
  space between them and the text, and adds none. `add` writes a closing
  sequence matching the heading's level, with one preceding space, and
  normalizes existing sequences to that length: `### Details` becomes
  `### Details ###`, and an empty `##` becomes `## ##`. Both also apply to
  headings kept in ATX form by `setext` and `consistent`; with
  `style: "setext"`, levels 1 and 2 remain underlined.

## Edge cases and advanced usage

**Details:**

- An ATX heading gets one space between its opening hashes and its text, also
  where a tab separated them; an empty heading needs none. This applies to
  headings kept in ATX form with `setext` or `consistent` too.
- One to three spaces of heading indentation are removed, also on Setext text
  and underline lines, without an option. Required list and quote prefixes stay
  as written; only spaces beyond those prefixes are removed. Indented code is
  not a heading.
- A trailing run of `#` in the text of an underlined heading is escaped, so that
  it is not taken for a closing sequence, also before a new closing sequence.

**Left as written:**

- Ambiguous container prefixes, and a heading that a renderer protection covers
  in part, which keeps all of its indentation and its form, such as an Obsidian
  Setext title whose indented underline or reference-like first line a view
  reads differently.
- The form of underlined headings of more than one line, those inside lists or
  block quotes, and one directly below TOML front matter, whose lines renderers
  without TOML front matter read as part of the heading.
- Below a first line of `---` or `+++` that no line closes, the indentation of
  an underline or text line that is that fence alone, as in `  ---`, because
  without it the line would close front matter.

**With `setext`:** a `#` heading is underlined only where its text can stand on
a line of its own as the same heading: at the start of a line of the document,
not in a list or block quote, below a blank line or at the start of the
document, because directly below text its line would continue the paragraph. It
keeps its `#` when its text starts like another block, such as a list item,
block quote, thematic break, fence, HTML, or link reference definition, when it
contains `|`, which `---` below it could make a table, or when it ends with a
backslash, and on Forgejo and Gitea when it contains `{`. Below a first line of
`---` that no line closes, a level-2 underline has at least four `-`, because
`---` would close it as front matter.

## Dialect notes

**On GitHub:** an existing Setext title directly after dollar display math stays
as written, because the dollar lines belong to that native heading too. A blank
line or interrupting block between them permits heading preferences again. Where
text below a list or quote ending in math continues that native container, the
source boundary stays together too.

**On Forgejo and Gitea:** a closing sequence after an attribute block such as
`{#id}` stays, because Gitea before 1.26 reads the block only when the sequence
follows it. The block and its suffix, including the spacing before that
sequence, stay as written; the opening separator can still be normalized. With
`closing: "add"`, no sequence is added after such an attribute block either.

**In Obsidian:**

- An underlined title whose text ends in a run of `#` keeps its Setext form
  instead of being escaped: the escaped ATX form can reveal hashes in Live
  Preview. Inline title formatting remains available. Tight, already escaped,
  code-span, and nonterminal hashes still allow conversion.
- A heading keeps its form when a title line begins directly with math or its
  only content is an image or embed: ATX and Setext can give those widgets
  different typography or placement. A kept Setext heading keeps its complete
  source; mixed text before math, wrapped math, and images beside ordinary title
  text remain eligible. Independent blocks below the heading still get their
  spacing, inline formatting, and table or list preferences.
- A Setext title directly after a standalone Obsidian comment keeps its
  underline, since conversion can turn Reading-view paragraph text into a
  heading. Inline title formatting remains available, and a blank line between
  them permits heading conversion.
