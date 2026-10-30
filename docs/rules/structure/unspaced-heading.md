# `structure/unspaced-heading`

Reports text that would be a `#` heading with a space after its hashes, such as
`#Installation` or `##Usage##`. Every supported renderer needs blank space after
the opening hashes, so it shows the line as paragraph text with its `#`.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
#Installation

##Usage##
```

Not reported:

```markdown
# Installation

#123 fixed the crash.
```

## Edge cases and advanced usage

**Details:** adding the space turns text into a heading, which changes the
outline and may not be what was meant, so the rule only reports. One to six `#`
start the line, followed by a letter or a digit, also after a `*`, `_`, or
backtick that opens emphasis or code. A line that ends with a run of `#` gets
the advice to add spaces inside the hashes too. Only the first line of a
paragraph is checked, after its container's markers, as in `> #Note` or
`- #Item`, and, outside CommonMark, the line below an alert's or callout's
marker, which starts its body. A paragraph's later lines are not checked,
because wrapped text can start a line with any word.

**Not checked:** text that only resembles a heading:

- a single `#` before a number, as in an issue reference such as `#123 fixed`;
- another character after the hashes, as in a shebang (`#!/bin/sh`) or
  `#[attribute]`;
- seven or more hashes, and an escaped `\#`;
- a heading whose closing hashes follow its text without a space, such as
  `# C#`, which is a heading whose text ends with `#`.

## Dialect notes

**In Obsidian:** `#` and a word is a tag, as in `#project text`, and is not
reported.
