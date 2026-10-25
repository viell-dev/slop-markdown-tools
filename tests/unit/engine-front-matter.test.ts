import { describe, expect, it } from "vitest";
import { format, parse, createWorkspace, semanticFingerprint, dialects } from "../../src/index.js";
import type { Config, Diagnostic, Dialect, Plugin, ProcessOptions } from "../../src/index.js";
import { formatted } from "../support/engine.js";
// VitePress uses gray-matter boundaries, tested with its actual renderer.
const frontMatterDialects = dialects.filter((dialect) => dialect !== "vitepress");

describe("front matter that would end inside a code block", () => {
  // The front matter extension ends front matter at the next `---` or `+++`
  // line, also one inside a code block that a line of the front matter opens.
  // GitHub's comments read the code block there, and GitHub's file view and
  // site generators read the front matter (issue #295).
  const fence = "```";
  const yaml = `---\ntitle: x\n...\n\n${fence}\na\n---\n___\n${fence}\n`;
  const tildes = "---\n\nIntro.\n\n~~~\n---\n***\n~~~\n";
  const toml = `+++\n\nIntro.\n\n${fence}\n+++\n***\n${fence}\n\nText *a*.\n`;
  const preset = (dialect: Dialect): ProcessOptions => ({
    config: {
      extends: dialect === "commonmark" ? ["recommended"] : ["recommended", dialect],
      dialect,
    },
    workspace: createWorkspace({}, { dialect, strictLineBreaks: true }),
  });
  const refusals = (result: { diagnostics: Diagnostic[] }) =>
    result.diagnostics
      .filter((item) => item.rule === "engine/unsafe-format")
      .map((item) => item.message);
  it.each(frontMatterDialects)(
    "reads the code block, not front matter, in the %s dialect",
    (dialect) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const [source, code] of [
          [yaml, "a\n---\n___"],
          [tildes, "---\n***"],
          [toml, "+++\n***"],
          // A fence indented by up to three spaces opens a code block too.
          [`---\nkey: |\n  ${fence}js\n---\n___\n  ${fence}\n`, "---\n___"],
        ] as const) {
          const { children } = parse(source.replaceAll("\n", newline), dialect).tree;
          expect(children.map((node) => node.type)).not.toContain("yaml");
          expect(children.map((node) => node.type)).not.toContain("toml");
          const block = children.find((node) => node.type === "code");
          expect(block && "value" in block && block.value.replaceAll(newline, "\n")).toBe(code);
        }
    },
  );
  it.each(frontMatterDialects)(
    "keeps the code and the front matter as written with the recommended preset in the %s dialect",
    (dialect) => {
      // `style/thematic-break` used to change the code's `___` and `***`, and
      // `style/code-fence` the closing `~~~`. Joining `title: x` and `...` would
      // make the front matter that GitHub's file view shows invalid YAML, and a
      // fence written with backticks would end it there.
      let result = format(yaml, preset(dialect));
      expect(result.output).toBe(yaml);
      expect(refusals(result)).toEqual([
        "style/wrap would change the parsed meaning at line 1; none of its edits were applied.",
      ]);
      result = format(tildes, preset(dialect));
      expect(result.output).toBe(tildes);
      expect(refusals(result)).toEqual([
        "style/code-fence would change the parsed meaning at line 1; none of its edits were applied.",
      ]);
      // With front matter, the closing fence opens a code block that holds `*a*`.
      result = format(toml, preset(dialect));
      expect(result.output).toBe(toml);
      expect(refusals(result)).toEqual([
        "style/emphasis would change the parsed meaning at line 8; none of its edits were applied.",
      ]);
    },
  );
  it.each(frontMatterDialects)(
    "reads an HTML block or display math, not front matter, in the %s dialect",
    (dialect) => {
      // A line that opens an HTML block or display math is valid YAML, but
      // GitHub's comments read the block, and `***` in it is content.
      const html = "---\n<div>\n---\n***\n</div>\n";
      const math = "---\n$$\n---\n***\n$$\n";
      const cases: [string, string, string][] = [[html, "html", "<div>\n---\n***\n</div>"]];
      if (dialect !== "commonmark") cases.push([math, "math", "---\n***"]);
      for (const [source, type, value] of cases) {
        const { children } = parse(source, dialect).tree;
        expect(children.map((node) => node.type)).toEqual(["thematicBreak", type]);
        expect("value" in children[1]! && children[1].value).toBe(value);
        // `style/thematic-break` used to change the `***`, which is now content.
        const result = format(source, preset(dialect));
        expect(result.output).toBe(source);
        expect(refusals(result)).toEqual([]);
      }
    },
  );
  it.each(frontMatterDialects)("still reads other front matter in the %s dialect", (dialect) => {
    for (const [source, output] of [
      ["---\ntitle: x\n---\n\nText *a*.\n\n***\n", "---\ntitle: x\n---\n\nText _a_.\n\n---\n"],
      ["+++\ntitle = 'x'\n+++\n\nText *a*.\n", "+++\ntitle = 'x'\n+++\n\nText _a_.\n"],
      // A line that starts with `<` opens an HTML block that ends at a blank
      // line, or is a paragraph whose next line underlines it as a heading.
      ["---\n<x>\n\n---\n\nText *a*.\n", "---\n<x>\n\n---\n\nText _a_.\n"],
      ["---\n<b>x</b>\n---\n\nText *a*.\n", "---\n<b>x</b>\n---\n\nText _a_.\n"],
      // A fence indented in a YAML block scalar, and one that a multiline TOML
      // string opens and closes, are not code in the reading without front matter.
      [
        `---\nexample: |\n  ${fence}js\n  ---\n  ${fence}\n---\n\nText *a*.\n`,
        `---\nexample: |\n  ${fence}js\n  ---\n  ${fence}\n---\n\nText _a_.\n`,
      ],
      [
        `+++\ntext = """\n${fence}js\ncode\n${fence}\n"""\n+++\n\nText *a*.\n`,
        `+++\ntext = """\n${fence}js\ncode\n${fence}\n"""\n+++\n\nText _a_.\n`,
      ],
    ] as const) {
      expect(["yaml", "toml"]).toContain(parse(source, dialect).tree.children[0]!.type);
      expect(formatted(source, preset(dialect))).toBe(output);
    }
  });
});

