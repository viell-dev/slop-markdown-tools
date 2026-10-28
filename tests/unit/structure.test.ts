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

const allDialects = ["commonmark", "github", "forgejo", "gitea", "obsidian", "vitepress"] as const;
/** The source that each finding covers, or `null` for a finding at one position. */
const covered = (source: string, findings: { start: number; end?: number }[]) =>
  findings.map((item) => (item.end === undefined ? null : source.slice(item.start, item.end)));

describe("structure/heading-punctuation", () => {
  const rule = "structure/heading-punctuation";
  const ends = (mark: string) =>
    `Heading ends with "${mark}"; a heading is a title, not a sentence.`;
  describe.each(allDialects)("in %s", (dialect) => {
    it.each([
      ["# Install.\n", "."],
      ["## Options:\n", ":"],
      ["## First,\n", ","],
      ["## Then;\n", ";"],
      ["## Done!\n", "!"],
      ["## Why?!\n", "!"],
      ["## 設定。\n", "。"],
      ["## 設定，\n", "，"],
      ["## 設定；\n", "；"],
      ["## 設定：\n", "："],
      ["## 設定！\n", "！"],
      ["# Install. #\n", "."],
      ["# Install.   \n", "."],
      ["Install.\n========\n", "."],
      ["Install:\r\n--------\r\n", ":"],
      ["# Install *now*.\n", "."],
      ["# See [the guide.](guide.md)\n", "."],
      ["# Using **Node.js.**\n", "."],
      ["# Install. <!-- draft -->\n", "."],
      ["> # Install.\n", "."],
      ["- # Install.\n", "."],
      ["# A\n\n## Install.\n\n## Use\n", "."],
      // A literal address ends before the sentence's period.
      ["# See https://example.com/a.\n", "."],
    ])("reports the punctuation that %j ends with", (source, mark) => {
      const findings = check(source, rule, {}, "Title.md", dialect);
      expect(covered(source, findings)).toEqual([mark]);
      expect(findings.map((item) => item.message)).toEqual([ends(mark)]);
    });
    it.each([
      "# Install\n",
      "# Why?\n",
      "# FAQ: Why?\n",
      // An ellipsis trails off, and does not end a sentence.
      "# Loading...\n",
      "# Loading…\n",
      // An abbreviation's period belongs to the word.
      "# Tools, scripts, etc.\n",
      "# Smith et al.\n",
      "# Plugins, e.g.\n",
      "# Ph.D.\n",
      "# Made in the U.S.A.\n",
      "# Acme Inc.\n",
      "# Apples vs.\n",
      // The colon closes an emoji shortcode.
      "# Released :tada:\n",
      "# Thanks :+1:\n",
      // A character reference that shows no punctuation.
      "# Copyright &copy;\n",
      "# Tom &amp; Jerry &gt;\n",
      // Code, images, and autolinks are not prose.
      "# Run `make.`\n",
      "# Logo ![Logo.](logo.png)\n",
      "# See <https://example.com/a.>\n",
      "#\n",
      "# #\n",
      "**Install.**\n",
      "Install.\n",
    ])("accepts %j", (source) => {
      expect(check(source, rule, {}, "Title.md", dialect)).toEqual([]);
    });
    it("reports a character reference or escape that shows punctuation, at the heading", () => {
      const source = "# Intro\n\n## Install&#46;\n\n## Use\\:\n";
      const findings = check(source, rule, {}, "Title.md", dialect);
      expect(findings.map((item) => [item.line, item.message])).toEqual([
        [3, ends(".")],
        [5, ends(":")],
      ]);
      expect(covered(source, findings)).toEqual([null, null]);
    });
    it("checks every heading with the configured punctuation", () => {
      const source = "# Why?\n\n## Install.\n\n## Use:\n";
      expect(check(source, rule, { punctuation: "" }, "Title.md", dialect)).toEqual([]);
      expect(
        covered(source, check(source, rule, { punctuation: "?:" }, "Title.md", dialect)),
      ).toEqual(["?", ":"]);
    });
  });
  it("does not take a period that follows a word for an abbreviation", () => {
    for (const source of ["# Using Node.js.\n", "# Vue.js.\n", "# Version 1.2.\n", "# Nothing.\n"])
      expect(covered(source, check(source, rule, {}, "Title.md", "github"))).toEqual(["."]);
  });
  it("reports a colon that does not close an emoji shortcode", () => {
    for (const source of ["# At 10:30:\n", "# Note:tada:\n"])
      expect(covered(source, check(source, rule, {}, "Title.md", "github"))).toEqual([":"]);
  });
  it("reads past a footnote reference where footnotes are read", () => {
    const source = "# Install.[^1]\n\n[^1]: Note.\n";
    for (const dialect of ["github", "forgejo", "gitea", "obsidian", "vitepress"] as const)
      expect(covered(source, check(source, rule, {}, "Title.md", dialect))).toEqual(["."]);
    expect(check(source, rule, {}, "Title.md", "commonmark")).toEqual([]);
  });
  it.each([
    ["# Install. {#setup}\n", "forgejo"],
    ["# Install. {#setup}\n", "gitea"],
    ["# Install. {#setup .note}\n", "vitepress"],
    ["Install. {#setup}\n---\n", "forgejo"],
    ["Install. {#setup}\n---\n", "vitepress"],
  ] as const)(
    "reads %j without the attribute block that %s takes from the text",
    (source, dialect) => {
      expect(covered(source, check(source, rule, {}, "Title.md", dialect))).toEqual(["."]);
      expect(check(source.replace(". {", " {"), rule, {}, "Title.md", dialect)).toEqual([]);
    },
  );
  it.each([
    ["## **Use.** ^usage\n", "obsidian"],
    ["## *Use.* {#usage}\n", "vitepress"],
    ["## **Use.** {#usage}\n", "forgejo"],
  ] as const)(
    "reads the markup before a suffix that fills its own text node in %j on %s",
    (source, dialect) => {
      expect(covered(source, check(source, rule, {}, "Title.md", dialect))).toEqual(["."]);
      expect(check(source.replace(".", ""), rule, {}, "Title.md", dialect)).toEqual([]);
    },
  );
  it.each(["commonmark", "github", "obsidian"] as const)(
    "keeps an attribute block as text in %s, which shows it",
    (dialect) => {
      expect(check("# Install. {#setup}\n", rule, {}, "Title.md", dialect)).toEqual([]);
    },
  );
  it("keeps the attribute block as text when VitePress's attributes are off", () => {
    const source = "# Install. {#setup}\n";
    const config: Config = {
      extends: [],
      dialect: "vitepress",
      vitepress: { attrs: false },
      rules: { [rule]: "error" },
    };
    expect(lint(source, { config })).toEqual([]);
    expect(lint(source, { config: { ...config, vitepress: {} } })).toHaveLength(1);
  });
  it("reads Obsidian's comments, wikilinks, highlights, and embeds as Obsidian shows them", () => {
    const source = [
      "# Install. %%draft%%",
      "",
      "## See [[Setup|the setup.]]",
      "",
      "## Read [[Setup.]]",
      "",
      "## Mark ==this.==",
      "",
      "## Chart ![[chart.png]]",
      "",
      "## Use. ^usage",
      "",
      "> [!note] Callout titles are not headings.",
      "> Body.",
      "",
    ].join("\n");
    const findings = check(source, rule, {}, "Title.md", "obsidian");
    expect(findings.map((item) => item.line)).toEqual([1, 3, 5, 7, 11]);
    expect(covered(source, findings)).toEqual([".", null, null, null, "."]);
    // Elsewhere, `^usage` is text.
    expect(check("## Use. ^usage\n", rule, {}, "Title.md", "github")).toEqual([]);
  });
  it("rejects punctuation that is not a string", () => {
    for (const punctuation of [1, ["."], null])
      expect(() =>
        lint("# A\n", { config: { extends: [], rules: { [rule]: ["error", { punctuation }] } } }),
      ).toThrow(`Invalid options for ${rule}`);
  });
});

