# `forgejo/heading-id`

Reports a heading attribute block whose `id` is not text, such as `{id=5}`,
`{id=true}`, or a list. Forgejo, and Gitea before 1.26, render nothing at all
for a document that contains one; Gitea 1.26 and later render the heading
without an anchor.

**Problem rule**, reported only. Presets: `forgejo` (error), `gitea` (error).
Dialects: Forgejo, Gitea. Options: none.

Reported:

```markdown
## Install {id=5}
```

Not reported:

```markdown
## Install {id="5"}
```

## Edge cases and advanced usage

**Details:** quote the value (`{id="5"}`) or write `{#5}`.
[Dialects](../../dialects.md#forgejo-and-gitea) describes attribute blocks.
