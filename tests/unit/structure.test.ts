import { describe, expect, it } from "vitest";
import { format, lint, presets } from "../../src/index.js";
import type { Config } from "../../src/index.js";

function check(
  source: string,
  rule: string,
  options: Record<string, unknown> = {},
  path = "Title.md",
  dialect: Config["dialect"] = "obsidian",
) {
  const config: Config = { extends: [], dialect, rules: { [rule]: ["error", options] } };
  const diagnostics = lint(source, { config, path });
  const result = format(source, { config, path });
  expect(result.output).toBe(source);
  expect(result.changed).toBe(false);
  expect(result.diagnostics).toEqual(diagnostics);
  expect(diagnostics.every((item) => item.edit === undefined)).toBe(true);
  expect(lint(source, { config: { extends: [] } })).toEqual([]);
  return diagnostics;
}
describe("document structure rules", () => {
  it.each([
    "# Title\n",
    "Title\n=====\n",
    "---\ntitle: Title\n---\n\n# Title\n",
    "+++\ntitle = 'Title'\n+++\n\n# Title\n",
  ])("accepts an initial level-1 heading after optional front matter", (source) => {
    expect(check(source, "structure/initial-heading")).toEqual([]);
  });
  it.each([
    "",
    "---\ntitle: Title\n---\n",
    "Prose.\n\n# Title\n",
    "## Subtitle\n",
    "> # Title\n",
    "<!-- comment -->\n\n# Title\n",
  ])("reports a missing initial level-1 heading", (source) => {
    expect(check(source, "structure/initial-heading")).toHaveLength(1);
  });
  it.each([
    "# A\n\n## B\n\n### C\n\n## D\n\n# E\n",
    // The first heading may have any level.
    "## Start\n\n### Deeper\n",
    "Title\n=====\n\nSection\n-------\n",
    // A block quote, such as a callout, has headings of its own, apart from the document's.
    "# A\n\n> ### Callout heading\n>\n> #### Its part\n\n## B\n",
    "# A\n\n[^note]\n\n[^note]: ### A footnote heading\n",
    "# A\n\n```md\n### Code\n```\n",
  ])("accepts headings that go at most one level deeper: %j", (source) => {
    expect(check(source, "structure/heading-increment", {}, "Title.md", "github")).toEqual([]);
  });
  it.each([
    ["# A\n\n### C\n", 3],
    ["# A\n\n## B\n\n#### D\n", 5],
    ["> # Q\n>\n> ### R\n", 3],
    ["# A\n\n- ### Item heading\n", 3],
    ["# A\n\n> ## Quoted\n\n### Skips the document's level 2\n", 5],
  ])("reports a heading that skips a level: %j", (source, line) => {
    const [finding, ...rest] = check(source, "structure/heading-increment", {}, "T.md", "github");
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ line, column: source.split("\n")[line - 1]!.indexOf("#") + 1 });
  });
  it("says which level a skipping heading may have", () => {
    expect(check("## A\n\n##### B\n", "structure/heading-increment")[0]?.message).toBe(
      "Heading level 5 follows level 2; use at most level 3.",
    );
  });

  it.each([
    "# A\n\n## B\n\n## C\n",
    "## No title\n\n## Still none\n",
    "---\ntitle: Title\n---\n\n## Section\n",
    // A key of a TOML table is not the document's title.
    "+++\n[extra]\ntitle = 'Not the title'\n+++\n\n# Title\n",
    "---\nsubtitle: Not a title\n---\n\n# Title\n",
    "# Title\n\n> # A quoted title\n",
  ])("accepts one level-1 heading: %j", (source) => {
    expect(check(source, "structure/single-title", {}, "Title.md", "github")).toEqual([]);
  });
  it.each([
    ["# A\n\n# B\n", [3], "the title is on line 1"],
    ["Title\n=====\n\n# Another\n\n# And another\n", [4, 6], "the title is on line 1"],
    ["---\ntitle: Title\n---\n\n# Title\n", [5], "the front matter sets the title"],
    ["+++\ntitle = 'Title'\n+++\n\n# Title\n", [5], "the front matter sets the title"],
    ["> # One\n>\n> # Two\n", [3], "the title is on line 1"],
  ])("reports level-1 headings after the title: %j", (source, lines, reason) => {
    const findings = check(source, "structure/single-title", {}, "Title.md", "github");
    expect(findings.map((item) => item.line)).toEqual(lines);
    for (const finding of findings)
      expect(finding.message).toBe(`Use one level-1 heading per document; ${reason}.`);
  });

  it.each([
    // The same heading under different parents is the usual layout of a reference.
    "# Linux\n\n## Setup\n\n# Windows\n\n## Setup\n",
    "# Setup\n\n## Setup\n",
    "## Notes\n\n> ## Notes\n",
    "# A\n\n## Notes\n\n### Details\n\n## Details\n",
    "# A\n\n## Setup\n\n## Set up\n",
    "# A\n\n##\n\n##\n",
  ])("accepts distinct sibling headings: %j", (source) => {
    expect(check(source, "structure/duplicate-heading", {}, "Title.md", "github")).toEqual([]);
  });
  it.each([
    ["# A\n\n## Setup\n\n## Setup\n", 5, "Setup", 3],
    ["## Setup\n\n## Setup\n", 3, "Setup", 1],
    ["# A\n\n## *Setup*\n\n## Setup\n", 5, "Setup", 3],
    ["# A\n\n## Setup\n\n### Linux\n\n## Setup\n", 7, "Setup", 3],
    ["# A\n\n## Setup  steps\n\n## Setup steps\n", 5, "Setup steps", 3],
    ["> # A\n>\n> ## X\n>\n> ## X\n", 5, "X", 3],
  ])("reports a repeated sibling heading: %j", (source, line, text, earlier) => {
    const findings = check(source, "structure/duplicate-heading", {}, "Title.md", "github");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      line,
      message: `Heading "${text}" repeats the heading on line ${earlier} under the same parent; give it a distinct name.`,
    });
  });
  it("is not in a preset, except for the heading increment", () => {
    const recommended = presets.recommended!.rules!;
    expect(recommended["structure/heading-increment"]).toBe("warn");
    for (const preset of Object.values(presets))
      for (const rule of ["structure/single-title", "structure/duplicate-heading"])
        expect(preset.rules?.[rule]).toBeUndefined();
  });
  it("supports path overrides", () => {
    expect(
      lint("Body\n", {
        path: "generated/a.md",
        config: {
          extends: [],
          rules: { "structure/initial-heading": "error" },
          overrides: [{ files: ["generated/**"], rules: { "structure/initial-heading": "off" } }],
        },
      }),
    ).toEqual([]);
  });
});

