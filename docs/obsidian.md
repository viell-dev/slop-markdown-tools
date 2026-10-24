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

### Unreleased: visible boundary refusals

The next 0.4.x release applies one conservative policy before the existing
renderer-specific protections. Structural rules keep an adjacent paragraph and
list, block quote, HTML block, table, fence, or definition together when there
is no blank line between them. They also keep lazy continuation margins, a Tab
after a container marker, and non-one ordered markers directly below text.
Properly indented nested blocks and a callout's explicit title/body boundary
remain eligible. Ordinary ATX headings beside paragraphs still get spacing.

When a proposed style edit is held by this policy or an existing native
protection, `lint` and `format` report
`Left as written to preserve Obsidian rendering` under the original rule ID and
its configured severity, without an edit. Suppression comments still apply. A
held warning counts toward `--max-warnings`; set the rule to `error` to make it
fail the check directly. Safe independent edits still apply. This does not
create findings where a rule does not propose an edit, and it does not guarantee
every unusual source form renders identically in both Obsidian views.

### Existing protections

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

- Lists connected through an adjacent quote, table or display formula keep both
  original marker and indentation units. Their adjacent separating boundary
  stays too: adding a blank can make a native list loose even when the markers
  match. This applies to ordered and bullet lists; safe inline formatting
  remains available outside existing whole-list protections for lazy
  continuations. A real blank before the quote or an intervening block ends this
  relationship. A structural indentation edit crossing a protected separator
  conservatively keeps its whole unit; independent inline changes remain
  available.
- A Setext title that Reading view continues as paragraph text retains an
  immediately following title, including across a Tab-only continuation. Literal
  `#5` title text is handled as Setext. A proper hyphen thematic break ends this
  paragraph state, so later independent headings can still convert.
- A physical list-item backtick or tilde fence hidden inside a primary paragraph
  keeps that paragraph and the remaining source through end of file. This
  includes blank gaps, paired multiline spans and earlier backtick runs that
  hide the opener from the primary inline parse. Later text conservatively stays
  unformatted because the views can pair later fences differently; earlier
  independent text still formats. Ordinary inline backticks, escaped list
  markers and backticks in fence info keep their previous behavior.
- Display math immediately below a list keeps its separating boundary. Reading
  view keeps the formula inside the final item even after a heading or code
  block, and inserting a blank would move it outside. The separator before an
  adjacent table also stays when the final item ends with a heading or code.
  Independent inline and marker formatting remains available; genuinely
  separated math stays separate.
- Table rows immediately after a list item's closing code fence, including a
  fence in its final nested list, keep their literal source, which Live Preview
  displays as text. A preceding heading, indented code, a root fence or a
  separating blank still permits table padding.
- A standalone one-line `$$…$$` formula keeps its physical line and adjacent
  separators when the primary parser reads inline math. Joining it into prose
  would turn Live Preview's display widget into inline math. Safe independent
  inline changes remain available, and math already beside prose still wraps.
- Plugin edits cannot insert a blank at a protected separator or before its
  existing trailing spaces, including by copying source into a replacement or
  writing a quoted blank line. Safe inline replacements and ordinary spacing
  before a protected whole line remain available. Removing a quote-only marker
  is also rejected when it would create a real blank at that separator.
- A list whose HTML continues outside its parsed item keeps its markers when
  that HTML already protects a later list's marker. Changing only the earlier
  bullet could split one Reading-view list into two. When the HTML closes before
  the later marker, both lists can still format normally.
- A list's final paragraph stays adjacent to a tilde opener whose info contains
  a written backtick. Live Preview keeps that source in the paragraph, so a new
  blank would split its continuation. Marker preferences, indentation and safe
  earlier wrapping remain available. When the primary closing fence instead
  opens Live Preview code, its source and the rest of the document stay as
  written. This conservatively retains later fence pairings too.
