# `links/unused-definition`

Reports a reference definition or footnote that no reference in the document
uses. A second definition of the same label is reported too, because the
renderers use the first.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all.
Options: `ignoredDefinitions`.

Reported, at `[old-setup]`:

```markdown
See the [guide][setup].

[setup]: install.md
[old-setup]: old/install.md
```

Not reported:

```markdown
See the [guide][setup] and the [changelog].

[setup]: install.md
[changelog]: CHANGELOG.md
[//]: # (Update the changelog link at each release.)
```

`ignoredDefinitions` is an array of labels whose definitions are comments rather
than links, as in `[//]: # (comment)`, which the renderers do not show. Its
default, `["//"]`, covers that common form. A configured array replaces the
default, so include `"//"` to keep it; with `[]`, no label is a comment. Labels
match as the renderers match them, without regard to case or to how much blank
space separates words; backslash escapes count as written, so `[\/\/]` is
another label.

## Edge cases and advanced usage

**Details:** a definition that only a shortcut reference `[label]` uses counts
as used. GitHub leaves footnotes that nothing references off the page.
Definitions with an ignored label are not reported, however many there are,
while no reference uses their label; a reference such as `[//]` makes them
links, which are reported as any others are. The option applies to link
definitions, not footnotes: a footnote shows its text, so an unreferenced one is
reported whatever its label.

## Dialect notes

**On GitHub:** definitions at the start of a paragraph directly interrupted by a
table are visible text, including consecutive definitions and definitions alone
above the table, also in lists and quotes. They do not define labels. A blank
line before the table keeps them as definitions, as does a heading underline
line, such as `===`, directly below them, which GitHub shows as text. Forgejo,
Gitea, and VitePress retain the definitions without that blank line.

## Related rules

[`links/empty`](../links/empty.md) takes the same option.
