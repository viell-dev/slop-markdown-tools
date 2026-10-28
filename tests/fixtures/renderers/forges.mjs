import { commonFixtures } from "./common.mjs";
// Shared authored regressions for native paragraph/table and hard-break readings.
export const forgeBoundaryFixtures = [
  { name: "table-ordered-row", source: "Number | Description\n--- | ---\n2) | Second entry\n" },
  { name: "table-empty-ordered-row", source: "Step\n:-:\n2)\n" },
  { name: "table-ordered-stop", source: "| Step |\n| --- |\n2) Continue\n1) Outside\n" },
  { name: "table-indented-row", source: "| Step |\n| --- |\n2) Continue\n    1) Still a row\n" },
  { name: "table-quoted-row", source: "> | Step |\n> | --- |\n> 2) Continue\n" },
  { name: "table-hidden-quote-list", source: ">1) Item\n>   | Name |\n>   | --- |\n>   | Value |\n" },
  { name: "table-hidden-lazy-list", source: ">1) Item\n| Name |\n| --- |\n| Value |\n" },
  { name: "table-hidden-quote", source: "> Item\n| Name |\n| --- |\n| Value |\n" },
  // A table directly below a description's text belongs to the description (#697).
  { name: "table-in-description", source: "Term\n: A description.\n| Name |\n| --- |\n| Value |\n" },
  { name: "url-backslash-break", source: "Visit www.example.com\\\nThen continue.\n" },
  { name: "https-backslash-break", source: "Visit https://example.com\\\nThen continue.\n" },
  { name: "url-two-backslashes", source: "Visit www.example.com\\\\\nThen continue.\n" },
  { name: "url-three-backslashes", source: "Visit www.example.com\\\\\\\nThen continue.\n" },
  { name: "url-backslash-space", source: "Visit www.example.com\\ \nThen continue.\n" },
  { name: "url-backslash-path", source: "Visit https://example.com/a\\b\nThen continue.\n" },
];
export const forgeFixtures = [
  ...commonFixtures,
  ...forgeBoundaryFixtures,
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
