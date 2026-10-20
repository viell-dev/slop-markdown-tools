import { describe, expect, it, vi } from "vitest";
import { stringContaining } from "../assertions.js";
import { Ajv } from "ajv";
import * as syntax from "../../src/syntax/parse.js";
import { misreadLists } from "../../src/syntax/misread-lists.js";
import fc from "fast-check";
import type { Nodes } from "mdast";
import {
  format,
  lint,
  parse,
  presets,
  resolveConfig,
  createWorkspace,
  applyEdits,
  semanticFingerprint,
  ruleRegistry,
  canonicalDialect,
  validateConfig,
  builtInRules,
  configSchema,
  dialectAliases,
  dialects,
  range,
} from "../../src/index.js";
import type {
  Config,
  Diagnostic,
  Dialect,
  Document,
  Finding,
  Plugin,
  ProcessOptions,
  Rule,
  RuleContext,
} from "../../src/index.js";

const narrow: Config = {
  extends: ["recommended", "github"],
  rules: { "style/wrap": ["warn", { width: 35 }] },
};
function formatted(source: string, options: ProcessOptions = {}) {
  const result = format(source, options);
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  return result.output;
}
describe("formatting contracts", () => {
  it("parses unchanged source once per call, including no-op edits", () => {
    const plugin: Plugin = {
      name: "noop",
      rules: {
        same: {
          kind: "style",
          description: "Return an edit that changes nothing",
          check: ({ document }) => [
            {
              start: 0,
              message: "Same",
              edit: { start: 0, end: document.source.length, text: document.source },
            },
          ],
        },
      },
    };
    const spy = vi.spyOn(syntax, "parse");
    try {
      expect(format("A _short_ note.\n").output).toBe("A _short_ note.\n");
      expect(spy).toHaveBeenCalledTimes(1);
      const result = format("Other text.\n", {
        config: { extends: [], rules: { "noop/same": "warn" } },
        plugins: [plugin],
      });
      expect(result.output).toBe("Other text.\n");
      expect(result.changed).toBe(false);
      expect(result.diagnostics[0]?.rule).toBe("noop/same");
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
  it("locates many findings without rescanning the source for each one", () => {
    const source = Array.from({ length: 30000 }, (_, i) => `Paragraph ${i}.`).join("\n\n") + "\n";
    const plugin: Plugin = {
      name: "probe",
      rules: {
        lines: {
          kind: "problem",
          description: "Report every line start and the final offset",
          check: ({ document }) => {
            const findings = [{ start: 0, message: "line" }];
            for (
              let at = document.source.indexOf("\n");
              at >= 0;
              at = document.source.indexOf("\n", at + 1)
            )
              findings.push({ start: at + 1, message: "line" });
            findings.push({ start: document.source.length, message: "end" });
            return findings;
          },
        },
      },
    };
    const started = performance.now();
    const diagnostics = lint(source, {
      config: { extends: [], rules: { "probe/lines": "warn" } },
      plugins: [plugin],
    });
    // Generous for slow CI runners; the previous prefix-scanning code needed minutes here.
    expect(performance.now() - started).toBeLessThan(12000);
    expect(diagnostics).toHaveLength(60001);
    for (const item of diagnostics.filter((_, index) => index % 997 === 0 || index > 59998)) {
      const prefix = source.slice(0, item.start);
      expect([item.line, item.column]).toEqual([
        prefix.split("\n").length,
        item.start - prefix.lastIndexOf("\n"),
      ]);
    }
  });
  it.each([
    ["*a* and __b__ with a [missing](nowhere.md) link and ^dup\n\nText ^dup\n", "obsidian"],
    [
      "| a | b |\n|---|---|\n| 1 | 2 |\n\nA long paragraph that wraps twice at the narrow width used here.",
      "github",
    ],
    ["Already formatted.\n", "commonmark"],
    [
      "Term\n: Definition kept on its line.\n\nA long paragraph that wraps twice at the narrow width used here.",
      "forgejo",
    ],
    [
      "See __init__.py and *config*.py.\n\nTerm\n: Definition kept on its line.\n\nA long paragraph that wraps twice at the narrow width used here.",
      "gitea",
    ],
  ] as const)(
    "reports the same diagnostics after formatting as a lint of the output",
    (source, dialect) => {
      const workspace = createWorkspace(
        { "document.md": source },
        { dialect, strictLineBreaks: true },
      );
      const options: ProcessOptions = {
        config: {
          extends: ["recommended", dialect === "commonmark" ? "recommended" : dialect],
          dialect,
          rules: { "style/wrap": ["warn", { width: 30, reportUnreflowed: true }] },
        },
        workspace,
      };
      const result = format(source, options);
      expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
      expect(result.diagnostics).toEqual(lint(result.output, options));
    },
  );
  it("gives each phase and final diagnostics the latest accepted source and tree", () => {
    const observed: Array<[string, string]> = [];
    const plugin: Plugin = {
      name: "observer",
      rules: Object.fromEntries(
        (["inline", "block", "document"] as const).map((phase) => [
          phase,
          {
            kind: "style" as const,
            phase,
            description: "Observe phase input",
            check: ({ document }: RuleContext) => {
              expect(document.tree).toEqual(
                parse(document.source, document.dialect, document.path).tree,
              );
              observed.push([phase, document.source]);
              return [];
            },
          },
        ]),
      ),
    };
    const source = "A `one\ntwo` and many ordinary words to wrap here.";
    const options: ProcessOptions = {
      path: "note.md",
      plugins: [plugin],
      config: {
        extends: [],
        rules: {
          "style/inline-code": "warn",
          "style/wrap": ["warn", { width: 25 }],
          "style/final-newline": "warn",
          "observer/inline": "warn",
          "observer/block": "warn",
          "observer/document": "warn",
        },
      },
    };
    plugin.rules!.position = {
      kind: "problem",
      description: "Report final paragraph position",
      check: ({ document }) => {
        const node = document.tree.children[0]!;
        const end = node.position!.end.offset!;
        return [{ start: end - 5, end, message: "Final word" }];
      },
    };
    options.config = {
      ...options.config,
      rules: { ...options.config!.rules, "observer/position": "warn" },
    };
    const result = format(source, options);
    expect(observed.slice(0, 3)).toEqual([
      ["inline", source],
      ["block", "A `one two` and many ordinary words to wrap here."],
      ["document", "A `one two` and many\nordinary words to wrap\nhere."],
    ]);
    expect(result.output).toBe("A `one two` and many\nordinary words to wrap\nhere.\n");
    expect(observed.slice(-3).map(([, text]) => text)).toEqual(Array(3).fill(result.output));
    expect(result.diagnostics).toMatchObject([
      { rule: "observer/position", line: 3, column: 1, start: result.output.indexOf("here.") },
    ]);
    const { dialect } = resolveConfig({ config: options.config });
    expect(semanticFingerprint(parse(result.output, dialect))).toBe(
      semanticFingerprint(parse(source, dialect)),
    );
    expect(format(result.output, options).output).toBe(result.output);
  });
  it.each(["inline", "block", "document"] as const)(
    "still rejects unsafe edits in the %s phase",
    (phase) => {
      const plugin: Plugin = {
        name: "unsafe",
        rules: {
          replace: {
            kind: "style",
            phase,
            description: "Change meaning",
            check: () => [
              { start: 0, message: "Replace", edit: { start: 0, end: 4, text: "other" } },
            ],
          },
        },
      };
      const result = format("word\n", {
        config: { extends: [], rules: { "unsafe/replace": "warn" } },
        plugins: [plugin],
      });
      expect(result.output).toBe("word\n");
      expect(result.diagnostics).toMatchObject([
        {
          rule: "engine/unsafe-format",
          severity: "error",
          line: 1,
          message:
            "unsafe/replace would change the parsed meaning at line 1; none of its edits were applied.",
        },
        { rule: "unsafe/replace" },
      ]);
    },
  );
  it.each([
    // Issue #290: joins that `style/inline-code` used to make. GitHub shows
    // `foo `, `foo`, and `npm run    build` before them, and the text of the
    // joined span after.
    ["Text ` foo \n   ` end.\n", "` foo \n   `", "`foo  `"],
    ["Text `\n   foo\n   ` end.\n", "`\n   foo\n   `", "`    foo  `"],
    ["> Run `npm run\n   build` now.\n", "`npm run\n   build`", "`npm run build`"],
  ])("rejects an edit that changes what GitHub shows of a code span: %j", (source, span, text) => {
    const plugin: Plugin = {
      name: "join",
      rules: {
        span: {
          kind: "style",
          phase: "inline",
          description: "Join a code span",
          check: ({ document }) => {
            const start = document.source.indexOf(span);
            return [{ start, message: "Join", edit: { start, end: start + span.length, text } }];
          },
        },
      },
    };
    const result = format(source, {
      config: { extends: [], dialect: "github", rules: { "join/span": "warn" } },
      plugins: [plugin],
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics).toMatchObject([
      { rule: "engine/unsafe-format", severity: "error" },
      { rule: "join/span" },
    ]);
  });
  it.each([false, true])("retains convergence guards (oscillation: %s)", (oscillate) => {
    const plugin: Plugin = {
      name: "unstable",
      rules: {
        change: {
          kind: "style",
          description: "Never stabilize",
          check: ({ document }) => [
            {
              start: 0,
              message: "Change",
              edit: {
                start: 0,
                end: document.source.length,
                text: oscillate
                  ? document.source.startsWith("*")
                    ? "_word_\n"
                    : "*word*\n"
                  : document.source + "\n",
              },
            },
          ],
        },
      },
    };
    const result = format("*word*\n", {
      config: { extends: [], rules: { "unstable/change": "warn" } },
      plugins: [plugin],
    });
    expect(result.output).toBe("*word*\n");
    expect(result.diagnostics).toMatchObject([
      {
        rule: "engine/unsafe-format",
        message: `Formatting by unstable/change ${oscillate ? "oscillates" : "did not converge in eight passes"}; the document was left unchanged.`,
      },
    ]);
  });
  it("preserves genuine lists following prose", () => {
    const source = "Some items follow\n- First item\n- Second item\n";
    expect(formatted(source)).toBe("Some items follow\n\n- First item\n- Second item\n");
  });
  it("reflows prose while protecting inline code and link destinations", () => {
    const source =
      "A *small* paragraph with `some inline code` and [a link](https://example.test/path) followed by more words.\n";
    // The link's text wraps like other text; its destination stays attached.
    expect(formatted(source, { config: narrow })).toBe(
      "A _small_ paragraph with\n`some inline code` and [a\nlink](https://example.test/path)\nfollowed by more words.\n",
    );
  });
  it.each([
    "- A fairly long paragraph inside a list item that requires wrapping with the correct indentation.\n",
    "> A fairly long paragraph inside a blockquote that requires wrapping with the correct quotation prefix.\n",
    "> - A fairly long paragraph inside a quoted list that requires wrapping without changing structure.\n",
    "- [X] A fairly long task item that requires wrapping while retaining its completed state.\n",
    "A sentence about numbers 1. and 2. and the literal symbols # and > that must stay ordinary prose.\n",
    "Use ``an `embedded` backtick`` and more words in a long line to exercise code span preservation.\n",
    "Escaped \\*literal\\* syntax and &amp; entities remain spelled the same after a paragraph is reflowed.\n",
  ])("preserves semantics in containers and inline syntax: %s", (source) => {
    const output = formatted(source, { config: narrow });
    expect(semanticFingerprint(parse(output, "github"))).toBe(
      semanticFingerprint(parse(source, "github")),
    );
  });
  it("preserves explicit hard breaks, front matter, code, and HTML", () => {
    const source =
      "---\ntitle: '*unchanged*'\n---\n\n```md\n*code* and [link](missing.md)\n```\n\nAn explicit break.  \nAnother line.\n\n<div>\n*raw*\n</div>\n";
    expect(formatted(source)).toBe(source);
  });
  it.each(["\n", "\r\n"])("joins multiline inline code during reflow (%j)", (newline) => {
    const source = `Keep this paragraph and its long command \`first line${newline}second line\` intact.${newline}`;
    expect(formatted(source, { config: narrow })).toBe(
      ["Keep this paragraph and its long", "command `first line second line`", "intact.", ""].join(
        newline,
      ),
    );
    // A space at the start of the code span's next line is kept by the parser
    // but dropped by GitHub, and by the joined span.
    const indented = source.replace(`${newline}second`, `${newline} second`);
    expect(formatted(indented, { config: narrow })).toBe(formatted(source, { config: narrow }));
  });
  it("does not lint links in multi-backtick code spans", () => {
    const source = "``[link](missing.md)``\n";
    const workspace = createWorkspace({ "note.md": source });
    expect(lint(source, { workspace, path: "note.md" })).toEqual([]);
  });
  it("preserves disabled style choices", () => {
    const source =
      "A *small* paragraph that needs to be wrapped into multiple lines without changing its emphasis.\n";
    const output = formatted(source, {
      config: { ...narrow, rules: { ...narrow.rules, "style/emphasis": "off" } },
    });
    expect(output).toContain("*small*");
    expect(output).not.toBe(source);
    expect(formatted(source, { config: { extends: [] } })).toBe(source);
  });
  it("preserves CRLF when editing", () => {
    expect(formatted("A *small* paragraph.\r\n")).toBe("A _small_ paragraph.\r\n");
  });
  it("keeps a byte order mark and edits the text after it", () => {
    const mark = String.fromCharCode(0xfeff);
    const source = `${mark}First paragraph.\n\nA *b* c.\n`;
    expect(formatted(source)).toBe(`${mark}First paragraph.\n\nA _b_ c.\n`);
    // Positions count the mark, so that edits apply to the text as given; the
    // first visible character of a line is still in column 1.
    const diagnostics = lint(source);
    expect(diagnostics.map(({ rule, start, line, column }) => [rule, start, line, column])).toEqual(
      [
        ["style/emphasis", 21, 3, 3],
        ["style/emphasis", 23, 3, 5],
      ],
    );
    expect(
      applyEdits(
        source,
        diagnostics.flatMap((item) => item.edit ?? []),
      ),
    ).toBe(`${mark}First paragraph.\n\nA _b_ c.\n`);
    expect(lint(`${mark}A *b* c.\n`).map(({ start, column }) => [start, column])).toEqual([
      [3, 3],
      [5, 5],
    ]);
    // A heading's blank line stays, and a paragraph wrapped on the first line
    // does not repeat the mark at the start of its other lines.
    expect(formatted(`${mark}# Heading\n\nSome *emphasis* here.\n`)).toBe(
      `${mark}# Heading\n\nSome _emphasis_ here.\n`,
    );
    expect(
      formatted(`${mark}A paragraph on the first line that is long enough to wrap.\n`, {
        config: narrow,
      }),
    ).toBe(`${mark}A paragraph on the first line that\nis long enough to wrap.\n`);
    // Front matter after the mark is still front matter.
    expect(formatted(`${mark}---\ntitle: *x*\n---\n\nA *b* c.\n`)).toBe(
      `${mark}---\ntitle: *x*\n---\n\nA _b_ c.\n`,
    );
    // Two marks, as a program that adds one without looking can leave them.
    expect(formatted(`${mark}${mark}A *b* c.\n`)).toBe(`${mark}${mark}A _b_ c.\n`);
    // The document that rules see starts after the marks, where the tree's positions count from.
    const document = parse(`${mark}${mark}# Title\n`, "github");
    expect(document.source).toBe("# Title\n");
    expect(document.tree.children[0]!.position!.start.offset).toBe(0);
  });
  it("leaves intraword emphasis valid", () => {
    expect(formatted("foo*bar*baz\n")).toBe("foo*bar*baz\n");
  });
  it("aligns tables without changing disabled inline style", () => {
    const input = "| A | B |\n| :- | -: |\n| *wide text* | `a\\|b` |\n";
    const output = formatted(input, {
      config: { extends: ["github"], rules: { "style/emphasis": "off" } },
    });
    expect(output).toContain("*wide text*");
    expect(output).toContain("`a\\|b`");
    expect(output).not.toBe(input);
  });
  it("aligns short rows without adding cells", () => {
    const config: Config = { extends: ["github"] };
    expect(formatted("| a | b |\n|---|---|\n| only |\n", { config })).toBe(
      "| a    | b   |\n| ---- | --- |\n| only |\n",
    );
    // A line after a table without a blank line is a one-cell row.
    expect(formatted("| a | b |\n|---|---|\n| x | y |\nnot a row\n", { config })).toBe(
      "| a         | b   |\n| --------- | --- |\n| x         | y   |\n| not a row |\n",
    );
    expect(formatted("| a | b | c |\n|---|:-:|--:|\n| 1 |\n| 1 | 22 |\n", { config })).toBe(
      "| a   | b   | c   |\n| --- | :-: | --: |\n| 1   |\n| 1   | 22  |\n",
    );
  });
  it("normalizes GitHub alerts and preserves math and footnotes", () => {
    const source =
      "> [!note]\n> Some details.\n\n$x + y$ and ~~removed~~ with a note[^a].\n\n[^a]: *Reference*.\n";
    expect(formatted(source, { config: { extends: ["recommended", "github"] } })).toContain(
      "> [!NOTE]",
    );
  });
  it("has property-tested idempotence and semantic preservation for varied prose widths", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            "alpha",
            "bravo",
            "éclair",
            "日本語",
            "🙂",
            "*italic*",
            "`code span`",
            "[a](https://example.test)",
          ),
          { minLength: 1, maxLength: 70 },
        ),
        fc.integer({ min: 20, max: 110 }),
        (words, width) => {
          const source = words.join(" ") + "\n";
          const options = {
            config: { extends: ["recommended"], rules: { "style/wrap": ["warn", { width }] } },
          } satisfies ProcessOptions;
          const output = formatted(source, options);
          const { dialect } = resolveConfig({ config: options.config });
          expect(semanticFingerprint(parse(output, dialect))).toBe(
            semanticFingerprint(parse(source, dialect)),
          );
        },
      ),
      { numRuns: 120, seed: 20260918 },
    );
  });
});

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
  it.each(dialects)("reads the code block, not front matter, in the %s dialect", (dialect) => {
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
  });
  it.each(dialects)(
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
  it.each(dialects)(
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
  it.each(dialects)("still reads other front matter in the %s dialect", (dialect) => {
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
  it.each(dialects)("reads the lists and block quotes below it in the %s dialect", (dialect) => {
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
  });
  it.each(dialects)("still reads front matter that a line closes in the %s dialect", (dialect) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const [source, children] of [
        ["---\n---\n* b\n", ["yaml", "list"]],
        ["---  \ntitle: a\n---\t\n* b\n", ["yaml", "list"]],
        ["+++\nx = 1\n+++", ["toml"]],
        ["---\n- a\n---", ["yaml"]],
      ] as const)
        expect(types(source.replaceAll("\n", newline), dialect)).toEqual(children);
  });
  it.each(dialects)(
    "keeps the lists and block quotes below it with the recommended preset in the %s dialect",
    (dialect) => {
      for (const [source, output] of [
        ["+++\n- a\n\n+++ b\n", "+++\n\n- a\n\n+++ b\n"],
        ["---\nText\n- One\n", "---\nText\n\n- One\n"],
        ["---\nText\n> *quote*\n", "---\nText\n> _quote_\n"],
        ["---\ntitle: a\n1) One\n", "---\ntitle: a\n\n1. One\n"],
      ] as const)
        expect(formatted(source, preset(dialect))).toBe(
          dialect === "obsidian" && source.startsWith("---") ? source : output,
        );
    },
  );
  it.each(dialects)("writes no line of --- alone below it in the %s dialect", (dialect) => {
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
  });
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

describe("HTML comments that Live Preview continues across blocks", () => {
  const config: Config = {
    extends: ["recommended", "obsidian"],
    dialect: "obsidian",
    rules: { "style/wrap": ["warn", { width: 20 }] },
  };
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a <!-- b\n\n> - c --> d e f g h i j k l m n o p q r s\n>   t u\n",
    "a <!-- b\n\n> - c\n>   --> d e f g h i j k l m n o p q r s\n",
    "a <!-- b\n\n> - c *d* e f g h i j k l m n o p q r s\n",
    "a *b <!-- c*\n\n# d *e*\n\nf --> g *h*\n",
    "a ==b <!-- c==\n\nd *e*\n\nf --> g *h*\n",
    "a [b <!-- c](https://example.org)\n\nd *e*\n\nf --> g *h*\n",
    "a ![b <!-- c](image.png)\n\nd *e*\n\nf --> g *h*\n",
    "a <!-- b\n\n```\nc --> d\n```\n",
    "a <!-- b\n\nc --> d <!-- e\n\nf *g*\n",
    "a ==b <!-- nested <!-- c --> d <!-- e==\n\nf *g*\n",
  ])("keeps the comment and its closing block in %j", (input) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = input.replaceAll("\n", newline);
      const output = formatted(source, { config, workspace });
      expect(output).toBe(source);
      expect(semanticFingerprint(parse(output, "obsidian"))).toBe(
        semanticFingerprint(parse(source, "obsidian")),
      );
      expect(formatted(source, { config: { extends: [], dialect: "obsidian" } })).toBe(source);
    }
  });
  it.each([
    ["a <!-- b --> *c*\n", "a <!-- b --> _c_\n"],
    ["a \\<!-- b *c*\n", "a \\<!-- b _c_\n"],
    ["a `<!--` b *c*\n", "a `<!--` b _c_\n"],
    ["```\na <!-- b\n```\n\nc *d*\n", "```\na <!-- b\n```\n\nc _d_\n"],
    ["a <!-- b\n\nc --> d\n\ne *f*\n", "a <!-- b\n\nc --> d\n\ne _f_\n"],
    ["a <!-- b\n\nc --> d\n\ne <!-- f\n\ng *h*\n", "a <!-- b\n\nc --> d\n\ne <!-- f\n\ng *h*\n"],
  ])("still formats independent text in %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("leaves other dialects unchanged", () => {
    expect(
      formatted("a <!-- b\n\nc *d*\n", {
        config: { extends: ["recommended", "github"], dialect: "github" },
      }),
    ).toBe("a <!-- b\n\nc _d_\n");
  });
  describe("comments opened by headings and tables", () => {
    const openers = [
      "# Head *a* <!-- open #\n",
      "Head *a* <!-- open\n===\n",
      "| A | B |\n| - | - |\n| x <!-- open | y |\n",
      "| <!-- open | A |\n| - | - |\n| x | y |\n",
    ];
    const closers = [
      "\n> alpha --> beta *gamma* delta epsilon zeta eta theta iota\n> more words\n",
      "\n* alpha --> beta *gamma* delta epsilon zeta eta theta iota\n  more words\n",
      "\n> alpha *beta* gamma delta epsilon zeta eta theta iota\n",
    ];
    it.each(openers)("keeps all of the opening and closing blocks after %j", (opener) => {
      for (const closer of closers)
        for (const newline of ["\n", "\r\n", "\r"])
          for (const mark of ["", String.fromCharCode(0xfeff)]) {
            const source = mark + (opener + closer).replaceAll("\n", newline);
            const output = formatted(source, { config, workspace });
            expect(output).toBe(source);
            expect(semanticFingerprint(parse(output, "obsidian"))).toBe(
              semanticFingerprint(parse(source, "obsidian")),
            );
            expect(formatted(source, { config: { extends: [], dialect: "obsidian" } })).toBe(
              source,
            );
          }
    });
    it.each([
      "> # Head <!-- open\n>\n> * alpha --> beta *gamma* delta epsilon zeta eta\n>   more words\n",
      "* Head <!-- open\n  ===\n\n  > alpha --> beta *gamma* delta epsilon zeta eta\n  > more words\n",
      "> | A | B |\n> | - | - |\n> | x <!-- open | y |\n>\n> * alpha --> beta *gamma* delta epsilon zeta eta\n>   more words\n",
      "* | A | B |\n  | - | - |\n  | x <!-- open | y |\n\n  > alpha --> beta *gamma* delta epsilon zeta eta\n  > more words\n",
    ])("keeps container markers around %j", (source) => {
      expect(formatted(source, { config, workspace })).toBe(source);
    });
    it.each(openers)("still formats an independent block after the comment in %j", (opener) => {
      const kept = `${opener}\n> alpha --> beta *gamma*\n`;
      expect(formatted(`${kept}\nIndependent *text*.\n`, { config, workspace })).toBe(
        `${kept}\nIndependent _text_.\n`,
      );
    });
    it.each([
      ["# Head <!-- open #\n\nText *a*\n", "# Head <!-- open\n\nText _a_\n"],
      ["Head <!-- open\n===\n\nText *a*\n", "# Head <!-- open\n\nText _a_\n"],
      ["| x <!-- open |\n| - |\n\nText *a*\n", "| x <!-- open |\n| ----------- |\n\nText _a_\n"],
    ])("does not extend Obsidian's protection to other dialects in %j", (source, output) => {
      expect(
        formatted(source, {
          config: { extends: ["recommended", "github"], dialect: "github" },
        }),
      ).toBe(output);
    });
    it.each([
      ["# Head <!-- closed --> *a* #\n", "# Head <!-- closed --> _a_\n"],
      ["Head <!-- closed --> *a*\n===\n", "# Head <!-- closed --> _a_\n"],
      ["# Head \\<!-- open *a* #\n", "# Head \\<!-- open _a_\n"],
      ["Head \\<!-- open *a*\n===\n", "# Head \\<!-- open _a_\n"],
      ["# Head `<!--` *a* #\n", "# Head `<!--` _a_\n"],
      ["Head `<!--` *a*\n===\n", "# Head `<!--` _a_\n"],
    ])("still formats closed, escaped, and code openers in %j", (source, output) => {
      expect(formatted(`${source}\nText *b*\n`, { config, workspace })).toBe(
        `${output}\nText _b_\n`,
      );
    });
    it.each(["<!-- closed -->", "\\<!-- open", "`<!--`"])(
      "still aligns a table containing %j and formats the block below it",
      (content) => {
        const source = `| ${content} | x |\n| - | - |\n| y | z |\n\nText *a*\n`;
        const obsidian = formatted(source, { config, workspace });
        const github = formatted(source, {
          config: { extends: ["recommended", "github"], dialect: "github" },
        });
        expect(obsidian).toBe(github);
        expect(obsidian).not.toBe(source);
        expect(obsidian.endsWith("\nText _a_\n")).toBe(true);
      },
    );
    it("detects a later opener after a same-table closer in a different cell", () => {
      const source = "| <!-- first | --> <!-- second |\n| - | - |\n| x | y |\n\nText *a*\n";
      expect(formatted(source, { config, workspace })).toBe(source);
    });
    it("applies only the enabled rule outside the protected heading", () => {
      const kept = "Head *a* <!-- open\n===\n\nText --> *b*\n\n";
      const headingOnly: Config = {
        extends: [],
        dialect: "obsidian",
        rules: { "style/heading": "warn" },
      };
      expect(formatted(`${kept}Other *c*\n===\n`, { config: headingOnly })).toBe(
        `${kept}# Other *c*\n`,
      );
    });
    it.each([
      "# Head *a* <!-- open\n\nText *b*",
      "Head *a* <!-- open\n===\n\nText *b*",
      "| A | B |\n| - | - |\n| x <!-- open | y |\n\nText *b*",
    ])("keeps final block text without a closer in %j", (source) => {
      // Isolate the block protection from the existing EOF-newline policy.
      const withoutNewline: Config = {
        ...config,
        rules: { ...config.rules, "style/final-newline": "off" },
      };
      expect(formatted(source, { config: withoutNewline, workspace })).toBe(source);
    });
  });
  it("skips nested comment openers in time proportional to their number", () => {
    // #418: every nested opener searched the same suffix for the same closer.
    // Time only range discovery, on distinct trees so the cache cannot hide it.
    const sizes = [4000, 16000];
    const prepare = (count: number) => parse(`==${"a <!-- ".repeat(count)}b -->==\n`, "obsidian");
    // Warm both workloads on other documents, so the first large sample is
    // not also a cold compilation sample. Every timed call still has a fresh tree.
    for (let round = 0; round < 5; round++)
      for (const size of sizes) expect(misreadLists(prepare(size)).commentText.size).toBe(0);
    const elapsed = (documents: Document[]) => {
      const results = [];
      const started = performance.now();
      for (const document of documents) results.push(misreadLists(document));
      const duration = performance.now() - started;
      for (const result of results) expect(result.commentText.size).toBe(0);
      return duration;
    };
    const calibration = Math.min(...Array.from({ length: 3 }, () => elapsed([prepare(sizes[0]!)])));
    // Use the same bounded batch size for both inputs. Parsing is outside the
    // timed section; the cap bounds the cost of constructing distinct trees.
    const calls = Math.max(1, Math.min(32, Math.ceil(25 / calibration)));
    const fastest = [Infinity, Infinity];
    for (let round = 0; round < 4; round++) {
      const documents = sizes.map((size) => Array.from({ length: calls }, () => prepare(size)));
      for (const index of round % 2 ? [1, 0] : [0, 1])
        fastest[index] = Math.min(fastest[index]!, elapsed(documents[index]!));
    }
    // Four times the input should take about four times the work, not sixteen.
    // Paired batches alternate their order and keep the existing scaling bound.
    expect(fastest[1]! / fastest[0]!).toBeLessThan(10);
  }, 120_000);
});

