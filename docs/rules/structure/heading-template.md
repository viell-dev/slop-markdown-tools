# `structure/heading-template`

Requires the document's headings to follow a configured sequence, such as a
guide's required sections. It reports the first heading that cannot continue a
match, or the end of the document when a required heading is missing, with the
heading or headings expected there, and never inserts, removes, or renames a
heading.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`headings`, `matchCase`.

With `{ "headings": ["# Guide", "*", "## Notes"] }`, reported:

```markdown
# Guide

## Install

## Usage
```

Not reported:

```markdown
# Guide

## Install

## Notes
```

| Option      | Values                                     | Default |
| ----------- | ------------------------------------------ | ------- |
| `headings`  | An array of `#` headings and `*`, `+`, `?` | Unset   |
| `matchCase` | `true` or `false`                          | `false` |

- `headings`: the sequence. A heading entry is written as an ATX heading with
  its level, such as `## Notes`. `*` matches zero or more headings of any text,
  `+` one or more, and `?` exactly one. Unset turns the check off; `[]` requires
  that the document have no headings.
- `matchCase`: with `true`, capitalization must match too.

Use [overrides](../../configuration.md#overrides) to apply a template to one
group of files:

```json
{
  "overrides": [
    {
      "files": ["guides/**/*.md"],
      "rules": {
        "structure/heading-template": [
          "error",
          { "headings": ["# Guide", "*", "## Notes"], "matchCase": false }
        ]
      }
    }
  ]
}
```

## Edge cases and advanced usage

**Details:** the sequence follows the document's own outline, including headings
in lists. Block quotes and footnotes have outlines of their own and do not take
part, so a quoted example or a footnote need not follow the page's template.
Headings are compared by their rendered text, with whitespace collapsed and
inline Markdown, escapes, and character references read; closing `#` sequences
are syntax. Wildcards are matched by tracking the possible positions in the
template rather than by backtracking, so the time grows with the template's
length times the number of headings.

## Dialect notes

**In Forgejo, Gitea, and VitePress:** a trailing attribute block such as
`{#setup}` is not part of the heading's text where the dialect reads it as the
heading's attributes. In other dialects it stays text.

**In Obsidian:** a block identifier such as `^setup` is not part of the
heading's text.
