# `github/alert-marker`

Writes the type of a GitHub alert in capitals. The renderers accept any case for
the five types `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`, and their
documentation spells them in capitals.

**Style rule**, fixed by `format`. Presets: `github` (warn), `forgejo` (warn),
`gitea` (warn), `vitepress` (warn). Dialects: GitHub, Forgejo, Gitea, VitePress.
Options: none.

Before:

```markdown
> [!note]
> Read this first.
```

After:

```markdown
> [!NOTE]
> Read this first.
```

## Edge cases and advanced usage

**Left as written:**

- Other types, which are not alerts there.
- A marker written with an escape or a character reference, such as `\[!note]`.
- A marker that GitHub shows as text: one in a block quote inside another quote
  or a list, one followed by text on its line, and one with nothing below it in
  the quote.
