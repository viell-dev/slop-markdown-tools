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
];

export const githubFixtures = [
  ...commonFixtures,
  { name: "tasks", source: "- [X] Finished\n- [ ] Pending\n" },
  { name: "alert", source: "> [!NOTE]\n> Some *useful advice*.\n" },
  { name: "footnote", source: "A useful note[^1].\n\n[^1]: More *detail* about the note.\n" },
  { name: "math", source: "A formula $x^2$ in prose.\n\n$$\nx = y\n$$\n" },
];
