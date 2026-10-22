import { readFileSync } from "node:fs";
import { URL } from "node:url";

/** Boundary regressions shared by the unit suite and the real-Obsidian comparison. */
/** @type {{ issue: number, name: string, source: string, preserve?: boolean }[]} */
export const boundaryFixtures = [
  ...[
    [
      "mixed whitespace inside a short multiline code span",
      "before `a\t  \nb` and more plain words follow here\n",
    ],
    ["short code resets at a bare newline", "before `a\nb` and *right*\n"],
    [
      "two-backtick multiline code keeps its literal suffix",
      "before ``a  \nb`` and *right* __strong__ tail\n",
    ],
    [
      "later paired spans remain out of phase",
      "before `a  \nb` and *right* ` recovered ` and *after*\n",
    ],
    [
      "backslash newline in a short span keeps literal suffix",
      "before `a\\\nb` and *right* __strong__ tail\n",
    ],
    ["containing emphasis keeps both delimiters", "*before `a\nb` after* and __strong__\n"],
    [
      "short code inside a multiline inline comment",
      "before *left* %%`a\nb`%% and *right* __strong__ tail\n",
    ],
    [
      "short code inside a multiline image description",
      "before *left* ![``a\nb``](image.png) and *right* __strong__ tail\n",
    ],
  ].map(([name, source]) => ({ issue: 565, name, source })),
  ...[
    [
      "safe prefix and independent paragraph around a short code span",
      "before *left* `a  \nb` and *right* __strong__ tail\n\nLater *outside*.\n",
    ],
    [
      "paired long multiline code still reflows",
      "before ```a  \nb``` and *right*\n\nlater *outside*\n",
    ],
    ["code closed before a soft newline still reflows", "before `a  `\nb and *right*\n"],
    [
      "paired long code in a multiline inline comment",
      "before *left* %%```a\nb```%% and *right* __strong__ tail\n",
    ],
  ].map(([name, source]) => ({ issue: 565, name, source, preserve: false })),
  {
    issue: 566,
    name: "long code in an image description keeps source while surrounding text formats",
    source: "before *left* ![```a\nb```](image.png) and *right* __strong__ tail\n",
    preserve: false,
  },
  {
    issue: 566,
    name: "long code in a reference image retains its description boundary",
    source: "before *left* ![```a\nb```][img] and *right* __strong__ tail\n\n[img]: image.png\n",
    preserve: false,
  },
  ...[
    ["Tab followed by two spaces before continuing text", "a\t  \nb\n"],
    ["even backslashes before a mixed-whitespace hard break", "a\\\\\t  \nb\n"],
  ].map(([name, source]) => ({ issue: 562, name, source })),
  {
    issue: 563,
    name: "terminal spaces before a Tab-only paragraph continuation",
    source: "a\n    b   \n\t\n# c\n",
    preserve: false,
  },
  {
    issue: 563,
    name: "literal backslash separator before a Tab-only continuation",
    source: "*alpha* beta\\ \n\t\n# tail\n",
    preserve: false,
  },
  {
    issue: 563,
    name: "full generated terminal-break regression",
    source: readFileSync(new URL("./fixtures/563.txt", import.meta.url), "utf8"),
    preserve: false,
  },
  {
    issue: 376,
    name: "full generated enclosing-list continuation regression",
    source: readFileSync(new URL("./fixtures/376-followup.txt", import.meta.url), "utf8"),
    preserve: false,
  },
  ...[
    ["literal backslash before a spaced underline", "a\\ \n=== \n"],
    ["hard break before a spaced underline", "a  \n=== \n"],
    ["literal backslash before an indented underline", "a\\ \n  ===\n"],
    ["hard break before an indented underline", "a  \n  ===\n"],
    ["multiline level-one title with a native hard break", "a\nb  \n===\n"],
    ["multiline level-one title with a literal backslash", "a\nb\\ \n===\n"],
  ].map(([name, source]) => ({ issue: 383, name, source })),
  ...[
    ["nested lazy paragraph before an enclosing ordered list", "+ - a\nb\n  1) c\n"],
    [
      "nested lazy paragraph before an enclosing ordered continuation",
      "+ - a\nb\n  1) c\n     d\n",
    ],
    ["direct lazy paragraph before its ordered list", "- a\nb\n  1) c\n"],
  ].map(([name, source]) => ({ issue: 376, name, source })),
  {
    issue: 376,
    name: "fully indented inner continuation permits enclosing list reflow",
    source: "+ - a\n    b\n  1) c\n",
    preserve: false,
  },
  {
    issue: 560,
    name: "literal backslash before a continuing line in the full generated document",
    source: readFileSync(new URL("./fixtures/560.txt", import.meta.url), "utf8"),
    preserve: false,
  },
  ...[
    {
      name: "multiline inline comment with blank line",
      source: "%%one\n\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
    {
      name: "list blank-inside comment",
      source: "- %%one\n\n  two%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
    {
      name: "quote blank-inside comment",
      source: "> %%one\n>\n> two%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
    {
      name: "complete middle paragraph stays opaque",
      source:
        "%%one\n\ncomment middle words remain exactly as written though this line is long\n\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
    {
      name: "list opener with outer closer",
      source: "- %%one\n\ntwo%% aaaaaaaaaaaaaaaaaaaa tail words follow here\n",
    },
  ].map((fixture) => ({ issue: 559, ...fixture })),
  ...[
    ["balanced multiline div", '<div\n  class="note">\ntext\n</div>\n\nLater *outside*.\n'],
    [
      "balanced multiline iframe",
      '<iframe\n  title="probe">\ntext\n</iframe>\n\nLater *outside*.\n',
    ],
    ["multiline void hr", '<hr\n  class="note">\n\nLater *outside*.\n'],
    ["multiline self-closing div", '<div\n  class="note" />\n\nLater *outside*.\n'],
    [
      "quoted greater-than attribute",
      '<div\n  title="one > two">\ntext\n</div>\n\nLater *outside*.\n',
    ],
    [
      "newline inside quoted attribute",
      '<div title="one\n  two > three">\ntext\n</div>\n\nLater *outside*.\n',
    ],
    ["multiline closing tag", "<div>\ntext\n</div\n  >\n\nLater *outside*.\n"],
    [
      "opening tag crosses parsed extent",
      '<div\n\n  class="note">\ntext\n</div>\n\nLater *outside*.\n',
    ],
    ["closing tag crosses parsed extent", "<div>\ntext\n</div\n\n  >\n\nLater *outside*.\n"],
  ].map(([name, source]) => ({
    issue: 556,
    name: `multiline root: ${name}`,
    source,
    preserve: false,
  })),
  ...[
    [
      "unclosed multiline root before heading and quote",
      '<div\n  class="note">\n\n# title\n> quote\n',
    ],
    [
      "unclosed multiline child before parent closer",
      '<div\n  class="note">\n<span>text\n</div>\n\n# title\n> quote\n',
    ],
  ].map(([name, source]) => ({
    issue: 556,
    name: `multiline root: ${name}`,
    source,
  })),
  {
    issue: 558,
    name: "native table boundary: plain prefix, wiki alias pipe only",
    source: "| a | b |\n| - | - |\n| c | d |\nbefore [[Target|Alias]] after\n",
  },
  {
    issue: 558,
    name: "native table boundary: plain prefix, ordinary pipe",
    source: "| a | b |\n| - | - |\n| c | d |\nbefore left | right\n",
  },
  {
    issue: 558,
    name: "native table boundary: wiki starts line, wiki alias pipe only",
    source: "| a | b |\n| - | - |\n| c | d |\n[[Target|Alias]] after\n",
  },
  {
    issue: 558,
    name: "native table boundary: wiki starts line, ordinary pipe",
    source: "| a | b |\n| - | - |\n| c | d |\nleft | right\n",
  },
  {
    issue: 558,
    name: "native table boundary: normal-link prefix, wiki alias pipe only",
    source: "| a | b |\n| - | - |\n| c | d |\n[link](https://example.com) [[Target|Alias]] after\n",
  },
  {
    issue: 558,
    name: "native table boundary: normal-link prefix, ordinary pipe",
    source: "| a | b |\n| - | - |\n| c | d |\n[link](https://example.com) left | right\n",
  },
  {
    issue: 558,
    name: "native table boundary: linked-image prefix, wiki alias pipe only",
    source:
      "| a | b |\n| - | - |\n| c | d |\n[![alt](https://img.example.com/a.svg)](https://example.com) [[Target|Alias]] after\n",
  },
  {
    issue: 558,
    name: "native table boundary: linked-image prefix, ordinary pipe",
    source:
      "| a | b |\n| - | - |\n| c | d |\n[![alt](https://img.example.com/a.svg)](https://example.com) left | right\n",
  },
  {
    issue: 558,
    name: "native table boundary: image-only prefix, wiki alias pipe only",
    source:
      "| a | b |\n| - | - |\n| c | d |\n![alt](https://img.example.com/a.svg) [[Target|Alias]] after\n",
  },
  {
    issue: 558,
    name: "native table boundary: image-only prefix, ordinary pipe",
    source: "| a | b |\n| - | - |\n| c | d |\n![alt](https://img.example.com/a.svg) left | right\n",
  },
  {
    issue: 558,
    name: "native table boundary: footnote-reference prefix, wiki alias pipe only",
    source: "| a | b |\n| - | - |\n| c | d |\n[^n] [[Target|Alias]] after\n\n[^n]: note\n",
  },
  {
    issue: 558,
    name: "native table boundary: footnote-reference prefix, ordinary pipe",
    source: "| a | b |\n| - | - |\n| c | d |\n[^n] left | right\n\n[^n]: note\n",
  },
  {
    issue: 558,
    name: "native table boundary: reference-link prefix, wiki alias pipe only",
    source:
      "| a | b |\n| - | - |\n| c | d |\n[ref] [[Target|Alias]] after\n\n[ref]: https://example.com\n",
  },
  {
    issue: 558,
    name: "native table boundary: reference-link prefix, ordinary pipe",
    source: "| a | b |\n| - | - |\n| c | d |\n[ref] left | right\n\n[ref]: https://example.com\n",
  },
  {
    issue: 558,
    name: "native table boundary: pipe inside a Markdown destination",
    source: "| a | b |\n| - | - |\n| c | d |\nbefore [link](https://example.com/a|b) after\n",
  },
  {
    issue: 558,
    name: "native table boundary: reference-definition row",
    source: "| a | b |\n| - | - |\n| c | d |\n[ref]: https://example.com/a|b\n",
  },
  {
    issue: 558,
    name: "native table boundary: header1-body1-leading",
    source: "| h1 |\n| - |\n| a1 |\n| x1\n",
  },
  {
    issue: 558,
    name: "native table boundary: header1-body1-both",
    source: "| h1 |\n| - |\n| a1 |\n| x1 |\n",
    preserve: false,
  },
  {
    issue: 558,
    name: "native table boundary: header3-body2-leading",
    source: "| h1 | h2 | h3 |\n| - | - | - |\n| a1 | a2 | a3 |\n| x1 | x2\n",
    preserve: false,
  },
  {
    issue: 558,
    name: "native table boundary: header3-body2-trailing",
    source: "| h1 | h2 | h3 |\n| - | - | - |\n| a1 | a2 | a3 |\nx1 | x2 |\n",
  },
  {
    issue: 558,
    name: "native table boundary: header3-body3-leading",
    source: "| h1 | h2 | h3 |\n| - | - | - |\n| a1 | a2 | a3 |\n| x1 | x2 | x3\n",
    preserve: false,
  },
  {
    issue: 558,
    name: "native table boundary: header3-body3-both",
    source: "| h1 | h2 | h3 |\n| - | - | - |\n| a1 | a2 | a3 |\n| x1 | x2 | x3 |\n",
    preserve: false,
  },
  {
    issue: 558,
    name: "native table boundary: unbordered-header-and-body-compact-delimiter",
    source: "h1 | h2\n-|-\na1 | a2\nx1 | x2\n",
    preserve: false,
  },
  {
    issue: 558,
    name: "native table boundary: unbordered-header-bordered-body",
    source: "h1 | h2\n-|-\n| a1 | a2 |\nx1 | x2\n",
  },
  {
    issue: 558,
    name: "native table boundary: bordered-header-unbordered-first-body",
    source: "| h1 | h2 |\n| - | - |\nx1 | x2\n",
  },
  {
    issue: 558,
    name: "native table boundary: escaped-pipe-bordered-row",
    source: "| h1 | h2 |\n| - | - |\n| a1 | a2 |\n| x1 \\| x2 | a |\n",
    preserve: false,
  },
  {
    issue: 558,
    name: "native table boundary: spaces-before-unbordered-row",
    source: "| h1 | h2 |\n| - | - |\n| a1 | a2 |\n  x1 | x2\n",
  },
  {
    issue: 558,
    name: "native table boundary: quote-unbordered-row",
    source: "> | h1 | h2 |\n> | - | - |\n> | a1 | a2 |\n> x1 | x2\n",
  },
  {
    issue: 558,
    name: "native table boundary: blank-separated wiki paragraph",
    source: "| a | b |\n| - | - |\n| c | d |\n\nbefore *word* [[Target|Alias]] after\n",
    preserve: false,
  },

  ...[
    {
      name: "root comment before over-width badge",
      source:
        "%%candle candle%% [![zephyr](https://img.example.com/badge/yonder-grove.svg)](https://example.com/ribbon) engine lantern amber saddle kettle timber more ordinary words remain available for wrapping after this protected opening\n",
      preserve: false,
    },
    {
      name: "list comment before over-width badge",
      source:
        "* %%candle candle%% [![zephyr](https://img.example.com/badge/yonder-grove.svg)](https://example.com/ribbon) engine lantern amber saddle kettle timber more ordinary words remain available for wrapping after this protected opening\n",
      preserve: false,
    },
    {
      name: "quoted comment before over-width badge",
      source:
        "> %%candle candle%% [![zephyr](https://img.example.com/badge/yonder-grove.svg)](https://example.com/ribbon) engine lantern amber saddle kettle timber more ordinary words remain available for wrapping after this protected opening\n",
      preserve: false,
    },
    {
      name: "callout body comment before over-width badge",
      source:
        "> [!NOTE] Preserve This Title\n> %%candle candle%% [![zephyr](https://img.example.com/badge/yonder-grove.svg)](https://example.com/ribbon) engine lantern amber saddle kettle timber more ordinary words remain available for wrapping after this protected opening\n",
      preserve: false,
    },
    {
      name: "visible prefix before comment control",
      source:
        "visible %%candle candle%% [![zephyr](https://img.example.com/badge/yonder-grove.svg)](https://example.com/ribbon) engine lantern amber saddle kettle timber more ordinary words remain available for wrapping after this protected opening\n",
      preserve: false,
    },
  ].map((fixture) => ({ issue: 557, ...fixture })),
  ...[
    "<div>\n\n# title\n> quote\n",
    "<div>\ntext\n\n# title\n> quote\n",
    ...["~~~", "```"].flatMap((fence) =>
      ["<div>", "<div>\n<span>text\n</div>"].map(
        (root) => `${root}\n\n${fence}\nx\n${fence}\n\n# title\n> quote\n`,
      ),
    ),
  ].map((source, index) => ({
    issue: 556,
    name: `open root HTML retains literal paragraph boundaries ${index}`,
    source,
  })),
  ...[
    ["URL-shaped child inside root HTML", "<https://example.com/a>"],
    ["URL-shaped child after root HTML text", "text <https://example.com/a> tail"],
    ["unclosed ordinary child inside root HTML", "<span>text"],
    ["unclosed custom child inside root HTML", "<thing>text"],
    ["unclosed same-name child inside root HTML", "<div>text"],
    ["email-shaped child inside root HTML", "<a@example.com>"],
    ["unclosed colon child inside root HTML", "<x:y>text"],
    ["unclosed raw-text child inside root HTML", "<script>text"],
  ].map(([name, child]) => ({
    issue: 556,
    name,
    source: `<div>\n${child}\n</div>\n\n# title\n> quote\n`,
  })),
  {
    issue: 556,
    name: "one unmatched closer leaves root HTML open",
    source: "<div>\n<span>text\n</missing>\n\n# title\n> quote\n",
  },
  {
    issue: 556,
    name: "root HTML reopened after an ancestor closer",
    source: "<div>\n<span>text\n</div>\n<thing>\n</span>\n\n# title\n> quote\n",
  },
  ...[
    ["properly closed ordinary child", "<span>text</span>"],
    ["properly closed custom child", "<thing>text</thing>"],
    ["properly closed colon child", "<x:y>text</x:y>"],
    ["void line-break child", "<br>"],
    ["void image child", '<img src="missing.png">'],
    ["self-closing custom child", "<thing />"],
    ["unmatched child closer", "<span>text</thing>"],
  ].map(([name, child]) => ({
    issue: 556,
    name: `root HTML with ${name}`,
    source: `<div>\n${child}\n</div>\n\n# title\n> quote\n`,
    preserve: false,
  })),
  {
    issue: 556,
    name: "two unmatched closers end root HTML",
    source: "<div>\n<span>text\n</missing>\n</missing>\n\n# title\n> quote\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "padding shrink would capture earlier lazy margin",
    source: "+    alpha\n  beta\n  gamma\n---\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "ordered marker width shrink would capture lazy margin",
    source: "9. first\n10. alpha\n   beta\n   gamma\n---\n",
  },
  {
    issue: 554,
    name: "nested padding shrink would capture earlier lazy margin",
    source: "- outer\n  +    alpha\n    beta\n    gamma\n---\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "padding decrease keeps zero-column lines lazy",
    source: "+    alpha\nbeta\ngamma\n---\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "blank ends heading-dependent padding context",
    source: "+    alpha\n  beta\n  gamma\n\n---\n",
    preserve: false,
  },
  {
    issue: 553,
    name: "spaced break immediately below a table",
    source: "| h |\n| - |\n| v |\n- - -\n",
    preserve: false,
  },
  {
    issue: 553,
    name: "star break immediately below a table",
    source: "| h |\n| - |\n| v |\n***\n",
    preserve: false,
  },
  {
    issue: 553,
    name: "spaced break below a header-only table",
    source: "| h |\n| - |\n- - -\n",
    preserve: false,
  },
  {
    issue: 553,
    name: "compact break below an unspaced final table row",
    source: "|h|\n|-|\n|last|\n---\n",
  },
  {
    issue: 553,
    name: "compact break below a header-only delimiter",
    source: "|h|\n|-|\n---\n",
  },
  {
    issue: 553,
    name: "blank separates table and break control",
    source: "| h |\n| - |\n| v |\n\n- - -\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "second lazy list continuation above hyphen break",
    source: "- alpha\nbeta\ngamma\n---\n",
  },
  {
    issue: 554,
    name: "earlier lazy line before indented title",
    source: "- alpha\nbeta\n  gamma\n---\n",
  },
  {
    issue: 554,
    name: "ordered lazy continuations above hyphen break",
    source: "1) alpha\nbeta\ngamma\n---\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "nested lazy continuations above hyphen break",
    source: "- outer\n  + alpha\nbeta\ngamma\n---\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "quoted lazy continuation before external underline",
    source: "> alpha\nbeta\n---\n",
  },
  {
    issue: 554,
    name: "short single lazy continuation control",
    source: "- alpha\nbeta\n---\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "only final continuation lazy control",
    source: "- alpha\n  beta\ngamma\n---\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "reflow keeps final title as exact suffix",
    source:
      "- alpha beta enough words to fill a line\nlazy omegaomegaomegaomegaomega\n  gamma\n---\n",
  },
  {
    issue: 554,
    name: "zero-width insertion would indent earlier lazy line",
    source: "- alpha\nomegaomegaomegaomegaomega\n  gamma\n---\n",
  },
  {
    issue: 554,
    name: "earlier and interior inline text remain eligible",
    source: "- *alpha*\nmiddle *beta*\n  gamma\n---\n",
    preserve: false,
  },
  {
    issue: 554,
    name: "paired inline markers cross final boundary",
    source: "- *alpha\nbeta\ngamma*\n---\n",
  },
  {
    issue: 554,
    name: "plain lazy prefix before multiline emphasis",
    source: "- alpha\nplain *beta\ngamma*\n---\n",
  },
  {
    issue: 554,
    name: "plain lazy prefix before multiline link",
    source: "- alpha\nplain [*beta\ngamma*](https://example.com/a)\n---\n",
  },
  {
    issue: 554,
    name: "blank separates list and break control",
    source: "- alpha\nbeta\ngamma\n\n---\n",
    preserve: false,
  },
  {
    issue: 551,
    name: "HTML-ended first definition then HTML-ended second",
    source: "text\n[^1]: note\n    <div> a\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 551,
    name: "closed-HTML-ended first definition",
    source:
      "text\n[^1]: note\n    <div> a </div>\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 551,
    name: "heading-ended first definition",
    source: "text\n[^1]: note\n    # first\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 551,
    name: "code-ended first definition",
    source:
      "text\n[^1]: note\n    ```\n    a\n    ```\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 551,
    name: "paragraph-ended first definition control",
    source: "text\n[^1]: note\n    first\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 551,
    name: "three definitions after different parsed leaves",
    source:
      "text\n[^1]: note\n    <div> a\n[^2]: second\n    # next\n[^3]: third\n    <div> b\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 551,
    name: "physical blank between definitions control",
    source: "text\n[^1]: note\n    <div> a\n\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
    preserve: false,
  },
  {
    issue: 551,
    name: "physical blank inside first definition control",
    source: "text\n[^1]: note\n\n    <div> a\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
    preserve: false,
  },
  {
    issue: 549,
    name: "tab continuation before a joined footnote's HTML ending",
    source: "text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "tab continuation below indented paragraph text before a joined footnote",
    source: "  text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "tab continuation after adjacent paragraph-consumed footnotes",
    source: "  text\n[^1]: first\n[^2]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "joined footnote ending in indented div",
    source: "text\n[^1]: note\n    <div> words\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "joined footnote ending in closed div",
    source: "text\n[^1]: note\n    <div> words </div>\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "joined footnote with HTML on marker line",
    source: "text\n[^1]: <div> words\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "joined footnote ending in a closing HTML tag",
    source: "text\n[^1]: note\n    </div> words\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "joined footnote ending in span paragraph",
    source: "text\n[^1]: note\n    <span> words\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "joined footnote ending in plain paragraph",
    source: "text\n[^1]: note\n    words\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "joined footnote ending in heading",
    source: "text\n[^1]: note\n    # heading\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "joined footnote ending in fenced code",
    source: "text\n[^1]: note\n    ```\n    code\n    ```\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "independent footnote after physical blank",
    source: "Ref[^1].\n\n[^1]: note\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    preserve: false,
  },
  {
    issue: 549,
    name: "physical blank before indented HTML body",
    source: "text\n[^1]: note\n\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    preserve: false,
  },
  {
    issue: 549,
    name: "physical blank before following table",
    source: "text\n[^1]: note\n    <div> words\n\n| __h__ |\n| - |\n| v |\n",
    preserve: false,
  },
  {
    issue: 549,
    name: "unindented HTML interrupts joined paragraph",
    source: "text\n[^1]: note\n<div> words\n| __h__ |\n| - |\n| v |\n",
  },
  {
    issue: 549,
    name: "ordinary paragraph with indented HTML",
    source: "text\n    <div> words\n| __h__ |\n| - |\n| v |\n",
  },
  ...[
    ">1) a\n>   > 1)  b\n2) c\n",
    ">1) a\n>  > 1)  b\n2) c\n",
    ">1) a\n> > 1)  b\n2) c\n",
    ">1) a\n>> 1)  b\n2) c\n",
    ">1) a\n>\n>   > 1)  b\n2) c\n",
    "Ref[^n].\n\n[^n]: 1) a\n    > 1)  b\n2) c\n",
    ">1) first\n2) second\n",
    ">2) first\n3) second\n",
    ">1) first\n2. second\n",
    ">1) first\n>\n2) second\n",
    ">>1) first\n2) second\n",
    ">1) first\n>    - nested\n2) second\n",
    "Ref[^n].\n\n[^n]: 1) first\n2) second\n",
    "Ref[^n].\n\n[^n]: 1) first\n2. second\n",
  ].map((source, index) => ({
    issue: 543,
    name: `ordered list continued beyond its container ${index}`,
    source,
  })),
  ...[
    ">1) a\n>   > -   b\n2) c\n",
    ">1) a\n>   > # *b*\n2) c\n",
    ">1) a\n>   > *b*\n2) c\n",
    "Ref[^n].\n\n[^n]: 1) first\n    -   nested\n2) second\n",
    ">1) first\n>   trailing prose\n2) second\n",
    ">1) first\n>2) second\n",
    ">1) first\n\n2) second\n",
    ">1) first\n1) second\n",
    ">1) first\n># Heading\n2) second\n",
    ">1) a\n>\n>standalone prose\n2) c\n",
    "Ref[^n].\n\n[^n]: 1) first\n\n2) second\n",
    ">+ first\n2) second\n",
  ].map((source, index) => ({
    issue: 543,
    name: `independent structural list formatting ${index}`,
    source,
    preserve: false,
  })),
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
  ...[
    "- # heading\nlazy *words*\n- next\n",
    "- first\n- # heading\nlazy *words*\n- next\n",
    "- > # heading\nlazy *words*\n- next\n",
    "+ # heading\nlazy *words*\n- next\n",
    "- # heading\nlazy *words*\n+ next\n",
    "1) # heading\nlazy *words*\n1. next\n",
  ].map((source, index) => ({
    issue: 513,
    name: `list continuing after a lazy list-heading paragraph ${index}`,
    source,
  })),
  ...[
    "- # heading\nlazy *words*\n# next\n",
    "- # heading\n\nlazy *words*\n- next\n",
    "- # heading\n  lazy *words*\n- next\n",
    "- first\nlazy *words*\n- next\n",
  ].map((source, index) => ({
    issue: 513,
    name: `independent block after a list heading ${index}`,
    source,
    preserve: false,
  })),
  {
    issue: 513,
    name: "blank-separated paragraph below a nested list heading",
    source: "- a\n  - # heading\n\nlazy *words*\n",
    preserve: false,
  },
  ...[
    ["closed root before a bare quote marker", "<div></div>\n \n> a\n>\n> *b*\n"],
    ["closing-only root before a bare quote marker", "</div>\n \n> a\n>\n> *b*\n"],
    [
      "root before a nested quote marker",
      "<div>\nx\n</div>\n \n> first\n>>\n> *second*\n\t\n_____\n",
    ],
    [
      "tab-separated root before a quote marker",
      "<div>\nx\n</div>\n\t\n> first\n>\n> *second*\n\t\n_____\n",
    ],
    [
      "root before a spaced quote marker",
      "<div>\nx\n</div>\n \n> first\n> \n> *second*\n\t\n_____\n",
    ],
    ["root before repeated bare empty quotes", "<div></div>\n \n>\n>\n"],
    ["root before repeated nested empty quotes", "<div></div>\n \n>>\n>>\n>>\n"],
    ["root before repeated spaced empty quotes", "<div></div>\n \n> >\n> >\n> >\n"],
    ["tab-separated root before repeated empty quotes", "<div></div>\n\t\n>\n>\n>\n"],
  ].map(([name, source]) => ({ issue: 546, name, source })),
  {
    issue: 546,
    name: "physical blank after top-level HTML",
    source: "<div>\nx\n</div>\n\n> first\n>\n> *second*\n\n_____\n",
    preserve: false,
  },
  {
    issue: 546,
    name: "empty quote line ends contained HTML",
    source: "> <div>\n> x\n> </div>\n>\n> *second*\n\nAfter *third*.\n",
    preserve: false,
  },
  {
    issue: 546,
    name: "independent prose after continued top-level HTML",
    source: "<div></div>\n \n> a\n>\n> *b*\n\nAfter *c*.\n",
    preserve: false,
  },
  {
    issue: 546,
    name: "independent prose after literal empty quotes",
    source: "<div></div>\n \n>\n>\n\nAfter *c*.\n",
    preserve: false,
  },
  {
    issue: 546,
    name: "physical blank before genuine empty quotes",
    source: "<div></div>\n\n>\n>\n>\n\nAfter *c*.\n",
    preserve: false,
  },
  ...[">", ">>"].map((marker) => ({
    issue: 546,
    name: `literal ${marker} in a fenced body after top-level HTML`,
    source: `<div>\ntext\n</div>\n\t\n\`\`\`js\nx\n${marker}\n\`\`\`\n\n*outside*\n`,
    preserve: false,
  })),
  ...[
    "<div>\n   \n-\n~~~\na\n\n~~~\ntext *x* and __y__\n",
    "<div>\n   \n*\n~~~\na\n\n~~~\ntext *x* and __y__\n",
    "<div>\n   \n+\n~~~\na\n\n~~~\ntext *x* and __y__\n",
    "<div>\n   \n1.\n~~~\na\n\n~~~\ntext *x* and __y__\n",
    "<div>\n   \n1)\n~~~\na\n\n~~~\ntext *x* and __y__\n",
    "<div>\n   \n-\n```\na\n\n```\ntext *x* and __y__\n",
    "<div></div>\n   \n-\n~~~\na\n\n~~~\ntext *x* and __y__\n",
    "<div>\n   \n>\n~~~\na\n\n~~~\ntext *x* and __y__\n",
  ].map((source, index) => ({
    issue: 548,
    name: `fence pairing after an empty container in top-level HTML ${index}`,
    source,
  })),
  ...[
    "<div>\n   \n-\n\n~~~\na\n\n~~~\ntext *x* and __y__\n",
    "<div>\n\n-\n~~~\na\n\n~~~\ntext *x* and __y__\n",
    "<div>\n   \n-\n~~~\na\n~~~\n\ntext *x* and __y__\n",
    "<div>\n   \n-\n~~~\na\n  \n~~~\n\ntext *x* and __y__\n",
  ].map((source, index) => ({
    issue: 548,
    name: `unclosed root HTML stays literal beyond a parsed fence ${index}`,
    source,
  })),
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