describe("a first line that opens no front matter", () => {
  // Below a first line of `---` or `+++` that no line closes, the front matter
  // extension read lists and block quotes as paragraphs, and wrapping joined
  // them to the line above, which GitHub showed as text (issue #278).
  const types = (source: string, dialect: Dialect) =>
    parse(source, dialect).tree.children.map((node) => node.type);
  const preset = (dialect: Dialect, rules: Config["rules"] = {}): ProcessOptions => ({
    config: {
      extends: dialect === "commonmark" ? ["recommended"] : ["recommended", dialect],
      dialect,
      rules,
    },
    workspace: createWorkspace({}, { dialect, strictLineBreaks: true }),
  });
  it.each(frontMatterDialects)(
    "reads the lists and block quotes below it in the %s dialect",
    (dialect) => {
      const mark = String.fromCharCode(0xfeff);
      for (const newline of ["\n", "\r\n", "\r"])
        for (const before of ["", mark])
          for (const [source, children] of [
            ["---\n- One\n- Two\n", ["thematicBreak", "list"]],
            ["---\n\n> Quote\n", ["thematicBreak", "blockquote"]],
            ["---\ntitle: a\n\n* b\n", ["thematicBreak", "paragraph", "list"]],
            ["+++\nx = 1\n\n- item\n", ["paragraph", "list"]],
            // Spaces or tabs after the fence still let it open front matter.
            ["---  \n1. One\n", ["thematicBreak", "list"]],
            ["+++\t\n> Quote", ["paragraph", "blockquote"]],
            // A longer fence, an indented one, or the other one closes nothing.
            ["---\n- a\n----\n", ["thematicBreak", "list", "thematicBreak"]],
            ["---\n- a\n ---\n", ["thematicBreak", "list", "thematicBreak"]],
            ["+++\n- a\n---\n", ["paragraph", "list", "thematicBreak"]],
          ] as const)
            expect(types(before + source.replaceAll("\n", newline), dialect)).toEqual(children);
    },
  );
  it.each(frontMatterDialects)(
    "still reads front matter that a line closes in the %s dialect",
    (dialect) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const [source, children] of [
          ["---\n---\n* b\n", ["yaml", "list"]],
          ["---  \ntitle: a\n---\t\n* b\n", ["yaml", "list"]],
          ["+++\nx = 1\n+++", ["toml"]],
          ["---\n- a\n---", ["yaml"]],
        ] as const)
          expect(types(source.replaceAll("\n", newline), dialect)).toEqual(children);
    },
  );
  it.each(frontMatterDialects)(
    "keeps the lists and block quotes below it with the recommended preset in the %s dialect",
    (dialect) => {
      for (const [source, output] of [
        ["+++\n- a\n\n+++ b\n", "+++\n\n- a\n\n+++ b\n"],
        ["---\nText\n- One\n", "---\nText\n\n- One\n"],
        ["---\nText\n> *quote*\n", "---\nText\n> _quote_\n"],
        ["---\ntitle: a\n1) One\n", "---\ntitle: a\n\n1. One\n"],
      ] as const)
        expect(formatted(source, preset(dialect))).toBe(dialect === "obsidian" ? source : output);
    },
  );
  it.each(frontMatterDialects)(
    "writes no line of --- alone below it in the %s dialect",
    (dialect) => {
      // Live Preview shows all of an unclosed YAML document as source (#404).
      if (dialect === "obsidian") {
        const source = "---\n\nText *a*.\n\n***\n\n___\n";
        expect(formatted(source, preset(dialect))).toBe(source);
        return;
      }
      // Such a line would close the front matter, and the safety check refused
      // every edit of the rule that wrote it.
      expect(formatted("---\n\nText *a*.\n\n***\n\n___\n", preset(dialect))).toBe(
        "---\n\nText _a_.\n\n***\n\n___\n",
      );
      const setext = preset(dialect, { "style/heading": ["warn", { style: "setext" }] });
      expect(formatted("---\n\n## Foo\n\nText.\n", setext)).toBe("---\n\nFoo\n----\n\nText.\n");
      // A break that is not at the start of its line closes nothing, and `---`
      // does not close front matter that `+++` opens.
      expect(formatted("---\n\n> ***\n", preset(dialect))).toBe("---\n\n> ---\n");
      expect(formatted("+++\n\n***\n", preset(dialect))).toBe("+++\n\n---\n");
      // The first line itself takes the configured marker.
      const stars = preset(dialect, { "style/thematic-break": ["warn", { marker: "***" }] });
      expect(formatted("---\n\nText.\n", stars)).toBe("***\n\nText.\n");
    },
  );
});

