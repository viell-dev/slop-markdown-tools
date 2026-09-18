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

Library calls do not read or write files. `path` and workspace keys use
forward-slash paths relative to the workspace root. Use `null` values for
non-Markdown attachments. A Markdown value can also be a synchronous loader
`() => string`; `createWorkspace` calls it only when that target needs fragment
validation, then caches its parsed heading/block index. Callers must provide a
stable source snapshot for each workspace instance. The CLI provides its own
per-invocation file loaders. `WorkspaceOptions.directories` can list existing
empty directories; parent directories of file entries are inferred. Resolution
returns `status: "directory"` for a directory instead of `"missing"`.

Without a workspace, local target checks and path rewriting are unavailable.
Obsidian reflow also requires an explicit `workspace.strictLineBreaks: true`;
callers are responsible for verifying that renderer setting.

`parse`, `range`, `textContent`, `resolveConfig`, `configSchema`, `presets`,
`builtInRules`, `ruleRegistry`, `applyEdits`, and `semanticFingerprint` are also
exported. `range(node)` returns `[start, end]` UTF-16 offsets into the original
source. `configSchema` is the configuration's JSON Schema; rule-specific schemas
live on rule objects.

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

Plugin module specifiers resolve relative to the config file, including npm
package names. Export a default plugin object. Library callers pass plugin
objects directly through `plugins`; a string list in a library configuration
does not perform module loading. Plugin names must be unique lowercase
identifiers beginning with a letter, using letters, digits, and hyphens. Rule
IDs are namespaced as `plugin-name/rule-name`; collisions are rejected.

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

Use built-in test helpers and fixture examples to verify custom style rules.
Plugins execute within the host process and are not sandboxed. Semantic checking
constrains the returned text, not arbitrary JavaScript behavior.

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
