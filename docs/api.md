# Library API

The package's main entry, `mdrefine`, lints and formats strings and never
touches the filesystem. A second entry, `mdrefine/node`, finds and reads files
the way the CLI does. Both are TypeScript-typed ES modules, and their exports
are part of the interface that [version numbers](versions.md) describe.

## Lint and format

```ts
import { createWorkspace, format, lint } from "mdrefine";

const files = {
  "note.md": "A *short* note with [a link](target.md).\n",
  "target.md": "# Target\n",
};
const options = {
  path: "note.md",
  config: { extends: ["recommended", "github"] },
  workspace: createWorkspace(files, { dialect: "github" }),
};

const diagnostics = lint(files["note.md"], options);
const result = format(files["note.md"], options);
// result: { output, changed, diagnostics }
```

`lint(source, options)` returns the diagnostics, with the fields of the [JSON
report](cli.md#json-report). `format(source, options)` returns `output`, the
formatted text; `changed`, whether it differs; `diagnostics`, the findings that
remain in the output; and `scope` with [`ranges`](#part-of-a-document). The
edits of a rule that would change the document's meaning are left out and
reported as `engine/unsafe-format`, as the [safety
model](design.md#safety-model) describes, and a rule that fails is reported as
[`engine/rule-error`](plugins.md#rules). An invalid configuration, an unknown
rule, invalid rule options, or a plugin rule of the wrong shape throw an error.

| Option           | Meaning                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `path`           | The document's path relative to the workspace root, with forward slashes. It selects overrides and resolves links. |
| `config`         | The object a configuration file would hold. `plugins` there are not loaded; pass plugin objects instead.           |
| `plugins`        | [Plugin](plugins.md) objects.                                                                                      |
| `workspace`      | The files that links can reach; see [workspaces](#workspaces).                                                     |
| `defaultDialect` | The dialect to assume when the configuration names none; see [the dialect](#the-dialect).                          |
| `ranges`         | Limit the work to [part of a document](#part-of-a-document).                                                       |

Without `config`, the `recommended` preset applies. Positions count UTF-16 code
units in the text as given. A byte order mark at its start (U+FEFF, which some
editors write) is not part of what rules see, but it counts in the offsets that
`lint` and `format` report, so that their edits apply to the text as given, and
`format` keeps it in the output.

## The dialect

A document is read in the dialect that its configuration names, through
`dialect`, a preset, or a matching override. When none does, `lint`, `format`,
and `resolveConfig` assume `defaultDialect`, or `github` without it;
`defaultDialect` accepts a dialect or an alias and never overrides a dialect
that the configuration names. The library reads no files, so it cannot recognize
a vault by itself. The CLI passes `obsidian` for a document with a `.obsidian`
directory in its own directory or one above it, and gives the workspace that
vault's `strictLineBreaks` setting; a host for vaults should do the same:

```ts
// The host found `.obsidian/` at the root of the directory it read `files` from.
const options: ProcessOptions = { path: "Note.md", config, defaultDialect: "obsidian" };
const { dialect } = resolveConfig(options);
const workspace = createWorkspace(files, { dialect, strictLineBreaks });
const result = format(files["Note.md"], { ...options, workspace });
```

`resolveConfig(options)` returns the settings in effect for a document:
`dialect`, `rules`, `ignore`, and `resolve`. It takes the `path`, `config`,
`plugins`, and `defaultDialect` of `lint` and `format`, so their options serve
as they are. The prereleases took these four as separate arguments; such a call
throws an error that says so.

## Workspaces

`createWorkspace(files, options)` builds the workspace that link checks, link
rewriting, and Obsidian wrapping need; without one, none of them happen. `files`
maps each path, relative to the workspace root with forward slashes, to one of:

- the text of a Markdown document, whose headings are link targets when its name
  ends in `.md` or `.markdown`, or `.md` for Obsidian links;
- `null` for a file that is not Markdown, such as an image, so that links to it
  resolve;
- a synchronous loader, `() => string`, which is called only when a link's
  fragment needs the document. The workspace then keeps the document's anchors,
  not its text. The anchors of Obsidian, of GitHub and CommonMark, and of
  Forgejo and Gitea differ, so a loader is called once more when the same target
  is checked for another of these groups. A loader must return the same text
  each time, so create a new workspace when files change. A loader that throws
  an error whose `code` is `EACCES`, `EPERM`, or `EBUSY`, or
  `ERR_ENCODING_INVALID_ENCODED_DATA`, which a `TextDecoder` created with
  `fatal: true` throws for a file that is not valid in its encoding, makes a
  link to a heading in that file resolve as `unreadable`, while a link to the
  file itself still resolves; any other error propagates.

| `WorkspaceOptions` | Meaning                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `dialect`          | The dialect that link targets are parsed in; `github` when omitted. Give the dialect of the documents that link into them.  |
| `strictLineBreaks` | `true` when the vault's "Strict line breaks" setting is verified on. Obsidian notes are wrapped only then.                  |
| `directories`      | Existing directories that hold no files; the others are known from `files`. A link to a directory resolves as `directory`.  |
| `unreadable`       | Directories whose contents the host could not read. A link that may lead into one resolves as `unreadable`.                 |
| `vaults`           | Directories below the root that are Obsidian vaults. An Obsidian link in one of their notes reaches only the vault's files. |
| `rootInVault`      | When the root is a directory inside a vault: its path from the vault's root, such as `Projects/Notes`.                      |
| `lookup`           | `(path, folded) => result`: what is at a path that `files` and `directories` do not hold; see below.                        |

`lookup` lets a host leave files out of `files` and still have links to them
checked. It is called once per path, with `folded` true for an Obsidian link,
which matches without regard to case, and returns
`{ type: "file", path, source }`, `{ type: "directory" }`,
`{ type: "outside", through }` for a path that leads out of the workspace root
through the link `through`, `{ type: "unreadable", at }`, or `undefined` when
nothing is there. An Obsidian search by note name does not call it.

The CLI passes the directories it skipped as `unreadable`, the vaults it found
as `vaults`, and `rootInVault` when it finds the vault above the root; [Obsidian
vaults](obsidian.md#vaults-inside-a-larger-workspace) describes the effects. A
rule asks the workspace where a link leads; [resolve links in a
rule](plugins.md#resolve-links-in-a-rule) describes the result. A host can also
implement the `Workspace` interface itself.

## Part of a document

An editor's "format selection", or an agent that changed one paragraph, can
limit `lint` and `format` to parts of a document with `ranges`: a list of
`{ start, end }` offsets into the source as given, with `end` exclusive. Each
range is widened to the whole blocks that it touches, such as a paragraph, a
heading, a table, or a code block, also inside lists and block quotes, where a
range inside one item selects only that item's paragraph. A selected block takes
in its whole lines and the line breaks around it, so that the blank lines next
to it can change. An empty range, a cursor position, selects the block on whose
lines it is; a range in a run of blank lines selects nothing.

```ts
const source = "Legacy *word* stays.\n\nChange *this paragraph*.\n";
const start = source.indexOf("Change");
const result = format(source, { config, ranges: [{ start, end: start }] });
// result.output: "Legacy *word* stays.\n\nChange _this paragraph_.\n"
// result.scope: [{ start: 21, end: 47 }]: the paragraph and its line breaks
```

The whole document is still parsed and checked, so link definitions, suppression
comments, and the semantic check work as without ranges. `lint` returns the
diagnostics that start in the selected parts. `format` applies only the edits
that lie wholly inside them and leaves the rest byte for byte as it was; an edit
that reaches outside is not applied, but its diagnostic is reported, and so is
every `engine/` diagnostic. `scope` gives the selected parts in the output's
positions, so it can be passed as `ranges` again. Without `ranges` the whole
document is processed, and an empty list processes nothing. A range outside the
source, with `start` after `end`, or with offsets that are not integers is an
error. The CLI has no option for ranges.

## Files on disk

The `mdrefine/node` entry exports `discoverWorkspace`, the CLI's own discovery:

```ts
import { lint } from "mdrefine";
import { discoverWorkspace } from "mdrefine/node";

const discovery = await discoverWorkspace({ root: "/path/to/documents", config });
for (const name of discovery.selected)
  console.log(name, lint(discovery.read(name), discovery.options(name)));
```

It finds the files below `root` and selects documents as the CLI does: it honors
Git's ignore rules and the configuration's `ignore` and `resolve` settings,
leaves out nested repositories, symbolic links, and what the system does not let
it read, and recognizes each document's vault. It reads no configuration file
and writes nothing: pass the configuration as `config`, plugin objects as
`plugins`, and write results yourself.

- `inputs` lists files, directories, and patterns to select, absolute or
  relative to `root`, not to the current directory, as the CLI [selects
  them](cli.md#which-files-are-processed): a file is selected whatever its name,
  and an ignored file or directory is an entry of `skipped` with the code
  `IGNORED`. Omitted, every document is selected; an empty list selects none.
- `exclude` lists files and directories to leave out, as paths, not patterns.
- `documents` gives text for paths relative to `root`, such as an editor's
  unsaved buffer. Those documents are selected, and the workspace reads that
  text in place of a file, also where no file exists. One whose path ignore
  rules leave out is not selected and is an entry of `skipped`, as a named file
  is.

The result has `root`, the root's real path; `selected`, the documents as sorted
forward-slash paths relative to it; and `skipped`, with the entries of the JSON
report's `skipped` list. `read(name)` returns a selected document's text, read
when first needed and then kept, so one result is a snapshot for one run. An
error with the code `EACCES`, `EPERM`, or `EBUSY` means the file could not be
read, and one with the code `ERR_ENCODING_INVALID_ENCODED_DATA` that it is not
[UTF-8 text](cli.md#files-that-cannot-be-read-or-written), as its message says,
such as `Not UTF-8 text: notes/old.md (byte 0xE9 on line 1 is not valid UTF-8)`.
`options(name)` returns what the CLI passes to `lint` and `format` for the
document. Both throw for a name that is not selected. A root or input that
cannot be used is an error in the CLI's words, such as
`Input does not exist: notes/absent.md`.

## Other exports

- `parse(source, dialect, path, plugins)` returns a `Document`: `source`,
  `path`, `dialect`, and `tree`, an
  [mdast](https://github.com/syntax-tree/mdast) syntax tree. `document.source`
  starts after any byte order mark, and `range(node)` gives a node's
  `[start, end]` offsets into it. `textContent(node)` gives a node's text. An
  alias such as `codeberg` reads the document in its dialect, which
  `document.dialect` holds, and an unknown dialect is an error. A document whose
  front matter would end inside a code block, an HTML block, or display math is
  read without front matter, as the [safety model](design.md#safety-model)
  describes. In the Obsidian dialect, the tree holds `wikiLink`,
  `obsidianComment`, and `obsidianHighlight` nodes, typed as `WikiLink`,
  `ObsidianComment`, and `ObsidianHighlight` and registered with mdast's node
  types.
- `resolveConfig`, described above, and `validateConfig(value)`, which throws
  when a value is not a valid configuration. `configSchema` is the
  configuration's [JSON Schema](configuration.md#json-schema), which the package
  also ships as `mdrefine/config.schema.json`. `presets` holds the built-in
  presets.
- `dialects` lists the dialect names, `dialectAliases` maps aliases such as
  `codeberg` to them, and `canonicalDialect(name)` resolves an alias.
- `builtInRules` holds the built-in rule objects, and `ruleRegistry(plugins)`
  returns a new table that adds the rules of plugins under their IDs.
- `applyEdits(source, edits)` applies `{ start, end, text }` edits, which must
  not overlap. `semanticFingerprint(document, workspace)` is the comparison that
  `format` uses to refuse a change of meaning.

`presets`, `builtInRules`, `dialects`, `dialectAliases`, and `configSchema` are
shared by every caller in the process, so they are frozen and typed read-only;
copy what you want to change. Each export has a doc comment, and the TypeScript
types of these values are exported too, among them `Config`, `ProcessOptions`,
`FormatResult`, `Diagnostic`, `Plugin`, `Rule`, `JsonSchema`, `Workspace`,
`WorkspaceOptions`, and `LinkResolution`; `mdrefine/node` exports
`DiscoverOptions`, `WorkspaceDiscovery`, and `Skipped`. The type declarations
depend on `@types/mdast`, which the package installs.

Both entries are ES modules. A CommonJS module can load them with `require()`,
which the supported Node.js versions allow for ES modules.
