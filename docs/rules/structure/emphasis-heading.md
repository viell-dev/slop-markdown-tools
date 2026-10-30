# `structure/emphasis-heading`

Reports a paragraph that consists only of emphasized or strong text, such as
`**Installation**`, which reads as a heading but is not one: the outline and a
table of contents leave it out, links cannot reach it by an anchor, and screen
readers do not announce it as a heading. If it names a section, make it a
heading.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`punctuation`.

Reported:

```markdown
**Installation**

Run the installer.
```

Not reported:

```markdown
## Installation

Run the installer.

**Close other programs first.**
```

`punctuation` is a string of characters: text that ends with one of them is a
sentence, and is not reported. The default, `.,;:!?。，；：！？`, is
markdownlint's; with `""`, such text is reported whatever it ends with.

## Edge cases and advanced usage

**Details:** making the paragraph a heading changes the outline, so the rule
only reports. Only the document's own paragraphs are checked, whatever their
length and however their lines wrap. The emphasis may hold text, code, math,
strikethrough, Obsidian highlights, and further emphasis. HTML tags and comments
beside it do not count, nor does an Obsidian block identifier such as `^setup`
after it.

**Not checked:**

- Emphasized text in a list item, block quote, callout, alert, VitePress
  container such as `::: tip`, table cell, or footnote, where it labels the
  content beside it.
- A paragraph with a link, an image, or a line break inside the emphasis, or
  other text beside it.
