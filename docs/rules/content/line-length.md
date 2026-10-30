# `content/line-length`

Reports lines in headings, code blocks, and tables that are longer than a limit,
80 columns by default. It never edits, because splitting these lines can change
their meaning; paragraphs are left to [`style/wrap`](../style/wrap.md), which
reflows them.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`lineLength`, `headingLineLength`, `codeBlockLineLength`, `headings`,
`codeBlocks`, `tables`, `strict`, `stern`, `measure`.

With `{ "lineLength": 40 }`, reported:

```markdown
## Configuring the formatter and the linter for a large workspace
```

Not reported, because it is a paragraph:

```markdown
Configuring the formatter and the linter for a large workspace takes one file.
```

| Option                | Values                                       | Default      |
| --------------------- | -------------------------------------------- | ------------ |
| `lineLength`          | Nonnegative integer; zero disables the limit | `80`         |
| `headingLineLength`   | Nonnegative integer                          | `lineLength` |
| `codeBlockLineLength` | Nonnegative integer                          | `lineLength` |
| `headings`            | Boolean                                      | `true`       |
| `codeBlocks`          | Boolean                                      | `true`       |
| `tables`              | Boolean                                      | `true`       |
| `strict`              | Boolean                                      | `false`      |
| `stern`               | Boolean                                      | `false`      |
| `measure`             | `"columns"` or `"codepoints"`                | `"columns"`  |

- `lineLength`: the limit for every checked line, and for tables the only one.
  Zero turns the limit off.
- `headingLineLength`, `codeBlockLineLength`: separate limits for headings and
  for code blocks; zero turns that limit off.
- `headings`, `codeBlocks`, `tables`: with `false`, lines of that kind are not
  checked.
- `strict`, `stern`: by default a line is not reported when only its last word,
  which holds no blank space, crosses the limit. `stern` reports such a line
  when it has more than one word; `strict` reports every long line and takes
  precedence.
- `measure`: as in `style/wrap`, `columns` counts display columns, so CJK
  characters and combining marks are measured as they show, and `codepoints`
  counts Unicode code points, for policies about the source. Tabs count up to
  the next multiple of four columns.

```jsonc
{
  "rules": {
    "content/line-length": ["warn", { "lineLength": 100, "codeBlocks": false }],
  },
}
```

## Edge cases and advanced usage

**Details:** each physical line of ATX and Setext headings, fenced and indented
code blocks, fence lines included, and parsed tables is measured whole, so list
and block quote markers count toward the width.

**Not checked:** paragraphs, front matter, HTML, math, reference definitions,
thematic breaks, and every other block. A table in a dialect without table
syntax is a paragraph, so it is not checked either. Markdownlint's MD013 checks
HTML and math lines too, but skips front matter and definitions, and, outside
strict checking, lines that hold only a link.

## Related rules

`style/wrap` keeps its own paragraph findings. `strict` and `stern` here apply
only to headings, code, and tables, and do not imply its `reportUnreflowed` or
`reportUnbreakable`, which judge where prose can safely break and which pieces
cannot be split, not raw blank space.
