// Documents for the Obsidian check (scripts/obsidian-check.mjs), besides the generated ones:
// Obsidian's own syntax, which the HTML renderers of tests/unit/renderers.test.ts do not know,
// the cases where one of Obsidian's views showed what the HTML renderers did not (#15, #306,
// #391, #395, #397, #398, #399, #404, #405, #407, #408, #409, #411, #414), and those that the
// check has to read with care (#385, #400, #401, #403, #406, #410, #421). Each paragraph is long enough
// that formatting at 30 or 80 columns reflows it, unless the tool leaves it as written. Every word
// is synthetic.

/** @type {{ name: string, source: string }[]} */
export const fixtures = [
  {
    // #306: Live Preview shows a link whose text spans lines as its Markdown source.
    name: "link text",
    source:
      "Some words before [a link whose text is long enough to wrap](https://example.com/page) and some words after it.\n",
  },
  {
    // #15: a code span that spans lines.
    name: "code span",
    source:
      "Some words before `a code span with several words inside it` and some words after the span.\n",
  },
  {
    name: "wikilink with an alias",
    source:
      "Some words before [[Some Note|an alias with several words in it]] and [[Other Note#Heading]] after.\n",
  },
  {
    name: "embed",
    source:
      "Some words before ![[picture.png|100]] and ![[Some Note#Heading]] and more words after.\n",
  },
  {
    name: "highlight",
    source:
      "Some words before ==a highlight with several words in it== and some more words after it.\n",
  },
  {
    name: "comment",
    source: "Some words before %%a comment with several words in it%% and some more words after.\n",
  },
  {
    name: "tags",
    source: "Some words with #tag and #nested/tag-name in the middle and some more words after.\n",
  },
  {
    name: "math",
    source:
      "Some words before $a + b = c$ and $$x^2$$ inline and a sum of $5 and $6 after it all.\n",
  },
  {
    name: "callout",
    source:
      "> [!note] A title with several words\n> A body line with enough words to be reflowed at a narrow width, and more.\n",
  },
  {
    name: "folded callout",
    source:
      "> [!tip]- Folded title\n> A body line with enough words to be reflowed at a narrow width, and more.\n",
  },
  {
    name: "footnote",
    source:
      "Some words with a footnote[^1] and an inline one^[with words inside] after.\n\n[^1]: The footnote's text with enough words to be reflowed at a narrow width.\n",
  },
  {
    name: "task list",
    source:
      "- [ ] A task with enough words to be reflowed at a narrow width, and more\n- [x] A done task with enough words to be reflowed at a narrow width\n",
  },
  {
    name: "block identifier",
    source:
      "A paragraph with enough words to be reflowed at a narrow width, and more. ^block-id\n\nSee [[#^block-id]] here.\n",
  },
  {
    name: "strikethrough and emphasis",
    source:
      "Some words with ~~struck words in a row~~ and *emphasis with words* and **strong words** after.\n",
  },
  {
    name: "nested list",
    source:
      "1. An item with enough words to be reflowed at a narrow width\n   - A nested item with enough words to be reflowed too\n2. Another item\n",
  },
  {
    // #385: Live Preview shows the list's indentation on a code block's lines, and the list
    // rules change it.
    name: "code block opening a list item",
    source:
      "  1. An item with enough words to be reflowed at a narrow width\n     + ```js\n         let a = 1;\n       let b = 2;\n       ```\n",
  },
  {
    name: "code block later in a list item",
    source:
      "  - An item with enough words to be reflowed at a narrow width\n\n    ```js\n      let a = 1;\n    let b = 2;\n    ```\n",
  },
  {
    name: "literal URL",
    source:
      "Some words before https://example.com/a/rather/long/path/to/a/page and some words after.\n",
  },
  {
    name: "heading and paragraph",
    source:
      "# A heading with *emphasis*\nA paragraph directly below it with enough words to be reflowed.\n",
  },
  {
    // #391: Live Preview styles a paragraph line that starts with `[`, a label, and `]:` as a
    // link reference definition, so the paragraph stays as written but for its emphasis.
    name: "definition line in a paragraph",
    source:
      'Some words with *emphasis* before the line, enough of them to be reflowed at a narrow width.\n[ref]: https://example.com/page "A title with several words"\nSome words after the line, enough of them to be reflowed at a narrow width too.\n',
  },
  {
    // #395: Reading view shows a line break at the end of the note as one more line of a code
    // block that nothing closes, so `style/final-newline` adds none; only the fence changes.
    name: "unclosed code block ending the note",
    source:
      "Some words before the code block, enough of them to be reflowed at a narrow width.\n\n~~~\nconst a = 1;",
  },
  {
    // #400: a line of spaces below a list item is a list line to Live Preview, and the text
    // below it is not part of the item; `style/trailing-space` empties the line.
    name: "blank list line of spaces",
    source:
      "- An item with enough words to be reflowed at a narrow width, and more\n  \nA paragraph below the line, with enough words to be reflowed at a narrow width.\n",
  },
  {
    // #401: with the cursor on a table's first line, Live Preview shows an empty row line next
    // to the table's widget, whose class names the leading pipe that `style/table` adds.
    name: "table at the start of the note",
    source:
      "Name | Value\n--- | ---\nA cell | Another cell\n\nA paragraph below the table, with enough words to be reflowed at a narrow width.\n",
  },
  {
    // #403: after an HTML tag that nothing closes, Live Preview shows the source as written,
    // a callout's type included, which the callout rule writes in lowercase.
    name: "callout after an open HTML tag",
    source:
      "Some words <b> before a callout, enough of them to be reflowed at a narrow width.\n\n> [!TIP] A title\n> A body line with enough words to be reflowed at a narrow width, and more.\n",
  },
  {
    // #406: blank space at the end of a heading's line in a list item is inside the heading's
    // styled run, and `style/trailing-space` removes it.
    name: "heading in an item with trailing space",
    source:
      "- ## A heading in an item ~~~ \n  A line below it in the item, with enough words to be reflowed at a narrow width.\n",
  },
  {
    // #410: the first line of a block quote in a list item carries the item's classes and the
    // lines after it only the quote's; wrapping makes more lines of it.
    name: "quote in a nested item",
    source:
      "+ An item\n  1) A nested item\n  > A quote inside the nested item with enough words to be reflowed at a narrow width\n",
  },
  {
    // #397: Live Preview styles the heading's line as a link reference definition and reads the
    // underline as text, so `style/heading` leaves the heading underlined.
    name: "underlined heading with a definition-like line",
    source:
      "[ref]: a heading that starts like a link reference definition\n===\nSome words below the heading, enough of them to be reflowed at a narrow width.\n",
  },
  {
    // #398: Reading view reads the tab line as more of the paragraph and the table below it as
    // text, so the table and the paragraph after it stay as written.
    name: "table and paragraph below a tab line",
    source:
      "Some words with *emphasis* above the tab line, enough of them to be reflowed at a narrow width.\n\t\n| Name | Value |\n| - | - |\n| a | b |\n\t\nSome *words* below the table, enough of them to be reflowed at a narrow width too.\n",
  },
  {
    // #399: Reading view keeps the HTML block inside the item and would continue the list with a
    // matching marker below it, so both lists keep their markers.
    name: "HTML block inside a list item",
    source:
      "* An item with enough words to be reflowed at a narrow width, and more words\n<div>\nSome words inside the block\n</div>\n\n- Another item with enough words to be reflowed at a narrow width\n",
  },
  {
    // #404: Live Preview reads an unclosed opening YAML fence as source through the note's end.
    name: "unclosed YAML front matter",
    source:
      "---\n# Heading\n\nSome *words* and a #tag with enough words after it to be reflowed at a narrow width.\n",
  },
  {
    // #407: Obsidian reads TOML as paragraph text, continued by the table below its closing fence.
    name: "table directly below TOML front matter",
    source: "+++\ntitle = 1\n+++\n| a | b |\n| --: | - |\n| c | d |\n",
  },
  {
    // #408: Live Preview restores quote/list styling only after the comment closer's line.
    name: "inline HTML comment across a quoted list",
    source:
      "Some words <!-- an open comment\n\n> - Words --> followed by enough more words to be reflowed at a narrow width.\n>   More words on the next line.\n\nIndependent *text* below the comment.\n",
  },
  {
    // #408: a setext heading's underline is comment-styled too, and must not be removed.
    name: "inline HTML comment opened in an underlined heading",
    source:
      "Heading <!-- an open comment\n================\n\n> Words --> followed by enough more words to be reflowed at a narrow width.\n> More words on the next line.\n",
  },
  {
    // #408: an ATX heading carries the same comment state out into the following blocks.
    name: "inline HTML comment opened in an ATX heading",
    source:
      "# Heading <!-- an open comment\n\n- Words --> followed by enough more words to be reflowed at a narrow width.\n  More words on the next line.\n",
  },
  {
    // #408: the table widget does not stop the editor's comment state at the table boundary.
    name: "inline HTML comment opened in a table cell",
    source:
      "| A | B |\n| - | - |\n| Words <!-- an open comment | value |\n\n> Words --> followed by enough more words to be reflowed at a narrow width.\n> More words on the next line.\n",
  },
  {
    // #411: at 30 columns, the line would break before `[a]:`, and Live Preview would style the
    // new line as a link reference definition; the word stays on the line before it.
    name: "label inside a paragraph",
    source:
      "Some words before the label [a]: tail words after it, enough of them to be reflowed at a narrow width.\n",
  },
  {
    // #409: at 30 columns, the line would break before `#glacier`, which Live Preview reads as
    // text directly after `>`; the tag stays on the line before it.
    name: "tag in a quote without a space after the marker",
    source:
      ">Some words with a long line x #glacier and more words after it, enough of them to be reflowed at a narrow width.\n",
  },
  {
    // #414: joining the continuation would turn text after a bare `>` into a tag in Live Preview.
    name: "tag-like text after a bare quote marker",
    source:
      ">Some words before the next line, enough of them to be reflowed at a narrow width.\n>#glacier and more words after it.\n",
  },
  {
    // #405: Reading view shows the space at the end of the footnote's text before the
    // backreference, so it stays while the text is reflowed.
    name: "footnote ending in a space",
    source:
      "Some words with a footnote[^1] and enough of them to be reflowed at a narrow width.\n\n[^1]: The footnote's text with enough words to be reflowed at a narrow width. \n",
  },
  {
    // #421: an inline-code span at the end of a soft line keeps its trailing spaces when
    // wrapping moves the next word onto the line.
    name: "padded inline code at a soft line break",
    source:
      "Words before `code  `\nneighbor words after the code span, enough text to wrap at thirty columns.\n",
  },
  {
    // #421: control without trailing spaces inside the inline-code span at a soft line break.
    name: "unpadded inline code at a soft line break",
    source:
      "Words before `code`\nneighbor words after the code span, enough text to wrap at thirty columns.\n",
  },
  {
    // #421: a double-backtick inline-code span with a literal backtick and trailing spaces at
    // the end of a soft line keeps its padding when wrapping moves the next word onto the line.
    name: "padded double-backtick inline code at a soft line break",
    source:
      "Words `` code `   ``\nneighbor words after the code span, enough text to wrap at thirty columns.\n",
  },
  {
    // #421: control double-backtick inline-code span whose single surrounding spaces strip.
    name: "unpadded double-backtick inline code at a soft line break",
    source:
      "Words `` code ` ``\nneighbor words after the code span, enough text to wrap at thirty columns.\n",
  },
];
