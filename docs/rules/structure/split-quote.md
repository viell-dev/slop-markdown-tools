# `structure/split-quote`

Reports a blank line between two block quotes with nothing else between them.
GitHub, Forgejo, Gitea, Obsidian, VitePress, and CommonMark show two quotes,
while some other renderers join them into one, and the blank line may have been
meant to separate paragraphs of one quote.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
> Back up the database first.

> Then run the migration.
```

Not reported:

```markdown
> Back up the database first.
>
> Then run the migration.

> [!NOTE]
> Migrations run in a transaction.

> [!WARNING]
> Old backups cannot be restored.
```

## Edge cases and advanced usage

**Details:** to write one quote, start the blank line with `>`; to keep two, put
text or a comment, such as `<!-- -->`, between them. Either changes what
renderers show, so the rule only reports. Quotes inside a list item or another
quote are checked among their siblings. A plain quote after an alert is
reported: its text may have been meant as part of the alert.

**Not checked:** a quote whose first line opens with an alert's or callout's
marker, such as `[!NOTE]` or `[!tip]`, after a blank line, because a blank line
is the only way to write two alerts or callouts one after the other. The marker
shows the quote's intent in every dialect.
