import { describe, expect, it } from "vitest";
import { format, lint, presets } from "../../src/index.js";
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
const dialects: Dialect[] = ["github", "commonmark", "forgejo", "gitea", "obsidian", "vitepress"];

describe("content/emphasis-spacing", () => {
  const rule = "content/emphasis-spacing";
  it.each([
    ["Here is some ** bold ** text.\n", "** bold **"],
    ["Here is some __ bold __ text.\n", "__ bold __"],
    ["Here is some *** strong emphasis *** text.\n", "*** strong emphasis ***"],
    ["Some **bold ** text.\n", "**bold **"],
    ["Some ** bold** text.\n", "** bold**"],
    ["Some *italic * text.\n", "*italic *"],
    ["Some * italic* text.\n", "* italic*"],
    ["Some _ italic_ text.\n", "_ italic_"],
    ["Some __bold __ text.\n", "__bold __"],
    ["** Starts the line **\n", "** Starts the line **"],
    ['A "** quoted **" word.\n', "** quoted **"],
    ["A (** bracketed **) word.\n", "** bracketed **"],
    ["See ** `code` ** here.\n", "** `code` **"],
    ["See ** [a link](https://example.com) ** here.\n", "** [a link](https://example.com) **"],
    ["[** link text **](https://example.com)\n", "** link text **"],
    ["Press ** A ** now.\n", "** A **"],
  ])("reports %j in every dialect", (source, span) => {
    for (const dialect of dialects) {
      const findings = check(source, rule, dialect);
      expect(spans(source, findings)[0]).toBe(span);
    }
  });
  it("reports emphasis in headings, quotes, list items, and table cells", () => {
    const source = [
      "# A ** strong ** heading",
      "",
      "> A ** quoted ** line",
      "",
      "- An ** item **",
      "- Another *item *",
      "",
      "| Name ** a ** | b |",
      "| ------------ | - |",
      "| __ c__       | d |",
      "",
    ].join("\n");
    expect(spans(source, check(source, rule))).toEqual([
      "** strong **",
      "** quoted **",
      "** item **",
      "*item *",
      "** a **",
      "__ c__",
    ]);
  });
  it("names the markers and what they would make", () => {
    const source = "Some ** bold ** text, * italic* text, and *** both *** here.\n";
    expect(check(source, rule).map((item) => item.message)).toEqual([
      'Spaces just inside the "**" markers keep them from making strong text, so they show as text; remove the spaces if the text should be strong.',
      'Spaces just inside the "*" markers keep them from making emphasis, so they show as text; remove the spaces if the text should be emphasized.',
      'Spaces just inside the "***" markers keep them from making strong emphasis, so they show as text; remove the spaces if the text should be strong and emphasized.',
    ]);
  });
  it("reports each pair once, pairing the markers in order", () => {
    const source = "One ** two ** three ** four ** five ** six.\n";
    expect(spans(source, check(source, rule))).toEqual(["** two **", "** four **"]);
  });
  it.each(["\n", "\r\n"])("locates findings with %j line endings", (ending) => {
    const source = ["First line.", "Some ** bold ** text.", "Another * italic* one."].join(ending);
    const findings = check(source + ending, rule);
    expect(findings.map((item) => [item.line, item.column])).toEqual([
      [2, 6],
      [3, 9],
    ]);
  });
  it.each([
    // A single marker with spaces on both sides at both ends: how arithmetic,
    // wildcards, and asterisks that stand for themselves are written.
    "Here is some * italic * text.\n",
    "Here is some _ italic _ text.\n",
    "a * b * c\n",
    "2 * 3 * 4\n",
    "Fill in: _ name _ and _ date _\n",
    // Arithmetic whose operands are numbers or single letters.
    "a ** b ** c\n",
    "2 ** 3 ** 4\n",
    "2 *3 * 4\n",
    "(a ** b ** c) and x ** y + z ** w\n",
    // LaTeX subscripts, in math and as text.
    "$x_ i + y _j$ and $$a_ 1 + b _2$$\n",
    "x_i + y_j and x_ i + y _j\n",
    // Asterisks and underscores inside a word.
    "a* b *c and foo** bar **baz\n",
    "un*frigging *believable\n",
    "my_var _ other_var _ and snake_ case _name\n",
    // Emoji codes.
    ":white_check_mark: done, :heavy_ check_mark: and :x_ y:\n",
    // Inline HTML elements, whose content is code or keys to readers.
    "<code>** a **</code> and <kbd>* b*</kbd> and <code>a_ b _c</code>\n",
    // List markers.
    "* item *x*\n* other *\n",
    "- * nested *\n",
    // JSX comments.
    "{/* comment */} and {/*comment */}\n",
    // Code, autolinks, link destinations, HTML, and escapes.
    "`** a **` and ``__ b __``\n",
    "<https://example.com/**_a_**> and https://example.com/a_b_c\n",
    "[a](<** x **>) and [b](u '** y **')\n",
    '<span title="** x **">text</span>\n',
    "<div>\n** a **\n</div>\n",
    "\\** a \\** and \\_ b _\n",
    // Already emphasis, or without spaces inside.
    "**bold** and *italic* and __b__\n",
    // Nothing but punctuation or marker characters inside.
    "** -- ** and __ __ __\n",
    // A line ending between the markers.
    "Some ** bold\ntext ** here.\n",
    // Markers of two kinds that interleave, or text that holds a run of the
    // marker as long, such as one the parser paired: which markers belong
    // together is unknown.
    "Some ** a _b ** c _ text.\n",
    'A "** quoted **" word, (** bracketed **).\n',
    "Some *a ** b * text.\n",
    // Runs of four or more.
    "**** a ****\n",
  ])("leaves %j alone", (source) => {
    expect(check(source, rule)).toEqual([]);
  });
  it("reports only markers that make emphasis once the spaces are gone", () => {
    // The markers pass every test of the text but cannot pair across the
    // link's brackets, so the parser keeps them as text without the spaces.
    expect(check("[** a](https://example.com) **\n", rule)).toEqual([]);
    expect(check("A ** [a link](https://example.com) ** b\n", rule)).toHaveLength(1);
  });
  it("reads a block's references with their definitions", () => {
    const source =
      "See ** [the guide] ** here and ** [^1] ** there.\n\n[the guide]: guide.md\n\n[^1]: Note.\n";
    expect(spans(source, check(source, rule))).toEqual(["** [the guide] **", "** [^1] **"]);
    const nested = "> See ** [the guide] ** here.\n>\n> [the guide]: guide.md\n";
    expect(spans(nested, check(nested, rule))).toEqual(["** [the guide] **"]);
    // A definition in another block: the whole document is read again.
    const elsewhere =
      "See ** [the guide] ** and ** [x** y] **.\n\n> [the guide]: guide.md\n>\n> [x** y]: x.md\n";
    expect(spans(elsewhere, check(elsewhere, rule))).toEqual(["** [the guide] **"]);
  });
  it("leaves dialect syntax alone", () => {
    expect(check("%% ** a ** %% and ==** b **== and [[** c **]]\n", rule, "obsidian")).toEqual([]);
    expect(check("Math \\( a ** b ** c \\) here.\n", rule, "forgejo")).toEqual([]);
    expect(check("Math \\( a ** b ** c \\) and ** d **.\n", rule, "forgejo")).toHaveLength(1);
    // Gitea does not read `_` as emphasis on a line with `_.py`.
    expect(check("Run _ main_.py now.\n", rule, "gitea")).toEqual([]);
    expect(check("Run _ main_ now.\n", rule, "gitea")).toHaveLength(1);
    expect(check("---\ntitle: ** a **\n---\n\nText.\n", rule)).toEqual([]);
    expect(check("::: tip\nSome ** bold ** text.\n:::\n", rule, "vitepress")).toHaveLength(1);
  });
  it("is in no preset", () => {
    for (const preset of Object.values(presets)) expect(preset.rules?.[rule]).toBeUndefined();
  });
});

