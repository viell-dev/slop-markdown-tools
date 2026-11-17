import { commonFixtures } from "./common.mjs";
const inlineUrl = "[https://example.com](https://example.com)";
// Opt-in fixes must retain generated anchors while allowing explicit-id headings (#915).
export const forgeAutolinkFixtures = [
  ["atx", `# ${inlineUrl}`, `# ${inlineUrl}`],
  ["setext", `${inlineUrl}\n===`, `${inlineUrl}\n===`],
  ["quoted", `> # ${inlineUrl}`, `> # ${inlineUrl}`],
  ["nested", `- # **${inlineUrl}**`, `- # **${inlineUrl}**`],
  ["explicit-id", `# ${inlineUrl} {#chosen}`, "# <https://example.com> {#chosen}"],
].map(([name, heading, output]) => ({
  name: `heading-autolink-${name}`,
  source: `${heading}\n\nBody ${inlineUrl} here.\n`,
  output: `${output}\n\nBody <https://example.com> here.\n`,
}));
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
  // Dollar lines that continue item text on Forgejo (#961), and controls.
  {
    name: "math-continuation-math-below-text",
    source: "Some text\n$$\nx = 1\n$$\n\nAfter.\n",
  },
  {
    name: "math-continuation-math-in-item-aligned",
    source: "- item text\n  $$\n  x = 1\n  $$\n\nAfter.\n",
  },
  {
    name: "math-continuation-math-lazy-below-item",
    source: "- item text\n$$\nx = 1\n$$\n\nAfter.\n",
  },
  {
    name: "math-continuation-math-lazy-below-item-paragraph",
    source: "- item\n\n  second paragraph\n$$\nx = 1\n$$\n\nAfter.\n",
  },
  {
    name: "math-continuation-math-lazy-below-nested-ordered",
    source: "- outer\n  1. inner text  \n  lazy line\n$$\nx = 1\n$$\n",
  },
  {
    name: "math-continuation-math-lazy-below-quote",
    source: "> quote text\n$$\nx = 1\n$$\n\nAfter.\n",
  },
  {
    name: "math-continuation-math-after-blank-below-item",
    source: "- item text\n\n$$\nx = 1\n$$\n\nAfter.\n",
  },
  {
    name: "math-continuation-quoted-item",
    source: "> - item text\n> $$\n> x = 1\n> $$\n",
  },
  {
    name: "math-continuation-quoted-item-lazy",
    source: "> - item text\n$$\nx = 1\n$$\n",
  },
  {
    name: "math-continuation-crlf",
    source: "- item text\r\n$$\r\nx = 1\r\n$$\r\n",
  },
  {
    name: "math-continuation-eof",
    source: "- item text\n$$\nx = 1\n$$",
  },
  { name: "tasks", source: "- [X] Finished\n- [ ] Pending\n" },
  { name: "alert", source: "> [!NOTE]\n> Some *useful advice*.\n" },
  { name: "footnote", source: "A useful note[^1].\n\n[^1]: More *detail*.\n" },
  { name: "definitions", source: "Term\n: A *useful* description.\n\nAnother\n: More detail.\n" },
  { name: "math", source: "A formula $x^2$ in prose.\n\n$$\nx = y\n$$\n\n~~~math\nz = w\n~~~\n" },
  { name: "frontmatter", source: "---\ntitle: Example\n---\n\n# *Heading*\n\nSome __words__.\n" },
  { name: "html", source: "<details>\n<summary>More</summary>\n\nSome *detail*.\n\n</details>\n" },
  // The observed stray-marker case of #665: formatting moves a `~` between quoted
  // lines, which Forgejo and Gitea showed the same for the current output.
  {
    name: "quoted-stray-markers",
    source:
      "+++\ntitle = 1\n+++\n\n> [!WARNING] walnut\n> >candle __kettle__ fabric harbor delta meadow pebble\nzephyr *xba_a`x.~x.*ab ~  ~ .**  engine\nvalley*. ~b**!.. *_! a*!_ meadow\n\n~~~~sh\nconst zephyr = 79;\n~~~~\n  \n*anchor amber* ~~meadow~~ __harbor__ juniper saddle  \n__juniper__ *meadow kettle* zephyr saddle *zephyr timber* timber _grove_ quarry walnut \n**orchard** _anchor_ _delta_ \\ ~~~ `amber glacier` needle | engine cedar *meadow glacier* _amber_ ~~pebble~~ *saddle delta* ~~lantern~~ delta fabric(x!__b)~~fabric lantern lantern _timber_ *iris engine*",
  },
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
