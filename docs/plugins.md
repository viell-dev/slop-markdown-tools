# Plugins

A plugin adds rules, presets, and syntax to the built-in ones. It is a
JavaScript module whose default export is a plugin object. The
[plugin example](examples.md#write-a-plugin) is a complete plugin with a problem
rule and a style rule to start from.

## A plugin

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

and load it from the configuration:

```json
{
  "plugins": ["./rules.mjs"],
  "extends": ["recommended", "local/recommended"]
}
```

`name` is the plugin's prefix: a lowercase identifier that starts with a letter
and holds letters, digits, and hyphens, unique among the loaded plugins. Its
rules are named `name/rule` and its presets `name/preset`; a rule ID that
already exists is an error. A plugin can also provide `syntax`, described
[below](#syntax-extensions). The library takes plugin objects through its
`plugins` option; a list of strings in a library configuration loads nothing.

## Loading

The configuration's `plugins` entries are loaded when the configuration is, and
run with the caller's permissions; plugins are not sandboxed. An entry that
starts with `.` or is an absolute path names a file, relative to the
configuration file's directory. Any other entry is resolved as Node.js resolves
an `import` written in the configuration file, such as `sample-plugin`,
`@scope/sample-plugin`, or `sample-plugin/rules`. The package's entry can be an
`import` or `default` condition of its `exports`, or its `main` file. When the
import finds no entry, Node.js's CommonJS rules are tried, so a package that
declares only a `require` condition loads as well; a package with both is loaded
through `import`. The lookup applies the conditions that Node.js applies: its
defaults, those added with `--conditions` or `-C`, and without `node-addons`
under `--no-addons`, from Node.js's command line or `NODE_OPTIONS`. Options set
in other ways, such as a Node.js configuration file, are not seen.

A plugin that cannot be loaded stops the command with exit code `2` and the
message `Cannot load plugin "NAME" named in FILE: REASON`, where `REASON` is
Node.js's own, such as `Cannot find package 'sample-plugin' imported from FILE`,
or `no file at PATH` for a file entry. A module whose default export is not an
object with a string `name` gives `Invalid plugin "NAME" named in FILE`.

## Rules

A rule is an object with a `description`, a `kind`, an optional `schema` and
`phase`, and a `check` function.

- `kind` is `"problem"` for a rule that only reports, or `"style"` for one that
  can propose edits, which `format` applies. `format` ignores the edits of
  problem rules.
- `schema` is a JSON Schema for the rule's options. The options a configuration
  gives are checked against it, and a rule without a schema accepts any options.
- `check({ document, options, workspace })` receives the parsed `document`
  (`source`, `path`, `dialect`, and `tree`, an
  [mdast](https://github.com/syntax-tree/mdast) tree with source positions), the
  configured `options`, and the `workspace`, which is undefined when the host
  gave none. It returns a list of findings.

A finding has a `message`, a `start` offset, an optional `end`, and, from a
style rule, an optional `edit` of the form `{ start, end, text }`. Offsets count
UTF-16 code units in `document.source`; `range(node)` from the library gives a
node's offsets. `check` must be synchronous, must not change the document or
perform I/O, and must not keep state between calls.

A style rule's `phase` is `"inline"` (the default), `"block"`, or `"document"`.
`format` runs the phases in that order and repeats them until nothing changes,
for at most eight passes. After each phase that changes the document, it parses
the result again and compares its meaning with the original's. Edits that
overlap, rules that undo each other, or a change of meaning make `format` return
the document unchanged with an `engine/unsafe-format` error. The comparison
covers the syntax tree, not every application's rendering, and it constrains the
text a rule returns, not what its code does.

## Resolve links in a rule

A rule asks the workspace where a link leads with
`workspace.resolve(source, destination, dialect)`: `source` is the linking
document's path (`document.path`), `destination` the destination as written, and
`dialect` the document's dialect. The built-in link rules use the same call, so
a plugin sees links as they do. Without a workspace, a rule should report
nothing.

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
| `directory`   | The destination names a directory.                                                                            |
| `external`    | The destination is a URL with a scheme, or starts with `//`. It is not checked.                               |
| `unavailable` | The destination cannot be judged from files: it starts with `/` or holds a `?`, outside the Obsidian dialect. |
| `unreadable`  | The target could not be checked, because something that may hold it could not be read.                        |

The other fields are present when they apply:

- `target`: the file found, with status `resolved`, and with `unreadable` when
  the file exists but its content could not be read.
- `fragment`: the part after `#`, decoded, or an empty string; `fragmentExists`:
  with status `resolved`, whether the target has that heading, block, or anchor
  by the rules of `dialect`, and `true` without a fragment.
- `unreadable`: the directories or the file that stood in the way. An entry that
  starts with `..` stands for the part of a vault outside the workspace root. In
  the Obsidian dialect, a search by note name that finds nothing readable
  resolves as `unreadable`, and one that finds a single note resolves with
  `unreadable` set, because the unreadable directories may hold another note of
  that
  name. **A rule must not rewrite a `resolved` link whose `unreadable` is set**,
  and the engine refuses an edit that changes such a link's destination.
- `vault`: the vault's directory, when an Obsidian link was resolved in a vault
  below the workspace root. `rooted`: the target's vault-relative path, when it
  differs from `target`. `outside`: with status `missing`, an existing file that
  the path names outside the vault.

A style rule that rewrites a destination should resolve the new destination as
well, and propose the edit only when both lead to the same `target`. The engine
checks this again and refuses an edit that changes where a link leads.

## Syntax extensions

A plugin can provide `syntax: { micromark, mdast }`, a tokenizer extension and a
tree extension from the [micromark](https://github.com/micromark/micromark) and
mdast ecosystem. In TypeScript, extend mdast's node maps for the new node types.
Keep source positions on the nodes, and expose the meaning of a node in its
fields: the semantic comparison looks at every field except `position` and
`data`. Syntax that a parser reads as plain text is not safe to format merely
for that; test the extension's meaning and its source preservation.

This is not a remark plugin adapter. Existing micromark extensions can be
reused, but a remark plugin that changes the tree must be rewritten as a rule
that proposes edits. A plugin cannot replace link resolution; a library host can
pass its own implementation of the `Workspace` interface.

## Test a rule

Call the library with the plugin object, and check what it reports and what
formatting produces:

```js
import { format, lint } from "mdrefine";
import plugin from "./rules.mjs";

const options = {
  plugins: [plugin],
  config: { extends: [], rules: { "local/initial-heading": "error" } },
};
console.assert(lint("Text.\n", options).length === 1);
console.assert(lint("# Title\n", options).length === 0);
const once = format("Text.\n", options).output;
console.assert(format(once, options).output === once);
```

A correct style rule leaves its own output unchanged when it runs again, and
changes nothing when it is turned off. Add a case for every construct the rule
could misread, such as code, HTML, and each dialect it supports.
