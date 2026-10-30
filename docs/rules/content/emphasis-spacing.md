# `content/emphasis-spacing`

Reports emphasis or strong markers with blank space just inside them, as in
`** bold **` or `*italic *`. A marker with blank space on its inner side cannot
open or close emphasis, so renderers show the asterisks or underscores as text.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
Here is some ** bold ** text and some *italic * text.
```

Not reported:

```markdown
Here is some **bold** text, and 2 * 3 * 4 is 24.
```

## Edge cases and advanced usage

**Details:** removing the spaces turns that text into emphasis, which may not be
what was meant, so the rule only reports. A pair of markers is reported only
where the parser of the document's dialect reads emphasis, strong text, or both
there once the spaces are gone: one, two, or three `*` or `_` at each end, on
one line, around text with a letter or a digit. Each run pairs with the next run
of the same marker on its line.

The document is read once with the spaces of every remaining pair removed. Where
that makes text into a definition, as when `[a]:` followed by `** b **` on the
next line becomes one, the pairs in it are not reported, and the document is
read again without them. Where it changes a block in another way, no pair in the
top-level block that holds the change is reported.

**Not checked:** markers that the parser did not read as text, and those in
code, math, HTML, link destinations, autolinks, and dialect syntax such as
Obsidian's comments and highlights or math between `\(` and `\)` on Forgejo and
Gitea. The content of an inline HTML element, such as `<code>** a **</code>` or
`<kbd>`, is not checked either: readers take it for literal text, even where
renderers read Markdown in it.

Where the markers can as well be something other than broken emphasis, they are
not reported, in favor of missing a mistake over reporting text that is right:

- A single `*` or `_` with blank space on both sides at both ends, as in
  `a * b * c`, `2 * 3 * 4`, or `* text *`. Multiplication, wildcards, and
  asterisks or underscores that stand for themselves are written so, and the
  text alone cannot tell them from emphasis. Two or three markers are reported
  in the same case, as in `** bold **`.
- Arithmetic, where the text inside and the words on either side are numbers,
  single letters, and operators, as in `a ** b ** c` or `2 *3 * 4`.
- A marker inside a word, as in `a* b *c`, or next to a character other than
  blank space, brackets, quotation marks, and the punctuation that ends a
  clause, such as the `/` of a JSX comment `{/* note */}`. Identifiers such as
  `my_var` and emoji codes such as `:white_check_mark:` stay alone this way.
- Text that holds a run of the same marker at least as long, as in
  `"** a **" b, (** c **)`, where the parser pairs the inner runs as strong
  text, and pairs of different markers that overlap. Which markers belong
  together is not known there.
- Text that starts with something other than a letter, a digit, an opening
  bracket or quotation mark, or ends with something other than a letter, a
  digit, a closing bracket or quotation mark, or `.`, `!`, or `?`, unless a code
  span, link, or other inline element starts or ends it there. Emphasis that was
  meant starts and ends with a word, unlike the wildcard patterns of
  `glob *.md * notes` or `*.txt *`.
- Markers in the label of a collapsed or shortcut reference, as in `[** a **]`,
  where removing the spaces would change the definition that the label names.
- Runs of four or more markers, and pairs whose text spans lines.
