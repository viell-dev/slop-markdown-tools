import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { competitorMappings, convertConfig, builtInRules, format } from "../../src/index.js";

describe("competitor conversion (#669)", () => {
  it("maps every declared markdownlint option and checks Prettier coverage against the comparison", () => {
    const samples: Record<string, unknown> = {
      frontMatterTitle: false,
      nestedIndent: 3,
      startIndented: true,
      startIndent: 3,
      hardBreakSpaces: 3,
      listItemEmptyLines: true,
      codeBlocks: false,
      spacesPerTab: 2,
      ignoredCodeLanguages: ["js"],
      maximum: 2,
      lineLength: 100,
      headingLineLength: 90,
      codeBlockLineLength: 120,
      headings: false,
      tables: false,
      strict: true,
      stern: true,
      linesAbove: 2,
      linesBelow: 2,
      includeFrontMatter: false,
      siblingsOnly: true,
      level: 2,
      punctuation: ".",
      bulletSpaces: 2,
      orderedSpaces: 2,
      bulletSpacesMultiline: 2,
      orderedSpacesMultiline: 2,
      allowedLanguages: ["js"],
      languageOnly: true,
      allowPreamble: true,
      matchCase: true,
      names: ["GitHub"],
      htmlElements: false,
      ignoredFragments: "^custom",
      exactCase: true,
      shortcutSyntax: true,
      ignoredLabels: ["skip"],
      ignoredDefinitions: ["skip"],
      autolink: false,
      inline: false,
      full: false,
      collapsed: false,
      shortcut: false,
      urlInline: false,
      prohibitedTexts: ["here"],
      alignedDelimiter: true,
    };
    const docs = readFileSync("docs/integrations.md", "utf8");
    for (const row of competitorMappings) {
      if (!row.source.startsWith("MD")) {
        if (row.rule) expect(docs, row.source).toContain(row.rule);
        else if (row.issue) expect(docs, row.source).toContain(`#${row.issue}`);
        continue;
      }
      for (const [source, target] of Object.entries(row.options ?? {})) {
        let value: unknown = samples[target];
        if (target === "headings" && row.source === "MD043") value = ["# Title"];
        if (target === "marker")
          value = row.source === "MD035" ? "***" : row.source === "MD048" ? "backtick" : "asterisk";
        if (target === "numbering") value = "ordered";
        if (target === "pipeStyle") value = "leadingOnly";
        if (target === "style")
          value = (
            { MD003: "atx", MD035: "***", MD046: "fenced", MD060: "tight" } as Record<
              string,
              string
            >
          )[row.source];
        expect(value, `${row.source}.${source}`).toBeDefined();
        const result = convertConfig({
          markdownlint: { default: false, [row.source]: { [source]: value } },
        });
        expect(() => format("", { config: result.config })).not.toThrow();
        expect(result.omitted, `${row.source}.${source}`).not.toEqual(
          expect.arrayContaining([expect.stringContaining(`.${target}: value`)]),
        );
        const setting = result.config.rules?.[row.rule!];
        expect(setting, `${row.source}.${source}`).toEqual([
          "warn",
          expect.objectContaining({
            [target]:
              source === "ignore_case"
                ? false
                : target === "marker" && row.source !== "MD035"
                  ? row.source === "MD048"
                    ? "```"
                    : "*"
                  : value,
          }),
        ]);
      }
    }
  });
  it("maps every markdownlint check exactly once and agrees with the comparison", () => {
    const docs = readFileSync("docs/integrations.md", "utf8");
    const rows = competitorMappings.filter((row) => row.source.startsWith("MD"));
    expect(rows).toHaveLength(53);
    expect(new Set(rows.map((row) => row.source)).size).toBe(53);
    for (const row of rows) {
      const line = docs.split("\n").find((line) => line.startsWith(`| ${row.source} `));
      expect(line, row.source).toBeDefined();
      if (row.rule) {
        expect(line, row.source).toContain(row.rule);
        expect(builtInRules).toHaveProperty(row.rule);
      } else expect(line).toContain(`#${row.issue}`);
    }
  });
  it.each(competitorMappings.filter((row) => row.source.startsWith("MD")))(
    "converts $source and its default options",
    (row) => {
      const result = convertConfig({ markdownlint: { default: false, [row.source]: true } });
      expect(() => format("", { config: result.config })).not.toThrow();
      if (row.rule) expect(result.config.rules).toHaveProperty(row.rule);
      else expect(result.omitted.join("\n")).toContain(`#${row.issue}`);
      expect(
        convertConfig({ markdownlint: { default: false, [row.source]: false } }).config.rules,
      ).toEqual({});
    },
  );
  it("starts without recommended, reproduces markdownlint defaults, and accepts long aliases", () => {
    const result = convertConfig({ markdownlint: {} });
    expect(result.config.extends).toEqual([]);
    expect(result.config.rules?.["style/wrap"]).toBeUndefined();
    expect(result.config.rules?.["structure/duplicate-heading"]).toEqual([
      "warn",
      { siblingsOnly: false },
    ]);
    expect(
      convertConfig({ markdownlint: { default: false, "emphasis-style": { style: "asterisk" } } })
        .config.rules,
    ).toEqual({ "style/emphasis": ["warn", { marker: "*" }] });
  });
  it("lets explicit markdownlint choices win fixed styles, and Prettier options win their choices", () => {
    const result = convertConfig({
      markdownlint: { default: false, MD049: { style: "asterisk" }, MD007: { indent: 4 } },
      prettier: { proseWrap: "always", printWidth: 99, tabWidth: 3 },
    });
    expect(result.config.rules?.["style/emphasis"]).toEqual(["warn", { marker: "*" }]);
    expect(result.config.rules?.["style/wrap"]).toEqual(["warn", { width: 99 }]);
    expect(result.config.rules?.["style/list-indent"]).toEqual([
      "warn",
      expect.objectContaining({ nestedIndent: 3 }),
    ]);
    expect(result.conflicts.join("\n")).toContain("MD049 wins");
    expect(result.conflicts.join("\n")).toContain("tabWidth wins");
  });
  it("honors an explicit disable of a Prettier fixed choice", () => {
    const result = convertConfig({ markdownlint: { default: false, MD049: false }, prettier: {} });
    expect(result.config.rules?.["style/emphasis"]).toBe("off");
    expect(result.conflicts.join("\n")).toContain("explicit disable wins");
  });
  it.each([{}, { proseWrap: "preserve" }, { proseWrap: "never" }])(
    "does not enable wrapping for %j",
    (prettier) => {
      expect(convertConfig({ prettier }).config.rules?.["style/wrap"]).toBeUndefined();
    },
  );
  it("does not report absent optional Prettier settings as conversion gaps", () => {
    const omitted = convertConfig({ prettier: {} }).omitted.join("\n");
    for (const name of ["parser", "plugins", "rangeStart", "requirePragma"])
      expect(omitted).not.toContain(`Prettier ${name}:`);
    expect(omitted).toContain("Prettier endOfLine:");
  });
  it("reports unsupported options and gaps, without claiming comment compatibility", () => {
    const result = convertConfig({
      prettier: { requirePragma: true, insertPragma: true, endOfLine: "crlf", plugin: "untrusted" },
      markdownlint: { default: false, MD033: true, MD009: { strict: true } },
    });
    for (const issue of [723, 712, 685, 702])
      expect(result.omitted.join("\n")).toContain(`#${issue}`);
    expect(result.omitted.join("\n")).toContain("strict");
  });
});
