# `content/image-alt`

Reports an image without alternative text: a Markdown image with no text between
its brackets, as in `![](chart.png)`, and an HTML `<img>` element without an
`alt` attribute. Screen readers read the text in place of the image, and
browsers show it when the image does not load.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all.
Options: none.

Reported:

```markdown
![](sales-by-month.png)

<img src="sales-by-month.png" width="400">
```

Not reported:

```markdown
![Sales by month, rising from March](sales-by-month.png)

<img src="sales-by-month.png" alt="Sales by month, rising from March">
<img src="divider.png" alt="">
```

## Edge cases and advanced usage

**Details:** Markdown text that is only blank space counts as none. An HTML
image with `alt=""` is accepted: HTML marks a decorative image, which screen
readers skip, with an empty `alt`, and the attribute is written on purpose.
Markdown has no such mark, because `![](divider.png)` is also what an image
looks like when its text was forgotten, so blank Markdown text is reported.
Write a decorative image as `<img src="divider.png" alt="">`.

An HTML image hidden from assistive technology with `aria-hidden="true"`, or
from everyone with `hidden`, `inert`, or a `style` such as `display: none`, is
accepted, and so is one inside an element hidden so.

**Not checked:** HTML images that renderers do not certainly show: those inside
`<template>`, `<video>`, `<audio>`, `<object>`, `<canvas>`, `<select>`,
`<datalist>`, `<dialog>`, `<svg>`, or `<math>`, or in comments or raw-text
elements such as `<textarea>`. HTML images are found where
[`content/html-element`](../content/html-element.md) finds elements: not after
HTML whose reading is uncertain, and not in footnote definitions that no
reference uses. A report there could be about an image that readers never see.

No HTML image is checked after an end tag that a browser may ignore while an
element that hides is open. A browser ignores the end tag of an element opened
outside a table, a `<select>`, or a `<template>`, or outside a paragraph, list
item, or table cell of the Markdown, and a start tag such as `<li>` can close a
`<p>` before its end tag. In `<div hidden><table></div><img src="x">`, the image
stays inside the hidden `<div>`. An end tag that closes the innermost open
element, or that comes while nothing hides, does not stop the check. Nor is an
HTML image checked after an `<html>`, `<head>`, or `<body>` tag: whether such a
tag and its attributes apply depends on how the page embeds the rendered HTML.

## Dialect notes

**On GitHub:** the sanitizer removes `aria-hidden`, `hidden`, `inert`, and
`style` and keeps the image, so an image hidden only by them is reported.

**In Obsidian:** a size after `|`, as in `![|100](chart.png)`, is not text, and
embeds such as `![[chart.png]]` are not reported, because they have no place for
text.

**In VitePress:** only inline HTML images are checked, because HTML blocks are
[opaque areas](../../vitepress.md#preservation). An image with Vue's attributes,
such as `:alt`, `v-bind`, or `v-if`, or inside a component or an element with
them, is not checked, because Vue decides what they show.
