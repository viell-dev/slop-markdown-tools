# How it works and its limits

## Safety model

Formatting does not print a document again from its syntax tree. Each style rule
proposes edits at positions in the original source, and everything outside those
edits stays byte for byte as it was. A rule that is turned off therefore leaves
its constructs as they were written, and syntax that the tool does not
understand survives unchanged.

The edits are applied in three phases, inline, block, and document, so that
edits that commonly overlap do not meet in one pass. After each phase that
changes the document, the tool parses the result again and compares its meaning
with the original: the syntax tree with the whitespace of prose normalized and
each link compared by the file it resolves to. When the meaning differs, the
phase tries the edits one rule at a time and leaves out the edits of each rule
that would change it, all of them, because one edit can depend on another; the
other rules' edits are kept. Each rule left out gets an `engine/unsafe-format`
error at the line where the meaning would first differ, as in
`style/wrap would change the parsed meaning at line 12; none of its edits were applied.`
Of two edits that overlap, the one that starts first is applied, and the other
rule runs again in the next pass. The phases repeat until nothing changes, for
at most eight passes. When rules undo each other or formatting does not settle,
`format` returns the document as it was with an `engine/unsafe-format` error
that names them. Either way the run ends with exit code `2`, and
`format --write` still writes the other documents, and this one when the edits
that were kept changed it.

The comparison is only as good as the parser's reading:

- It compares syntax trees, and does not run GitHub's, Forgejo's, Gitea's, or
  Obsidian's renderer. To find documents that renderers read otherwise than the
  parser, the tests format generated documents and CommonMark's examples and
  compare the HTML of commonmark.js and markdown-it before and after, a weekly
  workflow does the same with GitHub's renderer, and a check started by hand
  compares Obsidian's Live Preview and Reading view, with Obsidian running in
  Docker. Each difference found is tracked as an issue.
