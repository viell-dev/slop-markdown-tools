# `style/definition-spacing`

Writes one space after a link reference definition's colon and one before its
title, without changing the label, destination, or title. A definition with no
space after the colon, such as `[guide]:guide.md`, gets one. It is an optional
source style, so no preset enables it and default formatting stays the same.

**Style rule**, fixed by `format`. Presets: none. Dialects: all but Obsidian.
Options: none.

Before:

```markdown
[guide]:   <guide.md>   "Guide"
```

After:

```markdown
[guide]: <guide.md> "Guide"
```

## Edge cases and advanced usage

**Left as written:**

- a multiline definition, including a multiline label or title: joining could
  change wrapping or how a container reads it;
- a footnote, or a label that starts with `^`, also in CommonMark;
- a definition containing a tab, because commonmark.js reads a tab-separated
  definition as text where GitHub and markdown-it read a definition.

## Dialect notes

**In Obsidian:** definitions keep their spacing, since Live Preview styles these
lines separately from Reading view.

## Related rules

The rule is independent of [`links/path`](../links/path.md), which needs a
workspace and changes destinations.
