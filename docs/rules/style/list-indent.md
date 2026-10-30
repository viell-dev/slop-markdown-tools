# `style/list-indent`

Puts the configured spaces, one by default, between a list marker and the item's
text, and starts each item where its container's text starts: at the start of
the line, after a block quote's `>`, or under the text of the list item that
holds it. The item's other lines move by as many columns as its text, so its
paragraphs, code blocks, and nested lists stay inside it as they were.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: spaces after markers, `nestedIndent`, `startIndented`, `startIndent`.

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

| Option                   | Values                 | Default               |
| ------------------------ | ---------------------- | --------------------- |
| `bulletSpaces`           | An integer from 1 to 4 | `1`                   |
| `orderedSpaces`          | An integer from 1 to 4 | `1`                   |
| `bulletSpacesMultiline`  | An integer from 1 to 4 | `bulletSpaces`        |
| `orderedSpacesMultiline` | An integer from 1 to 4 | `orderedSpaces`       |
| `nestedIndent`           | An integer from 1 to 8 | Under the item's text |
| `startIndented`          | A boolean              | `false`               |
| `startIndent`            | A nonnegative integer  | `2`                   |

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
- `startIndented` and `startIndent`: with `startIndented: true`, the first level
  of bullet and ordered lists starts `startIndent` columns into its container.
  `{ "startIndented": true, "startIndent": 2 }` writes `- item` as `  - item`,
  moving its continuation lines too. Nested lists still use `nestedIndent`. A
  list that starts a block quote's line is indented too; set
  [`style/quote-marker`](../style/quote-marker.md)'s `listItems` to `false` with
  it. Four or more columns would make code, so the rule keeps lists as written
  for those values. A first-level list directly below nonblank text also stays,
  because indentation can make it continue that text.

## Edge cases and advanced usage

**Left as written:**

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
  continues as text.
- A list among the blocks indented below text that the parser reads where
  renderers read a list, such as `2. Two` after an indented code block, or the
  list right after them, and the lists next to it (see [how it
  works](../../design.md#safety-model)).

## Dialect notes

**In VitePress:** a list with an item whose first line is a table's header row,
as `*   a | b` above `    --|--` is, keeps its markers and indentation, and so
do the lists next to it. markdown-it tries a table before a list, so with less
indentation, or with a marker that joins it to the list above, it reads that row
as a table above the list, with the marker in its first cell. A list directly
beside a list that a component line leaves as written (see
[VitePress](../../vitepress.md#preservation)) keeps its markers and indentation
too, because another marker would join the two.

**In Obsidian:** a document-level list that ends in a nested list keeps its
indentation, and so does the opening list in the following quote when its marker
has exactly two spaces after `>`. Live Preview carries the earlier indentation
into that quoted list, even across blank lines; changing it can remove a painted
bullet. An intervening block restores ordinary indentation preferences, and safe
marker and inline styles remain available. Quoted blocks opened after a Tab have
separate literal-source protection; see [Obsidian's boundary
protections](../../obsidian.md#boundary-protections). Ordinary space-only quoted
margins remain eligible for list indentation.

## Related rules

[`style/list-marker`](../style/list-marker.md) and
[`style/ordered-list`](../style/ordered-list.md) also keep the markers of the
lists below TOML front matter and among misread blocks above. In the Obsidian
lists above, `style/ordered-list` keeps the number width, while allowing
same-width numbering and delimiter changes.