describe("structure/emphasis-heading", () => {
  const rule = "structure/emphasis-heading";
  const only = (text: string, kind = "strong") =>
    `Paragraph "${text}" is only ${kind} text; if it names a section, make it a heading, which the outline lists and links can reach.`;
  describe.each(allDialects)("in %s", (dialect) => {
    it.each([
      ["**Install**\n\nRun the installer.\n", "Install", "strong"],
      ["__Install__\n", "Install", "strong"],
      ["*Install*\n", "Install", "emphasized"],
      ["_Install_\n", "Install", "emphasized"],
      ["***Install***\n", "Install", "emphasized"],
      ["**Install *now***\n", "Install now", "strong"],
      ["**Run `npm test`**\n", "Run npm test", "strong"],
      ["**Install** <!-- draft -->\n", "Install", "strong"],
      // The finding does not depend on where lines wrap.
      ["**Install the\npackage**\n", "Install the package", "strong"],
      ["**Install the\r\npackage**\r\n", "Install the package", "strong"],
      ["# A\n\n**Install**\n\nText.\n", "Install", "strong"],
    ])("reports %j", (source, text, kind) => {
      const findings = check(source, rule, {}, "Title.md", dialect);
      expect(findings.map((item) => item.message)).toEqual([only(text, kind)]);
      expect(covered(source, findings)[0]).toMatch(/^[*_]/);
    });
    it.each([
      // Text that ends with punctuation is a sentence.
      ...[..."。，；：！？.,;:!?"].map((mark) => `**Install${mark}**\n`),
      "**Install** now.\n",
      "**Install** the package\n",
      "**One** **two**\n",
      "**[Install](install.md)**\n",
      "**Logo ![logo](logo.png)**\n",
      "**Install**  \n**Use**\n",
      "**Install**\\\nUse\n",
      "** **\n",
      "# **Install**\n",
      // In a list item, quote, or table cell, emphasis labels the content beside it.
      "- **Install**\n",
      "1. **Install**\n\n   Run the installer.\n",
      "> **Note**\n>\n> Text.\n",
      "> [!NOTE]\n> **Install**\n",
      "| **Install** |\n| ----------- |\n| **Use**     |\n",
    ])("accepts %j", (source) => {
      expect(check(source, rule, {}, "Title.md", dialect)).toEqual([]);
    });
    it("uses the configured punctuation", () => {
      const source = "**Install.**\n\n**Why?**\n\n**Use**\n";
      expect(
        check(source, rule, { punctuation: "" }, "Title.md", dialect).map((item) => item.line),
      ).toEqual([1, 3, 5]);
      expect(
        check(source, rule, { punctuation: "?" }, "Title.md", dialect).map((item) => item.line),
      ).toEqual([1, 5]);
    });
  });
  it("leaves footnotes, Obsidian callouts, and VitePress containers alone", () => {
    expect(check("Text.[^1]\n\n[^1]: **Source**\n", rule, {}, "Title.md", "github")).toEqual([]);
    const callout = "> [!tip] **Install**\n> **Use**\n";
    expect(check(callout, rule, {}, "Title.md", "obsidian")).toEqual([]);
    expect(check("**Install** %%draft%%\n", rule, {}, "Title.md", "obsidian")).toHaveLength(1);
    expect(check("**[[Install]]**\n", rule, {}, "Title.md", "obsidian")).toEqual([]);
    expect(check("**==Install==**\n", rule, {}, "Title.md", "obsidian")).toHaveLength(1);
    // VitePress's custom containers are its callouts; elsewhere `:::` is text.
    const containers =
      "::: tip\n\n**Install**\n\n:::\n\n::: details More\n**Use**\n:::\n\n**Remove**\n";
    expect(check(containers, rule, {}, "Title.md", "vitepress").map((item) => item.line)).toEqual([
      11,
    ]);
    expect(check(containers, rule, {}, "Title.md", "github").map((item) => item.line)).toEqual([
      3, 11,
    ]);
    // Obsidian reads `^setup` as the paragraph's block identifier; elsewhere it is text.
    expect(check("**Install** ^setup\n", rule, {}, "Title.md", "obsidian")).toHaveLength(1);
    expect(check("**Install** ^setup\n", rule, {}, "Title.md", "github")).toEqual([]);
  });
  it("shortens long text in its message", () => {
    const text = "word ".repeat(20).trim();
    const [finding] = check(`**${text}**\n`, rule, {}, "Title.md", "github");
    expect(finding?.message).toBe(only(`${"word ".repeat(11)}wo…`));
  });
  it("rejects punctuation that is not a string", () => {
    expect(() =>
      lint("", { config: { extends: [], rules: { [rule]: ["error", { punctuation: 1 }] } } }),
    ).toThrow(`Invalid options for ${rule}`);
  });
});

it("leaves the heading text checks out of every preset", () => {
  for (const preset of Object.values(presets))
    for (const rule of ["structure/heading-punctuation", "structure/emphasis-heading"])
      expect(preset.rules?.[rule]).toBeUndefined();
});
