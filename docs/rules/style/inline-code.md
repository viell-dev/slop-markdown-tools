# `style/inline-code`

Writes each code span with the fewest backticks that its content allows and only
the padding that it needs, and joins a code span that is written across lines
onto one line. Some editors, such as Obsidian's Live Preview, show a split code
span differently from the rendered page.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options: none.

Before:

```markdown
Run `npm run
build` before the tests.
```

After:

```markdown
Run `npm run build` before the tests.
```

**Backticks:** a span gets the fewest backticks whose run does not occur in its
content, so ``` ``a`` ``` becomes `` `a` ``. Table cell escapes stay intact. A
span keeps its delimiters where shortening them could pair with an earlier run
in the same inline block.

**Padding:** renderers take one space off each end of a code span when both ends
have one, so `` ` - ` `` shows the same code as `` `-` ``, and the rule writes
it that way. A span keeps a space at each end where it needs one: to separate a
backtick at the content's edge from the delimiters, or to keep spaces that
renderers would otherwise take off. To show the spaces around a separator, put
text on both sides of it, as in `` `A - B` ``.

**Joining:** a line break inside a code span renders as a space, so the content
stays the same, and the spaces and tabs that start the next line are left out,
as CommonMark and GitHub leave them out. On a lazy continuation line, one
without its block quote's `>` or its list item's indentation, GitHub keeps them
in the span, and so does the joined span; commonmark.js leaves them out, so
outside the GitHub dialect such a span stays split.

## Edge cases and advanced usage

**Left as written:** the exceptions of [Forgejo and
Gitea](../../dialects.md#forgejo-and-gitea), and a split span whose joined line
would read differently:

- Where joining would move text onto the line of an alert's or a callout's
  marker, which holds an Obsidian callout's title.
- Where the joined span needs a different number of backticks than it has, and
  an earlier run of that many in the same paragraph would pair with them.
- Where a line inside the span ends with two spaces or a backslash: where its
  backticks do not pair, as on GitHub after an unpaired longer run, those
  markers make a hard line break. `style/wrap` keeps such a paragraph as written
  too. This conservative check also keeps the line break when the backticks do
  pair.

## Dialect notes

**In Obsidian:** Live Preview shows a span's padding as it is written, where
Reading view takes it off as other renderers do. The rule follows Reading view,
so removing the padding also removes those spaces from Live Preview.

A span stays split where an `==` or `[[` left as text on the joined lines could
open a highlight or wikilink. A multiline span with one or two backticks, and
the following source in its inline block, stay as written: Live Preview resets
short code at the physical newline. Earlier independent inline text and later
paragraphs can still format. The [boundary
protections](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/obsidian.md#boundary-protections)
describe the conservative cases.

## Related rules

[`style/wrap`](../style/wrap.md) joins such a code span only in a paragraph that
it wraps, and this rule also elsewhere, such as in a paragraph with a hard line
break. [`content/inline-code-spacing`](../content/inline-code-spacing.md)
reports blank space that renderers show at the ends of a span, which this rule
leaves as written, because removing it would change the code.
