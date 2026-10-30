# `links/text-spacing`

Reports a link whose text starts or ends with blank space, as in
`[ the guide ](guide.md)`. The space is part of the link, so renderers underline
it with the text, and readers can click it.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
See [ the installation guide ](install.md) first.
```

Not reported:

```markdown
See [the installation guide](install.md) first.
```

## Edge cases and advanced usage

**Details:** inline links and full, collapsed, and shortcut references such as
`[ the guide ][guide]` and `[ guide ]` are checked; a reference still matches
its definition without the spaces, because renderers compare labels without the
blank space at their ends.

Moving the spaces outside the brackets changes the text of the link, which the
[safety check](../../design.md#safety-model) compares as part of the document's
meaning, and where they belong depends on the text around the link:
`see[ the guide ](guide.md)` needs a space before the brackets to keep `see`
apart from the link, `([ the guide ](guide.md))` reads best with none, and
`**[ the guide ](guide.md)**` would lose its strong text with a space just
inside the `**`. So the rule only reports, and the edit is left to the writer.

**Not checked:** images, because their text describes the image and is not shown
with it, Obsidian wikilinks and embeds, footnote references, task markers, alert
and callout markers, autolinks, HTML `<a>` elements, and links whose text is
only blank space.