describe("unclosed YAML front matter in Obsidian", () => {
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "---\n# a\n\n- b *c*\n\nd #e with enough words to wrap across several lines\n",
    "---\n\na *b*\n\n--- c\nd *e*\n",
    "---\n\nText *a*",
    "---  \n\nText *a*\n",
    "---\t\n\nText *a*\n",
  ])("preserves the entire unsupported document %j", (input) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const mark of ["", String.fromCharCode(0xfeff)]) {
        const source = mark + input.replaceAll("\n", newline);
        const options = {
          config: {
            ...config,
            rules: {
              "style/wrap": ["warn", { width: 20 }],
              "style/thematic-break": ["warn", { marker: "***" }],
            },
          } satisfies Config,
          workspace,
        };
        expect(formatted(source, options)).toBe(source);
        expect(semanticFingerprint(parse(source, "obsidian"))).toBe(
          semanticFingerprint(parse(format(source, options).output, "obsidian")),
        );
      }
  });
  it("still formats below a proper closer and below an unclosed TOML fence", () => {
    expect(formatted("---\ntitle: a\n---\n\nText *a*\n", { config, workspace })).toBe(
      "---\ntitle: a\n---\n\nText _a_\n",
    );
    expect(formatted("+++\n\nText *a*\n", { config, workspace })).toBe("+++\n\nText _a_\n");
  });
  it("formats a standalone thematic break without treating it as YAML source", () => {
    const stars: Config = {
      ...config,
      rules: { "style/thematic-break": ["warn", { marker: "***" }] },
    };
    expect(formatted("---", { config: stars })).toBe("***\n");
    expect(formatted("---\n", { config: stars })).toBe("***\n");
  });
  it("also prevents plugin insertions at either end of the document", () => {
    const plugin: Plugin = {
      name: "boundary",
      rules: {
        newline: {
          kind: "style",
          description: "Insert a blank line at either boundary",
          check: ({ document }) =>
            [0, document.source.length].map((start) => ({
              start,
              message: "Blank line",
              edit: { start, end: start, text: "\n" },
            })),
        },
      },
    };
    const source = "---\nText";
    expect(
      formatted(source, {
        config: { extends: [], dialect: "obsidian", rules: { "boundary/newline": "warn" } },
        plugins: [plugin],
      }),
    ).toBe(source);
  });
});

