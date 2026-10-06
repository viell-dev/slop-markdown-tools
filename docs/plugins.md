# Plugins and library API

The public API is exported from `mdrefine`. Follow the
[installation guide](quick-start.md) to install the npm package or build a
checkout as a local dependency. The API is provisional until a stable release.

## Library calls

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

Library calls do not read or write files; the
[library examples](examples.md#call-the-library) include a script that reads a
folder and builds the workspace from it. `path` and workspace keys use
forward-slash paths relative to the workspace root. Use `null` values for
non-Markdown attachments. A Markdown value can also be a synchronous loader
`() => string`; `createWorkspace` calls it only when that target needs fragment
validation, then keeps the target's anchors, not its text or its parsed form.
The anchors of Obsidian, of GitHub and CommonMark, and of Forgejo and Gitea
differ, so the loader is called once more when a later link to that target is
checked for a dialect of another of these groups; `0.2.0-rc.1` and earlier
called it at most once and kept the parsed target. Callers must provide a stable
source snapshot for each workspace instance. The CLI provides its own
per-invocation file loaders. `WorkspaceOptions.directories` can list existing
empty directories; parent directories of file entries are inferred. Resolution
returns `status: "directory"` for a directory instead of `"missing"`.

`WorkspaceOptions.unreadable` lists existing directories whose contents the host
could not read. A link that leads into one resolves with `status: "unreadable"`
instead of `"missing"`, and the result's `unreadable` field names the
directories that stand in the way. In the Obsidian dialect, a search by note
name that finds nothing also resolves as `"unreadable"`. One that finds a single
note is `"resolved"` with `unreadable` set, because those directories may hold
another note of that name. The same marks a note found beside the linking note
when the vault-root path of that spelling leads into an unreadable directory,
where Obsidian would look first. A rule must not rewrite such a link:
`links/path` and `links/notation` leave it as written, and the engine refuses an
edit by any rule that changes its destination, because only the same spelling is
known to name the same note. The CLI passes the directories it
[skipped](configuration.md#paths-that-cannot-be-read). A loader that throws an
error whose `code` is `EACCES` or `EPERM`, as Node.js does for a file the
process is not permitted to read, makes a link to a heading or block in that
file resolve as `"unreadable"` too, with `target` set and `unreadable` naming
the file; a link to the file without a fragment still resolves. Any other error
from a loader propagates. Versions up to `0.2.0-rc.1` have neither the option
nor the status, and let every loader error through.

`WorkspaceOptions.vaults` lists folders below the workspace root that are
Obsidian vaults of their own. An Obsidian link in a note of such a vault is
resolved within it: a path is counted from the vault's folder, and a search by
name looks only at the vault's files. The result's `vault` field then names the
folder, also when nothing was found; `target` stays relative to the workspace
root, so a rule that writes a path from the vault removes that prefix. A path
that names an existing file or folder outside the vault resolves as `"missing"`
with that file in `outside`. Notes outside the listed folders, and all other
dialects, resolve as without the option. The CLI passes the vaults it found
below the root. Versions up to `0.2.0-rc.1` have neither the option nor the
fields.

`WorkspaceOptions.rootInVault` is for a workspace whose root is a folder of an
Obsidian vault: the root's path from the vault's folder, such as
`Projects/Notes`. The rest of the vault is then out of sight, and an Obsidian
link whose target could lie there resolves as `"unreadable"`, not `"missing"`. A
target found by a search, or in a place that Obsidian tries after one outside
the root, is `"resolved"` with `unreadable` set and so is not rewritten. In both
cases the `unreadable` list holds an entry that starts with `..`, the way from
the root to the vault's folder. A resolved link also carries `rooted`, the
target's path from the folder of its vault, whenever that differs from `target`;
this applies to a vault listed in `vaults` as well. The CLI passes the option
when it finds the vault above the root. Versions up to `0.2.0-rc.1` do not have
it.

Without a workspace, local target checks and path rewriting are unavailable.
Obsidian reflow also requires an explicit `workspace.strictLineBreaks: true`;
callers are responsible for verifying that renderer setting.

A document is read in the dialect its configuration names: through `dialect`, a
preset, or a matching override. When none of them does, including when `config`
is omitted, `lint`, `format`, and `resolveConfig` assume `github`, and
`createWorkspace` parses link targets as `github` when
`WorkspaceOptions.dialect` is omitted. Version 0.2.0-rc.1 and earlier assumed
`commonmark` in both places; name it to keep that reading. Give the workspace
the dialect of the documents that link into it.

A host that knows more than the configuration says can change what is assumed,
without overriding a dialect that the configuration does name. Pass
`defaultDialect` in the options of `lint` and `format`, or as the fourth
argument of `resolveConfig(config, path, plugins, defaultDialect)`; it accepts a
dialect or an alias. The library reads no files and so recognizes nothing by
itself: the CLI passes `obsidian` for a document that has a `.obsidian` folder
in its own folder or in one above it, and gives the workspace that vault's
`strictLineBreaks` setting. A host for vaults should do the same.

```ts
// The host found `.obsidian/` at the root of the folder it read `files` from.
const defaultDialect = "obsidian";
const { dialect } = resolveConfig(config, "Note.md", [], defaultDialect);
const workspace = createWorkspace(files, { dialect, strictLineBreaks });
const result = format(files["Note.md"], { path: "Note.md", config, workspace, defaultDialect });
```

`parse`, `range`, `textContent`, `resolveConfig`, `validateConfig`,
`configSchema`, `presets`, `dialects`, `dialectAliases`, `canonicalDialect`,
`builtInRules`, `ruleRegistry`, `applyEdits`, and `semanticFingerprint` are also
exported. `range(node)` returns `[start, end]` UTF-16 offsets into the original
source. `configSchema` is the configuration's JSON Schema, and
`validateConfig(value)` throws when a value does not match it; rule-specific
schemas live on rule objects. `canonicalDialect(name)` maps an alias such as
`codeberg` to the dialect that rules and the workspace see (`forgejo`);
`document.dialect` is always canonical.

## Rule plugins

Create `rules.mjs` beside the configuration:

```js
export default {
  name: "local",
  presets: {
    recommended: { rules: { "local/initial-heading": "error" } },
  },
  rules: {
    "initial-heading": {
      description: "Require the first content block to be a heading.",
      kind: "problem",
      check({ document }) {
        const first = document.tree.children.find(
          (node) => node.type !== "yaml" && node.type !== "toml",
        );
        return first?.type === "heading"
          ? []
          : [{ start: 0, message: "Start this document with a heading." }];
      },
    },
  },
};
```

Load it with:

```json
{
  "plugins": ["./rules.mjs"],
  "extends": ["recommended", "local/recommended"]
}
```

Each `plugins` entry names a module whose default export is a plugin object. An
entry that starts with `.` or is an absolute path names a file, relative to the
configuration file's directory. Any other entry is resolved the way Node.js
resolves an `import` written in the configuration file, with the conditions that
Node.js itself applies: its defaults, those added with `--conditions` or `-C`,
and without `node-addons` under `--no-addons`, whether the option is on
Node.js's command line or in `NODE_OPTIONS`. Options set in any other way, such
as a Node.js configuration file, are not seen. `0.2.0-rc.1` and earlier applied
no added conditions. Usually such an entry names an installed package,
optionally with a subpath: `sample-plugin`, `@scope/sample-plugin`, or
`sample-plugin/rules`. The package's entry can be an `import` or `default`
condition of its `exports`, or its `main` file. When an import finds no entry,
the lookup falls back to Node.js's CommonJS rules, so a package that declares
only a `require` condition loads too. A package with both an `import` and a
`require` entry is loaded through its `import` entry. `0.2.0-rc.1` and earlier
used only the CommonJS rules, so they could not load a package that declares
only an `import` condition, and loaded a package with both entries through
`require`.

A plugin that cannot be found or loaded stops the command with exit status `2`
and a message of the form
`Cannot load plugin "sample-plugin" named in FILE: REASON`. `FILE` is the
configuration file and `REASON` is Node.js's own, such as
`Cannot find package 'sample-plugin' imported from FILE`. For an entry that
names a file, the reason is `no file at PATH` when nothing is there or the path
is a folder. A module whose default export is not an object with a string `name`
is reported as `Invalid plugin "sample-plugin" named in FILE`. `0.2.0-rc.1` and
earlier printed Node.js's reason alone.

Library callers pass plugin objects directly through `plugins`; a string list in
a library configuration does not perform module loading. Plugin names must be
unique lowercase identifiers beginning with a letter, using letters, digits, and
hyphens. Rule IDs are namespaced as `plugin-name/rule-name`; collisions are
rejected.

`check` receives the parsed `document`, configured `options`, and optional
`workspace`. Return a list of findings containing `start`, optional `end`,
`message`, and optional `edit`. A rule may declare a JSON Schema in `schema` to
validate its options. Rules are synchronous and should not mutate the document,
perform I/O, or retain invocation-specific state.

Style rules use `kind: "style"` and can return edits of the form
`{ start, end, text }`. Their optional `phase` is `inline` (default), `block`,
or `document`. Problem rules use `kind: "problem"`; their edits are not applied
by `format`. Formatting runs phases repeatedly until stable, with a limit of
eight passes. Conflicting edits, oscillation, or a semantic change reject the
entire document's output.

The [plugin example](examples.md#write-a-plugin) is a complete plugin with a
problem rule and a style rule to start from. Verify a style rule by formatting
its output again: a correct rule leaves it unchanged. Plugins execute within the
host process and are not sandboxed. Semantic checking constrains the returned
text, not arbitrary JavaScript behavior.

## Resolve links in a rule

A rule asks the workspace where a link leads with
`workspace.resolve(source, destination, dialect)`: `source` is the path of the
linking document (`document.path`), `destination` the link's destination as
written, and `dialect` the document's dialect. The built-in link rules use this
call and nothing else, so a plugin sees links exactly as they do. `workspace` is
undefined when the host gave none; a rule should then report nothing.

```js
export default {
  name: "local",
  rules: {
    "no-dead-links": {
      description: "Report links to files that are not in the workspace.",
      kind: "problem",
      check({ document, workspace }) {
        if (!workspace) return [];
        const findings = [];
        const visit = (node) => {
          if (node.type === "link") {
            const result = workspace.resolve(document.path, node.url, document.dialect);
            if (result.status === "missing")
              findings.push({
                start: node.position.start.offset,
                message: `No file at ${node.url}.`,
              });
          }
          for (const child of node.children ?? []) visit(child);
        };
        visit(document.tree);
        return findings;
      },
    },
  },
};
```

The result's `status` is one of:

| Status        | Meaning                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `resolved`    | One file matches. `target` is its path from the workspace root.                                               |
| `missing`     | No file matches.                                                                                              |
| `ambiguous`   | Several files match and nothing decides between them, such as two notes whose names differ only by case.      |
| `directory`   | The destination names a folder.                                                                               |
| `external`    | The destination is a URL with a scheme, or starts with `//`. It is not checked.                               |
| `unavailable` | The destination cannot be judged from files: it starts with `/` or holds a `?`, outside the Obsidian dialect. |
| `unreadable`  | The target could not be checked, because something that may hold it could not be read.                        |

The other fields are present when they apply:

- `target`: the file found, with status `resolved`, and with `unreadable` when
  the file is there but its content could not be read.
- `fragment`: the part after `#`, decoded, or an empty string.
- `fragmentExists`: with status `resolved`, whether the target has the heading,
  block, or anchor that the fragment names, by the rules of `dialect`. It is
  true when there is no fragment.
- `unreadable`: what stood in the way; see the paragraphs on
  `WorkspaceOptions.unreadable` and `rootInVault` above. When it is set on a
  `resolved` link, the match is uncertain and a rule must not rewrite the link.
- `vault`, `rooted`, and `outside`: for Obsidian links in a vault that is not
  the workspace root; see `WorkspaceOptions.vaults` above.

A style rule that rewrites a destination should resolve its replacement as well
and propose the edit only when both lead to the same `target`. The engine checks
this again and refuses an edit that changes where a link leads.

## Syntax extensions

An advanced plugin can provide `syntax: { micromark, mdast }`, containing
compatible tokenizer and AST extensions from the micromark/mdast ecosystem.
Extend the TypeScript mdast node maps for custom node types. Preserve source
positions and expose meaningful semantic fields: the engine compares node fields
other than `position` and `data` when checking formatting safety.

This is not a general remark-transform adapter. Existing syntax extensions can
be reused, but a remark plugin that mutates a tree must be adapted to the
rule/edit contract. There is no custom link resolver loader in CLI plugins yet;
library users can supply an implementation of the `Workspace` interface. Unknown
syntax is not automatically safe merely because a parser treats it as plain
text; use a supported dialect, an extension, an ignore pattern, or a suppression
for application-specific constructs.