describe("content/inline-code-spacing", () => {
  const rule = "content/inline-code-spacing";
  it.each([
    ["a `  code  ` b\n", "starts and ends"],
    ["a ` code` b\n", "starts"],
    ["a `code ` b\n", "ends"],
    ["a `   code    ` b\n", "starts and ends"],
    ["a ` \tcode ` b\n", "starts"],
    ["a `  ./run.sh  ` b\n", "ends"],
    ["a ` 2 + 2` b\n", "starts"],
    ["a `naïve ` b\n", "ends"],
    ["| ` a` | b |\n| --- | - |\n", "starts"],
  ])("reports %j in every dialect", (source, where) => {
    for (const dialect of dialects) {
      const findings = check(source, rule, dialect);
      expect(findings).toHaveLength(1);
      expect(spans(source, findings)[0]).toMatch(/^`[^]*`$/);
      expect(findings[0]?.message).toBe(
        `The code span ${where} with blank space that renderers show as part of the code, because they take off only one space at each end, and only when both ends have one; remove it unless the code needs it.`,
      );
    }
  });
  it.each([
    // One space at each end, which renderers take off.
    "a ` code ` b\n",
    "a `code` b and a`b`c\n",
    // Only blank space, which renderers keep.
    "a ` ` b and `   ` and `\t`\n",
    // The space that a backtick at an end of the code needs.
    "a `` `code `` b and `` code` `` and `` ` `` and ``` `` ```\n",
    "a `` `code`` b and ``code` `` c and ``  `code` `` d\n",
    // Blank space next to syntax that the code shows.
    "A list item starts with `- `, a definition with `: `, a quote with `> `.\n",
    "Highlights use `== ` and ` ==`, and `  - item` is indented.\n",
    // More than one space or a tab at one end only: indentation.
    "Below it, `    Text` is code, and `\tcode` starts with a tab.\n",
    // Line endings at both ends become spaces that renderers take off.
    "a `\ncode\n` b\n",
    // Backticks that are not a code span.
    "\\` a ` and <code> a </code>\n",
    "```\n` a`\n```\n",
    "    ` a`\n",
  ])("leaves %j alone", (source) => {
    expect(check(source, rule)).toEqual([]);
  });
  it("reports a line ending at an end, except where Obsidian ends the span at the line", () => {
    const source = "a `code\n` b\n";
    expect(spans(source, check(source, rule))).toEqual(["`code\n`"]);
    expect(check(source, rule, "obsidian")).toEqual([]);
  });
  it.each(["\n", "\r\n"])("locates findings with %j line endings", (ending) => {
    const source = ["Text.", "Run ` npm test` now."].join(ending) + ending;
    expect(check(source, rule).map((item) => [item.line, item.column])).toEqual([[2, 5]]);
  });
  it("is in no preset", () => {
    for (const preset of Object.values(presets)) expect(preset.rules?.[rule]).toBeUndefined();
  });
});

