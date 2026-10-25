import { describe, expect, it } from "vitest";
import { rendererProtections } from "../../src/syntax/renderer-protections.js";
import type { Nodes } from "mdast";
import { format, lint, parse, createWorkspace, dialects, range } from "../../src/index.js";
import type { Config, Dialect, Finding, Plugin, ProcessOptions, Rule } from "../../src/index.js";
import { formatted } from "../support/engine.js";
describe("text that the parser read in place of a list", () => {
  // micromark reads a list that does not start at 1, or an empty item, as text
  // at the start of a list item, block quote, or footnote definition below a
  // paragraph, and after an indented code block, where renderers read a list
  // (issue #191). The safety check compares the parser's readings, so it
  // cannot see what an edit there does to the renderers' list.
  const texts = (source: string, dialect: Dialect = "github") => {
    const document = parse(source, dialect);
    const { text, nested, next } = rendererProtections(document);
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
      expect(
        lint(source, options).filter(
          ({ message, edit }) =>
            dialect !== "obsidian" || !message.startsWith("Left as written") || edit !== undefined,
        ),
        JSON.stringify(source),
      ).toEqual([]);
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
    const { descriptions, nested } = rendererProtections(parse(source, dialect));
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
