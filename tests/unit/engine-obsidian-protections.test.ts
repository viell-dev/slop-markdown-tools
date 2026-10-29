import { describe, expect, it } from "vitest";
import { rendererProtections } from "../../src/syntax/renderer-protections.js";
import { format, parse, createWorkspace, semanticFingerprint, range } from "../../src/index.js";
import type { Config, Plugin } from "../../src/index.js";
import { formatted } from "../support/engine.js";
describe("HTML comments that Live Preview continues across blocks", () => {
  const config: Config = {
    extends: ["recommended", "obsidian"],
    dialect: "obsidian",
    rules: { "style/wrap": ["warn", { width: 20 }] },
  };
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a <!-- b\n\n> - c --> d e f g h i j k l m n o p q r s\n>   t u\n",
    "a <!-- b\n\n> - c\n>   --> d e f g h i j k l m n o p q r s\n",
    "a <!-- b\n\n> - c *d* e f g h i j k l m n o p q r s\n",
    "a *b <!-- c*\n\n# d *e*\n\nf --> g *h*\n",
    "a ==b <!-- c==\n\nd *e*\n\nf --> g *h*\n",
    "a [b <!-- c](https://example.org)\n\nd *e*\n\nf --> g *h*\n",
    "a ![b <!-- c](image.png)\n\nd *e*\n\nf --> g *h*\n",
    "a <!-- b\n\n```\nc --> d\n```\n",
    "a <!-- b\n\nc --> d <!-- e\n\nf *g*\n",
    "a ==b <!-- nested <!-- c --> d <!-- e==\n\nf *g*\n",
  ])("keeps the comment and its closing block in %j", (input) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = input.replaceAll("\n", newline);
      const output = formatted(source, { config, workspace });
      expect(output).toBe(source);
      expect(semanticFingerprint(parse(output, "obsidian"))).toBe(
        semanticFingerprint(parse(source, "obsidian")),
      );
      expect(formatted(source, { config: { extends: [], dialect: "obsidian" } })).toBe(source);
    }
  });
  it.each([
    ["a <!-- b --> *c*\n", "a <!-- b --> _c_\n"],
    ["a \\<!-- b *c*\n", "a \\<!-- b _c_\n"],
    ["a `<!--` b *c*\n", "a `<!--` b _c_\n"],
    ["```\na <!-- b\n```\n\nc *d*\n", "```\na <!-- b\n```\n\nc _d_\n"],
    ["a <!-- b\n\nc --> d\n\ne *f*\n", "a <!-- b\n\nc --> d\n\ne _f_\n"],
    ["a <!-- b\n\nc --> d\n\ne <!-- f\n\ng *h*\n", "a <!-- b\n\nc --> d\n\ne <!-- f\n\ng *h*\n"],
  ])("still formats independent text in %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("leaves other dialects unchanged", () => {
    expect(
      formatted("a <!-- b\n\nc *d*\n", {
        config: { extends: ["recommended", "github"], dialect: "github" },
      }),
    ).toBe("a <!-- b\n\nc _d_\n");
  });
  describe("comments opened by headings and tables", () => {
    const openers = [
      "# Head *a* <!-- open #\n",
      "Head *a* <!-- open\n===\n",
      "| A | B |\n| - | - |\n| x <!-- open | y |\n",
      "| <!-- open | A |\n| - | - |\n| x | y |\n",
    ];
    const closers = [
      "\n> alpha --> beta *gamma* delta epsilon zeta eta theta iota\n> more words\n",
      "\n* alpha --> beta *gamma* delta epsilon zeta eta theta iota\n  more words\n",
      "\n> alpha *beta* gamma delta epsilon zeta eta theta iota\n",
    ];
    it.each(openers)("keeps all of the opening and closing blocks after %j", (opener) => {
      for (const closer of closers)
        for (const newline of ["\n", "\r\n", "\r"])
          for (const mark of ["", String.fromCharCode(0xfeff)]) {
            const source = mark + (opener + closer).replaceAll("\n", newline);
            const output = formatted(source, { config, workspace });
            expect(output).toBe(source);
            expect(semanticFingerprint(parse(output, "obsidian"))).toBe(
              semanticFingerprint(parse(source, "obsidian")),
            );
            expect(formatted(source, { config: { extends: [], dialect: "obsidian" } })).toBe(
              source,
            );
          }
    });
    it.each([
      "> # Head <!-- open\n>\n> * alpha --> beta *gamma* delta epsilon zeta eta\n>   more words\n",
      "* Head <!-- open\n  ===\n\n  > alpha --> beta *gamma* delta epsilon zeta eta\n  > more words\n",
      "> | A | B |\n> | - | - |\n> | x <!-- open | y |\n>\n> * alpha --> beta *gamma* delta epsilon zeta eta\n>   more words\n",
      "* | A | B |\n  | - | - |\n  | x <!-- open | y |\n\n  > alpha --> beta *gamma* delta epsilon zeta eta\n  > more words\n",
    ])("keeps container markers around %j", (source) => {
      expect(formatted(source, { config, workspace })).toBe(source);
    });
    it.each(openers)("still formats an independent block after the comment in %j", (opener) => {
      const kept = `${opener}\n> alpha --> beta *gamma*\n`;
      expect(formatted(`${kept}\nIndependent *text*.\n`, { config, workspace })).toBe(
        `${kept}\nIndependent _text_.\n`,
      );
    });
    it.each([
      ["# Head <!-- open #\n\nText *a*\n", "# Head <!-- open\n\nText _a_\n"],
      ["Head <!-- open\n===\n\nText *a*\n", "# Head <!-- open\n\nText _a_\n"],
      ["| x <!-- open |\n| - |\n\nText *a*\n", "| x <!-- open |\n| ----------- |\n\nText _a_\n"],
    ])("does not extend Obsidian's protection to other dialects in %j", (source, output) => {
      expect(
        formatted(source, {
          config: { extends: ["recommended", "github"], dialect: "github" },
        }),
      ).toBe(output);
    });
    it.each([
      ["# Head <!-- closed --> *a* #\n", "# Head <!-- closed --> _a_\n"],
      ["Head <!-- closed --> *a*\n===\n", "# Head <!-- closed --> _a_\n"],
      ["# Head \\<!-- open *a* #\n", "# Head \\<!-- open _a_\n"],
      ["Head \\<!-- open *a*\n===\n", "# Head \\<!-- open _a_\n"],
      ["# Head `<!--` *a* #\n", "# Head `<!--` _a_\n"],
      ["Head `<!--` *a*\n===\n", "# Head `<!--` _a_\n"],
    ])("still formats closed, escaped, and code openers in %j", (source, output) => {
      expect(formatted(`${source}\nText *b*\n`, { config, workspace })).toBe(
        `${output}\nText _b_\n`,
      );
    });
    it.each(["<!-- closed -->", "\\<!-- open", "`<!--`"])(
      "still aligns a table containing %j and formats the block below it",
      (content) => {
        const source = `| ${content} | x |\n| - | - |\n| y | z |\n\nText *a*\n`;
        const obsidian = formatted(source, { config, workspace });
        const github = formatted(source, {
          config: { extends: ["recommended", "github"], dialect: "github" },
        });
        expect(obsidian).toBe(github);
        expect(obsidian).not.toBe(source);
        expect(obsidian.endsWith("\nText _a_\n")).toBe(true);
      },
    );
    it("detects a later opener after a same-table closer in a different cell", () => {
      const source = "| <!-- first | --> <!-- second |\n| - | - |\n| x | y |\n\nText *a*\n";
      expect(formatted(source, { config, workspace })).toBe(source);
    });
    it("applies only the enabled rule outside the protected heading", () => {
      const kept = "Head *a* <!-- open\n===\n\nText --> *b*\n\n";
      const headingOnly: Config = {
        extends: [],
        dialect: "obsidian",
        rules: { "style/heading": "warn" },
      };
      expect(formatted(`${kept}Other *c*\n===\n`, { config: headingOnly })).toBe(
        `${kept}# Other *c*\n`,
      );
    });
    it.each([
      "# Head *a* <!-- open\n\nText *b*",
      "Head *a* <!-- open\n===\n\nText *b*",
      "| A | B |\n| - | - |\n| x <!-- open | y |\n\nText *b*",
    ])("keeps final block text without a closer in %j", (source) => {
      // Isolate the block protection from the existing EOF-newline policy.
      const withoutNewline: Config = {
        ...config,
        rules: { ...config.rules, "style/final-newline": "off" },
      };
      expect(formatted(source, { config: withoutNewline, workspace })).toBe(source);
    });
  });
});

