# `style/table`

Formats tables, also inside lists and block quotes: by default it pads every
cell to its column's width and writes the delimiter row to match, keeping each
column's alignment. Cell text and each row's number of cells stay as written.

**Style rule**, fixed by `format`. Presets: `recommended` (warn), `github`
(warn), `forgejo` (warn), `gitea` (warn), `obsidian` (warn), `vitepress` (warn).
Dialects: all but CommonMark. Options: `style`, `pipeStyle`, `alignedDelimiter`,
`padding`.

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

| Option             | Values                                                                                                           | Default                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `style`            | `"aligned"`, `"compact"`, `"tight"`                                                                              | `"aligned"`            |
| `pipeStyle`        | `"leadingAndTrailing"`, `"leadingOnly"`, `"trailingOnly"`, `"noLeadingOrTrailing"`, `"consistent"`, `"perTable"` | `"leadingAndTrailing"` |
| `alignedDelimiter` | Boolean                                                                                                          | `false`                |
| `padding`          | `"right"`, `"alignment"`                                                                                         | `"right"`              |

- `style`: `aligned` pads every cell to its column's width, measured in display
  columns (including emoji and CJK), and keeps the delimiter row's column
  alignment. `compact` writes one space around cell text and three-character
  delimiters, such as `| :-- | --: |`. `tight` writes no padding: `|a|b|`.
  Unlike markdownlint's `any`, each value names a target output: accepting any
  of several styles would leave a formatter without a target, so choose the
  desired style or turn the rule off to keep spacing as written.
- `pipeStyle`: `"consistent"` takes the first table header's borders for the
  document; `"perTable"` takes each table's own header. The other values request
  specific borders.
- `alignedDelimiter`: aligns delimiter pipes with the header in compact and
  tight tables; short headers gain padding to fit the minimum three-character
  delimiters. Body cells still use the selected style.
- `padding`: `"alignment"` pads right-aligned text on the left and centered text
  on both sides (an odd extra space goes on the right). It applies to aligned
  cells and to headers padded for `alignedDelimiter`. `"right"` puts all extra
  spaces on the right.

For example, with
`{ "style": "tight", "pipeStyle": "noLeadingOrTrailing", "alignedDelimiter": true }`:

```markdown
Alpha|Beta
-----|----
x|y
```

With `{ "padding": "alignment" }`, right and centered columns instead pad as
follows:

```markdown
| Right | Center |
| ----: | :----: |
|     x |   y    |
```

**Borders:** pipes needed to keep a one-column table are kept: when neither
border is requested, such a table uses both. A table keeps its leading border
when a row's first cell is empty or starts like another block, such as `- x`,
`# x`, or `1. x`, which would otherwise start that block; it keeps its trailing
border when a row's last cell is empty, which would otherwise vanish. Without a
trailing border, the last cell gets no padding, so no line ends in blank space.
A preferred form that would change meaning stays as written.

**In lists and block quotes:** each row keeps the quote markers, list
indentation, and line ending before it as written, and column widths are
measured after them, so the rows line up when their prefixes have the same
width; [`style/list-indent`](../style/list-indent.md) and the other container
rules format the prefixes. Every option applies as it does elsewhere:

```markdown
> | Sensor      | Unit |
> | :---------- | ---: |
> | Temperature | °C   |
```

A header written on its list item's marker line keeps its leading pipe, or its
lack of one: markdown-it, which VitePress uses, reads `- Sensor | Unit` above an
indented delimiter row as a table outside the list, with the marker in its first
cell. Such a header without a leading pipe has none added, and its table stays
as written when a row needs one.

## Edge cases and advanced usage

**Left as written:**

- Tables with more cells in a row than in the header.
- Tables in footnote definitions, and indented tables outside lists and block
  quotes.
- A table containing a standalone colon-container boundary such as `:::` or
  `:::tip`: site generators use it to open or close a container, where GFM reads
  another row. Cells written with table borders, such as `| ::: |`, are
  formatted normally.
- In VitePress, a table that markdown-it reads on other lines, in other
  containers, or not at all, such as a one-column table whose header has no
  pipe, a header written as a lazy line in a block quote, or a header on its
  list item's marker line above a delimiter row indented less than four columns,
  which markdown-it reads outside the list.

## Dialect notes

**In Obsidian:**

- An existing leading border is kept, and one-column tables keep both borders.
- A body row that changes its header's leading-pipe convention, or has only its
  leading pipe, can begin paragraph text instead. That row and the rest of the
  primary table keep their source and preceding boundary, so adding table
  borders cannot absorb the paragraph or split pipes inside links.
- A one-column table stays as written unless both its header and delimiter have
  leading and trailing pipes: Live Preview shows the other forms as source text.
  Reading view also accepts matching trailing-only pipes; missing final pipes or
  mismatched leading borders instead continue paragraph text, including across a
  Tab-only line into later literal rows.
- A table directly after a list item's closing code fence keeps its literal
  rows: Live Preview shows them as source text. A table after a heading,
  indented code, a root fence, or a blank line still formats.
- In a list or block quote, the same protections apply: a table directly below a
  line of text, including a callout's title line, or a table whose container
  prefixes hold a Tab, stays as written. A blank line below the callout's title
  lets the table format.
