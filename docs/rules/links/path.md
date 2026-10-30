# `links/path`

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

## Edge cases and advanced usage

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
  vaults](../../obsidian.md#a-workspace-root-inside-a-vault)).