describe("structure/unspaced-heading", () => {
  const rule = "structure/unspaced-heading";
  /** The source of each finding, from the rule run in `dialect`. */
  const found = (source: string, dialect: Config["dialect"] = "github") =>
    check(source, rule, {}, "Title.md", dialect).map((item) => source.slice(item.start, item.end));
  it.each([
    ["#Heading\n", "#Heading"],
    ["##Heading 2\n", "##Heading 2"],
    ["######Six\n", "######Six"],
    // Without a blank line below, the first line would still be a heading of its own.
    ["#Heading\nBody text below.\n", "#Heading"],
    ["Intro.\n\n#Heading  \n\nBody.\n", "#Heading"],
    ["> #Quoted\n", "#Quoted"],
    ["- #Item\n", "#Item"],
    ["1. ##Step\n", "##Step"],
    ["Text[^1].\n\n[^1]: #Note\n", "#Note"],
    ["#**Bold**\n", "#**Bold**"],
    ["#_Emphasis_\n", "#_Emphasis_"],
    ["#`code`\n", "#`code`"],
    ["##2 Setup\n", "##2 Setup"],
    ["#Ünïcode\n", "#Ünïcode"],
    // Below an alert's marker, the line starts the alert's body.
    ["> [!NOTE]\n> #Heading\n", "#Heading"],
    [">[!NOTE]\n>##Heading\n", "##Heading"],
  ])("reports %j", (source, span) => {
    expect(found(source)).toEqual([span]);
  });
  it.each(["commonmark", "github", "forgejo", "gitea", "vitepress", "obsidian"] as const)(
    "reports a look-alike in %s",
    (dialect) => {
      expect(found("##Heading\n", dialect)).toEqual(["##Heading"]);
      expect(found("Intro.\r\n\r\n##Heading\r\nBody.\r\n", dialect)).toEqual(["##Heading"]);
    },
  );
  it("reports text inside VitePress containers, as markdown-it reads it", () => {
    expect(found("::: tip\n#Heading\n:::\n", "vitepress")).toEqual(["#Heading"]);
  });
  it("reports the start of an Obsidian callout's body", () => {
    expect(found("> [!note] Title\n> ##Heading\n", "obsidian")).toEqual(["##Heading"]);
  });
  it("says how to make it a heading, with or without closing hashes", () => {
    const [open] = check("##Heading\n", rule, {}, "T.md", "github");
    expect(open).toMatchObject({ line: 1, column: 1 });
    expect(open?.message).toBe(
      'Text starts with "##" without a space after it, so it is not a heading; if it should be one, add a space after "##".',
    );
    for (const source of ["##Heading##\n", "##Heading 2 ##\n", "##Heading#\n"])
      expect(check(source, rule, {}, "T.md", "github")[0]?.message).toBe(
        'Text starts with "##" without a space after it, so it is not a heading; if it should be one, add spaces inside the hashes, as in "## Heading ##".',
      );
    // An escaped `#` is text, not a closing sequence.
    expect(check("#C\\#\n", rule, {}, "T.md", "github")[0]?.message).toMatch(
      /add a space after "#"\.$/,
    );
  });
  it("reports with CRLF and CR line endings", () => {
    for (const eol of ["\r\n", "\r"]) {
      const source = ["Intro.", "", "#Heading#", "Body.", ""].join(eol);
      const findings = check(source, rule, {}, "T.md", "github");
      expect(findings).toMatchObject([{ line: 3, column: 1 }]);
      expect(source.slice(findings[0]!.start, findings[0]!.end)).toBe("#Heading#");
      expect(found(`> [!NOTE]${eol}> #Heading${eol}`)).toEqual(["#Heading"]);
    }
  });
  it.each([
    "# Heading\n",
    "#\tHeading\n",
    "#\n",
    // Headings whose closing hashes follow their text are headings, as `# C#` is.
    "# C#\n",
    "## Heading##\n",
    // Issue references and numbers, shebangs, and other notations.
    "#123 fixed\n",
    "#42\n",
    "#7: crash on start\n",
    "#!/bin/sh\n",
    "#\uFE0F\u20E3 keycap\n",
    "#[derive(Debug)]\n",
    "#{x}\n",
    "#-1\n",
    "#.class\n",
    "#/path\n",
    // Seven hashes are no heading even with a space.
    "#######Seven\n",
    "\\#Escaped\n",
    "&#35;Reference\n",
    // A later line of a paragraph can start with any word once wrapped.
    "Fixed in\n#123 and\n#Hashtag too.\n",
    "Text `#Code`.\n",
    "```\n#Code\n```\n",
    "    #Indented code\n",
    "<div>\n#Html\n</div>\n",
    "| a |\n| - |\n| #Cell |\n",
    "Setext\n#Underlined\n===\n",
  ])("accepts %j", (source) => {
    expect(found(source)).toEqual([]);
  });
  it("leaves the line below a marker alone where there are no alerts", () => {
    expect(found("> [!NOTE]\n> #Heading\n", "commonmark")).toEqual([]);
  });
  it.each([
    "#tag text\n",
    "#Heading\n",
    "#Heading#\n",
    "#nested/tag and more\n",
    "#2024-review\n",
    "> #tag\n",
    ">#tag\n",
    "- #tag\n",
    "> [!note]\n> #tag\n",
  ])("accepts an Obsidian tag: %j", (source) => {
    expect(found(source, "obsidian")).toEqual([]);
  });
  it("reports elsewhere what Obsidian reads as a tag", () => {
    expect(found("#tag text\n")).toEqual(["#tag text"]);
    expect(found("> [!note]\n> #tag\n", "gitea")).toEqual(["#tag"]);
  });
  it("is in no preset", () => {
    for (const preset of Object.values(presets)) expect(preset.rules?.[rule]).toBeUndefined();
  });
});

