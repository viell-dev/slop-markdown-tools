# `style/code-block`

Writes code blocks in one form, fenced or indented, and reports those in the
other. It converts indented code to fences where the dialect permits that
change; other findings are reported only. No preset enables it, so default
formatting stays the same.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`style`.

With `{ "style": "fenced" }`, before:

```markdown
    npm test
```

After:

````markdown
```
npm test
```
````

| Option  | Values                             | Default      |
| ------- | ---------------------------------- | ------------ |
| `style` | `consistent`, `fenced`, `indented` | `consistent` |

- `style`: `consistent` takes the form of the document's first parsed code
  block, `fenced` requires fences, and `indented` requires indentation.

## Edge cases and advanced usage

**Details:** a conversion keeps the code, including its tabs and the blank lines
inside it, and the block's list or quote container. The new backtick fence is
longer than any run of backticks in the code.

**Reported without a fix:**

- A fenced block where the indented form is required: indentation cannot keep a
  language or metadata, and can change blank lines or where an adjacent
  paragraph ends.
- An indented block in a container whose prefix holds a tab, because removing
  indentation can change its tab stops.
- An indented block that a renderer protects.

**Not checked:** continuation paragraphs in list items and footnotes, which are
text, not code blocks.

## Dialect notes

**In VitePress:** indented blocks are reported without conversion, which keeps
the protection of opaque code and VitePress's distinct rendering of fenced code.
Line highlighting and `::: code-group` syntax stay intact.

## Related rules

[`style/code-fence`](../style/code-fence.md) chooses the marker and length of
existing fences, independently of this rule.
