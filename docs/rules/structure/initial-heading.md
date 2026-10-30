# `structure/initial-heading`

Requires the first block of a document, after optional YAML or TOML front
matter, to be a level-1 heading. Underlined (`===`) headings count as well as
`#` headings.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: `level`,
`allowPreamble`, `frontMatterTitle`.

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

| Option             | Values                                             | Default |
| ------------------ | -------------------------------------------------- | ------- |
| `level`            | An integer from 1 to 6                             | `1`     |
| `allowPreamble`    | `true` or `false`                                  | `false` |
| `frontMatterTitle` | `true`, `false`, or a regular expression as string | `false` |

- `level`: the required heading level.
- `allowPreamble`: with `true`, prose and comments may precede the first
  top-level Markdown heading, which must have that level. A document with no
  heading is still reported unless a recognized front-matter title satisfies the
  check.
- `frontMatterTitle`: the default, `false`, requires a body heading even when
  metadata contains a title. `true` lets a top-level YAML or TOML `title` key
  satisfy the check; a JavaScript regular-expression string such as
  `"^page_name\\s*[:=]"` recognizes a different field. The pattern matches the
  front matter's contents, without its delimiters, in multiline mode; it does
  not match the body. An invalid pattern is a configuration error. `false` or
  `""` disables title recognition. The same setting is available on
  `structure/single-title`, with a different default, and on
  `structure/heading-increment`, with the same default.

## Edge cases and advanced usage

**Details:** an empty document is reported. Comments and other content before
the title are not skipped. A heading inside a list or quote does not supply the
document's initial heading. The default title detector matches a literal `title`
key, optionally quoted: in column 1 for YAML, or before the first table header
in TOML, where indentation is allowed. It matches text rather than parsing the
metadata; use a custom pattern for other textual forms. Use
[overrides](../../configuration.md#overrides) to exempt generated documents.

## Related rules

[`style/heading`](../style/heading.md) turns underlined headings into `#`
headings.
