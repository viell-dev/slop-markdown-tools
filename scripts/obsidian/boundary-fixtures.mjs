import { readFileSync } from "node:fs";
import { URL } from "node:url";

/** Boundary regressions shared by the unit suite and the real-Obsidian comparison. */
/** @type {{ issue: number, name: string, source: string, preserve?: boolean }[]} */
export const boundaryFixtures = [
  {
    issue: 533,
    name: "terminal whitespace in an unclosed fence info string",
    source: "~~~ &copy;  \nx\n",
    preserve: false,
  },
  ...[
    "| a |\n| - |\n| b |\ntext\n2) first *words*\n3) second\n",
    "> | a |\n> | - |\n> | b |\n> text\n> 2) first *words*\n> 3) second\n",
    "- | a |\n  | - |\n  | b |\n  text\n  2) first *words*\n  3) second\n",
    "| a |\n| - |\n| b |\ntext\n2) \n   *next*\n",
    "| a |\n| - |\n| b |\ntext\n2) \n3) \n",
  ].map((source, index) => ({
    issue: 532,
    name: `non-one continuation after an unpiped table row ${index}`,
    source,
  })),
  ...[
    "| a |\n| - |\n| b |\n2) first *words*\n3) second\n",
    "| a |\n| - |\n| b |\ntext\n\n2) first *words*\n3) second\n",
    "| a |\n| - |\n| b |\ntext\n1) first *words*\n2) second\n",
  ].map((source, index) => ({
    issue: 532,
    name: `independent list below a table ${index}`,
    source,
    preserve: false,
  })),
  {
    issue: 524,
    name: "carried code through a nested quoted list",
    source: "text ```\n> 1) *first*\n>    - *second*\n",
  },
  {
    issue: 524,
    name: "an outside item resets carry before its nested quote",
    source: "a ``` b\n\n- > c *d*\n\ne *f*\n",
    preserve: false,
  },
  {
    issue: 524,
    name: "quoted carry retains the next quote-opening item",
    source: "> text ```\n\n> - *item*\n",
  },
  {
    issue: 524,
    name: "quoted item carry retains a following item",
    source: "> - a ```\n> - *b*\n",
  },
  ...["1. [ ] ", "+ [ ] ", "> - [x] ", "- [-] ", "- > 1. [ ] "].map((source) => ({
    issue: 525,
    name: `empty task separator ${source.trim()}`,
    source: `${source}\n`,
  })),
  ...["- [ ] \n  more\n", "> 1. [x] \n>    more\n", "- [-] \n  more *words*\n"].map((source) => ({
    issue: 525,
    name: `task separator before continuation ${source.split("\n")[0].trim()}`,
    source,
  })),
  {
    issue: 526,
    name: "bare comment marker before a later closer",
    source: "   + first\n\n+ [ ] second\n<!-- comment\n+\n-->\n",
  },
  {
    issue: 528,
    name: "list tightness after whitespace-only separator cleanup",
    source: "* one\n* two\n  \n* three\n",
    preserve: false,
  },
  {
    issue: 529,
    name: "fence opened inside whitespace-continued HTML",
    source: "<div>\ntext\n</div>\n\t\n```js\nx\n\n```\n\n*inside*\n",
  },
  {
    issue: 529,
    name: "spaces in a fence body do not end continued HTML",
    source: "<div>\ntext\n</div>\n\t\n```js\nx\n  \n```\n\n*outside*\n",
    preserve: false,
  },
  {
    issue: 530,
    name: "three-space lazy quote continuation remains prose",
    source: "> word\nlazy\n   *three spaces*   \n",
    preserve: false,
  },
  {
    issue: 530,
    name: "unquoted indented code below a quoted paragraph",
    source: "> word\n    *literal*   \n",
  },
  {
    issue: 530,
    name: "unquoted tab-indented code after a lazy quote line",
    source: "> word\nlazy\n\t*literal*   \n",
  },
  {
    issue: 530,
    name: "unquoted indented code below a quoted list",
    source: "> - word\n    *lazy*   \n",
  },
  ...["    ", "\t"].map((prefix) => ({
    issue: 530,
    name: `indented quote marker remains prose ${JSON.stringify(prefix)}`,
    source: `> word\n${prefix}> *literal*\n`,
    preserve: false,
  })),
  {
    issue: 510,
    name: "adjacent ordered continuations after a tab-continued table",
    source: "a\n| b | c |\n| - | - |\n\t\n9. first\n2) second *word*\n",
  },
  {
    issue: 511,
    name: "non-leading-pipe header starts a second table",
    source: "| a | b |\n| - | - |\n| c | d |\ne | *f*\n:-- | --:\ng | h\n",
  },
  {
    issue: 512,
    name: "adjacent task lists with different bullet delimiters",
    source: "* [ ] first *words*\n+ [x] second *words*\n",
    preserve: false,
  },
  {
    issue: 511,
    name: "non-leading-pipe delimiter ends a table",
    source: "| a | b |\n| - | - |\n| c | d |\n| e | *f*\n:-- | --:\ng | h\n",
  },
  {
    issue: 511,
    name: "single-column header starts a second table",
    source: "| a | b |\n| - | - |\n| c | d |\ne |\n--- |\ng |\n",
  },
  {
    issue: 513,
    name: "lazy paragraph below a list heading",
    source: "- # heading\nlazy *words*\n",
  },
  {
    issue: 513,
    name: "lazy paragraph below a nested list heading",
    source: "- a\n  - # heading\nlazy *words*\n",
  },
  {
    issue: 513,
    name: "lazy paragraph below a quoted list heading",
    source: "- > # heading\nlazy *words*\n",
  },
  {
    issue: 513,
    name: "blank-separated paragraph below a nested list heading",
    source: "- a\n  - # heading\n\nlazy *words*\n",
    preserve: false,
  },
  {
    issue: 517,
    name: "non-one list after a quote inside a list",
    source: "- > word\n2. *item*\n",
    preserve: false,
  },
  {
    issue: 514,
    name: "emphasis whitespace at a wrapped quote boundary",
    source:
      ">  2) grove method ember timber saddle walnut orchard saddle _lantern_ <span>lantern</span> __zephyr__ delta\n>  3) lantern fabric timber birch _valley_ __engine__ walnut juniper \n>     pebble kettle delta anchor `birch  basket` kettle glacier _meadow_ > *birch harbor* *glacier meadow* **ember** lantern fabric\n",
    preserve: false,
  },
  {
    issue: 516,
    name: "comment closes on the line after its list marker",
    source: "   + first\n\n+ [ ] second\n<!-- comment\n+ x\n-->\n",
  },
  {
    issue: 517,
    name: "non-one ordered continuation after a quote",
    source: "> word\n2. *item*\n",
  },
  {
    issue: 517,
    name: "non-one ordered continuation after a quoted heading",
    source: "> # heading\n2. *item*\n",
  },
  {
    issue: 518,
    name: "footnote paragraph with uneven continuation indentation",
    source: "[^1]: note\n\n    const walnut = 67;\n      kettle(fabric)\n",
  },
  {
    issue: 519,
    name: "tilde fence inside HTML after carried inline code",
    source: "text ```\n<div>\n~~~\n</div>\n\n1. *inside*\n",
  },
  {
    issue: 519,
    name: "backtick fence inside HTML after carried inline code",
    source: "text ```\n<div>\n```\n</div>\n\n1. *inside*\n",
  },
  {
    issue: 520,
    name: "tab continues multiline setext text into the next heading",
    source: "a\nb\n===\n\t\nc\n---\n",
  },
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
    issue: 488,
    name: "task fence info containing a Unicode line separator",
    source: "- [-] ``` x\u2028y\n- *inside*\n",
  },
  {
    issue: 488,
    name: "task fence info containing a Unicode paragraph separator",
    source: "- [-] ``` x\u2029y\n- *inside*\n",
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
