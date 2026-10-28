import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { createWorkspace, dialects, format, lint, presets } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

/**
 * The findings of one problem rule, which formatting reports too without
 * changing the document, and which no other rule makes.
 */
function check(
  source: string,
  rule: string,
  dialect: Dialect = "github",
  options?: Record<string, unknown>,
) {
  const config: Config = {
    extends: [],
    dialect,
    rules: { [rule]: options ? ["warn", options] : "warn" },
  };
  const diagnostics = lint(source, { config });
  const result = format(source, { config });
  expect(result.output).toBe(source);
  expect(result.diagnostics).toEqual(diagnostics);
  expect(diagnostics.every((item) => item.edit === undefined)).toBe(true);
  expect(lint(source, { config: { extends: [], dialect } })).toEqual([]);
  return diagnostics;
}
/** The source that each finding covers. */
const spans = (source: string, findings: { start: number; end?: number }[]) =>
  findings.map((item) => source.slice(item.start, item.end));

describe("links/undefined-reference", () => {
  const rule = "links/undefined-reference";
  const undefinedReference = (label: string) =>
    `Reference [${label}] has no definition and shows as plain text.`;
  it.each([
    ["See the [guide][setup].\n", "[guide][setup]", "setup"],
    ["See [setup][].\n", "[setup][]", "setup"],
    ["See [*the guide*][setup].\n", "[*the guide*][setup]", "setup"],
    ["See [`npm test`][tests].\n", "[`npm test`][tests]", "tests"],
    ["[![Build](badge.svg)][ci]\n", "[![Build](badge.svg)][ci]", "ci"],
    ["![Chart][chart]\n", "[Chart][chart]", "chart"],
    ["See [a [nested](x.md) link][label].\n", "[a [nested](x.md) link][label]", "label"],
    ["See [a\\]b][].\n", "[a\\]b][]", "a\\]b"],
    // A definition of another label, and a footnote, do not define a link label.
    ["[text][other]\n\n[othe]: x.md\n", "[text][other]", "other"],
    ["[text][^note]\n\n[^nope]: Text.\n", "[text][^note]", "^note"],
    // Labels continue on the next line of a block quote or list item.
    ["> See [the\n> guide][].\n", "[the\n> guide][]", "the guide"],
    ["- See [the\n  guide][].\n", "[the\n  guide][]", "the guide"],
    ["| [a][b] |\n| --- |\n", "[a][b]", "b"],
    ["## [a][b]\n", "[a][b]", "b"],
    ["Text <kbd>[a][b]</kbd>\n", "[a][b]", "b"],
    ["Text ~~[a][b]~~\n", "[a][b]", "b"],
    ["Text **[c][]**\n", "[c][]", "c"],
  ])("reports %j", (source, span, label) => {
    const findings = check(source, rule);
    expect(spans(source, findings)).toEqual([span]);
    expect(findings[0]?.message).toBe(undefinedReference(label));
  });
  it("reports references in what CommonMark reads as text", () => {
    expect(spans("$[a][b]$\n", check("$[a][b]$\n", rule, "commonmark"))).toEqual(["[a][b]"]);
  });
  it("reports both references of a sentence, and an undefined footnote", () => {
    const source = "One [a][b], two [c][], and a note.[^1]\n\n[a]: a.md\n";
    expect(check(source, rule).map((item) => item.message)).toEqual([
      undefinedReference("b"),
      undefinedReference("c"),
      "Footnote [^1] has no definition and shows as plain text.",
    ]);
  });
  it.each([
    // Labels match whatever their case and blank space.
    "See [the guide][Set  Up].\n\n[set up]: setup.md\n",
    "See [Set\nup][].\n\n[SET UP]: setup.md\n",
    "Footnote[^Note].\n\n[^note]: Text.\n",
    // A shortcut reference is not reported: brackets in prose are usually just brackets.
    "Press [Enter] to continue.\n",
    "An [inline](setup.md) link, an ![image](a.png), and <https://example.com/[a][b]>.\n",
    "https://example.com/[a][b] and www.example.com/[c][d]\n",
    "`[a][b]` and ``[c][]``\n",
    "\\[a][b] and [c\\][d] and \\[e]\\[f]\n",
    "<span title='[a][b]'>text</span> <!-- [c][d] -->\n",
    "<div>\n[a][b]\n</div>\n",
    "```md\n[a][b]\n```\n\n    [c][d]\n",
    "---\nsummary: '[a][b]'\n---\n",
    "$[a][b]$ and $$[c][]$$\n",
    "$$\n[a][b]\n$$\n",
    // Indexes in prose.
    "matrix[i][j] and x[0][1][2] and f(x)[0][]\n",
    // A link label cannot be blank, contain a bracket, or hold 1000 characters.
    "[a][ ] and [a][b[c]] and [a [b]][]\n",
    `[a][${"x".repeat(1000)}]\n`,
    // A link after the text is not its label.
    "[a][b](b.md)\n",
    "[^a b] has blank space, so it is not a footnote reference.\n",
    "[Inline footnote]^[in Obsidian] [link](#)\n",
  ])("accepts %j", (source) => {
    expect(check(source, rule)).toEqual([]);
  });
  it("reads footnotes only in dialects that have them", () => {
    // In CommonMark, `[^2]: link.md` is a link definition, and `[^1]` a shortcut reference.
    const source = "Text[^1] and [^2][].\n\n[^2]: link.md\n";
    expect(check(source, rule, "commonmark")).toEqual([]);
    for (const dialect of ["github", "forgejo", "gitea", "obsidian"] as const)
      expect(check(source, rule, dialect).map((item) => item.message)).toEqual([
        "Footnote [^1] has no definition and shows as plain text.",
      ]);
  });
  it("leaves Obsidian wikilinks, comments, and highlights alone", () => {
    expect(check("[[Note]] [[a]][b] ![[c.png]] %%[d][e]%% ==[f][g]==\n", rule, "obsidian")).toEqual(
      [],
    );
    expect(check("[[Note]] [a][b]\n", rule, "obsidian")).toHaveLength(1);
  });
  it("leaves Forgejo and Gitea math alone", () => {
    const source = "Math \\( [i][j] \\) and\n\n\\[\n[k][l]\n\\]\n\nnot math [m][n].\n";
    for (const dialect of ["forgejo", "gitea"] as const)
      expect(spans(source, check(source, rule, dialect))).toEqual(["[m][n]"]);
    expect(spans(source, check(source, rule, "github"))).toEqual(["[i][j]", "[k][l]", "[m][n]"]);
  });
  it("respects suppression comments", () => {
    const source = [
      "<!-- mdrefine-disable-next-line links/undefined-reference -->",
      "[a][b]",
      "",
      "[c][d]",
      "",
    ].join("\n");
    expect(check(source, rule).map((item) => item.line)).toEqual([4]);
  });
  it("finds labels across any line ending", () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = `> See [the${newline}> guide][].${newline}`;
      expect(check(source, rule)[0]?.message).toBe(undefinedReference("the guide"));
    }
  });
  it("reports a chain of brackets once", () => {
    expect(spans("[a][b][c][d]\n", check("[a][b][c][d]\n", rule))).toEqual(["[a][b]"]);
    expect(check(`${"[a]".repeat(5000)}\n`, rule)).toHaveLength(1);
  });
});

