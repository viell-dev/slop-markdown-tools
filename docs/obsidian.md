# Obsidian vaults

The `obsidian` dialect reads wikilinks, embeds, callouts, highlights, comments,
and heading and block references, and checks links the way Obsidian resolves
them.

## Install for a vault

Install mdrefine outside the vault. `npm install` puts `package.json`,
`package-lock.json`, and a `node_modules` folder with thousands of files in the
folder where it runs, and inside a vault they become part of the vault. Install
it globally, or in a folder of its own, and point `--root` at the vault:

```sh
npm install --global mdrefine@0.6.0
mdrefine lint --root "/path/to/vault"
```

mdrefine itself never reads a folder named `node_modules`. If you install it
inside the vault anyway, list `node_modules/` among Obsidian's excluded files
(Settings, Files and links) and in the vault's `.gitignore` if it has one.

## Configure the vault

Create `mdrefine.config.jsonc` at the vault's root, next to `.obsidian/`:

```jsonc
{
  "extends": ["recommended", "obsidian"],
  "ignore": ["Templates/**"],
}
```

Run the commands from the vault's root, or pass it with `--root`, so that links
are resolved across the whole vault:

```sh
npx mdrefine lint --root "/path/to/vault"
npx mdrefine format --root "/path/to/vault" --diff
```

Without a configuration file, the notes are still read in the Obsidian dialect,
because the vault is recognized by its `.obsidian` directory; see [the assumed
dialect](dialects.md#the-assumed-dialect). The rules of the `obsidian` preset,
among them the report that wrapping is off, still need the configuration.

## Enable wrapping

Obsidian shows a single line break inside a paragraph as a line break unless the
vault's "Strict line breaks" setting is on. `style/wrap` therefore wraps notes
only when the vault's `.obsidian/app.json` contains `"strictLineBreaks": true`,
and [`obsidian/strict-line-breaks`](rules/obsidian/strict-line-breaks.md)
reports when it does not. The tool reads the file and never changes it; when you
change the setting, keep the file's other settings. If the file cannot be read
or is not valid JSON, the tool warns and leaves paragraphs as written; a byte
order mark at its start is ignored. If strict line breaks do not suit your
vault, disable `style/wrap`; the other rules still run.

The tool reads highlights (`==text==`) and wikilinks within one line. A
paragraph with `==`, `[[`, or `]]` outside them, such as a highlight written
across two lines, is left as written, because joining its lines could create a
highlight or a link.

In a callout, the title line stays as written, with its folding marker, and the
body is wrapped inside the quote, also directly below the title. A body
paragraph is left as written in the cases that
[`style/wrap`](rules/style/wrap.md) lists, and so is a body whose quote markers
are not consistent, or inline syntax that runs from the title into the body. A
title that is too long is reported by `reportUnbreakable`.

## Where Obsidian reads Markdown its own way

Obsidian's Reading view and Live Preview read some Markdown otherwise than
CommonMark, and otherwise than each other. Where formatting would change what a
note shows in either view, the tool leaves the source as written. Most such
cases are unusual source forms:

- front matter whose opening `---` nothing closes, and code fences or runs of
  backticks that nothing closes;
- blocks with no blank line between them, such as a paragraph directly above a
  list, block quote, table, HTML block, fence, or definition;
- [lazy continuation lines](glossary.md#lazy-continuation-line), which continue
  a quote or list item without its `>` or indentation, and a tab after a list or
  quote marker;
- HTML blocks and comments that run on into the blocks around them;
- `=` or `-` underlines that one view reads as a heading and the other as text;
- tables that one view reads otherwise, such as rows directly below a list, a
  fence, or a footnote;
- footnote definitions, link reference definitions, display math, and `%%`
  comments directly beside other blocks.

Blocks outside these places still format. The [list of
protections](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/obsidian.md)
describes each case in detail.

### Visible boundary refusals

When a rule's edit is held this way, `lint` and `format` report
`Left as written to preserve Obsidian rendering` under the rule's ID and its
configured severity, without an edit. Suppression comments still apply. A held
warning counts toward `--max-warnings`; set the rule to `error` to make it fail
the check directly. Other edits in the note still apply. A rule that proposes no
edit reports nothing here, and this does not guarantee that every unusual source
form renders the same in both views.

[`style/lazy-continuation`](rules/style/lazy-continuation.md) writes a quote's
`>` and a list item's indentation on the lazy lines where both views were
observed to show the same; after that, the paragraph is no longer kept as
written. It reports the other lazy lines as left as written.

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
image size in their label. [`links/path`](rules/links/path.md) and
[`links/notation`](rules/links/notation.md) describe the options.

## Review the result

The tool does not model every interaction between Obsidian's two views. If a
note shows differently after formatting, [report
it](https://github.com/viell-dev/slop-markdown-tools/blob/main/CONTRIBUTING.md#report-a-defect)
with the note's source before and after.

Preview with `--diff` before `--write`, and look at complex notes in Obsidian
afterwards, especially with community plugins whose syntax the tool does not
know. The link resolver does not reproduce every behavior of Obsidian's, and
syntax it does not know may need an `ignore` pattern or a [suppression
comment](configuration.md#suppression-comments). The [vault
example](examples.md#format-an-obsidian-vault) shows a small vault before and
after formatting, and [limits](design.md#limits) lists what is not modeled.
