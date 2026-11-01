# `style/emphasis`

Writes emphasis with one marker, `_` by default.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

Before:

```markdown
Use *emphasis* sparingly, as in un*believ*able.
```

After:

```markdown
Use _emphasis_ sparingly, as in un*believ*able.
```

`marker` is `"_"` (the default), `"*"`, or `"consistent"`. With `"consistent"`,
the first parsed emphasis in the document chooses the marker, including emphasis
inside a word, so a document starting with `un*believ*able` uses `*` for later
emphasis too, and `*first* and _later_` becomes `*first* and *later*`. Each
document chooses independently, including when the first node cannot safely
change. Code, HTML blocks, and Obsidian wikilinks do not choose a marker.

## Edge cases and advanced usage

**Details:** with `_`, emphasis inside a word keeps `*`, because `_` cannot mark
emphasis there.

**Left as written:** markers where new ones could change how the text parses,
and the exceptions of [Forgejo and Gitea](../../dialects.md#forgejo-and-gitea):

- A new marker that would touch another `*` or `_`, or be separated from one
  only by `~`.
- Text with a `*` or `_` that did not pair, as in `*a _b* c_`, or with a run of
  markers that two emphases share, as in `*****a***`. There markers change only
  where the rule can tell that every pair stays the same.
- The text of a collapsed or shortcut reference, such as `[*Title*][]` or
  `[*Title*]`, which is also its label, and text in brackets that would match a
  definition's label with the new markers.
- A marker right after a `$` on GitHub, Forgejo, and Gitea, where a `_` after
  the dollar decides whether dollar math ends there.
- Emphasis or strong text crossing an HTML region protected in Obsidian, or a
  block HTML/component line in VitePress. Delimiters on opposite sides do not
  form an editable pair in those readings. Independent pairs remain editable.
- Emphasis that begins on the line of an alert's or a callout's marker and ends
  below it.
- Emphasis whose text holds a run of tildes that could mark strikethrough, one
  or two tildes or in Obsidian two, while the paragraph holds another: GitHub
  can read strikethrough there and the markers as text.
- A `_`, old or new, that only tildes separate from a letter or digit, as in
  `x~~_b_~~`, which GitHub reads as inside a word.
- Text whose markers CommonMark pairs otherwise than the parser, as in
  `xab***a* a*y`: GitHub follows CommonMark, so the parser misread the text.

## Dialect notes

**In Obsidian:** a paragraph, heading, or table cell whose text holds a `*` or
`_` that is not a marker, as in `snake_case` or `5 * 3`, keeps its markers.
Obsidian's Reading view pairs such a character with a later one, so
`snake_case and _em_` shows `case and _em` as emphasis, and
`snake_case and *em*` is right only with the `*` kept. Escaped characters and
those in code, math, or wikilinks do not count.
