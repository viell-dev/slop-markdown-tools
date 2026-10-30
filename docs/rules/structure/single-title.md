# `structure/single-title`

Reports a second level-1 heading in a document. A document has one title, and
further level-1 headings usually belong one level down.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: `level`,
`frontMatterTitle`.

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

| Option             | Values                                             | Default |
| ------------------ | -------------------------------------------------- | ------- |
| `level`            | An integer from 1 to 6                             | `1`     |
| `frontMatterTitle` | `true`, `false`, or a regular expression as string | `true`  |

- `level`: the title heading's level.
- `frontMatterTitle`: with `true`, a top-level YAML or TOML `title` key counts
  as the title, and every level-1 heading is then reported. Set it to `false` or
  `""` when metadata does not supply a rendered title, or use a
  regular-expression string to recognize another field, with the same matching
  contract as [`structure/initial-heading`](../structure/initial-heading.md).

## Edge cases and advanced usage

**Details:** as for `structure/heading-increment`, the headings of a block quote
or a footnote are checked among themselves. A metadata title belongs only to the
document's own outline, not its quotes or footnotes.
