# `style/wrap`

Reflows each paragraph so that its lines fill the width, 80 columns by default,
without exceeding it, or, with `mode: "never"`, joins each paragraph onto one
line. A line break inside a paragraph renders as a space, so the rendered text
stays the same, and short lines keep diffs small.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `mode`, `width`, `measure`, `reportUnreflowed`, `reportUnbreakable`.

With `{ "width": 40 }`, before:

```markdown
Wrapping keeps lines short, so that a change to one sentence shows up as a small diff.
```

After:

```markdown
Wrapping keeps lines short, so that a
change to one sentence shows up as a
small diff.
```

| Option              | Values                        | Default     |
| ------------------- | ----------------------------- | ----------- |
| `mode`              | `"always"` or `"never"`       | `"always"`  |
| `width`             | An integer from 20 to 500     | `80`        |
| `measure`           | `"columns"` or `"codepoints"` | `"columns"` |
| `reportUnreflowed`  | `true` or `false`             | `false`     |
| `reportUnbreakable` | `true` or `false`             | `false`     |

- `mode`: `always` wraps at `width`. `never` joins each paragraph onto one line,
  so `First line` followed by `second line` becomes `First line second line`. It
  leaves the same paragraphs, inline pieces, and containers as written as
  wrapping does, and ignores `width`, `reportUnreflowed`, and
  `reportUnbreakable`, since the long lines are intended.
  [`content/line-length`](../content/line-length.md) can still check headings,
  code, and tables.
- `width`: the longest line, in the unit of `measure`.
- `measure`: `columns` counts display columns, so a wide character such as `漢`
  counts two. `codepoints` counts Unicode code points: a character outside the
  Basic Multilingual Plane counts once, and a combining mark counts by itself.
- `reportUnreflowed`: report a paragraph that is too wide but left as written,
  with the reason.
- `reportUnbreakable`: report a line that stays too wide because of something
  that cannot be split, also in paragraphs left as written. The line of an
  alert's or a callout's marker counts as one such piece, even when it contains
  spaces.

The two report options propose no edits and use the rule's severity. To make
them fail a check, set the rule to `error` or pass `--max-warnings 0`;
`format --check` checks only for edits.

**Breaking lines:**

- Lines are broken at spaces in the text, also in the text of a link, emphasis,
  strong text, or strikethrough. List markers, block quote markers, and
  indentation count toward the width, a tab up to the next multiple of four
  columns.
- A code span, an image, math, a link's destination, a template tag on one line
  such as `{% data x %}` or `{{ title }}`, and a word longer than the line stay
  whole and can overflow.
- A code span or an image description written across lines is joined onto one,
  without the spaces and tabs that start its next line, as renderers read it. On
  a lazy continuation line, which keeps them, such a code span stays as written,
  and so does its paragraph. Whitespace inside code spans otherwise follows
  their own joining rules.

List continuations keep the item's content indentation, including the space a
quote consumes when its opening marker directly precedes a list marker, as in
`>10) text`. Wrapping and explicit lazy-continuation indentation therefore
agree.

**Words kept off the start of a line:**

- A word that would start a block at the start of a line, such as a list marker,
  `#`, `>`, a run of `-` or `=`, or a table delimiter row such as `|---|`, stays
  on the line before it, and so does a word that starts with `:::`, `{%`, or
  `{{`, or a literal `[[toc]]` marker (in any letter case). A word that only
  starts like one, such as `--config`, `#tag`, or `-5`, can start a line.
- The first line keeps more than one word when its first word alone would open a
  block, such as `***` or `$$`, or, in the body below the line of an alert's or
  callout's marker, would underline that line as a heading, such as `==` or
  `--`. It also keeps a paragraph that starts like a link reference definition
  (`[Note]: see …`) from becoming one.
- On GitHub and in Obsidian, a word that starts with `$` stays on the line
  before it when a `$` comes earlier in the paragraph, and in Obsidian a word
  that ends in `$`, such as a lone `$`, stays on the line after it when a `$`
  comes later: at the edge of a line, a dollar can begin or end math that it
  cannot begin or end next to a space.

## Edge cases and advanced usage

**Left as written:** a paragraph whose meaning could change when its lines are
joined or broken, that is, one that:

- has a hard line break, inline HTML, or a block identifier (`^id`) at its end;
- has a line break that is content, inside math, inline HTML, an Obsidian
  comment, or a link's destination or title;
