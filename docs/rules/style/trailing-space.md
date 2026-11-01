# `style/trailing-space`

Removes spaces and tabs at the end of lines. A hard line break written as two or
more spaces keeps them.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `hardBreak`, `hardBreakSpaces`, `listItemEmptyLines`, `codeBlocks`.

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

| Option               | Values                    | Default             |
| -------------------- | ------------------------- | ------------------- |
| `hardBreak`          | `"keep"` or `"backslash"` | `"keep"`            |
| `hardBreakSpaces`    | An integer of at least 2  | Keep existing count |
| `listItemEmptyLines` | A boolean                 | `false`             |
| `codeBlocks`         | A boolean                 | `false`             |

- `hardBreak`: `"backslash"` writes a hard line break of spaces as a backslash,
  so that it is visible in the source.
- `hardBreakSpaces`: writes an existing space-style hard break with exactly that
  many spaces; with `2`, three spaces become two, as Prettier writes it.
  `hardBreak: "backslash"` takes precedence; where converting to a backslash is
  unsafe, the break stays. It never creates a break and leaves the protected Tab
  suffixes below intact.
- `listItemEmptyLines`: `true` keeps whitespace-only lines inside list items,
  including their existing indentation. Spaces that make no break elsewhere are
  removed, matching markdownlint's strict checking.
- `codeBlocks`: `true` reports trailing spaces and tabs in fenced and indented
  code without an edit. Code content always stays byte for byte as written.
  Opaque renderer regions still suppress ordinary findings; in particular,
  VitePress's indented code stays opaque.

## Edge cases and advanced usage

**Details:**

- Blank space after a literal backslash stays when removing it would turn a
  continuing prose line into a hard line break, in paragraphs, headings, lists,
  and quotes. Blank space at the end of a paragraph or file can still be
  removed; `hardBreak` controls existing hard line breaks.
- A Tab followed by two or more spaces can mark a hard line break even where the
  primary Markdown reading has a soft line ending. In every dialect, that suffix
  stays exactly as written, including with `hardBreak: "backslash"`. Ordinary
  trailing Tabs and spaces, and those on the last content line of a paragraph or
  heading, can still be removed where they have no rendered meaning.

**Left as written:** blank space that is content: in code blocks, except on
their fence lines, and in HTML, math, front matter, Obsidian comments, code
spans, and link titles and labels that span lines.

**With `"backslash"`:** a break stays as spaces where a backslash would change
what the line says: after another backslash, after a literal autolink such as
`www.example.com`, which would take the backslash into its address, on the title
line of an alert or callout, in a paragraph that starts like a link reference
definition (`[label]:`), and on Forgejo and Gitea inside `\(...\)` math.

## Dialect notes

**In Obsidian:**

- A list marker alone on its line keeps one space after it. Live Preview needs
  that separator to style the line as a list item, even when the item's text
  starts on the next line. Extra spaces and tabs are reduced to that one space
  where safe. Quoted markers and further markers on the same physical line get
  ordinary cleanup, because Live Preview reads them as text.
- A line of blank space that holds a tab or lies directly below an HTML block
  stays, because Reading view reads it as more of the block above it. So does
  blank space at the end of a footnote definition's last line, where a paragraph
  ends the definition, which Reading view shows before the footnote's
  backreference.
- The preceding paragraph's separator before a Tab-only continuation stays when
  it marks a hard break or keeps a backslash literal. A Tab that begins before
  an unquoted paragraph's content column does not continue that paragraph merely
  by advancing past the column. Quoted margins are handled conservatively,
  keeping a possibly removable separator.
