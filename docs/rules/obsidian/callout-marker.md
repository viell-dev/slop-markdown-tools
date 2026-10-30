# `obsidian/callout-marker`

Writes the type of an Obsidian callout in lowercase, custom types included.

**Style rule**, fixed by `format`. Presets: `obsidian` (warn). Dialects:
Obsidian. Options: none.

Before:

```markdown
> [!TIP] Reading the notes
```

After:

```markdown
> [!tip] Reading the notes
```

## Edge cases and advanced usage

**Left as written:**

- The title and the body.
- A marker written with an escape or a character reference, such as `\[!TIP]`.
- A marker that Obsidian shows as text because more than one space or a tab
  separates it from the quote's `>`, as in `>  [!TIP]`.
