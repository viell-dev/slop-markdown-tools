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
