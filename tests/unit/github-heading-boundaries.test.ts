import { describe, expect, it } from "vitest";
import { createWorkspace, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Plugin } from "../../src/index.js";

const config = { extends: ["recommended", "github"] };
// Live GitHub file rendering observed 2026-10-22. Structural HTML can swallow
// later blocks into an anchor, or close the generated heading early.
const uncertain = [
  "### a <div> b\n\nc  d\n",
  "### a <div><div> b</div>\n\nc  d\n",
  '### a <div title=">"> b\n\nc  d\n',
  "a <div> b\n---\n\nc  d\n",
  "### a <div> b\n\n# Later\n\nc  d\n",
  "> ### a <div> b\n>\n> c  d\n\noutside  text\n",
  "- ### a <div> b\n\n  c  d\n\noutside  text\n",
  "### a <div> b\n\nc  d\n\n</div>x  y\ne  f\n\ng  h\n",
  "<h3>a <div> b\n\nc  d\n",
  "<h3>a <div> b</h3>\n\nc  d\n",
  "### a <p> b\n\nc  d\n",
  "### a <table> b\n\nc  d\n",
  "### a <p/> b\n\nc  d\n",
  "### a <table/> b\n\nc  d\n",
  "<h2>Unclosed\n\nc  d\n",
  "Inline <h2>Unclosed\n\nc  d\n",
  "### a <div class=x/> b\n\nc  d\n",
  "### a <div class = x/> b\n\nc  d\n",
];

