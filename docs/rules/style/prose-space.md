# `style/prose-space`

Collapses repeated ASCII spaces between prose words without moving line breaks:
`a.  b   c` becomes `a. b c`. It normalizes spacing in documents that keep their
authored line breaks, without the reflow of `style/wrap`.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options: none.

Before:

```markdown
a.  b   c
next  line
```

After:

```markdown
a. b c
next line
```

To keep line breaks as written and collapse spaces only:

```json
{ "rules": { "style/wrap": "off", "style/prose-space": "warn" } }
```

## Edge cases and advanced usage

**Details:** link text counts as prose. This rule and `style/wrap` agree on one
space between prose words. It is opt-in because sentence spacing can be an
intentional source convention.

**Left as written:** leading indentation, trailing spaces (including hard
breaks), non-breaking spaces, code, math, images, link destinations and titles,
and table cells. A block containing inline HTML stays whole, since HTML can make
whitespace significant; HTML blocks and front matter stay literal too. Renderer
and semantic checks keep the source wherever changing spaces would change
meaning.

**Reported without a fix:** spaces in `#` and underlined headings, in every
dialect, because changing heading text can change anchors and heading links.

## Dialect notes

**In VitePress:** projection syntax and Vue `{{ }}` interpolations keep their
spaces without a finding: expressions can contain whitespace-sensitive
JavaScript strings.