- A one-column table keeps its source unless its header and delimiter both have
  leading and trailing pipes, as Live Preview needs those borders for a table
  widget. Reading view also accepts matching trailing-only borders. Missing
  final pipes or mismatched leading borders keep Reading paragraph state across
  a Tab-only continuation, so later literal rows retain their source. A real
  Reading table, an empty or space-only blank, or an interrupting heading still
  allows subsequent table formatting.
- An image description containing backticks stays split across its existing
  lines, where joining could turn displayed Live Preview source into an embed.
  Safe inline formatting before and after it remains available.
- A code span with one or two backticks that crosses a physical newline keeps
  its source and the rest of its inline block. Live Preview ends short code at
  that newline, so the written closer can start code over later text. Earlier
  independent inline markup and later independent paragraphs still format.
  Wrapping leaves the paragraph holding that span unreflowed. Outside a misread
  list fence, a paired multiline span with three or more backticks keeps its
  ordinary formatting behavior. Short spans in an inline comment or image
  description conservatively keep the whole inline block.
- A lazy paragraph line also keeps later blocks in an enclosing list item when
  it crosses that item's content margin. Joining or indenting the line would
  otherwise change their nesting in Live Preview. Properly indented
  continuations and terminal lazy paragraphs still format.
- Before a Tab-only paragraph continuation, wrapping and trailing-space cleanup
  retain the preceding separator when it marks a hard break or keeps a backslash
  literal. Earlier text can still wrap. Quoted margins are handled
  conservatively, retaining a possibly removable separator.
- An uncertain Setext underline that Reading view keeps in a paragraph also
  retains its preceding separator when removing it would create or remove a hard
  break. Earlier inline text still formats. An underline treated as text only by
  Live Preview does not need this extra separator protection.
- A Setext title ending in a raw `#` run after whitespace keeps its heading
  form. Escaping that run during ATX conversion can reveal hashes in Live
  Preview. Inline title styles remain available; tight, already escaped,
  code-span and nonterminal hashes still allow heading preferences.
- A list at document level that ends in a nested list, followed by a quoted list
  opening with exactly two spaces after `>`, keeps both indentation units under
  `style/list-indent`. Blank lines alone do not reset this relationship.
  Numbering also retains the existing digit width; same-width numbers,
  delimiters and inline styles remain editable. An intervening block restores
  ordinary indentation preferences.
- A quoted block opened by a Tab directly after `>`, or after `>` and one space,
  keeps its physical source and same-block continuations. Reading view can read
  code where the primary parser reads a list, heading or paragraph. Quoted blank
  rows between consecutive such blocks stay too: Reading view keeps them inside
  one code block. Later independent blocks, space-only margins, and two spaces
  before the Tab still allow formatting.
- A Setext title line beginning directly with math, or a title containing only
  an image/embed, keeps its whole source. Converting it to ATX can change the
  math widget's inherited font or move a standalone image into the heading. The
  inverse conversion keeps those ATX forms too. Mixed text before math, wrapped
  math, and images beside ordinary title text still allow heading preferences;
  independent blocks below the heading still get their spacing and formatting.
- A Tab followed by two or more final spaces keeps its hard break while the text
  continues, even when the primary Markdown parser reads a soft line ending.
  Ordinary trailing whitespace can still be cleaned where it has no rendered
  meaning.
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
- `style/block-spacing` keeps the boundary after a standalone `%%` comment. A
  new blank can split a native paragraph, including before text the parser reads
  as a Setext heading. Directly adjacent titles retain their underline, since
  conversion can change Reading view. Existing blanks and following inline style
  edits remain available.
- A possible comment whose leading `%%` and first closer cross a blank line
  stays unreflowed. Moving text after the closer could otherwise turn literal
  paragraphs into a comment block. This also applies at widths where the old
  wrapping would have left text after the closer.
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
- After 0.4.0, a list directly after another list's final secondary paragraph or
  indented code block keeps its separator: a new blank splits text that Live
  Preview groups together. Numbering, markers and inline styles remain eligible.
  A sole first paragraph, final heading, closed fence or existing blank still
  permits independent block spacing.
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
