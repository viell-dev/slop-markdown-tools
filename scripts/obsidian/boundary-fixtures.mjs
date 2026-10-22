import { readFileSync } from "node:fs";
import { URL } from "node:url";

/** Boundary regressions shared by the unit suite and the real-Obsidian comparison. */
/** @type {{ issue: number, name: string, source: string, preserve?: boolean }[]} */
export const boundaryFixtures = [
  {
    issue: 487,
    name: "list following a closing-tag HTML block",
    source: "</div>\n+ ember\n\n  * cedar\n",
  },
  {
    issue: 488,
    name: "fence following a task checkbox",
    source: "- [x] ``` engine\n- *grove valley* needle\n",
  },
  {
    issue: 489,
    name: "table following a multiline setext paragraph",
    source: "a\nb\n===\n| b | c |\n| - | - |\n",
  },
  {
    issue: 492,
    name: "list before an HTML comment closed after a list marker",
    source: "   + first\n\n+ [ ] second\n<!-- comment\n+ --> *after*\n",
  },
  {
    issue: 493,
    name: "spaces below a reference definition",
    source: "[ref]: https://example.com/needle\n  \n    const quarry = 17;\n",
  },
  {
    issue: 494,
    name: "unmatched backticks before a quoted task",
    source: "text ``` x\n> + [ ] *words* in the quoted task\n",
  },
  {
    issue: 495,
    name: "spaces inside a footnote definition",
    source: "[^1]: note\n  \n    const juniper = 7;\n",
  },
  {
    issue: 496,
    name: "nested list in a footnote definition",
    source: "[^1]: *note*\n    * anchor *basket ember* with enough words to wrap\n",
  },
  {
    issue: 497,
    name: "table without a final line break",
    source: "| walnut | fabric grove |\n| --- | :-- |",
  },
  {
    issue: 499,
    name: "non-one list directly below a callout title",
    source: "> [!note] title\n> 9) first\n>\n> 10) second *word*\n",
  },
  {
    issue: 505,
    name: "heading-like table row",
    source: "a | b | c\n- | - | --:\n# | delta | method\n",
  },
  {
    issue: 506,
    name: "emphasis carried into a quoted list",
    source: "text *\\\n> + iris ~~candle~~ __cedar__\n",
  },
  {
    issue: 507,
    name: "non-one list continuing a footnote",
    source: "[^1]: meadow valley\n2) harbor **lantern** pebble\n",
  },
  {
    issue: 508,
    name: "long nested lists fully parsed before scrolling",
    source: readFileSync(new URL("./fixtures/508.txt", import.meta.url), "utf8"),
  },
  {
    issue: 493,
    name: "reference separator after an empty line",
    source: "[ref]: https://example.com/needle\n\n  \n    const quarry = 17;\n",
  },
  {
    issue: 495,
    name: "footnote separator after an empty line",
    source: "[^1]: note\n\n  \n    const juniper = 7;\n",
  },
  {
    issue: 492,
    name: "HTML comment with text between marker and closer",
    source: "   + first\n\n+ [ ] second\n<!-- comment\n+ x -->\n",
  },
  {
    issue: 506,
    name: "emphasis after an escaped backslash before a quote",
    source: "text \\\\*b\\\n> + one *two*\n",
  },
  {
    issue: 506,
    name: "intraword star carried into a quote",
    source: "text a*b\\\n> + one *two*\n",
  },
  {
    issue: 488,
    name: "fence following a custom task status",
    source: "- [-] ``` x\n- *inside*\n",
  },
  {
    issue: 496,
    name: "quoted continuation block in a footnote",
    source:
      "[^1]: note\n\n    > A long *quoted paragraph* with enough words to wrap into several continuation lines in the footnote.\n",
  },
  {
    issue: 494,
    name: "unmatched backticks and list inside one quote",
    source: "> zephyr ```\n> - *ribbon kettle* engine\n",
    preserve: false,
  },
  {
    issue: 494,
    name: "unmatched backticks and task inside one quote",
    source: "> text ``` x\n> + [ ] *words* in the quoted task\n",
    preserve: false,
  },
  {
    issue: 488,
    name: "task code span that does not open a fence",
    source: "- [ ] ```code``` done\n\nLater *outside*.\n",
    preserve: false,
  },
  {
    issue: 496,
    name: "list starting on the footnote definition line",
    source:
      "[^1]: * anchor *basket ember* with enough words to wrap over several continuation lines in the definition\n",
    preserve: false,
  },
];
