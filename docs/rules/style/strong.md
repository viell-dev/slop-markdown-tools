# `style/strong`

Writes strong emphasis with one marker, `*` by default.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

Before:

```markdown
A __bold__ claim.
```

After:

```markdown
A **bold** claim.
```

`marker` is `"*"` (the default), `"_"`, or `"consistent"`. With `"consistent"`,
the first parsed strong text chooses the marker independently of ordinary
emphasis: `__first__ and **later**` becomes `__first__ and __later__`. Each
document chooses independently.

## Edge cases and advanced usage

**Left as written:** the cases of [`style/emphasis`](../style/emphasis.md),
including when the first node cannot safely change.