describe("links/text-spacing", () => {
  const rule = "links/text-spacing";
  it.each([
    ["[ text ](https://example.com)\n", "starts and ends"],
    ["See [ the guide](guide.md).\n", "starts"],
    ["See [the guide ](guide.md).\n", "ends"],
    ["See[ a ](guide.md) and the rest.\n", "starts and ends"],
    ["See [ the guide ][guide].\n\n[guide]: guide.md\n", "starts and ends"],
    ["See [ guide ][].\n\n[guide]: guide.md\n", "starts and ends"],
    ["See [ guide ].\n\n[guide]: guide.md\n", "starts and ends"],
    ["[\tTab](guide.md)\n", "starts"],
    ["[ ![Logo](logo.png) ](https://example.com)\n", "starts and ends"],
    ["See [the\nguide\n](guide.md).\n", "ends"],
  ])("reports %j in every dialect", (source, where) => {
    for (const dialect of dialects) {
      const findings = check(source, rule, dialect);
      expect(findings).toHaveLength(1);
      expect(spans(source, findings)[0]).toMatch(/^\[[^]*[\])]$/);
      expect(findings[0]?.message).toBe(
        `The link text ${where} with blank space, which renders as part of the link; move it outside the brackets.`,
      );
    }
  });
  it("never edits, so no words join", () => {
    // Taking the spaces out would join `See` to the link text.
    const source = "See[ a ](guide.md)then.\n";
    expect(spans(source, check(source, rule))).toEqual(["[ a ](guide.md)"]);
  });
  it.each([
    "[text](https://example.com) and [the guide][guide]\n\n[guide]: guide.md\n",
    // Images, whose text is their description.
    "![ alt ](logo.png) and ![ alt ][logo]\n\n[logo]: logo.png\n",
    // No text to keep.
    "[ ](guide.md) and [](guide.md)\n",
    // Autolinks.
    "<https://example.com> and https://example.com\n",
    // Text that is no link.
    "[ guide ] without a definition, and `[ a ](u)`\n",
    // Footnote references, task markers, and alert markers.
    "Text[^1].\n\n[^1]: Note.\n",
    "- [ ] Task\n- [x] Done\n",
    "> [!NOTE]\n> Text.\n",
  ])("leaves %j alone", (source) => {
    expect(check(source, rule)).toEqual([]);
  });
  it("leaves wikilinks, embeds, and callout markers alone in Obsidian", () => {
    expect(check("[[ a ]] and [[a| b ]] and ![[ c ]]\n", rule, "obsidian")).toEqual([]);
    expect(check("> [!note] Title\n> Text.\n", rule, "obsidian")).toEqual([]);
    expect(check("[ a ](b.md)\n", rule, "obsidian")).toHaveLength(1);
  });
  it.each(["\n", "\r\n"])("locates findings with %j line endings", (ending) => {
    const source = ["Text.", "See [ guide](guide.md)."].join(ending) + ending;
    expect(check(source, rule).map((item) => [item.line, item.column])).toEqual([[2, 5]]);
  });
  it("is in no preset", () => {
    for (const preset of Object.values(presets)) expect(preset.rules?.[rule]).toBeUndefined();
  });
});
