import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dialects, format, lint, parse, presets, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect, RuleSetting } from "../../src/index.js";

function only(rules: Record<string, RuleSetting>, dialect: Dialect = "github"): Config {
  return { extends: [], dialect, rules };
}
/**
 * Format, and require that nothing was refused, that formatting the result
 * again changes nothing, and that the parsed meaning stayed the same.
 */
function formatted(source: string, config: Config) {
  const result = format(source, { config });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config }).output).toBe(result.output);
  const dialect = config.dialect as Dialect;
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  return result.output;
}
/** Require the source to stay as written, with no finding. */
function kept(source: string, config: Config) {
  expect(formatted(source, config)).toBe(source);
  expect(lint(source, { config })).toEqual([]);
}

describe("style/code-fence", () => {
  const rule = { "style/code-fence": "warn" } as const;
  const tildes: Record<string, RuleSetting> = { "style/code-fence": ["warn", { marker: "~~~" }] };
  it.each([
    ["~~~js\nconst a = 1;\n~~~\n", "```js\nconst a = 1;\n```\n"],
    ["~~~~\ncode\n~~~~~~\n", "```\ncode\n```\n"],
    ["````\ncode\n````\n", "```\ncode\n```\n"],
    ["``` js title\ncode\n```\n", "``` js title\ncode\n```\n"],
    // A content line that would close the new fence makes it longer.
    ["~~~\n```\ninner\n```\n~~~\n", "````\n```\ninner\n```\n````\n"],
    ["~~~\n  ````  \n~~~\n", "`````\n  ````  \n`````\n"],
    ["~~~\n```js\n~~~\n", "```\n```js\n```\n"],
    ["~~~\nuse ``` inline\n~~~\n", "```\nuse ``` inline\n```\n"],
    // Containers, indentation, and line endings.
    ["- ~~~\n  code\n  ~~~\n", "- ```\n  code\n  ```\n"],
    ["> ~~~\n> code\n> ~~~\n", "> ```\n> code\n> ```\n"],
    ["> - ~~~\n>   code\n>   ~~~\n", "> - ```\n>   code\n>   ```\n"],
    ["  ~~~\n  code\n   ~~~\n", "  ```\n  code\n   ```\n"],
    ["[^1]: Note.\n\n    ~~~\n    code\n    ~~~\n", "[^1]: Note.\n\n    ```\n    code\n    ```\n"],
    ["~~~\r\ncode\r\n~~~\r\n", "```\r\ncode\r\n```\r\n"],
    ["~~~\rcode\r~~~\r", "```\rcode\r```\r"],
    ["~~~\ncode\n~~~", "```\ncode\n```"],
    ["~~~\n~~~\n", "```\n```\n"],
    ["~~~\n\n~~~\n", "```\n\n```\n"],
    // Without a closing fence the block runs to the end of its container.
    ["~~~\ncode\n", "```\ncode\n"],
    ["- ~~~\n  code\n\nText\n", "- ```\n  code\n\nText\n"],
    ["- ~~~\n      ~~~\n", "- ```\n      ~~~\n"],
    ["~~~\n```\n", "````\n```\n"],
    ["Text\n~~~\ncode\n~~~\n", "Text\n```\ncode\n```\n"],
  ])("writes %j with backticks", (source, output) => {
    expect(formatted(source, only(rule))).toBe(output);
  });
  it.each([
    ["```js\ncode\n```\n", "~~~js\ncode\n~~~\n"],
    ["```\n~~~\n```\n", "~~~~\n~~~\n~~~~\n"],
    ["``` a~b\ncode\n```\n", "~~~ a~b\ncode\n~~~\n"],
  ])("writes %j with tildes on request", (source, output) => {
    expect(formatted(source, only(tildes))).toBe(output);
  });
  it.each([
    // A backtick fence cannot have a backtick in its info string.
    ["~~~ a`b\ncode\n~~~\n"],
    ["~~~~ `\n```\n~~~~\n"],
    // Indented code has no fence.
    ["    ~~~\n    code\n"],
    ["Text\n\n\t```\n\tcode\n"],
    ["- Item\n\n      ~~~\n      code\n"],
    ["```\ncode\n```\n"],
    ["````\n```\ninner\n```\n````\n"],
  ])("leaves %j as written", (source) => {
    kept(source, only(rule));
  });
  it.each(dialects)("converts fences in the %s dialect", (dialect) => {
    expect(formatted("~~~\n$$\n%% x\n~~~\n\n> ~~~\n> y\n> ~~~\n", only(rule, dialect))).toBe(
      "```\n$$\n%% x\n```\n\n> ```\n> y\n> ```\n",
    );
  });
  it("reports both fences of a block", () => {
    expect(lint("~~~\ncode\n~~~\n", { config: only(rule) })).toMatchObject([
      { rule: "style/code-fence", line: 1, column: 1, message: "Use ``` for the code fence." },
      { rule: "style/code-fence", line: 3, column: 1, edit: { start: 9, end: 12, text: "```" } },
    ]);
  });
  it("takes the marker of the first fence with `consistent`", () => {
    const consistent = only({ "style/code-fence": ["warn", { marker: "consistent" }] });
    expect(formatted("~~~\na\n~~~\n\n```\nb\n```\n\n````\nc\n````\n", consistent)).toBe(
      "~~~\na\n~~~\n\n~~~\nb\n~~~\n\n~~~\nc\n~~~\n",
    );
    expect(formatted("    indented\n\n```\na\n```\n\n~~~\nb\n~~~\n", consistent)).toBe(
      "    indented\n\n```\na\n```\n\n```\nb\n```\n",
    );
    kept("No code.\n", consistent);
  });
  it("rejects other markers", () => {
    expect(() =>
      lint("", { config: only({ "style/code-fence": ["warn", { marker: "`" }] }) }),
    ).toThrow("Invalid options for style/code-fence");
  });
});

