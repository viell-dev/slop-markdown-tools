# `style/block-spacing`

Separates every heading, list, fenced code block, and table from the blocks
before and after it with a blank line, in the document and in block quotes at
any depth. Options can ask for more blank lines around headings.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `linesAbove`, `linesBelow`, `includeFrontMatter`.

Before:

```markdown
# Setup
Install the package.
- Run the command.
```

After:

```markdown
# Setup

Install the package.

- Run the command.
```

Before:

````markdown
Run it with:
```sh
npx mdrefine format
```
| Option  | Default |
| ------- | ------- |
| `width` | `80`    |
> It reads the configuration file.
````

After:

````markdown
Run it with:

```sh
npx mdrefine format
```

| Option  | Default |
| ------- | ------- |
| `width` | `80`    |

> It reads the configuration file.
````

To keep compact spacing, set `"rules": { "style/block-spacing": "off" }`.

| Option               | Values                                               | Default |
| -------------------- | ---------------------------------------------------- | ------- |
| `linesAbove`         | An integer of at least -1, or an array of one to six | `1`     |
| `linesBelow`         | An integer of at least -1, or an array of one to six | `1`     |
| `includeFrontMatter` | `true` or `false`                                    | `false` |

- `linesAbove` and `linesBelow`: how many blank lines a heading needs above and
  below it, as markdownlint's MD022 `lines_above` and `lines_below` set. A
  number applies to every level; an array gives the counts for levels 1 to 6 in
  order, and a level that it leaves out needs one. The counts are minimums: the
  rule adds the blank lines that are missing and keeps any more that are there,
  which [`style/blank-lines`](../style/blank-lines.md) limits. `0` and `-1` need
  none, so that only a list, a fenced code block, or a table next to such a
  heading still gets its own blank line. Between two headings, the larger count
  applies.
- `includeFrontMatter`: with `true`, a heading directly below YAML or TOML front
  matter gets its `linesAbove` blank lines too; other blocks there stay as
  written.

A configuration whose counts exceed the `maximum` of `style/blank-lines` is
refused when it is read, unless one of the two rules is off, so set both, as in:

```jsonc
{
  "rules": {
    "style/blank-lines": ["warn", { "maximum": 2 }],
    "style/block-spacing": ["warn", { "linesAbove": [2, 1] }],
  },
}
```

With these options, before:

```markdown
Read this first.
# Setup
Install the package.
## Usage
```

After:

```markdown
Read this first.


# Setup

Install the package.

## Usage
```

## Edge cases and advanced usage

**Details:** the rule adds the blank lines that are missing, one by default, and
keeps the blank lines that are already there; nothing is added at the start or
the end of a document. Inside a block quote, the new line holds the quote's `>`
markers. A fenced code block counts when it has its closing fence.

**More than one blank line:** the places left as written below stay so whatever
the counts, and a second blank line is added only where it keeps the document's
meaning. Below a list or a footnote definition in a block quote, the rule adds
at most one, because the parser counts the blank lines there toward the list and
reads it as loose when two or more follow. Existing blank lines are added to
only when they hold the same quote markers as the new ones.

**Tables:** a table is separated where every renderer reads the same blocks:
from text, a code block, a thematic break, or an HTML block directly above it,
and from a block quote, a fenced code block, a thematic break, or an HTML block
directly below it. GFM reads text directly below a table as another row of it,
and Forgejo and Gitea read an indented line there as one, so nothing is added
before a block that does not end a table in every renderer, such as indented
code, a footnote definition, or display math. Whether text directly above a
table is a paragraph of its own follows the dialect's parser: in CommonMark,
which has no tables, it is all one paragraph. A table whose header row is a
complete HTML tag alone on its line, as in `<b title="|">` above `|-|-|`, stays
directly below its text: after a blank line, that line would start an HTML
block. A header row written as a lazy line in a block quote, without the quote's
markers, gets no blank line above it, which would end the quote.

**Left as written:** places where a blank line would change what the document
means or what a comment applies to:

- Blocks inside a list item or a footnote definition. A blank line between the
  blocks of a list item makes the list loose, which changes how it renders.
- Front matter and the block below it, apart from a heading with
  `includeFrontMatter`.
- A boundary inside a block of the reading without TOML front matter, such as
  `1.` and `2) b` directly below its closing `+++` fence, where a blank line
  would make a list from text, or a block quote or list that continues below the
  fence there. A new line keeps such a quote only when it holds the quote's
  markers, and such a list only inside a block quote of its item, where a line
  of the quote's markers continues the item and keeps the list tight.
- A list that ends inside an HTML comment or another HTML block without its end
  marker, which would take the blank line in. The same goes for a list whose
  last item ends in a fenced code block without its closing fence: renderers put
  the blank line into the code, although the parser does not.
