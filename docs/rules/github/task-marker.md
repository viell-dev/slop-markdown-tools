# `github/task-marker`

Writes the mark of a completed task as a lowercase `x`.

**Style rule**, fixed by `format`. Presets: `github` (warn), `forgejo` (warn),
`gitea` (warn), `obsidian` (warn), `vitepress` (warn). Dialects: all but
CommonMark; VitePress needs task lists enabled. Options: none.

Before:

```markdown
- [X] Write the guide
```

After:

```markdown
- [x] Write the guide
```
