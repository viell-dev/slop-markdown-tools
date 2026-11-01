# Glossary

The terms that these pages use, in plain words, in alphabetical order.

## Dialect

The Markdown syntax that a document is read in, named after the renderer that
shows it: `commonmark`, `github`, `forgejo`, `gitea`, `obsidian`, or
`vitepress`. It decides what counts as a table, a link, or a line break, and how
heading anchors are made. See [dialects](dialects.md).

## Fallback

What applies without an mdrefine configuration: the settings converted from a
markdownlint or Prettier configuration in the workspace, or else the
`recommended` preset. See [the
fallback](configuration.md#fallback-to-markdownlint-and-prettier).

## Heading forms

A `#` heading is written with one to six `#` marks at the start of its line,
such as `## Install`; CommonMark calls it an ATX heading. An underlined heading
is a line of text with a line of `=` or `-` below it; CommonMark calls it a
Setext heading, and it can only be of level 1 or 2.

## Lazy continuation line

A line that continues a paragraph inside a block quote or a list item without
the quote's `>` or the item's indentation, as the second line of `> First line`
followed by `second line` does. Renderers read it as part of the paragraph.

## Left as written

What the tool does with source where an edit could change how a renderer shows
the document, or where its reading is uncertain. Where a rule would have made an
edit there, `lint` and `format` can report it, as in
`Left as written to preserve Obsidian rendering`, without changing the text.

## Parsers and syntax trees

markdown-it and micromark are Markdown parsers. VitePress renders pages with
markdown-it; mdrefine reads documents with micromark, which follows CommonMark,
and adjusts its reading for each dialect. micromark's reading produces an mdast
tree: one node for each heading, paragraph, list, link, and so on, which rules
and plugins receive.

## Preset

A named set of rule settings, such as `recommended` or `github`, that a
configuration lists under `extends`. Each preset except `recommended` also sets
a dialect. See [presets](configuration.md#presets).

## Problem rule and style rule

A problem rule reports something that has no single correct repair, such as a
broken link, and never changes a file. A style rule is about how something is
written, such as the emphasis marker: `lint` reports what it finds, and `format`
applies its edits.

## Semantic check

The comparison that `format` makes before it applies an edit: the document is
read again, and an edit that would change what it means is refused. See [the
safety model](design.md#safety-model).

## Workspace

The documents that a command checks, and the other files that their links can
reach. Its directory is the [workspace root](cli.md#the-workspace-root).
