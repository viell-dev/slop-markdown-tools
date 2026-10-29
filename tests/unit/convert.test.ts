import { readFileSync } from "node:fs";
import { format as prettierFormat } from "prettier";
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
      allowedElements: ["br"],
      tableAllowedElements: ["br"],
      listItems: false,
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
          "error",
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
      if (row.issue) expect(line, row.source).toContain(`#${row.issue}`);
      if (!/None yet|Not yet/.test(line!)) expect(row.issue, row.source).toBeUndefined();
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
      expect(result.omitted.join("\n")).not.toContain("outside the mdrefine option range");
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
      "error",
      { siblingsOnly: false },
    ]);
    expect(
      convertConfig({ markdownlint: { default: false, "emphasis-style": { style: "asterisk" } } })
        .config.rules,
    ).toEqual({ "style/emphasis": ["error", { marker: "*" }] });
  });
  it("lets explicit markdownlint choices win fixed styles, and Prettier options win their choices", () => {
    const result = convertConfig({
      markdownlint: { default: false, MD049: { style: "asterisk" }, MD007: { indent: 4 } },
      prettier: { proseWrap: "always", printWidth: 99, tabWidth: 3 },
    });
    expect(result.config.rules?.["style/emphasis"]).toEqual(["error", { marker: "*" }]);
    expect(result.config.rules?.["style/wrap"]).toEqual(["warn", { width: 99 }]);
    expect(result.config.rules?.["style/list-indent"]).toEqual([
      "error",
      expect.objectContaining({ nestedIndent: 3 }),
    ]);
    expect(result.conflicts.join("\n")).toContain("MD049 wins");
    expect(result.conflicts.join("\n")).toContain("tabWidth wins");
  });
  it.each(["MD004", "MD049"])("retains Prettier when markdownlint disables %s", (source) => {
    const result = convertConfig({
      markdownlint: { default: false, [source]: false },
      prettier: {},
    });
    expect(result.config.rules?.["style/emphasis"]).toEqual(["warn", { marker: "_" }]);
    expect(result.conflicts.join("\n")).toContain("leaves Prettier");
  });
  it.each([{}, { proseWrap: "preserve" }])("does not enable wrapping for %j", (prettier) => {
    expect(convertConfig({ prettier }).config.rules?.["style/wrap"]).toBeUndefined();
  });
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
    for (const issue of [723, 712]) expect(result.omitted.join("\n")).toContain(`#${issue}`);
    // Competitor pragmas never apply with an mdrefine configuration, so the
    // report must not suggest that a written configuration will honor them.
    expect(result.omitted).toContain(
      "Prettier requirePragma: has no effect with an mdrefine configuration; honoring it during the fallback is #723.",
    );
    expect(result.omitted).toContain(
      "Prettier insertPragma: not carried over; mdrefine does not write competitor comments.",
    );
    expect(result.omitted.join("\n")).toContain("strict");
    expect(result.config.rules?.["content/html-element"]).toEqual(["error", {}]);
  });
  it("says that links/valid also checks files when MD051 enables it, and suggests it otherwise", () => {
    const enabled = convertConfig({ markdownlint: {} });
    expect(enabled.config.rules?.["links/valid"]).toEqual(["error", {}]);
    expect(enabled.suggestions.join("\n")).toContain("also reports local links");
    const off = convertConfig({ markdownlint: { MD051: false } });
    expect(off.config.rules?.["links/valid"]).toBeUndefined();
    expect(off.suggestions.join("\n")).toContain("Consider links/valid");
    expect(convertConfig({ prettier: {} }).suggestions.join("\n")).toContain(
      "Consider links/valid",
    );
  });
  it("keeps enabled markdownlint defaults behind Prettier choices but raises severity", () => {
    const result = convertConfig({ prettier: {}, markdownlint: { MD049: true } });
    expect(result.config.rules?.["style/emphasis"]).toEqual(["error", { marker: "_" }]);
    expect(result.conflicts.join("\n")).not.toContain("explicit markdownlint choice");
    expect(result.conflicts.join("\n")).not.toContain("tabWidth wins");
  });
  it("converts never and reports MD013 paragraph limits without enabling reflow", () => {
    expect(
      convertConfig({ prettier: { proseWrap: "never" } }).config.rules?.["style/wrap"],
    ).toEqual(["warn", { mode: "never" }]);
    const result = convertConfig({ markdownlint: { MD013: { line_length: 97 } } });
    expect(result.omitted.join("\n")).toContain("paragraph lines are not checked");
    expect(result.suggestions.join("\n")).toContain("width 97");
    expect(result.config.rules?.["style/wrap"]).toBeUndefined();
  });
  it("maps MD009 code blocks and explains strict and MD031's safety limit without closed issues", () => {
    const result = convertConfig({
      markdownlint: {
        default: false,
        MD009: { strict: true, code_blocks: true },
        MD031: true,
        MD060: { style: "any" },
      },
    });
    expect(result.config.rules?.["style/trailing-space"]).toEqual([
      "error",
      expect.objectContaining({ codeBlocks: true }),
    ]);
    expect(result.omitted.join("\n")).toContain("always strict");
    expect(result.omitted.join("\n")).toContain("inside list items");
    expect(result.omitted.join("\n")).not.toMatch(/#(702|684|709|669)/);
  });
  it.each([{ prettier: {} }, { markdownlint: {} }])(
    "accepts all converted default option values: %j",
    (input) => {
      expect(convertConfig(input).omitted.join("\n")).not.toContain(
        "outside the mdrefine option range",
      );
    },
  );
  it.each([{}, { proseWrap: "always" as const, printWidth: 36 }, { proseWrap: "never" as const }])(
    "formats the documented common behavior like Prettier: %j",
    async (prettier) => {
      const input = [
        "# Title",
        "",
        "## Closed ##",
        "",
        "* *emphasis* and __strong__",
        "* second",
        "  * nested",
        "",
        "1. one",
        "2. two",
        "",
        "~~~txt",
        "literal",
        "~~~",
        "",
        "***",
        "",
        "| a | longer |",
        "| --- | --- |",
        "| long cell | b |",
        "",
        "trailing space   ",
        "hard break  ",
        "next line.",
        "",
        "",
        "",
        "A ``code`` span and [reference][r].",
        "",
        '[r]:   https://example.com   "Title"',
        "",
        ">  quoted text",
        "> continuation",
        "lazy continuation",
        "",
        "a paragraph whose words fill more than the selected width",
        "and continue on another physical line",
      ].join("\n");
      const config = convertConfig({ prettier }).config;
      const result = format(input, { config: { ...config, dialect: "github" } });
      expect(result.output).toBe(await prettierFormat(input, { ...prettier, parser: "markdown" }));
      expect(format(result.output, { config: { ...config, dialect: "github" } }).output).toBe(
        result.output,
      );
    },
  );

  it("documents the Setext difference instead of claiming Prettier changes it", async () => {
    const input = "Title\n=====\n";
    expect(await prettierFormat(input, { parser: "markdown" })).toBe(input);
    expect(format(input, { config: convertConfig({ prettier: {} }).config }).output).toBe(
      "# Title\n",
    );
    expect(readFileSync("docs/integrations.md", "utf8")).toContain(
      "Prettier keeps Setext headings",
    );
  });
  it.each([
    "leading_and_trailing",
    "leading_only",
    "trailing_only",
    "no_leading_or_trailing",
    "per_table",
  ])("maps markdownlint's table enum %s", (style) => {
    const report = convertConfig({ markdownlint: { default: false, MD055: { style } } });
    expect(report.omitted).toEqual([]);
    expect(() => format("", { config: report.config })).not.toThrow();
  });
  it("maps markdownlint's one_or_ordered numbering", () => {
    expect(
      convertConfig({ markdownlint: { default: false, MD029: { style: "one_or_ordered" } } }).config
        .rules?.["style/ordered-list"],
    ).toEqual(["error", { numbering: "auto", delimiter: "consistent" }]);
  });
  it("ties every reported Prettier issue to its own comparison row", () => {
    const docs = readFileSync("docs/integrations.md", "utf8");
    const labels: Record<string, string> = {
      endOfLine: "`endOfLine`",
      embeddedLanguageFormatting: "`embeddedLanguageFormatting`",
      requirePragma: "`requirePragma`",
      insertPragma: "`requirePragma`",
      tables: "Aligned tables",
      "front matter": "YAML front matter",
    };
    for (const row of competitorMappings.filter((row) => !row.source.startsWith("MD"))) {
      const label = labels[row.source];
      if (!label) {
        expect(row.issue, row.source).toBeUndefined();
        continue;
      }
      const line = docs.split("\n").find((line) => line.startsWith("|") && line.includes(label))!;
      expect(line, row.source).toBeDefined();
      if (row.issue) expect(line).toContain(`#${row.issue}`);
      if (!/None yet|Not yet/.test(line)) expect(row.issue).toBeUndefined();
    }
    expect(docs).toContain("mdrefine is meant to replace these tools");
    expect(docs).toContain('"None yet" and "Not yet" link the issue');
    expect(docs).toContain("### Configuration conversion and fallback");
  });
  it("normalizes enabled, case, alias order and tags before formatting", () => {
    const disabled = convertConfig({
      markdownlint: { default: false, MD049: { enabled: false, style: "underscore" } },
    });
    expect(format("*text*\n", { config: disabled.config }).output).toBe("*text*\n");
    const combined = convertConfig({
      prettier: {},
      markdownlint: { default: false, MD049: { enabled: false } },
    });
    expect(format("*text*\n", { config: combined.config }).output).toBe("_text_\n");
    for (const markdownlint of [
      { default: false, md049: { style: "asterisk" } },
      { default: false, "emphasis-style": { style: "underscore" }, MD049: { style: "asterisk" } },
      { default: false, emphasis: false, md049: { style: "asterisk" } },
    ]) {
      const result = convertConfig({ markdownlint });
      expect(format("_text_\n", { config: result.config }).output).toBe("*text*\n");
      expect(result.omitted).toEqual([]);
    }
    const tagged = convertConfig({
      markdownlint: { default: false, HEADINGS: true, MD003: false },
    });
    expect(tagged.config.rules).toHaveProperty("structure/heading-increment");
    expect(tagged.config.rules).toHaveProperty("structure/single-title");
  });
  it("preserves mixed Setext/closed ATX intent", () => {
    const headings = convertConfig({
      markdownlint: { default: false, MD003: { style: "setext_with_atx_closed" } },
    });
    expect(format("Title\n=====\n\n### Sub ###\n", { config: headings.config }).output).toBe(
      "Title\n=====\n\n### Sub ###\n",
    );
  });
  it.each(["one", "zero"])("reports unsupported MD029 start %s without changing it", (style) => {
    const lists = convertConfig({ markdownlint: { default: false, MD029: { style } } });
    expect(lists.omitted.join(" ")).toContain("required start number");
    expect(format("3. a\n3. b\n", { config: lists.config }).output).toBe("3. a\n3. b\n");
  });
  it("expands every documented tag in source order", () => {
    for (const tag of new Set(competitorMappings.flatMap((row) => row.tags ?? []))) {
      const rows = competitorMappings.filter((row) => row.tags?.includes(tag));
      const expanded = Object.fromEntries(rows.map((row) => [row.source, true]));
      expect(
        convertConfig({ markdownlint: { default: false, [tag.toUpperCase()]: true } }).config,
      ).toEqual(convertConfig({ markdownlint: { default: false, ...expanded } }).config);
    }
    expect(convertConfig({ markdownlint: { default: false, "single-h1": true } }).config).toEqual(
      convertConfig({ markdownlint: { default: false, MD025: true } }).config,
    );
  });
});
