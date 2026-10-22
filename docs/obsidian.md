# Obsidian vaults

The `obsidian` dialect reads wikilinks, embeds, callouts, highlights, comments,
and heading and block references, and checks links the way Obsidian resolves
them.

## Configure the vault

Create `mdtools.config.jsonc` at the vault's root, next to `.obsidian/`:

```jsonc
{
  "extends": ["recommended", "obsidian"],
  "ignore": ["Templates/**"],
}
```

Run the commands from the vault's root, or pass it with `--root`, so that links
are resolved across the whole vault:

```sh
npx mdtools lint --root "/path/to/vault"
npx mdtools format --root "/path/to/vault" --diff
```

Without a configuration file, the notes are still read in the Obsidian dialect,
because the vault is recognized by its `.obsidian` directory; see [the assumed
dialect](dialects.md#the-assumed-dialect). The rules of the `obsidian` preset,
among them the report that wrapping is off, still need the configuration.

## Enable wrapping

Obsidian shows a single line break inside a paragraph as a line break unless the
vault's "Strict line breaks" setting is on. `style/wrap` therefore wraps notes
only when the vault's `.obsidian/app.json` contains `"strictLineBreaks": true`,
and [`obsidian/strict-line-breaks`](rules.md#obsidianstrict-line-breaks) reports
when it does not. The tool reads the file and never changes it; when you change
the setting, keep the file's other settings. If the file cannot be read or is
not valid JSON, the tool warns and leaves paragraphs as written; a byte order
mark at its start is ignored. If strict line breaks do not suit your vault,
disable `style/wrap`; the other rules still run.

The tool reads highlights (`==text==`) and wikilinks within one line. A
paragraph with `==`, `[[`, or `]]` outside them, such as a highlight written
across two lines, is left as written, because joining its lines could create a
highlight or a link.

In a callout, the title line stays as written, with its folding marker, and the
body is wrapped inside the quote, also directly below the title. A body
paragraph is left as written in the cases that
[`style/wrap`](rules.md#stylewrap) lists, and so is a body whose quote markers
are not consistent, or inline syntax that runs from the title into the body. A
title that is too long is reported by `reportUnbreakable`.

## Where Obsidian reads Markdown its own way

Obsidian's Reading view and Live Preview read some Markdown otherwise than
CommonMark, and otherwise than each other. Where formatting would change what a
note shows there, the tool keeps the text as written:

- A note whose first `---` has no closing line of `---` alone. Live Preview
  reads the entire note as YAML source, where Reading view reads Markdown or
  closes the front matter at a malformed `--- text` line. No rule changes such a
  note, including its opening fence or its final line break. A `+++` fence does
  not have this protection, and `---` alone is still a thematic break.
- An inline HTML comment that starts in a paragraph, heading, or table cell but
  ends in another block, as in `# Title <!-- comment`, a blank line, and
  `> More --> text` below it. Live Preview carries comment styling across the
  blocks and restores quote or list styling only after the closer's line, where
  Reading view reads the blocks as Markdown. No rule changes the whole opening
  block or the blocks through the closing block, or through the note's end
  without a closer. A heading's underline and the whole table stay too. Later
  blocks still format. An opener in emphasis, a highlight, or a link or image's
  text counts too; an escaped opener or one inside a code span does not.
- A paragraph, heading, or table cell with a backtick that no run of backticks
  closes, such as ``a ` b``, also in a highlight, an inline comment, or the text
  of a link or image. Live Preview shows the text after it as code, at least to
  the end of its line, and Reading view pairs a run of two or more backticks
  with a later, shorter run. No rule changes such a block. A backtick in math or
  a wikilink does not count.
- The blocks below a run of three or more backticks that nothing closes. Live
  Preview shows them as code too, across blank lines and out of a list item, up
  to a run of the same length outside an indented code block, a fenced code
  block, or a list item. No rule changes them, nor a table that holds such a
  run.
- A paragraph with a later line that starts a list item in Obsidian, where
  CommonMark reads more of the paragraph: Live Preview starts a list at a number
  other than 1 with text after it, as in `3. Step`, except in a block quote, and
  Reading view at an empty item, `*`, `+`, `- `, or `1.`, as in `Text` and `- `
  below it, which the parser reads as a heading. No rule changes such a
  paragraph, nor the blocks below it that start further right than the marker,
  which Live Preview reads inside the item, or the block after those.
- A line of blank space that holds a tab at or right of the column where a
  paragraph's text starts, which Reading view reads as more of the paragraph,
  and the block below such lines, up to an empty line. A paragraph, a table, an
  underlined heading, an indented code block, a link reference or footnote
  definition, or a numbered list that does not start at 1 there is more of the
  text, as in `Text`, a tab, and `Name | Value` with `--- | ---` below it, which
  Reading view shows as text; a `#` heading, a bullet list, a block quote, a
  fenced code or math block, a thematic break, or an HTML block such as `<div>`
  starts a block of its own. No rule empties the line or changes those blocks. A
  tab left of the text's column, as in `- Item` and a tab alone below it, is a
  blank line.
- A line of blank space directly below an HTML block such as `<div>…</div>`,
  which continues the block. The blocks below such a line are more of the HTML
  block too, up to an empty line, and Reading view shows them as written. No
  rule empties the line or changes those blocks. A comment, and the other HTML
  blocks that end at their own end marker, such as `<pre>`, do not continue.
- An underlined heading whose underline one of the views reads as text: Reading
  view one with blank space after it, as in `Title` and `== ` below it, or
  before it beyond the heading's text, and Live Preview a lone `-`, or the
  underline of a heading whose one line of text starts at the first column with
  `[`, a label, and `]:`, as in `[ref]: see the page` and `===` below it, which
  it styles as a link reference definition. No rule writes such a heading with
  `#` or changes its underline.
- A paragraph in a block quote or list item with a lazy line of `=` or `-`, as
  in `> Text` and `=` below it, which Reading view reads as a heading's
  underline where CommonMark reads more of the text. No rule joins that line to
  the text or changes it.
- A paragraph of a list item with a lazy line, one that starts left of the
  item's text, as in `- Text` and `more` below it, and the blocks after it in
  the item. Live Preview reads those blocks outside the list, where an indented
  paragraph is code. No rule changes the paragraph or those blocks.
- A footnote definition directly below a line of paragraph text, also one that
  ends a list item or block quote, as in `Text` and `[^1]: Note` below it.
  Reading view reads the definition as more of the paragraph, and its indented
  lines as code. No rule changes the definition or the end of the line above it.
- The blank space at the end of a footnote definition's last line, where a
  paragraph ends the definition, as in `[^1]: Note ` with a space after the
  text. Reading view shows it before the footnote's backreference, `↩︎`, where
  CommonMark drops it. No rule removes it; `style/wrap` reflows the text before
  it.
- A line directly below a link reference definition that starts further right
  than the definition, as in `[ref]: https://example.com` and `    Text` below
  it. Reading view reads it as an indented code block from four columns right of
  the container's content. No rule changes the paragraph or heading that it
  starts.
- A paragraph line that starts at the first column with `[`, a label, and `]:`,
  as in `Text` and `[ref]: https://example.com` below it, whatever follows the
  colon. Live Preview styles it as a link reference definition, and the lines
  above and below it as text, where CommonMark reads more of the paragraph,
  because a definition cannot interrupt one; it styles `[ref]: a b`, which is no
  definition, the same way, also as the first line of a paragraph, as in
  `[Note]: see the page for details`. No rule changes such a line or joins it to
  the line above or below it, so `style/wrap` neither breaks it nor reflows the
  paragraph around it. Nor does it start a line at the first column with such a
  word: the word that opens the label, also one with blank space in it, stays on
  the line before it, and a paragraph whose first line would start so once
  reflowed stays as written. A line indented by a space or after `>` is text in
  Live Preview too.
- A tag directly after a block quote's `>` written without a space, as in `>a`
  and `>#tag b` below it. Live Preview reads a tag after blank space or at the
  start of a line's content, and text there, where Reading view reads the tag.
  `style/wrap` starts no line of such a quote with a tag: it stays on the line
  before it. When an existing continuation line starts with tag-like text
  directly after `>`, its paragraph stays as written: joining it to the line
  above would create a tag in Live Preview. A tag-like word on the paragraph's
  first line stays after the same marker, so that paragraph can reflow.
- A fenced code block that a list item or block quote ends before its closing
  fence, as in `` - ``` `` and `Text` below it. Obsidian reads the lines below
  as more of the code: Reading view those directly below the list or quote, Live
  Preview everything up to a line that would close the fence, and the fences
  after that otherwise than CommonMark. No rule changes the code block or
  anything below it.
- A fenced code block without its closing fence that runs to the end of the
  note, outside a list item or block quote, as in ```` ``` ```` and `code` below
  it with no line break after it. Reading view shows a line break at the end of
  the note as one more, empty line of the code, where CommonMark shows the same
  code either way. `style/final-newline` adds none there.
- An HTML block directly below a list, as in `- Item` and `<div>…</div>` below
  it, which Reading view keeps inside the list's last item, where CommonMark
  ends the list; a comment or a `<pre>` block counts too, and a block quote or
  footnote definition keeps no block. The list goes on there: the blocks below
  the HTML block that start at or right of the item's text are inside the item,
  and a list of the same kind, bullet or numbered, continues it with every item
  whose marker matches, as does a list nested in the item. No rule puts a blank
  line between the list and the HTML block. Blocks read inside the item keep
  their indentation and list markers. Where a following block could continue the
  item or list, the list's markers and spacing stay, including those of lists
  nested in its last item and the following list's markers.
- A table that Obsidian reads otherwise. Obsidian reads a table directly below a
  line of paragraph text as more of the text, a one-column table whose header
  line does not end with a pipe, as in `Name` and `--:` below it, as text, and a
  line without a pipe as the end of a table, where CommonMark's tables read a
  row. Reading view reads a line with a pipe above a delimiter row that starts
  with `- `, as in `Name | Value` and `- | -` below it, as a table, where
  CommonMark reads a paragraph and a list. No rule changes such a table, those
  rows, or that line and list.

These protections also apply to the reading of TOML front matter (`+++`) as
paragraph text: a table or footnote definition directly below its closing fence
is more of that text in Obsidian, so it stays as written. A separating blank
line or a block that interrupts a paragraph still starts a block of its own.

### Unreleased boundary protections

The following additions are on the development branch and are not yet in the
latest installable release:

- A table keeps the source from a body row that changes its header's
  leading-pipe convention, or has only its leading pipe. Both views can end the
  table there while the primary parser keeps another row. Adding border pipes
  could otherwise absorb a paragraph or split a wiki alias or link destination
  across cells. Consistent table rows and text after a real blank still format.
- Open root HTML keeps later source until Live Preview's tag depth closes,
  including when a nested tag remains after the parent's closer. Parsed fences
  do not end that raw state. Formatting conservatively retains the source there,
  including punctuation preferences; balanced HTML and explicit recovery still
  allow later Markdown to format.
- A leading inline comment stays with the next wrapping atom so that it cannot
  become a standalone comment block. Later words still wrap normally.
- A table immediately below a paragraph-consumed footnote keeps its literal rows
  even when the definition's final parsed block is HTML, a heading, or code.
  This context continues through adjacent definitions while no definite
  paragraph break separates their contents. A tab-containing blank line does not
  establish a safe end to that context; an empty or space-only line does. A
  definition below a heading or a definite paragraph break remains independent.
- A thematic break directly below a table keeps a marker that does not turn the
  last table line into a heading in Live Preview. Where an existing compact
  hyphen break already displays that line as a heading, its literal text and
  underline stay, including the delimiter of a header-only table. A blank line
  between the table and break still permits ordinary table and marker
  formatting.
- An underlined heading displayed after lazy list or quote text keeps its final
  physical heading line, the preceding boundary, and its underline. Wrapping or
  inserting a blank there can remove the heading in either Obsidian view. An
  earlier lazy line that determines that reading keeps its boundary and margin
  too. List padding and number width can shrink only when that dependency stays
  lazy. Safe inline edits above the heading remain eligible.
- Lists following a closing-tag HTML block keep their source when Live Preview
  reads a marker inside that block as their parent. List indentation also stays
  when an HTML comment below the list closes after a marker, including when its
  closer is on a subsequent line or the marker has no following text. An
  unindented paragraph directly below a heading in the last list item keeps its
  boundaries: Reading view still nests it in that item. An immediately following
  list keeps its separator and both participating lists keep their markers and
  indentation, because changing them can alter list tightness or merge runs.
  Safe inline formatting in the following list still applies.
- Top-level HTML continued across whitespace-only lines keeps literal quote
  markers and the source below them until a physically empty line, including
  empty quotes. Bare `>` or `>>` lines within that raw source do not end Reading
  view's HTML block. HTML inside a quote still follows that quote's own
  boundaries. Empty list markers between that HTML and a fence also remain raw
  source. If an empty line inside the fence makes its closer open code in
  Reading view, the remaining note stays as written.
- A fence immediately after a task checkbox, including a custom status such as
  `[-]`, keeps the remaining source as written. Live Preview opens code there,
  while the parser reads paragraph text, so subsequent fences can pair
  differently throughout the note. A fence inside HTML after carried inline code
  keeps the remaining source for the same reason, even though the primary parse
  has no code block there.
- A fence whose opener is still part of whitespace-continued HTML keeps the
  remaining source when an empty line in its body makes its closer open a
  Reading-view code block instead. Later fence pairings then disagree.
- Task items with no text after their checkbox on its source line keep the
  separator and paragraph, including ordered lists, quotes, custom statuses, and
  text continued on the next line. Removing that separator can turn the checkbox
  into literal bracket text.
- Inline code carried from a preceding block into a quoted list protects its
  quote and list markers too, including nested items when the code starts
  outside the quote. Existing protection for items opening a quote remains.
  Unquoted lines indented four columns or more inside a quoted paragraph or list
  keep their source: Reading view reads them as code, where the primary parser
  keeps paragraph text. An unmatched emphasis opener immediately before a block
  quote preserves the opening paragraph and the quote, because Live Preview can
  carry that style into its literal list markers. A blank line resets that
  emphasis state.
- Lists and quotes that start on continuation lines in footnote definitions keep
  their layout. Continuation paragraphs with text indented other than four
  columns past the definition also keep their layout because joining them can
  move normal text into footnote styling. Paragraphs at that four-column margin
  still wrap, and trailing space after a list can go. Lines of spaces below a
  link reference or footnote definition stay, including after empty lines,
  because emptying them can change Live Preview's code styling. An ordered list
  not starting at 1 directly below a footnote stays beside it: Reading view
  keeps that line in the footnote rather than starting a visible list. A non-one
  ordered list directly below a block quote also keeps its boundary: Reading
  view retains it inside that quote, including below a quoted heading.
  Participating ordered lists keep their markers and indentation, including
  lists followed by nested quotes that the primary parser places beside them:
  changing only a delimiter can join or split the rendered lists. Safe inline
  changes there still apply.
- An ordered list directly below a callout title stays together even when its
  first number is not 1. Its source markers keep a consistent delimiter.
- Tables below setext text that Reading view keeps as a paragraph stay as text.
  Pipe-containing table rows that the parser reads as headings, lists, quotes,
  or fences keep their source and preceding boundary: inserting a blank line
  would end Reading view's table. Headers or alignment rows without leading
  pipes can start another table or end Reading view's table inside the primary
  parse's table. Their source stays too: adding leading pipes would merge those
  regions. Text continued across a tab separator also keeps immediately
  following ordered continuations and setext boundaries as written. A non-one
  ordered list immediately after an unpiped table row keeps its source and
  separating break: Reading view retains that row and its numbered continuations
  as paragraph text.

Independent blocks outside these regions still format. These protections are
specific to the Obsidian dialect.

## Vaults inside a larger workspace

A note belongs to the nearest vault at or above its directory, wherever the
workspace root is, and its dialect and its line-break setting come from that
vault. A vault in a directory of a repository, such as `docs/vault/`, is read in
the Obsidian dialect while the documents around it are read as GitHub Markdown.
Each vault in a workspace follows its own `.obsidian/app.json`. A repository
inside a vault is not part of the vault.

Links follow the vault too. In a vault below the workspace root, a link reaches
only the vault's files, as in Obsidian: a path counts from the vault's root, a
search by note name looks only inside the vault, and `links/path` writes
`"style": "root"` paths from the vault's root. A path that leaves the vault for
a file that exists, such as `[the project](../../README.md)`, is reported as
`Local target is outside the vault`, because Obsidian cannot follow it.
Documents outside the vault link into it as into any other directory.

## A workspace root inside a vault

When the workspace root is a directory inside a vault, through `--root` or a
configuration file there, the tool finds the vault above it but reads nothing
outside the root. Where the rest of the vault could matter, a link is uncertain:

- A link with no match below the root is reported as
  `Local target could not be checked`, because the workspace root is only part
  of the vault. It is not called missing.
- A link found by note name, or by a path that Obsidian would look for at the
  vault's root first, is accepted but never rewritten by `links/path` or
  `links/notation`: a note outside the root could be the one Obsidian chooses.
- A link written as an explicit relative path (`./Sub/Note.md`), or as a
  vault-relative path that leads into the root, is certain and is rewritten as
  usual; `"style": "root"` writes it from the vault's root.

For complete link checks and rewriting, use the vault's root as the workspace
root.

## Choose link policies

The `recommended` preset checks links. To also write verified Markdown links as
vault-relative paths in angle brackets, such as `[Note](<Folder/Note.md>)`:

```jsonc
{
  "extends": ["recommended", "obsidian"],
  "rules": {
    "links/path": ["warn", { "style": "root", "brackets": "angle" }],
  },
}
```

Note names and headings match without regard to case, as in Obsidian, and block
identifiers match exactly; notes whose paths differ only by case are ambiguous.
A heading also matches as its source writes it, and `[[Note#Setup#Mobile]]`
reaches a heading below another; a wikilink never names a folder. A missing or
ambiguous target is never guessed. Wikilinks without a label keep their target
as written, because it is their visible text, and embeds stay embeds, with any
image size in their label. [`links/path`](rules.md#linkspath) and
[`links/notation`](rules.md#linksnotation) describe the options.

## Review the result

Preview with `--diff` before `--write`, and look at complex notes in Obsidian
afterwards, especially with community plugins whose syntax the tool does not
know. The link resolver does not reproduce every behavior of Obsidian's, and
syntax it does not know may need an `ignore` pattern or a [suppression
comment](configuration.md#suppression-comments). The [vault
example](examples.md#format-an-obsidian-vault) shows a small vault before and
after formatting, and [limits](design.md#limits) lists what is not modeled.
