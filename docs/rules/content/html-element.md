# `content/html-element`

Reports HTML elements, for documents that should hold only Markdown or that are
read as text or turned into other formats than HTML. Each element is reported
once, at its opening tag.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`allowedElements`, `tableAllowedElements`.

Reported:

```markdown
<h2>Sales</h2>

Press <kbd>Enter</kbd> to continue.
```

Not reported:

```markdown
## Sales

Press `Enter` to continue, or write to <sales@example.com>.

<!-- Checked in March. -->
```

| Option                 | Values                    | Default                   |
| ---------------------- | ------------------------- | ------------------------- |
| `allowedElements`      | An array of element names | `[]`                      |
| `tableAllowedElements` | An array of element names | Same as `allowedElements` |

- `allowedElements`: the elements allowed, compared without letter case, such as
  `["br", "details", "summary"]`; in tables too, unless `tableAllowedElements`
  is set.
- `tableAllowedElements`: the elements allowed in the cells of a Markdown table,
  in place of `allowedElements` there. `{ "tableAllowedElements": ["br"] }`
  allows `<br>` line breaks in tables and nowhere else.

## Edge cases and advanced usage

**Details:** closing tags are not reported, because the element was reported at
its opening tag, and a void element such as `<br>` or `<img>`, also written as
`<br/>`, has no other tag. Elements are found in HTML blocks and inline HTML as
the dialect's parser reads them, also in headings, links, table cells, block
quotes, and lists. A message names the element as written.

HTML is read as a browser reads the page, each HTML block, and the inline HTML
of a paragraph, heading, or table cell, together. Where that reading becomes
uncertain, nothing after it is reported, in favor of missing an element over
reporting what renderers do not read as one:

- a comment, a raw-text element such as `<textarea>` or `<script>`, or a tag
  left open at the end of such a block: most renderers read it on through the
  Markdown that follows, but Obsidian renders each block alone;
- an abrupt comment such as `<!-->`, CDATA, and a comment inside a raw-text
  element, which renderers that remove comments read differently;
- a part of the document that a renderer reads otherwise than the parser, when
  it holds a `<`, such as text below an Obsidian HTML block that Reading view
  takes for more of the block;
- in Obsidian and VitePress, a paragraph with an inline footnote such as
  `^[note]`, which moves to the end of the page;
- in VitePress, HTML in a `{{ }}` interpolation, which Vue reads as an
  expression, and a tag that only VitePress reads as HTML, such as one with
  `@click` or `#default`, because the tags around it are not known.

Footnote definitions are read after the rest, where the page shows them, and
only when nothing stopped the reading there. A definition that no reference
outside footnotes uses is not shown, and not read. When reading one stops,
closes an element left open before the footnotes, or leaves open an element that
hides what follows, no definition is read, because the page orders them by their
references.

**Not checked:** comments, mdrefine's suppression comments included,
declarations such as `<!DOCTYPE html>`, and processing instructions, which are
not elements; autolinks such as `<https://example.com>` and
`<sales@example.com>`, which are links; code, escaped text such as `\<b>`, and
the text inside a raw-text element. A tag that Markdown's grammar for HTML does
not read whole, such as `<div class=a"b>`, and a tag split across the lines of a
block quote, list item, or footnote are not reported either.

## Dialect notes

**In VitePress:** components such as `<Badge/>`, and elements with Vue's
attributes such as `:title`, are HTML to VitePress's Markdown and are reported
by their names as written; allow a component by its name. HTML blocks, which
hold Vue templates, are [opaque areas](../../vitepress.md#preservation) whose
findings are omitted, so only inline HTML is reported.
