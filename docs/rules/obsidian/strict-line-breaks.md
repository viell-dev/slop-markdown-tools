# `obsidian/strict-line-breaks`

Reports, once per note, that `style/wrap` leaves the note as written because the
vault's "Strict line breaks" setting is not known to be on. Without that
setting, Obsidian's Reading view shows every line break in a paragraph, so
joining or breaking lines would change what the note looks like.

**Problem rule**, reported only. Presets: `obsidian` (warn). Dialects: Obsidian.
Options: none.

Not reported in a vault whose `.obsidian/app.json` holds:

```json
{ "strictLineBreaks": true }
```

## Edge cases and advanced usage

**Details:** the tool reads the setting and never changes it. The finding is at
line 1, and its message begins
`Obsidian's "Strict line breaks" setting is not known to be on`. See [Obsidian
vaults](../../obsidian.md#enable-wrapping).
