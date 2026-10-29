# Rules

A rule is either a **style** rule or a **problem** rule. A style rule checks how
something is written and proposes an edit, which `format` applies and `lint`
reports. A problem rule reports a defect that has no single correct repair, and
never edits. `format` applies an edit only when the document still means the
same afterwards, and never in text that the parser reads where renderers read a
list; see [how it works](design.md#safety-model).

Enable and configure rules under `rules` in the
[configuration](configuration.md#rules-and-severity). `npx mdrefine rules` lists
the built-in rules and those of the configuration's [plugins](plugins.md).

🎨 marks a style rule, whose findings `format` fixes, and 🔍 a problem rule,
which is reported only. The preset columns give the severity at which a preset
enables the rule, `warn` or `error`: `recommended` in its own column, and the
dialect presets by name in the next; ❌ means that none does. In the options
column, ✅ is yes and ❌ no.

| Rule                            | Kind | `recommended` | Dialect presets                                                 | Options |
| ------------------------------- | :--: | :-----------: | --------------------------------------------------------------- | :-----: |
| `content/code-language`         | 🔍   | ❌            | ❌                                                              | ✅      |
| `content/emphasis-spacing`      | 🔍   | ❌            | ❌                                                              | ❌      |
| `content/html-element`          | 🔍   | ❌            | ❌                                                              | ✅      |
| `content/image-alt`             | 🔍   | `warn`        | ❌                                                              | ❌      |
| `content/inline-code-spacing`   | 🔍   | ❌            | ❌                                                              | ❌      |
| `content/line-length`           | 🔍   | ❌            | ❌                                                              | ✅      |
| `content/proper-names`          | 🔍   | ❌            | ❌                                                              | ✅      |
| `content/shell-prompt`          | 🔍   | ❌            | ❌                                                              | ❌      |
| `content/table-columns`         | 🔍   | `warn`        | ❌                                                              | ❌      |
| `forgejo/heading-id`            | 🔍   | ❌            | `error` in `forgejo`, `gitea`                                   | ❌      |
| `github/alert-marker`           | 🎨   | ❌            | `warn` in `github`, `forgejo`, `gitea`, `vitepress`             | ❌      |
| `github/task-marker`            | 🎨   | ❌            | `warn` in `github`, `forgejo`, `gitea`, `obsidian`, `vitepress` | ❌      |
| `links/allowed-notation`        | 🎨   | ❌            | ❌                                                              | ✅      |
| `links/bare-url`                | 🎨   | ❌            | ❌                                                              | ❌      |
| `links/descriptive-text`        | 🔍   | ❌            | ❌                                                              | ✅      |
| `links/empty`                   | 🔍   | `warn`        | ❌                                                              | ✅      |
| `links/notation`                | 🎨   | ❌            | ❌                                                              | ✅      |
| `links/path`                    | 🎨   | ❌            | ❌                                                              | ✅      |
| `links/reversed`                | 🔍   | ❌            | ❌                                                              | ❌      |
| `links/text-spacing`            | 🔍   | ❌            | ❌                                                              | ❌      |
| `links/undefined-reference`     | 🔍   | `warn`        | ❌                                                              | ✅      |
| `links/unused-definition`       | 🔍   | `warn`        | ❌                                                              | ✅      |
| `links/valid`                   | 🔍   | `error`       | ❌                                                              | ✅      |
| `obsidian/block-reference`      | 🔍   | ❌            | `error` in `obsidian`                                           | ❌      |
| `obsidian/callout-marker`       | 🎨   | ❌            | `warn` in `obsidian`                                            | ❌      |
| `obsidian/strict-line-breaks`   | 🔍   | ❌            | `warn` in `obsidian`                                            | ❌      |
| `structure/duplicate-heading`   | 🔍   | ❌            | ❌                                                              | ✅      |
| `structure/emphasis-heading`    | 🔍   | ❌            | ❌                                                              | ✅      |
| `structure/heading-increment`   | 🔍   | `warn`        | ❌                                                              | ✅      |
| `structure/heading-punctuation` | 🔍   | ❌            | ❌                                                              | ✅      |
| `structure/heading-template`    | 🔍   | ❌            | ❌                                                              | ✅      |
| `structure/initial-heading`     | 🔍   | ❌            | ❌                                                              | ✅      |
| `structure/single-title`        | 🔍   | ❌            | ❌                                                              | ✅      |
| `structure/split-quote`         | 🔍   | ❌            | ❌                                                              | ❌      |
| `structure/unspaced-heading`    | 🔍   | ❌            | ❌                                                              | ❌      |
| `style/blank-lines`             | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/block-spacing`           | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/code-block`              | 🎨   | ❌            | ❌                                                              | ✅      |
| `style/code-fence`              | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/definition-spacing`      | 🎨   | ❌            | ❌                                                              | ❌      |
| `style/emphasis`                | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/final-newline`           | 🎨   | `warn`        | ❌                                                              | ❌      |
| `style/heading`                 | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/inline-code`             | 🎨   | ❌            | ❌                                                              | ❌      |
| `style/lazy-continuation`       | 🎨   | `warn`        | ❌                                                              | ❌      |
| `style/line-ending`             | 🎨   | ❌            | ❌                                                              | ✅      |
| `style/link-title`              | 🎨   | ❌            | ❌                                                              | ✅      |
| `style/list-indent`             | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/list-marker`             | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/no-tabs`                 | 🎨   | ❌            | ❌                                                              | ✅      |
| `style/ordered-list`            | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/prose-space`             | 🎨   | ❌            | ❌                                                              | ❌      |
| `style/quote-marker`            | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/strong`                  | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/table`                   | 🎨   | `warn`        | `warn` in `github`, `forgejo`, `gitea`, `obsidian`, `vitepress` | ✅      |
| `style/thematic-break`          | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/trailing-space`          | 🎨   | `warn`        | ❌                                                              | ✅      |
| `style/wrap`                    | 🎨   | `warn`        | ❌                                                              | ✅      |

A configuration can set any rule to another severity; see [rules and
severity](configuration.md#rules-and-severity). The `codeberg` preset is the
`forgejo` preset under another name. In a dialect that a rule's section does not
name, the rule finds nothing.

Each section below opens with what the rule does, then gives its kind, the
presets that enable it with their severity, its dialects, and its options, an
example, and the options in detail. Labelled paragraphs after that give the
details: how the rule reads the text, the cases it leaves alone, the differences
in particular dialects, and how it works with other rules.

## `content/code-language`

Reports a fenced code block that does not name its language after the opening
fence. GitHub, Forgejo, Gitea, and Obsidian highlight code by the language its
fence names; name `text` for plain text.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`allowedLanguages`, `languageOnly`.

Reported:

````markdown
```
npm test
```
````

Not reported:

````markdown
```sh
npm test
```
````

| Option             | Values                           | Default |
| ------------------ | -------------------------------- | ------- |
| `allowedLanguages` | An array of case-sensitive names | `[]`    |
| `languageOnly`     | `true` or `false`                | `false` |

- `allowedLanguages`: the language names allowed. `[]` allows any named
  language; `["js", "ts", "text"]` permits only those names. Names are compared
  after Markdown character references and escapes are decoded, without guessing
  aliases.
- `languageOnly`: with `true`, the opening fence's info string must hold only
  its language name: no leading or trailing whitespace and no additional
  metadata.

Both options only report findings; the code and its fence remain as written.

**Not checked:** indented code blocks, which have no place for a language.

## `content/emphasis-spacing`

Reports emphasis or strong markers with blank space just inside them, as in
`** bold **` or `*italic *`. A marker with blank space on its inner side cannot
open or close emphasis, so renderers show the asterisks or underscores as text.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
Here is some ** bold ** text and some *italic * text.
```

Not reported:

```markdown
Here is some **bold** text, and 2 * 3 * 4 is 24.
```

**Details:** removing the spaces turns that text into emphasis, which may not be
what was meant, so the rule only reports. A pair of markers is reported only
where the parser of the document's dialect reads emphasis, strong text, or both
there once the spaces are gone: one, two, or three `*` or `_` at each end, on
one line, around text with a letter or a digit. Each run pairs with the next run
of the same marker on its line.

The document is read once with the spaces of every remaining pair removed. Where
that makes text into a definition, as when `[a]:` followed by `** b **` on the
next line becomes one, the pairs in it are not reported, and the document is
read again without them. Where it changes a block in another way, no pair in the
top-level block that holds the change is reported.

**Not checked:** markers that the parser did not read as text, and those in
code, math, HTML, link destinations, autolinks, and dialect syntax such as
Obsidian's comments and highlights or math between `\(` and `\)` on Forgejo and
Gitea. The content of an inline HTML element, such as `<code>** a **</code>` or
`<kbd>`, is not checked either: readers take it for literal text, even where
renderers read Markdown in it.

Where the markers can as well be something other than broken emphasis, they are
not reported, in favor of missing a mistake over reporting text that is right:

- A single `*` or `_` with blank space on both sides at both ends, as in
  `a * b * c`, `2 * 3 * 4`, or `* text *`. Multiplication, wildcards, and
  asterisks or underscores that stand for themselves are written so, and the
  text alone cannot tell them from emphasis. Two or three markers are reported
  in the same case, as in `** bold **`.
- Arithmetic, where the text inside and the words on either side are numbers,
  single letters, and operators, as in `a ** b ** c` or `2 *3 * 4`.
- A marker inside a word, as in `a* b *c`, or next to a character other than
  blank space, brackets, quotation marks, and the punctuation that ends a
  clause, such as the `/` of a JSX comment `{/* note */}`. Identifiers such as
  `my_var` and emoji codes such as `:white_check_mark:` stay alone this way.
- Text that holds a run of the same marker at least as long, as in
  `"** a **" b, (** c **)`, where the parser pairs the inner runs as strong
  text, and pairs of different markers that overlap. Which markers belong
  together is not known there.
- Text that starts with something other than a letter, a digit, an opening
  bracket or quotation mark, or ends with something other than a letter, a
  digit, a closing bracket or quotation mark, or `.`, `!`, or `?`, unless a code
  span, link, or other inline element starts or ends it there. Emphasis that was
  meant starts and ends with a word, unlike the wildcard patterns of
  `glob *.md * notes` or `*.txt *`.
- Markers in the label of a collapsed or shortcut reference, as in `[** a **]`,
  where removing the spaces would change the definition that the label names.
- Runs of four or more markers, and pairs whose text spans lines.

## `content/html-element`

Reports HTML elements, for documents that should hold only Markdown or that are
read as text or turned into other formats than HTML. Each element is reported
once, at its opening tag.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`allowedElements`, `tableAllowedElements`.

Reported:

```markdown
<h2>Sales</h2>

Press <kbd>Enter</kbd> to continue.
```

Not reported:

```markdown
## Sales

Press `Enter` to continue, or write to <sales@example.com>.

<!-- Checked in March. -->
```

| Option                 | Values                    | Default                   |
| ---------------------- | ------------------------- | ------------------------- |
| `allowedElements`      | An array of element names | `[]`                      |
| `tableAllowedElements` | An array of element names | Same as `allowedElements` |

- `allowedElements`: the elements allowed, compared without letter case, such as
  `["br", "details", "summary"]`; in tables too, unless `tableAllowedElements`
  is set.
- `tableAllowedElements`: the elements allowed in the cells of a Markdown table,
  in place of `allowedElements` there. `{ "tableAllowedElements": ["br"] }`
  allows `<br>` line breaks in tables and nowhere else.

**Details:** closing tags are not reported, because the element was reported at
its opening tag, and a void element such as `<br>` or `<img>`, also written as
`<br/>`, has no other tag. Elements are found in HTML blocks and inline HTML as
the dialect's parser reads them, also in headings, links, table cells, block
quotes, and lists. A message names the element as written.

HTML is read as a browser reads the page, each HTML block, and the inline HTML
of a paragraph, heading, or table cell, together. Where that reading becomes
uncertain, nothing after it is reported, in favor of missing an element over
reporting what renderers do not read as one:

- a comment, a raw-text element such as `<textarea>` or `<script>`, or a tag
  left open at the end of such a block: most renderers read it on through the
  Markdown that follows, but Obsidian renders each block alone;
- an abrupt comment such as `<!-->`, CDATA, and a comment inside a raw-text
  element, which renderers that remove comments read differently;
- a part of the document that a renderer reads otherwise than the parser, when
  it holds a `<`, such as text below an Obsidian HTML block that Reading view
  takes for more of the block;
- in Obsidian and VitePress, a paragraph with an inline footnote such as
  `^[note]`, which moves to the end of the page;
- in VitePress, HTML in a `{{ }}` interpolation, which Vue reads as an
  expression, and a tag that only VitePress reads as HTML, such as one with
  `@click` or `#default`, because the tags around it are not known.

Footnote definitions are read after the rest, where the page shows them, and
only when nothing stopped the reading there. A definition that no reference
outside footnotes uses is not shown, and not read. When reading one stops,
closes an element left open before the footnotes, or leaves open an element that
hides what follows, no definition is read, because the page orders them by their
references.

**Not checked:** comments, mdrefine's suppression comments included,
declarations such as `<!DOCTYPE html>`, and processing instructions, which are
not elements; autolinks such as `<https://example.com>` and
`<sales@example.com>`, which are links; code, escaped text such as `\<b>`, and
the text inside a raw-text element. A tag that Markdown's grammar for HTML does
not read whole, such as `<div class=a"b>`, and a tag split across the lines of a
block quote, list item, or footnote are not reported either.

**In VitePress:** components such as `<Badge/>`, and elements with Vue's
attributes such as `:title`, are HTML to VitePress's Markdown and are reported
by their names as written; allow a component by its name. HTML blocks, which
hold Vue templates, are [opaque areas](vitepress.md#preservation) whose findings
are omitted, so only inline HTML is reported.

## `content/image-alt`

Reports an image without alternative text: a Markdown image with no text between
its brackets, as in `![](chart.png)`, and an HTML `<img>` element without an
`alt` attribute. Screen readers read the text in place of the image, and
browsers show it when the image does not load.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all.
Options: none.

Reported:

```markdown
![](sales-by-month.png)

<img src="sales-by-month.png" width="400">
```

Not reported:

```markdown
![Sales by month, rising from March](sales-by-month.png)

<img src="sales-by-month.png" alt="Sales by month, rising from March">
<img src="divider.png" alt="">
```

**Details:** Markdown text that is only blank space counts as none. An HTML
image with `alt=""` is accepted: HTML marks a decorative image, which screen
readers skip, with an empty `alt`, and the attribute is written on purpose.
Markdown has no such mark, because `![](divider.png)` is also what an image
looks like when its text was forgotten, so blank Markdown text is reported.
Write a decorative image as `<img src="divider.png" alt="">`.

An HTML image hidden from assistive technology with `aria-hidden="true"`, or
from everyone with `hidden`, `inert`, or a `style` such as `display: none`, is
accepted, and so is one inside an element hidden so.

**Not checked:** HTML images that renderers do not certainly show: those inside
`<template>`, `<video>`, `<audio>`, `<object>`, `<canvas>`, `<select>`,
`<datalist>`, `<dialog>`, `<svg>`, or `<math>`, or in comments or raw-text
elements such as `<textarea>`. HTML images are found where
[`content/html-element`](#contenthtml-element) finds elements: not after HTML
whose reading is uncertain, and not in footnote definitions that no reference
uses. A report there could be about an image that readers never see.

No HTML image is checked after an end tag that a browser may ignore while an
element that hides is open. A browser ignores the end tag of an element opened
outside a table, a `<select>`, or a `<template>`, or outside a paragraph, list
item, or table cell of the Markdown, and a start tag such as `<li>` can close a
`<p>` before its end tag. In `<div hidden><table></div><img src="x">`, the image
stays inside the hidden `<div>`. An end tag that closes the innermost open
element, or that comes while nothing hides, does not stop the check. Nor is an
HTML image checked after an `<html>`, `<head>`, or `<body>` tag: whether such a
tag and its attributes apply depends on how the page embeds the rendered HTML.

**On GitHub:** the sanitizer removes `aria-hidden`, `hidden`, `inert`, and
`style` and keeps the image, so an image hidden only by them is reported.

**In Obsidian:** a size after `|`, as in `![|100](chart.png)`, is not text, and
embeds such as `![[chart.png]]` are not reported, because they have no place for
text.

**In VitePress:** only inline HTML images are checked, because HTML blocks are
[opaque areas](vitepress.md#preservation). An image with Vue's attributes, such
as `:alt`, `v-bind`, or `v-if`, or inside a component or an element with them,
is not checked, because Vue decides what they show.

## `content/inline-code-spacing`

Reports a code span with blank space at its start or end that renderers show as
part of the code, as in `` `  npm test  ` `` or `` ` npm test` ``. Readers see
and copy that space with the code.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
Run ` npm test` before you commit.
```

Not reported:

```markdown
Run `npm test` before you commit, and `` `backticks` `` show as code.
```

**Details:** renderers take one space off each end of a code span only when both
ends have one, so `` ` npm test ` `` shows `npm test`, while `` ` npm test` ``
keeps its space and `` `  npm test  ` `` keeps one at each end. Removing the
space changes the code that readers see and copy, and some code needs it, so the
rule only reports. Blank space is reported only next to a letter or a digit of
the code. A line ending at an end of the span counts as the space that renderers
show for it.

**Not checked:**

- Blank space next to another character, which usually belongs to the code, as
  when a span shows syntax such as a list item's `- ` or a definition's `: `.
- The space next to a backtick at an end of the code, as in ``` `` `npm`` ```,
  which keeps that backtick apart from the span's own.
- More than one space or a tab at one end only, as in `` `    Text` ``, which
  shows indentation.
- The one space at each end that renderers take off, and a span of nothing but
  blank space.

**In Obsidian:** a span of one or two backticks across lines is not reported,
because Live Preview ends it at its line.

**With other rules:** this is a rule of its own rather than an option of
[`style/inline-code`](#styleinline-code): that rule only makes edits that keep
the code as renderers show it, and no edit of the padding does, so there is
nothing to fix, only to report.

## `content/line-length`

Reports lines in headings, code blocks, and tables that are longer than a limit,
80 columns by default. It never edits, because splitting these lines can change
their meaning; paragraphs are left to [`style/wrap`](#stylewrap), which reflows
them.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`lineLength`, `headingLineLength`, `codeBlockLineLength`, `headings`,
`codeBlocks`, `tables`, `strict`, `stern`, `measure`.

With `{ "lineLength": 40 }`, reported:

```markdown
## Configuring the formatter and the linter for a large workspace
```

Not reported, because it is a paragraph:

```markdown
Configuring the formatter and the linter for a large workspace takes one file.
```

| Option                | Values                                       | Default      |
| --------------------- | -------------------------------------------- | ------------ |
| `lineLength`          | Nonnegative integer; zero disables the limit | `80`         |
| `headingLineLength`   | Nonnegative integer                          | `lineLength` |
| `codeBlockLineLength` | Nonnegative integer                          | `lineLength` |
| `headings`            | Boolean                                      | `true`       |
| `codeBlocks`          | Boolean                                      | `true`       |
| `tables`              | Boolean                                      | `true`       |
| `strict`              | Boolean                                      | `false`      |
| `stern`               | Boolean                                      | `false`      |
| `measure`             | `"columns"` or `"codepoints"`                | `"columns"`  |

- `lineLength`: the limit for every checked line, and for tables the only one.
  Zero turns the limit off.
- `headingLineLength`, `codeBlockLineLength`: separate limits for headings and
  for code blocks; zero turns that limit off.
- `headings`, `codeBlocks`, `tables`: with `false`, lines of that kind are not
  checked.
- `strict`, `stern`: by default a line is not reported when only its last word,
  which holds no blank space, crosses the limit. `stern` reports such a line
  when it has more than one word; `strict` reports every long line and takes
  precedence.
- `measure`: as in `style/wrap`, `columns` counts display columns, so CJK
  characters and combining marks are measured as they show, and `codepoints`
  counts Unicode code points, for policies about the source. Tabs count up to
  the next multiple of four columns.

```jsonc
{
  "rules": {
    "content/line-length": ["warn", { "lineLength": 100, "codeBlocks": false }],
  },
}
```

**Details:** each physical line of ATX and Setext headings, fenced and indented
code blocks, fence lines included, and parsed tables is measured whole, so list
and block quote markers count toward the width.

**Not checked:** paragraphs, front matter, HTML, math, reference definitions,
thematic breaks, and every other block. A table in a dialect without table
syntax is a paragraph, so it is not checked either. Markdownlint's MD013 checks
HTML and math lines too, but skips front matter and definitions, and, outside
strict checking, lines that hold only a link.

**With other rules:** `style/wrap` keeps its own paragraph findings. `strict`
and `stern` here apply only to headings, code, and tables, and do not imply its
`reportUnreflowed` or `reportUnbreakable`, which judge where prose can safely
break and which pieces cannot be split, not raw blank space.

## `content/proper-names`

Reports other capitalization of configured names in prose, link labels, and
image alt text: with `JavaScript` configured, `javascript` is reported. Changing
a name changes text, so the rule never fixes it.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: `names`,
`codeBlocks`, `htmlElements`.

With `{ "names": ["JavaScript", "Node.js"] }`, reported:

```markdown
Write the plugin in javascript for node.js.
```

Not reported:

```markdown
Write the plugin in JavaScript for Node.js; run `node.js --version`.
```

| Option         | Values                        | Default |
| -------------- | ----------------------------- | ------- |
| `names`        | An array of non-empty strings | `[]`    |
| `codeBlocks`   | `true` or `false`             | `false` |
| `htmlElements` | `true` or `false`             | `true`  |

- `names`: literal names with their accepted capitalization. `[]` checks
  nothing. Several configured spellings of the same name are all accepted.
- `codeBlocks`: with `true`, the bodies of fenced and indented code blocks are
  checked too; turn it on to check prose examples written in fences.
- `htmlElements`: with `true`, the visible text of HTML is checked; tags,
  attributes, and comments are not. With `false`, a prose block containing
  inline HTML is left out as a whole, and other prose is still checked.

For example, in the configuration:

```json
{
  "rules": {
    "content/proper-names": ["warn", { "names": ["JavaScript", "Node.js"] }]
  }
}
```

**Details:** names match literal punctuation and spaces, as in `Node.js`, `C++`,
and `GitHub Actions`. A Unicode letter, combining mark, number, or connector
punctuation next to a name prevents a match: neither `myjavascript` nor
`javascripts` matches `JavaScript`, and the same boundary applies in non-Latin
scripts. Punctuation outside a name separates it from the text around it. A
longer name takes precedence over a shorter one that overlaps it. An explicit
wikilink alias is prose.

**Not checked:** inline code, because a command or identifier often needs its
exact spelling, and code blocks by default for the same reason; the bodies of
HTML `script`, `style`, `code`, and `pre` elements; link destinations,
autolinks, bare URLs and email addresses, image sources, front matter, math,
comments, and wikilink targets.

## `content/shell-prompt`

Reports a code block of shell commands in which every command starts with a
prompt, `$` or `%` followed by blank space, and that shows no output. Such
prompts tell a reader nothing that the block does not, and get in the way of
copying the commands.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

````markdown
```sh
$ npm ci
$ npm test
```
````

Not reported:

````markdown
```sh
npm ci
npm test
```

```console
$ node --version
v24.21.0
```
````

**Details:** removing the prompts changes the code that readers copy, so the
rule only reports. A block is checked when it names no language, as indented
blocks cannot, or names a shell or a shell session: `sh`, `bash`, `zsh`, `fish`,
`ksh`, `csh`, `tcsh`, `dash`, `shell`, `console`, `terminal`, `shell-session`,
`sh-session`, or `shellsession`, in any letter case. Other languages, `text`
among them, can start a line with `$` or `%`, as TeX's comments and math do.
Blank lines are not commands, nor are lines that a backslash at the end of the
line above continues the command onto.

**Not checked:**

- A block with a line that starts with `#`. Such a line is not a command: it is
  a comment in shell code, and output or a root prompt in a session.
- A block in which any other line shows output, even if some commands show none.

## `content/table-columns`

Reports a table row with more or fewer cells than the header row. As the GFM
specification requires, renderers drop the extra cells of a longer row without a
trace and fill a shorter row with empty cells, so the table does not show what
its source says.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all
but CommonMark. Options: none.

Reported, because the last row has three cells:

```markdown
| Name | Size |
| ---- | ---- |
| a    | 1    |
| b    | 2    | 3 |
```

Not reported:

```markdown
| Name    | Size |
| ------- | ---- |
| a       | 1    |
| `b\|c`  | 2    |
```

**Details:** a `|` separates cells inside code and wikilinks too, unless it is
escaped as `\|`.

**Not checked:** the rows after a standalone colon-container boundary, such as
`:::`, which ends the rows checked. Site generators read it as a container
boundary, although GFM reads it and the following text as more rows. A cell
written as `| ::: |` is checked normally.

## `forgejo/heading-id`

Reports a heading attribute block whose `id` is not text, such as `{id=5}`,
`{id=true}`, or a list. Forgejo, and Gitea before 1.26, render nothing at all
for a document that contains one; Gitea 1.26 and later render the heading
without an anchor.

**Problem rule**, reported only. Presets: `forgejo` (error), `gitea` (error).
Dialects: Forgejo, Gitea. Options: none.

Reported:

```markdown
## Install {id=5}
```

Not reported:

```markdown
## Install {id="5"}
```

**Details:** quote the value (`{id="5"}`) or write `{#5}`.
[Dialects](dialects.md#forgejo-and-gitea) describes attribute blocks.

## `github/alert-marker`

Writes the type of a GitHub alert in capitals. The renderers accept any case for
the five types `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`, and their
documentation spells them in capitals.

**Style rule**, fixed by `format`. Presets: `github` (warn), `forgejo` (warn),
`gitea` (warn), `vitepress` (warn). Dialects: GitHub, Forgejo, Gitea, VitePress.
Options: none.

Before:

```markdown
> [!note]
> Read this first.
```

After:

```markdown
> [!NOTE]
> Read this first.
```

**Left as written:**

- Other types, which are not alerts there.
- A marker written with an escape or a character reference, such as `\[!note]`.
- A marker that GitHub shows as text: one in a block quote inside another quote
  or a list, one followed by text on its line, and one with nothing below it in
  the quote.

## `github/task-marker`

Writes the mark of a completed task as a lowercase `x`.

**Style rule**, fixed by `format`. Presets: `github` (warn), `forgejo` (warn),
`gitea` (warn), `obsidian` (warn), `vitepress` (warn). Dialects: all but
CommonMark; VitePress needs task lists enabled. Options: none.

Before:

```markdown
- [X] Write the guide
```

After:

```markdown
- [x] Write the guide
```

## `links/allowed-notation`

Reports the Markdown link and image forms that its options disallow, such as
reference links or inline links whose text is their URL. `format` rewrites a
disallowed URL-as-text link as an autolink where that is safe.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`autolink`, `inline`, `full`, `collapsed`, `shortcut`, `urlInline`.

With `urlInline: false`, before:

```markdown
[https://example.com](https://example.com)
```

After:

```markdown
<https://example.com>
```

Each option allows its form when `true` and reports it when `false`:

| Option      | Form                                         | Default |
| ----------- | -------------------------------------------- | ------- |
| `autolink`  | `<https://example.com>`                      | `true`  |
| `inline`    | `[text](target)` or `![alt](target)`         | `true`  |
| `full`      | `[text][label]` or `![alt][label]`           | `true`  |
| `collapsed` | `[label][]` or `![label][]`                  | `true`  |
| `shortcut`  | `[label]` or `![label]`                      | `true`  |
| `urlInline` | `[https://example.com](https://example.com)` | `true`  |

`urlInline: false` reports only an inline link whose displayed text equals its
URL; `inline: false` reports all inline links and images.

**Details:** references are read by the parser, matching defined labels with
Unicode case folding and collapsed spaces, tabs, and line endings. Undefined
references remain literal text. An inline URL-as-text link becomes an autolink
only when `autolink` is allowed, it has no title, and its source text and
destination are exactly the same unescaped HTTP or HTTPS URL. Fixes use a
conservative ASCII subset: letters, digits, `@%+._~:/?#=-`, without trailing
punctuation or `_-`.

**Reported without a fix:** links with entities, escapes, spaces, angle
brackets, ampersands, parentheses, or formatted labels, which stay as written,
and the other disallowed forms.

**With other rules:** the rule does not add or remove reference definitions.
[`links/notation`](#linksnotation) converts verified Obsidian targets between
wikilinks and Markdown and governs wikilinks; bare addresses belong to
[`links/bare-url`](#linksbare-url).

## `links/bare-url`

Reports bare HTTP and HTTPS URLs, `www.` addresses, and email addresses in
prose. `format` writes them as autolinks, in angle brackets, where that keeps
the same text and destination.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options: none.

Before, in GitHub:

```markdown
See https://example.com.
```

After:

```markdown
See <https://example.com>.
```

**Details:** CommonMark shows bare addresses as text, so the rule only reports
there; GitHub, Forgejo, Gitea, Obsidian, and the VitePress projection already
link literal addresses. Fixes bracket only the exact parsed literal extent, with
unchanged text and destination, using the conservative character subset of
[`links/allowed-notation`](#linksallowed-notation). Trailing punctuation
excluded from a literal link stays outside the brackets.

**Not checked:** code, math, HTML, front matter, authored links and images,
definitions (including a definition followed by an HTML comment), and
angle-delimited addresses, including attempts with spaces.

**Reported without a fix:**

- Addresses outside the conservative subset, including `www.` addresses whose
  displayed text differs from their destination.
- An address directly after a backslash or `<`, or directly before `>`: adjacent
  source characters can escape or combine with the new brackets.
- An address in a heading, in Obsidian, which accepts source heading names, and
  in Forgejo and Gitea, which support versions with source-based heading IDs.
  GitHub builds anchors from rendered heading text and VitePress uses inline
  token content; bracketing these exact literal links preserves both, so
  headings remain fixable in those two dialects.

**In VitePress:** addresses next to a preceding letter, digit, `_` or `+`, a
following `_` or `~`, or ending in `#`, `%` or `@` are also left as written: its
linkifier can read these boundaries differently from the literal-link parser.

## `links/descriptive-text`

Reports a link whose whole text is a phrase that does not say where the link
leads, such as "here" or "click here". Screen reader users often move through a
page by its list of links, which reads each link by its text alone, and readers
who scan a page see a link's text before the sentence around it.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`prohibitedTexts`.

Reported:

```markdown
To install the tool, follow the steps [here](install.md).
```

Not reported:

```markdown
Follow the [installation steps](install.md).
```

`prohibitedTexts` is an array of the phrases to report, default
`["click here", "here", "link", "more"]`. They are compared as link text is
(below), in any script, and each needs at least one letter or digit; `[]`
reports nothing. Add the phrases of the languages your documents are written in,
such as `"hier"` or `"weiterlesen"`.

**Details:** text that names the destination or purpose, such as "the
installation guide", serves both kinds of reader. The whole text is compared,
without case, blank space, punctuation, or symbols, so `[Click here!]` is
`click here`. A text that says more, such as `[Read more about pricing]`, is not
reported. Inline and reference links are checked, and in Obsidian the text that
a wikilink shows: its alias, or else its target. An image's alternative text is
the text of a link around it.

**Not checked:** autolinks, which show their destination, embeds, and HTML `<a>`
elements. A link's title does not make its text descriptive: the title is the
link's description, not its name, so screen readers do not list links by it, and
other readers see it only when a mouse hovers over the link.

## `links/empty`

Reports a link or image whose destination is empty, as in `[guide]()`, or only
`#`, which leads to the top of the page. Both are usually placeholders that were
never filled in.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all.
Options: `ignoredDefinitions`.

Reported:

```markdown
See the [setup guide](#) and the [changelog]().
```

Not reported:

```markdown
See the [setup guide](#setup).
```

`ignoredDefinitions` lists the labels of definitions written as comments, as
[`links/unused-definition`](#linksunused-definition)'s option of the same name
does, with the same default, `["//"]`, and the same matching. Each rule reads
only its own option, so give both the same list when comments use other labels.

**Details:** a reference definition with such a destination is reported once, at
the definition, rather than at each reference to it. A definition written as a
comment, as in `[//]: # (comment)`, is not reported: the renderers show nothing
for it. A definition whose label a reference uses is a link, and is reported if
its destination is empty or only `#`.

**Not checked:** Obsidian wikilinks.

## `links/notation`

Converts Obsidian links between Markdown and wikilink notation. Only links whose
target exists are converted.

**Style rule**, fixed by `format`. Presets: none. Dialects: Obsidian. Options:
`style`, required.

With `"style": "markdown"`, before:

```markdown
See [[Garden/Plan|the plan]].
```

After:

```markdown
See [the plan](<Garden/Plan>).
```

The `style` option is required; without it the rule does nothing.

- `"markdown"` turns a wikilink with its own label, `[[target|label]]`, into
  `[label](<target>)`.
- `"wiki"` turns a Markdown link whose label is plain text into
  `[[target|label]]`.

**Details:** a new wikilink decodes percent escapes, because Obsidian takes its
text as the note's name: `[x](My%20Note.md)` becomes `[[My Note.md|x]]`. In a
table cell, a `|` that the rule writes, between a new wikilink's target and
label or in a new Markdown label, is escaped as `\|`, because one that is not
escaped ends the cell.

**Left as written:**

- Titles and labels with formatting.
- Wikilinks without a label, which show their target as text, and embeds: a note
  embed is not the same thing as a Markdown image.
- A destination that does not decode, or whose name would hold `|`, `[`, `]`,
  `#`, or `^`.

**With other rules:** with [`links/path`](#linkspath) also on, a link that both
change gets its notation first and its path in the next pass, the same result as
running them one after the other.

## `links/path`

Rewrites the destination of a local link to the configured spelling, such as a
path relative to the linking document or from the vault's root. A link is
rewritten only when its target exists and its fragment, if any, is found, and
only when the new destination leads to the same file and fragment.

**Style rule**, fixed by `format`. Presets: none. Dialects: all; some options
Obsidian only. Options: `style`, `brackets`, `extension`, `leadingDot`.

With `{ "style": "relative", "leadingDot": true }` in `README.md`, before:

```markdown
See the [guide](docs/guide.md#setup).
```

After:

```markdown
See the [guide](./docs/guide.md#setup).
```

| Option       | Values                                             | Default      |
| ------------ | -------------------------------------------------- | ------------ |
| `style`      | `"preserve"`, `"relative"`, `"root"`, `"shortest"` | `"preserve"` |
| `brackets`   | `"preserve"`, `"angle"`, `"bare"`                  | `"preserve"` |
| `extension`  | `"preserve"`, `"include"`, `"omit"`                | `"preserve"` |
| `leadingDot` | `true` or `false`                                  | `false`      |

- `style`: `relative` counts the path from the linking document. `root` writes
  it vault-relative, that is from the vault's root directory, without a leading
  slash. `shortest` writes only the note's name when that name finds the same
  note, and otherwise the vault-relative path. `root` and `shortest` apply in
  the Obsidian dialect only.
- `brackets`: `angle` writes the destination in `<…>`; `bare` writes it without,
  with spaces percent-encoded.
- `extension`: whether the path to a Markdown file ends in `.md`. `omit` applies
  in the Obsidian dialect only.
- `leadingDot`: with `relative`, start a path with `./` when it does not start
  with `./` or `../`, also a path to a name that starts with a dot, such as
  `./.gitignore`.

**Details:** a relative path also gets `./` when it would otherwise name a
different file at the vault's root. A destination that already has the
configured spelling keeps its percent-encoding; a new path encodes `%` and `#`,
so that it names the same file, and in a table cell writes a `|` in a name as
`\|`, because one that is not escaped ends the cell. In a wikilink only the
destination changes: the `|` or `\|` after it, the label, and an embed's size
stay as written. Absolute filesystem paths are never written.

**Left as written:**

- A wikilink without a label, whose target is also its visible text.
- Reference definitions, which are checked but not rewritten.
- Autolinks.
- Links whose target is uncertain because a directory could not be read or the
  workspace root is only part of a vault (see [Obsidian
  vaults](obsidian.md#a-workspace-root-inside-a-vault)).

## `links/reversed`

Reports likely reversed links such as `(text)[https://example.com]`. Fixing one
would turn literal text into a link, so there is no automatic repair.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
See (the guide)[./guide.md].
```

Not reported:

```markdown
See (the guide)[guide].

[guide]: ./guide.md
```

**Details:** the bracketed part must contain no whitespace or brackets and look
like a destination: a scheme followed by `://`, `mailto:`, an email-like
address, a slash anywhere, a leading `#`, or a final dot extension of one to ten
ASCII letters or digits, starting with a letter (optionally followed by a query
or fragment).

**Not checked:**

- A parenthesis immediately after an identifier character (a Unicode letter,
  number or combining mark, `_`, or `$`), which is call or subscript syntax, as
  in `f(x)[i.j]`.
- Defined labels, matched with the renderer's Unicode case folding and
  whitespace normalization.
- Citations such as `(Smith 2020)[1]`, cross-references such as
  `(see above)[note]`, versions such as `(see)[v1.2]`, and numeric references
  such as `(see)[p.12]` and `(1, 2)[0.5]`.
- Footnotes, wikilinks, task markers, code, math, HTML, text inside authored
  links and destinations, and parentheses inside a bare URL, such as
  `https://example.com/(a)[b.md]`.

## `links/text-spacing`

Reports a link whose text starts or ends with blank space, as in
`[ the guide ](guide.md)`. The space is part of the link, so renderers underline
it with the text, and readers can click it.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
See [ the installation guide ](install.md) first.
```

Not reported:

```markdown
See [the installation guide](install.md) first.
```

**Details:** inline links and full, collapsed, and shortcut references such as
`[ the guide ][guide]` and `[ guide ]` are checked; a reference still matches
its definition without the spaces, because renderers compare labels without the
blank space at their ends.

Moving the spaces outside the brackets changes the text of the link, which the
[safety check](design.md#safety-model) compares as part of the document's
meaning, and where they belong depends on the text around the link:
`see[ the guide ](guide.md)` needs a space before the brackets to keep `see`
apart from the link, `([ the guide ](guide.md))` reads best with none, and
`**[ the guide ](guide.md)**` would lose its strong text with a space just
inside the `**`. So the rule only reports, and the edit is left to the writer.

**Not checked:** images, because their text describes the image and is not shown
with it, Obsidian wikilinks and embeds, footnote references, task markers, alert
and callout markers, autolinks, HTML `<a>` elements, and links whose text is
only blank space.

## `links/undefined-reference`

Reports a reference whose label has no definition in the document: a full
reference `[text][label]`, a collapsed reference `[label][]`, and, in every
dialect but CommonMark, a footnote reference `[^label]`. The renderer shows such
a reference as plain text, brackets and all.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all;
footnotes all but CommonMark. Options: `shortcutSyntax`, `ignoredLabels`.

Reported, when neither a definition `[setup]: …` nor a footnote `[^1]: …`
exists, and with `shortcutSyntax`, also at `[Enter]`:

```markdown
See the [installation guide][setup] and [setup][].[^1] Press [Enter].
```

Not reported, with the default options:

```markdown
See the [installation guide][Setup] and press [Enter].

[setup]: install.md
```

| Option           | Values             | Default |
| ---------------- | ------------------ | ------- |
| `shortcutSyntax` | `true` or `false`  | `false` |
| `ignoredLabels`  | An array of labels | `[]`    |

- `shortcutSyntax`: with `true`, also report a shortcut reference whose label
  has no definition: brackets that hold a label and are not followed by `[]` or
  another label, as CommonMark reads them, such as `[Enter]`. It leaves alone
  the brackets listed below.
- `ignoredLabels`: labels not to report, of any kind of reference; `[]` ignores
  none. Write a footnote's label with its `^`, as in `^draft`. markdownlint's
  MD052 ignores `x` by default for task marks, which `shortcutSyntax` already
  leaves alone at the start of a list item.

**Details:** labels match as the renderer matches them, without regard to case
or to how much blank space separates words, also in `ignoredLabels`. A run of
brackets such as `[a][b][c]` is reported once, at its start.

**Not checked:** a shortcut reference, `[label]` alone, unless `shortcutSyntax`
is on, because brackets in prose are usually just brackets. Neither are brackets
directly after a letter, digit, `_`, or `)`, as in `matrix[i][j]`, which are
indexes rather than references, nor brackets in code, math, HTML, or links, nor
escaped ones (`\[`).

**With `shortcutSyntax`:** brackets that mean something else where they stand
are still not reported:

- A task mark that starts a list item where the parser reads none, `[ ]`, `[x]`
  or `[X]`, and in Obsidian any one character, such as a custom status `[/]`.
- An alert or callout marker such as `[!NOTE]` that starts a block quote.
- An Obsidian inline footnote `^[note]`.
- A Forgejo or Gitea shortlink `[[Page]]`.
- Text inside an inline HTML element, as in `<kbd>[Enter]</kbd>`. An element
  stays open until its end tag, except a void element such as `<br>`: a browser
  ignores the `/` in `<span/>`, which closes an element only in VitePress, whose
  HTML Vue renders.
- A URL written as text, such as `https://example.com/[id]`. A URL runs from its
  scheme or `www.` to blank space or a `<`, as GFM's autolink literals read it:
  a scheme may follow any character that is not part of it, as in
  `(https://example.com/[id])` or a quoted URL, while `www.` must start the text
  or follow blank space or one of `(*_[]~`.

## `links/unused-definition`

Reports a reference definition or footnote that no reference in the document
uses. A second definition of the same label is reported too, because the
renderers use the first.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all.
Options: `ignoredDefinitions`.

Reported, at `[old-setup]`:

```markdown
See the [guide][setup].

[setup]: install.md
[old-setup]: old/install.md
```

Not reported:

```markdown
See the [guide][setup] and the [changelog].

[setup]: install.md
[changelog]: CHANGELOG.md
[//]: # (Update the changelog link at each release.)
```

`ignoredDefinitions` is an array of labels whose definitions are comments rather
than links, as in `[//]: # (comment)`, which the renderers do not show. Its
default, `["//"]`, covers that common form. A configured array replaces the
default, so include `"//"` to keep it; with `[]`, no label is a comment. Labels
match as the renderers match them, without regard to case or to how much blank
space separates words; backslash escapes count as written, so `[\/\/]` is
another label.

**Details:** a definition that only a shortcut reference `[label]` uses counts
as used. GitHub leaves footnotes that nothing references off the page.
Definitions with an ignored label are not reported, however many there are,
while no reference uses their label; a reference such as `[//]` makes them
links, which are reported as any others are. The option applies to link
definitions, not footnotes: a footnote shows its text, so an unreferenced one is
reported whatever its label.

**With other rules:** [`links/empty`](#linksempty) takes the same option.

## `links/valid`

Reports a local link, image, wikilink, embed, or reference definition whose
target does not exist, and a fragment (`#heading`, `#^block`) that its target
does not have. A target that is missing or ambiguous is reported, never guessed.

**Problem rule**, reported only. Presets: `recommended` (error). Dialects: all.
Options: `ignoredFragments`, `exactCase`.

Reported when `docs/guide.md` does not exist, or has no heading named "Setup":

```markdown
See the [guide](docs/guide.md#setup).
```

| Option             | Values                            | Default |
| ------------------ | --------------------------------- | ------- |
| `ignoredFragments` | A regular expression, as a string | `""`    |
| `exactCase`        | `true` or `false`                 | `false` |

- `ignoredFragments`: a JavaScript regular expression for fragments that are not
  checked, such as `"^figure-"` for anchors that a site generator adds. It is
  tested, without flags, against the fragment after `#` with its percent escapes
  decoded, such as `^id` for a block reference. A matching fragment is neither
  reported missing nor reported as not checkable, while its file still has to
  exist. The default, `""`, ignores none. A pattern that is not a valid regular
  expression is a configuration error.
- `exactCase`: with `true`, also report a fragment whose letter case differs
  from the anchor it reaches, for documents that are read in more than one
  renderer; it is reported with the anchor as the target spells it. By default a
  fragment is matched as the dialect's renderer matches it: GitHub and
  CommonMark ignore case, so `#Setup` reaches `## Setup`, whose anchor is
  `#setup`, and Obsidian ignores the case of headings. Forgejo, Gitea, and
  Obsidian block identifiers match exactly, so the option adds nothing there; in
  VitePress, which passes a fragment through its slugger, only a fragment that
  differs from an anchor in case alone is reported. Anchors are still generated
  per dialect, as [heading anchors](dialects.md#heading-anchors) describes.

**Messages:**

| Message                                  | Meaning                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Missing local target: …`                | No file matches.                                                                                             |
| `Ambiguous local target: …`              | Several files match, such as two notes whose names differ only by case.                                      |
| `Missing fragment in …`                  | The target exists but has no such heading, block, or anchor.                                                 |
| `Local target is a directory: …`         | Obsidian Markdown links only; other dialects accept a link to a directory, which a site can serve.           |
| `Local target is outside the vault: …`   | Obsidian only: the path leaves the note's vault, where Obsidian cannot follow it.                            |
| `Local target could not be checked: …`   | A directory that may hold it could not be read, the root is only part of a vault, or a link leaves the root. |
| `Fragment could not be checked: …`       | The target exists but could not be read, or its anchors are not fully known.                                 |
| `Fragment in … differs in letter case …` | With `exactCase` only: the fragment reaches its anchor because the renderer ignores case.                    |

**Details:**

- The anchors that a fragment can reach depend on the dialect; see [heading
  anchors](dialects.md#heading-anchors). Only a Markdown file's fragments are
  checked: an image, a PDF, or a source file accepts any, such as
  `#gh-dark-mode-only`, `#page=2`, or `#L10-L20`.
- `Fragment could not be checked` also reports a readable target whose
  renderer-dependent anchor information is incomplete. It does not claim the
  fragment is missing; verified headings or explicit HTML IDs remain checkable.
- A link into a directory that the CLI does not visit, such as `dist`, or
  through a symbolic link is checked on disk; see [ignored
  files](configuration.md#ignored-files-and-link-targets).

**Not checked:** URLs with a scheme, such as `https:`, which are never fetched.
Outside the Obsidian dialect, neither is a destination that starts with `/` or
contains `?`, which depends on the website.

**On GitHub:** file fragments follow the native Markdown reading of dollar-math
source. Heading IDs can include dollar-delimited lines above a Setext title, and
inline markup or HTML inside such source can supply anchors too. Duplicate
numbering uses that complete reading after the YAML front matter choice; the
formatter's math reading stays the same.

**In Obsidian:** links resolve as in Obsidian: a path that starts with `./` or
`../` counts from the note; otherwise an exact path from the vault's root comes
first, then an exact path from the note, then a note found by its name or by the
end of its path. Several matches at the first level that finds any are
ambiguous. A wikilink never resolves to a directory, so the search goes on to a
note of that name. Note names and headings match without regard to case; block
identifiers match exactly. A heading matches by the text it shows or as its
source writes it, such as ``#`move` `` for ``### `move` ``, and `#Setup#Mobile`
names a heading below another one.

## `obsidian/block-reference`

Reports a block identifier that a note uses more than once. A link to `#^id` can
reach only one of them.

**Problem rule**, reported only. Presets: `obsidian` (error). Dialects:
Obsidian. Options: none.

Reported, on the second paragraph:

```markdown
First idea. ^idea

Second idea. ^idea
```

**Details:** a block identifier is `^` and Latin letters, digits, and hyphens at
the end of a paragraph or heading, or alone on the line after a list or quote,
as Obsidian defines it.

## `obsidian/callout-marker`

Writes the type of an Obsidian callout in lowercase, custom types included.

**Style rule**, fixed by `format`. Presets: `obsidian` (warn). Dialects:
Obsidian. Options: none.

Before:

```markdown
> [!TIP] Reading the notes
```

After:

```markdown
> [!tip] Reading the notes
```

**Left as written:**

- The title and the body.
- A marker written with an escape or a character reference, such as `\[!TIP]`.
- A marker that Obsidian shows as text because more than one space or a tab
  separates it from the quote's `>`, as in `>  [!TIP]`.

## `obsidian/strict-line-breaks`

Reports, once per note, that `style/wrap` leaves the note as written because the
vault's "Strict line breaks" setting is not known to be on. Without that
setting, Obsidian's Reading view shows every line break in a paragraph, so
joining or breaking lines would change what the note looks like.

**Problem rule**, reported only. Presets: `obsidian` (warn). Dialects: Obsidian.
Options: none.

Not reported in a vault whose `.obsidian/app.json` holds:

```json
{ "strictLineBreaks": true }
```

**Details:** the tool reads the setting and never changes it. The finding is at
line 1, and its message begins
`Obsidian's "Strict line breaks" setting is not known to be on`. See [Obsidian
vaults](obsidian.md#enable-wrapping).

## `structure/duplicate-heading`

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

**Details:** headings are compared by their text as the reader sees it:
formatting does not count, case does. As for `structure/heading-increment`, the
headings of a block quote or a footnote are checked among themselves, also with
`siblingsOnly: false`.

**Not checked:** the same heading under different parents, as in a guide with a
section per platform, unless `siblingsOnly` is `false`.

## `structure/emphasis-heading`

Reports a paragraph that consists only of emphasized or strong text, such as
`**Installation**`, which reads as a heading but is not one: the outline and a
table of contents leave it out, links cannot reach it by an anchor, and screen
readers do not announce it as a heading. If it names a section, make it a
heading.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`punctuation`.

Reported:

```markdown
**Installation**

Run the installer.
```

Not reported:

```markdown
## Installation

Run the installer.

**Close other programs first.**
```

`punctuation` is a string of characters: text that ends with one of them is a
sentence, and is not reported. The default, `.,;:!?。，；：！？`, is
markdownlint's; with `""`, such text is reported whatever it ends with.

**Details:** making the paragraph a heading changes the outline, so the rule
only reports. Only the document's own paragraphs are checked, whatever their
length and however their lines wrap. The emphasis may hold text, code, math,
strikethrough, Obsidian highlights, and further emphasis. HTML tags and comments
beside it do not count, nor does an Obsidian block identifier such as `^setup`
after it.

**Not checked:**

- Emphasized text in a list item, block quote, callout, alert, VitePress
  container such as `::: tip`, table cell, or footnote, where it labels the
  content beside it.
- A paragraph with a link, an image, or a line break inside the emphasis, or
  other text beside it.

## `structure/heading-increment`

Reports a heading more than one level deeper than the heading before it, such as
a level-3 heading directly after a level-1 heading. Readers who move through a
document by its headings, with a screen reader or a table of contents, rely on
the levels to show how sections nest.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all.
Options: `frontMatterTitle`.

Reported:

```markdown
# Install

### Requirements
```

Not reported:

```markdown
# Install

## Requirements

> [!NOTE]
>
> ### Older versions
```

`frontMatterTitle` treats a title in YAML or TOML front matter as a level-1
heading before the document's first heading, which may then be at most level 2,
as for a site generator that shows the title as the page's heading. It takes the
values and matching of
[`structure/initial-heading`](#structureinitial-heading)'s option of that name:
`true` for a top-level `title` key, a regular-expression string for another
field, and `false` or `""` for none. The default is `false`, because GitHub,
Forgejo, Gitea, Obsidian, and VitePress do not show a front-matter title as a
heading in the document, so its outline starts at the first heading.

**Details:** the first heading may have any level, unless `frontMatterTitle`
counts a title before it. The headings of a block quote, which is also how
callouts and alerts are written, and of a footnote are checked among themselves:
a callout can start with a level-3 heading under any heading, and its headings
do not count for the document's. A front-matter title belongs to the document's
own outline, not to its quotes and footnotes.

**With other rules:** counting the level-1 headings below a title is
[`structure/single-title`](#structuresingle-title)'s check.

## `structure/heading-punctuation`

Reports a heading whose text ends with sentence punctuation, as in
`## Installation.` or `## Options:`. A heading is a title, not a sentence.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`punctuation`.

Reported:

```markdown
## Installation.
```

Not reported:

```markdown
## Why does it need a configuration file?

## Plugins, tools, etc.
```

`punctuation` is a string of the characters to report. The default,
`.,;:!。，；：！`, is markdownlint's: it leaves out `?`, with which the
questions of an FAQ end. `""` reports nothing.

**Details:** removing the character would change the heading's anchor, which
links may use, so the rule only reports. The text is read as its renderer shows
it. A character reference counts as the character it shows: `&copy;` is not
punctuation, and `&#46;` is a period. A closing `#` sequence, a comment, or a
footnote reference after the text does not count, and neither does a trailing
attribute block such as `{#setup}` in Forgejo, Gitea, and VitePress, which read
it as the heading's attributes, or a block identifier such as `^setup` in
Obsidian. With VitePress's [`attrs`](vitepress.md#renderer-options) setting
off, the block is text and counts. The text before such a suffix counts even
when it is formatted, as in `## **Use.** ^usage`.

**Not checked:** a heading that ends with code, math, an image, an autolink, or
an Obsidian embed, nor these endings:

- an emoji shortcode such as `:tada:`, whose colon closes the shortcode;
- an ellipsis of three or more periods;
- the period of an abbreviation: initials such as `e.g.`, `U.S.`, or `Ph.D.`,
  and `etc.`, `et al.`, `cf.`, `vs.`, `viz.`, `approx.`, `Inc.`, `Ltd.`, `Co.`,
  `Corp.`, `Jr.`, and `Sr.`, in any case. Use a [suppression
  comment](configuration.md#suppression-comments) for another abbreviation.

## `structure/heading-template`

Requires the document's headings to follow a configured sequence, such as a
guide's required sections. It reports the first heading that cannot continue a
match, or the end of the document when a required heading is missing, with the
heading or headings expected there, and never inserts, removes, or renames a
heading.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`headings`, `matchCase`.

With `{ "headings": ["# Guide", "*", "## Notes"] }`, reported:

```markdown
# Guide

## Install

## Usage
```

Not reported:

```markdown
# Guide

## Install

## Notes
```

| Option      | Values                                     | Default |
| ----------- | ------------------------------------------ | ------- |
| `headings`  | An array of `#` headings and `*`, `+`, `?` | Unset   |
| `matchCase` | `true` or `false`                          | `false` |

- `headings`: the sequence. A heading entry is written as an ATX heading with
  its level, such as `## Notes`. `*` matches zero or more headings of any text,
  `+` one or more, and `?` exactly one. Unset turns the check off; `[]` requires
  that the document have no headings.
- `matchCase`: with `true`, capitalization must match too.

Use [overrides](configuration.md#overrides) to apply a template to one group of
files:

```json
{
  "overrides": [
    {
      "files": ["guides/**/*.md"],
      "rules": {
        "structure/heading-template": [
          "error",
          { "headings": ["# Guide", "*", "## Notes"], "matchCase": false }
        ]
      }
    }
  ]
}
```

**Details:** the sequence follows the document's own outline, including headings
in lists. Block quotes and footnotes have outlines of their own and do not take
part, so a quoted example or a footnote need not follow the page's template.
Headings are compared by their rendered text, with whitespace collapsed and
inline Markdown, escapes, and character references read; closing `#` sequences
are syntax. Wildcards are matched by tracking the possible positions in the
template rather than by backtracking, so the time grows with the template's
length times the number of headings.

**In Forgejo, Gitea, and VitePress:** a trailing attribute block such as
`{#setup}` is not part of the heading's text where the dialect reads it as the
heading's attributes. In other dialects it stays text.

**In Obsidian:** a block identifier such as `^setup` is not part of the
heading's text.

## `structure/initial-heading`

Requires the first block of a document, after optional YAML or TOML front
matter, to be a level-1 heading. Underlined (`===`) headings count as well as
`#` headings.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: `level`,
`allowPreamble`, `frontMatterTitle`.

Reported:

```markdown
Some text before the title.

# Title
```

Not reported:

```markdown
---
title: Notes
---

# Notes
```

| Option             | Values                                             | Default |
| ------------------ | -------------------------------------------------- | ------- |
| `level`            | An integer from 1 to 6                             | `1`     |
| `allowPreamble`    | `true` or `false`                                  | `false` |
| `frontMatterTitle` | `true`, `false`, or a regular expression as string | `false` |

- `level`: the required heading level.
- `allowPreamble`: with `true`, prose and comments may precede the first
  top-level Markdown heading, which must have that level. A document with no
  heading is still reported unless a recognized front-matter title satisfies the
  check.
- `frontMatterTitle`: the default, `false`, requires a body heading even when
  metadata contains a title. `true` lets a top-level YAML or TOML `title` key
  satisfy the check; a JavaScript regular-expression string such as
  `"^page_name\\s*[:=]"` recognizes a different field. The pattern matches the
  front matter's contents, without its delimiters, in multiline mode; it does
  not match the body. An invalid pattern is a configuration error. `false` or
  `""` disables title recognition. The same setting is available on
  `structure/single-title`, with a different default, and on
  `structure/heading-increment`, with the same default.

**Details:** an empty document is reported. Comments and other content before
the title are not skipped. A heading inside a list or quote does not supply the
document's initial heading. The default title detector matches a literal `title`
key, optionally quoted: in column 1 for YAML, or before the first table header
in TOML, where indentation is allowed. It matches text rather than parsing the
metadata; use a custom pattern for other textual forms. Use
[overrides](configuration.md#overrides) to exempt generated documents.

**With other rules:** [`style/heading`](#styleheading) turns underlined headings
into `#` headings.

## `structure/single-title`

Reports a second level-1 heading in a document. A document has one title, and
further level-1 headings usually belong one level down.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: `level`,
`frontMatterTitle`.

Reported:

```markdown
# Install

# Configure
```

Not reported:

```markdown
---
title: Install
---

## Requirements
```

| Option             | Values                                             | Default |
| ------------------ | -------------------------------------------------- | ------- |
| `level`            | An integer from 1 to 6                             | `1`     |
| `frontMatterTitle` | `true`, `false`, or a regular expression as string | `true`  |

- `level`: the title heading's level.
- `frontMatterTitle`: with `true`, a top-level YAML or TOML `title` key counts
  as the title, and every level-1 heading is then reported. Set it to `false` or
  `""` when metadata does not supply a rendered title, or use a
  regular-expression string to recognize another field, with the same matching
  contract as [`structure/initial-heading`](#structureinitial-heading).

**Details:** as for `structure/heading-increment`, the headings of a block quote
or a footnote are checked among themselves. A metadata title belongs only to the
document's own outline, not its quotes or footnotes.

## `structure/split-quote`

Reports a blank line between two block quotes with nothing else between them.
GitHub, Forgejo, Gitea, Obsidian, VitePress, and CommonMark show two quotes,
while some other renderers join them into one, and the blank line may have been
meant to separate paragraphs of one quote.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
> Back up the database first.

> Then run the migration.
```

Not reported:

```markdown
> Back up the database first.
>
> Then run the migration.

> [!NOTE]
> Migrations run in a transaction.

> [!WARNING]
> Old backups cannot be restored.
```

**Details:** to write one quote, start the blank line with `>`; to keep two, put
text or a comment, such as `<!-- -->`, between them. Either changes what
renderers show, so the rule only reports. Quotes inside a list item or another
quote are checked among their siblings. A plain quote after an alert is
reported: its text may have been meant as part of the alert.

**Not checked:** a quote whose first line opens with an alert's or callout's
marker, such as `[!NOTE]` or `[!tip]`, after a blank line, because a blank line
is the only way to write two alerts or callouts one after the other. The marker
shows the quote's intent in every dialect.

## `structure/unspaced-heading`

Reports text that would be an ATX heading with a space after its hashes, such as
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

**In Obsidian:** `#` and a word is a tag, as in `#project text`, and is not
reported.

## `style/blank-lines`

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

**In Obsidian:** a line of blank space that holds a tab, or that lies directly
below an HTML block, is not blank: Obsidian's Reading view reads it as more of
the paragraph or block above it. Blank quote rows between consecutive blocks
opened by a Tab directly after `>` or `> ` stay too: Reading view reads those
blocks and their blank rows as one literal code block. A later ordinary quoted
paragraph still permits blank-line cleanup and inline preferences.

**With other rules:**

- [`style/final-newline`](#stylefinal-newline) adds the line break at the end
  where it is missing.
- A configuration whose [`style/block-spacing`](#styleblock-spacing) asks for
  more blank lines around a heading than `maximum` allows is refused when it is
  read, unless one of the two rules is off: each rule would undo the other's
  edits.

## `style/block-spacing`

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
  which [`style/blank-lines`](#styleblank-lines) limits. `0` and `-1` need none,
  so that only a list, a fenced code block, or a table next to such a heading
  still gets its own blank line. Between two headings, the larger count applies.
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
which has no tables, it is all one paragraph.

**Left as written:** places where a blank line would change what the document
means or what a comment applies to:

- Blocks inside a list item or a footnote definition. A blank line between the
  blocks of a list item makes the list loose, which changes how it renders.
- Front matter and the block below it, apart from a heading with
  `includeFrontMatter`.
- A boundary inside a paragraph or underlined heading in the reading without
  TOML front matter, such as `1.` and `2) b` directly below its closing `+++`
  fence. A blank line there would make a list from text.
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
  works](design.md#safety-model)).
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

**On GitHub:** dollar display math and a Setext title directly below it stay
together. They can form one native heading or continue a list or quote
paragraph.

**On Forgejo and Gitea:** a table directly below the text of a definition
description, as in `Term`, `: Description`, and a table below them, stays there.
Those renderers put the table in the description.

**In VitePress:** the site generator reads front matter itself, so with
`includeFrontMatter` nothing is added directly against the closing line; blank
lines that are already there can be added to.

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
  [boundary protections](obsidian.md#boundary-protections).
- Text directly above or below a fenced code block, which its views can read
  together, and a line below a table that one of its views reads as part of the
  table. The [boundary policy](obsidian.md#visible-boundary-refusals) reports
  these places without changing them.

## `style/code-block`

Writes code blocks in one form, fenced or indented, and reports those in the
other. It converts indented code to fences where the dialect permits that
change; other findings are reported only. No preset enables it, so default
formatting stays the same.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`style`.

With `{ "style": "fenced" }`, before:

```markdown
    npm test
```

After:

````markdown
```
npm test
```
````

| Option  | Values                             | Default      |
| ------- | ---------------------------------- | ------------ |
| `style` | `consistent`, `fenced`, `indented` | `consistent` |

- `style`: `consistent` takes the form of the document's first parsed code
  block, `fenced` requires fences, and `indented` requires indentation.

**Details:** a conversion keeps the code, including its tabs and the blank lines
inside it, and the block's list or quote container. The new backtick fence is
longer than any run of backticks in the code.

**Reported without a fix:**

- A fenced block where the indented form is required: indentation cannot keep a
  language or metadata, and can change blank lines or where an adjacent
  paragraph ends.
- An indented block in a container whose prefix holds a tab, because removing
  indentation can change its tab stops.
- An indented block that a renderer protects.

**Not checked:** continuation paragraphs in list items and footnotes, which are
text, not code blocks.

**In VitePress:** indented blocks are reported without conversion, which keeps
the protection of opaque code and VitePress's distinct rendering of fenced code.
Line highlighting and `::: code-group` syntax stay intact.

**With other rules:** [`style/code-fence`](#stylecode-fence) chooses the marker
and length of existing fences, independently of this rule.

## `style/code-fence`

Writes the fences of a fenced code block with one marker, and as long as its
content allows: three characters, or one more than the longest line inside that
holds only the marker, which would otherwise close the block. It also removes
spaces and tabs between the opening fence and its info string.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

Before:

```markdown
~~~  sh
npm test
~~~
```

After:

````markdown
```sh
npm test
```
````

`marker` is ``"```"`` (the default), `"~~~"`, or `"consistent"`, which takes the
marker of the document's first fence.

**Details:** the info string's text and metadata, and the code content, stay as
written; nested fences keep the outer fence long enough to contain them.

**Left as written:** indented code blocks, which have no fence, and a `~~~`
fence whose info string contains a backtick, because a backtick fence cannot
have one.

**With other rules:** [`content/code-language`](#contentcode-language) reports a
fence without a language; neither rule adds one.

## `style/definition-spacing`

Writes one space after a link reference definition's colon and one before its
title, without changing the label, destination, or title. A definition with no
space after the colon, such as `[guide]:guide.md`, gets one. It is an optional
source style, so no preset enables it and default formatting stays the same.

**Style rule**, fixed by `format`. Presets: none. Dialects: all but Obsidian.
Options: none.

Before:

```markdown
[guide]:   <guide.md>   "Guide"
```

After:

```markdown
[guide]: <guide.md> "Guide"
```

**Left as written:**

- a multiline definition, including a multiline label or title: joining could
  change wrapping or how a container reads it;
- a footnote, or a label that starts with `^`, also in CommonMark;
- a definition containing a tab, because commonmark.js reads a tab-separated
  definition as text where GitHub and markdown-it read a definition.

**In Obsidian:** definitions keep their spacing, since Live Preview styles these
lines separately from Reading view.

**With other rules:** independent of [`links/path`](#linkspath), which needs a
workspace and changes destinations.

## `style/emphasis`

Writes emphasis with one marker, `_` by default.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

Before:

```markdown
Use *emphasis* sparingly, as in un*believ*able.
```

After:

```markdown
Use _emphasis_ sparingly, as in un*believ*able.
```

`marker` is `"_"` (the default), `"*"`, or `"consistent"`. With `"consistent"`,
the first parsed emphasis in the document chooses the marker, including emphasis
inside a word, so a document starting with `un*believ*able` uses `*` for later
emphasis too, and `*first* and _later_` becomes `*first* and *later*`. Each
document chooses independently, including when the first node cannot safely
change. Code, HTML blocks, and Obsidian wikilinks do not choose a marker.

**Details:** with `_`, emphasis inside a word keeps `*`, because `_` cannot mark
emphasis there.

**Left as written:** markers where new ones could change how the text parses,
and the exceptions of [Forgejo and Gitea](dialects.md#forgejo-and-gitea):

- A new marker that would touch another `*` or `_`, or be separated from one
  only by `~`.
- Text with a `*` or `_` that did not pair, as in `*a _b* c_`, or with a run of
  markers that two emphases share, as in `*****a***`. There markers change only
  where the rule can tell that every pair stays the same.
- The text of a collapsed or shortcut reference, such as `[*Title*][]` or
  `[*Title*]`, which is also its label, and text in brackets that would match a
  definition's label with the new markers.
- A marker right after a `$` on GitHub, Forgejo, and Gitea, where a `_` after
  the dollar decides whether dollar math ends there.
- Emphasis that begins on the line of an alert's or a callout's marker and ends
  below it.
- Emphasis whose text holds a run of tildes that could mark strikethrough, one
  or two tildes or in Obsidian two, while the paragraph holds another: GitHub
  can read strikethrough there and the markers as text.
- A `_`, old or new, that only tildes separate from a letter or digit, as in
  `x~~_b_~~`, which GitHub reads as inside a word.
- Text whose markers CommonMark pairs otherwise than the parser, as in
  `xab***a* a*y`: GitHub follows CommonMark, so the parser misread the text.

**In Obsidian:** a paragraph, heading, or table cell whose text holds a `*` or
`_` that is not a marker, as in `snake_case` or `5 * 3`, keeps its markers.
Obsidian's Reading view pairs such a character with a later one, so
`snake_case and _em_` shows `case and _em` as emphasis, and
`snake_case and *em*` is right only with the `*` kept. Escaped characters and
those in code, math, or wikilinks do not count.

## `style/final-newline`

Ends a document that is not empty with a line break, using the document's own
line ending. A file whose last line has no line break is changed; an empty file
is not.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: none.

Before, a document with Windows line endings, written as a JavaScript string,
whose last line has none:

```js
"# Notes\r\n\r\nThe last line."
```

After, the same line ending, `\r\n`, ends the last line too:

```js
"# Notes\r\n\r\nThe last line.\r\n"
```

**Left as written:** a document whose added line break would become part of the
last block: an HTML comment or another HTML block without its end marker, an
Obsidian comment without its closing `%%`, or a code or math block without its
closing fence whose last line is blank space.

**In Obsidian:** nothing is added either where the document ends in a fenced
code block without its closing fence, outside a list item or block quote:
Reading view shows the line break as one more, empty line of the code. An HTML
block opened in a list or quote can also lead Live Preview into code that the
parser does not recognize; the original end stays where that code's closing
boundary is uncertain.

## `style/heading`

Writes headings in one style, by default as `#` headings without closing `#`
sequences, with one space after the opening hashes and no indentation.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `style`, `closing`.

Before:

```markdown
Installation
------------

##  Usage  ##
```

After:

```markdown
## Installation

## Usage
```

| Option    | Values                              | Default    |
| --------- | ----------------------------------- | ---------- |
| `style`   | `"atx"`, `"setext"`, `"consistent"` | `"atx"`    |
| `closing` | `"remove"`, `"keep"`, `"add"`       | `"remove"` |

- `style`: `atx` writes `#` headings, turning a heading underlined with `===` or
  `---` into a `#` heading of the same level. `setext` underlines headings of
  levels 1 and 2 and keeps `#` for deeper levels, which cannot be underlined.
  `consistent` follows the document's first heading: `setext` when it is
  underlined, otherwise `atx`.
- `closing`: `remove` removes the closing sequence of a `#` heading with the
  blank space around it. `keep` retains existing closing sequences, with one
  space between them and the text, and adds none. `add` writes a closing
  sequence matching the heading's level, with one preceding space, and
  normalizes existing sequences to that length: `### Details` becomes
  `### Details ###`, and an empty `##` becomes `## ##`. Both also apply to
  headings kept in ATX form by `setext` and `consistent`; with
  `style: "setext"`, levels 1 and 2 remain underlined.

**Details:**

- An ATX heading gets one space between its opening hashes and its text, also
  where a tab separated them; an empty heading needs none. This applies to
  headings kept in ATX form with `setext` or `consistent` too.
- One to three spaces of heading indentation are removed, also on Setext text
  and underline lines, without an option. Required list and quote prefixes stay
  as written; only spaces beyond those prefixes are removed. Indented code is
  not a heading.
- A trailing run of `#` in the text of an underlined heading is escaped, so that
  it is not taken for a closing sequence, also before a new closing sequence.

**Left as written:**

- Ambiguous container prefixes, and a heading that a renderer protection covers
  in part, which keeps all of its indentation and its form, such as an Obsidian
  Setext title whose indented underline or reference-like first line a view
  reads differently.
- The form of underlined headings of more than one line, those inside lists or
  block quotes, and one directly below TOML front matter, whose lines renderers
  without TOML front matter read as part of the heading.

**With `setext`:** a `#` heading is underlined only where its text can stand on
a line of its own as the same heading: at the start of a line of the document,
not in a list or block quote, below a blank line or at the start of the
document, because directly below text its line would continue the paragraph. It
keeps its `#` when its text starts like another block, such as a list item,
block quote, thematic break, fence, HTML, or link reference definition, when it
contains `|`, which `---` below it could make a table, or when it ends with a
backslash, and on Forgejo and Gitea when it contains `{`. Below a first line of
`---` that no line closes, a level-2 underline has at least four `-`, because
`---` would close it as front matter.

**On GitHub:** an existing Setext title directly after dollar display math stays
as written, because the dollar lines belong to that native heading too. A blank
line or interrupting block between them permits heading preferences again. Where
text below a list or quote ending in math continues that native container, the
source boundary stays together too.

**On Forgejo and Gitea:** a closing sequence after an attribute block such as
`{#id}` stays, because Gitea before 1.26 reads the block only when the sequence
follows it. The block and its suffix, including the spacing before that
sequence, stay as written; the opening separator can still be normalized. With
`closing: "add"`, no sequence is added after such an attribute block either.

**In Obsidian:**

- An underlined title whose text ends in a run of `#` keeps its Setext form
  instead of being escaped: the escaped ATX form can reveal hashes in Live
  Preview. Inline title formatting remains available. Tight, already escaped,
  code-span, and nonterminal hashes still allow conversion.
- A heading keeps its form when a title line begins directly with math or its
  only content is an image or embed: ATX and Setext can give those widgets
  different typography or placement. A kept Setext heading keeps its complete
  source; mixed text before math, wrapped math, and images beside ordinary title
  text remain eligible. Independent blocks below the heading still get their
  spacing, inline formatting, and table or list preferences.
- A Setext title directly after a standalone Obsidian comment keeps its
  underline, since conversion can turn Reading-view paragraph text into a
  heading. Inline title formatting remains available, and a blank line between
  them permits heading conversion.

## `style/inline-code`

Writes each code span with the fewest backticks that its content allows, and
joins a code span that is written across lines onto one line. Some editors, such
as Obsidian's Live Preview, show a split code span differently from the rendered
page.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options: none.

Before:

```markdown
Run `npm run
build` before the tests.
```

After:

```markdown
Run `npm run build` before the tests.
```

**Backticks:** a span gets the fewest backticks whose run does not occur in its
content, so ``` ``a`` ``` becomes `` `a` ``. Padding keeps backticks at the
content's edges separate from the delimiters and preserves CommonMark's
single-space stripping. Table cell escapes stay intact. A span keeps its
delimiters where shortening them could pair with an earlier run in the same
inline block.

**Joining:** a line break inside a code span renders as a space, so the content
stays the same, and the spaces and tabs that start the next line are left out,
as CommonMark and GitHub leave them out. On a lazy continuation line, one
without its block quote's `>` or its list item's indentation, GitHub keeps them
in the span, and so does the joined span; commonmark.js leaves them out, so
outside the GitHub dialect such a span stays split.

**Left as written:** the exceptions of [Forgejo and
Gitea](dialects.md#forgejo-and-gitea), and a split span whose joined line would
read differently:

- Where joining would move text onto the line of an alert's or a callout's
  marker, which holds an Obsidian callout's title.
- Where the joined span needs a different number of backticks than it has, and
  an earlier run of that many in the same paragraph would pair with them.
- Where a line inside the span ends with two spaces or a backslash: where its
  backticks do not pair, as on GitHub after an unpaired longer run, those
  markers make a hard line break. `style/wrap` keeps such a paragraph as written
  too. This conservative check also keeps the line break when the backticks do
  pair.

**In Obsidian:** a span stays split where an `==` or `[[` left as text on the
joined lines could open a highlight or wikilink. A multiline span with one or
two backticks, and the following source in its inline block, stay as written:
Live Preview resets short code at the physical newline. Earlier independent
inline text and later paragraphs can still format. The [boundary
protections](obsidian.md#boundary-protections) describe the conservative cases.

**With other rules:** [`style/wrap`](#stylewrap) joins such a code span only in
a paragraph that it wraps, and this rule also elsewhere, such as in a paragraph
with a hard line break.
[`content/inline-code-spacing`](#contentinline-code-spacing) reports blank space
that renderers show at the ends of a span, which this rule leaves as written,
because removing it would change the code.

## `style/lazy-continuation`

Writes the markers and indentation of a paragraph's containers on its lazy
continuation lines: lines that continue the paragraph of a block quote, a list
item, or a footnote definition without the quote's `>` or the item's or
definition's indentation. The renderers read such a line as part of the
paragraph either way, so the text stays the same, and the document's structure
shows in its source.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: none.

Before:

```markdown
> Back up the database
before the migration.

- Unpack the board
and check the cables.
```

After:

```markdown
> Back up the database
> before the migration.

- Unpack the board
  and check the cables.
```

**Details:** a quote gets its `>`, indented as on the quote's first line and
with one space after it; a list item gets the columns up to its text; a footnote
definition gets four spaces; nested containers get all of theirs. The spaces
that a lazy line starts with are replaced, not added to, and a footnote
definition's first line stays on the line of its label.

**Left as written:** a paragraph's lazy lines, all of them, where one of them
could read otherwise inside its containers. The rule writes a prefix only on a
line that starts with a letter or another character that is not ASCII
punctuation, a number not followed by `.` or `)`, emphasis, a code span, a link
or image, an opening parenthesis, or a quotation mark, and that holds no `|` and
does not look like a link reference or footnote definition. A line of `===`
below a lazy line, for example, is text, and inside a quote it would underline
the text above it as a heading; `2. Step`, `- item`, `# Title`, `<span>`, and a
table row are others, also after the spaces that a lazy line starts with. Lazy
lines also stay:

- inside a code span or other inline syntax that keeps the spaces at the start
  of its lines;
- with a tab among their containers' prefixes;
- as a lazy first line below a link reference definition;
- in paragraphs with site-generator syntax such as `:::` or `{{` at the start of
  a line.

**In VitePress:** lazy lines also stay in documents with a custom container's
fence on a quote's line.

**In Obsidian:** the rule writes only the prefixes observed to leave both views
unchanged: a quote's `>` where the lazy line lacks every `>` of its quotes, and
list items' indentation where that is all it lacks. Live Preview shows the line
otherwise once a footnote definition's lazy line is indented, once a quote
inside a list item gets its `>`, and once a nested quote's `>` is written after
its outer quote's, so these lazy lines, and the combinations not observed, stay
as written with a finding whose message starts with
`Left as written to preserve Obsidian rendering`. So does a list item's lazy
line with more blocks after it in the item, which Live Preview reads outside the
list ([issue
#376](https://github.com/viell-dev/slop-markdown-tools/issues/376)).

**With other rules:** [`style/wrap`](#stylewrap) joins a lazy line onto the line
before it when it reflows the paragraph, and writes the containers' prefixes on
the lines that it breaks, so the two rules agree. This rule also changes the
paragraphs that wrapping leaves as written, such as one with a hard line break.

## `style/line-ending`

Writes one configured line ending outside literal content. It keeps the spaces
and backslashes that mark hard breaks.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`endOfLine`.

Before, with line endings shown as escape sequences: `First\r\nSecond\r`. After
with `endOfLine: "lf"`: `First\nSecond\n`.

- `endOfLine`: `"lf"` (default), `"crlf"`, `"cr"`, or `"auto"`. `auto` uses the
  first line ending in the document, or LF when there is none.

**Details:** this rule is opt-in. The recommended preset keeps the existing
line-ending convention rather than rewriting CRLF files; Git attributes and
checkout settings can already manage that convention.

**Left as written:** line endings inside code blocks and code spans, HTML, math
(display and inline), link, image and definition titles, and YAML or TOML front
matter retain their bytes. These literal values can depend on whitespace, so
this rule differs from Prettier's document-wide replacement. Renderer boundary
protections and suppressions still apply. A change that fails the semantic
comparison is reported without a fix. This can leave mixed endings around
protected content. The rule neither adds nor removes a final newline; use
[`style/final-newline`](#stylefinal-newline) for that.

## `style/link-title`

Writes the titles of inline links, images, and link reference definitions with
one kind of delimiter, double quotes by default. Destinations, including angle
brackets and balanced parentheses, stay byte for byte as written. It is an
optional source style, so no preset enables it and default formatting stays the
same.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`delimiter`.

Before:

```markdown
[guide](guide(v2).md 'Guide') ![map](<map.png> (Map))
```

After:

```markdown
[guide](guide(v2).md "Guide") ![map](<map.png> "Map")
```

| Option      | Values                                          | Default  |
| ----------- | ----------------------------------------------- | -------- |
| `delimiter` | `double`, `single`, `parentheses`, `consistent` | `double` |

- `delimiter`: `double` uses double quotes, `single` single quotes, and
  `parentheses` parentheses. `consistent` follows the first parsed title in the
  document, so an existing document keeps its convention. Double quotes are the
  default because they match the usual Markdown title notation. Empty titles
  follow the same choice.

**Left as written:**

- a title's delimiters, when the preferred delimiter occurs unescaped inside it,
  rather than adding escapes;
- escapes, entities, backslashes, and line breaks inside a title;
- a definition containing a tab, because commonmark.js reads a tab-separated
  definition as text where GitHub and markdown-it read a definition.

**Not checked:** wikilinks and Obsidian embeds, which have no titles.

**On Forgejo and Gitea:** a title in a heading stays as written where its source
contributes to the heading's anchor or attribute block.

## `style/list-indent`

Puts the configured spaces, one by default, between a list marker and the item's
text, and starts each item where its container's text starts: at the start of
the line, after a block quote's `>`, or under the text of the list item that
holds it. The item's other lines move by as many columns as its text, so its
paragraphs, code blocks, and nested lists stay inside it as they were.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: spaces after markers, `nestedIndent`, `startIndented`, `startIndent`.

With the defaults, before:

```markdown
-   Unpack the board.

    Keep the box for returns.
1.  Connect the sensor.
     - Use the short cable.
```

After:

```markdown
- Unpack the board.

  Keep the box for returns.
1. Connect the sensor.
   - Use the short cable.
```

| Option                   | Values                 | Default               |
| ------------------------ | ---------------------- | --------------------- |
| `bulletSpaces`           | An integer from 1 to 4 | `1`                   |
| `orderedSpaces`          | An integer from 1 to 4 | `1`                   |
| `bulletSpacesMultiline`  | An integer from 1 to 4 | `bulletSpaces`        |
| `orderedSpacesMultiline` | An integer from 1 to 4 | `orderedSpaces`       |
| `nestedIndent`           | An integer from 1 to 8 | Under the item's text |
| `startIndented`          | A boolean              | `false`               |
| `startIndent`            | A nonnegative integer  | `2`                   |

- `bulletSpaces` and `orderedSpaces`: the spaces after the marker of a bullet
  item and of a numbered one. As in markdownlint's MD030, the `Multiline`
  options take their place in a list where an item has more than one line or
  blank lines separate the items.
- `nestedIndent`: the columns from an item's marker to the marker of a list
  nested in it, like markdownlint's MD007 `indent`. A nested marker can stand
  from its item's text to three columns further, and the rule keeps it there:
  `4` puts it two columns in under `- item` and one under `1. item`. A nested
  list that starts on its item's line, as in `- - item`, stays there, and one
  that follows another list stays out of that list's last item.
- `startIndented` and `startIndent`: with `startIndented: true`, the first level
  of bullet and ordered lists starts `startIndent` columns into its container.
  `{ "startIndented": true, "startIndent": 2 }` writes `- item` as `  - item`,
  moving its continuation lines too. Nested lists still use `nestedIndent`. A
  list that starts a block quote's line is indented too; set
  [`style/quote-marker`](#stylequote-marker)'s `listItems` to `false` with it.
  Four or more columns would make code, so the rule keeps lists as written for those
  values. A first-level list directly below nonblank text also stays, because
  indentation can make it continue that text.

**Left as written:**

- An item that starts with indented code, five or more spaces after the marker;
  the code depends on that spacing.
- A list where moving an item would move another line into it. Here `Text`
  follows the list, and below `- Item` it would be the item's second paragraph:

  ```markdown
  -   Item

    Text
  ```

  The same goes for a line that continues the item's paragraph without the
  item's indentation, where that line would start a list, a code span, or
  another block once inside the item.
- A list with a tab in an item's indentation, such as one that Obsidian indented
  with tabs.
- A list directly below TOML front matter that cannot interrupt a paragraph: a
  numbered list that does not start at 1, or one whose first item starts with a
  blank line, and the lists that directly follow it. Renderers without TOML
  front matter read the front matter's lines as a paragraph, which such a list
  continues as text.
- A list among the blocks indented below text that the parser reads where
  renderers read a list, such as `2. Two` after an indented code block, or the
  list right after them, and the lists next to it (see [how it
  works](design.md#safety-model)).

**In Obsidian:** a document-level list that ends in a nested list keeps its
indentation, and so does the opening list in the following quote when its marker
has exactly two spaces after `>`. Live Preview carries the earlier indentation
into that quoted list, even across blank lines; changing it can remove a painted
bullet. An intervening block restores ordinary indentation preferences, and safe
marker and inline styles remain available. Quoted blocks opened after a Tab have
separate literal-source protection; see [Obsidian's boundary
protections](obsidian.md#boundary-protections). Ordinary space-only quoted
margins remain eligible for list indentation.

**With other rules:** [`style/list-marker`](#stylelist-marker) and
[`style/ordered-list`](#styleordered-list) also keep the markers of the lists
below TOML front matter and among misread blocks above. In the Obsidian lists
above, `style/ordered-list` keeps the number width, while allowing same-width
numbering and delimiter changes.

## `style/list-marker`

Writes every bullet list with one marker, `-` by default.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

Before:

```markdown
* Milk
* Bread

+ Plates
```

After:

```markdown
- Milk
- Bread

* Plates
```

| Option   | Values                                              | Default |
| -------- | --------------------------------------------------- | ------- |
| `marker` | `"-"`, `"*"`, `"+"`, `"consistent"`, or `"sublist"` | `"-"`   |

- `consistent`: the marker of the document's first bullet list, as in
  markdownlint's MD004.
- `sublist`: each level of nesting keeps the marker of its first list, unless
  the level above has that marker, in which case it gets the next one, as with
  MD004's `sublist`. A level counts the bullet lists that a list is nested in.

**Details:** a bullet list that directly follows another one is a separate list
only because its marker differs, so it gets the next marker in the order `-`,
`*`, `+`, and the list after that the first one again.

**Left as written:**

- A list whose new marker would make a line read as a thematic break, as `+ - -`
  would with `-`, and the lists next to it.
- A list directly below TOML front matter whose first item starts with a blank
  line, as for [`style/list-indent`](#stylelist-indent).

## `style/no-tabs`

Reports tab characters and replaces tabs in prose with spaces. Leading
indentation uses four-column tab stops, so the text after it keeps its column.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`codeBlocks`, `ignoredCodeLanguages`, `spacesPerTab`.

For example, `a<Tab>b` becomes `a b`, and ` <Tab>- child` becomes `    - child`
outside Obsidian. `<Tab>` here stands for a literal tab.

| Option                 | Default | Meaning                                                                               |
| ---------------------- | ------- | ------------------------------------------------------------------------------------- |
| `codeBlocks`           | `true`  | Report tabs in code blocks and spans, without fixes.                                  |
| `ignoredCodeLanguages` | `[]`    | Case-insensitive code languages whose tabs are neither reported nor fixed.            |
| `spacesPerTab`         | `1`     | Nonnegative integer replacement width in prose; indentation always follows tab stops. |

A zero `spacesPerTab` removes prose tabs only beside an existing ASCII space;
otherwise it reports without a fix to avoid joining words.

```json
{ "rules": { "style/no-tabs": ["warn", { "ignoredCodeLanguages": ["make", "makefile", "go"] }] } }
```

**Details:** prose tabs are replaced as `style/wrap` replaces them when
reflowing. Physical leading indentation uses four-column tab stops instead: a
tab after one space becomes three spaces, preserving the column of the following
text. The rule is opt-in because tabs can be intentional, particularly in code.

**Reported without a fix:**

- Tabs in container prefixes that are not entirely leading indentation, since a
  marker can consume only part of a tab.
- Code, which is literal content: code blocks and spans, math, HTML, and front
  matter.
- Tables and link syntax.
- ATX and Setext heading tabs, in every dialect, to keep heading anchors and
  heading links intact.

**Left as written:** prose tabs in a block that holds inline HTML, which can
make whitespace significant. Renderer protections can also suppress findings and
edits in ambiguous regions.

**In Obsidian:** leading tabs stay as written, because its views can read list
nesting and tab-only lines differently.

**In VitePress:** container delimiters, attributes, includes, table-of-contents
syntax, and Vue `{{ }}` interpolations also report tabs without fixes. Indented
code is reported under `codeBlocks` as in the other dialects.

## `style/ordered-list`

Writes the numbers of ordered lists with one delimiter and numbers the items
consistently.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `delimiter`, `numbering`.

Before:

```markdown
1) Unpack the board.
2) Connect the sensor.
2) Power it on.
```

After:

```markdown
1. Unpack the board.
2. Connect the sensor.
3. Power it on.
```

| Option      | Values                             | Default  |
| ----------- | ---------------------------------- | -------- |
| `delimiter` | `"."`, `")"`, or `"consistent"`    | `"."`    |
| `numbering` | `"auto"`, `"ordered"`, or `"same"` | `"auto"` |

- `delimiter`: `consistent` is the delimiter of the document's first ordered
  list. As with bullet markers, an ordered list that directly follows another
  one keeps a different delimiter.
- `numbering`: `ordered` counts up from the first number, and `same` repeats it
  in every item. `auto` repeats it when the first two items have the same
  number, as in `1.`, `1.`, `1.`, and counts up otherwise. These are
  markdownlint's MD029 `one_or_ordered`, `ordered`, and, for lists that start at
  1 or 0, `one` and `zero`.

**Details:** the first number never changes, because the rendered list starts at
it. When a number gets wider or narrower, as from `9.` to `10.`, the item's
other lines move with its text.

**Left as written:** the numbers of a list

- where changing them would move a line into or out of an item, as for
  [`style/list-indent`](#stylelist-indent);
- that are written with leading zeros, as in `01.`, or would need more than nine
  digits;
- directly below TOML front matter that does not start at 1, or whose first item
  starts with a blank line, which keeps its delimiter too, as for
  `style/list-indent`.

**In Obsidian:** digit widths stay where a trailing nested list controls a
following quoted list's indentation, as described for
[`style/list-indent`](#stylelist-indent). Same-width numbering and delimiter
preferences remain available.

## `style/prose-space`

Collapses repeated ASCII spaces between prose words without moving line breaks:
`a.  b   c` becomes `a. b c`. It normalizes spacing in documents that keep their
authored line breaks, without the reflow of `style/wrap`.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options: none.

Before:

```markdown
a.  b   c
next  line
```

After:

```markdown
a. b c
next line
```

To keep line breaks as written and collapse spaces only:

```json
{ "rules": { "style/wrap": "off", "style/prose-space": "warn" } }
```

**Details:** link text counts as prose. This rule and `style/wrap` agree on one
space between prose words. It is opt-in because sentence spacing can be an
intentional source convention.

**Left as written:** leading indentation, trailing spaces (including hard
breaks), non-breaking spaces, code, math, images, link destinations and titles,
and table cells. A block containing inline HTML stays whole, since HTML can make
whitespace significant; HTML blocks and front matter stay literal too. Renderer
and semantic checks keep the source wherever changing spaces would change
meaning.

**Reported without a fix:** spaces in ATX and Setext headings, in every dialect,
because changing heading text can change anchors and heading links.

**In VitePress:** projection syntax and Vue `{{ }}` interpolations keep their
spaces without a finding: expressions can contain whitespace-sensitive
JavaScript strings.

## `style/quote-marker`

Writes one space after each block quote marker, `>`, where the line has text
after it: more spaces become one, and a space is added where there is none, also
between nested markers, as in `>>` and `>  >`. The quote takes one space after
its marker as part of the marker, so the text keeps its place in the quote.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `listItems`.

Before:

```markdown
>  Back up the database.
>>The backup takes an hour.
```

After:

```markdown
> Back up the database.
> > The backup takes an hour.
```

`listItems` is `true` or `false`; the default is `true`. As in markdownlint's
MD027, it sets whether lines that start a list item count. The spaces between
`>` and a list marker are the list's indentation, so the rule moves the list to
one space after `>` with the lines of its items, as
[`style/list-indent`](#stylelist-indent) moves a list, and leaves it as written
where that would move a line into or out of an item.

**Left as written:**

- Indented code, which five or more spaces after `>` start, and the lines of
  fenced code and HTML, whose spaces beyond the quote's one are content; a space
  is still added after a `>` that has none there, which moves nothing.
- A paragraph's later line whose spaces keep its text from starting a block:
  below a quoted paragraph, `>     # Title` is text, which one space after `>`
  would make a heading. The spaces become one only before text that
  [`style/lazy-continuation`](#stylelazy-continuation) would also prefix on a
  lazy line.
- A quote line with nothing after its spaces, whose spaces are trailing space
  for [`style/trailing-space`](#styletrailing-space), and the spaces on the
  other lines of a list item, which belong to the item.
- A tab after `>` or among a line's markers, which counts to the next tab stop.
- The later lines of a code span or other inline syntax that keeps the spaces at
  the start of its lines, and quotes with site-generator syntax such as `:::` or
  `{{` at the start of a line.
- A quote that the next line follows without a blank line or a `>`. Renderers
  can read that line as more of the quote where the parser starts another block,
  as with a numbered item that does not start at 1.

**In VitePress:** the quotes of a document with a custom container's fence on a
quote's line stay as written.

**In Obsidian:** a tag directly after `>`, as in `>#tag`, stays as written,
because Live Preview reads it as text and would read it as a tag after a space
([issue #409](https://github.com/viell-dev/slop-markdown-tools/issues/409)). So
does a callout's marker after two or more spaces, as in `>  [!tip]`, which is
text there and one space would make a callout (see
[`obsidian/callout-marker`](#obsidiancallout-marker)). Elsewhere the spaces do
not change how the marker reads; GitHub shows an alert after any number of them.
Like the list rules, the rule follows Obsidian's [boundary
policy](obsidian.md#visible-boundary-refusals): an edit at a boundary between
text and a list, quote, or other block stays as written with a finding.

**With other rules:** with [`style/list-indent`](#stylelist-indent)'s
`startIndented`, which indents a list that starts a quote's line, set
`listItems` to `false`, or the two rules undo each other's edits.

## `style/strong`

Writes strong emphasis with one marker, `*` by default.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

Before:

```markdown
A __bold__ claim.
```

After:

```markdown
A **bold** claim.
```

`marker` is `"*"` (the default), `"_"`, or `"consistent"`. With `"consistent"`,
the first parsed strong text chooses the marker independently of ordinary
emphasis: `__first__ and **later**` becomes `__first__ and __later__`. Each
document chooses independently.

**Left as written:** the cases of [`style/emphasis`](#styleemphasis), including
when the first node cannot safely change.

## `style/table`

Formats tables, also inside lists and block quotes: by default it pads every
cell to its column's width and writes the delimiter row to match, keeping each
column's alignment. Cell text and each row's number of cells stay as written.

**Style rule**, fixed by `format`. Presets: `recommended` (warn), `github`
(warn), `forgejo` (warn), `gitea` (warn), `obsidian` (warn), `vitepress` (warn).
Dialects: all but CommonMark. Options: `style`, `pipeStyle`, `alignedDelimiter`,
`padding`.

Before:

```markdown
| Sensor | Unit |
|:--|--:|
| Temperature | °C |
```

After:

```markdown
| Sensor      | Unit |
| :---------- | ---: |
| Temperature | °C   |
```

| Option             | Values                                                                                                           | Default                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `style`            | `"aligned"`, `"compact"`, `"tight"`                                                                              | `"aligned"`            |
| `pipeStyle`        | `"leadingAndTrailing"`, `"leadingOnly"`, `"trailingOnly"`, `"noLeadingOrTrailing"`, `"consistent"`, `"perTable"` | `"leadingAndTrailing"` |
| `alignedDelimiter` | Boolean                                                                                                          | `false`                |
| `padding`          | `"right"`, `"alignment"`                                                                                         | `"right"`              |

- `style`: `aligned` pads every cell to its column's width, measured in display
  columns (including emoji and CJK), and keeps the delimiter row's column
  alignment. `compact` writes one space around cell text and three-character
  delimiters, such as `| :-- | --: |`. `tight` writes no padding: `|a|b|`.
  Unlike markdownlint's `any`, each value names a target output: accepting any
  of several styles would leave a formatter without a target, so choose the
  desired style or turn the rule off to keep spacing as written.
- `pipeStyle`: `"consistent"` takes the first table header's borders for the
  document; `"perTable"` takes each table's own header. The other values request
  specific borders.
- `alignedDelimiter`: aligns delimiter pipes with the header in compact and
  tight tables; short headers gain padding to fit the minimum three-character
  delimiters. Body cells still use the selected style.
- `padding`: `"alignment"` pads right-aligned text on the left and centered text
  on both sides (an odd extra space goes on the right). It applies to aligned
  cells and to headers padded for `alignedDelimiter`. `"right"` puts all extra
  spaces on the right.

For example, with
`{ "style": "tight", "pipeStyle": "noLeadingOrTrailing", "alignedDelimiter": true }`:

```markdown
Alpha|Beta
-----|----
x|y
```

With `{ "padding": "alignment" }`, right and centered columns instead pad as
follows:

```markdown
| Right | Center |
| ----: | :----: |
|     x |   y    |
```

**Borders:** pipes needed to keep a one-column table are kept: when neither
border is requested, such a table uses both. A table keeps its leading border
when a row's first cell is empty or starts like another block, such as `- x`,
`# x`, or `1. x`, which would otherwise start that block; it keeps its trailing
border when a row's last cell is empty, which would otherwise vanish. Without a
trailing border, the last cell gets no padding, so no line ends in blank space.
A preferred form that would change meaning stays as written.

**In lists and block quotes:** each row keeps the quote markers, list
indentation, and line ending before it as written, and column widths are
measured after them, so the rows line up when their prefixes have the same
width; [`style/list-indent`](#stylelist-indent) and the other container rules
format the prefixes. Every option applies as it does elsewhere:

```markdown
> | Sensor      | Unit |
> | :---------- | ---: |
> | Temperature | °C   |
```

A header written on its list item's marker line keeps its leading pipe, or its
lack of one: markdown-it, which VitePress uses, reads `- Sensor | Unit` above an
indented delimiter row as a table outside the list, with the marker in its first
cell. Such a header without a leading pipe has none added, and its table stays
as written when a row needs one.

**Left as written:**

- Tables with more cells in a row than in the header.
- Tables in footnote definitions, and indented tables outside lists and block
  quotes.
- A table containing a standalone colon-container boundary such as `:::` or
  `:::tip`: site generators use it to open or close a container, where GFM reads
  another row. Cells written with table borders, such as `| ::: |`, are
  formatted normally.

**In Obsidian:**

- An existing leading border is kept, and one-column tables keep both borders.
- A body row that changes its header's leading-pipe convention, or has only its
  leading pipe, can begin paragraph text instead. That row and the rest of the
  primary table keep their source and preceding boundary, so adding table
  borders cannot absorb the paragraph or split pipes inside links.
- A one-column table stays as written unless both its header and delimiter have
  leading and trailing pipes: Live Preview shows the other forms as source text.
  Reading view also accepts matching trailing-only pipes; missing final pipes or
  mismatched leading borders instead continue paragraph text, including across a
  Tab-only line into later literal rows.
- A table directly after a list item's closing code fence keeps its literal
  rows: Live Preview shows them as source text. A table after a heading,
  indented code, a root fence, or a blank line still formats.
- In a list or block quote, the same protections apply: a table directly below a
  line of text, including a callout's title line, or a table whose container
  prefixes hold a Tab, stays as written. A blank line below the callout's title
  lets the table format.

## `style/thematic-break`

Writes thematic breaks with one exact text, `---` by default.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

Before:

```markdown
Text.

* * *
```

After:

```markdown
Text.

---
```

`marker` is `"---"` (the default), any valid thematic-break text, such as
`"* * *"`, `"-----"`, or `"___"`, or `"consistent"`, which takes the exact text
of the document's first break. A break text has at least three identical `-`,
`*`, or `_` markers, optionally separated by spaces or tabs, without leading or
trailing whitespace. With `marker: "* * *"`, the example above instead ends in
`* * *`; with `consistent`, a first `-----` makes later breaks `-----` too.

**Details:** blank space before and after the break stays.

**Left as written:** a break where the new marker would change what the document
means:

- With compact hyphens such as `---` or `-----`, directly below a paragraph, a
  link reference definition, or display math, which `---` would underline as a
  heading; GitHub builds display math from a paragraph.
- A compact hyphen line directly below display math, also when another marker is
  requested. Spaced `- - -` remains eligible for star or underscore preferences,
  as does a break separated from the math by a blank line.
- On the line of a list item whose marker is the new marker's character, as in
  `- ***` with `---`: `- ---` is one thematic break, not a list item.
- At the start of a document, with `---`, which would open front matter if a
  later line of `---` closed it, and a `---` that site generators read as the
  start of front matter.
- With `---`, at the start of a line below a first line of `---` that no line
  closes, which `---` would close as front matter.
- Directly below TOML front matter, a break that is or would become `---`,
  because renderers without TOML front matter read the front matter's lines as a
  paragraph that `---` underlines as a heading; see the [safety
  model](design.md#safety-model).

## `style/trailing-space`

Removes spaces and tabs at the end of lines. A hard line break written as two or
more spaces keeps them.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `hardBreak`, `hardBreakSpaces`, `listItemEmptyLines`, `codeBlocks`.

With `{ "hardBreak": "backslash" }`, before, with two spaces after `one`:

```markdown
Line one  
line two
```

After:

```markdown
Line one\
line two
```

| Option               | Values                    | Default             |
| -------------------- | ------------------------- | ------------------- |
| `hardBreak`          | `"keep"` or `"backslash"` | `"keep"`            |
| `hardBreakSpaces`    | An integer of at least 2  | Keep existing count |
| `listItemEmptyLines` | A boolean                 | `false`             |
| `codeBlocks`         | A boolean                 | `false`             |

- `hardBreak`: `"backslash"` writes a hard line break of spaces as a backslash,
  so that it is visible in the source.
- `hardBreakSpaces`: writes an existing space-style hard break with exactly that
  many spaces; with `2`, three spaces become two, as Prettier writes it.
  `hardBreak: "backslash"` takes precedence; where converting to a backslash is
  unsafe, the break stays. It never creates a break and leaves the protected Tab
  suffixes below intact.
- `listItemEmptyLines`: `true` keeps whitespace-only lines inside list items,
  including their existing indentation. Spaces that make no break elsewhere are
  removed, matching markdownlint's strict checking.
- `codeBlocks`: `true` reports trailing spaces and tabs in fenced and indented
  code without an edit. Code content always stays byte for byte as written.
  Opaque renderer regions still suppress ordinary findings; in particular,
  VitePress's indented code stays opaque.

**Details:**

- Blank space after a literal backslash stays when removing it would turn a
  continuing prose line into a hard line break, in paragraphs, headings, lists,
  and quotes. Blank space at the end of a paragraph or file can still be
  removed; `hardBreak` controls existing hard line breaks.
- A Tab followed by two or more spaces can mark a hard line break even where the
  primary Markdown reading has a soft line ending. In every dialect, that suffix
  stays exactly as written, including with `hardBreak: "backslash"`. Ordinary
  trailing Tabs and spaces, and those on the last content line of a paragraph or
  heading, can still be removed where they have no rendered meaning.

**Left as written:** blank space that is content: in code blocks, except on
their fence lines, and in HTML, math, front matter, Obsidian comments, code
spans, and link titles and labels that span lines.

**With `"backslash"`:** a break stays as spaces where a backslash would change
what the line says: after another backslash, after a literal autolink such as
`www.example.com`, which would take the backslash into its address, on the title
line of an alert or callout, in a paragraph that starts like a link reference
definition (`[label]:`), and on Forgejo and Gitea inside `\(...\)` math.

**In Obsidian:**

- A list marker alone on its line keeps one space after it. Live Preview needs
  that separator to style the line as a list item, even when the item's text
  starts on the next line. Extra spaces and tabs are reduced to that one space
  where safe. Quoted markers and further markers on the same physical line get
  ordinary cleanup, because Live Preview reads them as text.
- A line of blank space that holds a tab or lies directly below an HTML block
  stays, because Reading view reads it as more of the block above it. So does
  blank space at the end of a footnote definition's last line, where a paragraph
  ends the definition, which Reading view shows before the footnote's
  backreference.
- The preceding paragraph's separator before a Tab-only continuation stays when
  it marks a hard break or keeps a backslash literal. A Tab that begins before
  an unquoted paragraph's content column does not continue that paragraph merely
  by advancing past the column. Quoted margins are handled conservatively,
  keeping a possibly removable separator.

## `style/wrap`

Reflows each paragraph so that its lines fill the width, 80 columns by default,
without exceeding it, or, with `mode: "never"`, joins each paragraph onto one
line. A line break inside a paragraph renders as a space, so the rendered text
stays the same, and short lines keep diffs small.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `mode`, `width`, `measure`, `reportUnreflowed`, `reportUnbreakable`.

With `{ "width": 40 }`, before:

```markdown
Wrapping keeps lines short, so that a change to one sentence shows up as a small diff.
```

After:

```markdown
Wrapping keeps lines short, so that a
change to one sentence shows up as a
small diff.
```

| Option              | Values                        | Default     |
| ------------------- | ----------------------------- | ----------- |
| `mode`              | `"always"` or `"never"`       | `"always"`  |
| `width`             | An integer from 20 to 500     | `80`        |
| `measure`           | `"columns"` or `"codepoints"` | `"columns"` |
| `reportUnreflowed`  | `true` or `false`             | `false`     |
| `reportUnbreakable` | `true` or `false`             | `false`     |

- `mode`: `always` wraps at `width`. `never` joins each paragraph onto one line,
  so `First line` followed by `second line` becomes `First line second line`. It
  leaves the same paragraphs, inline pieces, and containers as written as
  wrapping does, and ignores `width`, `reportUnreflowed`, and
  `reportUnbreakable`, since the long lines are intended.
  [`content/line-length`](#contentline-length) can still check headings, code,
  and tables.
- `width`: the longest line, in the unit of `measure`.
- `measure`: `columns` counts display columns, so a wide character such as `漢`
  counts two. `codepoints` counts Unicode code points: a character outside the
  Basic Multilingual Plane counts once, and a combining mark counts by itself.
- `reportUnreflowed`: report a paragraph that is too wide but left as written,
  with the reason.
- `reportUnbreakable`: report a line that stays too wide because of something
  that cannot be split, also in paragraphs left as written. The line of an
  alert's or a callout's marker counts as one such piece, even when it contains
  spaces.

The two report options propose no edits and use the rule's severity. To make
them fail a check, set the rule to `error` or pass `--max-warnings 0`;
`format --check` checks only for edits.

**Breaking lines:**

- Lines are broken at spaces in the text, also in the text of a link, emphasis,
  strong text, or strikethrough. List markers, block quote markers, and
  indentation count toward the width, a tab up to the next multiple of four
  columns.
- A code span, an image, math, a link's destination, a template tag on one line
  such as `{% data x %}` or `{{ title }}`, and a word longer than the line stay
  whole and can overflow.
- A code span or an image description written across lines is joined onto one,
  without the spaces and tabs that start its next line, as renderers read it. On
  a lazy continuation line, which keeps them, such a code span stays as written,
  and so does its paragraph. Whitespace inside code spans otherwise follows
  their own joining rules.

**Words kept off the start of a line:**

- A word that would start a block at the start of a line, such as a list marker,
  `#`, `>`, a run of `-` or `=`, or a table delimiter row such as `|---|`, stays
  on the line before it, and so does a word that starts with `:::`, `{%`, or
  `{{`, or a literal `[[toc]]` marker (in any letter case). A word that only
  starts like one, such as `--config`, `#tag`, or `-5`, can start a line.
- The first line keeps more than one word when its first word alone would open a
  block, such as `***` or `$$`, or, in the body below the line of an alert's or
  callout's marker, would underline that line as a heading, such as `==` or
  `--`. It also keeps a paragraph that starts like a link reference definition
  (`[Note]: see …`) from becoming one.
- On GitHub and in Obsidian, a word that starts with `$` stays on the line
  before it when a `$` comes earlier in the paragraph, and in Obsidian a word
  that ends in `$`, such as a lone `$`, stays on the line after it when a `$`
  comes later: at the edge of a line, a dollar can begin or end math that it
  cannot begin or end next to a space.

**Left as written:** a paragraph whose meaning could change when its lines are
joined or broken, that is, one that:

- has a hard line break, inline HTML, or a block identifier (`^id`) at its end;
- has a line break that is content, inside math, inline HTML, an Obsidian
  comment, or a link's destination or title;
- has a Tab followed by two final spaces before continuing text, which native
  renderers can read as a hard break even when the primary parser reads a soft
  line ending;
- has lines whose container markers the tool cannot reproduce;
- opens a block quote with an alert or callout marker such as `[!NOTE]` in the
  CommonMark dialect; in the other dialects only the line with the marker, and
  an Obsidian callout's title on it, stays as it is, and the body is wrapped. A
  paragraph elsewhere that starts with a linked image, `[![…](…)](…)`, is
  wrapped;
- starts with a bare `-`, `+`, `*`, `1.`, `1)`, `#`, or `>` followed by more
  words, which joining would turn into a block;
- starts directly below a link reference definition without that definition's
  container markers;
- has a table delimiter row such as `| - |` as its second line, in the dialects
  with tables: such a paragraph is usually a table that the parser reads as text
  (see [the safety model](design.md#safety-model));
- starts with a snippet import (`<<<`), or has a line that starts with `:::`,
  `{%`, `{{`, or a literal `[[toc]]` marker, which [site
  generators](dialects.md#what-each-dialect-reads) read by line.

[Forgejo and Gitea](dialects.md#forgejo-and-gitea) add their own cases.

**In Obsidian:** the rule wraps or joins only with the vault's [strict line
breaks](obsidian.md#enable-wrapping). Lines are also broken with Live Preview in
mind:

- The text of a link stays whole and is joined onto one line, because Live
  Preview shows a link whose text spans lines as its Markdown source. For the
  same reason, an inline footnote (`^[…]`) on one line stays whole, and a
  paragraph with one that spans lines keeps its lines.
- A leading inline comment stays with the next atom, so wrapping cannot turn it
  into a standalone comment block; later text still wraps normally.
- No new line's content starts with `[`, a label, and `]:`, such as `[ref]: …`:
  Live Preview hides its destination, including after indentation or quote
  markers. The complete label stays on the preceding word's line, also when it
  holds spaces. Existing reference-like lines stay on their own lines; an empty
  colon line also keeps the following destination line, even across blank lines.
  A list's marker line still wraps normally, because it shows the label and
  destination as text.
- In a block quote whose markers are written without a space after them, such as
  `>text`, a tag such as `#tag` stays on the line before it, because Live
  Preview reads a tag directly after `>` as text.
- The exact separator before a Tab-only paragraph continuation stays when
  trailing spaces mark a hard break or keep a preceding backslash literal. The
  earlier paragraph text can still wrap.
- A standalone one-line `$$…$$` formula keeps its physical line, with the
  adjacent separators, when joining would change Live Preview's display widget.
  Math already beside ordinary prose still wraps; see the [boundary
  protections](obsidian.md#boundary-protections).

In Obsidian, a paragraph is also left as written when it:

- holds a possible comment whose leading `%%` and first closer cross a blank
  line: moving text after the closer could turn literal paragraphs into a
  comment block;
- holds `==`, `[[`, or `]]` outside its highlights and wikilinks, because
  joining lines could create one;
- has a continuation line with tag-like text directly after a bare block quote
  marker, such as `>#tag text`: joining the line would create a tag in Live
  Preview;
- has a definition-like label that already spans lines, contains a nested
  opening bracket, or has a tab after its colon: reflow changes Live Preview's
  link styling;
- opens a block quote on a list item's marker line, such as `- > words`: Live
  Preview shows the first line as list text with a literal `>` and only
  continuation lines as a quote. Its first paragraph stays as written, while
  ordinary quotes below the marker line still wrap;
- would start with `[`, a label, and `]:` on its first line once reflowed, as
  `[a` and `b]: c d` below it would, which Live Preview styles as a link
  reference definition;
- holds a short multiline code span; see
  [`style/inline-code`](#styleinline-code). Earlier independent inline markup
  can still format;
- holds a multiline image description containing backticks, where joining could
  turn displayed Live Preview source into an embed. Surrounding inline
  preferences can still be applied.