describe("structure/split-quote", () => {
  const rule = "structure/split-quote";
  const found = (source: string, dialect: Config["dialect"] = "github") =>
    check(source, rule, {}, "Title.md", dialect).map((item) => [
      item.line,
      source.slice(item.start, item.end),
    ]);
  it.each([
    ["> a\n\n> b\n", [[2, ""]]],
    ["> This is a quote\n> of two lines.\n\n> And another.\n", [[3, ""]]],
    ["> a\n\n\n> b\n", [[2, "\n"]]],
    ["> a\nlazy\n\n> b\n", [[3, ""]]],
    ["> > a\n>\n> > b\n", [[2, ">"]]],
    ["- > a\n\n  > b\n", [[2, ""]]],
    [
      "> a\n\n> b\n\n> c\n",
      [
        [2, ""],
        [4, ""],
      ],
    ],
    // The body of an alert can be meant to continue below the blank line.
    ["> [!NOTE]\n> a\n\n> b\n", [[3, ""]]],
    ["> a\n  \n> b\n", [[2, "  "]]],
  ] as const)("reports %j", (source, expected) => {
    expect(found(source)).toEqual(expected);
  });
  it.each(["commonmark", "github", "forgejo", "gitea", "vitepress", "obsidian"] as const)(
    "reports a split in %s, also with CRLF and CR",
    (dialect) => {
      expect(found("> a\n\n> b\n", dialect)).toEqual([[2, ""]]);
      expect(found("> a\r\n\r\n> b\r\n", dialect)).toEqual([[2, ""]]);
      expect(found("> a\r\r> b\r", dialect)).toEqual([[2, ""]]);
      expect(found("> a\r\n>\r\n> b\r\n", dialect)).toEqual([]);
    },
  );
  it("says how to join or separate the quotes", () => {
    expect(check("> a\n\n> b\n", rule, {}, "T.md", "github")[0]?.message).toBe(
      'A blank line separates two block quotes, which some renderers join into one; to write one quote, start the blank line with ">", or to keep two, put text or a comment between them.',
    );
  });
  it.each([
    "> a\n>\n> b\n",
    "> a\n\nText.\n\n> b\n",
    "> a\n\n<!-- separate -->\n\n> b\n",
    "> a\n\n---\n\n> b\n",
    "- > a\n\n- > b\n",
    "> a\n\n    > b\n",
    "```\n> a\n\n> b\n```\n",
  ])("accepts %j", (source) => {
    expect(found(source)).toEqual([]);
  });
  it.each([
    ["> [!NOTE]\n> a\n\n> [!TIP]\n> b\n", "github"],
    ["> a\n\n> [!WARNING]\n> b\n", "github"],
    ["> [!NOTE]\n> a\n\n> [!CAUTION]\n> b\n", "forgejo"],
    ["> [!NOTE]\n> a\n\n> [!IMPORTANT]\n> b\n", "gitea"],
    ["> [!NOTE]\n> a\n\n> [!TIP]\n> b\n", "vitepress"],
    ["> [!note]\n> a\n\n> [!tip]- Folded\n> b\n", "obsidian"],
    ["> [!note] Title\n> a\n\n> [!quote]\n> b\n", "obsidian"],
    // The marker shows that the quote stands apart, also where it is text.
    ["> a\n\n> [!NOTE]\n> b\n", "commonmark"],
    ["- > [!note]\n  > a\n\n  > [!tip]\n  > b\n", "obsidian"],
  ] as const)("accepts an alert or callout after a blank line: %j in %s", (source, dialect) => {
    expect(found(source, dialect)).toEqual([]);
  });
  it("accepts quotes separated by an Obsidian comment", () => {
    expect(found("> a\n\n%% separate %%\n\n> b\n", "obsidian")).toEqual([]);
  });
  it("is in no preset", () => {
    for (const preset of Object.values(presets)) expect(preset.rules?.[rule]).toBeUndefined();
  });
});
