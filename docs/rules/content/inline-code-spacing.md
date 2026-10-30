# `content/inline-code-spacing`

Reports a code span with blank space at its start or end that renderers show as
part of the code, as in `` `  npm test  ` `` or `` ` npm test` ``. Readers see
and copy that space with the code.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
Run ` npm test` before you commit.
```

Not reported:

```markdown
Run `npm test` before you commit, and `` `backticks` `` show as code.
```

## Edge cases and advanced usage

**Details:** renderers take one space off each end of a code span only when both
ends have one, so `` ` npm test ` `` shows `npm test`, while `` ` npm test` ``
keeps its space and `` `  npm test  ` `` keeps one at each end. Removing the
space changes the code that readers see and copy, and some code needs it, so the
rule only reports. Blank space is reported only next to a letter or a digit of
the code. A line ending at an end of the span counts as the space that renderers
show for it.

**Not checked:**

- Blank space next to another character, which usually belongs to the code, as
  when a span shows syntax such as a list item's `- ` or a definition's `: `.
- The space next to a backtick at an end of the code, as in ``` `` `npm`` ```,
  which keeps that backtick apart from the span's own.
- More than one space or a tab at one end only, as in `` `    Text` ``, which
  shows indentation.
- The one space at each end that renderers take off, and a span of nothing but
  blank space.

## Dialect notes

**In Obsidian:** a span of one or two backticks across lines is not reported,
because Live Preview ends it at its line.

## Related rules

This is a rule of its own rather than an option of
[`style/inline-code`](../style/inline-code.md): that rule only makes edits that
keep the code as renderers show it, and no edit of the padding does, so there is
nothing to fix, only to report.
