import { describe, expect, it } from "vitest";
import { createWorkspace, format, parse, semanticFingerprint } from "../../src/index.js";
import type { Config } from "../../src/index.js";
import { boundaryFixtures } from "../../scripts/obsidian/boundary-fixtures.mjs";
import { misreadLists } from "../../src/syntax/misread-lists.js";

const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
const config: Config = {
  extends: ["recommended", "obsidian"],
  rules: { "style/wrap": ["warn", { width: 30 }] },
};
function checked(source: string, settings = config) {
  const options = { config: settings, workspace };
  const result = format(source, options);
  expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  expect(semanticFingerprint(parse(result.output, "obsidian"))).toBe(
    semanticFingerprint(parse(source, "obsidian")),
  );
  expect(format(source, { config: { extends: [], dialect: "obsidian" }, workspace }).output).toBe(
    source,
  );
  return result.output;
}

/** Minimal regressions also exercised in the real Obsidian fixture suite. */
const boundaries = boundaryFixtures
  .filter(({ issue, preserve }) => preserve !== false && ![496, 497, 499, 508].includes(issue))
  .map(({ issue, source, name }) => [issue, source, name] as const);

describe("Obsidian boundaries read differently by its views", () => {
  it.each([
    [
      "independent footnote after physical blank",
      "Ref[^1].\n\n[^1]: note\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "Ref[^1].\n\n[^1]: note\n    <div> words\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "physical blank before indented HTML body",
      "text\n[^1]: note\n\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n\n    <div> words\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "physical blank before following table",
      "text\n[^1]: note\n    <div> words\n\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n    <div> words\n\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "multiple tables in one joined footnote",
      "text\n[^1]: note\n    # first\n    | __a__ |\n    | - |\n    | x |\n    # second\n    | __b__ |\n    | - |\n    | y |\n",
      "text\n[^1]: note\n    # first\n    | __a__ |\n    | - |\n    | x |\n    # second\n    | __b__ |\n    | - |\n    | y |\n",
    ],
    [
      "later blank ends earlier joined-footnote context",
      "text\n[^1]: note\n    # first\n    | __a__ |\n    | - |\n    | x |\n\n    # second\n| __b__ |\n| - |\n| y |\n",
      "text\n[^1]: note\n    # first\n    | __a__ |\n    | - |\n    | x |\n\n    # second\n| **b** |\n| ----- |\n| y     |\n",
    ],
    [
      "space-only separator ends joined-footnote context",
      "text\n[^1]: note\n \n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n \n    <div> words\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "tab-only separator continues joined-footnote context",
      "text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "adjacent joined footnote definitions",
      "text\n[^1]: first\n[^2]: note\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: first\n[^2]: note\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "nested joined footnote definitions",
      "text\n[^1]: first\n    [^2]: note\n        <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: first\n    [^2]: note\n        <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "same-line nested joined footnote definitions",
      "text\n[^1]: [^2]: note\n        <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: [^2]: note\n        <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "two separate joined-footnote table boundaries",
      "text\n[^1]: first\n    <div> words\n| __a__ |\n| - |\n| x |\n\nMore\n[^2]: second\n    # heading\n| __b__ |\n| - |\n| y |\n",
      "text\n[^1]: first\n    <div> words\n| __a__ |\n| - |\n| x |\n\nMore\n[^2]: second\n    # heading\n| __b__ |\n| - |\n| y |\n",
    ],
    [
      "two-column paragraph and left tab",
      "  text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "  text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "paragraph and first definition both indented 1",
      " text\n [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      " text\n [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "paragraph and first definition both indented 2",
      "  text\n  [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "  text\n  [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "paragraph and first definition both indented 3",
      "   text\n   [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "   text\n   [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "later joined definition dedents before tab",
      "  text\n  [^1]: first\n[^2]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "  text\n  [^1]: first\n[^2]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
  ])("retains the paragraph boundary with %s (#549)", (_name, source, expected) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + expected.replaceAll("\n", newline),
        );
  });
  it("retains both delimiter directions across an ordered continuation (#543)", () => {
    const source = ">1. first\n2) second\n";
    expect(
      checked(source, {
        ...config,
        rules: { ...config.rules, "style/ordered-list": ["warn", { delimiter: ")" }] },
      }),
    ).toBe(source);
  });
  it("continues safe inline formatting in the earlier structural list unit (#543)", () => {
    const source = ">1) *first*\n>2) *second*\n3) *third*\n\n*outside*\n";
    expect(checked(source)).toBe(">1) _first_\n>2) _second_\n3) *third*\n\n_outside_\n");
  });
  it.each([".", ")"])(
    "retains either list's ordered delimiter around a lazy heading paragraph with %s (#513)",
    (delimiter) => {
      const source = "1) # heading\nlazy *words*\n1. next\n";
      expect(
        checked(source, {
          ...config,
          rules: { ...config.rules, "style/ordered-list": ["warn", { delimiter }] },
        }),
      ).toBe(source);
    },
  );
  it("formats inline text in both retained list units around a lazy heading paragraph (#513)", () => {
    const source = "- # *heading*\nlazy *words*\n+ next *safe*\n";
    expect(checked(source)).toBe("- # _heading_\nlazy *words*\n+ next _safe_\n");
  });
  it("keeps a blank-separated following list formattable (#513)", () => {
    const source = "- # heading\nlazy *words*\n\n- next *safe*\n";
    expect(checked(source)).toBe("- # heading\nlazy *words*\n\n- next _safe_\n");
  });
  it.each([
    [
      "following heading",
      "- # heading\nlazy *words*\n# next\n",
      "- # heading\nlazy *words*\n\n# next\n",
    ],
    [
      "blank-separated paragraph",
      "- # heading\n\nlazy *words*\n- next\n",
      "- # heading\n\nlazy _words_\n\n- next\n",
    ],
    [
      "indented paragraph",
      "- # heading\n  lazy *words*\n- next\n",
      "- # heading\n  lazy _words_\n- next\n",
    ],
  ])("keeps the %s control formattable (#513)", (_name, source, expected) => {
    expect(checked(source)).toBe(expected);
  });
  it.each([
    [
      "physical blank after a root",
      "<div>\nx\n</div>\n\n> first\n>\n> *second*\n\n_____\n",
      "<div>\nx\n</div>\n\n> first\n>\n> _second_\n\n---\n",
    ],
    [
      "empty quote line after contained HTML",
      "> <div>\n> x\n> </div>\n>\n> *second*\n\nAfter *third*.\n",
      "> <div>\n> x\n> </div>\n>\n> _second_\n\nAfter _third_.\n",
    ],
    [
      "independent prose after a root",
      "<div></div>\n \n> a\n>\n> *b*\n\nAfter *c*.\n",
      "<div></div>\n \n> a\n>\n> *b*\n\nAfter _c_.\n",
    ],
    [
      "physical blank after literal empty quotes",
      "<div></div>\n \n>\n>\n\nAfter *c*.\n",
      "<div></div>\n \n>\n>\n\nAfter _c_.\n",
    ],
    [
      "physical blank before genuine empty quotes",
      "<div></div>\n\n>\n>\n>\n\nAfter *c*.\n",
      "<div></div>\n\n>\n\nAfter _c_.\n",
    ],
    [
      "closed fence holding a bare quote marker",
      "<div>\ntext\n</div>\n\t\n```js\nx\n>\n```\n\n*outside*\n",
      "<div>\ntext\n</div>\n\t\n```js\nx\n>\n```\n\n_outside_\n",
    ],
    [
      "closed fence holding nested quote markers",
      "<div>\ntext\n</div>\n\t\n```js\nx\n>>\n```\n\n*outside*\n",
      "<div>\ntext\n</div>\n\t\n```js\nx\n>>\n```\n\n_outside_\n",
    ],
  ])("resumes formatting after a %s (#546)", (_name, source, expected) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + expected.replaceAll("\n", newline),
        );
  });
  it.each([
    [
      "physical empty line before a fence",
      "<div>\n   \n-\n\n~~~\na\n\n~~~\ntext *x* and __y__\n",
      "<div>\n   \n-\n\n```\na\n\n```\ntext _x_ and **y**\n",
    ],
    [
      "physical empty line before a list marker",
      "<div>\n\n-\n~~~\na\n\n~~~\ntext *x* and __y__\n",
      "<div>\n\n-\n\n```\na\n\n```\ntext _x_ and **y**\n",
    ],
    [
      "fence body without an empty line",
      "<div>\n   \n-\n~~~\na\n~~~\n\ntext *x* and __y__\n",
      "<div>\n   \n-\n~~~\na\n~~~\n\ntext _x_ and **y**\n",
    ],
    [
      "fence body with a space-only line",
      "<div>\n   \n-\n~~~\na\n  \n~~~\n\ntext *x* and __y__\n",
      "<div>\n   \n-\n~~~\na\n  \n~~~\n\ntext _x_ and **y**\n",
    ],
  ])("keeps outside prose formattable with a %s (#548)", (_name, source, expected) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + expected.replaceAll("\n", newline),
        );
  });
  it("ignores a plugin paragraph without source positions", () => {
    const document = parse("words\n", "obsidian");
    delete document.tree.children[0]!.position;
    expect(() => misreadLists(document)).not.toThrow();
  });
  it("retains prior protection for a quote-opening ordered item (#524)", () => {
    const source = "> text ```\n\n> 1) *first*\n>    - *second*\n";
    expect(checked(source)).toContain("> 1) *first*\n");
  });
  it.each(boundaries)("preserves the source for #%i", (_issue, source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(input);
      }
  });

  it("keeps nested footnote blocks at their original indentation (#496)", () => {
    const source = "[^1]: *note*\n    * anchor *basket ember* with enough words to wrap\n";
    expect(checked(source)).toBe(source.replace("*note*", "_note_"));
  });

  it("keeps a quoted continuation block in a footnote (#496)", () => {
    const source = boundaryFixtures.find(
      ({ name }) => name === "quoted continuation block in a footnote",
    )!.source;
    expect(checked(source)).toBe(source);
  });

  it.each(["*", "_"])("honors escaped and intraword %s opener controls (#506)", (marker) => {
    const source = `text a${marker}b\\\n> + one *two*\n`;
    if (marker === "*") expect(checked(source)).toBe(source);
    else expect(checked(source)).toContain("_two_");
    expect(checked(`text \\${marker}b\\\n> + one *two*\n`)).toContain("_two_");
    expect(checked(`text \\\\${marker}b\\\n> + one *two*\n`)).not.toContain("> -");
  });

  it.each(boundaryFixtures.filter(({ preserve }) => preserve === false))(
    "continues formatting the host-verified control $name",
    ({ source }) => expect(checked(source)).not.toBe(source),
  );

  it("keeps callout lists starting after their title together (#499)", () => {
    const source = "> [!note] title\n> 9) first\n>\n> 10) second *word*\n";
    expect(checked(source)).toBe(source.replace("*word*", "_word_"));
  });

  it.each(["*", "_", "**", "__"])(
    "preserves unmatched %s across a quoted boundary (#506)",
    (marker) => {
      const source = `text ${marker}\\\n> + one *two* **three**\n`;
      expect(checked(source)).toBe(source);
    },
  );

  it.each(["#", "## x", "> x", "- x", "2) x"])(
    "retains the table row beginning %j (#505)",
    (start) => {
      const source = `a | b | c\n-- | -- | --\n${start} | *word* | c\n`;
      expect(checked(source)).toContain(`\n${start} | *word* | c\n`);
      expect(checked(source)).not.toContain(`\n\n${start}`);
    },
  );

  it("retains later source when task-fence pairings disagree (#488)", () => {
    const source = "- [x] ``` x\n- *inside*\n\nStill *inside*.\n```\n\nLater *outside*.\n";
    expect(checked(source)).toBe(source);
  });

  it.each([
    "text *\\\n\n> + *words*\n",
    "text \\*\\\n> + *words*\n",
    "text `*\\`\n> + *words*\n",
    "text *closed*\n> + *words*\n",
  ])("still formats quoted text without carried emphasis: %j", (source) => {
    expect(checked(source)).toContain("_words_");
  });

  it("keeps ordinary footnote and table boundaries formattable", () => {
    expect(checked("[^1]: note\n\n2) *words*\n")).toContain("2. _words_");
    expect(checked("[^1]: note\n1) *words*\n")).toContain("1. _words_");
    expect(checked("a\n===\n| b | c |\n| - | - |\n")).toContain("| --- | --- |");
  });

  it("formats an independent paragraph after each protected region", () => {
    for (const [, source] of boundaries.filter(
      // These inline HTML openers already carry Live Preview's HTML through EOF (#435).
      ([issue, , name]) =>
        ![488, 494, 519, 524, 529, 548].includes(issue) &&
        ![
          "joined footnote ending in span paragraph",
          "ordinary paragraph with indented HTML",
        ].includes(name),
    ))
      expect(checked(`${source}\nLater *outside*.\n`)).toContain("Later _outside_.");
  });

  it("does not apply Obsidian protections to GitHub", () => {
    expect(
      format("text *\\\n> + *words*\n", { config: { extends: ["recommended", "github"] } }).output,
    ).toContain("> - _words_");
  });
});