describe("Obsidian's preservation of the reading without TOML front matter", () => {
  const config: Config = {
    extends: ["recommended", "obsidian"],
    dialect: "obsidian",
    rules: { "style/wrap": ["warn", { width: 20 }] },
  };
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  const matter = "+++\ntitle = 1\n+++\n";
  it.each([
    "| a | b |\n| --: | - |\n| c | d |\n",
    "[^1]: *words*\n\nx[^1]\n",
    "[^1]: first\n[^2]: *second*\n\nx[^1] y[^2]\n",
    "[r]: a *b* c\n",
    "\t\n| a | b |\n| - | - |\n| c | d |\n",
    "| a | b |\n| - | - |\n\t\nmore *words* below the table\n",
  ])("preserves the blocks that follow the paragraph reading in %j", (block) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = (matter + block).replaceAll("\n", newline);
      const output = formatted(source, { config, workspace });
      expect(output).toBe(source);
      expect(semanticFingerprint(parse(output, "obsidian"))).toBe(
        semanticFingerprint(parse(source, "obsidian")),
      );
      expect(formatted(source, { config: { extends: [], dialect: "obsidian" } })).toBe(source);
    }
  });
  it("still formats below a blank line and blocks that interrupt the paragraph", () => {
    expect(formatted(`${matter}\n| x |\n| - |\n| y |\n`, { config, workspace })).toBe(
      `${matter}\n| x   |\n| --- |\n| y   |\n`,
    );
    expect(formatted(`${matter}# Head *a* #\n`, { config, workspace })).toBe(
      `${matter}# Head _a_\n`,
    );
    expect(formatted(`${matter}- Item *a*\n`, { config, workspace })).toBe(`${matter}- Item _a_\n`);
  });
  it("does not apply Obsidian's table protection to other dialects", () => {
    expect(
      formatted(`${matter}| x |\n| - |\n| y |\n`, {
        config: { extends: ["recommended", "github"], dialect: "github" },
      }),
    ).toBe(`${matter}| x   |\n| --- |\n| y   |\n`);
  });
});

