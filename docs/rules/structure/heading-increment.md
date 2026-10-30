# `structure/heading-increment`

Reports a heading more than one level deeper than the heading before it, such as
a level-3 heading directly after a level-1 heading. Readers who move through a
document by its headings, with a screen reader or a table of contents, rely on
the levels to show how sections nest.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all.
Options: `frontMatterTitle`.

Reported:

```markdown
# Install

### Requirements
```

Not reported:

```markdown
# Install

## Requirements

> [!NOTE]
>
> ### Older versions
```

`frontMatterTitle` treats a title in YAML or TOML front matter as a level-1
heading before the document's first heading, which may then be at most level 2,
as for a site generator that shows the title as the page's heading. It takes the
values and matching of
[`structure/initial-heading`](../structure/initial-heading.md)'s option of that
name: `true` for a top-level `title` key, a regular-expression string for
another field, and `false` or `""` for none. The default is `false`, because
GitHub, Forgejo, Gitea, Obsidian, and VitePress do not show a front-matter title
as a heading in the document, so its outline starts at the first heading.

## Edge cases and advanced usage

**Details:** the first heading may have any level, unless `frontMatterTitle`
counts a title before it. The headings of a block quote, which is also how
callouts and alerts are written, and of a footnote are checked among themselves:
a callout can start with a level-3 heading under any heading, and its headings
do not count for the document's. A front-matter title belongs to the document's
own outline, not to its quotes and footnotes.

## Related rules

Counting the level-1 headings below a title is
[`structure/single-title`](../structure/single-title.md)'s check.
