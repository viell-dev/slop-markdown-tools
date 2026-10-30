# `links/undefined-reference`

Reports a reference whose label has no definition in the document: a full
reference `[text][label]`, a collapsed reference `[label][]`, and, in every
dialect but CommonMark, a footnote reference `[^label]`. The renderer shows such
a reference as plain text, brackets and all.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all;
footnotes all but CommonMark. Options: `shortcutSyntax`, `ignoredLabels`.

Reported, when neither a definition `[setup]: …` nor a footnote `[^1]: …`
exists, and with `shortcutSyntax`, also at `[Enter]`:

```markdown
See the [installation guide][setup] and [setup][].[^1] Press [Enter].
```

Not reported, with the default options:

```markdown
See the [installation guide][Setup] and press [Enter].

[setup]: install.md
```

| Option           | Values             | Default |
| ---------------- | ------------------ | ------- |
| `shortcutSyntax` | `true` or `false`  | `false` |
| `ignoredLabels`  | An array of labels | `[]`    |

- `shortcutSyntax`: with `true`, also report a shortcut reference whose label
  has no definition: brackets that hold a label and are not followed by `[]` or
  another label, as CommonMark reads them, such as `[Enter]`. It leaves alone
  the brackets listed below.
- `ignoredLabels`: labels not to report, of any kind of reference; `[]` ignores
  none. Write a footnote's label with its `^`, as in `^draft`. markdownlint's
  MD052 ignores `x` by default for task marks, which `shortcutSyntax` already
  leaves alone at the start of a list item.

## Edge cases and advanced usage

**Details:** labels match as the renderer matches them, without regard to case
or to how much blank space separates words, also in `ignoredLabels`. A run of
brackets such as `[a][b][c]` is reported once, at its start.

**Not checked:** a shortcut reference, `[label]` alone, unless `shortcutSyntax`
is on, because brackets in prose are usually just brackets. Neither are brackets
directly after a letter, digit, `_`, or `)`, as in `matrix[i][j]`, which are
indexes rather than references, nor brackets in code, math, HTML, or links, nor
escaped ones (`\[`).

**With `shortcutSyntax`:** brackets that mean something else where they stand
are still not reported:

- A task mark that starts a list item where the parser reads none, `[ ]`, `[x]`
  or `[X]`, and in Obsidian any one character, such as a custom status `[/]`.
- An alert or callout marker such as `[!NOTE]` that starts a block quote.
- An Obsidian inline footnote `^[note]`.
- A Forgejo or Gitea shortlink `[[Page]]`.
- Text inside an inline HTML element, as in `<kbd>[Enter]</kbd>`. An element
  stays open until its end tag, except a void element such as `<br>`: a browser
  ignores the `/` in `<span/>`, which closes an element only in VitePress, whose
  HTML Vue renders.
- A URL written as text, such as `https://example.com/[id]`. A URL runs from its
  scheme or `www.` to blank space or a `<`, as GFM's autolink literals read it:
  a scheme may follow any character that is not part of it, as in
  `(https://example.com/[id])` or a quoted URL, while `www.` must start the text
  or follow blank space or one of `(*_[]~`.

## Dialect notes

**On GitHub:** definitions at the start of a paragraph directly interrupted by a
table are visible text, including consecutive definitions and definitions alone
above the table, also in lists and quotes. They do not define labels. A blank
line before the table keeps them as definitions, as does a Setext underline
line, such as `===`, directly below them, which GitHub shows as text. Forgejo,
Gitea, and VitePress retain the definitions without that blank line.