describe("the block directly below TOML front matter", () => {
  // Site generators read TOML front matter, and GitHub, Forgejo, Gitea,
  // Obsidian, commonmark.js, and markdown-it read its lines as a paragraph,
  // which the line below can continue or underline as a heading (issue #333).
  const matter = "+++\ntitle = 1\n+++\n";
  const preset = (dialect: Dialect, rules: Config["rules"] = {}): ProcessOptions => ({
    config: {
      extends: dialect === "commonmark" ? ["recommended"] : ["recommended", dialect],
      dialect,
      rules,
    },
    workspace: createWorkspace({}, { dialect, strictLineBreaks: true }),
  });
  it.each(frontMatterDialects)(
    "compares the reading without the front matter in the %s dialect",
    (dialect) => {
      for (const newline of ["\n", "\r\n", "\r"]) {
        const read = (source: string) =>
          semanticFingerprint(parse(source.replaceAll("\n", newline), dialect));
        expect(read(`${matter}* * *\n`)).not.toBe(read(`${matter}---\n`));
        expect(read(`${matter}candle\n-----\n`)).not.toBe(read(`${matter}## candle\n`));
        expect(read(`${matter}2) a\n`)).not.toBe(read(`${matter}2. a\n`));
        // Below a blank line, and with YAML front matter, the renderers read the
        // block as the parser does.
        expect(read(`${matter}\n* * *\n`)).toBe(read(`${matter}\n---\n`));
        expect(read("---\ntitle: 1\n---\n* * *\n")).toBe(read("---\ntitle: 1\n---\n---\n"));
      }
    },
  );
  it.each(frontMatterDialects)(
    "leaves a block that would join the front matter as written in the %s dialect",
    (dialect) => {
      const mark = String.fromCharCode(0xfeff);
      const setext = preset(dialect, {
        "style/heading": ["warn", { style: "setext" }],
        "style/thematic-break": ["warn", { marker: "***" }],
        "style/list-marker": ["warn", { marker: "+" }],
        "style/ordered-list": ["warn", { delimiter: ")" }],
      });
      for (const newline of ["\n", "\r\n", "\r"])
        for (const before of ["", mark]) {
          const kept = (block: string, options = preset(dialect)) => {
            const source = before + (matter + block).replaceAll("\n", newline);
            expect(formatted(source, options)).toBe(source);
          };
          // `style/thematic-break` wrote `---`, which underlines the front
          // matter's lines, and `style/heading` made them a paragraph above a
          // heading of its own.
          kept("* * *\n");
          kept("candle\n-----\n");
          kept("candle\n=====\n", setext);
          kept("---\n", setext);
          kept("## Head\n", setext);
          // A list that cannot interrupt a paragraph is text there.
          kept("2) a\n3) b\n");
          kept("1.\n2) b\n");
          kept("*\n* b\n");
          kept("-\n", setext);
        }
    },
  );
  it.each(frontMatterDialects)(
    "keeps a paragraph-ending empty marker above a misread list in the %s dialect (#426)",
    (dialect) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const before of ["", String.fromCharCode(0xfeff)]) {
          const source = before + (matter + "1.\n2) b\n").replaceAll("\n", newline);
          expect(formatted(source, preset(dialect))).toBe(source);
          expect(
            formatted(source, {
              config: { extends: [], dialect, rules: { "style/block-spacing": "warn" } },
            }),
          ).toBe(source);
        }
    },
  );
  it.each(frontMatterDialects)(
    "still formats what renderers read alike in the %s dialect",
    (dialect) => {
      const stars = preset(dialect, { "style/thematic-break": ["warn", { marker: "***" }] });
      const cases: [string, string, ProcessOptions?][] = [
        ["\n* * *\n", "\n---\n"],
        ["___\n", "***\n", stars],
        ["# Head #\n", "# Head\n"],
        ["Text *a*\n", "Text _a_\n"],
        ["* a\n+ b\n", "- a\n\n* b\n"],
        ["1) a\n1) b\n", "1. a\n1. b\n"],
        ["~~~\ncode\n~~~\n", "```\ncode\n```\n"],
      ];
      for (const [block, output, options = preset(dialect)] of cases)
        expect(formatted(matter + block, options)).toBe(matter + output);
    },
  );
  it("places a refusal where the reading with the front matter first differs", () => {
    // A change of meaning below the front matter changes both readings.
    const plugin: Plugin = {
      name: "probe",
      rules: {
        listing: {
          kind: "style",
          description: "Turn the paragraph More. into a list item",
          check: ({ document }) => {
            const start = document.source.indexOf("More.");
            return [{ start, message: "List", edit: { start, end: start, text: "- " } }];
          },
        },
      },
    };
    const result = format(`${matter}\nText.\n\nMore.\n`, {
      config: { extends: [], rules: { "probe/listing": "warn" } },
      plugins: [plugin],
    });
    expect(result.diagnostics.map((item) => item.message)).toContain(
      "probe/listing would change the parsed meaning at line 7; none of its edits were applied.",
    );
  });
});