describe("blocks that Obsidian reads into an HTML block above them", () => {
  // A line of blank space directly below an HTML block continues it in
  // Reading view, up to an empty line, so the text there shows as written
  // (issue #358).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "</div>\n  \n*a* b\n",
    "</div>\n\t\n### __z__ ##\n",
    "<div>\n</div>\n  \ndelta\n---\n",
    "<div>\n  \n*a* b\n",
    "</div>\n  \n*a* b\n  \n*c* d\n",
    "> </div>\n>  \n> *a* b\n",
    // Also the marker of a list item there, which is text of the HTML block.
    "</div>\n  \n* *a* b\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // An empty line ends the HTML block.
    ["</div>\n  \n*a* b\n\n*c* d\n", "</div>\n  \n*a* b\n\n_c_ d\n"],
    // These end at their own end markers.
    ["<!-- c -->\n  \n*a* b\n", "<!-- c -->\n  \n_a_ b\n"],
    ["<pre>\nx\n</pre>\n  \n*a* b\n", "<pre>\nx\n</pre>\n  \n_a_ b\n"],
    ["<script>\n</script>\n  \n*a* b\n", "<script>\n</script>\n  \n_a_ b\n"],
    ["  <!-- c -->\n  \n*a* b\n", "  <!-- c -->\n  \n_a_ b\n"],
    // An empty line in a list ends the HTML block there.
    ["</div>\n  \n- *a*\n\n  *b*\n", "</div>\n  \n- *a*\n\n  _b_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such text in the other dialects", () => {
    expect(
      formatted("</div>\n  \n*a* b\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("</div>\n\n_a_ b\n");
  });
});

describe("blocks that Obsidian reads into a paragraph across tab lines", () => {
  // Reading view reads a line of blank space with a tab at or right of a
  // paragraph's column as more of the paragraph, and then the block below
  // such lines too, unless it interrupts a paragraph (issue #398).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a\n\t\nb *c*\n",
    "a *** b *c*\n\t\nd *e f*\n",
    "a\n\t\n| x |\n| - |\n| y |\n",
    "a\n\t\nb\n===\n",
    "a\n\t\nb *c*\n---\n",
    "a\n\t\n2. b *c*\n",
    "a\n\t\n2. b *c*\n5. d *e*\n",
    "a\n\t\n2) b *c*\n",
    "a\n\t\n2.\n",
    "a\n\t\n[^1]: b *c*\n",
    "a\n\t\n[^1]: b\n\n    c *d*\n",
    "a\n\t\n\t\nb *c*\n",
    "a\n \t \nb *c*\n",
    "a\r\n\t\r\nb *c*\r\n",
    // Across the blocks that it reads as more of the text.
    "a\n\t\nb *c*\n\t\nd *e*\n",
    "a\n\t\n| x |\n| - |\n\t\nb *c*\n",
    "a\n| x |\n| - |\n\t\nb *c*\n",
    "a\n\t\n    b\n\t\nc *d*\n",
    "a\n\t\n2. b\n\t\nc *d*\n",
    "a\n\t\n[^1]: b\n\t\nc *d*\n",
    "a\n\t\n<custom>b</custom>\n\t\nc *d*\n",
    // In a block quote, and from a list item whose content the tab reaches.
    "> a\n> \t\n> b *c*\n",
    "> a\n> \t\nb *c*\n",
    "- a\n  \t\n  b *c*\n",
    "- a\n  \t\nb *c*\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  it.each([
    // These interrupt a paragraph, so they start blocks of their own.
    ["a\n\t\n# b *c* #\n", "a\n\t\n# b _c_\n"],
    ["a\n\t\n- b *c*\n", "a\n\t\n- b _c_\n"],
    ["a\n\t\n1. b *c*\n", "a\n\t\n1. b _c_\n"],
    ["a\n\t\n1) b *c*\n", "a\n\t\n1. b _c_\n"],
    ["a\n\t\n2. b\n\n   c\n\t\nd *e*\n\ne *f*\n", "a\n\t\n2. b\n\n   c\n\t\nd *e*\n\ne _f_\n"],
    ["a\n\t\n> b *c*\n", "a\n\t\n> b _c_\n"],
    ["a\n\t\n> [!note]\n> b *c*\n", "a\n\t\n> [!note]\n> b _c_\n"],
    ["a\n\t\n```\nx\n```\n\t\nb *c*\n", "a\n\t\n```\nx\n```\n\t\nb _c_\n"],
    ["a\n\t\n$$\nx\n$$\n\t\nb *c*\n", "a\n\t\n$$\nx\n$$\n\t\nb _c_\n"],
    ["a\n\t\n***\n\t\nb *c*\n", "a\n\t\n---\n\t\nb _c_\n"],
    ["a\n\t\n<div>\nb\n</div>\n\nc *d*\n", "a\n\t\n<div>\nb\n</div>\n\nc _d_\n"],
    // An empty line, or one of spaces, ends the paragraph.
    ["a\n\t\nb *c*\n\nd *e*\n", "a\n\t\nb *c*\n\nd _e_\n"],
    ["a\n\t\n  \nb *c*\n", "a\n\t\n\nb _c_\n"],
    ["a\n  \n\t\nb *c*\n", "a\n\n\t\nb _c_\n"],
    // Only paragraph text goes on below a tab line.
    ["# a\n\t\nb *c*\n", "# a\n\t\nb _c_\n"],
    ["| x |\n| - |\n\t\nb *c*\n", "| x   |\n| --- |\n\t\nb _c_\n"],
    ["[r]: https://x.org\n\t\nb *c*\n", "[r]: https://x.org\n\t\nb _c_\n"],
    // A tab left of the paragraph's column, in a list item or without a
    // quote's marker, is a blank line.
    ["- a\n\t\n  b *c*\n", "- a\n\t\n  b _c_\n"],
    ["- a\n\t\nb *c*\n", "- a\n\t\nb _c_\n"],
    ["1. a\n\t\n   b *c*\n", "1. a\n\t\n   b _c_\n"],
    ["> a\n\t\n> b *c*\n", "> a\n\t\n> b _c_\n"],
    ["> a\n\t\nb *c*\n", "> a\n\t\nb _c_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such blocks in the other dialects", () => {
    expect(
      formatted("a\n\t\nb *c*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a\n\nb _c_\n");
  });
});

describe("backticks that nothing closes in Obsidian", () => {
  // Live Preview shows the text after such a backtick as code, at least to the
  // end of its line, also from inside a highlight, an inline comment, or a link
  // or image description, and Reading view pairs a run of two or more with a
  // later, shorter one, where the parser reads text (issue #362).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "a ``` b *c* d\n",
    "a ` b *c* d\n",
    "a `` b\n`c` *d*\n",
    "# a ` b *c*\n",
    "==a ` b== *c* d\n",
    "==a `b` ``` c== *d*\n",
    "x %%a ` b%% *c* d\n",
    "[a ` b](x) *c* d\n",
    "![a ` b](x) *c* d\n",
    "![a ` b][r] *c* d\n\n[r]: x\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  // After a run of three or more, Live Preview shows the blocks below as code
  // up to a run of the same length, a fenced code block, or a list item.
  it.each([
    ["a ``` b\n\nc *d* e\n", "a ``` b\n\nc *d* e\n"],
    ["- a ``` b\n\nc *d*\n", "- a ``` b\n\nc *d*\n"],
    ["a ``` b\n\n# c *d* #\n\n    x *y*\n", "a ``` b\n\n# c *d* #\n\n    x *y*\n"],
    ["a ``` b\n\nc *d* ``` e *f*\n\ng *h*\n", "a ``` b\n\nc *d* ``` e *f*\n\ng _h_\n"],
    [
      "a ``` b\n\nc `` *d*\n\ne \\``` *f*\n\ng *h*\n",
      "a ``` b\n\nc `` *d*\n\ne \\``` *f*\n\ng *h*\n",
    ],
    ["a ``` b\n\nc ``` d ``` e\n\nf *g*\n", "a ``` b\n\nc ``` d ``` e\n\nf *g*\n"],
    ["a ``` b\n\n```js\nx\n```\n\nc *d*\n", "a ``` b\n\n```js\nx\n```\n\nc _d_\n"],
    ["a ``` b\n\n- c *d*\n\ne *f*\n", "a ``` b\n\n- c _d_\n\ne _f_\n"],
    ["| a ``` b |\n| - |\n\nc *d*\n", "| a ``` b |\n| - |\n\nc *d*\n"],
    // An indented code block shows as more of the code, and its run closes
    // nothing; in a wikilink, a run closes the code.
    ["a ``` b\n\n    x ``` y\n\nc *d*\n", "a ``` b\n\n    x ``` y\n\nc *d*\n"],
    ["a ``` b\n\nc [[x ``` y]] *d*\n\ne *f*\n", "a ``` b\n\nc [[x ``` y]] *d*\n\ne _f_\n"],
    // A list item ends the code also where its first block is a quote.
    ["a ``` b\n\n- > c *d*\n\ne *f*\n", "a ``` b\n\n- > c _d_\n\ne _f_\n"],
    // Blank lines do not end the code, so their number does not matter.
    ["a ``` b\n\n\n\nc *d*\n", "a ``` b\n\nc *d*\n"],
  ])("leaves the blocks below %j as Live Preview shows them", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("looks into the blocks of a container that a syntax plugin adds", () => {
    const source = "a ``` b\n\nc *d*\n";
    const document = parse(source, "obsidian");
    const blocks = document.tree.children;
    const container = {
      type: "pluginContainer",
      children: blocks,
      position: document.tree.position,
    };
    document.tree.children = [container as unknown as (typeof blocks)[number]];
    const { unclosedCode } = rendererProtections(document);
    expect([...unclosedCode].map((node) => source.slice(...range(node)))).toEqual([
      "a ``` b",
      "c *d*",
    ]);
  });

  it("keeps the emphasis in such a table cell", () => {
    expect(formatted("| a ` *b* |\n| - |\n", { config })).toBe("| a ` *b* |\n| ------- |\n");
  });
  it.each([
    ["a \\` b *c* d\n", "a \\` b _c_ d\n"],
    ["a `code` and *c*\n", "a `code` and _c_\n"],
    ["a ` b\n\n*c* d\n", "a ` b\n\n_c_ d\n"],
    // Live Preview starts no code inside math or a wikilink.
    ["$a ` b$ *c*\n", "$a ` b$ _c_\n"],
    ["[[a ` b]] *c*\n", "[[a ` b]] _c_\n"],
    ["==a `b` \\` c== *d*\n", "==a `b` \\` c== _d_\n"],
    ["![a `b` c](x) *d*\n", "![a `b` c](x) _d_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such text in the other dialects", () => {
    expect(
      formatted("a ` b *c* d\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a ` b _c_ d\n");
  });
});

describe("list items that Obsidian starts below a paragraph line", () => {
  // Live Preview starts a list at an ordered item numbered other than 1, and
  // Reading view at an empty item, where CommonMark reads text (issue #375).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "a\n3. b *c*\n",
    "a\n10) b\n",
    "a\n   3. b\n",
    "- a\n  3. b *c*\n",
    "- a\n    3. b *c*\n",
    "a\n3. b\nc *d*\n",
    "a\n3. b\n\n   c *d*\n",
    "a\n* \n",
    "a\n+ \n",
    "a\n1.\n",
    // The parser reads a heading here, where Obsidian shows text and an empty item.
    "a\n- \n",
    "> a\n> * \n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // Neither view starts an ordered list in a block quote.
    ["> a\n> 3. b *c*\n", "> a\n> 3. b _c_\n"],
    ["a *x*\n2.\n", "a _x_\n2.\n"],
    // Four columns right of the text, a marker is more of the text.
    ["a *x*\n    3. b\n", "a _x_\n    3. b\n"],
    ["- a *x*\n      3. b\n", "- a _x_\n      3. b\n"],
    // The block after the next one is no item of the list.
    ["a\n3. b\n\nc\n\nd *e*\n", "a\n3. b\n\nc\n\nd _e_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such text in the other dialects", () => {
    expect(
      formatted("a\n3. b *c*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a 3. b _c_\n");
  });
});

describe("underlines that Obsidian reads otherwise", () => {
  // Reading view reads an underline with blank space after it, or before it
  // beyond the heading's text, as text, and Live Preview a lone `-` (issue
  // #383). Reading view also reads a lazy line of `=` or `-` in a block quote or
  // list item as an underline, where the parser reads text (issue #377).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  // With strict line breaks, so that `style/wrap` joins lines.
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a\n-\n",
    "a\n-- \n",
    "a\n= \n",
    "a\n=\t\n",
    "a\n=== \n",
    "a\n--- \n",
    "a\n ==\n",
    "a\n   -\n",
    "> a\n> = \n",
    "- a\n  == \n",
    "> a\n=\n",
    "> a\n--\n",
    "> > a\n=\n",
    "> a\nb\n=\n",
    "- a\n=\n",
    "1. a\n=\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  it.each([
    ["a *b*\n--\n", "## a _b_\n"],
    ["a *b*\n=\n", "# a _b_\n"],
    ["a *b*\n===\n", "# a _b_\n"],
    ["- a *b*\n  =\n", "- a _b_\n  =\n"],
    ["> a *b*\n> --\n", "> a _b_\n> --\n"],
    // The text itself is formatted; only the underline stays on its own line.
    ["*a*\n-- \n", "_a_\n-- \n"],
    ["> *a*\n=\n", "> _a_\n=\n"],
    ["- *a*\n==\n", "- _a_\n==\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such headings in the other dialects", () => {
    expect(
      formatted("a\n-- \n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("## a\n");
  });
});

describe("list items that Live Preview ends at a lazy line", () => {
  // Live Preview reads the blocks after a lazy line of an item's paragraph, one
  // left of the item's content, outside the list, where an indented paragraph
  // is code and a fence's indentation is part of its code (issue #376).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  // With strict line breaks, so that `style/wrap` joins lines.
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "2. a\nb\n\n    c *d*\n",
    "- a\nb\n\n  - c *d*\n",
    "- a\nb\n\n  ```\n  c *d*\n  ```\n",
    "- a\nb\nc\n\n  d *e*\n",
    "- a\n  b\nc\n\n  d *e*\n",
    "> - a\n> b\n>\n>   c *d*\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  // The lazy line stays when nothing writes its prefix (#713).
  const lazy: Config = { ...config, rules: { "style/lazy-continuation": "off" } };
  it.each([
    // Without a lazy line, or without blocks after it in the item.
    ["2. a\n   b\n\n    c *d*\n", "2. a b\n\n    c _d_\n"],
    ["- a *x*\nb\n", "- a _x_\nb\n"],
    ["- a\nb\n- c *d*\n", "- a\nb\n- c _d_\n"],
    // A lazy line in a block quote changes nothing that Live Preview shows.
    ["> a\nb\n\n> c *d*\n", "> a\nb\n\n> c _d_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config: lazy, workspace })).toBe(output);
  });
  it.each([
    // Once `style/lazy-continuation` writes the prefix, Live Preview shows the
    // same, and the paragraph is no longer lazy for `style/wrap` (#713).
    ["- a *x*\nb\n", "- a _x_ b\n"],
    ["- a\nb\n- c *d*\n", "- a b\n- c _d_\n"],
    ["> a\nb\n\n> c *d*\n", "> a b\n\n> c _d_\n"],
  ])("writes the prefix of the lazy line in %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such items in the other dialects", () => {
    expect(
      formatted("2. a\nb\n\n    c *d*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("2. a b\n\n    c _d_\n");
  });
});

describe("footnote definitions that Obsidian reads as paragraph text", () => {
  // Reading view continues a line of paragraph text with a footnote definition
  // directly below it, also from a list item or block quote, and reads the
  // definition's indented lines as code (issue #378).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "a\n[^1]: b *c*\n    d *e*\n",
    "> - a\n[^1]: b\n    c *d*\n",
    "- a\n[^1]: b *c*\n",
    "> a\n[^1]: b *c*\n",
    // A definition below one that is text is text too.
    "a\n[^1]: b *c*\n[^2]: d *e*\n",
    // Blank space at the end of the line above is a line break in the paragraph.
    "a  \n[^1]: b\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // Below a blank line, a heading, or another definition, it is a definition.
    ["a\n\n[^1]: b *c*\n\nx[^1]\n", "a\n\n[^1]: b _c_\n\nx[^1]\n"],
    ["# h\n[^1]: b *c*\n\nx[^1]\n", "# h\n\n[^1]: b _c_\n\nx[^1]\n"],
    ["[^1]: a *b*\n[^2]: c *d*\n\nx[^1] y[^2]\n", "[^1]: a _b_\n[^2]: c _d_\n\nx[^1] y[^2]\n"],
    ["[r]: https://x.org\n[^1]: b *c*\n\nx[^1]\n", "[r]: https://x.org\n[^1]: b _c_\n\nx[^1]\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such definitions in the other dialects", () => {
    expect(
      formatted("a\n[^1]: b *c*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a\n[^1]: b _c_\n");
  });
});

describe("lines that Obsidian reads as code below a link reference definition", () => {
  // Reading view reads a line below a definition and four columns right of its
  // container's content as an indented code block, where the parser reads a
  // paragraph (issue #379).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "[r]: https://x.org\n      c   \n",
    "[r]: https://x.org\n    c *d*\n",
    "   [r]: https://x.org\n    c *d*\n",
    "[r]: https://x.org\n[s]: https://y.org\n    c *d*\n",
    "[r]:\n  https://x.org\n    c *d*\n",
    "[r]: https://x.org\n\tc *d*\n",
    "[r]: https://x.org\n    c *d*\ne *f*\n",
    "> [r]: https://x.org\n>     c *d*\n",
    "- [r]: https://x.org\n      c *d*\n",
    // The parser reads a heading, where Reading view shows code and text.
    "[r]: https://x.org\n    c\n===\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    ["[r]: https://x.org\nc *d*\n", "[r]: https://x.org\nc _d_\n"],
    ["[r]: https://x.org\n\n    c *d*\n\ne *f*\n", "[r]: https://x.org\n\n    c *d*\n\ne _f_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such lines in the other dialects", () => {
    expect(
      formatted("[r]: https://x.org\n    c *d*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("[r]: https://x.org\n    c _d_\n");
  });
});

describe("paragraph lines that Live Preview styles as a link reference definition", () => {
  // Live Preview styles a line that starts at the first column with `[`, a
  // label, and `]:` as a definition, and the lines above and below it as text,
  // where the parser reads more of the paragraph, because a definition cannot
  // interrupt one, or where the line is no definition (issue #391).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  // With strict line breaks, so that `style/wrap` joins lines.
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a\n[r]: https://x.org\n",
    'a\n[r]: https://x.org "t"\n',
    "a\n[r]: <https://x.org>\n",
    "a\n[r]:\n",
    "a\n[r]: a b\n",
    "a\n[r]:x\n",
    "a\n[]: https://x.org\n",
    "a\n[a[b]: c\n",
    "a\n[a\\]b]: c\n",
    "a\n[r]: https://x.org\n[s]: https://y.org\n",
    "a\r\n[r]: https://x.org\r\nc\r\n",
    // Nothing in the line changes, not even its blank space.
    "a\n[r]: *x*\n",
    "a\n[r]: x \nc\n",
    "a\n [r]: https://x.org\n",
    "a\n    [r]: https://x.org\n",
    "a\n\t[r]: https://x.org\n",
    "> a\n> [r]: https://x.org\n",
    "- a\n  [r]: https://x.org\n",
    "> [r]: a b\n> c\n",
    // The parts of a definition on the lines below stay there.
    "a\n[r]:\nhttps://x.org\n",
    'a\n[r]: https://x.org\n"t"\n',
    // A lazy line of a block quote or list item.
    "> a\n[r]: https://x.org\n",
    "- a\n[r]: https://x.org\n",
    "- > a\n[r]: https://x.org\n",
    // The first line of a paragraph, where the parser reads no definition.
    "[r]: a b\nc\n",
    "[r]:\nc\n",
    "[r]: https://x.org\n[s]: a b\nc\n",
    // The line is not broken, nor is the line below joined to it.
    '[r]: https://x.org "a title with words enough to go past the width of eighty columns"\n',
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n[r]: https://x.org\nc\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  it.each([
    // The text around it is formatted; only the line stays on a line of its own.
    ["a *b*\n[r]: https://x.org\n", "a _b_\n[r]: https://x.org\n"],
    ["a\n[r]: https://x.org\nc *d*\n", "a\n[r]: https://x.org\nc _d_\n"],
    ["*a*\n[r]: x\n*b*\n", "_a_\n[r]: x\n_b_\n"],
    ["[r]: a b\nc *d*\n", "[r]: a b\nc _d_\n"],
    // A backslash or other text before `[` or between `]` and `:` is text.
    ["a\n\\[r]: https://x.org\n", "a \\[r]: https://x.org\n"],
    ["a\n[r] : x\n", "a [r] : x\n"],
    ["a\n[[x]]: y\n", "a [[x]]: y\n"],
    ["a\n[r][s]: x\n", "a [r][s]: x\n"],
    ["- [r]: a b\n  c\n", "- [r]: a b c\n"],
    // Below a blank line, it is a definition, and the text below it a paragraph.
    ["a\n\n[r]: https://x.org\nc *d*\n", "a\n\n[r]: https://x.org\nc _d_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such lines in the other dialects", () => {
    expect(
      formatted("a\n[r]: https://x.org\nc *d*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a [r]: https://x.org c _d_\n");
  });
});

describe("underlined headings whose text Live Preview styles as a definition", () => {
  // Live Preview styles a heading's one line of text that starts at the first
  // column with `[`, a label, and `]:` as a link reference definition, and
  // reads the underline as text, where Reading view and the parser read a
  // heading (issue #397).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "[r]: a b\n===\n",
    "[r]: a b\n---\n",
    "[r]: a b\n=\n",
    "[]: a b\n===\n",
    "[a[b]: c\n===\n",
    "[r]: a b\r\n===\r\n",
    // Below a definition, where the heading's text starts on a later line.
    "[s]: https://y.org\n[r]: a b\n===\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // The text is formatted; only the heading keeps its underline.
    ["[r]: *a* b\n===\n", "[r]: _a_ b\n===\n"],
    ["[r]: a b  \n===\n", "[r]: a b\n===\n"],
    ["[r]: a b\\ \n===\n", "[r]: a b\\\n===\n"],
    // A backslash, or other text between `]` and `:`, makes Live Preview read
    // a heading.
    ["\\[r]: a b\n===\n", "# \\[r]: a b\n"],
    ["[r] : a b\n===\n", "# [r] : a b\n"],
    ["[r][s]: a b\n===\n", "# [r][s]: a b\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such headings in the other dialects", () => {
    expect(
      formatted("[r]: a b\n===\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("# [r]: a b\n");
  });
});

describe("blocks that Obsidian reads into a fence that a list item leaves open", () => {
  // Reading view continues such a fence with the unindented lines directly
  // below its container, and Live Preview with every block up to a line that
  // would close it, where the parser opens a fence, so that the two pair the
  // fences after it otherwise (issue #390).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "- ```\nb *c*\n",
    "- ```\n  a\nb *c*\n",
    "1. a\n   ```\nb *c*\n",
    "- ~~~\nb *c*\n",
    "> ```\nb *c*\n",
    "- ```\nb *c* and some more words, enough for a line of more than eighty columns\n",
    // Live Preview reads on across blank lines and list items.
    "- ```\n  a\n\nb *c*\n",
    "- a\n  ```\nb *c*\n\n- d *e*\n",
    // Live Preview closes the fence where the parser opens one, and opens one
    // where the parser closes it.
    "- ```\nb *c*\n```\n\nd *e*\n```\n\nf *g*\n",
    "- ````\nb *c*\n```\n\nd *e*\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    ["- ```\n  a\n  ```\nb *c*\n", "- ```\n  a\n  ```\nb _c_\n"],
    ["a *b*\n\n- ```\nc\n", "a _b_\n\n- ```\nc\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such blocks in the other dialects", () => {
    expect(
      formatted("- ```\nb *c*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("- ```\nb _c_\n");
  });
});

describe("tables that Obsidian reads otherwise", () => {
  // Obsidian reads a table directly below paragraph text as more of the text,
  // a one-column table whose header line does not end with a pipe as text, and
  // a line without a pipe as the end of a table; Reading view reads a line
  // with a pipe above `- | -` as a table (issue #359).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a\n| x | y |\n| - | - |\n| 1 | 2 |\n",
    "a  \n| x | y |\n| - | - |\n",
    "| x |\n| - |\n{% y %}\n",
    "| x |\n| - |\n| 1 |\ny *z*\n",
    "| x | w |\n| - | - |\ny *z*\n\nv\n",
    "| x | w |\r\n| - | - |\r\n| 1 | 2 |\r\ny *z*\r\n",
    "x | y\n- | :-:\nw | z\n",
    "x | y\n- | -\n",
    "x\n--:\n",
    "x\n:-:\n",
    "| x\n| --\n",
    // Reading accepts trailing-only pipes, but Live Preview shows source text (#568).
    "x |\n-- |\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  it.each([
    // The text above is formatted; only the table stays as written.
    ["a *b*\n| x |\n| - |\n", "a _b_\n| x |\n| - |\n"],
    ["a\n\n| x | y |\n| - | - |\n", "a\n\n| x   | y   |\n| --- | --- |\n"],
    ["# h\n| x | y |\n| - | - |\n", "# h\n\n| x   | y   |\n| --- | --- |\n"],
    ["x | y\n-|-\nw | z\n", "| x   | y   |\n| --- | --- |\n| w   | z   |\n"],
    // The parser reads this as Obsidian does: text of the block quote.
    ["> a\n| x | y |\n| - | - |\n", "> a\n| x | y |\n| - | - |\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such tables in the other dialects", () => {
    expect(
      formatted("a\n| x | y |\n| - | - |\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a\n\n| x   | y   |\n| --- | --- |\n");
  });
});

describe("HTML blocks that Obsidian keeps inside a list item", () => {
  // Reading view keeps an HTML block directly below a list inside the list's
  // last item, where CommonMark ends the list, and so a list below the block
  // continues it with every item whose marker matches, and the blocks there
  // that start at the item's content are inside the item (issue #399).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "- a\n<div>\nb\n</div>\n\n* c\n",
    "* a\n<div>\nb\n</div>\n\n- c\n",
    "1) a\n<div>\nb\n</div>\n\n1. c\n",
    "1. a\n<div>\nb\n</div>\n\n1) c\n",
    "- a\n<!-- x -->\n\n* c\n",
    "- a\n<!-- x -->\n* c\n",
    "- a\n<pre>\nx\n</pre>\n\n* c\n",
    "- a\r\n<div>\r\n</div>\r\n\r\n* c\r\n",
    "> - a\n> <div>\n> b\n> </div>\n>\n> * c\n",
    "- a\n  - b\n<div>\n</div>\n\n* c\n",
    "- a\n  ```\n  x\n  ```\n<div>\n</div>\n\n* c\n",
    "- # a\n<div>\n</div>\n\n* c\n",
    "* a\n* b\n<div>\n</div>\n\n- c\n",
    "- a\n<div>\nb\n</div>\n\n* c\n* d\n",
    // The markers stay where a block follows that the item's spacing, which
    // sets the column from which Reading view reads blocks inside it, could
    // bring inside.
    "-   a\n<div>\n</div>\n\n   d\n",
    "*   a\n<div>\n</div>\n\n  * c\n",
    "-   a\n<div>\n</div>\n\n    d\n\n* c\n",
    // The blocks that start at the item's content keep their indentation and
    // markers, and so do the lists nested in the item, which one of them could
    // continue.
    "- a\n<div>\n</div>\n\n  * d\n\n* c\n",
    "- a\n<div>\n</div>\n\n   * d\n* c\n",
    "- a\n  * b\n<div>\n</div>\n\n  - d\n",
    "- a\n  *   b\n<div>\n</div>\n\n    d\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // The text is formatted; only the markers and indentation stay.
    ["- a\n<div>\nb\n</div>\n\n- c *d*\n", "- a\n<div>\nb\n</div>\n\n- c _d_\n"],
    ["- *a*\n<div>\n</div>\n\n* c\n", "- _a_\n<div>\n</div>\n\n* c\n"],
    ["- a\n<div>\nb\n</div>\n\n  d *e*\n\n* c\n", "- a\n<div>\nb\n</div>\n\n  d _e_\n\n* c\n"],
    // Nothing follows the HTML block, or a block that no spacing of the item
    // could bring inside it.
    ["* a\n<div>\n</div>\n", "- a\n<div>\n</div>\n"],
    ["* a\n<div>\n</div>\n\n1. c\n", "- a\n<div>\n</div>\n\n1. c\n"],
    ["*   a\n<div>\n</div>\n\n d\n", "- a\n<div>\n</div>\n\n d\n"],
    // A list of another kind is moved to the first column first, where no
    // spacing of the item reaches it.
    ["*   a\n<div>\n</div>\n\n  1. c\n", "- a\n<div>\n</div>\n\n1. c\n"],
    // An empty line between the list and the HTML block ends the list, and a
    // paragraph at the first column below the block does too.
    ["- a\n\n<div>\nb\n</div>\n\n* c\n", "- a\n\n<div>\nb\n</div>\n\n- c\n"],
    ["* a\n<div>\nb\n</div>\n\nd\n\n- c\n", "- a\n<div>\nb\n</div>\n\nd\n\n- c\n"],
    // A block quote or footnote definition does not keep the block.
    ["> a\n<div>\n</div>\n\n* c\n", "> a\n<div>\n</div>\n\n- c\n"],
    ["[^1]: a\n<div>\n</div>\n\n* c\n\nx[^1]\n", "[^1]: a\n<div>\n</div>\n\n- c\n\nx[^1]\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it.each(["- a\n<div>\n</div>\n\n* c\n", "- a\n<!-- x -->\n* c\n"])(
    "keeps %j without the blank lines that style/block-spacing adds",
    (source) => {
      const spaced: Config = { ...config, rules: { "style/block-spacing": "warn" } };
      expect(formatted(source, { config: spaced })).toBe(source);
      expect(formatted("- a\n\n<pre>\nx\n</pre>\n* c\n", { config: spaced })).toBe(
        "- a\n\n<pre>\nx\n</pre>\n\n- c\n",
      );
    },
  );
  it("formats such lists in the other dialects", () => {
    expect(
      formatted("- a\n<div>\nb\n</div>\n\n* c\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("- a\n\n<div>\nb\n</div>\n\n- c\n");
  });
});

it.each(["inline", "block", "document"] as const)(
  "protects the opening HTML item's marker from a plugin's %s edit (#399)",
  (phase) => {
    const source = "+ <div> a\nlazy\n\n+ b\n";
    const plugin: Plugin = {
      name: "probe",
      rules: {
        marker: {
          kind: "style",
          phase,
          description: "Change the first list marker",
          check: () => [
            { start: 0, message: "Change marker", edit: { start: 0, end: 1, text: "-" } },
          ],
        },
      },
    };
    const result = format(source, {
      config: { extends: [], dialect: "obsidian", rules: { "probe/marker": "warn" } },
      plugins: [plugin],
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics).toMatchObject([
      {
        rule: "probe/marker",
        severity: "warn",
        message: "Left as written to preserve Obsidian rendering: Change marker",
      },
    ]);
    expect(result.diagnostics[0]!.edit).toBeUndefined();
  },
);