describe("style/thematic-break", () => {
  const rule = { "style/thematic-break": "warn" } as const;
  const stars: Record<string, RuleSetting> = {
    "style/thematic-break": ["warn", { marker: "***" }],
  };
  it.each([
    ["Text\n\n***\n", "Text\n\n---\n"],
    ["Text\n\n* * *\n", "Text\n\n---\n"],
    ["Text\n\n  _ _ _  \n", "Text\n\n  ---  \n"],
    ["Text\n\n- - - -\n", "Text\n\n---\n"],
    ["Text\n\n******\n", "Text\n\n---\n"],
    ["# Title\n***\n", "# Title\n---\n"],
    ["```\ncode\n```\n***\n", "```\ncode\n```\n---\n"],
    ["> Text\n>\n> ***\n", "> Text\n>\n> ---\n"],
    ["- Text\n\n  ***\n", "- Text\n\n  ---\n"],
    ["+ ***\n", "+ ---\n"],
    ["1. ***\n", "1. ---\n"],
    ["Text\n> ***\n", "Text\n> ---\n"],
    ["-\n  ***\n", "-\n  ---\n"],
    // Below text, `-` underlines a heading.
    ["Text\n-\n  ***\n", "Text\n-\n  ---\n"],
    ["Text\r\n\r\n***\r\n", "Text\r\n\r\n---\r\n"],
  ])("writes %j with ---", (source, output) => {
    expect(formatted(source, only(rule))).toBe(output);
  });
  it.each([
    ["Text\n\n---\n", "Text\n\n***\n"],
    ["Text\n---\n\n- - -\n", "Text\n---\n\n***\n"],
    ["Text\n- - -\n", "Text\n***\n"],
    ["- ---\n", "***\n"],
    // `- ---` is one thematic break, not a list item.
    ["- Text\n- ---\n", "- Text\n***\n"],
  ])("writes %j with *** on request", (source, output) => {
    expect(formatted(source, only(stars))).toBe(output);
  });
  it.each([
    // `---` directly below a paragraph or a definition would underline a heading.
    ["Text\n***\n"],
    ["Text\n- - -\n"],
    ["Two\nlines\n___\n"],
    ["[a]: https://example.com\n***\n"],
    ["> Quoted\n***\n"],
    ["- Item\n***\n"],
    ["> Text\n> ***\n"],
    ["- Text\n  ***\n"],
    // On a list item's line, `---` after `-` would make the line one thematic break.
    ["- ***\n"],
    ["- Item\n- ***\n"],
    ["- - ***\n"],
    ["1. - ***\n"],
    ["> - ***\n"],
    ["[^1]: - ***\n"],
    // At the start, `---` would open front matter that a later `---` closes.
    ["***\ntitle: x\n---\n"],
    ["***\n\nText\n"],
    ["***\n- Item\n"],
  ])("leaves %j as written", (source) => {
    kept(source, only(rule));
  });
  it.each(dialects.filter((dialect) => dialect !== "commonmark"))(
    "leaves a break directly below display math as written in the %s dialect",
    (dialect) => {
      // GitHub builds display math from a paragraph, which `---` would
      // underline as a heading (issue #336).
      kept("$$\nx = 1\n$$\n* * *\n", only(rule, dialect));
      expect(formatted("$$\nx = 1\n$$\n\n* * *\n", only(rule, dialect))).toBe(
        "$$\nx = 1\n$$\n\n---\n",
      );
    },
  );
  it("leaves `* ***` and `- ---` lines alone for the marker that would join them", () => {
    kept("Text\n\n* ---\n", only(stars));
    kept("Text\n\n- ***\n", only(rule));
  });
  it.each(dialects)("converts thematic breaks in the %s dialect", (dialect) => {
    expect(formatted("Text\n\n***\n\n> ***\n", only(rule, dialect))).toBe("Text\n\n---\n\n> ---\n");
  });
  it("takes the character of the first break with `consistent`", () => {
    const consistent = only({ "style/thematic-break": ["warn", { marker: "consistent" }] });
    expect(formatted("Text\n\n* * *\n\n---\n\n___\n", consistent)).toBe(
      "Text\n\n***\n\n***\n\n***\n",
    );
    // The exceptions still apply: `---` below text would underline it.
    expect(formatted("Text\n\n- - -\n\nMore\n***\n", consistent)).toBe(
      "Text\n\n---\n\nMore\n***\n",
    );
  });
});

