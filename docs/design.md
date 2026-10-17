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
each link compared by the file it resolves to. The phases repeat until nothing
changes, for at most eight passes. When edits overlap, when rules undo each
other, when formatting does not settle, or when the meaning changes, `format`
returns the document as it was with an `engine/unsafe-format` error, and
`format --write` writes no file of the batch.

The comparison is only as good as the parser's reading:

- It compares syntax trees, and does not run GitHub's, Forgejo's, Gitea's, or
  Obsidian's renderer.
- It reads the document in its dialect, so it cannot notice that the dialect is
  wrong. In CommonMark a table is an ordinary paragraph, and joining its lines
  changes nothing that CommonMark sees. This is why the tool
  [assumes a dialect](dialects.md#the-assumed-dialect) with more syntax, not
  less, when none is named.
- The parser, micromark, follows CommonMark closely but not everywhere. Directly
  below a paragraph, a list item that begins with another list marker, as in
  `- 2. Step` or `- -`, is read as a list item holding text, where CommonMark
  and GitHub read a nested list
  ([issue #191](https://github.com/viell-dev/slop-markdown-tools/issues/191)).
  Formatting cannot change such a document's meaning, because the comparison
  uses the same reading before and after, but rules see text where GitHub shows
  a list, and the rules that would change such a place leave it as written.

Which `$…$` is math was observed on the renderers themselves: about 125 cases
rendered by GitHub, Forgejo, and Gitea, which the tests compare with the tool on
every run, and 22 cases that a person looked at in both of Obsidian's views. The
rule is one-sided on purpose: text taken for math is only left alone, while a
formula taken for prose could be wrapped or restyled, so a condition is applied
to a dialect only when its renderer was seen to apply it.

## Limits

Formatting:

- A link, code span, or word longer than the line stays whole and exceeds the
  width. The width is a target, not a license to split syntax.
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

Syntax:

- Obsidian inline comments that span several paragraphs are not fully read;
  suppress formatting around them or use comment blocks. Heading nesting paths
  in links, property aliases, PDF subpaths, and the syntax of community plugins
  are not supported.
- Forgejo's and Gitea's own syntax, such as definition lists, backslash math,
  and shortlinks, is protected rather than read, and shortlinks are not checked
  as links.
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
  be checked; see
  [Obsidian vaults](obsidian.md#a-workspace-root-inside-a-vault).
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
  and a single paragraph of 100 kB or more full of inline syntax parses slowly.
  [Benchmarks](benchmarks.md) has the measurements.
