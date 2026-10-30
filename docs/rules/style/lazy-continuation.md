# `style/lazy-continuation`

Writes the markers and indentation of a paragraph's containers on its lazy
continuation lines: lines that continue the paragraph of a block quote, a list
item, or a footnote definition without the quote's `>` or the item's or
definition's indentation. The renderers read such a line as part of the
paragraph either way, so the text stays the same, and the document's structure
shows in its source.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: none.

Before:

```markdown
> Back up the database
before the migration.

- Unpack the board
and check the cables.
```

After:

```markdown
> Back up the database
> before the migration.

- Unpack the board
  and check the cables.
```

## Edge cases and advanced usage

**Details:** a quote gets its `>`, indented as on the quote's first line and
with one space after it; a list item gets the columns up to its text; a footnote
definition gets four spaces; nested containers get all of theirs. The spaces
that a lazy line starts with are replaced, not added to, and a footnote
definition's first line stays on the line of its label.

**Left as written:** a paragraph's lazy lines, all of them, where one of them
could read otherwise inside its containers. The rule writes a prefix only on a
line that starts with a letter or another character that is not ASCII
punctuation, a number not followed by `.` or `)`, emphasis, a code span, a link
or image, an opening parenthesis, or a quotation mark, and that holds no `|` and
does not look like a link reference or footnote definition. A line of `===`
below a lazy line, for example, is text, and inside a quote it would underline
the text above it as a heading; `2. Step`, `- item`, `# Title`, `<span>`, and a
table row are others, also after the spaces that a lazy line starts with. Lazy
lines also stay:

- inside a code span or other inline syntax that keeps the spaces at the start
  of its lines;
- with a tab among their containers' prefixes;
- as a lazy first line below a link reference definition;
- in paragraphs with site-generator syntax such as `:::` or `{{` at the start of
  a line.

## Dialect notes

**In VitePress:** lazy lines also stay in documents with a custom container's
fence on a quote's line, and below a component line such as `<MyComponent />`,
which ends the paragraph there, so that a line without the item's indentation
starts a paragraph after the list.

**In Obsidian:** the rule writes only the prefixes observed to leave both views
unchanged: a quote's `>` where the lazy line lacks every `>` of its quotes, and
list items' indentation where that is all it lacks. Live Preview shows the line
otherwise once a footnote definition's lazy line is indented, once a quote
inside a list item gets its `>`, and once a nested quote's `>` is written after
its outer quote's, so these lazy lines, and the combinations not observed, stay
as written with a finding whose message starts with
`Left as written to preserve Obsidian rendering`. So does a list item's lazy
line with more blocks after it in the item, which Live Preview reads outside the
list ([issue
#376](https://github.com/viell-dev/slop-markdown-tools/issues/376)).

## Related rules

[`style/wrap`](../style/wrap.md) joins a lazy line onto the line before it when
it reflows the paragraph, and writes the containers' prefixes on the lines that
it breaks, so the two rules agree. This rule also changes the paragraphs that
wrapping leaves as written, such as one with a hard line break.