describe("links/undefined-reference options", () => {
  const rule = "links/undefined-reference";
  const shortcuts = { shortcutSyntax: true };
  const undefinedReference = (label: string) =>
    `Reference [${label}] has no definition and shows as plain text.`;
  const renders = (source: string) => [
    new HtmlRenderer().render(new Parser().parse(source)),
    new MarkdownIt().render(source),
  ];
  it("shows an undefined shortcut reference as its brackets", () => {
    const text = "<p>Press [Enter] to continue.</p>\n";
    expect(renders("Press [Enter] to continue.\n")).toEqual([text, text]);
    const link = '<p>Press <a href="keys.md">Enter</a> to continue.</p>\n';
    expect(renders("Press [Enter] to continue.\n\n[enter]: keys.md\n")).toEqual([link, link]);
  });
  it.each([
    ["Press [Enter] to continue.\n", "[Enter]", "Enter"],
    ["## Press [Enter]\n", "[Enter]", "Enter"],
    ["| [Enter] |\n| --- |\n", "[Enter]", "Enter"],
    ["Text **[bold]** here.\n", "[bold]", "bold"],
    ["Text ~~[gone]~~ here.\n", "[gone]", "gone"],
    // A failed inline link leaves a shortcut reference.
    ["See [a](b c) here.\n", "[a]", "a"],
    // Brackets inside a label are no label, but inner brackets can be one.
    ["[a [b] c]\n", "[b]", "b"],
    ["> Quoted [the\n> guide].\n", "[the\n> guide]", "the guide"],
    // Only a single character that starts a list item is a task mark.
    ["- [todo] item\n", "[todo]", "todo"],
    ["- Item [x] here\n", "[x]", "x"],
    // Outside Obsidian, a task mark is only `[ ]`, `[x]` or `[X]`.
    ["- [a] item\n", "[a]", "a"],
    ["- [/] in progress\n", "[/]", "/"],
    // A marker only starts a block quote.
    ["Text [!NOTE] here.\n", "[!NOTE]", "!NOTE"],
    // Brackets after a URL's blank space or `<` are no longer in it.
    ["See https://example.com/ [a]\n", "[a]", "a"],
    ["See https://example.com/<[a]\n", "[a]", "a"],
    // GFM links `www.` only after blank space or one of `(*_[]~`.
    ["See 'www.example.com/[a]'.\n", "[a]", "a"],
    ["See xwww.example.com/[a]\n", "[a]", "a"],
  ])("reports a shortcut when asked: %j", (source, span, label) => {
    expect(check(source, rule)).toEqual([]);
    const findings = check(source, rule, "github", shortcuts);
    expect(spans(source, findings)).toEqual([span]);
    expect(findings[0]?.message).toBe(undefinedReference(label));
  });
  it("reads shortcut references across any line ending", () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = `> See [the${newline}> guide] here.${newline}`;
      expect(check(source, rule, "github", shortcuts).map((item) => item.message)).toEqual([
        undefinedReference("the guide"),
      ]);
    }
  });
  it("reports each kind of reference once", () => {
    const source = "One [a][b], two [c][], three [d], and a note.[^1]\n";
    expect(spans(source, check(source, rule, "github", shortcuts))).toEqual([
      "[a][b]",
      "[c][]",
      "[d]",
      "[^1]",
    ]);
    expect(spans("[a][b][c][d]\n", check("[a][b][c][d]\n", rule, "github", shortcuts))).toEqual([
      "[a][b]",
    ]);
    expect(check(`${"[a]".repeat(5000)}\n`, rule, "github", shortcuts)).toHaveLength(1);
    // A defined label makes a link, whose text is not read.
    expect(check("[a] and [b][a]\n\n[a]: a.md\n", rule, "github", shortcuts)).toEqual([]);
  });
  it("reads `[^label]` as a shortcut reference in CommonMark", () => {
    const source = "Text [^1].\n";
    expect(check(source, rule, "commonmark")).toEqual([]);
    expect(check(source, rule, "commonmark", shortcuts)[0]?.message).toBe(undefinedReference("^1"));
    expect(check(source, rule, "github", shortcuts)[0]?.message).toBe(
      "Footnote [^1] has no definition and shows as plain text.",
    );
  });
  it.each([
    // Indexes, code, math, HTML, links, and escaped brackets.
    ["matrix[i] and f(x)[0] and a_[b] and list][c]\n", "github"],
    ["`[a]` and $[b]$ and $$[c]$$\n", "github"],
    ["<span title='[a]'>text</span> <!-- [b] --> <code>[c]</code> <kbd>[d]</kbd>\n", "github"],
    ["Text <b>[a] <i>[b]</i> [c]</b> and <span>[d]\n", "github"],
    ["<div>\n[a]\n</div>\n", "github"],
    ["An [inline](setup.md) link, an ![image](a.png), and <https://example.com/[a]>.\n", "github"],
    ["\\[a] and [b\\] and \\[c\\]\n", "github"],
    ["```md\n[a]\n```\n\n    [b]\n", "github"],
    // A label cannot be blank or hold 1000 characters.
    ["[ ] and [] and [\t]\n", "github"],
    [`[${"x".repeat(1000)}]\n`, "github"],
    // URLs written as text, which GFM links and CommonMark shows as written.
    ["https://example.com/[a] and www.example.com/path/[b]\n", "github"],
    ["https://example.com/[a] and www.example.com/path/[b]\n", "commonmark"],
    // A URL starts after punctuation as autolink literals start, such as in parentheses or quotes.
    ["See (https://example.com/[a]) and (www.example.com/[b]).\n", "commonmark"],
    ["See \"https://example.com/[a]\" and 'ftp://example.com/[b]'.\n", "commonmark"],
    ["See *www.example.com/[a]* and x.https://example.com/[b]\n", "commonmark"],
    ["See (https://example.com/[a]).\n", "obsidian"],
    // Task marks, where the parser reads none.
    ["- [x] done\n- [X] done\n1. [ ] todo\n", "commonmark"],
    ["- [x]\n- [X] done\n", "github"],
    ["- [/] in progress\n- [?] question\n- [>] later\n", "obsidian"],
    // Alert and callout markers.
    ["> [!NOTE]\n> Text.\n", "github"],
    ["> [!NOTE]\n> Text.\n", "forgejo"],
    ["> [!note]\n> Text.\n", "commonmark"],
    ["> [!tip]- Folded title\n> Body.\n", "obsidian"],
    // Obsidian's inline footnotes and wikilinks, Forgejo's and Gitea's shortlinks.
    ["Text^[an inline note] and [[Note]].\n", "obsidian"],
    ["See [[Page]] and [[Page|label]].\n", "forgejo"],
    ["See [[Page]] and [[Page|label]].\n", "gitea"],
    ["[[toc]]\n", "vitepress"],
  ] as const)("does not read %j in %s as a shortcut", (source, dialect) => {
    expect(check(source, rule, dialect, shortcuts)).toEqual([]);
  });
  it("reads `/>` as closing only void elements, except in VitePress's Vue templates", () => {
    // A browser ignores the slash, so `[label]` is inside the span.
    const source = "Text <br/>[before] and <span/>[label]\n";
    expect(spans(source, check(source, rule, "github", shortcuts))).toEqual(["[before]"]);
    expect(spans(source, check(source, rule, "commonmark", shortcuts))).toEqual(["[before]"]);
    expect(spans(source, check(source, rule, "vitepress", shortcuts))).toEqual([
      "[before]",
      "[label]",
    ]);
  });
  it("reads double brackets outside Forgejo and Gitea", () => {
    const source = "See [[Page]].\n";
    expect(spans(source, check(source, rule, "github", shortcuts))).toEqual(["[Page]"]);
    expect(spans("Text^[note].\n", check("Text^[note].\n", rule, "github", shortcuts))).toEqual([
      "[note]",
    ]);
  });
  it("ignores the configured labels", () => {
    const source = "See [guide][Set  Up], [x][], [TODO], and a note.[^Draft]\n";
    expect(check(source, rule, "github", shortcuts)).toHaveLength(4);
    expect(
      check(source, rule, "github", {
        ...shortcuts,
        ignoredLabels: ["set up", "X", "todo", "^draft"],
      }),
    ).toEqual([]);
    // A footnote's label is written with its `^`.
    expect(
      check(source, rule, "github", { ignoredLabels: ["set up", "x", "draft"] }).map(
        (item) => item.message,
      ),
    ).toEqual(["Footnote [^Draft] has no definition and shows as plain text."]);
    // No label is ignored by default, whatever its kind.
    expect(spans("[a][x]\n", check("[a][x]\n", rule))).toEqual(["[a][x]"]);
  });
  it("rejects invalid options", () => {
    for (const options of [
      { shortcutSyntax: "yes" },
      { ignoredLabels: "x" },
      { ignoredLabels: [""] },
      { ignoredLabels: [" "] },
      { ignored_labels: ["x"] },
      { shortcut_syntax: true },
    ])
      expect(() =>
        lint("", { config: { extends: [], rules: { [rule]: ["warn", options] } } }),
      ).toThrow(`Invalid options for ${rule}`);
  });
});

