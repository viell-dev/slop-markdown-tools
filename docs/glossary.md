# Glossary

The terms that these pages use, in plain words. A page links a term here where
it first uses it.

**`#` heading (ATX heading).** A heading written with one to six `#` marks at
the start of its line, such as `## Install`. CommonMark calls it an ATX heading.

**Dialect.** The Markdown syntax that a document is read in, named after the
renderer that shows it: `commonmark`, `github`, `forgejo`, `gitea`, `obsidian`,
or `vitepress`. It decides what counts as a table, a link, or a line break, and
how heading anchors are made. See [dialects](dialects.md).

**Fallback.** What applies without an mdrefine configuration: the settings
converted from a markdownlint or Prettier configuration in the workspace, or
else the `recommended` preset. See [the
fallback](configuration.md#competitor-configuration-fallback).

**Lazy continuation line.** A line that continues a paragraph inside a block
quote or a list item without the quote's `>` or the item's indentation, as the
second line of `> First line` followed by `second line` does. Renderers read it
as part of the paragraph.

**Left as written.** What the tool does with source where an edit could change
how a renderer shows the document, or where its reading is uncertain. Where a
rule would have made an edit there, `lint` and `format` can report it, as in
`Left as written to preserve Obsidian rendering`, without changing the text.

**markdown-it, micromark.** Markdown parsers. VitePress renders pages with
markdown-it; mdrefine reads documents with micromark, which follows CommonMark,
and adjusts its reading for each dialect.

**mdast.** The syntax tree that micromark's reading produces: one node for each
heading, paragraph, list, link, and so on. Rules and plugins receive it.

**Preset.** A named set of rule settings, such as `recommended` or `github`,
that a configuration lists under `extends`. Each preset except `recommended`
also sets a dialect. See [presets](configuration.md#presets).

**Problem rule.** A rule that reports something that has no single correct
repair, such as a broken link, and never changes a file.

**Semantic check.** The comparison that `format` makes before it applies an
edit: the document is read again, and an edit that would change what it means is
refused. See [the safety model](design.md#safety-model).

**Style rule.** A rule about how something is written, such as the emphasis
marker. `lint` reports what it finds, and `format` applies its edits.

**Underlined heading (Setext heading).** A heading written as a line of text
with a line of `=` or `-` below it. CommonMark calls it a Setext heading.

**Workspace.** The documents that a command checks, and the other files that
their links can reach. Its directory is the [workspace
root](cli.md#the-workspace-root).
