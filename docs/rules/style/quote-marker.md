# `style/quote-marker`

Writes one space after each block quote marker, `>`, where the line has text
after it: more spaces become one, and a space is added where there is none, also
between nested markers, as in `>>` and `>  >`. The quote takes one space after
its marker as part of the marker, so the text keeps its place in the quote.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `listItems`.

Before:

```markdown
>  Back up the database.
>>The backup takes an hour.
```

After:

```markdown
> Back up the database.
> > The backup takes an hour.
```

`listItems` is `true` or `false`; the default is `true`. As in markdownlint's
MD027, it sets whether lines that start a list item count. The spaces between
`>` and a list marker are the list's indentation, so the rule moves the list to
one space after `>` with the lines of its items, as
[`style/list-indent`](../style/list-indent.md) moves a list, and leaves it as
written where that would move a line into or out of an item.

## Edge cases and advanced usage

**Left as written:**

- Indented code, which five or more spaces after `>` start, and the lines of
  fenced code and HTML, whose spaces beyond the quote's one are content; a space
  is still added after a `>` that has none there, which moves nothing.
- A paragraph's later line whose spaces keep its text from starting a block:
  below a quoted paragraph, `>     # Title` is text, which one space after `>`
  would make a heading. The spaces become one only before text that
  [`style/lazy-continuation`](../style/lazy-continuation.md) would also prefix
  on a lazy line.
- A quote line with nothing after its spaces, whose spaces are trailing space
  for [`style/trailing-space`](../style/trailing-space.md), and the spaces on
  the other lines of a list item, which belong to the item.
- A tab after `>` or among a line's markers, which counts to the next tab stop.
- The later lines of a code span or other inline syntax that keeps the spaces at
  the start of its lines, and quotes with site-generator syntax such as `:::` or
  `{{` at the start of a line.
- A quote that the next line follows without a blank line or a `>`. Renderers
  can read that line as more of the quote where the parser starts another block,
  as with a numbered item that does not start at 1.

## Dialect notes

**In VitePress:** the quotes of a document with a custom container's fence on a
quote's line stay as written.

**In Obsidian:** a tag directly after `>`, as in `>#tag`, stays as written,
because Live Preview reads it as text and would read it as a tag after a space
([issue #409](https://github.com/viell-dev/slop-markdown-tools/issues/409)). So
does a callout's marker after two or more spaces, as in `>  [!tip]`, which is
text there and one space would make a callout (see
[`obsidian/callout-marker`](../obsidian/callout-marker.md)). Elsewhere the
spaces do not change how the marker reads; GitHub shows an alert after any
number of them. Like the list rules, the rule follows Obsidian's [boundary
policy](../../obsidian.md#visible-boundary-refusals): an edit at a boundary
between text and a list, quote, or other block stays as written with a finding.

## Related rules

With [`style/list-indent`](../style/list-indent.md)'s `startIndented`, which
indents a list that starts a quote's line, set `listItems` to `false`, or the
two rules undo each other's edits.