- A heading or list directly below an HTML comment or below a
  `mdrefine-disable-next-line` directive, which apply to the line below them.
- The line that opens a callout or alert, such as `> [!NOTE]`, and the block
  directly below it.
- Directly below text or a link reference definition: a heading underlined with
  `===` or `---`, which the parser can read differently there than below a blank
  line.
- Text that the parser reads where renderers read a list, such as `- 2. Step`
  directly below text: the list or quote that starts with it, the blocks
  indented below it, and a list after them, which renderers read as part of that
  list, and text on the line directly below the list item or quote that it ends,
  which renderers read as more of it (see [how it
  works](../../design.md#safety-model)).
- Directly below a table that ends in a list item or block quote: text whose
  second line is a table delimiter row. The parser reads a table there as text,
  where GitHub reads a table, and a blank line would make it a table for the
  parser too.
- In a block quote, below a list whose last item ends in an empty footnote
  definition, such as `> - [^1]:`. The parser would count the new line of `>` as
  part of the item and read the list as loose.
- A fenced code block without its closing fence, which is separated only from a
  heading or list.
- A table directly below a block quote, footnote definition, link reference
  definition, or display math, whose text a renderer can continue into the
  table's first line, and a table directly below text that starts with a link
  reference definition, as in `[a]: /b`, `Text`, and a table below them. GitHub
  shows that definition as text there, and a blank line above the table would
  hide it.

## Dialect notes

**On GitHub:** dollar display math and an underlined title directly below it
stay together. They can form one native heading or continue a list or quote
paragraph.

**On Forgejo and Gitea:** a table directly below the text of a definition
description, as in `Term`, `: Description`, and a table below them, stays there.
Those renderers put the table in the description.

**In VitePress:** the site generator reads front matter itself, so with
`includeFrontMatter` nothing is added directly against the closing line; blank
lines that are already there can be added to. Nothing is added inside a block of
VitePress's own reading either: a paragraph that it continues over a line that
the parser starts a block with, such as `<b>` or `[^b]: note` below a list item,
and a table, list, or unclosed code fence that it reads where the parser reads
something else. A line of quote markers inside a block quote that both readings
place in a list item, as between `- > a` and `  > # Heading`, is still added.

**In Obsidian:** existing blank lines are added to only when they are empty,
because Obsidian can read a line of blank space as text. A table is separated
only from a heading above it: Live Preview shows the rows of a table directly
below another block as text. These places are also left as written:

- After an underlined heading that a view reads as paragraph text, such as a
  multiline level-1 heading, one beginning with a reference-like line, or one
  whose underline has trailing space, extra indentation, or a lone `-`.
- Inside a block quote, whose heading and list markers Live Preview reads as
  literal inline text; between a list and the adjacent unindented quote that
  Reading view keeps in its last item; and between an empty list marker and the
  text directly below it, which Reading view takes into the item.
- Inside continued HTML source: Live Preview can carry raw state through later
  blocks until the open tags close or the document ends. An unclosed nested tag
  can keep that state after its parent's closer, including a URL or email
  written in angle brackets inside HTML. Reading view continues HTML across a
  whitespace-only line into the blocks below it until an empty line. In
  top-level HTML, bare quote markers remain literal source and do not provide
  that empty line. A parsed fence does not close Live Preview's open HTML state;
  formatting conservatively keeps that source until its tags close, including
  otherwise harmless punctuation preferences.
- The boundary after a standalone `%%` comment: adding a blank line can split a
  native paragraph even when the parser reads a separate heading. Inline style
  edits below the comment remain available.
- A list directly after a list's final secondary paragraph or indented code
  block: a new blank line splits Live Preview's paragraph. Markers, numbering,
  and inline styles remain eligible. A sole first paragraph, final heading,
  closed fence, or existing blank line permits ordinary spacing.
- A block identifier on a line of its own (`^id`) directly below a heading or
  list, which Obsidian may attach to the block above.
- A tilde fence whose info string holds a backtick, which Live Preview reads as
  text; it is separated only from a heading or list. A list ending in a
  paragraph also stays adjacent to such a parsed tilde opener, which Live
  Preview reads as paragraph continuation. List markers, padding, and safe
  earlier reflow remain eligible; an existing blank line and ordinary info
  strings keep their usual spacing. When its parsed closer opens Live Preview
  code, the opener and the rest of the document stay as written, conservatively
  keeping later fence pairings too.
- Both separators when a quote, table, or display formula connects list items.
  Display math directly below the final item stays inside it, including after a
  heading or code block; a table after those blocks also stays adjacent. See the
  [boundary protections](../../obsidian.md#boundary-protections).
- Text directly above or below a fenced code block, which its views can read
  together, and a line below a table that one of its views reads as part of the
  table. The [boundary policy](../../obsidian.md#visible-boundary-refusals)
  reports these places without changing them.