describe("GitHub heading source and anchor boundaries", () => {
  it.each(uncertain)("preserves the suffix for structural heading HTML: %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const mark of ["", String.fromCharCode(0xfeff)]) {
        const input = mark + source.replaceAll("\n", newline);
        const result = format(input, { config });
        expect(result.output).toBe(input);
        expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
        expect(format(result.output, { config }).output).toBe(input);
        expect(format(input, { config: { extends: [], dialect: "github" } }).output).toBe(input);
      }
  });

  it.each([
    "### a <div> b</div>",
    "### a <span> b",
    "### a <br> b",
    "### a <div/> b",
    "### a <div class=x /> b",
    '### a <div class="x"/> b',
    "### a <div bare/> b",
    "### a <hr/> b",
    "### a <custom> b",
    "### a <scripty> b</scripty>",
    "### a <head> b</head>",
    "### a \\<div> b",
    "### a `<div>` b",
    '### a <span title="<div>"> b',
    "### a <!-- <div> --> b",
    "### a <script> b",
    "<h2>A<h3>B</h3></h2>",
    "Inline <h2>with *emphasis* and `<h2>code</h2>`</h2> text",
  ])("continues safe formatting outside %j", (heading) => {
    const source = `${heading}\n\nc  d\n`;
    const result = format(source, { config });
    expect(result.output).toContain("\nc d\n");
    expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
  });

  it("formats independent prose before the protected suffix", () => {
    const source = "before  text\n\n" + uncertain[0];
    expect(format(source, { config }).output).toBe("before text\n\n" + uncertain[0]);
  });

  it("distinguishes anchor-bearing suffix changes and ordinary heading spaces", () => {
    for (const source of [uncertain[0]!, "# a  b\n"])
      expect(semanticFingerprint(parse(source, "github"))).not.toBe(
        semanticFingerprint(parse(source.replaceAll("  ", " "), "github")),
      );
    expect(semanticFingerprint(parse("# *word*\n", "github"))).toBe(
      semanticFingerprint(parse("# _word_\n", "github")),
    );
  });

  it("rejects a plugin changing ordinary heading anchors or appending to an uncertain suffix", () => {
    for (const [source, output] of [
      ["# a  b\n", "# a b\n"],
      [uncertain[0]!, uncertain[0]! + "extra"],
    ] as const) {
      const plugin: Plugin = {
        name: "change",
        rules: {
          heading: {
            kind: "style",
            description: "Change heading source",
            check: ({ document }) =>
              document.source === source
                ? [
                    {
                      start: 0,
                      message: "Change",
                      edit: { start: 0, end: source.length, text: output },
                    },
                  ]
                : [],
          },
        },
      };
      const result = format(source, {
        config: { extends: [], dialect: "github", rules: { "change/heading": "warn" } },
        plugins: [plugin],
      });
      expect(result.output).toBe(source);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ rule: "engine/unsafe-format" }),
      );
    }
  });

  it("retains EOF source without an unsafe final-newline diagnostic", () => {
    const source = "### a <div> b\n\nc  d";
    expect(format(source, { config })).toMatchObject({ output: source, diagnostics: [] });
  });

  it.each([
    "<h2>x</h2>",
    "<h2>x",
    "<h2>*x*</h2>",
    "<h2>x<div>",
    '<h2 title="</td></tr></table>">x</h2>',
  ])("bounds a raw heading at the table cell and checks its anchor: %j", (heading) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = `| ${heading} |\n| - |\n\nc  d\n\n## Later\n`.replaceAll("\n", newline);
      const workspace = createWorkspace({ "Note.md": source });
      expect(workspace.resolve("From.md", "Note.md#x", "github").fragmentExists).toBe(true);
      expect(workspace.resolve("From.md", "Note.md#later", "github").fragmentExists).toBe(true);
      expect(workspace.resolve("From.md", "Note.md#absent", "github").fragmentExists).toBe(false);
      const result = format(source, { config });
      expect(result.output).toContain(`${newline}c d${newline}`);
      expect(result.diagnostics).toEqual([]);
      expect(format(result.output, { config }).output).toBe(result.output);
      expect(semanticFingerprint(parse(result.output, "github"))).toBe(
        semanticFingerprint(parse(source, "github")),
      );
    }
  });

  it("locates a heading-anchor refusal at its heading instead of the document root", () => {
    const source = "Intro\n\nMore text\n\n# a  b\n";
    const plugin: Plugin = {
      name: "change",
      rules: {
        heading: {
          kind: "style",
          description: "Change heading source",
          check: () => [
            {
              start: source.indexOf("#"),
              message: "Change",
              edit: { start: source.indexOf("  "), end: source.indexOf("  ") + 2, text: " " },
            },
          ],
        },
      },
    };
    const result = format(source, {
      config: { extends: [], dialect: "github", rules: { "change/heading": "warn" } },
      plugins: [plugin],
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ rule: "engine/unsafe-format", line: 5 }),
    );
  });

  it.each(["p", "table"])("does not guess an early-closed %s cell heading anchor", (tag) => {
    const source = `| <h2>a <${tag}> b |\n| - |\n\n## Later\n`;
    const workspace = createWorkspace({ "Note.md": source });
    expect(workspace.resolve("From.md", "Note.md#a--b", "github")).toMatchObject({
      status: "unreadable",
      fragmentIncomplete: true,
    });
  });

  it("numbers headings across cells and later Markdown headings in their rendered order", () => {
    const source =
      "| <h2>Repeat | <h2>Repeat</h2> |\n| - | - |\n| <h2>Repeat | <h3>Repeat |\n\n## Repeat\n";
    const workspace = createWorkspace({ "Note.md": source });
    for (const suffix of ["", "-1", "-2", "-3", "-4"])
      expect(workspace.resolve("From.md", `Note.md#repeat${suffix}`, "github").fragmentExists).toBe(
        true,
      );
    expect(workspace.resolve("From.md", "Note.md#repeat-5", "github").fragmentExists).toBe(false);
  });

  it("preserves malformed table boundaries that reorder headings before the table", () => {
    const source =
      "before  text\n\n# Known\n\n| First | Second |\n| --- | --- |\n| <h2>X</h2> | <h2>X</h2></td><h2>X-1</h2> |\n\nafter  text\n";
    const workspace = createWorkspace({ "Note.md": source });
    expect(workspace.resolve("From.md", "Note.md#known", "github").fragmentExists).toBe(true);
    for (const anchor of ["x", "x-1", "x-2", "x-1-1"])
      expect(workspace.resolve("From.md", `Note.md#${anchor}`, "github")).toMatchObject({
        status: "unreadable",
        fragmentIncomplete: true,
      });
    expect(format(source, { config }).output).toBe(source.replace("before  text", "before text"));
  });

  it.each([
    "<h2>Known</h2>\n<h2>a <div> b</h2>\n",
    "Inline <h2>Known</h2> <h2>a <div> b</h2>\n",
    "<h2>Known<h2>Unclosed\n",
  ])("keeps earlier raw headings within the same uncertain block: %j", (source) => {
    const workspace = createWorkspace({ "Note.md": source });
    expect(workspace.resolve("From.md", "Note.md#known", "github").fragmentExists).toBe(true);
    expect(workspace.resolve("From.md", "Note.md#absent", "github")).toMatchObject({
      status: "unreadable",
      fragmentIncomplete: true,
    });
  });

  it("keeps known anchors while reporting the rest as incomplete, rather than missing", () => {
    const source = "# Known\n\n" + uncertain[0] + '\n<a id="explicit">x</a>\n\n# Later\n';
    const workspace = createWorkspace({ "Note.md": source });
    for (const anchor of ["known", "explicit"])
      expect(workspace.resolve("From.md", `Note.md#${anchor}`, "github")).toMatchObject({
        status: "resolved",
        fragmentExists: true,
      });
    for (const anchor of ["a--b", "a--bc--d", "later", "absent"])
      expect(workspace.resolve("From.md", `Note.md#${anchor}`, "github")).toMatchObject({
        status: "unreadable",
        fragmentIncomplete: true,
      });
    const diagnostics = lint("[link](Note.md#a--bc--d)\n", {
      path: "From.md",
      config: { extends: [], dialect: "github", rules: { "links/valid": "error" } },
      workspace,
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("structural HTML makes heading anchors");
  });
});
