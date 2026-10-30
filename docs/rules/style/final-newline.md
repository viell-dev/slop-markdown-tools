# `style/final-newline`

Ends a document that is not empty with a line break, using the document's own
line ending. A file whose last line has no line break is changed; an empty file
is not.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: none.

Before, a document with Windows line endings, written as a JavaScript string,
whose last line has none:

```js
"# Notes\r\n\r\nThe last line."
```

After, the same line ending, `\r\n`, ends the last line too:

```js
"# Notes\r\n\r\nThe last line.\r\n"
```

## Edge cases and advanced usage

**Left as written:** a document whose added line break would become part of the
last block: an HTML comment or another HTML block without its end marker, an
Obsidian comment without its closing `%%`, or a code or math block without its
closing fence whose last line is blank space.

## Dialect notes

**In Obsidian:** nothing is added either where the document ends in a fenced
code block without its closing fence, outside a list item or block quote:
Reading view shows the line break as one more, empty line of the code. An HTML
block opened in a list or quote can also lead Live Preview into code that the
parser does not recognize; the original end stays where that code's closing
boundary is uncertain.
