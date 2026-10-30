# `style/blank-lines`

Collapses blank lines in a row to at most `maximum` of them, and removes blank
lines at the start and at the end of a document.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `maximum`.

Before, with three blank lines between the blocks and two at the end:

```markdown
# Setup



Install the package.


```

After:

```markdown
# Setup

Install the package.
```

`maximum` is an integer of at least 1; the default is 1.

## Edge cases and advanced usage

**Details:** the line break that ends the last line stays. Inside a block quote,
a line of only `>` markers is a blank line, and repeated ones are removed the
same way.

**Left as written:** blank lines that are content, or whose number changes what
the document means:

- Inside code blocks, HTML blocks, math blocks, front matter, and Obsidian
  comments, also in one that runs to the end of the document without its closing
  fence or marker.
- At the start of a document, when the line below them is `---` or `+++`, which
  would then open front matter.
- Next to a blank line with other block quote markers or indentation, such as
  `>` next to an empty line, which belong to different block quotes.
- In a block quote, below the last block of a list, list item, or footnote that
  the parser counts them toward: there it reads a list as loose when two or more
  follow and as tight when one does.

## Dialect notes

**In Obsidian:** a line of blank space that holds a tab, or that lies directly
below an HTML block, is not blank: Obsidian's Reading view reads it as more of
the paragraph or block above it. Blank quote rows between consecutive blocks
opened by a Tab directly after `>` or `> ` stay too: Reading view reads those
blocks and their blank rows as one literal code block. A later ordinary quoted
paragraph still permits blank-line cleanup and inline preferences.

## Related rules

- [`style/final-newline`](../style/final-newline.md) adds the line break at the
  end where it is missing.
- A configuration whose [`style/block-spacing`](../style/block-spacing.md) asks
  for more blank lines around a heading than `maximum` allows is refused when it
  is read, unless one of the two rules is off: each rule would undo the other's
  edits.
