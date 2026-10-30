# `structure/heading-punctuation`

Reports a heading whose text ends with sentence punctuation, as in
`## Installation.` or `## Options:`. A heading is a title, not a sentence.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`punctuation`.

Reported:

```markdown
## Installation.
```

Not reported:

```markdown
## Why does it need a configuration file?

## Plugins, tools, etc.
```

`punctuation` is a string of the characters to report. The default,
`.,;:!。，；：！`, is markdownlint's: it leaves out `?`, with which the
questions of an FAQ end. `""` reports nothing.

## Edge cases and advanced usage

**Details:** removing the character would change the heading's anchor, which
links may use, so the rule only reports. The text is read as its renderer shows
it. A character reference counts as the character it shows: `&copy;` is not
punctuation, and `&#46;` is a period. A closing `#` sequence, a comment, or a
footnote reference after the text does not count, and neither does a trailing
attribute block such as `{#setup}` in Forgejo, Gitea, and VitePress, which read
it as the heading's attributes, or a block identifier such as `^setup` in
Obsidian. With VitePress's [`attrs`](../../vitepress.md#renderer-options)
setting off, the block is text and counts. The text before such a suffix counts
even when it is formatted, as in `## **Use.** ^usage`.

**Not checked:** a heading that ends with code, math, an image, an autolink, or
an Obsidian embed, nor these endings:

- an emoji shortcode such as `:tada:`, whose colon closes the shortcode;
- an ellipsis of three or more periods;
- the period of an abbreviation: initials such as `e.g.`, `U.S.`, or `Ph.D.`,
  and `etc.`, `et al.`, `cf.`, `vs.`, `viz.`, `approx.`, `Inc.`, `Ltd.`, `Co.`,
  `Corp.`, `Jr.`, and `Sr.`, in any case. Use a [suppression
  comment](../../configuration.md#suppression-comments) for another
  abbreviation.
