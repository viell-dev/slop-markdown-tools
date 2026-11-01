# `links/notation`

Converts Obsidian links between Markdown and wikilink notation. Only links whose
target exists are converted.

**Style rule**, fixed by `format`. Presets: none. Dialects: Obsidian. Options:
`style`, required.

With `"style": "markdown"`, before:

```markdown
See [[Garden/Plan|the plan]].
```

After:

```markdown
See [the plan](<Garden/Plan>).
```

The `style` option is required; without it the rule does nothing.

- `"markdown"` turns a wikilink with its own label, `[[target|label]]`, into
  `[label](<target>)`.
- `"wiki"` turns a Markdown link whose label is plain text into
  `[[target|label]]`.

## Edge cases and advanced usage

**Details:** a new wikilink decodes percent escapes, because Obsidian takes its
text as the note's name: `[x](My%20Note.md)` becomes `[[My Note.md|x]]`. In a
table cell, a `|` that the rule writes, between a new wikilink's target and
label or in a new Markdown label, is escaped as `\|`, because one that is not
escaped ends the cell.

**Left as written:**

- Titles and labels with formatting.
- Wikilinks without a label, which show their target as text, and embeds: a note
  embed is not the same thing as a Markdown image.
- A destination that does not decode, or whose name would hold `|`, `[`, `]`,
  `#`, or `^`.

## Related rules

With [`links/path`](../links/path.md) also on, a link that both change gets its
notation first and its path in the next pass, the same result as running them
one after the other.
