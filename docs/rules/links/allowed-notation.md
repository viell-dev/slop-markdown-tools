# `links/allowed-notation`

Reports the Markdown link and image forms that its options disallow, such as
reference links or inline links whose text is their URL. `format` rewrites a
disallowed URL-as-text link as an autolink where that is safe.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`autolink`, `inline`, `full`, `collapsed`, `shortcut`, `urlInline`.

With `urlInline: false`, before:

```markdown
[https://example.com](https://example.com)
```

After:

```markdown
<https://example.com>
```

Each option allows its form when `true` and reports it when `false`:

| Option      | Form                                         | Default |
| ----------- | -------------------------------------------- | ------- |
| `autolink`  | `<https://example.com>`                      | `true`  |
| `inline`    | `[text](target)` or `![alt](target)`         | `true`  |
| `full`      | `[text][label]` or `![alt][label]`           | `true`  |
| `collapsed` | `[label][]` or `![label][]`                  | `true`  |
| `shortcut`  | `[label]` or `![label]`                      | `true`  |
| `urlInline` | `[https://example.com](https://example.com)` | `true`  |

`urlInline: false` reports only an inline link whose displayed text equals its
URL; `inline: false` reports all inline links and images.

## Edge cases and advanced usage

**Details:** references are read by the parser, matching defined labels with
Unicode case folding and collapsed spaces, tabs, and line endings. Undefined
references remain literal text. An inline URL-as-text link becomes an autolink
only when `autolink` is allowed, it has no title, and its source text and
destination are exactly the same unescaped HTTP or HTTPS URL. Fixes use a
conservative ASCII subset: letters, digits, `@%+._~:/?#=-`, without trailing
punctuation or `_-`.

**Reported without a fix:** links with entities, escapes, spaces, angle
brackets, ampersands, parentheses, or formatted labels, which stay as written,
and the other disallowed forms.

## Related rules

The rule does not add or remove reference definitions.
[`links/notation`](../links/notation.md) converts verified Obsidian targets
between wikilinks and Markdown and governs wikilinks; bare addresses belong to
[`links/bare-url`](../links/bare-url.md).
