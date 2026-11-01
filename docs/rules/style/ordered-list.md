# `style/ordered-list`

Writes the numbers of ordered lists with one delimiter and numbers the items
consistently.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `delimiter`, `numbering`.

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

## Edge cases and advanced usage

**Details:** the first number never changes, because the rendered list starts at
it. When a number gets wider or narrower, as from `9.` to `10.`, the item's
other lines move with its text.

**Left as written:** the numbers of a list

- where changing them would move a line into or out of an item, as for
  [`style/list-indent`](../style/list-indent.md);
- that are written with leading zeros, as in `01.`, or would need more than nine
  digits;
- directly below TOML front matter that does not start at 1, or whose first item
  starts with a blank line, which keeps its delimiter too, as for
  `style/list-indent`.

## Dialect notes

**In Obsidian:** digit widths stay where a trailing nested list controls a
following quoted list's indentation, as described for
[`style/list-indent`](../style/list-indent.md). Same-width numbering and
delimiter preferences remain available.