describe("style/blank-lines", () => {
  const rule = { "style/blank-lines": "warn" } as const;
  it.each([
    ["One\n\n\nTwo\n", "One\n\nTwo\n"],
    ["One\n\n\n\n\nTwo\n", "One\n\nTwo\n"],
    ["\n\n# Title\n", "# Title\n"],
    ["  \n\t\n# Title\n", "# Title\n"],
    ["Text\n\n\n", "Text\n"],
    ["Text\n  \n\t", "Text\n"],
    ["Text\r\n\r\n\r\nMore\r\n\r\n", "Text\r\n\r\nMore\r\n"],
    ["Text\r\r\rMore\r\r", "Text\r\rMore\r"],
    ["\n\n", ""],
    ["  ", ""],
    // Blank space on a blank line does not make it another line.
    ["One\n  \n\nTwo\n", "One\n  \nTwo\n"],
    // Lists, block quotes, and footnotes.
    ["- One\n\n\n- Two\n", "- One\n\n- Two\n"],
    ["- One\n\n\n  More\n", "- One\n\n  More\n"],
    ["-\n\n\n  Text\n", "-\n\n  Text\n"],
    ["> One\n>\n>\n> Two\n", "> One\n>\n> Two\n"],
    ["> One\n> \n>\n> Two\n", "> One\n> \n> Two\n"],
    ["> > One\n> >\n> >\n> > Two\n", "> > One\n> >\n> > Two\n"],
    ["- > One\n  >\n  >\n  > Two\n", "- > One\n  >\n  > Two\n"],
    ["[^1]: One\n\n\n    Two\n", "[^1]: One\n\n    Two\n"],
    // Blank lines around code are not inside it.
    ["Text\n\n\n    code\n\n\nText\n", "Text\n\n    code\n\nText\n"],
    ["```\ncode\n```\n\n\nText\n", "```\ncode\n```\n\nText\n"],
    ["<!-- note -->\n\n\nText\n", "<!-- note -->\n\nText\n"],
    ["<div>\nHTML\n\n\nText\n", "<div>\nHTML\n\nText\n"],
  ])("removes the extra blank lines of %j", (source, output) => {
    expect(formatted(source, only(rule))).toBe(output);
  });
  it.each([
    ["One\n\nTwo\n"],
    ["Text\n"],
    ["Text"],
    [""],
    // Blank lines that are content.
    ["```\ncode\n\n\nmore\n```\n"],
    ["~~~\ncode\n\n\n"],
    ["- ~~~\n  code\n\n\n"],
    ["    code\n\n\n    more\n"],
    ["> ```\n>\n>\n> ```\n"],
    ["<pre>\n\n\n</pre>\n"],
    ["<!-- one\n\n\ntwo -->\n"],
    ["<!-- todo\n\n\n"],
    ["- <!-- todo\n\n\n"],
    ["$$\nx\n\n\ny\n$$\n"],
    ["---\ntitle: T\n\n\nmore: M\n---\n"],
    // Below blank lines, `---` would open front matter.
    ["\n\n---\ntitle: T\n---\n"],
    ["\n+++\ntitle = 'T'\n+++\n"],
    // In a block quote, the parser reads a list followed by two blank lines as loose.
    ["> - One\n>\n>\n> Two\n"],
    ["> > - One\n> >\n> >\n"],
    // Lines with other block quote markers or indentation say different things.
    ["> One\n>\n\n> Two\n"],
    ["> One\n\n>\n\n> Two\n"],
    ["- > One\n  >\n>\n  > Two\n"],
  ])("leaves %j as written", (source) => {
    kept(source, only(rule));
  });
  it("keeps the blank lines of Obsidian comments", () => {
    kept("%%\none\n\n\ntwo\n%%\n", only(rule, "obsidian"));
    kept("%% todo\n\n\n", only(rule, "obsidian"));
    expect(formatted("%% one %%\n\n\nText\n", only(rule, "obsidian"))).toBe("%% one %%\n\nText\n");
  });
  it.each(dialects)("collapses blank lines in the %s dialect", (dialect) => {
    expect(formatted("\n# Title\n\n\n> A\n>\n>\n> B\n\n\n", only(rule, dialect))).toBe(
      "# Title\n\n> A\n>\n> B\n",
    );
  });
  it("reports each run at its first extra line", () => {
    expect(lint("\nA\n\n\nB\n\n", { config: only(rule) })).toMatchObject([
      { line: 1, message: "Remove the blank lines at the start of the document." },
      { line: 4, message: "Remove the repeated blank line.", edit: { start: 4, end: 5, text: "" } },
      { line: 6, message: "Remove the blank lines at the end of the document." },
    ]);
  });
  it("keeps up to `maximum` blank lines in a row", () => {
    const two = only({ "style/blank-lines": ["warn", { maximum: 2 }] });
    expect(formatted("\n\nA\n\n\nB\n\n\n\nC\n\n\n", two)).toBe("A\n\n\nB\n\n\nC\n");
    expect(formatted("> A\n>\n>\n>\n> B\n", two)).toBe("> A\n>\n>\n> B\n");
    kept("A\n\nB\n\n\nC\n", two);
    expect(lint("A\n\n\n\nB\n", { config: two })).toMatchObject([
      { line: 4, message: "Remove the blank lines beyond 2 in a row." },
    ]);
    for (const maximum of [0, 1.5, "2"])
      expect(() =>
        lint("", { config: only({ "style/blank-lines": ["warn", { maximum }] }) }),
      ).toThrow("Invalid options for style/blank-lines");
  });
});

