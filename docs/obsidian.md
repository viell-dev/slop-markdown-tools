# Obsidian vaults

The Obsidian profile understands wikilinks, embeds, callouts, highlights,
comments, heading references, and block references. Its rules share the same
lint and format engine used for ordinary Markdown.

## Configure the vault

Create `mdtools.config.jsonc` at the vault root:

```jsonc
{
  "extends": ["recommended", "obsidian"],
  "ignore": ["Templates/**"],
}
```

Use the vault root as `--root` so the CLI can resolve links across all notes and
from the vault's folder, as Obsidian does. Run these commands from a
[built checkout](quick-start.md):

```sh
node dist/cli/main.js lint --root "/path/to/vault" --json
node dist/cli/main.js format --root "/path/to/vault" --diff
```

Before that file exists, or when it names no dialect, the CLI still reads the
notes in the Obsidian dialect: a folder that contains a `.obsidian` folder is
recognized as a vault. Line breaks and wikilinks are then safe on a first run,
but only the dialect is assumed. The rules of the `obsidian` preset, including
the report that reflow is disabled, need the configuration above.
Version 0.2.0-rc.1 and earlier read such a vault as CommonMark, joined the lines
of its paragraphs, and could split a wikilink; with those versions, create the
configuration first.

## Vaults that are not the workspace root

A note belongs to the nearest vault at or above its folder, wherever the
workspace root is. Its assumed dialect and its line-break setting come from that
vault:

- **A vault in a folder of a larger workspace**, such as `docs/vault/` in a
  repository: its notes are read in the Obsidian dialect and the documents
  around it as GitHub Markdown. Each vault in a workspace follows its own
  `.obsidian/app.json`.
- **A folder of a vault used as the root**, with `--root` or through a
  configuration file in that folder: the vault is found above the root.
- **A repository inside a vault** is not part of the vault. The tool leaves a
  repository inside a workspace alone, and when it runs in that repository it
  reads the documents as GitHub Markdown.

A dialect named by the configuration or by `--dialect` still takes precedence
over all of this.

Links follow the vault as well. In a vault below the workspace root, a link in a
note reaches only the vault's files, as it does in Obsidian: a path is counted
from the vault's folder, a search by note name looks inside the vault, and
`links/path` writes `"style": "root"` paths from the vault's folder. The
findings and edits are the ones a run with the vault as the root produces. A
path that leads out of the vault to a file that exists, such as
`[the project](../../README.md)`, is reported as
`Local target is outside the vault`, because Obsidian cannot follow it.
Documents outside the vault link into it as into any other folder. Versions up
to `0.2.0-rc.1` resolved such a vault's links from the workspace root.

The opposite layout is still limited: a root that is a folder of a vault cannot
see the notes outside it and reports links to them as missing. Check and rewrite
such a vault's links with the vault as the root.

## Enable source wrapping

Obsidian reflow requires `"strictLineBreaks": true` in the vault's
`.obsidian/app.json` so soft line breaks in source do not become visible line
breaks in Reading view. Preserve the file's other settings when changing this
value. The CLI checks it and never edits the settings file itself. If it is not
permitted to read the file, or the file is not valid JSON, it warns and leaves
paragraphs as written; see
[paths that cannot be read](configuration.md#paths-that-cannot-be-read).

If that setting is not appropriate for your vault, disable `style/wrap`. Other
enabled rules can still run.

## Wrap callout bodies

With strict line breaks verified, `style/wrap` reflows supported body prose even
when it directly follows the callout header without a blank quote line. The
header stays on its original physical line, including its title and folding
marker. Existing quote and list-container prefixes are retained.

Hard breaks, block IDs, inline HTML, and unsupported multiline syntax still
protect body paragraphs. Lazy or inconsistent quote continuations and inline
syntax spanning the title/body boundary remain untouched. Long headers follow
`reportUnbreakable`; skipped breakable body prose follows `reportUnreflowed`.

## Choose link policies deliberately

The recommended preset validates local links. To normalize verified destinations
to vault-relative paths wrapped in angle brackets:

```jsonc
{
  "extends": ["recommended", "obsidian"],
  "rules": {
    "links/path": ["warn", { "style": "root", "brackets": "angle" }],
  },
}
```

For example, a resolved Markdown link can become `[Note](<Folder/Note.md>)`.
Note names and heading subpaths match case-insensitively, as in Obsidian, while
block identifiers match exactly; notes whose paths differ only by case are
reported as ambiguous. Missing or ambiguous destinations are never guessed.
Unaliased wikilinks retain their target spelling because changing it may change
their visible label. Note embeds remain embeds.

See [link policies](configuration.md#link-policies) for relative paths,
extension handling, and eligible Markdown/wikilink conversion. Path rewriting
and notation conversion should be run in separate passes.

## Review visible results

Preview changes with `--diff`, then use `--write` to apply them. Inspect complex
notes in Obsidian, especially when using additional plugins. The resolver does
not reproduce every Obsidian link-resolution behavior, and unsupported syntax
may need an ignore pattern or a
[suppression comment](configuration.md#suppressions).

The [vault example](examples.md#format-an-obsidian-vault) shows a small vault
before and after formatting. Read the
[current limitations](design.md#safety-boundaries) before a broad vault-wide
formatting pass.