describe("links/unused-definition", () => {
  const rule = "links/unused-definition";
  it.each([
    ["Text.\n\n[guide]: guide.md\n", "Definition [guide] is not used by any reference."],
    [
      "[Guide][]\n\n[guide]: a.md\n[GUIDE]: b.md\n",
      "Definition [GUIDE] repeats an earlier one, which references use instead.",
    ],
    ["Text.\n\n> [quoted]: a.md\n", "Definition [quoted] is not used by any reference."],
    [
      "Text.\n\n[^note]: Unused.\n",
      "Footnote [^note] is not referenced, and GitHub does not show it.",
    ],
    [
      "Text[^1].\n\n[^1]: One.\n\n[^1]: Again.\n",
      "Footnote [^1] repeats an earlier one, which references use instead.",
    ],
  ])("reports %j", (source, message) => {
    const findings = check(source, rule);
    expect(findings.map((item) => item.message)).toEqual([message]);
    expect(source.slice(findings[0]!.start)).toMatch(/^\[/);
  });
  it.each([
    "[guide][Guide]\n\n[guide]: guide.md\n",
    "[guide][]\n\n[guide]: guide.md\n",
    // A shortcut reference uses the definition too.
    "[guide]\n\n[guide]: guide.md\n",
    "![chart][Chart]\n\n[chart]: chart.png\n",
    "Text[^1].\n\n[^1]: Note.\n",
    "> [guide]\n\n- [guide]: guide.md\n",
  ])("accepts %j", (source) => {
    expect(check(source, rule)).toEqual([]);
  });
  // markdownlint reported these definitions as unused (issues 1734, 571 and 691 of
  // DavidAnson/markdownlint, and 2178 for `[foo]` in raw HTML, which the renderers link).
  it.each(dialects)("accepts the definitions that references use, in %s", (dialect) => {
    for (const source of [
      "$n million [^12]. $m million.\n\n[^12]: Note.\n",
      "<code>Object.create(<var>proxy</var>)[foo]</code>\n\n[foo]: foo.md\n",
      "[![Binder]](test)\n\n[Binder]: badge.svg\n",
      "[![GitHub][icon]](https://example.com/)\n\n[icon]: icon.svg\n",
    ])
      expect(check(source, rule, dialect), source).toEqual([]);
  });
  it("reports a repeated definition even where it matches the first", () => {
    // Renderers use the first; the second is never used, unlike a request to allow it
    // (issue 2043 of DavidAnson/markdownlint).
    const source = "- By [@user].\n\n[@user]: user.md\n\n- By [@user].\n\n[@user]: user.md\n";
    expect(check(source, rule).map((item) => item.line)).toEqual([7]);
  });
  it("keeps link and footnote labels apart", () => {
    // A link label that starts with `^` is no footnote's label.
    expect(check("[^1]\n\n[ ^1]: a.md\n[^1]: Note.\n", rule).map((item) => item.line)).toEqual([3]);
  });
  it("names GitHub only in its own dialect", () => {
    expect(check("Text.\n\n[^note]: Unused.\n", rule, "obsidian")[0]?.message).toBe(
      "Footnote [^note] is not referenced.",
    );
    // CommonMark has no footnotes: `[^1]: x` is a link definition, used by `[^1]`.
    expect(check("[^1]\n\n[^1]: one.md\n", rule, "commonmark")).toEqual([]);
  });
});

describe("links/empty", () => {
  const rule = "links/empty";
  it.each([
    ["[guide]()\n", "Link destination is empty."],
    ["[guide](<>)\n", "Link destination is empty."],
    ["[guide](#)\n", "Link destination is only #, which only leads to the top of the page."],
    [
      '[guide](# "Title")\n',
      "Link destination is only #, which only leads to the top of the page.",
    ],
    ["![chart]()\n", "Image source is empty."],
    ["![chart](#)\n", "Image source is only #."],
    // A reference has its definition's destination, reported once.
    ["[a][x] and [b][x]\n\n[x]: #\n", "Destination of definition [x] is only #."],
    ["[a][x]\n\n[x]: <>\n", "Destination of definition [x] is empty."],
  ])("reports %j", (source, message) => {
    expect(check(source, rule).map((item) => item.message)).toEqual([message]);
  });
  it.each([
    "[guide](#setup)\n",
    "[home](/)\n",
    "<https://example.com>\n",
    "`[guide]()` and\n\n```md\n[guide](#)\n```\n",
    "[guide][]\n\n[guide]: ./guide.md\n",
  ])("accepts %j", (source) => {
    expect(check(source, rule)).toEqual([]);
  });
  it("leaves wikilinks alone", () => {
    expect(check("[[#]] and [[Note]]\n", rule, "obsidian")).toEqual([]);
  });
});

describe("links/descriptive-text", () => {
  const rule = "links/descriptive-text";
  const vague = (text: string) =>
    `Link text "${text}" does not say where the link leads; name its destination or purpose.`;
  /** The findings with options for the rule, which formatting reports too without changing the document. */
  const checkWith = (
    source: string,
    options: Record<string, unknown>,
    dialect: Dialect = "github",
  ) => {
    const config: Config = { extends: [], dialect, rules: { [rule]: ["warn", options] } };
    const diagnostics = lint(source, { config });
    expect(format(source, { config })).toMatchObject({ output: source, diagnostics });
    return diagnostics;
  };
  describe.each(["commonmark", "github", "forgejo", "gitea", "obsidian", "vitepress"] as const)(
    "in %s",
    (dialect) => {
      it.each([
        ["Read [here](guide.md).\n", "[here](guide.md)", "here"],
        ["[Click here](guide.md)\n", "[Click here](guide.md)", "Click here"],
        ["[CLICK HERE!](guide.md)\n", "[CLICK HERE!](guide.md)", "CLICK HERE!"],
        ["[click-here](guide.md)\n", "[click-here](guide.md)", "click-here"],
        ["[ *More* ](guide.md)\n", "[ *More* ](guide.md)", "More"],
        ["[`link`](guide.md)\n", "[`link`](guide.md)", "link"],
        ["[click\nhere](guide.md)\n", "[click\nhere](guide.md)", "click here"],
        ["[click\r\nhere](guide.md)\r\n", "[click\r\nhere](guide.md)", "click here"],
        // A title is the link's description, which screen readers do not list
        // links by, and appears only when a mouse hovers over the link.
        [
          '[here](guide.md "The installation guide")\n',
          '[here](guide.md "The installation guide")',
          "here",
        ],
        // An image's alternative text is the text of a link around it.
        ["[![More](more.png)](guide.md)\n", "[![More](more.png)](guide.md)", "More"],
        ["[here][guide]\n\n[guide]: guide.md\n", "[here][guide]", "here"],
        ["[here][]\n\n[here]: guide.md\n", "[here][]", "here"],
        ["[here]\n\n[here]: guide.md\n", "[here]", "here"],
        ["# Read [more](guide.md)\n", "[more](guide.md)", "more"],
      ])("reports %j", (source, span, text) => {
        const findings = checkWith(source, {}, dialect);
        expect(spans(source, findings)).toEqual([span]);
        expect(findings.map((item) => item.message)).toEqual([vague(text)]);
      });
      it.each([
        // The whole text is compared: text that says more describes the link.
        "[Click here to read the installation guide](guide.md)\n",
        "[Read more about pricing](pricing.md)\n",
        "[Link checker](checker.md)\n",
        "[Here be dragons](dragons.md)\n",
        "[Installation guide](guide.md)\n",
        // An autolink shows its destination.
        "<https://example.com/here>\n",
        "![here](here.png)\n",
        "[here]\n",
        '<a href="guide.md">here</a>\n',
        "`[here](guide.md)`\n",
        "[](guide.md)\n",
        "[→](guide.md)\n",
      ])("accepts %j", (source) => {
        expect(checkWith(source, {}, dialect)).toEqual([]);
      });
      it("uses the configured texts, in every script", () => {
        const source = "[ここ](a.md), [Weiterlesen](b.md), [here](c.md), [mehr…](d.md)\n";
        const findings = checkWith(
          source,
          { prohibitedTexts: ["ここ", "weiterlesen", "Mehr"] },
          dialect,
        );
        expect(spans(source, findings)).toEqual([
          "[ここ](a.md)",
          "[Weiterlesen](b.md)",
          "[mehr…](d.md)",
        ]);
        expect(checkWith(source, { prohibitedTexts: [] }, dialect)).toEqual([]);
      });
    },
  );
  it("reads literal autolinks as their destinations", () => {
    expect(check("See www.here.com and https://example.com/more.\n", rule)).toEqual([]);
  });
  it("checks the text that Obsidian shows for a wikilink, but not embeds", () => {
    const source = "[[Install|here]], [[here]], [[Install|the guide]], and ![[here]]\n";
    const findings = check(source, rule, "obsidian");
    expect(spans(source, findings)).toEqual(["[[Install|here]]", "[[here]]"]);
    expect(check(source, rule, "github")).toEqual([]);
  });
  it("checks links in Obsidian callout titles and GitHub alerts", () => {
    expect(
      spans(
        "> [!tip] See [here](a.md)\n> Body.\n",
        check("> [!tip] See [here](a.md)\n> Body.\n", rule, "obsidian"),
      ),
    ).toEqual(["[here](a.md)"]);
    expect(check("> [!NOTE]\n> See [more](a.md).\n", rule, "github")).toHaveLength(1);
  });
  it.each([
    { prohibitedTexts: "here" },
    { prohibitedTexts: [""] },
    { prohibitedTexts: ["→"] },
    { prohibitedTexts: ["..."] },
    { prohibitedTexts: [1] },
    { prohibited_texts: ["here"] },
  ])("rejects options %j", (options) => {
    expect(() =>
      lint("", { config: { extends: [], rules: { [rule]: ["warn", options] } } }),
    ).toThrow(`Invalid options for ${rule}`);
  });
});

describe("comment definitions in links/unused-definition and links/empty", () => {
  const rules = ["links/unused-definition", "links/empty"];
  const renders = (source: string) => [
    new HtmlRenderer().render(new Parser().parse(source)),
    new MarkdownIt().render(source),
  ];
  it("show nothing unless a reference uses their label", () => {
    expect(renders("Text.\n\n[//]: # (comment)\n")).toEqual(["<p>Text.</p>\n", "<p>Text.</p>\n"]);
    const link = '<p>See <a href="#" title="comment">//</a>.</p>\n';
    expect(renders("See [//].\n\n[//]: # (comment)\n")).toEqual([link, link]);
    // Escapes count as written: `[\/\/]` is another label.
    const text = "<p>See [//].</p>\n";
    expect(renders("See [\\/\\/].\n\n[//]: # (comment)\n")).toEqual([text, text]);
  });
  it.each(dialects)("are not reported by default in %s", (dialect) => {
    for (const comment of [
      "[//]: # (comment)",
      '[//]: # "comment"',
      "[//]: # 'comment'",
      "[//]: <> (comment)",
      "[//]: #",
      "> [//]: # (quoted)",
      "- [//]: # (in a list)",
    ])
      for (const newline of ["\n", "\r\n", "\r"]) {
        const source = ["Text.", "", comment, "", "[//]: # (another one)", ""].join(newline);
        for (const rule of rules) expect(check(source, rule, dialect), source).toEqual([]);
      }
  });
  it.each(dialects)("leave the idiom alone under recommended in %s", (dialect) => {
    const long = "A comment that is longer than the wrapping width of the preset. ".repeat(3);
    const source = `# Notes\n\nText.\n\n[//]: # (${long.trim()})\n[//]: <> (Another.)\n`;
    const process = {
      config: { extends: ["recommended"], dialect },
      path: "note.md",
      workspace: createWorkspace({ "note.md": source }),
    };
    expect(lint(source, process)).toEqual([]);
    expect(format(source, process)).toMatchObject({ output: source, changed: false });
  });
  it("report a comment label that a reference uses, which makes it a link", () => {
    const source = "See [//].\n\n[//]: # (one)\n[//]: # (two)\n";
    expect(check(source, "links/unused-definition").map((item) => item.message)).toEqual([
      "Definition [//] repeats an earlier one, which references use instead.",
    ]);
    expect(check(source, "links/empty").map((item) => item.line)).toEqual([3, 4]);
    expect(check("![//]\n\n[//]: <>\n", "links/empty").map((item) => item.message)).toEqual([
      "Destination of definition [//] is empty.",
    ]);
  });
  it.each(rules)("%s matches labels as the renderers do", (rule) => {
    const options = { ignoredDefinitions: ["Note  To\tSelf"] };
    const source = "Text.\n\n[note to self]: # (one)\n[NOTE\nTO SELF]: <> (two)\n";
    expect(check(source, rule, "github", options)).toEqual([]);
    expect(check(source, rule)).toHaveLength(2);
    const escaped = "Text.\n\n[\\/\\/]: # (comment)\n";
    expect(check(escaped, rule)).toHaveLength(1);
    expect(check(escaped, rule, "github", { ignoredDefinitions: ["\\/\\/"] })).toEqual([]);
  });
  it.each(rules)("%s takes its labels in place of the default", (rule) => {
    const source = "Text.\n\n[//]: # (one)\n[comment]: # (two)\n";
    expect(
      check(source, rule, "github", { ignoredDefinitions: ["comment"] }).map((item) => item.line),
    ).toEqual([3]);
    expect(check(source, rule, "github", { ignoredDefinitions: [] })).toHaveLength(2);
  });
  it("applies to link definitions, not footnotes", () => {
    const rule = "links/unused-definition";
    const options = { ignoredDefinitions: ["//", "^note"] };
    // A footnote shows its text, so an unreferenced one is reported whatever its label.
    expect(
      check("Text.\n\n[^//]: Shown.\n[^note]: Shown.\n", rule, "github", options),
    ).toHaveLength(2);
    // CommonMark has no footnotes: `[^note]: #` is a link definition there.
    const source = "Text.\n\n[^note]: # (comment)\n";
    for (const each of rules) {
      expect(check(source, each, "commonmark", options)).toEqual([]);
      expect(check(source, each, "commonmark")).toHaveLength(1);
    }
  });
  it("are configured for each rule on its own", () => {
    const source = "Text.\n\n[comment]: # (comment)\n";
    const config: Config = {
      extends: ["recommended"],
      rules: { "links/unused-definition": ["warn", { ignoredDefinitions: ["comment"] }] },
    };
    expect(lint(source, { config }).map((item) => item.rule)).toEqual(["links/empty"]);
  });
  it.each(rules)("%s rejects invalid labels", (rule) => {
    for (const options of [
      { ignoredDefinitions: "//" },
      { ignoredDefinitions: [""] },
      { ignoredDefinitions: [" \t"] },
      { ignoredDefinitions: [1] },
      { ignored_definitions: ["//"] },
    ])
      expect(() =>
        lint("", { config: { extends: [], rules: { [rule]: ["warn", options] } } }),
      ).toThrow(`Invalid options for ${rule}`);
  });
});

describe("link problem rules in presets", () => {
  it("are in recommended as warnings", () => {
    const recommended = presets.recommended!.rules!;
    for (const rule of ["links/undefined-reference", "links/unused-definition", "links/empty"])
      expect(recommended[rule], rule).toBe("warn");
  });
  it("leave descriptive link text out of every preset", () => {
    for (const preset of Object.values(presets))
      expect(preset.rules?.["links/descriptive-text"]).toBeUndefined();
  });
});