describe("text that the parser read in place of a list", () => {
  // micromark reads a list that does not start at 1, or an empty item, as text
  // at the start of a list item, block quote, or footnote definition below a
  // paragraph, and after an indented code block, where renderers read a list
  // (issue #191). The safety check compares the parser's readings, so it
  // cannot see what an edit there does to the renderers' list.
  const texts = (source: string, dialect: Dialect = "github") => {
    const document = parse(source, dialect);
    const { text, nested, next } = misreadLists(document);
    const sources = (nodes: ReadonlySet<Nodes>) =>
      [...nodes].map((node) => source.slice(...range(node)));
    return { text: sources(text), nested: sources(nested), next: sources(next) };
  };
  it.each(dialects)("finds text that starts with a list marker in the %s dialect", (dialect) => {
    for (const [source, found] of [
      // After an indented code block, any list marker that cannot interrupt a paragraph.
      ["    code\n\n2. Two\n", "2. Two"],
      ["    code\n\n0. x\n", "0. x"],
      ["    code\n\n123456789. x\n", "123456789. x"],
      ["    code\n\n2) x\n", "2) x"],
      ["    code\n\n2.\tx\n", "2.\tx"],
      ["    code\n\n   2. x\n", "2. x"],
      ["    code\n\n2.\n", "2."],
      ["    code\n\n-\n", "-"],
      ["    code\n\n*\n", "*"],
      ["    code\n\n+\r\n", "+"],
      // At the start of a list item or quote below a paragraph, also nested.
      ["Text\n- 2. Step\n", "2. Step"],
      ["Text\n- -\n", "-"],
      ["Text\n- 1.\n", "1."],
      ["Text\n> 2. a\n", "2. a"],
      ["Text\n>   2. a\n", "2. a"],
      ["Text\n- > 3. b\n", "3. b"],
      ["Text\n1. 2) a\n", "2) a"],
      ["Text\n- - 2. x\n", "2. x"],
      // Underlined, which renderers read as a list and a thematic break.
      ["    code\n\n2. a\n---\n", "2. a\n---"],
      // Below a link reference definition, where only markdown-it reads a list.
      ["[a]: /b\n2. x\n", "2. x"],
      ["[a]: /b\n2. x\n---\n", "[a]: /b\n2. x\n---"],
    ] as const)
      expect(texts(source, dialect).text, JSON.stringify(source)).toEqual([found]);
  });
  it.each(dialects)("finds no such text elsewhere in the %s dialect", (dialect) => {
    for (const source of [
      // Lines that continue a paragraph, which the parser and renderers read alike.
      "Text\n2. Two\n",
      "Text\n- a\n2) b\n-\n",
      // No list marker: ten digits, no space after it, an escape, or a reference.
      "    code\n\n1234567890. x\n",
      "    code\n\n2.x\n",
      "    code\n\n-x\n",
      "    code\n\n2\\. x\n",
      "    code\n\n&#50;. x\n",
      // Lists that the parser reads, and headings with `#`.
      "    code\n\n1. x\n",
      "    code\n\n- x\n",
      "```\ncode\n```\n2. x\n",
      "# 2. x\n",
      // Forgejo's and Gitea's definition descriptions and display math.
      "Term\n\n: 2. Definition\n",
      "    code\n\n\\[ 2. \\]\n",
    ])
      expect(texts(source, dialect), JSON.stringify(source)).toEqual(
        // Live Preview starts a list at `2. Two` there (issue #375).
        dialect === "obsidian" && source === "Text\n2. Two\n"
          ? { text: ["Text\n2. Two"], nested: [], next: [] }
          : { text: [], nested: [], next: [] },
      );
  });
  it.each(["github", "forgejo", "gitea", "obsidian"] as const)(
    "finds such text in a footnote definition but not after a checkbox in the %s dialect",
    (dialect) => {
      expect(texts("Text\n[^1]: 2. x\n\nA[^1]\n", dialect).text).toEqual(["2. x"]);
      // A task item's text starts with its checkbox, which renderers read as text.
      expect(texts("Text\n- [ ] 2. x\n- [x] -\n", dialect).text).toEqual([]);
    },
  );
  it("finds the blocks below such text that renderers may read as part of its list", () => {
    // Blocks that start further right are in the list's last item for renderers,
    // and the block after them can continue the list.
    expect(texts("    code\n\n2. Two\n   - Sub\n\n   More\n1) Three\n\nEnd\n")).toEqual({
      text: ["2. Two"],
      nested: ["- Sub", "More"],
      next: ["1) Three"],
    });
    expect(texts("Text\n- 2. Step\n     1) Next\n\n  Below\n")).toEqual({
      text: ["2. Step"],
      nested: ["1) Next"],
      next: ["Below"],
    });
    expect(texts("Text\n> 2. a\n> 1) b\n")).toEqual({
      text: ["2. a"],
      nested: [],
      next: ["1) b"],
    });
    // Renderers read a `===` below such text as text, which the next line continues
    // and a `---` would underline.
    expect(texts("    code\n\n2. a\n===\nnext\n")).toEqual({
      text: ["2. a\n===", "next"],
      nested: [],
      next: ["next"],
    });
    expect(texts("Text\n> 1.\n> ===\n> ---\n")).toEqual({
      text: ["1.\n> ==="],
      nested: ["---"],
      next: [],
    });
    // Below the list item or quote that such text ends, renderers continue it
    // lazily into text on the next line (issue #343), but into no other block.
    expect(texts("    code\n\n- 2. q\n  ===\n===\n").text).toEqual(["2. q\n  ===", "==="]);
    expect(texts("Text\n> 2. q\n> ===\n===\n").text).toEqual(["2. q\n> ===", "==="]);
    expect(texts("    code\n\n- 2. q\n  ===\n# H\n")).toEqual({
      text: ["2. q\n  ==="],
      nested: [],
      next: [],
    });
  });

  /**
   * A style rule of `phase` that writes two spaces for the first space of each
   * paragraph and heading, which changes nothing that the parser reads.
   */
  const probe = (phase: NonNullable<Rule["phase"]>): Plugin => ({
    name: "probe",
    rules: {
      edit: {
        kind: "style",
        phase,
        description: "Widen the first space of every paragraph and heading",
        check: ({ document: { source, tree } }) => {
          const findings: Finding[] = [];
          const visit = (node: Nodes) => {
            if (node.type === "paragraph" || node.type === "heading") {
              const [start, end] = range(node);
              const at = source.indexOf(" ", start);
              if (at >= 0 && at < end && source[at + 1] !== " ")
                findings.push({
                  start,
                  message: "Widen",
                  edit: { start: at, end: at + 1, text: "  " },
                });
            } else if ("children" in node) for (const child of node.children) visit(child);
          };
          visit(tree);
          return findings;
        },
      },
    },
  });
  it.each(["inline", "block", "document"] as const)(
    "leaves out the edits of a plugin's %s rule in such text, and their findings",
    (phase) => {
      const options = {
        config: { extends: [], rules: { "probe/edit": "warn" } } satisfies Config,
        plugins: [probe(phase)],
      };
      const source = "One two.\n\n    code\n\n2. Two three\n   Four five\n\nSix seven.\n";
      const result = format(source, options);
      expect(result.output).toBe(
        "One  two.\n\n    code\n\n2. Two three\n   Four five\n\nSix  seven.\n",
      );
      expect(result.diagnostics).toEqual([]);
      expect(lint(source, options).map((item) => item.line)).toEqual([1, 8]);
    },
  );
  it.each(dialects)("leaves such text as written with the presets in the %s dialect", (dialect) => {
    const options: ProcessOptions = {
      config: {
        extends: dialect === "commonmark" ? ["recommended"] : ["recommended", dialect],
        dialect,
        rules: { "style/wrap": ["warn", { width: 20 }] },
      },
      workspace: createWorkspace({}, { dialect, strictLineBreaks: true }),
    };
    for (const source of [
      // GitHub shows `*r*` as code in a list item: five spaces follow `0.`.
      "_\n- 0.     *r*\n",
      // GitHub shows a list and a thematic break, not a heading.
      "    code\n\n2. a\n---\n",
      "Text\n- 2. Step with *emphasis*  \n  and __strong__ text that goes on\n",
      // A list rule's one edit for the list would change the markers on both sides.
      "Text\n* -\n* b\n",
    ]) {
      expect(formatted(source, options), JSON.stringify(source)).toBe(source);
      expect(lint(source, options), JSON.stringify(source)).toEqual([]);
    }
    // The text after them is formatted as before.
    expect(formatted("Text\n> 2. *a*\n\n*b*\n", options)).toBe("Text\n> 2. *a*\n\n_b_\n");
  });
  it("applies an edit that copies such text and changes only what is before or after it", () => {
    const whole = (change: (source: string) => string): Plugin => ({
      name: "whole",
      rules: {
        edit: {
          kind: "style",
          description: "Edit the whole document",
          check: ({ document: { source } }) =>
            change(source) === source
              ? []
              : [
                  {
                    start: 0,
                    message: "Edit",
                    edit: { start: 0, end: source.length, text: change(source) },
                  },
                ],
        },
      },
    });
    const config: Config = { extends: [], rules: { "whole/edit": "warn" } };
    const source = "One *two*.\n\n    code\n\n2. *Three*\n\nFour *five*.\n";
    const first = (text: string) => text.replace("One *two*", "One _two_");
    const last = (text: string) => text.replace("Four *five*", "Four _five_");
    expect(formatted(source, { config, plugins: [whole(first)] })).toBe(first(source));
    expect(formatted(source, { config, plugins: [whole(last)] })).toBe(last(source));
    // Changes on both sides of it leave the edit out.
    const both = (text: string) => first(last(text));
    expect(formatted(source, { config, plugins: [whole(both)] })).toBe(source);
    expect(lint(source, { config, plugins: [whole(both)] })).toEqual([]);
  });
});

