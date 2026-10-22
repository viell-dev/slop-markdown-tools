import { describe, expect, it } from "vitest";
import { createWorkspace, format, parse, semanticFingerprint } from "../../src/index.js";
import type { Config } from "../../src/index.js";
import { boundaryFixtures } from "../../scripts/obsidian/boundary-fixtures.mjs";

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
  .map(({ issue, source }) => [issue, source] as const);

describe("Obsidian boundaries read differently by its views", () => {
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
      ([issue]) => ![488, 494, 519, 524, 529].includes(issue),
    ))
      expect(checked(`${source}\nLater *outside*.\n`)).toContain("Later _outside_.");
  });

  it("does not apply Obsidian protections to GitHub", () => {
    expect(
      format("text *\\\n> + *words*\n", { config: { extends: ["recommended", "github"] } }).output,
    ).toContain("> - _words_");
  });
});
