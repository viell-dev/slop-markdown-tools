# Dialects

A dialect names the renderer whose syntax a document is read in: `commonmark`,
`github`, `forgejo`, `gitea`, or `obsidian`. `codeberg` is another name for
`forgejo`, because Codeberg runs Forgejo; the canonical name is what
`config explain`, rules, and plugins see. The dialect decides what is syntax and
what is text, and so what formatting has to leave alone. Choose it in the
[configuration](configuration.md#dialect).

## What each dialect reads

| Syntax                                                                    | CommonMark | GitHub | Forgejo | Gitea | Obsidian |
| ------------------------------------------------------------------------- | ---------- | ------ | ------- | ----- | -------- |
| CommonMark, and YAML or TOML front matter                                 | Yes        | Yes    | Yes     | Yes   | Yes      |
| Tables, task lists, strikethrough, footnotes, literal autolinks           | No         | Yes    | Yes     | Yes   | Yes      |
| Math between `$` signs, and display math                                  | No         | Yes    | Yes     | Yes   | Yes      |
| Alerts such as `> [!NOTE]`                                                | No         | Yes    | Yes     | Yes   | Callouts |
| Definition lists, `\(…\)` and `\[…\]` math, `[[…]]` shortlinks            | No         | No     | Yes     | Yes   | No       |
| Heading attributes such as `{#id}`                                        | No         | No     | Yes     | Yes   | No       |
| Wikilinks, embeds, highlights (`==…==`), comments (`%%…%%`), `^block-ids` | No         | No     | No      | No    | Yes      |

GitHub's syntax is the common base of the Forgejo, Gitea, and Obsidian dialects,
and the rules for GitHub Markdown apply to all three. The syntax that only
Forgejo and Gitea have is protected from formatting rather than parsed; see
[Forgejo and Gitea](#forgejo-and-gitea). Syntax that no dialect knows, such as
an Obsidian plugin's, is read as text: use a suppression comment or an `ignore`
pattern for it.

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
- **Obsidian:** the opening `$` may not be followed by a space, and a `$` closes
  the formula only when no space stands before it and no digit follows it.
  `$ x $` is prose; `a$x$b` holds a formula, as it does on none of the other
  three.
- **Display math**, between lines of `$$` or in a `math` code block, is the same
  in every dialect.

Where a renderer is stricter, the tool still protects the text: a formula with
emphasis inside, which GitHub does not render, and one that runs over a line
break, which Forgejo, Gitea, and Obsidian's Live Preview do not render. Where
Obsidian's Reading view and Live Preview disagree, the tool follows Reading
view, which shows more as a formula.

## Heading anchors

A link's fragment (`page.md#install`) is checked against the anchors that the
dialect's renderer generates.

| Dialect                    | Anchor of a heading                                                                                                                      | Matched                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| GitHub, CommonMark         | Rendered text, lowercased; punctuation other than `-` and `_` deleted; spaces become `-`; repeated anchors get `-1`, `-2`                | Ignoring case                          |
| Forgejo, Gitea before 1.26 | Source of the heading's last line as written, Markdown included; every run of characters other than letters, digits, and `_` becomes `-` | Exactly                                |
| Gitea 1.26 and later       | Rendered text of all lines, as on GitHub, without combining marks; repeated headings share one anchor                                    | Exactly                                |
| Obsidian                   | The heading text itself; `#^id` reaches a block identifier                                                                               | Headings ignoring case, blocks exactly |

The Gitea dialect accepts the anchors of both Gitea generations, so it cannot
promise that a fragment exists on every version. Inline HTML in a heading adds
its text, but not its tags, to the anchors built from rendered text, except for
tags that the renderer shows as text, such as `<script>`.

| Heading                                     | GitHub           | Forgejo                              | Gitea 1.25                       |
| ------------------------------------------- | ---------------- | ------------------------------------ | -------------------------------- |
| `## test.0.1`                               | `#test01`        | `#test-0-1`                          | `#test01`                        |
| `## Link [text](https://example.com/p) end` | `#link-text-end` | `#link-text-https-example-com-p-end` | `#link-texthttpsexamplecomp-end` |
| `## A <span>B</span>`                       | `#a-b`           | `#a-span-b-span`                     | `#a-spanbspan`                   |

On GitHub, Forgejo, and Gitea, more fragments are valid:

- A fragment may carry the `user-content-` prefix that the renderers add to
  every anchor.
- The `id` of any HTML element and the `name` of an `<a>`, such as
  `<a name="install"></a>`, are anchors. HTML inside comments, code, and
  elements whose content is text, such as `<script>` and `<textarea>`, is not.
- A heading written as HTML (`<h2>Title</h2>`) gets an anchor on GitHub,
  numbered together with the Markdown headings, and on Gitea 1.26 and later,
  where it is not numbered and an HTML heading with its own `id` gets none.
  Forgejo and earlier Gitea give it none.

## Forgejo and Gitea

Both render GitHub Markdown and more. The tool parses their documents as GitHub
Markdown and protects the rest:

- A paragraph with a definition description (a line starting with `: `) or a
  display-math line starting with `\[` is not wrapped.
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
and `style/heading` escapes a `#` run in front of a block (`# Run \## {#id}`).
The semantic check compares these blocks and anchors too, so an edit by any rule
or plugin that would change them is refused.

**Gitea and `_.py`.** Gitea 1.26 and later render `__init__.py` literally
instead of as emphasis, in headings too, whose anchor is then `#__init__py`.
Whether an underscore delimits emphasis then depends on the rest of the line, so
on a line containing `_.py` the Gitea dialect leaves emphasis markers and
multiline code spans as written, and keeps link destinations whose rewrite would
change their underscores. Such a paragraph is wrapped only when all its
underscores are inside code spans and it holds no `$` or `\(` math.
