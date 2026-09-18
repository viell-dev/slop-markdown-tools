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

Use the vault root as `--root` so the CLI can inspect `.obsidian/app.json` and
resolve links across notes. Run these commands from a
[built checkout](quick-start.md):

```sh
node dist/cli/main.js lint --root "/path/to/vault" --json
node dist/cli/main.js format --root "/path/to/vault" --diff
```

## Enable source wrapping

Obsidian reflow requires `"strictLineBreaks": true` in `.obsidian/app.json` so
soft line breaks in source do not become visible line breaks in Reading view.
Preserve the file's other settings when changing this value. The CLI checks it
and never edits the settings file itself.

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
Missing or ambiguous destinations are never guessed. Unaliased wikilinks retain
their target spelling because changing it may change their visible label. Note
embeds remain embeds.

See [link policies](configuration.md#link-policies) for relative paths,
extension handling, and eligible Markdown/wikilink conversion. Path rewriting
and notation conversion should be run in separate passes.

## Review visible results

Preview changes with `--diff`, then use `--write` to apply them. Inspect complex
notes in Obsidian, especially when using additional plugins. The resolver does
not reproduce every Obsidian link-resolution behavior, and unsupported syntax
may need an ignore pattern or a
[suppression comment](configuration.md#suppressions).

Read the [current limitations](design.md#safety-boundaries) before a broad
vault-wide formatting pass.