- It reads the document in its dialect, so it cannot notice that the dialect is
  wrong. In CommonMark a table is an ordinary paragraph, and joining its lines
  changes nothing that CommonMark sees. This is why the tool [assumes a
  dialect](dialects.md#the-assumed-dialect) with more syntax, not less, when
  none is named.
- The parser, micromark, follows CommonMark closely but not everywhere. A list
  that does not start at 1, or an empty item, is read as text at the start of a
  list item, block quote, or footnote definition directly below a paragraph, as
  in `- 2. Step` or `> -`, and after an indented code block, where CommonMark
  and GitHub read a list ([issue
  #191](https://github.com/viell-dev/slop-markdown-tools/issues/191)). The
  comparison uses that reading before and after, so it cannot see what an edit
  does to the list that renderers show. A paragraph or underlined heading that
  starts with a list marker is therefore left as written, as are the blocks
  indented below it, which renderers read inside that list: every rule's edits
  there are left out, plugins' too, and so are their findings. The list rules
  also leave a list there, or directly after it, as written, because another
  marker or indentation could join it to that list or move it out of the list,
  and `style/block-spacing` adds no blank line that would make the list loose,
  or that would end text that renderers continue on the line below the list. The
  same holds below a link reference definition, where the parser and GitHub read
  such a line as text and markdown-it reads a list. Below an empty list item
  (`-`), the parser takes the `[x]` that begins the next line for a checkbox
  that belongs to no item, where GitHub shows the text `[x]`, so a blank line
  between them, as `style/block-spacing` would add, is refused as a change of
  meaning. The parser also keeps the spaces and tabs that start a code span's
  next line, where CommonMark and GitHub leave them out, so that a span
  `npm run` continued by an indented `build` reads `npm run    build`, and it
  takes a space or line ending off each end of a span before its line endings
  become spaces, where CommonMark takes spaces off after. The comparison reads a
  code span as GitHub shows it, also where renderers differ: GitHub keeps the
  indentation of a lazy continuation line in the span, and commonmark.js does
  not. `style/inline-code` and `style/wrap` join a span to that text ([issue
  #265](https://github.com/viell-dev/slop-markdown-tools/issues/265), [issue
  #285](https://github.com/viell-dev/slop-markdown-tools/issues/285), [issue
  #290](https://github.com/viell-dev/slop-markdown-tools/issues/290)). Directly
  below a table that ends in a list item or block quote, the parser reads the
  lines of another table as text, where GitHub shows a table, so `style/wrap`
  and `style/block-spacing` leave text whose second line is a table delimiter
  row as written ([issue
  #283](https://github.com/viell-dev/slop-markdown-tools/issues/283)). A fenced
  code block without its closing fence runs to the end of its list item, and
  CommonMark and GitHub count the blank lines at the end of the item as code,
  where the parser does not, so `style/block-spacing` adds no blank line below
  such a list ([issue
  #350](https://github.com/viell-dev/slop-markdown-tools/issues/350)).
- Front matter needs a closing line. A first line of `---` or `+++` that no
  later line closes is read as renderers read it, as a thematic break or text,
  with the lists and block quotes below it; the parser's front matter extension
  reads them as paragraphs there, so the tool leaves it out for such a document
  ([issue #278](https://github.com/viell-dev/slop-markdown-tools/issues/278)).
  In Obsidian, Live Preview instead reads an unclosed YAML document as source,
  so no rule changes that document; `+++` does not open YAML there ([issue
  #404](https://github.com/viell-dev/slop-markdown-tools/issues/404)).
- Front matter ends at the next `---` or `+++` line, also one inside a code
  block, for the parser, for site generators, and for GitHub's file view when
  the front matter is a YAML mapping. GitHub's comments, and renderers without
  front matter, read the code block. When a line of the front matter opens a
  code block, an HTML block, or display math, and the closing line is content of
  that block in the other reading, the tool reads the document without front
  matter, and an edit has to keep the meaning of both readings. In such a
  document, a rule whose edits would change either, such as joining the lines of
  the front matter, is refused ([issue
  #295](https://github.com/viell-dev/slop-markdown-tools/issues/295)).
- TOML front matter, between lines of `+++`, is read in every dialect, for site
  generators. GitHub, Forgejo, Gitea, Obsidian, commonmark.js, and markdown-it
  have no TOML front matter and read its lines as a paragraph, which the block
  directly below, with no blank line between, can continue as text or underline
  as a heading. An edit has to keep the meaning of both readings, and the rules
  that would change that block's reading leave it as written: a thematic break
  that is or would become `---`, an underlined heading, and a list that cannot
  interrupt a paragraph, such as a numbered list that does not start at 1
  ([issue #333](https://github.com/viell-dev/slop-markdown-tools/issues/333)).
  Obsidian's protections for blocks it reads otherwise apply to both readings,
  so a table or footnote definition directly below TOML front matter stays as
  paragraph text too ([issue
  #407](https://github.com/viell-dev/slop-markdown-tools/issues/407)). YAML
  front matter, outside the case above, is read as front matter only, as
  GitHub's file view, Forgejo, Gitea, and Obsidian read it.

In Obsidian, an HTML block opened inside a list or quote can continue across
lines that lack its container markers. Reading view and Live Preview can stop
reading raw HTML at different places, so the source stays as written through
both regions' ends, or EOF without a closer. This includes blank lines where
Live Preview remains in HTML mode. Later openers in the same raw region count
too: a void or closed element before an unclosed element does not end protection
early. Properly terminated regions leave independent blocks below them
formatable ([issue
#428](https://github.com/viell-dev/slop-markdown-tools/issues/428)).

Live Preview can resume Markdown between those HTML roots. One- and two-backtick
code ends with its physical line, while longer runs can carry into a fence that
the parser still reads as HTML. An unfinished code transition keeps the source
through EOF, including its original final line ending. Confirmed inline-code
ends still leave independent paragraphs formatable ([issue
#433](https://github.com/viell-dev/slop-markdown-tools/issues/433)).

Which `$…$` is math was observed on the renderers themselves: about 125 cases
rendered by GitHub, Forgejo, and Gitea, which the tests compare with the tool on
every run, and 22 cases that a person looked at in both of Obsidian's views. The
rule is one-sided on purpose: text taken for math is only left alone, while a
formula taken for prose could be wrapped or restyled, so a condition is applied
to a dialect only when its renderer was seen to apply it.

## Limits

Formatting:

- A code span, an image, a link's destination, or a word longer than the line
  stays whole and exceeds the width. The width is a target, not a license to
  split syntax.
- Paragraphs that wrapping cannot reconstruct safely are left as written;
  [`style/wrap`](rules.md#stylewrap) lists them, and its `reportUnreflowed`
  option reports them.
- Emphasis inside a word keeps `*` when the configured marker is `_`, because
  `_` cannot mark emphasis there.
- Tables are aligned only outside lists and block quotes.
- Footnotes, strikethrough, and literal autolinks are read but have no rules of
  their own. Reference definitions are checked but not rewritten.
- There is no formatting of code inside code blocks, no change of front matter
  or other metadata, no generation of documents, and no renaming of files.

Files:

- Only UTF-8 text is read. Another encoding is not guessed, because a guess can
  be wrong and the renderers read Markdown as UTF-8, and it is not decoded with
  replacement characters, which the next edit would write into the file. See
  [files that cannot be read](cli.md#files-that-cannot-be-read-or-written).
- `format --write` writes into the existing file, which keeps its permissions
  and attributes but is not atomic: a crash or power failure during the write
  can leave the file incomplete; see [what writing
  keeps](cli.md#what-writing-keeps).

Syntax:

- Obsidian inline comments that span several paragraphs are not fully read;
  suppress formatting around them or use comment blocks. A comment on lines of
  its own directly above text is read as a block before a paragraph, where
  Obsidian reads one paragraph; both show the same text. Heading nesting paths
  in links, property aliases, PDF subpaths, and the syntax of community plugins
  are not supported.
- Forgejo's and Gitea's own syntax, such as definition lists, backslash math,
  and shortlinks, is protected rather than read, and shortlinks are not checked
  as links. Only the anchor of a heading that starts a definition description is
  read.
- Legacy `> **Note**` callouts, table-of-contents front matter, emoji
  shortcodes, color previews, and issue or commit references are kept as text.
- GitHub reads an escaped `\$` as the start of a formula; the tool does not.
- GitHub also links bare addresses such as `[www.example.com]` in a second pass
  that leaves no source positions. The tool does not read those links, so
  plugins do not see them; no built-in rule acts on them.

Links:

- Links to the web are never fetched.
- Obsidian's resolution by note name is not a complete copy of Obsidian's: a
  missing or ambiguous target is reported, never guessed. A directory is never
  rewritten to a README or index note.
- When a directory cannot be read, a search by note name cannot be exact. A link
  that finds no readable note is reported as not checkable, and one that finds a
  single note is accepted but never rewritten.
- With the workspace root inside a vault, links to notes outside the root cannot
  be checked; see [Obsidian
  vaults](obsidian.md#a-workspace-root-inside-a-vault).
- Heading anchors are modeled as each renderer generates them, with these
  exceptions: character references inside tags that GitHub shows as text; on
  Gitea, the number of a footnote reference in a heading, and Markdown inside
  `<textarea>`, `<plaintext>`, and other elements whose content HTML reads as
  text; the attribute rules of Gitea before 1.26; attribute values nested more
  than 64 levels deep; and character references in HTML `id` and `name`
  attributes, which are not decoded.

Scale:

- The tool uses one processor core and keeps nothing between runs: there is no
  cache, worker pool, watch mode, editor extension, or language server. Start-up
  takes about a quarter of a second.
- While a document is parsed, it needs about 70 to 130 times its size in memory,
  and a single paragraph of 100 kB or more full of inline syntax parses slowly;
  one made of tens of thousands of square brackets can take seconds from about
  50 kB. [Benchmarks](benchmarks.md#limits-of-these-numbers) has the
  measurements.