describe("definition descriptions on Forgejo and Gitea", () => {
  // Forgejo and Gitea read `Term` and a line `: …` below it as a definition
  // list, whose description holds blocks, and the blocks indented below it are
  // part of the description. The parser reads text there (issue #344).
  const forges = ["forgejo", "gitea"] as const;
  const preset = (dialect: Dialect): ProcessOptions => ({
    config: { extends: ["recommended", dialect], dialect },
    workspace: createWorkspace({}, { dialect, strictLineBreaks: true }),
  });
  const found = (source: string, dialect: Dialect) => {
    const { descriptions, nested } = misreadLists(parse(source, dialect));
    const sources = (nodes: ReadonlySet<Nodes>) =>
      [...nodes].map((node) => source.slice(...range(node)));
    return { descriptions: sources(descriptions), nested: sources(nested) };
  };
  it.each(forges)("finds a description and the blocks below it in the %s dialect", (dialect) => {
    expect(found("Term\n: 2. x\n", dialect)).toEqual({
      descriptions: ["Term\n: 2. x"],
      nested: [],
    });
    expect(found("Term\n: *a*\n  * b\n\n- c\n", dialect)).toEqual({
      descriptions: ["Term\n: *a*"],
      nested: ["* b"],
    });
    expect(found("> Term\n> :\tx\n>   1. y\n", dialect)).toEqual({
      descriptions: ["Term\n> :\tx"],
      nested: ["1. y"],
    });
    expect(found("Term\n\n: x\n", dialect).descriptions).toEqual([": x"]);
    expect(found("Term\nx: y\n", dialect).descriptions).toEqual([]);
  });
  it("finds none in the other dialects", () => {
    for (const dialect of dialects.filter((name) => name !== "forgejo" && name !== "gitea"))
      expect(found("Term\n: *a*\n  * b\n", dialect), dialect).toEqual({
        descriptions: [],
        nested: [],
      });
  });
  it.each(forges)(
    "leaves a description and the blocks below it as written in the %s dialect",
    (dialect) => {
      for (const source of [
        // `style/emphasis` changed code, and the list rules moved lists out
        // of the description; on Forgejo, a heading's anchor changed.
        "Term\n: ```js\n  let *a* = 1;\n  ```\n",
        "Term\n: *a*\n  * b\n",
        "Term\n: 2. *x*\n   1. *y*\n",
        "Term\n: # *h*\n",
        "> Term\n> : *a*\n>   * b\n",
      ])
        expect(formatted(source, preset(dialect)), JSON.stringify(source)).toBe(source);
    },
  );
  it.each(forges)("still formats the blocks around it in the %s dialect", (dialect) => {
    expect(formatted("Term *x*\n\n: *a*\n\n* c *d*\n", preset(dialect))).toBe(
      "Term _x_\n\n: *a*\n\n- c _d_\n",
    );
  });
  it("formats such text in the other dialects", () => {
    const config: Config = { extends: [], dialect: "github", rules: { "style/emphasis": "warn" } };
    expect(formatted("Term\n: *a*\n", { config })).toBe("Term\n: _a_\n");
  });
});

