import { describe, expect, it, vi } from "vitest";
import { Ajv } from "ajv";
import * as syntax from "../../src/syntax/parse.js";
import fc from "fast-check";
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
} from "../../src/index.js";
import type {
  Config,
  Diagnostic,
  Dialect,
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
    options.config!.rules!["observer/position"] = "warn";
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
    const { dialect } = resolveConfig(options.config);
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
    expect(formatted(source)).toBe(source);
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
    // but dropped by GitHub, so that paragraph stays as written.
    const indented = source.replace(`${newline}second`, `${newline} second`);
    expect(formatted(indented, { config: narrow })).toBe(indented);
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
          const { dialect } = resolveConfig(options.config);
          expect(semanticFingerprint(parse(output, dialect))).toBe(
            semanticFingerprint(parse(source, dialect)),
          );
        },
      ),
      { numRuns: 120, seed: 20260918 },
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
        throw "text";
      }, kind);
      expect(ruleErrors(lint(source, thrown))).toMatchObject([
        { message: expect.stringContaining("Rule test/fragile failed (text);") },
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
      { message: expect.stringContaining("failed (Error: Own)") },
    ]);
  });
  it("checks offsets in the text that rules see, without a byte order mark", () => {
    const mark = String.fromCharCode(0xfeff);
    const at = (start: number) => failing(() => [{ start, message: "End" }]);
    expect(lint(`${mark}A.\n`, at(3))).toMatchObject([{ rule: "test/fragile", start: 4 }]);
    expect(lint(`${mark}A.\n`, at(4))).toMatchObject([
      { message: expect.stringContaining("start is 4, not an offset from 0 to 3") },
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
      ).toThrow("Invalid options for test/options: data/level must be integer");
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
      diagnostics: expect.any(Array),
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
    expect(resolveConfig({ extends: [] }).rules).toEqual({});
    expect(
      resolveConfig(
        {
          overrides: [
            { files: ["vault/**/*.md"], dialect: "obsidian", rules: { "style/wrap": "off" } },
          ],
        },
        "vault/a.md",
      ).rules["style/wrap"],
    ).toBe("off");
  });
  it("rejects unknown configuration, rules, options, and preset cycles", () => {
    expect(() => lint("", { config: { rules: { typo: "warn" } } })).toThrow("Unknown rule");
    expect(() => lint("", { config: { rules: { "style/wrap": ["warn", { width: 2 }] } } })).toThrow(
      "Invalid options",
    );
    expect(() => resolveConfig({ typo: true } as Config)).toThrow("Invalid configuration");
    expect(() =>
      resolveConfig({ extends: ["local/a"] }, "a.md", [
        { name: "local", presets: { a: { extends: ["local/a"] } } },
      ]),
    ).toThrow("Circular");
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
    expect(resolveConfig({ extends: ["recommended"] }).dialect).toBe("github");
    expect(resolveConfig({ extends: [], rules: { "style/wrap": "warn" } }).dialect).toBe("github");
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
    expect(resolveConfig(commonmark).dialect).toBe("commonmark");
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
    expect(resolveConfig({ dialect: "forgejo" }).dialect).toBe("forgejo");
    expect(resolveConfig({ extends: ["recommended", "obsidian"] }).dialect).toBe("obsidian");
    expect(resolveConfig({ extends: ["gitea"], dialect: "commonmark" }).dialect).toBe("commonmark");
    const config: Config = { overrides: [{ files: ["plain/**"], dialect: "commonmark" }] };
    expect(resolveConfig(config, "plain/a.md").dialect).toBe("commonmark");
    expect(resolveConfig(config, "docs/a.md").dialect).toBe("github");
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
    expect(resolveConfig({}, "Note.md", [], "obsidian").dialect).toBe("obsidian");
    expect(resolveConfig({ extends: ["recommended"] }, "Note.md", [], "obsidian").dialect).toBe(
      "obsidian",
    );
    expect(resolveConfig({}, "Note.md", [], "codeberg").dialect).toBe("forgejo");
    expect(resolveConfig({}, "Note.md", [], undefined).dialect).toBe("github");
    expect(() => resolveConfig({}, "Note.md", [], "markdown" as Dialect)).toThrow(
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
    const resolved = resolveConfig({}, "Note.md", [], "obsidian");
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
      resolveConfig(config, path, [], "obsidian").dialect;
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