describe("style/trailing-space", () => {
  const rule = { "style/trailing-space": "warn" } as const;
  const backslash: Record<string, RuleSetting> = {
    "style/trailing-space": ["warn", { hardBreak: "backslash" }],
  };
  it.each([
    ["Text \nmore\t\nend \t \n", "Text\nmore\nend\n"],
    ["Text  \n", "Text\n"],
    ["Text  \n\nMore\n", "Text\n\nMore\n"],
    ["Text\t  \nmore\n", "Text\nmore\n"],
    ["# Title  \n", "# Title\n"],
    ["Title  \n===  \n", "Title\n===\n"],
    ["> Text \n>  \n> more\n", "> Text\n>\n> more\n"],
    ["- Item \n   \n  more\n", "- Item\n\n  more\n"],
    ["- [ ]  \n", "- [ ]\n"],
    ["| a | b  \n| - | -  \n| c | d  \n", "| a | b\n| - | -\n| c | d\n"],
    ["***  \n", "***\n"],
    ["*one \ntwo*\n", "*one\ntwo*\n"],
    ["[one \ntwo](url)\n", "[one\ntwo](url)\n"],
    ["`code` \nmore\n", "`code`\nmore\n"],
    ["Text\r\nmore \r\n", "Text\r\nmore\r\n"],
    ["Text \rmore \r", "Text\rmore\r"],
    ["Text  ", "Text"],
    // Fence lines are syntax unless an info string's text runs to their end.
    ["```  \ncode\n```  \n", "```\ncode\n```\n"],
    ["```js  \ncode\n```\n", "```js\ncode\n```\n"],
    ["- ```\n  code\n  ```  \n", "- ```\n  code\n  ```\n"],
  ])("removes the trailing blank space of %j", (source, output) => {
    expect(formatted(source, only(rule))).toBe(output);
  });
  it.each([
    // A hard line break written as spaces stays exactly as written.
    ["One  \ntwo\n"],
    ["One     \ntwo\n"],
    ["> One  \n> two\n"],
    ["*One  \ntwo*\n"],
    ["One  \ntwo\n===\n"],
    // Code, HTML, math, front matter, and the parts of links that are not text.
    ["```\ncode  \n```\n"],
    ["``` js title  \ncode\n```\n"],
    ["    code  \n    \n    more\n"],
    ["~~~\ncode  \n"],
    ["`code  \nspan`\n"],
    ["<div>  \nHTML  \n</div>\n"],
    ['Text <span  \nclass="a">\n'],
    ["$$  \nx  \n$$\n"],
    ["Inline $x  \ny$ math\n"],
    ["---\ntitle: T  \n---\n"],
    ['[text](url "title  \nmore")\n'],
    ['[a]: url "title  \nmore"\n'],
    ["[text][label  \nmore]\n\n[label more]: url\n"],
    ["![alt  \nmore](image.png)\n"],
  ])("leaves %j as written", (source) => {
    kept(source, only(rule));
  });
  it("leaves Obsidian comments as written", () => {
    kept("Text %% a  \nb %% more\n", only(rule, "obsidian"));
    kept("%%\nhidden  \n%%\n", only(rule, "obsidian"));
  });
  it.each([
    ["One  \ntwo\n", "One\\\ntwo\n"],
    ["One     \ntwo\n", "One\\\ntwo\n"],
    ["> One  \n> two  \n", "> One\\\n> two\n"],
    ["- *One  \n  two*\n", "- *One\\\n  two*\n"],
    ["One  \ntwo\n===\n", "One\\\ntwo\n===\n"],
    ["One  \r\ntwo\r\n", "One\\\r\ntwo\r\n"],
  ])("writes the hard line break of %j as a backslash on request", (source, output) => {
    expect(formatted(source, only(backslash))).toBe(output);
  });
  it("keeps a hard line break as spaces where a backslash would mean something else", () => {
    // After a backslash, another one would be escaped and the break gone.
    kept("One\\  \ntwo\n", only(backslash));
    // On Forgejo and Gitea, a backslash inside `\(...\)` would be part of the formula.
    for (const dialect of ["forgejo", "gitea"] as const)
      kept("Math \\( a  \nb \\) here\n", only(backslash, dialect));
    expect(formatted("Math \\( a  \nb \\) here\n", only(backslash))).toBe(
      "Math \\( a\\\nb \\) here\n",
    );
    // A literal autolink would take the backslash into its address.
    kept("See www.example.com  \nnext\n", only(backslash));
    kept("See https://example.com/a.  \nnext\n", only(backslash));
    expect(formatted("See www.example.com and  \nnext\n", only(backslash))).toBe(
      "See www.example.com and\\\nnext\n",
    );
    // `[label]:\` would define a link to `\`.
    kept("[a]:  \n    * * *\n", only(backslash, "commonmark"));
    kept("- [x]:  \n      * * *\n", only(backslash));
    // The title line of an alert or callout would end with it.
    kept("> [!NOTE]  \n> Text.\n", only(backslash));
    kept("> [!tip] Title  \n> Text.\n", only(backslash, "obsidian"));
    // Also with a marker written with an escape or a character reference (issue #294).
    kept("> \\[!NOTE]  \n> Text.\n", only(backslash));
    kept("> &#91;!tip] Title  \n> Text.\n", only(backslash, "obsidian"));
    expect(formatted("> [!tip] Title\n> One  \n> two\n", only(backslash, "obsidian"))).toBe(
      "> [!tip] Title\n> One\\\n> two\n",
    );
  });
  it.each(dialects)("removes trailing blank space in the %s dialect", (dialect) => {
    expect(formatted("# Title \n\nText \n> Quote \n", only(rule, dialect))).toBe(
      "# Title\n\nText\n> Quote\n",
    );
  });
});

