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
