# `style/list-marker`

Writes every bullet list with one marker, `-` by default.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

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

| Option   | Values                                              | Default |
| -------- | --------------------------------------------------- | ------- |
| `marker` | `"-"`, `"*"`, `"+"`, `"consistent"`, or `"sublist"` | `"-"`   |

- `consistent`: the marker of the document's first bullet list, as in
  markdownlint's MD004.
- `sublist`: each level of nesting keeps the marker of its first list, unless
  the level above has that marker, in which case it gets the next one, as with
  MD004's `sublist`. A level counts the bullet lists that a list is nested in.

## Edge cases and advanced usage

**Details:** a bullet list that directly follows another one is a separate list
only because its marker differs, so it gets the next marker in the order `-`,
`*`, `+`, and the list after that the first one again.

**Left as written:**

- A list whose new marker would make a line read as a thematic break, as `+ - -`
  would with `-`, and the lists next to it.
- A list directly below TOML front matter whose first item starts with a blank
  line, as for [`style/list-indent`](../style/list-indent.md).
- In VitePress, a list with an item whose first line is a table's header row,
  and the lists next to it, and a list directly beside a list that a component
  line leaves as written, as for [`style/list-indent`](../style/list-indent.md).
