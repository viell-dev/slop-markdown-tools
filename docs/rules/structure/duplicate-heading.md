# `structure/duplicate-heading`

Reports a heading with the same text as an earlier heading under the same parent
heading. Two "Setup" sections side by side make a table of contents ambiguous,
and a link to `#setup` reaches only the first.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`siblingsOnly`.

Reported:

```markdown
# Install

## Setup

## Setup
```

Not reported:

```markdown
# Linux

## Setup

# Windows

## Setup
```

`siblingsOnly` defaults to `true`. Set it to `false` to report repeated heading
text throughout each outline, regardless of parent or level.

## Edge cases and advanced usage

**Details:** headings are compared by their text as the reader sees it:
formatting does not count, case does. As for `structure/heading-increment`, the
headings of a block quote or a footnote are checked among themselves, also with
`siblingsOnly: false`.

**Not checked:** the same heading under different parents, as in a guide with a
section per platform, unless `siblingsOnly` is `false`.
