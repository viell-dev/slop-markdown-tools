// Authored-document controls shared by GitHub and the forge comparisons.
export const commonFixtures = [
  {
    name: "prose",
    source:
      "# A useful title\n\nA paragraph with *emphasis*, __strong text__ and a [link](https://example.com).\n",
  },
  { name: "lists", source: "1) First item\n2) Second item\n\n* A bullet\n  + A nested bullet\n" },
  { name: "quote", source: "> A quoted paragraph with *emphasis*.\n> \n> A second paragraph.\n" },
  { name: "table", source: "| Name | Value |\n| --- | ---: |\n| *First* | 1 |\n" },
  { name: "code", source: "~~~js\nconst answer = 42;\n\n~~~\n" },
  // Blank lines added around closed fences and tables (#684, #697).
  {
    name: "fence-spacing",
    source: "Text before.\n```js\nconst a = 1;\n```\nText after.\n~~~\nb\n~~~\n> A quote.\n",
  },
  {
    name: "table-spacing",
    source:
      "Text before.\n| Name | Value |\n| --- | --- |\n| a | 1 |\n> A quote.\n\n```\ncode\n```\n| x | y |\n| - | - |\n***\n",
  },
  // Text below a table is another row; the forges read the indented line as one too.
  { name: "table-row-text", source: "| Name | Value |\n| --- | --- |\nmore text\n    indented\n" },
  // Tables in lists and block quotes keep each row's container prefix (#710).
  {
    name: "table-in-quote",
    source: "> | Name | Value |\n> | :-- | --: |\n> | *First* | 1 |\n>| `a \\| b` | 漢字 |\n",
  },
  {
    name: "table-in-list",
    source:
      "- | Name | Value |\n  |---|---|\n  | x | y |\n- An item\n\n  Name | Value\n  --- | :-:\n  longer | z\n",
  },
  {
    name: "table-in-quoted-list",
    source: "> 1. A step\n>\n>    | a | b |\n>    |---|---|\n>    | ccc | d |\n",
  },
  { name: "table-on-marker-line", source: "- Name | Value\n  --- | ---\n  x | y\n" },
  { name: "table-in-quote-lazy-text", source: "> | a | b |\n> | - | - |\n> | c | d |\nlazy text\n" },

  // One space after quote markers, also before an alert's marker and a list (#682).
  {
    name: "quote-marker-spacing",
    source:
      ">  [!NOTE]\n>  Some *useful advice*.\n\n>A quote without a space.\n>>A nested quote.\n\n>  - A quoted item\n>    continued.\n",
  },
  // Container prefixes on lazy continuation lines, also a footnote's (#713).
  {
    name: "lazy-continuation",
    source:
      "> A quoted paragraph\ncontinued *lazily*.\n\n- An item\ncontinued *lazily*.\n\n> - A quoted item\n> continued *lazily*.\n\nA useful note[^1].\n\n[^1]: More detail\ncontinued *lazily*.\n",
  },
  // A lazy line that could start a type 7 HTML block continues the paragraph in
  // CommonMark and on the forges; GitHub ends the containers and reads HTML to
  // the next blank line, where `*` stays literal (#762). The introductions change,
  // so GitHub compares the documents too.
  {
    name: "lazy-html-line",
    source:
      "An *introduction* that formatting changes.\n\n* An item with *emphasis*\n<b>\nbold words\n</b>\nand more.\n* A second item\n\n> A quote with *emphasis*\n<span>\nspanned words\n</span>\n\n- > A quoted item\n<i>\nitalic words\n</i>\n",
  },
  {
    name: "lazy-html-emphasis",
    source:
      "An *introduction* that formatting changes.\n\n- An item with *words\n<b>\nmore* after the tag\n- A second *item*\n\n> A quote with *words\n</b>\nmore* after the closing tag\n\n1. A step with __strong\n<span>\nwords__ across the tag\n\nA *closing* paragraph.\n",
  },
  {
    name: "lazy-html-markers",
    source:
      "An *introduction* that formatting changes.\n\n1. A step\n<span>\nwith *emphasis*, __strong__, `code` and [a link](https://example.com)\n# A heading *below*\n- An item *below*\n\n- > A quoted item\n<i>\n*after* the tag\n\n> - A listed quote\n> <b>\n> *after* the tag\n>\n> - A later *item*\n\nA *closing* paragraph.\n",
  },
  // CommonMark reads the paragraph text that takes the tag line as a Setext
  // heading, or as definitions before the paragraph that starts at the tag.
  {
    name: "lazy-html-paragraph-text",
    source:
      "An *introduction* that formatting changes.\n\n- An item with *words\n<b>\nmore* after the tag\n  ---\n\n> A quote with *words\n<span>\nmore* after the tag\n> ===\n\n- [one]: https://example.com/one\n<i>\n*after* the definition\n\n> [two]: https://example.com/two\n> [three]: https://example.com/three\n</b>\n*after* the definitions\n\nA *closing* paragraph.\n",
  },
];

export const githubFixtures = [
  ...commonFixtures,
  { name: "tasks", source: "- [X] Finished\n- [ ] Pending\n" },
  { name: "alert", source: "> [!NOTE]\n> Some *useful advice*.\n" },
  { name: "footnote", source: "A useful note[^1].\n\n[^1]: More *detail* about the note.\n" },
  { name: "math", source: "A formula $x^2$ in prose.\n\n$$\nx = y\n$$\n" },
  // GitHub shows the definition as text when the table interrupts its lines (#697).
  {
    name: "definition-above-table",
    source: "[ref]: https://example.com\nText\n| a | b |\n| - | - |\n\nA [link][ref].\n",
  },
];