describe("blocks that Obsidian reads into an HTML block above them", () => {
  // A line of blank space directly below an HTML block continues it in
  // Reading view, up to an empty line, so the text there shows as written
  // (issue #358).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "</div>\n  \n*a* b\n",
    "</div>\n\t\n### __z__ ##\n",
    "<div>\n</div>\n  \ndelta\n---\n",
    "<div>\n  \n*a* b\n",
    "</div>\n  \n*a* b\n  \n*c* d\n",
    "> </div>\n>  \n> *a* b\n",
    // Also the marker of a list item there, which is text of the HTML block.
    "</div>\n  \n* *a* b\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // An empty line ends the HTML block.
    ["</div>\n  \n*a* b\n\n*c* d\n", "</div>\n  \n*a* b\n\n_c_ d\n"],
    // These end at their own end markers.
    ["<!-- c -->\n  \n*a* b\n", "<!-- c -->\n  \n_a_ b\n"],
    ["<pre>\nx\n</pre>\n  \n*a* b\n", "<pre>\nx\n</pre>\n  \n_a_ b\n"],
    ["<script>\n</script>\n  \n*a* b\n", "<script>\n</script>\n  \n_a_ b\n"],
    ["  <!-- c -->\n  \n*a* b\n", "  <!-- c -->\n  \n_a_ b\n"],
    // An empty line in a list ends the HTML block there.
    ["</div>\n  \n- *a*\n\n  *b*\n", "</div>\n  \n- *a*\n\n  _b_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such text in the other dialects", () => {
    expect(
      formatted("</div>\n  \n*a* b\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("</div>\n\n_a_ b\n");
  });
});

describe("blocks that Obsidian reads into a paragraph across tab lines", () => {
  // Reading view reads a line of blank space with a tab at or right of a
  // paragraph's column as more of the paragraph, and then the block below
  // such lines too, unless it interrupts a paragraph (issue #398).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a\n\t\nb *c*\n",
    "a *** b *c*\n\t\nd *e f*\n",
    "a\n\t\n| x |\n| - |\n| y |\n",
    "a\n\t\nb\n===\n",
    "a\n\t\nb *c*\n---\n",
    "a\n\t\n2. b *c*\n",
    "a\n\t\n2. b *c*\n5. d *e*\n",
    "a\n\t\n2) b *c*\n",
    "a\n\t\n2.\n",
    "a\n\t\n[^1]: b *c*\n",
    "a\n\t\n[^1]: b\n\n    c *d*\n",
    "a\n\t\n\t\nb *c*\n",
    "a\n \t \nb *c*\n",
    "a\r\n\t\r\nb *c*\r\n",
    // Across the blocks that it reads as more of the text.
    "a\n\t\nb *c*\n\t\nd *e*\n",
    "a\n\t\n| x |\n| - |\n\t\nb *c*\n",
    "a\n| x |\n| - |\n\t\nb *c*\n",
    "a\n\t\n    b\n\t\nc *d*\n",
    "a\n\t\n2. b\n\t\nc *d*\n",
    "a\n\t\n[^1]: b\n\t\nc *d*\n",
    "a\n\t\n<custom>b</custom>\n\t\nc *d*\n",
    // In a block quote, and from a list item whose content the tab reaches.
    "> a\n> \t\n> b *c*\n",
    "> a\n> \t\nb *c*\n",
    "- a\n  \t\n  b *c*\n",
    "- a\n  \t\nb *c*\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  it.each([
    // These interrupt a paragraph, so they start blocks of their own.
    ["a\n\t\n# b *c* #\n", "a\n\t\n# b _c_\n"],
    ["a\n\t\n- b *c*\n", "a\n\t\n- b _c_\n"],
    ["a\n\t\n1. b *c*\n", "a\n\t\n1. b _c_\n"],
    ["a\n\t\n1) b *c*\n", "a\n\t\n1. b _c_\n"],
    ["a\n\t\n2. b\n\n   c\n\t\nd *e*\n\ne *f*\n", "a\n\t\n2. b\n\n   c\n\t\nd *e*\n\ne _f_\n"],
    ["a\n\t\n> b *c*\n", "a\n\t\n> b _c_\n"],
    ["a\n\t\n> [!note]\n> b *c*\n", "a\n\t\n> [!note]\n> b _c_\n"],
    ["a\n\t\n```\nx\n```\n\t\nb *c*\n", "a\n\t\n```\nx\n```\n\t\nb _c_\n"],
    ["a\n\t\n$$\nx\n$$\n\t\nb *c*\n", "a\n\t\n$$\nx\n$$\n\t\nb _c_\n"],
    ["a\n\t\n***\n\t\nb *c*\n", "a\n\t\n---\n\t\nb _c_\n"],
    ["a\n\t\n<div>\nb\n</div>\n\nc *d*\n", "a\n\t\n<div>\nb\n</div>\n\nc _d_\n"],
    // An empty line, or one of spaces, ends the paragraph.
    ["a\n\t\nb *c*\n\nd *e*\n", "a\n\t\nb *c*\n\nd _e_\n"],
    ["a\n\t\n  \nb *c*\n", "a\n\t\n\nb _c_\n"],
    ["a\n  \n\t\nb *c*\n", "a\n\n\t\nb _c_\n"],
    // Only paragraph text goes on below a tab line.
    ["# a\n\t\nb *c*\n", "# a\n\t\nb _c_\n"],
    ["| x |\n| - |\n\t\nb *c*\n", "| x   |\n| --- |\n\t\nb _c_\n"],
    ["[r]: https://x.org\n\t\nb *c*\n", "[r]: https://x.org\n\t\nb _c_\n"],
    // A tab left of the paragraph's column, in a list item or without a
    // quote's marker, is a blank line.
    ["- a\n\t\n  b *c*\n", "- a\n\t\n  b _c_\n"],
    ["- a\n\t\nb *c*\n", "- a\n\t\nb _c_\n"],
    ["1. a\n\t\n   b *c*\n", "1. a\n\t\n   b _c_\n"],
    ["> a\n\t\n> b *c*\n", "> a\n\t\n> b _c_\n"],
    ["> a\n\t\nb *c*\n", "> a\n\t\nb _c_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such blocks in the other dialects", () => {
    expect(
      formatted("a\n\t\nb *c*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a\n\nb _c_\n");
  });
});

describe("backticks that nothing closes in Obsidian", () => {
  // Live Preview shows the text after such a backtick as code, at least to the
  // end of its line, also from inside a highlight, an inline comment, or a link
  // or image description, and Reading view pairs a run of two or more with a
  // later, shorter one, where the parser reads text (issue #362).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "a ``` b *c* d\n",
    "a ` b *c* d\n",
    "a `` b\n`c` *d*\n",
    "# a ` b *c*\n",
    "==a ` b== *c* d\n",
    "==a `b` ``` c== *d*\n",
    "x %%a ` b%% *c* d\n",
    "[a ` b](x) *c* d\n",
    "![a ` b](x) *c* d\n",
    "![a ` b][r] *c* d\n\n[r]: x\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  // After a run of three or more, Live Preview shows the blocks below as code
  // up to a run of the same length, a fenced code block, or a list item.
  it.each([
    ["a ``` b\n\nc *d* e\n", "a ``` b\n\nc *d* e\n"],
    ["- a ``` b\n\nc *d*\n", "- a ``` b\n\nc *d*\n"],
    ["a ``` b\n\n# c *d* #\n\n    x *y*\n", "a ``` b\n\n# c *d* #\n\n    x *y*\n"],
    ["a ``` b\n\nc *d* ``` e *f*\n\ng *h*\n", "a ``` b\n\nc *d* ``` e *f*\n\ng _h_\n"],
    [
      "a ``` b\n\nc `` *d*\n\ne \\``` *f*\n\ng *h*\n",
      "a ``` b\n\nc `` *d*\n\ne \\``` *f*\n\ng *h*\n",
    ],
    ["a ``` b\n\nc ``` d ``` e\n\nf *g*\n", "a ``` b\n\nc ``` d ``` e\n\nf *g*\n"],
    ["a ``` b\n\n```js\nx\n```\n\nc *d*\n", "a ``` b\n\n```js\nx\n```\n\nc _d_\n"],
    ["a ``` b\n\n- c *d*\n\ne *f*\n", "a ``` b\n\n- c _d_\n\ne _f_\n"],
    ["| a ``` b |\n| - |\n\nc *d*\n", "| a ``` b |\n| - |\n\nc *d*\n"],
    // An indented code block shows as more of the code, and its run closes
    // nothing; in a wikilink, a run closes the code.
    ["a ``` b\n\n    x ``` y\n\nc *d*\n", "a ``` b\n\n    x ``` y\n\nc *d*\n"],
    ["a ``` b\n\nc [[x ``` y]] *d*\n\ne *f*\n", "a ``` b\n\nc [[x ``` y]] *d*\n\ne _f_\n"],
    // A list item ends the code also where its first block is a quote.
    ["a ``` b\n\n- > c *d*\n\ne *f*\n", "a ``` b\n\n- > c _d_\n\ne _f_\n"],
    // Blank lines do not end the code, so their number does not matter.
    ["a ``` b\n\n\n\nc *d*\n", "a ``` b\n\nc *d*\n"],
  ])("leaves the blocks below %j as Live Preview shows them", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("looks into the blocks of a container that a syntax plugin adds", () => {
    const source = "a ``` b\n\nc *d*\n";
    const document = parse(source, "obsidian");
    const blocks = document.tree.children;
    const container = {
      type: "pluginContainer",
      children: blocks,
      position: document.tree.position,
    };
    document.tree.children = [container as unknown as (typeof blocks)[number]];
    const { unclosedCode } = misreadLists(document);
    expect([...unclosedCode].map((node) => source.slice(...range(node)))).toEqual([
      "a ``` b",
      "c *d*",
    ]);
  });
  it("pairs the runs below such a run in time linear in their number", () => {
    // A line each, so that no run of one closes another, in an HTML block,
    // which the parser reads without inline syntax (issue #151).
    const source = `a \`\`\` b\n\n<div>\nc \`\`\` ${"d ` e\n".repeat(20_000)}</div>\n\nf *g*\n`;
    const started = performance.now();
    const output = formatted(source, { config });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(output.endsWith("\nf _g_\n")).toBe(true);
  });
  it("keeps the emphasis in such a table cell", () => {
    expect(formatted("| a ` *b* |\n| - |\n", { config })).toBe("| a ` *b* |\n| ------- |\n");
  });
  it.each([
    ["a \\` b *c* d\n", "a \\` b _c_ d\n"],
    ["a `code` and *c*\n", "a `code` and _c_\n"],
    ["a ` b\n\n*c* d\n", "a ` b\n\n_c_ d\n"],
    // Live Preview starts no code inside math or a wikilink.
    ["$a ` b$ *c*\n", "$a ` b$ _c_\n"],
    ["[[a ` b]] *c*\n", "[[a ` b]] _c_\n"],
    ["==a `b` \\` c== *d*\n", "==a `b` \\` c== _d_\n"],
    ["![a `b` c](x) *d*\n", "![a `b` c](x) _d_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such text in the other dialects", () => {
    expect(
      formatted("a ` b *c* d\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a ` b _c_ d\n");
  });
});

describe("list items that Obsidian starts below a paragraph line", () => {
  // Live Preview starts a list at an ordered item numbered other than 1, and
  // Reading view at an empty item, where CommonMark reads text (issue #375).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "a\n3. b *c*\n",
    "a\n10) b\n",
    "a\n   3. b\n",
    "- a\n  3. b *c*\n",
    "- a\n    3. b *c*\n",
    "a\n3. b\nc *d*\n",
    "a\n3. b\n\n   c *d*\n",
    "a\n* \n",
    "a\n+ \n",
    "a\n1.\n",
    // The parser reads a heading here, where Obsidian shows text and an empty item.
    "a\n- \n",
    "> a\n> * \n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // Neither view starts an ordered list in a block quote.
    ["> a\n> 3. b *c*\n", "> a\n> 3. b _c_\n"],
    ["a *x*\n2.\n", "a _x_\n2.\n"],
    // Four columns right of the text, a marker is more of the text.
    ["a *x*\n    3. b\n", "a _x_\n    3. b\n"],
    ["- a *x*\n      3. b\n", "- a _x_\n      3. b\n"],
    // The block after the next one is no item of the list.
    ["a\n3. b\n\nc\n\nd *e*\n", "a\n3. b\n\nc\n\nd _e_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such text in the other dialects", () => {
    expect(
      formatted("a\n3. b *c*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a 3. b _c_\n");
  });
});

describe("underlines that Obsidian reads otherwise", () => {
  // Reading view reads an underline with blank space after it, or before it
  // beyond the heading's text, as text, and Live Preview a lone `-` (issue
  // #383). Reading view also reads a lazy line of `=` or `-` in a block quote or
  // list item as an underline, where the parser reads text (issue #377).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  // With strict line breaks, so that `style/wrap` joins lines.
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a\n-\n",
    "a\n-- \n",
    "a\n= \n",
    "a\n=\t\n",
    "a\n=== \n",
    "a\n--- \n",
    "a\n ==\n",
    "a\n   -\n",
    "> a\n> = \n",
    "- a\n  == \n",
    "> a\n=\n",
    "> a\n--\n",
    "> > a\n=\n",
    "> a\nb\n=\n",
    "- a\n=\n",
    "1. a\n=\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  it.each([
    ["a *b*\n--\n", "## a _b_\n"],
    ["a *b*\n=\n", "# a _b_\n"],
    ["a *b*\n===\n", "# a _b_\n"],
    ["- a *b*\n  =\n", "- a _b_\n  =\n"],
    ["> a *b*\n> --\n", "> a _b_\n> --\n"],
    // The text itself is formatted; only the underline stays on its own line.
    ["*a*\n-- \n", "_a_\n-- \n"],
    ["> *a*\n=\n", "> _a_\n=\n"],
    ["- *a*\n==\n", "- _a_\n==\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such headings in the other dialects", () => {
    expect(
      formatted("a\n-- \n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("## a\n");
  });
});

describe("list items that Live Preview ends at a lazy line", () => {
  // Live Preview reads the blocks after a lazy line of an item's paragraph, one
  // left of the item's content, outside the list, where an indented paragraph
  // is code and a fence's indentation is part of its code (issue #376).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  // With strict line breaks, so that `style/wrap` joins lines.
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "2. a\nb\n\n    c *d*\n",
    "- a\nb\n\n  - c *d*\n",
    "- a\nb\n\n  ```\n  c *d*\n  ```\n",
    "- a\nb\nc\n\n  d *e*\n",
    "- a\n  b\nc\n\n  d *e*\n",
    "> - a\n> b\n>\n>   c *d*\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  it.each([
    // Without a lazy line, or without blocks after it in the item.
    ["2. a\n   b\n\n    c *d*\n", "2. a b\n\n    c _d_\n"],
    ["- a *x*\nb\n", "- a _x_ b\n"],
    ["- a\nb\n- c *d*\n", "- a b\n- c _d_\n"],
    // A lazy line in a block quote changes nothing that Live Preview shows.
    ["> a\nb\n\n> c *d*\n", "> a b\n\n> c _d_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such items in the other dialects", () => {
    expect(
      formatted("2. a\nb\n\n    c *d*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("2. a b\n\n    c _d_\n");
  });
});

describe("footnote definitions that Obsidian reads as paragraph text", () => {
  // Reading view continues a line of paragraph text with a footnote definition
  // directly below it, also from a list item or block quote, and reads the
  // definition's indented lines as code (issue #378).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "a\n[^1]: b *c*\n    d *e*\n",
    "> - a\n[^1]: b\n    c *d*\n",
    "- a\n[^1]: b *c*\n",
    "> a\n[^1]: b *c*\n",
    // A definition below one that is text is text too.
    "a\n[^1]: b *c*\n[^2]: d *e*\n",
    // Blank space at the end of the line above is a line break in the paragraph.
    "a  \n[^1]: b\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // Below a blank line, a heading, or another definition, it is a definition.
    ["a\n\n[^1]: b *c*\n\nx[^1]\n", "a\n\n[^1]: b _c_\n\nx[^1]\n"],
    ["# h\n[^1]: b *c*\n\nx[^1]\n", "# h\n\n[^1]: b _c_\n\nx[^1]\n"],
    ["[^1]: a *b*\n[^2]: c *d*\n\nx[^1] y[^2]\n", "[^1]: a _b_\n[^2]: c _d_\n\nx[^1] y[^2]\n"],
    ["[r]: https://x.org\n[^1]: b *c*\n\nx[^1]\n", "[r]: https://x.org\n[^1]: b _c_\n\nx[^1]\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such definitions in the other dialects", () => {
    expect(
      formatted("a\n[^1]: b *c*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a\n[^1]: b _c_\n");
  });
});

describe("lines that Obsidian reads as code below a link reference definition", () => {
  // Reading view reads a line below a definition and four columns right of its
  // container's content as an indented code block, where the parser reads a
  // paragraph (issue #379).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "[r]: https://x.org\n      c   \n",
    "[r]: https://x.org\n    c *d*\n",
    "   [r]: https://x.org\n    c *d*\n",
    "[r]: https://x.org\n[s]: https://y.org\n    c *d*\n",
    "[r]:\n  https://x.org\n    c *d*\n",
    "[r]: https://x.org\n\tc *d*\n",
    "[r]: https://x.org\n    c *d*\ne *f*\n",
    "> [r]: https://x.org\n>     c *d*\n",
    "- [r]: https://x.org\n      c *d*\n",
    // The parser reads a heading, where Reading view shows code and text.
    "[r]: https://x.org\n    c\n===\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    ["[r]: https://x.org\nc *d*\n", "[r]: https://x.org\nc _d_\n"],
    ["[r]: https://x.org\n\n    c *d*\n\ne *f*\n", "[r]: https://x.org\n\n    c *d*\n\ne _f_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such lines in the other dialects", () => {
    expect(
      formatted("[r]: https://x.org\n    c *d*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("[r]: https://x.org\n    c _d_\n");
  });
});

describe("paragraph lines that Live Preview styles as a link reference definition", () => {
  // Live Preview styles a line that starts at the first column with `[`, a
  // label, and `]:` as a definition, and the lines above and below it as text,
  // where the parser reads more of the paragraph, because a definition cannot
  // interrupt one, or where the line is no definition (issue #391).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  // With strict line breaks, so that `style/wrap` joins lines.
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a\n[r]: https://x.org\n",
    'a\n[r]: https://x.org "t"\n',
    "a\n[r]: <https://x.org>\n",
    "a\n[r]:\n",
    "a\n[r]: a b\n",
    "a\n[r]:x\n",
    "a\n[]: https://x.org\n",
    "a\n[a[b]: c\n",
    "a\n[a\\]b]: c\n",
    "a\n[r]: https://x.org\n[s]: https://y.org\n",
    "a\r\n[r]: https://x.org\r\nc\r\n",
    // Nothing in the line changes, not even its blank space.
    "a\n[r]: *x*\n",
    "a\n[r]: x \nc\n",
    "a\n [r]: https://x.org\n",
    "a\n    [r]: https://x.org\n",
    "a\n\t[r]: https://x.org\n",
    "> a\n> [r]: https://x.org\n",
    "- a\n  [r]: https://x.org\n",
    "> [r]: a b\n> c\n",
    // The parts of a definition on the lines below stay there.
    "a\n[r]:\nhttps://x.org\n",
    'a\n[r]: https://x.org\n"t"\n',
    // A lazy line of a block quote or list item.
    "> a\n[r]: https://x.org\n",
    "- a\n[r]: https://x.org\n",
    "- > a\n[r]: https://x.org\n",
    // The first line of a paragraph, where the parser reads no definition.
    "[r]: a b\nc\n",
    "[r]:\nc\n",
    "[r]: https://x.org\n[s]: a b\nc\n",
    // The line is not broken, nor is the line below joined to it.
    '[r]: https://x.org "a title with words enough to go past the width of eighty columns"\n',
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n[r]: https://x.org\nc\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  it.each([
    // The text around it is formatted; only the line stays on a line of its own.
    ["a *b*\n[r]: https://x.org\n", "a _b_\n[r]: https://x.org\n"],
    ["a\n[r]: https://x.org\nc *d*\n", "a\n[r]: https://x.org\nc _d_\n"],
    ["*a*\n[r]: x\n*b*\n", "_a_\n[r]: x\n_b_\n"],
    ["[r]: a b\nc *d*\n", "[r]: a b\nc _d_\n"],
    // A backslash or other text before `[` or between `]` and `:` is text.
    ["a\n\\[r]: https://x.org\n", "a \\[r]: https://x.org\n"],
    ["a\n[r] : x\n", "a [r] : x\n"],
    ["a\n[[x]]: y\n", "a [[x]]: y\n"],
    ["a\n[r][s]: x\n", "a [r][s]: x\n"],
    ["- [r]: a b\n  c\n", "- [r]: a b c\n"],
    // Below a blank line, it is a definition, and the text below it a paragraph.
    ["a\n\n[r]: https://x.org\nc *d*\n", "a\n\n[r]: https://x.org\nc _d_\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such lines in the other dialects", () => {
    expect(
      formatted("a\n[r]: https://x.org\nc *d*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a [r]: https://x.org c _d_\n");
  });
});

describe("underlined headings whose text Live Preview styles as a definition", () => {
  // Live Preview styles a heading's one line of text that starts at the first
  // column with `[`, a label, and `]:` as a link reference definition, and
  // reads the underline as text, where Reading view and the parser read a
  // heading (issue #397).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "[r]: a b\n===\n",
    "[r]: a b\n---\n",
    "[r]: a b\n=\n",
    "[]: a b\n===\n",
    "[a[b]: c\n===\n",
    "[r]: a b\r\n===\r\n",
    // Below a definition, where the heading's text starts on a later line.
    "[s]: https://y.org\n[r]: a b\n===\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // The text is formatted; only the heading keeps its underline.
    ["[r]: *a* b\n===\n", "[r]: _a_ b\n===\n"],
    ["[r]: a b  \n===\n", "[r]: a b\n===\n"],
    // A backslash, or other text between `]` and `:`, makes Live Preview read
    // a heading.
    ["\\[r]: a b\n===\n", "# \\[r]: a b\n"],
    ["[r] : a b\n===\n", "# [r] : a b\n"],
    ["[r][s]: a b\n===\n", "# [r][s]: a b\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such headings in the other dialects", () => {
    expect(
      formatted("[r]: a b\n===\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("# [r]: a b\n");
  });
});

describe("blocks that Obsidian reads into a fence that a list item leaves open", () => {
  // Reading view continues such a fence with the unindented lines directly
  // below its container, and Live Preview with every block up to a line that
  // would close it, where the parser opens a fence, so that the two pair the
  // fences after it otherwise (issue #390).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "- ```\nb *c*\n",
    "- ```\n  a\nb *c*\n",
    "1. a\n   ```\nb *c*\n",
    "- ~~~\nb *c*\n",
    "> ```\nb *c*\n",
    "- ```\nb *c* and some more words, enough for a line of more than eighty columns\n",
    // Live Preview reads on across blank lines and list items.
    "- ```\n  a\n\nb *c*\n",
    "- a\n  ```\nb *c*\n\n- d *e*\n",
    // Live Preview closes the fence where the parser opens one, and opens one
    // where the parser closes it.
    "- ```\nb *c*\n```\n\nd *e*\n```\n\nf *g*\n",
    "- ````\nb *c*\n```\n\nd *e*\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    ["- ```\n  a\n  ```\nb *c*\n", "- ```\n  a\n  ```\n\nb _c_\n"],
    ["a *b*\n\n- ```\nc\n", "a _b_\n\n- ```\nc\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it("formats such blocks in the other dialects", () => {
    expect(
      formatted("- ```\nb *c*\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("- ```\nb _c_\n");
  });
});

describe("tables that Obsidian reads otherwise", () => {
  // Obsidian reads a table directly below paragraph text as more of the text,
  // a one-column table whose header line does not end with a pipe as text, and
  // a line without a pipe as the end of a table; Reading view reads a line
  // with a pipe above `- | -` as a table (issue #359).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
  it.each([
    "a\n| x | y |\n| - | - |\n| 1 | 2 |\n",
    "a  \n| x | y |\n| - | - |\n",
    "| x |\n| - |\n{% y %}\n",
    "| x |\n| - |\n| 1 |\ny *z*\n",
    "| x | w |\n| - | - |\ny *z*\n\nv\n",
    "| x | w |\r\n| - | - |\r\n| 1 | 2 |\r\ny *z*\r\n",
    "x | y\n- | :-:\nw | z\n",
    "x | y\n- | -\n",
    "x\n--:\n",
    "x\n:-:\n",
    "| x\n| --\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config, workspace })).toBe(source);
  });
  it.each([
    // The text above is formatted; only the table stays as written.
    ["a *b*\n| x |\n| - |\n", "a _b_\n| x |\n| - |\n"],
    ["a\n\n| x | y |\n| - | - |\n", "a\n\n| x   | y   |\n| --- | --- |\n"],
    ["# h\n| x | y |\n| - | - |\n", "# h\n\n| x   | y   |\n| --- | --- |\n"],
    ["x |\n-- |\n", "| x   |\n| --- |\n"],
    ["x | y\n-|-\nw | z\n", "| x   | y   |\n| --- | --- |\n| w   | z   |\n"],
    // The parser reads this as Obsidian does: text of the block quote.
    ["> a\n| x | y |\n| - | - |\n", "> a | x | y | | - | - |\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config, workspace })).toBe(output);
  });
  it("formats such tables in the other dialects", () => {
    expect(
      formatted("a\n| x | y |\n| - | - |\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("a\n| x   | y   |\n| --- | --- |\n");
  });
});

describe("HTML blocks that Obsidian keeps inside a list item", () => {
  // Reading view keeps an HTML block directly below a list inside the list's
  // last item, where CommonMark ends the list, and so a list below the block
  // continues it with every item whose marker matches, and the blocks there
  // that start at the item's content are inside the item (issue #399).
  const config: Config = { extends: ["recommended", "obsidian"], dialect: "obsidian" };
  it.each([
    "- a\n<div>\nb\n</div>\n\n* c\n",
    "* a\n<div>\nb\n</div>\n\n- c\n",
    "1) a\n<div>\nb\n</div>\n\n1. c\n",
    "1. a\n<div>\nb\n</div>\n\n1) c\n",
    "- a\n<!-- x -->\n\n* c\n",
    "- a\n<!-- x -->\n* c\n",
    "- a\n<pre>\nx\n</pre>\n\n* c\n",
    "- a\r\n<div>\r\n</div>\r\n\r\n* c\r\n",
    "> - a\n> <div>\n> b\n> </div>\n>\n> * c\n",
    "- a\n  - b\n<div>\n</div>\n\n* c\n",
    "- a\n  ```\n  x\n  ```\n<div>\n</div>\n\n* c\n",
    "- # a\n<div>\n</div>\n\n* c\n",
    "* a\n* b\n<div>\n</div>\n\n- c\n",
    "- a\n<div>\nb\n</div>\n\n* c\n* d\n",
    // The markers stay where a block follows that the item's spacing, which
    // sets the column from which Reading view reads blocks inside it, could
    // bring inside.
    "-   a\n<div>\n</div>\n\n   d\n",
    "*   a\n<div>\n</div>\n\n  * c\n",
    "-   a\n<div>\n</div>\n\n    d\n\n* c\n",
    // The blocks that start at the item's content keep their indentation and
    // markers, and so do the lists nested in the item, which one of them could
    // continue.
    "- a\n<div>\n</div>\n\n  * d\n\n* c\n",
    "- a\n<div>\n</div>\n\n   * d\n* c\n",
    "- a\n  * b\n<div>\n</div>\n\n  - d\n",
    "- a\n  *   b\n<div>\n</div>\n\n    d\n",
  ])("leaves %j as written", (source) => {
    expect(formatted(source, { config })).toBe(source);
  });
  it.each([
    // The text is formatted; only the markers and indentation stay.
    ["- a\n<div>\nb\n</div>\n\n- c *d*\n", "- a\n<div>\nb\n</div>\n\n- c _d_\n"],
    ["- *a*\n<div>\n</div>\n\n* c\n", "- _a_\n<div>\n</div>\n\n* c\n"],
    ["- a\n<div>\nb\n</div>\n\n  d *e*\n\n* c\n", "- a\n<div>\nb\n</div>\n\n  d _e_\n\n* c\n"],
    // Nothing follows the HTML block, or a block that no spacing of the item
    // could bring inside it.
    ["* a\n<div>\n</div>\n", "- a\n<div>\n</div>\n"],
    ["* a\n<div>\n</div>\n\n1. c\n", "- a\n<div>\n</div>\n\n1. c\n"],
    ["*   a\n<div>\n</div>\n\n d\n", "- a\n<div>\n</div>\n\n d\n"],
    // A list of another kind is moved to the first column first, where no
    // spacing of the item reaches it.
    ["*   a\n<div>\n</div>\n\n  1. c\n", "- a\n<div>\n</div>\n\n1. c\n"],
    // An empty line between the list and the HTML block ends the list, and a
    // paragraph at the first column below the block does too.
    ["- a\n\n<div>\nb\n</div>\n\n* c\n", "- a\n\n<div>\nb\n</div>\n\n- c\n"],
    ["* a\n<div>\nb\n</div>\n\nd\n\n- c\n", "- a\n<div>\nb\n</div>\n\nd\n\n- c\n"],
    // A block quote or footnote definition does not keep the block.
    ["> a\n<div>\n</div>\n\n* c\n", "> a\n<div>\n</div>\n\n- c\n"],
    ["[^1]: a\n<div>\n</div>\n\n* c\n\nx[^1]\n", "[^1]: a\n<div>\n</div>\n\n- c\n\nx[^1]\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, { config })).toBe(output);
  });
  it.each(["- a\n<div>\n</div>\n\n* c\n", "- a\n<!-- x -->\n* c\n"])(
    "keeps %j without the blank lines that style/block-spacing adds",
    (source) => {
      const spaced: Config = { ...config, rules: { "style/block-spacing": "warn" } };
      expect(formatted(source, { config: spaced })).toBe(source);
      expect(formatted("- a\n\n<pre>\nx\n</pre>\n* c\n", { config: spaced })).toBe(
        "- a\n\n<pre>\nx\n</pre>\n\n- c\n",
      );
    },
  );
  it("formats such lists in the other dialects", () => {
    expect(
      formatted("- a\n<div>\nb\n</div>\n\n* c\n", {
        config: { ...config, extends: ["recommended"], dialect: "github" },
      }),
    ).toBe("- a\n\n<div>\nb\n</div>\n\n- c\n");
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
  it.each(dialects)(
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
  it.each(dialects)(
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
  it.each(dialects)(
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
  it.each(dialects)("still formats what renderers read alike in the %s dialect", (dialect) => {
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
  });
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

describe("a rule whose edits would change the meaning", () => {
  /** A block rule that puts a list marker before the paragraphs starting with one of `targets`. */
  const listing = (name: string, targets: string[]): Rule => ({
    kind: "style",
    phase: "block",
    description: "Turn paragraphs into list items",
    check: ({ document }) =>
      targets.flatMap((target) => {
        const start = document.source.indexOf(target);
        return start < 0 ? [] : [{ start, message: name, edit: { start, end: start, text: "- " } }];
      }),
  });
  const engine = (result: { diagnostics: Diagnostic[] }) =>
    result.diagnostics.filter((item) => item.rule.startsWith("engine/"));
  it("keeps the edits of the other rules in every phase, and names the rule and the line", () => {
    const plugins: Plugin[] = [{ name: "test", rules: { list: listing("List", ["Keep"]) } }];
    const options: ProcessOptions = {
      plugins,
      config: {
        extends: [],
        rules: {
          "style/emphasis": "warn",
          "style/heading": "warn",
          "test/list": "warn",
          "style/final-newline": "warn",
        },
      },
    };
    const source = "Title\n=====\n\nSome *emphasis* here.\n\nKeep this paragraph.";
    const result = format(source, options);
    expect(result.output).toBe("# Title\n\nSome _emphasis_ here.\n\nKeep this paragraph.\n");
    expect(result.changed).toBe(true);
    expect(result.diagnostics).toMatchObject([
      {
        rule: "engine/unsafe-format",
        severity: "error",
        line: 5,
        column: 1,
        message:
          "test/list would change the parsed meaning at line 5; none of its edits were applied.",
      },
      { rule: "test/list", line: 5 },
    ]);
    expect(result.diagnostics).toHaveLength(2);
    // Formatting the result again changes nothing and reports the same.
    expect(format(result.output, options)).toEqual({ ...result, changed: false });
    expect(semanticFingerprint(parse(result.output, "github"))).toBe(
      semanticFingerprint(parse(source, "github")),
    );
  });
  it("reports where the meaning first differs, not where the rule's first edit is", () => {
    const rule: Rule = {
      kind: "style",
      description: "Collapse a double space, then add a list marker",
      check: ({ document }) => {
        const space = document.source.indexOf("  ");
        const list = document.source.indexOf("Third");
        return [
          ...(space < 0
            ? []
            : [
                {
                  start: space,
                  message: "Space",
                  edit: { start: space, end: space + 2, text: " " },
                },
              ]),
          ...(list < 0
            ? []
            : [{ start: list, message: "List", edit: { start: list, end: list, text: "- " } }]),
        ];
      },
    };
    const source = "First  paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";
    const result = format(source, {
      plugins: [{ name: "test", rules: { mixed: rule } }],
      config: { extends: [], rules: { "test/mixed": "warn" } },
    });
    // The rule is left out as a whole, its harmless first edit included.
    expect(result.output).toBe(source);
    expect(engine(result)).toMatchObject([{ line: 5, column: 1 }]);
  });
  it("reports every rule that fails and keeps a rule of the same phase between them", () => {
    const plugins: Plugin[] = [
      {
        name: "test",
        rules: { first: listing("First", ["First"]), last: listing("Last", ["Last"]) },
      },
    ];
    const source = "First paragraph.\n\nTitle\n=====\n\nLast paragraph.\n";
    const result = format(source, {
      plugins,
      config: {
        extends: [],
        rules: { "test/first": "warn", "style/heading": "warn", "test/last": "warn" },
      },
    });
    expect(result.output).toBe("First paragraph.\n\n# Title\n\nLast paragraph.\n");
    expect(engine(result).map((item) => [item.line, item.message.split(" ")[0]])).toEqual([
      [1, "test/first"],
      [5, "test/last"],
    ]);
  });
  it("applies overlapping edits in turn, the later in the next pass", () => {
    const collapse: Rule = {
      kind: "style",
      description: "Rewrite a line that holds a double space",
      check: ({ document }) => {
        const end = document.source.indexOf("\n");
        const line = document.source.slice(0, end);
        return line.includes("  ")
          ? [
              {
                start: 0,
                message: "Collapse",
                edit: { start: 0, end, text: line.replace(/ {2,}/g, " ") },
              },
            ]
          : [];
      },
    };
    const options: ProcessOptions = {
      plugins: [{ name: "test", rules: { collapse } }],
      config: { extends: [], rules: { "style/emphasis": "warn", "test/collapse": "warn" } },
    };
    expect(formatted("A *b*  c.\n", options)).toBe("A _b_ c.\n");
    // `applyEdits` has no next pass and still rejects edits that overlap.
    expect(() =>
      applyEdits("A *b*  c.\n", [
        { start: 0, end: 9, text: "A *b* c." },
        { start: 2, end: 3, text: "_" },
      ]),
    ).toThrow("overlapping");
  });
  it.each([
    ["See [[Note|label]] here.\n", "markdown", "See [label](<Folder/Note>) here.\n"],
    ["See [label](Note.md) here.\n", "wiki", "See [[Folder/Note.md|label]] here.\n"],
  ])("converts the notation and the path of one link in turn: %j", (source, style, output) => {
    const workspace = createWorkspace(
      { "Doc.md": source, "Folder/Note.md": "# Note\n" },
      { dialect: "obsidian", strictLineBreaks: true },
    );
    const config = (rules: Config["rules"]): ProcessOptions => ({
      path: "Doc.md",
      workspace,
      config: { extends: [], dialect: "obsidian", rules: { "links/valid": "error", ...rules } },
    });
    const path: Config["rules"] = { "links/path": ["warn", { style: "root" }] };
    const notation: Config["rules"] = { "links/notation": ["warn", { style }] };
    expect(formatted(source, config({ ...path, ...notation }))).toBe(output);
    // The same as one rule after the other.
    expect(formatted(formatted(source, config(path)), config(notation))).toBe(output);
  });
  it("gives the edits that overlapped a refused rule's edits their turn in the same pass", () => {
    const replace: Rule = {
      kind: "style",
      description: "Replace the first line",
      check: ({ document }) => {
        const end = document.source.indexOf("\n");
        return document.source.startsWith("A")
          ? [{ start: 0, message: "Replace", edit: { start: 0, end, text: "Other words." } }]
          : [];
      },
    };
    const parsed = vi.spyOn(syntax, "parse");
    try {
      const result = format("A *b* c.\n", {
        plugins: [{ name: "test", rules: { replace } }],
        config: { extends: [], rules: { "style/emphasis": "warn", "test/replace": "warn" } },
      });
      expect(result.output).toBe("A _b_ c.\n");
      expect(engine(result)).toMatchObject([
        {
          message:
            "test/replace would change the parsed meaning at line 1; none of its edits were applied.",
        },
      ]);
      // The source, the replacement, the emphasis edits, and the replacement again in the
      // final pass, which then has nothing else to try.
      expect(parsed).toHaveBeenCalledTimes(4);
    } finally {
      parsed.mockRestore();
    }
  });
});

describe("rules that fail", () => {
  const source = "A *b* c.\n";
  const failing = (check: Rule["check"], kind: Rule["kind"] = "problem"): ProcessOptions => ({
    plugins: [{ name: "test", rules: { fragile: { kind, description: "Fail", check } } }],
    config: { extends: [], rules: { "style/emphasis": "warn", "test/fragile": "warn" } },
  });
  const ruleErrors = (diagnostics: Diagnostic[]) =>
    diagnostics.filter((item) => item.rule === "engine/rule-error");
  it.each(["problem", "style"] as const)(
    "reports a %s rule that throws and runs the other rules, in lint and format",
    (kind) => {
      const options = failing(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'x')");
      }, kind);
      const expected = {
        rule: "engine/rule-error",
        severity: "error",
        start: 0,
        line: 1,
        column: 1,
        message:
          "Rule test/fragile failed (TypeError: Cannot read properties of undefined (reading 'x')); the rule was skipped for this document.",
      };
      const linted = lint(source, options);
      expect(ruleErrors(linted)).toEqual([expected]);
      expect(linted.filter((item) => item.rule === "style/emphasis")).toHaveLength(2);
      const result = format(source, options);
      expect(result.output).toBe("A _b_ c.\n");
      expect(result.diagnostics).toEqual([expected]);
      // Ranges leave out findings elsewhere, never the engine's.
      const ranged = lint("Text.\n\n" + source, { ...options, ranges: [{ start: 7, end: 7 }] });
      expect(ruleErrors(ranged)).toEqual([expected]);
      const thrown = failing(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Test isolation of a non-Error throw.
        throw "text";
      }, kind);
      expect(ruleErrors(lint(source, thrown))).toMatchObject([
        { message: stringContaining("Rule test/fragile failed (text);") },
      ]);
    },
  );
  it.each([
    [undefined, "returned undefined instead of a list of findings"],
    [{ start: 0, message: "m" }, "returned an object instead of a list of findings"],
    [[5], "returned a finding that is 5, not an object"],
    [[{ start: 0 }], "returned a finding whose message is undefined, not a string"],
    [
      [{ start: -4, message: "m" }],
      "returned a finding whose start is -4, not an offset from 0 to 9",
    ],
    [
      [{ start: Number.NaN, message: "m" }],
      "returned a finding whose start is NaN, not an offset from 0 to 9",
    ],
    [
      [{ start: 1.5, message: "m" }],
      "returned a finding whose start is 1.5, not an offset from 0 to 9",
    ],
    [
      [{ start: 10, message: "m" }],
      "returned a finding whose start is 10, not an offset from 0 to 9",
    ],
    [
      [{ start: 2, end: 1, message: "m" }],
      "returned a finding whose end is 1, not an offset from 2 to 9",
    ],
    [
      [{ start: 0, message: "m", edit: null }],
      "returned a finding whose edit is null, not an object",
    ],
    [
      [{ start: 0, message: "m", edit: { start: 0, end: 99, text: "x" } }],
      "returned an edit whose end is 99, not an offset from 0 to 9",
    ],
    [
      [{ start: 0, message: "m", edit: { start: "0", end: 1, text: "x" } }],
      'returned an edit whose start is "0", not an offset from 0 to 9',
    ],
    [
      [{ start: 0, message: "m", edit: { start: 0, end: 1 } }],
      "returned an edit whose text is undefined, not a string",
    ],
  ])("reports invalid findings as engine/rule-error: %j", (returned, problem) => {
    for (const kind of ["problem", "style"] as const) {
      const options = failing(() => returned as Finding[], kind);
      const message = `Rule test/fragile ${problem}; the rule was skipped for this document.`;
      const linted = lint(source, options);
      expect(linted.filter((item) => item.rule.startsWith("test/"))).toEqual([]);
      expect(ruleErrors(linted)).toMatchObject([{ message, line: 1, column: 1 }]);
      const result = format(source, options);
      expect(result.output).toBe("A _b_ c.\n");
      expect(result.diagnostics).toMatchObject([{ rule: "engine/rule-error", message }]);
    }
  });
  it("lets an error of the workspace through, as the rule saw it", () => {
    const error = Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
    const workspace = createWorkspace({
      "Note.md": () => {
        throw error;
      },
    });
    const asking = (handle: (caught: unknown) => Finding[]) =>
      failing(({ workspace: asked }) => {
        try {
          asked?.resolve("Doc.md", "Note.md#part", "github");
          return [];
        } catch (caught) {
          return handle(caught);
        }
      });
    const rethrown = asking((caught) => {
      throw caught;
    });
    expect(() => lint(source, { ...rethrown, workspace })).toThrow(error);
    expect(() => format(source, { ...rethrown, workspace })).toThrow(error);
    // A rule that handles the error itself is not failing; one that throws its own is.
    const handled = lint(source, {
      ...asking((caught) => [{ start: 0, message: caught === error ? "Same" : "Other" }]),
      workspace,
    });
    expect(handled.filter((item) => item.rule === "test/fragile")).toMatchObject([
      { message: "Same" },
    ]);
    const replaced = asking(() => {
      throw new Error("Own");
    });
    expect(ruleErrors(lint(source, { ...replaced, workspace }))).toMatchObject([
      { message: stringContaining("failed (Error: Own)") },
    ]);
    expect(ruleErrors(format(source, { ...replaced, workspace }).diagnostics)).toMatchObject([
      { message: stringContaining("failed (Error: Own)") },
    ]);
  });
  it("rejects a plugin named engine, whose findings would pass for the engine's own", () => {
    const check = () => [{ start: 0, message: "not the engine" }];
    const plugins: Plugin[] = [
      { name: "engine", rules: { "unsafe-format": { kind: "problem", description: "x", check } } },
    ];
    const message = "Invalid plugin name: engine is reserved for the engine's own diagnostics";
    expect(() => ruleRegistry(plugins)).toThrow(message);
    const config: Config = { extends: [], rules: { "engine/unsafe-format": "warn" } };
    for (const run of [lint, format])
      expect(() => run("Text.\n", { plugins, config })).toThrow(message);
  });
  it("checks offsets in the text that rules see, without a byte order mark", () => {
    const mark = String.fromCharCode(0xfeff);
    const at = (start: number) => failing(() => [{ start, message: "End" }]);
    expect(lint(`${mark}A.\n`, at(3))).toMatchObject([{ rule: "test/fragile", start: 4 }]);
    expect(lint(`${mark}A.\n`, at(4))).toMatchObject([
      { message: stringContaining("start is 4, not an offset from 0 to 3") },
    ]);
  });
  it.each([
    [
      { kind: "style", phase: "Inline" },
      'its phase is "Inline", not "inline", "block", or "document"',
    ],
    [{ kind: "Style" }, 'its kind is "Style", not "style" or "problem"'],
    [{ kind: "problem", check: undefined }, "its check is undefined, not a function"],
    [{ kind: "problem", description: undefined }, "its description is undefined, not a string"],
    [{ kind: "problem", schema: "object" }, 'its schema is "object", not a JSON Schema'],
  ])("rejects a plugin rule that does not have the shape of a rule: %j", (fields, problem) => {
    const rule = { description: "Invalid", check: () => [], ...fields } as unknown as Rule;
    const plugins: Plugin[] = [{ name: "test", rules: { invalid: rule } }];
    const message = `Invalid rule test/invalid: ${problem}.`;
    expect(() => ruleRegistry(plugins)).toThrow(message);
    // Also when the rule is off: a plugin with an invalid rule is unusable.
    for (const run of [lint, format])
      expect(() => run("Text.\n", { plugins, config: { extends: [] } })).toThrow(message);
    expect(() =>
      ruleRegistry([{ name: "test", rules: { invalid: null as unknown as Rule } }]),
    ).toThrow("Invalid rule test/invalid: it is null, not an object.");
  });
  it("looks rule and preset names up only among those defined", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      const rules = JSON.parse(`{"${name}": "warn"}`) as NonNullable<Config["rules"]>;
      expect(() => lint("Text.\n", { config: { rules } })).toThrow(`Unknown rule: ${name}`);
      expect(() => format("Text.\n", { config: { extends: [name] } })).toThrow(
        `Unknown preset: ${name}`,
      );
    }
    expect(canonicalDialect("toString" as Dialect)).toBe("toString");
  });
  it("names the rule whose option schema cannot be compiled", () => {
    const plugins: Plugin[] = [
      {
        name: "test",
        rules: {
          options: {
            kind: "problem",
            description: "Invalid schema",
            schema: { type: "nonsense" },
            check: () => [],
          },
        },
      },
    ];
    expect(() =>
      lint("Text.\n", { plugins, config: { extends: [], rules: { "test/options": "warn" } } }),
    ).toThrow("Invalid rule test/options: its schema cannot be compiled: schema is invalid");
  });
  it("enforces an option schema of false, which no options pass", () => {
    const plugins: Plugin[] = [
      {
        name: "test",
        rules: {
          none: { kind: "problem", description: "No options", schema: false, check: () => [] },
        },
      },
    ];
    expect(
      lint("Text.\n", { plugins, config: { extends: [], rules: { "test/none": "warn" } } }),
    ).toEqual([]);
    expect(() =>
      lint("Text.\n", {
        plugins,
        config: { extends: [], rules: { "test/none": ["warn", { n: 1 }] } },
      }),
    ).toThrow("Invalid options for test/none");
  });
  it("refuses an asynchronous option schema when the rule set is built", async () => {
    const rejected: unknown[] = [];
    const record = (reason: unknown) => rejected.push(reason);
    process.on("unhandledRejection", record);
    try {
      const schema = { $async: true, type: "object", properties: { n: { type: "integer" } } };
      const plugins: Plugin[] = [
        {
          name: "test",
          rules: { slow: { kind: "problem", description: "Async", schema, check: () => [] } },
        },
      ];
      for (const options of [{}, { n: "x" }])
        expect(() =>
          lint("Text.\n", {
            plugins,
            config: { extends: [], rules: { "test/slow": ["warn", options] } },
          }),
        ).toThrow(
          "Invalid rule test/slow: its schema is asynchronous ($async), and options are checked synchronously",
        );
      // Before, the check returned a promise that rejected after the run.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(rejected).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
  it("compiles each option schema once, however many documents use it", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { level: { type: "integer" } },
    };
    const plugins: Plugin[] = [
      {
        name: "test",
        rules: { options: { kind: "problem", description: "Options", schema, check: () => [] } },
      },
    ];
    const compile = vi.spyOn(Ajv.prototype, "compile");
    try {
      for (let level = 0; level < 5; level++)
        lint("Text.\n", {
          plugins,
          config: { extends: [], rules: { "test/options": ["warn", { level }] } },
        });
      expect(() =>
        lint("Text.\n", {
          plugins,
          config: { extends: [], rules: { "test/options": ["warn", { level: "high" }] } },
        }),
      ).toThrow('Invalid options for test/options: "level" must be an integer, not "high"');
      expect(compile.mock.calls.filter(([compiled]) => compiled === schema)).toHaveLength(1);
    } finally {
      compile.mockRestore();
    }
  });
});

describe("processing selected ranges", () => {
  const emphasis: ProcessOptions = {
    config: { extends: [], dialect: "github", rules: { "style/emphasis": "warn" } },
  };
  const at = (source: string, text: string, length = 0) => {
    const start = source.indexOf(text);
    return { start, end: start + length };
  };
  it("changes only the blocks that a range touches and keeps the rest of the document", () => {
    const source =
      "# Guide\n\nLegacy *word* stays.\n\nChange *this paragraph*, with [setup][setup].\n\n[setup]: ./setup.md\n";
    const result = format(source, { ...emphasis, ranges: [at(source, "Change", 3)] });
    expect(result.output).toBe(
      "# Guide\n\nLegacy *word* stays.\n\nChange _this paragraph_, with [setup][setup].\n\n[setup]: ./setup.md\n",
    );
    // The scope is the whole paragraph with the line breaks next to it, in the output's positions.
    const paragraph = at(result.output, "Change", 45);
    expect(result.scope).toEqual([{ start: paragraph.start - 1, end: paragraph.end + 1 }]);
    // The diagnostics describe the result; those outside the scope are left out.
    expect(result.diagnostics).toEqual([]);
    // Lint reports what starts in the selected blocks; an empty range at a position selects its block.
    expect(
      lint(source, { ...emphasis, ranges: [at(source, "stays")] }).map((item) => item.line),
    ).toEqual([3, 3]);
    // A finding belongs to the block where it starts: links/valid reports a
    // reference link's target at its definition, not at the link.
    const workspace = createWorkspace({ "guide.md": source }, { dialect: "github" });
    const links: ProcessOptions = {
      path: "guide.md",
      workspace,
      config: { extends: [], dialect: "github", rules: { "links/valid": "error" } },
    };
    expect(lint(source, { ...links, ranges: [at(source, "[setup]:", 3)] })).toEqual([
      expect.objectContaining({ line: 7, message: "Missing local target: ./setup.md." }),
    ]);
    expect(lint(source, { ...links, ranges: [at(source, "Change", 3)] })).toEqual([]);
  });
  it("processes everything without ranges, nothing for an empty list, and refuses invalid ranges", () => {
    const source = "A *b*.\n\nC *d*.\n";
    expect(format(source, emphasis)).toEqual({
      output: "A _b_.\n\nC _d_.\n",
      changed: true,
      diagnostics: [],
    });
    expect(format(source, { ...emphasis, ranges: [] })).toEqual({
      output: source,
      changed: false,
      diagnostics: [],
      scope: [],
    });
    expect(lint(source, { ...emphasis, ranges: [] })).toEqual([]);
    for (const ranges of [
      [{ start: -1, end: 2 }],
      [{ start: 3, end: 2 }],
      [{ start: 0, end: source.length + 1 }],
      [{ start: 0.5, end: 2 }],
    ])
      for (const call of [lint, format])
        expect(() => call(source, { ...emphasis, ranges }), JSON.stringify(ranges)).toThrow(
          "Invalid range",
        );
    // A range that touches no block, such as one in blank lines, selects nothing.
    expect(format(source, { ...emphasis, ranges: [{ start: 7, end: 8 }] }).output).toBe(source);
    expect(format(source, { ...emphasis, ranges: [{ start: 7, end: 7 }] }).scope).toEqual([]);
  });
  it("selects single paragraphs in lists and quotes, and everything between two of them", () => {
    const source = "- A *a*\n- B *b*\n  > Q *q*\n  >\n  > R *r*\n- C *c*\n";
    const formatted = (ranges: { start: number; end: number }[]) =>
      format(source, { ...emphasis, ranges }).output;
    expect(formatted([at(source, "Q", 1)])).toBe(
      "- A *a*\n- B *b*\n  > Q _q_\n  >\n  > R *r*\n- C *c*\n",
    );
    expect(formatted([at(source, "B", 1)])).toBe(
      "- A *a*\n- B _b_\n  > Q *q*\n  >\n  > R *r*\n- C *c*\n",
    );
    const from = source.indexOf("a*");
    expect(formatted([{ start: from, end: source.indexOf("Q") + 1 }])).toBe(
      "- A _a_\n- B _b_\n  > Q _q_\n  >\n  > R *r*\n- C *c*\n",
    );
  });
  it("moves the scope with the edits through every phase and pass", () => {
    const long = (word: string) => `${word} ${"word ".repeat(12).trim()} *end*.`;
    const source = [long("One"), long("Two"), long("Three")].join("\n\n") + "\n";
    const options: ProcessOptions = { config: narrow };
    const result = format(source, {
      ...options,
      ranges: [at(source, "One", 3), at(source, "Three", 5)],
    });
    const whole = formatted(source, options).split("\n\n");
    const parts = result.output.split("\n\n");
    expect(parts).toEqual([whole[0], long("Two"), whole[2]]);
    expect(result.scope!.map((part) => result.output.slice(part.start, part.end))).toEqual([
      `${whole[0]}\n`,
      `\n${whole[2]}`,
    ]);
    // Formatting the scope again changes nothing.
    expect(format(result.output, { ...options, ranges: result.scope! }).changed).toBe(false);
  });
  it("does not apply an edit that reaches outside the scope, and keeps its diagnostic", () => {
    const plugin: Plugin = {
      name: "wide",
      rules: {
        join: {
          description: "Propose one edit across two paragraphs",
          kind: "style",
          check: ({ document }) => {
            const end = document.source.indexOf("Second") + 6;
            return [{ start: 0, end, message: "Join", edit: { start: 0, end, text: "Joined" } }];
          },
        },
      },
    };
    const source = "First.\n\nSecond.\n";
    const result = format(source, {
      plugins: [plugin],
      config: { extends: [], rules: { "wide/join": "warn" } },
      ranges: [at(source, "First", 1)],
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics).toEqual([expect.objectContaining({ rule: "wide/join", start: 0 })]);
  });
  it("applies an insertion at the edge of the scope", () => {
    const source = "First *one*.\n\nLast *one*.";
    const options: ProcessOptions = {
      config: { extends: [], rules: { "style/final-newline": "warn", "style/emphasis": "warn" } },
    };
    expect(format(source, { ...options, ranges: [at(source, "Last", 1)] }).output).toBe(
      "First *one*.\n\nLast _one_.\n",
    );
    expect(format(source, { ...options, ranges: [at(source, "First", 1)] }).output).toBe(
      "First _one_.\n\nLast *one*.",
    );
  });
  it("counts UTF-16 units, CRLF line ends, and a byte order mark in its offsets", () => {
    const mark = String.fromCharCode(0xfeff);
    const source = `${mark}🙂 *a*.\r\n\r\nÜber *b*.\r\n`;
    const result = format(source, { ...emphasis, ranges: [at(source, "Über", 1)] });
    expect(result.output).toBe(`${mark}🙂 *a*.\r\n\r\nÜber _b_.\r\n`);
    const block = at(result.output, "Über", 9);
    expect(result.scope).toEqual([{ start: block.start - 2, end: block.end + 2 }]);
    expect(format(source, { ...emphasis, ranges: [{ start: 0, end: 1 }] }).scope).toEqual([]);
    expect(format(source, { ...emphasis, ranges: [{ start: 1, end: 2 }] }).output).toBe(
      `${mark}🙂 _a_.\r\n\r\nÜber *b*.\r\n`,
    );
  });
  it("keeps suppressions and the whole-document safety check", () => {
    const source = "<!-- mdtools-disable-next-line style/emphasis -->\nA *b*.\n\nC *d*.\n";
    expect(format(source, { ...emphasis, ranges: [at(source, "A", 1)] }).output).toBe(source);
    const unsafe: Plugin = {
      name: "unsafe",
      rules: {
        drop: {
          description: "Remove a paragraph's text",
          kind: "style",
          check: ({ document }) => {
            const start = document.source.indexOf("C");
            return [{ start, message: "Drop", edit: { start, end: start + 6, text: "" } }];
          },
        },
      },
    };
    const result = format(source, {
      plugins: [unsafe],
      config: { extends: [], rules: { "unsafe/drop": "warn" } },
      ranges: [at(source, "C", 1)],
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics.map((item) => [item.rule, item.line])).toEqual([
      ["engine/unsafe-format", 4],
      ["unsafe/drop", 4],
    ]);
    const block = at(source, "C", 6);
    expect(result.scope).toEqual([{ start: block.start - 1, end: block.end + 1 }]);
  });
  it("takes in a selected block's markers and the line breaks next to it", () => {
    const spacing: ProcessOptions = {
      config: { extends: [], rules: { "style/block-spacing": "warn" } },
    };
    const source = "# Setup\nInstall the package.\n- Run the command.\n";
    const formattedWith = (ranges: { start: number; end: number }[]) =>
      format(source, { ...spacing, ranges }).output;
    const messages = (ranges: { start: number; end: number }[]) =>
      lint(source, { ...spacing, ranges }).map((item) => item.message);
    // The blank line next to a selected block is part of formatting that block.
    expect(formattedWith([at(source, "Setup", 1)])).toBe(
      "# Setup\n\nInstall the package.\n- Run the command.\n",
    );
    expect(formattedWith([at(source, "Install", 1)])).toBe(
      "# Setup\n\nInstall the package.\n\n- Run the command.\n",
    );
    expect(formattedWith([at(source, "Run", 1)])).toBe(
      "# Setup\nInstall the package.\n\n- Run the command.\n",
    );
    // The list's marker is on the selected block's line, and so is a cursor on it.
    expect(messages([at(source, "Run", 1)])).toEqual(["Add a blank line before the list."]);
    expect(messages([at(source, "- Run")])).toEqual(["Add a blank line before the list."]);
    expect(messages([at(source, "Setup", 1)])).toEqual(["Add a blank line after the heading."]);
    // A quote's markers on the block's first line belong to its scope too.
    const quoted = "> # Title\n> Text.\n";
    const result = format(quoted, { ...spacing, ranges: [at(quoted, "Text", 1)] });
    expect(result.output).toBe("> # Title\n>\n> Text.\n");
    // The scope grows by the line that was added in it.
    expect(result.output.slice(result.scope![0]!.start, result.scope![0]!.end)).toBe(
      "\n>\n> Text.\n",
    );
  });
  it("gives the same result for a range over the whole document as without ranges", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.constantFrom("alpha", "*bravo*", "`code`", "éclair", "🙂", "**delta**"), {
            minLength: 1,
            maxLength: 30,
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.constantFrom("", "- ", "> "),
        fc.nat(),
        fc.nat(),
        (paragraphs, prefix, a, b) => {
          const source = paragraphs.map((words) => prefix + words.join(" ")).join("\n\n") + "\n";
          const options: ProcessOptions = { config: narrow };
          const whole = format(source, options);
          const all = format(source, { ...options, ranges: [{ start: 0, end: source.length }] });
          expect({ ...all, scope: undefined }).toEqual({ ...whole, scope: undefined });
          // Outside the scope of any range, the text stays as it was.
          const start = Math.min(a, b) % (source.length + 1);
          const end = Math.max(start, Math.max(a, b) % (source.length + 1));
          const part = format(source, { ...options, ranges: [{ start, end }] });
          if (!part.scope!.length) {
            expect(part.output).toBe(source);
            return;
          }
          const first = part.scope![0]!;
          const last = part.scope![part.scope!.length - 1]!;
          expect(part.output.slice(0, first.start)).toBe(source.slice(0, first.start));
          expect(part.output.slice(last.end)).toBe(
            source.slice(source.length - (part.output.length - last.end)),
          );
          expect(format(part.output, { ...options, ranges: part.scope! }).changed).toBe(false);
        },
      ),
      { numRuns: 150, seed: 20261017 },
    );
  });
});

describe("configuration and plugins", () => {
  describe("recommended block spacing (#423)", () => {
    const source = "# Setup\nInstall the package.\n- Run the command.\n";
    const output = "# Setup\n\nInstall the package.\n\n- Run the command.\n";
    it.each<Config | undefined>([
      undefined,
      {},
      { extends: "recommended" },
      { extends: ["recommended"] },
    ])("warns and formats missing separators with configuration %j", (config) => {
      expect(resolveConfig({ config }).rules["style/block-spacing"]).toBe("warn");
      expect(lint(source, { config })).toMatchObject([
        { rule: "style/block-spacing", severity: "warn" },
        { rule: "style/block-spacing", severity: "warn" },
      ]);
      expect(formatted(source, { config })).toBe(output);
      expect(semanticFingerprint(parse(output, "github"))).toBe(
        semanticFingerprint(parse(source, "github")),
      );
    });
    it("allows opting out while retaining the other recommended rules", () => {
      const config: Config = { rules: { "style/block-spacing": "off" } };
      expect(lint(source, { config })).toEqual([]);
      expect(formatted(source, { config })).toBe(source);
      expect(formatted(source.replace("Install", "*Install*"), { config })).toBe(
        source.replace("Install", "_Install_"),
      );
    });
    it.each<Config>([{ extends: [] }, { extends: "github" }])(
      "does not enable spacing outside recommended with configuration %j",
      (config) => {
        expect(resolveConfig({ config }).rules["style/block-spacing"]).toBeUndefined();
        expect(lint(source, { config })).toEqual([]);
        expect(formatted(source, { config })).toBe(source);
      },
    );
  });
  it("supports region and next-line suppressions without interpreting code examples", () => {
    const source =
      "<!-- mdtools-disable style/emphasis -->\n\n*keep*\n\n<!-- mdtools-enable style/emphasis -->\n\n*change*\n\n<!-- mdtools-disable-next-line style/emphasis -->\n*also keep*\n";
    const output = formatted(source);
    expect(output).toContain("*keep*");
    expect(output).toContain("_change_");
    expect(output).toContain("*also keep*");
    const code = "```md\n<!-- mdtools-disable -->\n```\n\n*change*\n";
    expect(formatted(code)).toContain("_change_");
  });
  it("supports defaults, overrides, and explicit empty presets", () => {
    expect(resolveConfig({}).rules["style/wrap"]).toEqual(["warn", { width: 80 }]);
    const source = "word ".repeat(18).trimEnd() + "\n";
    const expected = "word ".repeat(16).trimEnd() + "\nword word\n";
    expect(formatted(source)).toBe(expected);
    expect(formatted(source, { config: { rules: { "style/wrap": "warn" } } })).toBe(expected);
    expect(
      formatted(source, { config: { rules: { "style/wrap": ["warn", { width: 100 }] } } }),
    ).toBe(source);
    expect(resolveConfig({ config: { extends: [] } }).rules).toEqual({});
    expect(
      resolveConfig({
        config: {
          overrides: [
            { files: ["vault/**/*.md"], dialect: "obsidian", rules: { "style/wrap": "off" } },
          ],
        },
        path: "vault/a.md",
      }).rules["style/wrap"],
    ).toBe("off");
  });
  it("matches override patterns without compiling them for every document", () => {
    const paths = Array.from({ length: 5000 }, (_, index) => `docs/part-${index % 50}/${index}.md`);
    // Patterns that match none of the paths, so that each is tried for each.
    const files = Array.from({ length: 8 }, (_, index) => `drafts-${index}/**/*.md`);
    const overridden: Config = { overrides: [{ files, rules: { "style/wrap": "off" } }] };
    const fastest = (config: Config) => {
      let best = Infinity;
      for (let run = 0; run < 5; run++) {
        const started = performance.now();
        for (const path of paths) resolveConfig({ config, path });
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    expect(resolveConfig({ config: overridden, path: "drafts-3/a/b.md" }).rules["style/wrap"]).toBe(
      "off",
    );
    // Resolving without overrides is the baseline. Compiling the patterns for
    // each document took about fifteen times as long as that.
    expect(fastest(overridden) / fastest({})).toBeLessThan(6);
  });
  it("rejects unknown configuration, rules, options, and preset cycles", () => {
    expect(() => lint("", { config: { rules: { typo: "warn" } } })).toThrow("Unknown rule");
    expect(() => lint("", { config: { rules: { "style/wrap": ["warn", { width: 2 }] } } })).toThrow(
      "Invalid options",
    );
    expect(() => resolveConfig({ config: { typo: true } as Config })).toThrow(
      "Invalid configuration",
    );
    expect(() =>
      resolveConfig({
        config: { extends: ["local/a"] },
        path: "a.md",
        plugins: [{ name: "local", presets: { a: { extends: ["local/a"] } } }],
      }),
    ).toThrow("Circular");
  });
  it("matches override patterns with their letter case on every system", () => {
    const config: Config = { overrides: [{ files: ["docs/**"], dialect: "obsidian" }] };
    expect(resolveConfig({ config, path: "docs/a.md" }).dialect).toBe("obsidian");
    expect(resolveConfig({ config, path: "Docs/a.md" }).dialect).toBe("github");
  });
  it("accepts one preset name for extends and a severity alone in a list", () => {
    expect(resolveConfig({ config: { extends: "github" } })).toEqual(
      resolveConfig({ config: { extends: ["github"] } }),
    );
    expect(() =>
      resolveConfig({
        config: { extends: "local/a" },
        path: "a.md",
        plugins: [{ name: "local", presets: { a: { extends: "local/a" } } }],
      }),
    ).toThrow("Circular preset: local/a -> local/a");
    const config: Config = { extends: [], rules: { "style/wrap": ["warn"] } };
    const source = "word ".repeat(18).trimEnd() + "\n";
    expect(formatted(source, { config })).toBe(
      formatted(source, { config: { extends: [], rules: { "style/wrap": "warn" } } }),
    );
    expect(
      lint("*a*\n", { config: { extends: [], rules: { "style/emphasis": ["off"] } } }),
    ).toEqual([]);
  });
  it.each([
    [5, "the configuration must be an object, not 5"],
    [{ typo: 1, rule: {} }, 'unknown setting "typo"; unknown setting "rule"'],
    [{ extends: 5 }, '"extends" must be a preset name or a list of preset names, not 5'],
    [{ extends: ["github", 5] }, '"extends[1]" must be a preset name, not 5'],
    [
      { dialect: "markdown" },
      '"dialect" must be "commonmark", "github", "forgejo", "codeberg", "gitea", or "obsidian", not "markdown"',
    ],
    [{ rules: [] }, '"rules" must be an object of rule IDs and their settings, not a list'],
    [
      { rules: { "style/wrap": "warning" } },
      'the setting of "style/wrap" must be "off", "warn", or "error", or a list of a severity and, optionally, the rule\'s options, not "warning"',
    ],
    [
      { rules: { "style/wrap": ["warnn"] } },
      'the severity of "style/wrap" must be "off", "warn", or "error", not "warnn"',
    ],
    [
      { rules: { "style/wrap": ["warn", 80] } },
      'the options of "style/wrap" must be an object, not 80',
    ],
    [
      { rules: { "style/wrap": ["warn", {}, {}] } },
      'the setting of "style/wrap" must be "off", "warn", or "error", or a list of a severity and, optionally, the rule\'s options',
    ],
    [{ ignore: "drafts/**" }, '"ignore" must be a list of path patterns, not "drafts/**"'],
    [{ plugins: [null] }, '"plugins[0]" must be a file or package name, not null'],
    [
      { resolve: { gitIgnored: "yes", other: true } },
      'unknown setting "resolve.other"; "resolve.gitIgnored" must be true or false, not "yes"',
    ],
    [{ overrides: [{ rules: {} }] }, '"overrides[0]" must have "files"'],
    [
      { overrides: [{ files: [] }] },
      '"overrides[0].files" must be a list of one or more path patterns',
    ],
    [
      { overrides: [{ files: ["a.md"], rules: { "style/wrap": "on" } }] },
      'the setting of "style/wrap" in "overrides[0]" must be "off", "warn", or "error", or a list of a severity and, optionally, the rule\'s options, not "on"',
    ],
  ])("says what is wrong with %j by setting name", (value, problem) => {
    expect(() => validateConfig(value)).toThrow(new Error(`Invalid configuration: ${problem}`));
  });
  it("takes one options object, and says so for the prereleases' form", () => {
    const message =
      "resolveConfig takes one options object, { path, config, plugins, defaultDialect }, since mdrefine 0.2.0.";
    const call = resolveConfig as (...parameters: unknown[]) => unknown;
    expect(() => call({ extends: [] })).toThrow(new TypeError(message));
    expect(() => call({ dialect: "github" })).toThrow(new TypeError(message));
    expect(() => call({}, "a.md")).toThrow(new TypeError(message));
    expect(() => call(undefined, "Note.md", [], "obsidian")).toThrow(new TypeError(message));
    expect(() => call(null)).toThrow(new TypeError(message));
    // The options of lint and format serve as they are.
    const options: ProcessOptions = {
      path: "vault/a.md",
      config: { overrides: [{ files: ["vault/**"], dialect: "obsidian" }] },
      workspace: createWorkspace({}),
      ranges: [],
    };
    expect(resolveConfig(options).dialect).toBe("obsidian");
    expect(lint("*a*\n", { ...options, ranges: undefined })).toEqual(
      lint("*a*\n", { path: options.path, config: options.config }),
    );
  });
  it("freezes the tables that it exports, which every caller shares", () => {
    expect(() => {
      // @ts-expect-error The table is read-only.
      presets.recommended!.rules!["style/wrap"] = "off";
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error The options are read-only too.
      (presets.recommended!.rules!["style/wrap"] as readonly unknown[])[1] = { width: 20 };
    }).toThrow(TypeError);
    expect(resolveConfig().rules["style/wrap"]).toEqual(["warn", { width: 80 }]);
    expect(() => {
      // @ts-expect-error The rules and their schemas are read-only.
      builtInRules["style/wrap"]!.check = () => [];
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error Bypass the read-only type to test runtime freezing.
      dialects.push("markdown"); // eslint-disable-line @typescript-eslint/no-unsafe-call
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error The aliases are read-only.
      dialectAliases.codeberg = "github";
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error The schema is read-only.
      configSchema.title = "Other";
    }).toThrow(TypeError);
    expect(Object.isFrozen((configSchema.properties as { extends: object }).extends)).toBe(true);
    // A registry is a new table, which its caller may change.
    const registry = ruleRegistry();
    delete registry["style/wrap"];
    expect(builtInRules["style/wrap"]).toBeDefined();
    // Frozen presets are configurations like any other.
    expect(resolveConfig({ config: presets.github }).dialect).toBe("github");
  });
  it("reads a document in the dialect that an alias stands for", () => {
    const source = "# Title {#custom}\n\n[Title](#custom)\n";
    const document = parse(source, "codeberg");
    expect(document.dialect).toBe("forgejo");
    expect(semanticFingerprint(document)).toBe(semanticFingerprint(parse(source, "forgejo")));
    expect(() => parse(source, "markdown" as Dialect)).toThrow("Unknown dialect: markdown");
  });
  it("says what is wrong with a rule's options by option name", () => {
    const wrap = (options: Record<string, unknown>) => () =>
      lint("", { config: { extends: [], rules: { "style/wrap": ["warn", options] } } });
    expect(wrap({ width: "80" })).toThrow(
      new Error('Invalid options for style/wrap: "width" must be an integer, not "80"'),
    );
    expect(wrap({ width: 10 })).toThrow(
      new Error('Invalid options for style/wrap: "width" must be at least 20'),
    );
    expect(wrap({ widht: 80 })).toThrow(
      new Error('Invalid options for style/wrap: unknown option "widht"'),
    );
    // An enumerated option names the values it allows.
    expect(() =>
      lint("", { config: { extends: [], rules: { "style/emphasis": ["warn", { marker: "~" }] } } }),
    ).toThrow(
      new Error('Invalid options for style/emphasis: "marker" must be "*" or "_", not "~"'),
    );
  });
  it("supports custom diagnostics and rejects semantic-changing style plugins", () => {
    const plugin: Plugin = {
      name: "example",
      rules: {
        forbidden: {
          kind: "problem",
          description: "Detect a word",
          check: ({ document }) =>
            document.source.includes("secret") ? [{ start: 0, message: "Contains secret." }] : [],
        },
        destructive: {
          kind: "style",
          description: "Bad plugin",
          check: () => [
            { start: 0, message: "Replace", edit: { start: 0, end: 4, text: "other" } },
          ],
        },
      },
    };
    expect(
      lint("secret", {
        config: { extends: [], rules: { "example/forbidden": "error" } },
        plugins: [plugin],
      })[0]?.rule,
    ).toBe("example/forbidden");
    const result = format("word\n", {
      config: { extends: [], rules: { "example/destructive": "warn" } },
      plugins: [plugin],
    });
    expect(result.output).toBe("word\n");
    expect(result.diagnostics[0]?.rule).toBe("engine/unsafe-format");
  });
  it("validates changing options and scopes custom schema IDs to each invocation", () => {
    expect(() =>
      lint("", { config: { rules: { "style/wrap": ["warn", { width: 30 }] } } }),
    ).not.toThrow();
    expect(() => lint("", { config: { rules: { "style/wrap": ["warn", { width: 1 }] } } })).toThrow(
      "Invalid options",
    );
    for (const field of ["first", "second"]) {
      const plugin: Plugin = {
        name: "local",
        rules: {
          check: {
            kind: "problem",
            description: "Schema isolation",
            check: () => [],
            schema: {
              $id: "https://example.test/options",
              type: "object",
              required: [field],
              properties: { [field]: { type: "boolean" } },
            },
          },
        },
      };
      expect(() =>
        lint("", {
          plugins: [plugin],
          config: { extends: [], rules: { "local/check": ["warn", { [field]: true }] } },
        }),
      ).not.toThrow();
    }
  });
  it("rejects overlapping edits", () => {
    expect(() =>
      applyEdits("abc", [
        { start: 0, end: 2, text: "a" },
        { start: 1, end: 3, text: "b" },
      ]),
    ).toThrow("overlapping");
    expect(() => applyEdits("abc", [{ start: -1, end: 2, text: "a" }])).toThrow("invalid");
  });
  it("applies many edits in linear time", () => {
    const source = Array.from({ length: 20000 }, (_, i) => `Paragraph ${i} with *emphasis*.`).join(
      "\n\n",
    );
    const edits = [];
    for (let at = source.indexOf("*"); at >= 0; at = source.indexOf("*", at + 1))
      edits.push({ start: at, end: at + 1, text: "_" });
    edits.push(
      { start: 0, end: 0, text: "# Title\n\n" },
      { start: source.length, end: source.length, text: "\n" },
    );
    // The reference is linear on purpose: sequential splicing is the behaviour under test.
    const expected = `# Title\n\n${source.replaceAll("*", "_")}\n`;
    const started = performance.now();
    const output = applyEdits(source, edits);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(output).toBe(expected);
    expect(applyEdits(source, [])).toBe(source);
  });
});

describe("the dialect assumed when none is named", () => {
  // Every document here is a table or a footnote on GitHub, Forgejo, Gitea, and
  // in Obsidian. CommonMark, which was assumed up to 0.2.0-rc.1, reads the
  // tables and the consecutive definitions as ordinary paragraphs, which
  // `style/wrap` then reflowed, and a footnote definition as a link definition.
  const table = "| Sensor | Unit |\n|---|---|\n| Temperature | °C |\n";
  const bareTable = "Sensor | Unit\n---|---\nTemperature | °C\n";
  const wideTable =
    "| Sensor name in a long header cell | Unit of measurement in a long header cell | Notes |\n" +
    "|---|---|---|\n" +
    "| Temperature measured at the north wall | Degrees Celsius, to one decimal place | Calibrated yearly |\n";
  const footnotes = "Text with two notes.[^1][^2]\n\n[^1]: First note.\n[^2]: Second note.\n";
  const footnote = "Text with a note.[^1]\n\n[^1]: Text.\n";
  const commonmark: Config = { dialect: "commonmark" };
  // `recommended` aligns tables, which it would not do to a paragraph.
  const aligned = "| Sensor      | Unit |\n| ----------- | ---- |\n| Temperature | °C   |\n";
  const wideAligned =
    "| Sensor name in a long header cell      | Unit of measurement in a long header cell | Notes             |\n" +
    "| -------------------------------------- | ----------------------------------------- | ----------------- |\n" +
    "| Temperature measured at the north wall | Degrees Celsius, to one decimal place     | Calibrated yearly |\n";
  it("is GitHub, for a configuration, a preset, or a workspace that names none", () => {
    expect(resolveConfig().dialect).toBe("github");
    expect(resolveConfig({ config: { extends: ["recommended"] } }).dialect).toBe("github");
    expect(
      resolveConfig({ config: { extends: [], rules: { "style/wrap": "warn" } } }).dialect,
    ).toBe("github");
    const spy = vi.spyOn(syntax, "parse");
    try {
      const workspace = createWorkspace({ "note.md": "", "target.md": "# Title\n" });
      expect(workspace.resolve("note.md", "target.md#title", "github").fragmentExists).toBe(true);
      expect(spy).toHaveBeenCalledExactlyOnceWith("# Title\n", "github", "target.md");
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    ["a table with outer pipes", table, aligned],
    ["a table without outer pipes", bareTable, aligned],
    ["a table wider than 80 columns", wideTable, wideAligned],
    ["two consecutive footnote definitions", footnotes, footnotes],
  ])("keeps %s, which is not prose to wrap", (_, source, output) => {
    // No configuration: the `recommended` preset, which wraps prose at 80 columns.
    const result = format(source);
    expect(result.output).toBe(output);
    expect(result.diagnostics.filter((item) => item.rule !== "style/table")).toEqual([]);
    expect(format(source, { config: { dialect: "github" } })).toEqual(result);
    expect(format(output)).toEqual({ output, changed: false, diagnostics: [] });
    expect(lint(output)).toEqual([]);
  });
  it("reads a footnote definition as a footnote, not as a link to a missing file", () => {
    const workspace = createWorkspace({ "note.md": footnote });
    expect(lint(footnote, { path: "note.md", workspace })).toEqual([]);
    expect(format(footnote, { path: "note.md", workspace })).toEqual({
      output: footnote,
      changed: false,
      diagnostics: [],
    });
  });
  it("still reads CommonMark, tables and footnotes included, when CommonMark is named", () => {
    expect(resolveConfig({ config: commonmark }).dialect).toBe("commonmark");
    // A table is a paragraph in CommonMark, so its lines are prose to wrap.
    expect(formatted(table, { config: commonmark })).toBe(
      "| Sensor | Unit | |---|---| | Temperature | °C |\n",
    );
    expect(formatted(bareTable, { config: commonmark })).toBe(
      "Sensor | Unit ---|--- Temperature | °C\n",
    );
    expect(formatted(wideTable, { config: commonmark })).toBe(
      "| Sensor name in a long header cell | Unit of measurement in a long header cell\n" +
        "| Notes | |---|---|---| | Temperature measured at the north wall | Degrees\n" +
        "Celsius, to one decimal place | Calibrated yearly |\n",
    );
    expect(formatted(footnotes, { config: commonmark })).toBe(
      "Text with two notes.[^1][^2]\n\n[^1]: First note. [^2]: Second note.\n",
    );
    // `[^1]: Text.` defines a link named `^1` to the file `Text.` in CommonMark.
    const workspace = createWorkspace({ "note.md": footnote }, { dialect: "commonmark" });
    expect(lint(footnote, { path: "note.md", config: commonmark, workspace })).toMatchObject([
      { rule: "links/valid", severity: "error", line: 3, message: "Missing local target: Text.." },
    ]);
  });
  it("assumes the dialect only; the rules of the github preset still need the preset", () => {
    expect(Object.keys(resolveConfig().rules)).toEqual(Object.keys(presets.recommended!.rules!));
    const source = `${aligned}\n- [X] Done\n\n> [!note]\n> Text.\n`;
    expect(formatted(source)).toBe(source);
    expect(formatted(source, { config: { extends: ["recommended", "github"] } })).toBe(
      `${aligned}\n- [x] Done\n\n> [!NOTE]\n> Text.\n`,
    );
  });
  it("gives way to a dialect named by the configuration, a preset, or an override", () => {
    expect(resolveConfig({ config: { dialect: "forgejo" } }).dialect).toBe("forgejo");
    expect(resolveConfig({ config: { extends: ["recommended", "obsidian"] } }).dialect).toBe(
      "obsidian",
    );
    expect(resolveConfig({ config: { extends: ["gitea"], dialect: "commonmark" } }).dialect).toBe(
      "commonmark",
    );
    const config: Config = { overrides: [{ files: ["plain/**"], dialect: "commonmark" }] };
    expect(resolveConfig({ config, path: "plain/a.md" }).dialect).toBe("commonmark");
    expect(resolveConfig({ config, path: "docs/a.md" }).dialect).toBe("github");
    expect(formatted(table, { config, path: "plain/a.md" })).toBe(
      "| Sensor | Unit | |---|---| | Temperature | °C |\n",
    );
    expect(formatted(table, { config, path: "docs/a.md" })).toBe(aligned);
  });
});

describe("a default dialect supplied by the caller", () => {
  // What a host passes when it knows more than the configuration says, as the CLI
  // does at the root of an Obsidian vault. Obsidian shows the first two lines of
  // this note on separate lines unless its "Strict line breaks" setting is on, and
  // a wikilink must stay on one line.
  const link =
    "[[A fairly long note name that sits near the wrap column of this paragraph|alias text]]";
  const note = `Shopping list\nMilk and eggs\n\nSee ${link} here.\n`;
  const files = {
    "Note.md": note,
    "A fairly long note name that sits near the wrap column of this paragraph.md": "# Target\n",
  };
  const vault = (strictLineBreaks?: boolean) =>
    createWorkspace(files, {
      dialect: "obsidian",
      ...(strictLineBreaks === undefined ? {} : { strictLineBreaks }),
    });
  it("is assumed when nothing names a dialect, and resolves aliases", () => {
    expect(resolveConfig({ path: "Note.md", defaultDialect: "obsidian" }).dialect).toBe("obsidian");
    expect(
      resolveConfig({
        config: { extends: ["recommended"] },
        path: "Note.md",
        defaultDialect: "obsidian",
      }).dialect,
    ).toBe("obsidian");
    expect(resolveConfig({ path: "Note.md", defaultDialect: "codeberg" }).dialect).toBe("forgejo");
    expect(resolveConfig({ path: "Note.md", defaultDialect: undefined }).dialect).toBe("github");
    expect(() => resolveConfig({ path: "Note.md", defaultDialect: "markdown" as Dialect })).toThrow(
      "Unknown default dialect: markdown",
    );
    expect(() => lint("", { defaultDialect: "markdown" as Dialect })).toThrow(
      "Unknown default dialect: markdown",
    );
  });
  it.each([undefined, false])(
    "keeps a vault note's lines apart and its wikilink whole (strict line breaks: %s)",
    (strictLineBreaks) => {
      const options: ProcessOptions = {
        path: "Note.md",
        workspace: vault(strictLineBreaks),
        defaultDialect: "obsidian",
      };
      expect(format(note, options)).toEqual({ output: note, changed: false, diagnostics: [] });
      expect(lint(note, options)).toEqual([]);
      // Without the default, the note is GitHub Markdown: one paragraph, and a link to split.
      const assumed = format(note, { path: "Note.md", workspace: vault(strictLineBreaks) });
      expect(assumed.output).toBe(
        "Shopping list Milk and eggs\n\nSee [[A fairly long note name that sits near the wrap column of this\nparagraph|alias text]] here.\n",
      );
    },
  );
  it("reflows a vault note once strict line breaks are verified, around the wikilink", () => {
    const options: ProcessOptions = {
      path: "Note.md",
      workspace: vault(true),
      defaultDialect: "obsidian",
    };
    const output = formatted(note, options);
    expect(output).toBe(`Shopping list Milk and eggs\n\nSee\n${link}\nhere.\n`);
    expect(output).toBe(
      formatted(note, { path: "Note.md", workspace: vault(true), config: { dialect: "obsidian" } }),
    );
    expect(semanticFingerprint(parse(output, "obsidian"), options.workspace)).toBe(
      semanticFingerprint(parse(note, "obsidian"), options.workspace),
    );
  });
  it("assumes the dialect only; the rules of the obsidian preset still need the preset", () => {
    const options: ProcessOptions = { workspace: vault(), defaultDialect: "obsidian" };
    const resolved = resolveConfig({ path: "Note.md", defaultDialect: "obsidian" });
    expect(resolved.dialect).toBe("obsidian");
    expect(Object.keys(resolved.rules)).toEqual(Object.keys(presets.recommended!.rules!));
    const source = "> [!TIP] Title\n> Text.\n\n- [X] Done\n";
    expect(format(source, options)).toEqual({ output: source, changed: false, diagnostics: [] });
    const preset = format(source, {
      ...options,
      config: { extends: ["recommended", "obsidian"] },
    });
    expect(preset.output).toBe("> [!tip] Title\n> Text.\n\n- [x] Done\n");
    expect(preset.diagnostics.map((item) => item.rule)).toEqual(["obsidian/strict-line-breaks"]);
  });
  it("gives way to a dialect named by the configuration, a preset, or an override", () => {
    const resolved = (config: Config, path = "Note.md") =>
      resolveConfig({ config, path, defaultDialect: "obsidian" }).dialect;
    expect(resolved({ dialect: "commonmark" })).toBe("commonmark");
    expect(resolved({ extends: ["recommended", "github"] })).toBe("github");
    expect(resolved({ extends: ["codeberg"] })).toBe("forgejo");
    const config: Config = { overrides: [{ files: ["docs/**"], dialect: "gitea" }] };
    expect(resolved(config, "docs/a.md")).toBe("gitea");
    expect(resolved(config, "Note.md")).toBe("obsidian");
    // A named GitHub dialect reads the note as GitHub Markdown in spite of the default.
    const github = format(note, {
      path: "Note.md",
      workspace: vault(),
      config: { extends: ["recommended", "github"] },
      defaultDialect: "obsidian",
    });
    expect(github.output).toContain("Shopping list Milk and eggs\n");
  });
});

describe("Obsidian and links", () => {
  const files = {
    "note.md": "# Note\n",
    "folder/Target.md": "# Target\n\n## Exact Heading\n\nA block. ^block-id\n",
    "picture.png": null,
  };
  const workspace = createWorkspace(files, { dialect: "obsidian", strictLineBreaks: true });
  const config: Config = { extends: ["recommended", "obsidian"] };
  it("parses and actively validates wiki links, embeds, headings, and blocks", () => {
    const source = "[[Target#Exact Heading|label]] ![[picture.png|200]] [[Target#^block-id]]\n";
    expect(lint(source, { workspace, config, path: "note.md" })).toEqual([]);
    expect(lint("[[Target#missing]]\n", { workspace, config, path: "note.md" })[0]?.rule).toBe(
      "links/valid",
    );
    expect(lint("![[missing.png]]\n", { workspace, config, path: "note.md" })[0]?.rule).toBe(
      "links/valid",
    );
  });
  it("ignores link-looking text in code and comments", () => {
    const source = "`[[Missing]]` %% [[Missing]] %% ==highlight==\n";
    expect(lint(source, { workspace, config, path: "note.md" })).toEqual([]);
    expect(formatted(source, { workspace, config, path: "note.md" })).toBe(source);
  });
  it("preserves multiline comments including blank lines and apparent Markdown", () => {
    const source = "%%\n*hidden emphasis*\n\n[[Missing]]\n\n# Hidden heading\n%%\n\n*visible*\n";
    const output = formatted(source, { workspace, config, path: "note.md" });
    expect(output).toBe(source.replace("*visible*", "_visible_"));
    expect(lint(output, { workspace, config, path: "note.md" })).toEqual([]);
  });
  it("preserves inline comments spanning soft lines", () => {
    const source = "Text %% hidden\n*emphasis* [[Missing]] %% after.\n";
    expect(formatted(source, { workspace, config, path: "note.md" })).toBe(source);
  });
  it.each(["\n", "\r\n"])(
    "preserves inline comments spanning several physical lines (%j)",
    (newline) => {
      for (const prefix of ["", "> ", "- "]) {
        const continuation = prefix === "- " ? "  " : prefix;
        const source = `${prefix}Before %% hidden${newline}${continuation}*hidden* [[Missing]]${newline}${continuation}still hidden %% after.${newline}`;
        expect(formatted(source, { config, workspace, path: "note.md" })).toBe(source);
        expect(lint(source, { config, workspace, path: "note.md" })).toEqual([]);
      }
    },
  );
  it("preserves comments inside quote containers", () => {
    const source = "> %%\n> *hidden* [[Missing]]\n>\n> %%\n\n*visible*\n";
    expect(formatted(source, { workspace, config, path: "note.md" })).toBe(
      source.replace("*visible*", "_visible_"),
    );
  });
  it("formats callouts without altering folding state or title", () => {
    expect(formatted("> [!NOTE]- Custom title\n> Details.\n", { config, workspace })).toBe(
      "> [!note]- Custom title\n> Details.\n",
    );
  });
  it("reports duplicate block IDs", () => {
    expect(
      lint("One. ^same\n\nTwo. ^same\n", { config, workspace }).some(
        (item) => item.rule === "obsidian/block-reference",
      ),
    ).toBe(true);
  });
  it("normalizes verified paths and retains titles", () => {
    const source = '[label](folder/Target.md#Exact%20Heading "title")\n';
    const output = formatted(source, {
      path: "note.md",
      workspace,
      config: {
        ...config,
        rules: { "links/path": ["warn", { style: "root", brackets: "angle", extension: "omit" }] },
      },
    });
    expect(output).toBe('[label](<folder/Target#Exact Heading> "title")\n');
  });
  it("converts explicit-label wikilinks and Markdown links", () => {
    const options = {
      path: "note.md",
      workspace,
      config: { ...config, rules: { "links/notation": ["warn", { style: "markdown" }] } },
    } satisfies ProcessOptions;
    expect(formatted("[[folder/Target|label]]\n", options)).toBe("[label](<folder/Target>)\n");
    options.config.rules["links/notation"] = ["warn", { style: "wiki" }];
    expect(formatted("[label](<folder/Target>)\n", options)).toBe("[[folder/Target|label]]\n");
  });
  it("resolves shortened Obsidian Markdown links and preserves their targets during conversion", () => {
    expect(workspace.resolve("note.md", "Target", "obsidian").target).toBe("folder/Target.md");
    const output = formatted("[[Target|label]]\n", {
      path: "note.md",
      workspace,
      config: { ...config, rules: { "links/notation": ["warn", { style: "markdown" }] } },
    });
    expect(output).toBe("[label](<Target>)\n");
  });
  it("does not guess ambiguous target names", () => {
    const ambiguous = createWorkspace(
      { "note.md": "", "a/Target.md": "", "b/Target.md": "" },
      { dialect: "obsidian" },
    );
    expect(ambiguous.resolve("note.md", "Target", "obsidian", true).status).toBe("ambiguous");
  });
  it("splits URL components before decoding escaped hashes", () => {
    const indexed = createWorkspace({ "note.md": "", "A#B.md": "# Heading\n" });
    expect(indexed.resolve("note.md", "A%23B.md#heading", "github")).toMatchObject({
      status: "resolved",
      target: "A#B.md",
      fragmentExists: true,
    });
  });
  it("uses GitHub duplicate-heading slugs and exact Obsidian headings", () => {
    const indexed = createWorkspace({ "note.md": "# A Heading\n\n## A Heading\n" });
    expect(indexed.resolve("note.md", "#a-heading-1", "github").fragmentExists).toBe(true);
    expect(indexed.resolve("note.md", "#A Heading", "obsidian").fragmentExists).toBe(true);
    expect(indexed.resolve("note.md", "#a-heading", "obsidian").fragmentExists).toBe(false);
  });
  it("refuses Obsidian reflow without verified soft-break behavior", () => {
    const source = "A deliberately short line\nfollowed by another deliberately short line.\n";
    const result = format(source, { config });
    expect(result.output).toBe(source);
    expect(result.diagnostics.some((item) => item.rule === "obsidian/strict-line-breaks")).toBe(
      true,
    );
  });
});

describe("line endings", () => {
  const emphasis: Config = { extends: [], rules: { "style/emphasis": "warn" } };
  const positions = (source: string) =>
    lint(source, { config: emphasis }).map(({ line, column }) => [line, column]);
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("counts lines and columns with %s", (_, newline) => {
    const source = ["Line one.", "Second *x*.", ""].join(newline);
    expect(positions(source)).toEqual([
      [2, 8],
      [2, 10],
    ]);
  });
  it("counts lines in a document that mixes line endings", () => {
    expect(positions("a\r\nb\rc\n\r*x*\n")).toEqual([
      [5, 1],
      [5, 3],
    ]);
  });
  it("reports positions in the formatted text with CR line endings", () => {
    const plugin: Plugin = {
      name: "find",
      rules: {
        marker: {
          description: "Report the word marker.",
          kind: "problem",
          check: ({ document }) => {
            const at = document.source.indexOf("marker");
            return at < 0 ? [] : [{ start: at, message: "Found." }];
          },
        },
      },
    };
    const config: Config = {
      extends: [],
      rules: { "style/emphasis": "warn", "find/marker": "warn" },
    };
    const result = format("*a*\r\rText with the marker.\r", { config, plugins: [plugin] });
    expect(result.output).toBe("_a_\r\rText with the marker.\r");
    expect(result.diagnostics).toMatchObject([{ rule: "find/marker", line: 3, column: 15 }]);
  });
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("refuses an edit that joins an Obsidian callout's title to its body with %s", (_, newline) => {
    // A lazy body line keeps the text the same when the lines are joined.
    const join: Plugin = {
      name: "join",
      rules: {
        title: {
          description: "Join the first two lines of a quote's first paragraph.",
          kind: "style",
          check: ({ document }) => {
            const quote = document.tree.children[0];
            const paragraph = quote?.type === "blockquote" ? quote.children[0] : undefined;
            if (paragraph?.type !== "paragraph") return [];
            const [start, end] = syntax.range(paragraph);
            const found = /\r\n|\r|\n/.exec(document.source.slice(start, end));
            if (!found) return [];
            const at = start + found.index;
            const edit = { start: at, end: at + found[0].length, text: " " };
            return [{ start: at, message: "Join.", edit }];
          },
        },
      },
    };
    const config: Config = { extends: [], dialect: "obsidian", rules: { "join/title": "warn" } };
    const callout = ["> [!note] Title", "Body text.", ""].join(newline);
    const result = format(callout, { config, plugins: [join] });
    expect(result.output).toBe(callout);
    expect(result.diagnostics.map((item) => [item.rule, item.line])).toEqual([
      ["engine/unsafe-format", 1],
      ["join/title", 1],
    ]);
    const plain = ["> Quoted", "text.", ""].join(newline);
    expect(format(plain, { config, plugins: [join] }).output).toBe(`> Quoted text.${newline}`);
  });
});