describe("lines of blank space that Obsidian reads as text (#358)", () => {
  // Obsidian's Reading view reads a line of blank space that holds a tab as
  // more of the paragraph above it, and one directly below an HTML block as
  // more of the block; emptying it would end the paragraph or block there.
  const rules = { "style/blank-lines": "warn", "style/trailing-space": "warn" } as const;
  it.each([
    "a\n\t\nb\n",
    "a\n \t\nb\n",
    "a\n\t\n\nb\n",
    "> a\n>\t\n> b\n",
    "<div>\nx\n</div>\n  \n# H\n",
    "<div>\nx\n</div>\n  \n\n# H\n",
    "<div>\nx\n</div>\n\t\n# H\n",
  ])("keeps %j as written in Obsidian", (source) => {
    kept(source, only(rules, "obsidian"));
  });
  it.each([
    ["a\n\t\nb\n", "a\n\nb\n"],
    ["a\n\t\n\nb\n", "a\n\nb\n"],
    ["<div>\nx\n</div>\n  \n\n# H\n", "<div>\nx\n</div>\n\n# H\n"],
  ])("empties %j in the other dialects", (source, output) => {
    expect(formatted(source, only(rules, "github"))).toBe(output);
  });
  it("still empties lines of spaces elsewhere in Obsidian", () => {
    expect(formatted("a\n  \nb\n\n\n\nc\n", only(rules, "obsidian"))).toBe("a\n\nb\n\nc\n");
    expect(formatted("<!-- c -->\nx\n\n  \n\ny\n", only(rules, "obsidian"))).toBe(
      "<!-- c -->\nx\n\ny\n",
    );
  });
});

describe("style/heading closing sequences", () => {
  const rule = { "style/heading": "warn" } as const;
  it.each([
    ["# Title #\n", "# Title\n"],
    ["## Title ##   \n", "## Title\n"],
    ["### Title\t#####\t\n", "### Title\n"],
    ["# Title #foo #\n", "# Title #foo\n"],
    ["# C# ##\n", "# C#\n"],
    ["## ##\n", "##\n"],
    ["#  #\n", "#\n"],
    ["> # Quoted #\n", "> # Quoted\n"],
    ["- # Listed #\n", "- # Listed\n"],
    ["  # Indented #\n", "  # Indented\n"],
    ["# Title #\r\n", "# Title\r\n"],
    ["# Title #", "# Title"],
  ])("removes the closing sequence of %j", (source, output) => {
    expect(formatted(source, only(rule))).toBe(output);
  });
  it.each([["# Title\n"], ["# Title #foo\n"], ["# Title \\#\n"], ["# Title\\#\n"], ["#\n"]])(
    "leaves %j as written",
    (source) => {
      kept(source, only(rule));
    },
  );
  it("keeps closing sequences with `closing: keep`", () => {
    const keep = only({ "style/heading": ["warn", { closing: "keep" }] });
    kept("# Title #\n\n## Sub ##\n", keep);
    expect(formatted("Title\n===\n", keep)).toBe("# Title\n");
  });
  it("keeps the closing sequence after a Forgejo or Gitea attribute block", () => {
    // Gitea before 1.26 reads the block only with the sequence after it.
    for (const dialect of ["forgejo", "gitea"] as const) {
      kept("## Title {#id} ##\n", only(rule, dialect));
      kept("## Title {.a} ##\n", only(rule, dialect));
      expect(formatted("## Use {braces} ##\n", only(rule, dialect))).toBe("## Use {braces}\n");
    }
    expect(formatted("## Title {#id} ##\n", only(rule))).toBe("## Title {#id}\n");
  });
  it.each(dialects)("removes closing sequences in the %s dialect", (dialect) => {
    expect(formatted("# Title #\n\n> ## Quoted ##\n", only(rule, dialect))).toBe(
      "# Title\n\n> ## Quoted\n",
    );
  });
});

