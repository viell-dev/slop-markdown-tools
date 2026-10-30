# `obsidian/block-reference`

Reports a block identifier that a note uses more than once. A link to `#^id` can
reach only one of them.

**Problem rule**, reported only. Presets: `obsidian` (error). Dialects:
Obsidian. Options: none.

Reported, on the second paragraph:

```markdown
First idea. ^idea

Second idea. ^idea
```

## Edge cases and advanced usage

**Details:** a block identifier is `^` and Latin letters, digits, and hyphens at
the end of a paragraph or heading, or alone on the line after a list or quote,
as Obsidian defines it.
