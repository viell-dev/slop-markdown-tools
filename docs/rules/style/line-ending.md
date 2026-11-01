# `style/line-ending`

Writes one configured line ending outside literal content. It keeps the spaces
and backslashes that mark hard breaks.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`endOfLine`.

Before, with line endings shown as escape sequences: `First\r\nSecond\r`. After
with `endOfLine: "lf"`: `First\nSecond\n`.

- `endOfLine`: `"lf"` (default), `"crlf"`, `"cr"`, or `"auto"`. `auto` uses the
  first line ending in the document, or LF when there is none.

## Edge cases and advanced usage

**Details:** this rule is opt-in. The recommended preset keeps the existing
line-ending convention rather than rewriting CRLF files; Git attributes and
checkout settings can already manage that convention.

**Left as written:** line endings inside code blocks and code spans, HTML, math
(display and inline), link, image and definition titles, and YAML or TOML front
matter retain their bytes. These literal values can depend on whitespace, so
this rule differs from Prettier's document-wide replacement. Renderer boundary
protections and suppressions still apply. A change that fails the semantic
comparison is reported without a fix. This can leave mixed endings around
protected content. The rule neither adds nor removes a final newline; use
[`style/final-newline`](../style/final-newline.md) for that.