describe("style/heading with underlined headings", () => {
  const setext = only({ "style/heading": ["warn", { style: "setext" }] });
  const consistent = only({ "style/heading": ["warn", { style: "consistent" }] });
  it.each([
    ["# Title\n", "Title\n=====\n"],
    ["## Sub ##\n", "Sub\n---\n"],
    ["Text\n\n## *Sub* and `code`\n", "Text\n\n*Sub* and `code`\n----------------\n"],
    // Deeper levels cannot be underlined and keep their `#`.
    ["### Deep ###\n", "### Deep\n"],
    ["# 漢字\r\n\r\nText\r\n", "漢字\r\n====\r\n\r\nText\r\n"],
    ["# A\r\rB\r", "A\r===\r\rB\r"],
    ["Title\n===\n", "Title\n===\n"],
  ])("writes %j underlined", (source, output) => {
    expect(formatted(source, setext)).toBe(output);
  });
  it.each([
    // Directly below text, the heading's line would continue the paragraph.
    ["Text\n# Title\n"],
    ["> Quoted\n# Title\n"],
    ["<!-- mdtools-disable-next-line style/emphasis -->\n# *Title*\n"],
    // On a line of its own, the text would start another block.
    ["# - Item\n"],
    ["# 1. Step\n"],
    ["# > Quote\n"],
    ["## ---\n"],
    ["## ***\n"],
    ["# ```\n"],
    ["# <span>x</span>\n"],
    ["# [a]: https://example.com\n"],
    ["## a | b\n"],
    ["# Ends\\\\\n"],
    // Headings in containers, empty headings, and indented ones.
    ["> # Quoted\n"],
    ["- # Listed\n"],
    ["#\n"],
    ["  # Indented\n"],
  ])("keeps %j a # heading", (source) => {
    kept(source, setext);
  });
  it("keeps a heading with an attribute block on Forgejo and Gitea", () => {
    for (const dialect of ["forgejo", "gitea"] as const)
      kept("## Title {#id}\n", only({ "style/heading": ["warn", { style: "setext" }] }, dialect));
    expect(formatted("## Title {#id}\n", setext)).toBe("Title {#id}\n-----------\n");
  });
  it("follows the document's first heading with `consistent`", () => {
    expect(formatted("Title\n===\n\n# Next #\n\n### Deep\n", consistent)).toBe(
      "Title\n===\n\nNext\n====\n\n### Deep\n",
    );
    expect(formatted("## Title\n\nNext\n====\n", consistent)).toBe("## Title\n\n# Next\n");
    expect(formatted("### Deep\n\nNext\n----\n", consistent)).toBe("### Deep\n\n## Next\n");
  });
  it("rejects other styles", () => {
    expect(() =>
      lint("", { config: only({ "style/heading": ["warn", { style: "atx_closed" }] }) }),
    ).toThrow("Invalid options for style/heading");
  });
});

describe("style/table with compact cells", () => {
  const compact = only({ "style/table": ["warn", { style: "compact" }] });
  it("writes one space around each cell and the shortest delimiters", () => {
    expect(
      formatted(
        "| Sensor      | Unit |\n| :---------- | ---: |\n|Temperature|°C|\n| a |  |\n",
        compact,
      ),
    ).toBe("| Sensor | Unit |\n| :-- | --: |\n| Temperature | °C |\n| a |  |\n");
    expect(formatted("| a |\n|:-------:|\n", compact)).toBe("| a |\n| :-: |\n");
    kept("| a | b |\n| --- | :-: |\n| `c\\|d` | e |\n", compact);
  });
  it("aligns by default", () => {
    expect(formatted("| a | bb |\n| - | - |\n", only({ "style/table": "warn" }))).toBe(
      "| a   | bb  |\n| --- | --- |\n",
    );
  });
});

describe("style/heading below link reference definitions (#250)", () => {
  const rule = { "style/heading": "warn" } as const;
  it.each([
    ["[foo]: https://example.com\nTitle\n=====\n", "[foo]: https://example.com\n# Title\n"],
    ["[a]: x\n[b]: y\nTitle\n---\n", "[a]: x\n[b]: y\n## Title\n"],
    ['[a]: x "t"\nTitle\n===\n', '[a]: x "t"\n# Title\n'],
    ["[a]:\n  x\nTitle\n===\n", "[a]:\n  x\n# Title\n"],
    ["Text\n\n[a]: x\nTitle\n===\n\n[a]\n", "Text\n\n[a]: x\n# Title\n\n[a]\n"],
  ])("converts the Setext heading of %j and keeps the definitions", (source, output) => {
    expect(formatted(source, only(rule))).toBe(output);
    expect(lint(source, { config: only(rule) })).toMatchObject([
      { line: source.split("\n").findIndex((line) => line.startsWith("Title")) + 1, column: 1 },
    ]);
  });
  it("leaves a heading below a definition in a block quote as written", () => {
    kept("> [a]: x\n> Title\n> ===\n", only(rule));
  });
});

