# `links/path`

Rewrites the destination of a local link to the configured path spelling, such
as a path relative to the linking document. A link is rewritten only when its
target exists and its fragment, if any, is found, and only when the new
destination leads to the same file and fragment.

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

- `style`: `relative` counts the path from the linking document. In the Obsidian
  dialect, `root` counts from Obsidian's notes folder, called a vault, without a
  leading slash. `shortest`, also Obsidian only, writes just the note's name
  when that name finds the same note, and otherwise the path from the vault's
  root.
- `brackets`: `angle` writes the destination in `<…>`; `bare` writes it without,
  with spaces percent-encoded.
- `extension`: whether the path to a Markdown file ends in `.md`. `omit` applies
  in the Obsidian dialect only.
- `leadingDot`: with `relative`, start a path with `./` when it does not start
  with `./` or `../`, also a path to a name that starts with a dot, such as
  `./.gitignore`.

## Edge cases and advanced usage

**Details:** a destination that already has the configured spelling keeps its
percent-encoding; a new path encodes `%` and `#`, so that it names the same
file, and in a table cell writes a `|` in a name as `\|`, because one that is
not escaped ends the cell. Absolute filesystem paths are never written.

**Left as written:**

- An Obsidian note link such as `[[Note]]` without a display label, whose target
  is also its visible text.
- Reference definitions, which are checked but not rewritten.
- Autolinks.
- Links whose target is uncertain because a directory could not be read.
- Obsidian links whose target is uncertain because the workspace root covers
  only part of the notes folder (see [Obsidian
  vaults](../../obsidian.md#a-workspace-root-inside-a-vault)).

## Dialect notes

**In Obsidian:** a relative path also gets `./` when an unprefixed path would
name a different file at the vault's root. In a note link such as
`[[Note|display label]]`, only the destination changes: the `|` or `\|` after it
and the display label stay as written. The same applies to the size in an embed
such as `![[image.png|200]]`.
