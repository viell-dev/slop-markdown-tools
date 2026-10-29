# Dialects

A dialect names the renderer whose syntax a document is read in: `commonmark`,
`github`, `forgejo`, `gitea`, `obsidian`, or `vitepress`. `codeberg` is another
name for `forgejo`, because Codeberg runs Forgejo; the canonical name is what
`config explain`, rules, and plugins see. The dialect decides what is syntax and
what is text, and so what formatting has to leave alone. Choose it in the
[configuration](configuration.md#dialect).

## What each dialect reads

| Syntax                                                                                     | CommonMark | GitHub | Forgejo | Gitea | Obsidian | VitePress 2          |
| ------------------------------------------------------------------------------------------ | ---------- | ------ | ------- | ----- | -------- | -------------------- |
| CommonMark                                                                                 | Yes        | Yes    | Yes     | Yes   | Yes      | Yes                  |
| YAML or TOML front matter                                                                  | Yes        | Yes    | Yes     | Yes   | Yes      | gray-matter; no TOML |
| Tables, task lists, strikethrough, footnotes, literal autolinks                            | No         | Yes    | Yes     | Yes   | Yes      | Yes; syntax options  |
| Math between `$` signs, and display math                                                   | No         | Yes    | Yes     | Yes   | Yes      | Opt-in               |
| Alerts such as `> [!NOTE]`                                                                 | No         | Yes    | Yes     | Yes   | Callouts | Yes                  |
| Definition lists, `\(…\)` and `\[…\]` math, `[[…]]` shortlinks                             | No         | No     | Yes     | Yes   | No       | No                   |
| Heading attributes such as `{#id}`                                                         | No         | No     | Yes     | Yes   | No       | Yes                  |
| Wikilinks, embeds, highlights (`==…==`), comments (`%%…%%`), `^block-ids`                  | No         | No     | No      | No    | Yes      | No                   |
| Curly element attributes, colon containers, Vue components, inline footnotes, CJK emphasis | No         | No     | No      | No    | No       | Yes; syntax options  |

GitHub's syntax is the common base of the Forgejo, Gitea, and Obsidian dialects,
and the rules for GitHub Markdown apply to all three. TOML front matter is read
in those dialects and CommonMark for site generators, though the renderers read its lines as a
paragraph, and formatting keeps the meaning of [both
readings](design.md#safety-model). Obsidian and VitePress mark strikethrough with two tildes
only, so `~a~` is text there. VitePress reads TOML fences as ordinary Markdown;
its [renderer options and preservation](vitepress.md) describe its separate reading.
The syntax that only Forgejo and Gitea have is
protected from formatting rather than parsed; see [Forgejo and
Gitea](#forgejo-and-gitea). Syntax that no dialect knows, such as an Obsidian
plugin's, is read as text: use a suppression comment or an `ignore` pattern for
it. Site-generator syntax is read as text too, but its lines are kept:
[`style/wrap`](rules.md#stylewrap) leaves a paragraph as written when one of its
lines starts with a container such as Docusaurus's `:::note` or a template tag
such as Liquid's `{% tab %}` or `{{ title }}`, because site generators read them
by line.

An alert's or callout's marker is read from the text, as GitHub reads it, so
`> \[!NOTE]` and `> &#91;!NOTE]` are alerts too. Formatting keeps the line of
such a marker as written in every dialect; whether Forgejo, Gitea, and Obsidian
render these forms was not observed.

## The assumed dialect

When neither the configuration, its presets and overrides, nor `--dialect` names
a dialect, the CLI assumes one for each document:

- `obsidian` for a document inside an Obsidian vault. A vault is a directory
  that contains a `.obsidian` directory, and a document belongs to the nearest
  vault at or above its own directory: the workspace root, a directory below it,
  or one above it when the root is part of a vault. The search upward stops at a
  directory that contains `.git`, so a repository checked out inside a vault is
  not read as the vault's notes.
- `github` for every other document, also for text read from stdin.

Only the dialect is assumed. The rules of the `github` and `obsidian` presets,
such as table alignment, still need the preset. For documents that are plain
CommonMark, name `"dialect": "commonmark"`.

The reason for the assumption: formatting checks that a document's meaning is
unchanged, but it checks in the document's dialect, so a wrong dialect goes
unnoticed. In CommonMark a table is an ordinary paragraph, and wrapping would
join its lines. In any dialect but Obsidian's, the lines of a note would be
joined although Obsidian can show each of them. Assuming GitHub only makes
formatting more careful for a document that is really CommonMark.

## Math

Text between dollar signs is math only under the conditions that the dialect's
renderer applies, so that sums of money are not taken for a formula. Math is
never restyled, and no line is broken inside it.

- **GitHub, Forgejo, and Gitea:** `$…$` is math only when the opening `$` does
  not follow a letter or digit, and the closing `$` is not followed by a letter,
  a digit, or `_`. `Costs $5 and $6` is prose; `From $5 to 10$` is math.
- **GitHub** also wants the formula to touch its dollar signs: `$ x $` is math
  on Forgejo and Gitea, and prose on GitHub.
- **Obsidian, and VitePress with math enabled:** the opening `$` may not be
  followed by a space, and a `$` closes the formula only when no space stands
  before it and no digit follows it. `$ x $` is prose; `a$x$b` holds a formula,
  unlike GitHub, Forgejo, and Gitea.
- **Display math**, between lines of `$$` or in a `math` code block, is
  protected on GitHub, Forgejo, Gitea, and Obsidian. GitHub's dollar display
  math needs its own paragraph: `$$` directly below an existing paragraph stays
  in that paragraph, including a list item's or block quote's continuation.
  Formatting preserves these continuations
  ([#491](https://github.com/viell-dev/slop-markdown-tools/issues/491)). Table
  syntax also takes precedence over dollar display math: dollar-prefixed headers
  and contiguous dollar rows remain table cells. A blank line ends the table
  before a subsequent math block. VitePress's optional dollar display math can
  interrupt a paragraph and close on the same line; a `math` code fence is
  ordinary code there.

GitHub also retains contiguous dollar display math and a Setext title
immediately below it as one source range. GitHub's underline can include the
dollar lines in that heading. A real blank before the title or an interrupting
block permits ordinary formatting again
([#336](https://github.com/viell-dev/slop-markdown-tools/issues/336)). The same
protection retains such a title when GitHub continues it inside a list or quote
after its display math, even when the title omits the container's markers.

Where a renderer is stricter, the tool still protects the text: a formula with
emphasis inside, which GitHub does not render, and one that runs over a line
break, which Forgejo, Gitea, and Obsidian's Live Preview do not render. Where
Obsidian's Reading view and Live Preview disagree, the tool follows Reading
view, which shows more as a formula.

## Heading anchors

A link's fragment (`page.md#install`) is checked against the anchors that the
dialect's renderer generates.

GitHub heading anchors also participate in the semantic guard for rule and
plugin edits. Structural HTML can close a generated heading early or carry its
text into later blocks. HTML headings inside table cells also contribute
anchors; ordinary cell boundaries close them, while malformed table HTML can
reorder them. When a boundary is uncertain, the GitHub formatter preserves the
source from the affected heading or table through the end of the document.
Fragment checks retain known earlier headings and explicit HTML IDs; other
fragments are reported as not fully checked, without guessing an anchor. The
CommonMark fallback uses the same fragment-checking limit.

These anchors also account for GitHub's tag filtering: tags such as `script` and
`style` render as text, while the HTML between them can still supply headings
and explicit IDs. Unsupported inline attributes and raw tags such as `<title/x>`
can expose uncertain markup and leave later fragments incomplete. Character
references split by a real HTML tag or comment retain their literal text when
heading IDs are built.

GitHub repository-file checks also select the reading used after YAML front
matter preprocessing. A byte-zero `---` envelope with a mapping, or with a YAML
error display, leaves the body to render normally. Ordinary valid non-mappings
remain Markdown, as do envelopes preceded by a BOM or blank line. Unsupported
YAML scalar classes and unverified boundaries retain only anchors shared by both
readings; other fragments are reported as not fully checked. This target
selection does not change the formatter's front matter safety readings or the
CommonMark fallback.

GitHub file checks also collect anchors from dollar-math source as ordinary
Markdown. A Setext underline can include the dollar lines in its heading, inline
emphasis can affect the heading ID, and HTML anchors or headings inside those
lines can remain reachable. Duplicate IDs follow this complete file reading. The
alternative is made lazily after the front matter choice; formatting and other
dialects keep their existing math readings.

| Dialect                    | Anchor of a heading                                                                                                                                      | Matched                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| GitHub, CommonMark         | Rendered text, lowercased; punctuation other than `-` and `_` deleted; spaces become `-`; repeated anchors get `-1`, `-2`                                | Ignoring case                               |
| Forgejo, Gitea before 1.26 | Source of the heading's last line as written, Markdown included; every run of characters other than letters, digits, and `_` becomes `-`                 | Exactly                                     |
| Gitea 1.26 and later       | Rendered text of all lines, as on GitHub, without combining marks; repeated headings share one anchor                                                    | Exactly                                     |
| Obsidian                   | The heading text itself, or as its source writes it; `#A#B` reaches a heading below another, `#^id` a block identifier                                   | Headings ignoring case, blocks exactly      |
| VitePress 2                | Token text with combining marks removed, punctuation runs replaced by `-`, leading digits prefixed by `_`, and duplicates numbered; `{#id}` overrides it | Fragments pass through the selected slugger |

The Gitea dialect accepts the anchors of both Gitea generations, so it cannot
promise that a fragment exists on every version. Inline HTML in a heading adds
its text, but not its tags, to the anchors built from rendered text, except for
tags that the renderer shows as text, such as `<script>`.

| Heading                                     | GitHub           | Forgejo                              | Gitea 1.25                       | VitePress 2      |
| ------------------------------------------- | ---------------- | ------------------------------------ | -------------------------------- | ---------------- |
| `## test.0.1`                               | `#test01`        | `#test-0-1`                          | `#test01`                        | `#test-0-1`      |
| `## Link [text](https://example.com/p) end` | `#link-text-end` | `#link-text-https-example-com-p-end` | `#link-texthttpsexamplecomp-end` | `#link-text-end` |
| `## A <span>B</span>`                       | `#a-b`           | `#a-span-b-span`                     | `#a-spanbspan`                   | `#a-b`           |

On GitHub, Forgejo, and Gitea, more fragments are valid:

- A fragment may carry the `user-content-` prefix that the renderers add to
  every anchor.
- The `id` of any HTML element and the `name` of an `<a>`, such as
  `<a name="install"></a>`, are anchors. Their character references are decoded
  once as HTML attributes, so `<a id="a&#x2d;b"></a>` is reached by `#a-b`. HTML
  inside comments, code, and elements whose content is text, such as `<script>`
  and `<textarea>`, is not.
- On Forgejo and Gitea, a heading that starts a definition description, as
  `: # Title` below a term does, gets an anchor, numbered with the other
  headings, though the tool otherwise reads a definition list as text.
- A heading written as HTML (`<h2>Title</h2>`) gets an anchor on GitHub,
  numbered together with the Markdown headings, and on Gitea 1.26 and later,
  where it is not numbered and an HTML heading with its own `id` gets none.
  Forgejo and earlier Gitea give it none.

## Forgejo and Gitea

The repository's checks compare the tool's output with disposable Forgejo 17.0.0
and Gitea 28.2.0 instances. Authored fixtures and realistic documents at fixed
seeds are checked through their file-rendering APIs; actual repository file
pages also check heading IDs, explicit targets and fragment links, including
headings inside definition descriptions. The evidence covers those host versions
and default rendering settings. Custom hard-break or math settings, themes and
browser math layout need separate validation. Weekly adversarial generation
discovers limits without becoming a release gate.

Formatting retains native table rows that the primary parser reads as ordered
lists, table headers and bodies hidden inside quoted paragraphs, and a single
backslash hard break immediately after a literal URL. These protections apply to
Forgejo and Gitea; GitHub reads that URL backslash as part of the link instead.

Generated stray-marker text can still change emphasis or strikethrough pairing
when wrapping moves markers across quoted lines. The observed case preserves
text and block structure and is tracked as a bounded styling limit in
[#665](https://github.com/viell-dev/slop-markdown-tools/issues/665), reopenable
with meaningful impact on authored input.

Both render GitHub Markdown and more. The tool parses their documents as GitHub
Markdown and protects the rest:

- A definition description, a line starting with `: ` below its term, holds
  blocks on Forgejo and Gitea, as a list item does, and so do the lines indented
  below it: `: 2. Step` is a list there, and a fence starts code. No rule
  changes the paragraph with such a line or the blocks indented below it. A
  paragraph with a display-math line starting with `\[` is not wrapped.
- `\(…\)` math and `[[…]]` shortlinks on one line are kept whole; a pair split
  across lines keeps its paragraph from being wrapped. Emphasis markers inside
  `\(…\)` are not changed, and code spans are not joined where that would put
  `\(` and `\)` on one line. Gitea reads backslash math only when its
  administrator enables `MATH_CODE_BLOCK_DETECTION`, which a document cannot
  reveal, so it is protected there too.
- Shortlinks are not checked as links.
- If an instance renders line breaks as hard breaks (Gitea's
  `new-line-hard-break` in `RENDER_OPTIONS_REPO_FILE`), disable `style/wrap`.

**Heading attributes.** A `{…}` block at the end of a heading is read as
attributes, not text. `## Install {#setup}` renders as "Install" with the anchor
`#setup` and no `#install`; `## Usage {.note}` keeps the anchor `#usage`. A
block holds `#id`, `.class`, and `name=value` items, such as
`{#setup .note data-level=2}`. It ends the heading's line or, for an underlined
heading, its last text line, and still counts after a closing `#` sequence
(`## Install ## {#setup}`). A block that is not valid, that is followed by more
text, or whose `{` is escaped stays heading text. A custom anchor must be linked
exactly as written and is never numbered. An `id` that is not text breaks
rendering; [`forgejo/heading-id`](rules.md#forgejoheading-id) reports it. The
rules are those of Forgejo 16 and Gitea 1.26 and later.

Formatting leaves a block as written, and changes nothing from the first `{` of
a heading's last text line on: a change of markers there could create or destroy
a block. Because Forgejo, and Gitea before 1.26, build the anchor from the last
line as written, `style/emphasis`, `style/strong`, and `links/path` leave that
line unchanged in a heading without a custom `id`: rewriting
`## Emph *star* end` to `_star_` would move its anchor and break every link to
it. `style/inline-code` does not join a code span across the lines of a heading,
and `style/heading` escapes a `#` run in front of a block (`# Run \## {#id}`)
and keeps a closing sequence after one (`## Install {#setup} ##`), which Gitea
before 1.26 reads as attributes too. The semantic check compares these blocks
and anchors too, so an edit by any rule or plugin that would change them is
refused.

**Gitea and `_.py`.** Gitea 1.26 and later render `__init__.py` literally
instead of as emphasis, in headings too, whose anchor is then `#__init__py`.
Whether an underscore delimits emphasis then depends on the rest of the line, so
on a line containing `_.py` the Gitea dialect leaves emphasis markers and
multiline code spans as written, and keeps link destinations whose rewrite would
change their underscores. Such a paragraph is wrapped only when all its
underscores are inside code spans and it holds no `$` or `\(` math.