describe("a final line ending inside an unclosed block (#251)", () => {
  const rule = { "style/final-newline": "warn" } as const;
  it.each([
    ["Text.\n\n<!-- todo", "github"],
    ["<!-- todo\nmore", "github"],
    // CommonMark ends such a block at `-->` only, not at HTML's `--!>`.
    ["<!-- todo --!>", "github"],
    ["<SCRIPT>\nlet a", "github"],
    ["<script>\nlet a", "github"],
    ["<pre>\ncode", "github"],
    ["<?php echo", "github"],
    ["<!DOCTYPE html", "github"],
    ["<![CDATA[ data", "github"],
    ["- <!-- todo", "github"],
    ["- Item\n\n  <!-- todo", "github"],
    ["[^1]: <!-- todo", "github"],
    ["<!-- todo", "commonmark"],
    ["1.\n\n\n   <!-- todo\n> more", "github"],
    ["Text.\n\n%% todo", "obsidian"],
    ["%%\nhidden", "obsidian"],
    ["- %% todo", "obsidian"],
    ["> %% todo", "obsidian"],
    // Without a closing fence, a last line of blank space counts only with a line ending.
    ["   ~~~\ncode\n   ", "github"],
    ["- ~~~\n  code\n  ", "github"],
    ["   $$\n\n   ", "github"],
  ] as const)("adds nothing to %j in the %s dialect", (source, dialect) => {
    kept(source, only(rule, dialect));
  });
  it.each([
    ["<!-- done -->", "github"],
    ["<!-->", "github"],
    ["<?>", "github"],
    ["<pre>code</pre>", "github"],
    ["<div>\ntext", "github"],
    ["> <!-- todo", "github"],
    ["- > <!-- todo", "github"],
    ["%% done %%", "obsidian"],
    ["> <!-- todo", "obsidian"],
    ["~~~\ncode", "github"],
    ["~~~\ncode\n~~~\n   ", "github"],
    ["> ~~~\n> code\n>   ", "github"],
  ] as const)("adds the line ending to %j in the %s dialect", (source, dialect) => {
    expect(formatted(source, only(rule, dialect))).toBe(`${source}\n`);
  });
  it("adds no blank line inside an unclosed comment at the end of a list", () => {
    const spacing = only({ "style/block-spacing": "warn" });
    kept("- <!-- todo\n# Heading\n", spacing);
    kept("> - <!-- todo\n> # Heading\n", spacing);
    kept("[^1]: <!-- todo\n# Heading\n", spacing);
    expect(formatted("- <!-- done -->\n# Heading\n", spacing)).toBe(
      "- <!-- done -->\n\n# Heading\n",
    );
    expect(formatted("- > <!-- todo\n# Heading\n", spacing)).toBe("- > <!-- todo\n\n# Heading\n");
  });
  it("tells unclosed blocks apart as the parser does", () => {
    // A line ending added to each document either joins its last block or not.
    const blocks = fc.tuple(
      fc.constantFrom("", "- ", "> ", "[^1]: ", "- > "),
      fc.constantFrom(
        "<!--",
        "<!-- a -->",
        "<!-- a --!>",
        "<SCRIPT>",
        "<script></Script>",
        "<!-->",
        "<!--->",
        "<?",
        "<?>",
        "<? a ?>",
        "<!A",
        "<!A>",
        "<![CDATA[",
        "<![CDATA[]]>",
        "<pre",
        "<pre>",
        "<pre></pre>",
        "<script>",
        "<style></STYLE>",
        "<textarea>",
        "<div>",
        "<span>",
        "%%",
        "%% a %%",
        "%%%",
        "%%%%",
      ),
      fc.constantFrom("", " x", "\nmore"),
    );
    fc.assert(
      fc.property(
        blocks,
        fc.constantFrom<Dialect>("github", "obsidian"),
        ([prefix, block, rest], dialect) => {
          const source = `${prefix}${block}${rest}`;
          const output = format(source, { config: only(rule, dialect) });
          expect(output.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
          const joins =
            semanticFingerprint(parse(source, dialect)) !==
            semanticFingerprint(parse(`${source}\n`, dialect));
          expect(output.output).toBe(joins ? source : `${source}\n`);
        },
      ),
      { numRuns: 400, seed: 20261017 },
    );
  });
});

describe("the block and whitespace rules together", () => {
  const all: Record<string, RuleSetting> = {
    "style/block-spacing": "warn",
    "style/blank-lines": "warn",
    "style/code-fence": "warn",
    "style/final-newline": "warn",
    "style/heading": "warn",
    "style/table": "warn",
    "style/thematic-break": "warn",
    "style/trailing-space": "warn",
    "style/wrap": ["warn", { width: 40 }],
  };
  it("formats a document in one run", () => {
    const source =
      "\n\nTitle  \n=====\n\n\n\n## Setup ##\nInstall it.   \n~~~sh\nnpm test  \n~~~\n***\n\n\n* * *\n| a |\n|-|\n\n\n";
    expect(formatted(source, only(all))).toBe(
      "# Title\n\n## Setup\n\nInstall it.\n```sh\nnpm test  \n```\n---\n\n---\n| a   |\n| --- |\n",
    );
  });
  it("is in the recommended preset", () => {
    const recommended = presets.recommended!.rules!;
    for (const name of [
      "style/blank-lines",
      "style/code-fence",
      "style/heading",
      "style/table",
      "style/thematic-break",
      "style/trailing-space",
    ])
      expect(recommended[name], name).toBe("warn");
  });
  it("leaves the source as written when the rules are off", () => {
    const source = "\n\nTitle  \n===\n\n\n~~~\ncode\n~~~\n***\n## A ##\n";
    const off = Object.fromEntries(Object.keys(all).map((name) => [name, "off"])) as Record<
      string,
      RuleSetting
    >;
    expect(format(source, { config: only(off) }).output).toBe(source);
    expect(format(source, { config: { rules: off } }).output).toBe(source);
  });
  it("honours suppression comments", () => {
    // `style/wrap` would remove blank space at the end of a paragraph too.
    const config = only({ "style/code-fence": "warn", "style/trailing-space": "warn" });
    const source =
      "<!-- mdtools-disable style/trailing-space style/code-fence -->\n\nText  \n\n~~~\ncode\n~~~\n\n<!-- mdtools-enable -->\n\nText  \n\n~~~\ncode\n~~~\n";
    expect(formatted(source, config)).toBe(
      "<!-- mdtools-disable style/trailing-space style/code-fence -->\n\nText  \n\n~~~\ncode\n~~~\n\n<!-- mdtools-enable -->\n\nText\n\n```\ncode\n```\n",
    );
  });
  it("keeps the meaning of randomly assembled documents", () => {
    const blocks = fc.constantFrom(
      "# Heading #",
      "## Heading",
      "Title\n=====",
      "Sub  \n---",
      "Text.",
      "Text.  ",
      "Hard  \nbreak.",
      "Back\\\nslash.",
      "Two \nlines.\t",
      "- Item ",
      "- One\n- Two",
      "* A\n\n\n* B",
      "1. First",
      "- ***",
      "+ ***",
      "1. - ***",
      "-\n  ***",
      "***",
      "* * *",
      "___  ",
      "- - -",
      "#  #",
      "Title #\n===",
      "Line\\  \nnext",
      "Ends\\",
      "~~~js\ncode  \n~~~",
      "~~~\n```\n~~~",
      "~~~~\n~~~\n~~~~",
      "~~~ a`b\ncode\n~~~",
      "``` js meta  \ncode\n```  ",
      "```\n~~~\n\n\n```",
      "~~~",
      "    code  \n\n\n    more",
      "\tcode  ",
      "<div>\nhtml  ",
      "<!-- comment -->  ",
      "<!-- open",
      "<!-- two\n\n\nparts -->",
      "<pre>\n\n\n</pre>",
      "$$\nx  \n\n\n$$",
      "| a |  \n| - |",
      "> Quoted  ",
      "> [!NOTE]  \n> - Item  ",
      "> [!tip] Title  \n> body",
      "---\ntitle: x\n---",
      "[a]: https://example.com",
      "[a]: https://example.com\nTitle\n===",
      '[a]: x "t  \nu"',
      '[a](b "t  \nu")',
      "[x]:  \n    * * *",
      "[^1]: Note.  ",
      "%%\n%%",
      "%% hidden  \n\n\n%%",
      "%% open",
      "^block-id",
      "`code  \nspan`",
      "<span  \nx>",
      "$x  \ny$",
      "See www.example.com.  \nnext",
      "## Title {#id} ##",
      "Math \\( a  \nb \\)",
      "",
      "  ",
      "\t",
    );
    const containers = fc.constantFrom(
      ["", ""],
      ["> ", "> "],
      ["> > ", "> > "],
      ["- ", "  "],
      ["- > ", "  > "],
      ["> - ", ">   "],
      ["1. ", "   "],
      ["[^1]: ", "    "],
    );
    const group = fc.tuple(
      containers,
      fc.array(fc.tuple(blocks, fc.integer({ min: 0, max: 3 })), { minLength: 1, maxLength: 6 }),
    );
    const settings = fc.record({
      fence: fc.constantFrom("```", "~~~"),
      marker: fc.constantFrom("---", "***", "___"),
      hardBreak: fc.constantFrom("keep", "backslash"),
    });
    fc.assert(
      fc.property(
        fc.constantFrom(...dialects),
        fc.integer({ min: 0, max: 2 }),
        fc.array(group, { minLength: 1, maxLength: 3 }),
        fc.constantFrom("\n", "\r\n", "\r"),
        fc.boolean(),
        settings,
        (dialect, leading, groups, newline, final, { fence, marker, hardBreak }) => {
          const lines: string[] = Array.from({ length: leading }, () => "");
          for (const [[first, rest], items] of groups)
            items.forEach(([block, blank], index) => {
              if (index > 0) for (let i = 0; i < blank; i++) lines.push(rest.trimEnd());
              block.split("\n").forEach((line, at) => {
                lines.push((index === 0 && at === 0 ? first : rest) + line);
              });
            });
          const config = only(
            {
              ...all,
              "style/code-fence": ["warn", { marker: fence }],
              "style/thematic-break": ["warn", { marker }],
              "style/trailing-space": ["warn", { hardBreak }],
            },
            dialect,
          );
          formatted(lines.join(newline) + (final ? newline : ""), config);
        },
      ),
      { numRuns: 400, seed: 20261017 },
    );
  });
});
