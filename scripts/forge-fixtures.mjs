import { commonFixtures } from "./renderer-fixtures.mjs";
export const forgeFixtures = [
  ...commonFixtures,
  { name: "tasks", source: "- [X] Finished\n- [ ] Pending\n" },
  { name: "alert", source: "> [!NOTE]\n> Some *useful advice*.\n" },
  { name: "footnote", source: "A useful note[^1].\n\n[^1]: More *detail*.\n" },
  { name: "definitions", source: "Term\n: A *useful* description.\n\nAnother\n: More detail.\n" },
  { name: "math", source: "A formula $x^2$ in prose.\n\n$$\nx = y\n$$\n\n~~~math\nz = w\n~~~\n" },
  { name: "frontmatter", source: "---\ntitle: Example\n---\n\n# *Heading*\n\nSome __words__.\n" },
  { name: "html", source: "<details>\n<summary>More</summary>\n\nSome *detail*.\n\n</details>\n" },
];
export const fileFixtures = [
  {
    name: "anchors",
    source:
      '# *Title* &amp; more\n\n## Repeated\n\n## Repeated\n\n## Explicit {#chosen}\n\n<a id="raw"></a>\n\n[Title](#title--more) [Chosen](#chosen) [Raw](#raw)\n',
  },
  { name: "definition-headings", source: "Term\n: # H\n\n# H\n\n[First](#h) [Next](#h-1)\n" },
  {
    name: "links",
    source:
      "# Links\n\nA *link* to [a file](../page.md#part), [the root](/page.md) and [this title](#links).\n",
  },
];
