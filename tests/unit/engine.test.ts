import { describe, expect, it, vi } from "vitest";
import { stringContaining } from "../support/assertions.js";
import * as syntax from "../../src/syntax/parse.js";
import { rendererProtections } from "../../src/syntax/renderer-protections.js";
import fc from "fast-check";
import {
  format,
  lint,
  parse,
  resolveConfig,
  createWorkspace,
  applyEdits,
  semanticFingerprint,
} from "../../src/index.js";
import type {
  Config,
  Diagnostic,
  Finding,
  Plugin,
  ProcessOptions,
  Rule,
  RuleContext,
  Workspace,
} from "../../src/index.js";
import { narrow, formatted } from "../support/engine.js";
describe("formatting contracts", () => {
  it("reuses renderer protections by positioned root across document wrappers", () => {
    const document = parse("Text\n2. *item*\n", "obsidian");
    const protections = rendererProtections(document);
    expect(protections.text.size).toBeGreaterThan(0);
    expect(rendererProtections({ ...document })).toBe(protections);
    expect(rendererProtections(parse(document.source, document.dialect))).not.toBe(protections);
  });

  it("preserves workspace method binding and exceptions during candidate comparison", () => {
    const error = new Error("candidate resolution failed");
    class BoundWorkspace implements Workspace {
      #calls = 0;
      #failure: Error | undefined;
      resolve() {
        this.#calls++;
        if (this.#failure) throw this.#failure;
        return { status: "resolved" as const, target: "Note.md" };
      }
      fail() {
        this.#failure = error;
      }
      calls() {
        return this.#calls;
      }
    }
    const workspace = new BoundWorkspace();
    const options: ProcessOptions = {
      workspace,
      config: { extends: [], rules: { "style/emphasis": "warn" } },
    };
    const source = "[Link](Note.md) *text*\n";
    expect(format(source, options).output).toBe("[Link](Note.md) _text_\n");
    expect(workspace.calls()).toBeGreaterThan(0);
    workspace.fail();
    // Only a style edit is enabled: resolution first runs in the semantic guard.
    let thrown: unknown;
    try {
      format(source, options);
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBe(error);
  });

  it("orders diagnostic ties by UTF-16 rule IDs on every host", () => {
    const names = ["z", "a", "Z", "ä", "A", "😀"];
    const plugin: Plugin = {
      name: "ordering",
      rules: Object.fromEntries(
        names.map(
          (name) =>
            [
              name,
              {
                kind: "problem",
                description: "Report in reverse source order",
                check: () => [
                  { start: 7, message: "Later" },
                  { start: 0, message: "First" },
                ],
              } satisfies Rule,
            ] as const,
        ),
      ),
    };
    const options = {
      plugins: [plugin],
      config: {
        extends: [],
        rules: Object.fromEntries(names.map((name) => [`ordering/${name}`, "warn"] as const)),
      },
    };
    const source = "First.\nLater.\n";
    const formatted = format(source, options);
    expect(formatted.output).toBe(source);
    const expected = [0, 7].flatMap((start) =>
      ["A", "Z", "a", "z", "ä", "😀"].map((name) => [start, `ordering/${name}`]),
    );
    for (const diagnostics of [lint(source, options), formatted.diagnostics])
      expect(diagnostics.map(({ start, rule }) => [start, rule])).toEqual(expected);
  });
  it("uses diagnostic order for otherwise tied plugin edits", () => {
    const source = "# Title #\n";
    const outputs = { a: "Title\n=====\n", A: "# Title\n" };
    const plugin: Plugin = {
      name: "ordering",
      rules: Object.fromEntries(
        Object.entries(outputs).map(
          ([name, text]) =>
            [
              name,
              {
                kind: "style",
                description: "Convert the original heading once",
                check: ({ document }) =>
                  document.source === source
                    ? [{ start: 0, message: name, edit: { start: 0, end: source.length, text } }]
                    : [],
              } satisfies Rule,
            ] as const,
        ),
      ),
    };
    const options: ProcessOptions = {
      config: {
        extends: [],
        dialect: "commonmark",
        rules: { "ordering/a": "warn", "ordering/A": "warn" },
      },
      plugins: [plugin],
    };
    const result = format(source, options);
    expect(result.output).toBe(outputs.A);
    expect(result.diagnostics).toEqual([]);
    expect(semanticFingerprint(parse(result.output, "commonmark"))).toBe(
      semanticFingerprint(parse(source, "commonmark")),
    );
    expect(format(result.output, options).output).toBe(result.output);
  });
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
  it("checks offsets in the text that rules see, without a byte order mark", () => {
    const mark = String.fromCharCode(0xfeff);
    const at = (start: number) => failing(() => [{ start, message: "End" }]);
    expect(lint(`${mark}A.\n`, at(3))).toMatchObject([{ rule: "test/fragile", start: 4 }]);
    expect(lint(`${mark}A.\n`, at(4))).toMatchObject([
      { message: stringContaining("start is 4, not an offset from 0 to 3") },
    ]);
  });
});
describe("configuration and plugins", () => {
  it("rejects overlapping edits", () => {
    expect(() =>
      applyEdits("abc", [
        { start: 0, end: 2, text: "a" },
        { start: 1, end: 3, text: "b" },
      ]),
    ).toThrow("overlapping");
    expect(() => applyEdits("abc", [{ start: -1, end: 2, text: "a" }])).toThrow("invalid");
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
