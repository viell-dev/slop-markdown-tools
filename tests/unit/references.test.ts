import { describe, expect, it } from "vitest";
import { builtInRules, format, lint, parse, presets } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

/**
 * The findings of one problem rule, which formatting reports too without
 * changing the document, and which no other rule makes.
 */
function check(source: string, rule: string, dialect: Dialect = "github") {
  const config: Config = { extends: [], dialect, rules: { [rule]: "warn" } };
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
      "<!-- mdtools-disable-next-line links/undefined-reference -->",
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
  it("scans in time linear in the length of the document", () => {
    // Timed apart from parsing, which takes quadratic time on some runs of brackets.
    const { check: scan } = builtInRules[rule]!;
    const documents = [
      parse(`${"Text.\n\n".repeat(20000)}[a][b]\n`, "github"),
      parse(`${`[a][${"b".repeat(990)}] `.repeat(200)}\n`, "github"),
      parse(`${`[${"a ".repeat(400)}][] `.repeat(100)}\n`, "github"),
      parse(`${`[^${"x".repeat(990)}`.repeat(200)}\n`, "github"),
      // A math opener without a closer, many times over.
      parse(`${"\\( ".repeat(20000)}[a][b]\n\n${"Text.\n\n".repeat(20000)}\\)\n`, "forgejo"),
    ];
    const started = performance.now();
    const counts = documents.map((document) => scan({ document, options: {} }).length);
    expect(counts).toEqual([1, 200, 100, 0, 1]);
    // The scans take some 50 milliseconds; quadratic ones would take many seconds.
    expect(performance.now() - started).toBeLessThan(3000);
  }, 60_000);
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

describe("link problem rules in presets", () => {
  it("are in recommended as warnings", () => {
    const recommended = presets.recommended!.rules!;
    for (const rule of ["links/undefined-reference", "links/unused-definition", "links/empty"])
      expect(recommended[rule], rule).toBe("warn");
  });
});
