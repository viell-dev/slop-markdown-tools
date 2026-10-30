# `style/thematic-break`

Writes thematic breaks with one exact text, `---` by default.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

Before:

```markdown
Text.

* * *
```

After:

```markdown
Text.

---
```

`marker` is `"---"` (the default), any valid thematic-break text, such as
`"* * *"`, `"-----"`, or `"___"`, or `"consistent"`, which takes the exact text
of the document's first break. A break text has at least three identical `-`,
`*`, or `_` markers, optionally separated by spaces or tabs, without leading or
trailing whitespace. With `marker: "* * *"`, the example above instead ends in
`* * *`; with `consistent`, a first `-----` makes later breaks `-----` too.

## Edge cases and advanced usage

**Details:** blank space before and after the break stays.

**Left as written:** a break where the new marker would change what the document
means:

- With compact hyphens such as `---` or `-----`, directly below a paragraph, a
  link reference definition, or display math, which `---` would underline as a
  heading; GitHub builds display math from a paragraph.
- A compact hyphen line directly below display math, also when another marker is
  requested. Spaced `- - -` remains eligible for star or underscore preferences,
  as does a break separated from the math by a blank line.
- On the line of a list item whose marker is the new marker's character, as in
  `- ***` with `---`: `- ---` is one thematic break, not a list item.
- At the start of a document, with `---`, which would open front matter if a
  later line of `---` closed it, and a `---` that site generators read as the
  start of front matter.
- With `---`, at the start of a line below a first line of `---` that no line
  closes, which `---` would close as front matter.
- Directly below TOML front matter, a break that is or would become `---`,
  because renderers without TOML front matter read the front matter's lines as a
  paragraph that `---` underlines as a heading; see the [safety
  model](../../design.md#safety-model).
