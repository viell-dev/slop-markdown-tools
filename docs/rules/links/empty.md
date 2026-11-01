# `links/empty`

Reports a link or image whose destination is empty, as in `[guide]()`, or only
`#`, which leads to the top of the page. Both are usually placeholders that were
never filled in.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all.
Options: `ignoredDefinitions`.

Reported:

```markdown
See the [setup guide](#) and the [changelog]().
```

Not reported:

```markdown
See the [setup guide](#setup).
```

`ignoredDefinitions` lists the labels of definitions written as comments, as
[`links/unused-definition`](../links/unused-definition.md)'s option of the same
name does, with the same default, `["//"]`, and the same matching. Each rule
reads only its own option, so give both the same list when comments use other
labels.

## Edge cases and advanced usage

**Details:** a reference definition with such a destination is reported once, at
the definition, rather than at each reference to it. A definition written as a
comment, as in `[//]: # (comment)`, is not reported: the renderers show nothing
for it. A definition whose label a reference uses is a link, and is reported if
its destination is empty or only `#`.

**Not checked:** Obsidian wikilinks.
