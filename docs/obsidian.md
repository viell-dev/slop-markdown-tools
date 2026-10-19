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
