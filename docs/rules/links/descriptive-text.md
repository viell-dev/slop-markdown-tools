# `links/descriptive-text`

Reports a link whose whole text is a phrase that does not say where the link
leads, such as "here" or "click here". Screen reader users often move through a
page by its list of links, which reads each link by its text alone, and readers
who scan a page see a link's text before the sentence around it.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`prohibitedTexts`.

Reported:

```markdown
To install the tool, follow the steps [here](install.md).
```

Not reported:

```markdown
Follow the [installation steps](install.md).
```

`prohibitedTexts` is an array of the phrases to report, default
`["click here", "here", "link", "more"]`. They are compared as link text is
(below), in any script, and each needs at least one letter or digit; `[]`
reports nothing. Add the phrases of the languages your documents are written in,
such as `"hier"` or `"weiterlesen"`.

## Edge cases and advanced usage

**Details:** text that names the destination or purpose, such as "the
installation guide", serves both kinds of reader. The whole text is compared,
without case, blank space, punctuation, or symbols, so `[Click here!]` is
`click here`. A text that says more, such as `[Read more about pricing]`, is not
reported. Inline and reference links are checked, and in Obsidian the text that
a wikilink shows: its alias, or else its target. An image's alternative text is
the text of a link around it.

**Not checked:** autolinks, which show their destination, embeds, and HTML `<a>`
elements. A link's title does not make its text descriptive: the title is the
link's description, not its name, so screen readers do not list links by it, and
other readers see it only when a mouse hovers over the link.