- has a Tab followed by two final spaces before continuing text, which native
  renderers can read as a hard break even when the primary parser reads a soft
  line ending;
- has lines whose container markers the tool cannot reproduce;
- opens a block quote with an alert or callout marker such as `[!NOTE]` in the
  CommonMark dialect; in the other dialects only the line with the marker, and
  an Obsidian callout's title on it, stays as it is, and the body is wrapped. A
  paragraph elsewhere that starts with a linked image, `[![…](…)](…)`, is
  wrapped;
- starts with a bare `-`, `+`, `*`, `1.`, `1)`, `#`, or `>` followed by more
  words, which joining would turn into a block;
- starts directly below a link reference definition without that definition's
  container markers;
- has a table delimiter row such as `| - |` as its second line, in the dialects
  with tables: such a paragraph is usually a table that the parser reads as text
  (see [the safety model](../../design.md#safety-model));
- starts with a snippet import (`<<<`), or has a line that starts with `:::`,
  `{%`, `{{`, or a literal `[[toc]]` marker, which [site
  generators](../../dialects.md#what-each-dialect-reads) read by line.

[Forgejo and Gitea](../../dialects.md#forgejo-and-gitea) add their own cases.

## Dialect notes

**In Obsidian:** the rule wraps or joins only with the vault's [strict line
breaks](../../obsidian.md#enable-wrapping). Lines are also broken with Live
Preview in mind:

- The text of a link stays whole and is joined onto one line, because Live
  Preview shows a link whose text spans lines as its Markdown source. For the
  same reason, an inline footnote (`^[…]`) on one line stays whole, and a
  paragraph with one that spans lines keeps its lines.
- A leading inline comment stays with the next atom, so wrapping cannot turn it
  into a standalone comment block; later text still wraps normally.
- No new line's content starts with `[`, a label, and `]:`, such as `[ref]: …`:
  Live Preview hides its destination, including after indentation or quote
  markers. The complete label stays on the preceding word's line, also when it
  holds spaces. Existing reference-like lines stay on their own lines; an empty
  colon line also keeps the following destination line, even across blank lines.
  A list's marker line still wraps normally, because it shows the label and
  destination as text.
- In a block quote whose markers are written without a space after them, such as
  `>text`, a tag such as `#tag` stays on the line before it, because Live
  Preview reads a tag directly after `>` as text.
- The exact separator before a Tab-only paragraph continuation stays when
  trailing spaces mark a hard break or keep a preceding backslash literal. The
  earlier paragraph text can still wrap.
- A standalone one-line `$$…$$` formula keeps its physical line, with the
  adjacent separators, when joining would change Live Preview's display widget.
  Math already beside ordinary prose still wraps; see the [boundary
  protections](../../obsidian.md#boundary-protections).

In Obsidian, a paragraph is also left as written when it:

- holds a possible comment whose leading `%%` and first closer cross a blank
  line: moving text after the closer could turn literal paragraphs into a
  comment block;
- holds `==`, `[[`, or `]]` outside its highlights and wikilinks, because
  joining lines could create one;
- has a continuation line with tag-like text directly after a bare block quote
  marker, such as `>#tag text`: joining the line would create a tag in Live
  Preview;
- has a definition-like label that already spans lines, contains a nested
  opening bracket, or has a tab after its colon: reflow changes Live Preview's
  link styling;
- opens a block quote on a list item's marker line, such as `- > words`: Live
  Preview shows the first line as list text with a literal `>` and only
  continuation lines as a quote. Its first paragraph stays as written, while
  ordinary quotes below the marker line still wrap;
- would start with `[`, a label, and `]:` on its first line once reflowed, as
  `[a` and `b]: c d` below it would, which Live Preview styles as a link
  reference definition;
- holds a short multiline code span; see
  [`style/inline-code`](../style/inline-code.md). Earlier independent inline
  markup can still format;
- holds a multiline image description containing backticks, where joining could
  turn displayed Live Preview source into an embed. Surrounding inline
  preferences can still be applied.

**In VitePress:** a paragraph is also left as written when it holds an attribute
block such as `{.note}` or `{target="_blank"}`, an inline footnote (`^[…]`), or
whitespace between two inline elements, such as two code spans, where a line
break would disappear in Vue's output; see
[preservation](../../vitepress.md#preservation). `reportUnreflowed` reports such
a paragraph with that reason. Braces and `^[` in a code span are code, so a
paragraph with nothing else of the kind wraps.
