import fc from "fast-check";
import type { InlineCode, Nodes } from "mdast";
import { describe, expect, it } from "vitest";
import {
  applyEdits,
  canonicalDialect,
  createWorkspace,
  dialects,
  format,
  lint,
  parse,
  presets,
  range,
  resolveConfig,
  semanticFingerprint,
  textContent,
} from "../../src/index.js";
import type { Config, Dialect, Plugin, RuleSetting } from "../../src/index.js";
import { giteaPyLine, inForgeMath } from "../../src/rules/style.js";
import { codeSpanText, lazyIndentation } from "../../src/syntax/parse.js";

function only(rules: Record<string, RuleSetting>, dialect: Dialect = "commonmark"): Config {
  return { extends: [], dialect, rules };
}
/** Format, require no engine diagnostics, and require idempotence. */
function formatted(source: string, config: Config, options: Record<string, unknown> = {}) {
  const result = format(source, { config, ...options });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config, ...options }).output).toBe(result.output);
  return result.output;
}
/** The engine's diagnostics of a formatting result; the refused rules' own findings stay too. */
const refusals = (result: { diagnostics: { rule: string }[] }) =>
  result.diagnostics.filter((item) => item.rule.startsWith("engine/"));
/** The code spans of a document, in order. */
function codeSpans(source: string, dialect: Dialect): InlineCode[] {
  const spans: InlineCode[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "inlineCode") spans.push(node);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(parse(source, dialect).tree);
  return spans;
}

describe("style/heading", () => {
  const config = only({ "style/heading": "warn" });
  it.each([
    ["Title\n=====\n", "# Title\n"],
    ["Sub\n---\n", "## Sub\n"],
    ["*Title* with `code`\n===\n", "# *Title* with `code`\n"],
    ["C#\n---\n", "## C#\n"],
    ["Sharp #\n---\n", "## Sharp \\#\n"],
    ["Sharp ##\n===\n", "# Sharp \\##\n"],
    ["Sharp \\#\n---\n", "## Sharp \\#\n"],
  ])("converts %j to an ATX heading", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
  it("reports the conversion with the proposed text", () => {
    const [finding] = lint("Title\n===\n", { config });
    expect(finding).toMatchObject({ rule: "style/heading", line: 1, column: 1 });
    expect(finding?.edit?.text).toBe("# Title");
  });
  it.each([
    ["# Already ATX\n"],
    ["Line one\nLine two\n---\n"],
    ["- Item\n  ---\n"],
    ["> Quoted\n> ---\n"],
  ])("leaves %j unchanged", (source) => {
    expect(formatted(source, config)).toBe(source);
    expect(lint(source, { config })).toEqual([]);
  });
});

describe("style/block-spacing", () => {
  const rule = { "style/block-spacing": "warn" } as const;
  /** Format with the rule alone, and require the parsed meaning to stay the same. */
  function spaced(source: string, dialect: Dialect = "github") {
    const output = formatted(source, only(rule, dialect));
    expect(semanticFingerprint(parse(output, dialect))).toBe(
      semanticFingerprint(parse(source, dialect)),
    );
    return output;
  }
  it.each([
    [
      "# Setup\nInstall the package.\n- Run the command.\n",
      "# Setup\n\nInstall the package.\n\n- Run the command.\n",
    ],
    ["# A\n## B\n", "# A\n\n## B\n"],
    ["Text\n# Heading\n", "Text\n\n# Heading\n"],
    ["Text\n1. One\n", "Text\n\n1. One\n"],
    // Hard breaks stay where they are.
    ["Line one  \nLine two\\\nend\n- A\n", "Line one  \nLine two\\\nend\n\n- A\n"],
    // Tight lists stay tight, loose lists loose, and nested lists in place.
    ["# Steps\n- One\n- Two\n## Next\n", "# Steps\n\n- One\n- Two\n\n## Next\n"],
    ["# Steps\n- One\n\n- Two\n## Next\n", "# Steps\n\n- One\n\n- Two\n\n## Next\n"],
    ["- One\n  - Nested\n# Next\n", "- One\n  - Nested\n\n# Next\n"],
    ["- One\n+ Other list\n", "- One\n\n+ Other list\n"],
    ["Title\n=====\nText\n", "Title\n=====\n\nText\n"],
    ["# A\nTitle\n---\n", "# A\n\nTitle\n---\n"],
    // Code, HTML, math, and tables keep their contents.
    ["# H\n```\n# Code\n```\n- A\n", "# H\n\n```\n# Code\n```\n\n- A\n"],
    ["# H\n    code\n# I\n", "# H\n\n    code\n\n# I\n"],
    ["# H\n<div>\n# Inside HTML\n</div>\n", "# H\n\n<div>\n# Inside HTML\n</div>\n"],
    ["# H\n$$\nx\n$$\n- A\n", "# H\n\n$$\nx\n$$\n\n- A\n"],
    ["# H\n| a |\n| - |\n# I\n", "# H\n\n| a |\n| - |\n\n# I\n"],
    ["- A\n```\ncode\n```\n", "- A\n\n```\ncode\n```\n"],
    ["# H\n[^1]: Note.\n", "# H\n\n[^1]: Note.\n"],
    ["# H\n***\n", "# H\n\n***\n"],
    // Block quotes at any depth, also in a list item, and around a quote.
    ["> # H\n> Text\n> - A\n", "> # H\n>\n> Text\n>\n> - A\n"],
    ["> > # H\n> > Text\n", "> > # H\n> >\n> > Text\n"],
    ["- > # H\n  > Text\n", "- > # H\n  >\n  > Text\n"],
    ["> Quote\n# H\n", "> Quote\n\n# H\n"],
    // A lazy continuation line belongs to the paragraph above it.
    ["> Quote\nlazy\n# H\n", "> Quote\nlazy\n\n# H\n"],
    ["> Text\nlazy\n> - A\n", "> Text\nlazy\n>\n> - A\n"],
    // The document's line ending, and nothing added at its end.
    ["# H\r\nText\r\n- A\r\n", "# H\r\n\r\nText\r\n\r\n- A\r\n"],
    ["> # H\r\n> Text\r\n", "> # H\r\n>\r\n> Text\r\n"],
    ["# H\rText\r", "# H\r\rText\r"],
    ["Text\n# H", "Text\n\n# H"],
    // A list that starts with a nested list that the parser reads as renderers do,
    // and a heading below text that renderers read as a list, which ends there.
    ["Text\n- 1. Step\n", "Text\n\n- 1. Step\n"],
    ["Text\n- - Step\n", "Text\n\n- - Step\n"],
    ["    code\n\n2. Two\n# H\n", "    code\n\n2. Two\n\n# H\n"],
    // A code fence that is closed, or that ends in a block quote, which a blank
    // line ends, or in a footnote definition alone, as renderers show them.
    ["- d\n  ```\n  x\n  ```\n# H\n", "- d\n  ```\n  x\n  ```\n\n# H\n"],
    ["- d\n  > ```\n# H\n", "- d\n  > ```\n\n# H\n"],
    ["> ```\n# H\n", "> ```\n\n# H\n"],
    ["[^1]: d\n    ```\n# H\n", "[^1]: d\n    ```\n\n# H\n"],
    // Below a list item that ends in misread text, renderers continue only text.
    ["    code\n\n- 2. q\n  ===\n# H\n", "    code\n\n- 2. q\n  ===\n\n# H\n"],
    ["    code\n\n- 2. q\n  ===\n===\n# H\n", "    code\n\n- 2. q\n  ===\n===\n\n# H\n"],
  ])("separates %j", (source, output) => {
    expect(spaced(source)).toBe(output);
  });
  it.each([
    ["# H\n\nText\n\n- A\n- B\n\n## I\n"],
    ["# H\n\n\nText\n"],
    ["> # H\n>\n> Text\n"],
    ["> # H\n>\n# I\n"],
    ["# H\n"],
    // Blocks inside a list item or a footnote definition.
    ["- A\n  # H\n  Text\n"],
    ["- # H\n  - Nested\n"],
    ["1. Text\n   - Nested\n"],
    ["- Text\n  ```\n  code\n  ```\n"],
    ["[^1]: Text\n    # H\n"],
    // Front matter.
    ["---\ntitle: T\n---\n# H\n"],
    ["+++\ntitle = 'T'\n+++\n- A\n"],
    // Continuation lines, and blocks that are neither headings nor lists.
    ["Text\n2. Two\n"],
    ["- A\nlazy\n"],
    ["Text\n> Quote\n"],
    ["```\ncode\n```\nText\n"],
    // Comments, callouts, and lines the parser reads differently below text.
    ["<!-- note -->\n# H\n"],
    ["<!-- mdtools-disable-next-line style/emphasis -->\n- *A*\n"],
    ["> [!NOTE]\n> - Item\n"],
    ["> [!tip] Title\n> # H\n"],
    ["> \\[!NOTE]\n> - Item\n"],
    ["> &#91;!tip] Title\n> # H\n"],
    ["Text\n- 2. Step\n"],
    ["Text\n- -\n"],
    ["> Text\n> - 2) Step\n"],
    ["Text\n- > 3. Step\n"],
    ["[a]: https://example.com\n- -\n"],
    ["[a]: https://example.com\n-\n---\n"],
    // Below text that the parser reads where renderers read a list (issue #191),
    // the blocks that renderers read in its last item, which a blank line would
    // make loose, and a list that renderers read as more of its items.
    ["    code\n\n2. Two\n   - Sub\n"],
    ["    code\n\n2) Two\n   # H\n   Text\n"],
    ["    code\n\n2. Two\n   # H\n1. Three\n"],
    ["Text\n> 1.\n> ===\n> ---\n"],
    // Renderers continue such text that ends a list item lazily on the next
    // line, also below the item (issue #343).
    ["    code\n\n- 2. q\n  ===\n===\n"],
    ["    code\n\n> - 2. q\n>   ===\n> ===\n"],
    // Renderers put a blank line below a list item that ends in a code fence
    // without its closing fence into the code; the parser does not (issue #350).
    ["- d\n  ```\n# H\n"],
    ["- a\n  - d\n    ```\n# H\n"],
    ["> - d\n>   ```\n> # H\n"],
    ["- d\n  ~~~\n  x\n# H\n"],
    // Below a table that ends in a list or quote, the parser reads the next
    // table as a paragraph or heading text, and a blank line would make it a table.
    ["- | a |\n  | - |\n| b |\n| - |\n"],
    ["> - | a |\n>   | - |\n> | b |\n> | - |\n"],
    ["> | a |\n> | - |\n| b |\n| - |\n---\n"],
    ["- > | a |\n  > | - |\n| a |\n| - |\n"],
    ["> - $$\n>   $$\n>   | a |\n>   | - |\n> a | b\n> --|--\n"],
    // In a quote, a line of `>` below an empty footnote definition at the end
    // of a list item would make the item loose.
    ["> - [^2]:\n> Text\n"],
    ["> - - [^2]:\n> # H\n"],
    ["> > - [^2]:\n> > # H\n"],
  ])("leaves %j unchanged", (source) => {
    expect(spaced(source)).toBe(source);
    expect(lint(source, { config: only(rule, "github") })).toEqual([]);
  });
  it.each(dialects)(
    "keeps the blocks that renderers read in a list that the parser misread in the %s dialect",
    (dialect) => {
      for (const source of [
        "    code\n\n2. Two\n   - Sub\n",
        "Text\n> 2. a\n>    # H\n",
        "Text\n- 2. Step\n",
      ])
        expect(spaced(source, dialect)).toBe(source);
    },
  );
  it.each(dialects)("separates the same blocks in the %s dialect", (dialect) => {
    // Live Preview reads the heading/list markers inside a quote as literal
    // inline text, so Obsidian keeps those internal boundaries (#436).
    expect(spaced("> # H\n> Text\n> - A\n- B\n## I\n", dialect)).toBe(
      dialect === "obsidian"
        ? "> # H\n> Text\n> - A\n\n- B\n\n## I\n"
        : "> # H\n>\n> Text\n>\n> - A\n\n- B\n\n## I\n",
    );
  });
  it.each(["github", "forgejo", "gitea", "obsidian"] as const)(
    "keeps a table that the parser reads as text below a list item or quote in the %s dialect",
    (dialect) => {
      for (const source of [
        "- | a |\n  | - |\n| b |\n| - |\n",
        "- > | a |\n  > | - |\n| b |\n| - |\n",
        "> - | a |\n>   | - |\n> | b |\n> | - |\n",
      ])
        expect(spaced(source, dialect)).toBe(source);
    },
  );
  it("still separates a footnote definition with text, or one outside a quote", () => {
    expect(spaced("> - [^2]: note\n> # H\n")).toBe("> - [^2]: note\n>\n> # H\n");
    expect(spaced("- [^2]:\n# H\n")).toBe("- [^2]:\n\n# H\n");
    expect(spaced("> [^2]:\n> # H\n")).toBe("> [^2]:\n>\n> # H\n");
  });
  it("still separates other text below a table in a list", () => {
    expect(spaced("- | a |\n  | - |\nText\n")).toBe("- | a |\n  | - |\n\nText\n");
    expect(spaced("- | a |\n  | - |\n| b\n")).toBe("- | a |\n  | - |\n\n| b\n");
  });
  it("keeps an Obsidian block identifier below a heading", () => {
    expect(spaced("# H\n^anchor\n", "obsidian")).toBe("# H\n^anchor\n");
    expect(spaced("# H\n^anchor\n")).toBe("# H\n\n^anchor\n");
  });
  it("reports each place at the heading or list that needs the blank line", () => {
    const diagnostics = lint("# Setup\nInstall the package.\n- Run the command.\n", {
      config: only(rule, "github"),
    });
    expect(diagnostics).toEqual([
      {
        rule: "style/block-spacing",
        severity: "warn",
        line: 1,
        column: 8,
        start: 7,
        message: "Add a blank line after the heading.",
        edit: { start: 7, end: 8, text: "\n\n" },
      },
      {
        rule: "style/block-spacing",
        severity: "warn",
        line: 3,
        column: 1,
        start: 29,
        message: "Add a blank line before the list.",
        edit: { start: 28, end: 29, text: "\n\n" },
      },
    ]);
    expect(lint("> - A\n> # H\n", { config: only({ "style/block-spacing": "error" }) })).toEqual([
      {
        rule: "style/block-spacing",
        severity: "error",
        line: 2,
        column: 3,
        start: 8,
        message: "Add a blank line before the heading.",
        edit: { start: 5, end: 6, text: "\n>\n" },
      },
    ]);
  });
  it("is enabled only by recommended and formats nothing when off", () => {
    const source = "# Setup\nInstall the package.\n- Run the command.\n";
    expect(format(source, { config: { extends: ["recommended", "github"] } }).output).toBe(
      "# Setup\n\nInstall the package.\n\n- Run the command.\n",
    );
    expect(format(source, { config: only({ "style/block-spacing": "off" }) }).output).toBe(source);
    for (const [name, preset] of Object.entries(presets))
      expect(preset.rules?.["style/block-spacing"], name).toBe(
        name === "recommended" ? "warn" : undefined,
      );
  });
  it.each(dialects)(
    "keeps a separator inside the reading without TOML front matter in the %s dialect (#426)",
    (dialect) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", String.fromCharCode(0xfeff)])
          for (const config of [
            only(rule, dialect),
            { extends: ["recommended"], dialect, rules: rule },
          ]) {
            for (const body of ["1.\n2) b\n", "1)\n2. b\n", "*\n2) b\n", "+\n2. b\n"]) {
              const source = bom + ("+++\ntitle = 1\n+++\n" + body).replaceAll("\n", newline);
              expect(formatted(source, config)).toBe(source);
              expect(lint(source, { config })).toEqual([]);
            }
          }
    },
  );
  it.each(dialects)(
    "still separates real blocks after TOML front matter in the %s dialect (#426)",
    (dialect) => {
      const source = "+++\ntitle = 1\n+++\n1.\n\n2) b\n# Heading\n";
      expect(spaced(source, dialect)).toBe("+++\ntitle = 1\n+++\n1.\n\n2) b\n\n# Heading\n");
    },
  );
  it.each([
    "[r]: a b\n===\nText.\n",
    "[r]: a b\n---\nText.\n",
    "[r]: a b\n=\nText.\n",
    "[a[b]: c\n===\nText.\n",
    "[s]: https://example.org\n[r]: a b\n===\nText.\n",
    " [r]: a b\n===\nText.\n",
    "> [r]: a b\n> ===\n> Text.\n",
    "[r]: a b\nmore words\n===\nText.\n",
    "Heading\n[r]: a b\n===\nText.\n",
    "> Heading\n> [r]: a b\n> ===\n> Text.\n",
    "Heading\nMore [r]: a b\n===\nText.\n",
    "Heading\nMore words\n===\nText.\n",
    "> Heading\n> More words\n> ===\n> Text.\n",
    "Heading\nMore \\[r]: a b\n===\nText.\n",
    "Heading\nMore [r] : a b\n===\nText.\n",
    "Heading\n=== \nText.\n",
    "Heading\n  ===\nText.\n",
    "Heading\n-\nText.\n",
    "> Heading\n> === \n> Text.\n",
  ])("keeps the alternate Obsidian paragraph boundary in %j (#434)", (body) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        for (const config of [
          only(rule, "obsidian"),
          { extends: ["recommended", "obsidian"], dialect: "obsidian" } satisfies Config,
        ]) {
          const source = bom + body.replaceAll("\n", newline);
          const output = formatted(source, config);
          expect(output).toBe(source);
          expect(
            lint(source, { config }).filter(({ rule }) => rule === "style/block-spacing"),
          ).toEqual([]);
          expect(semanticFingerprint(parse(source, "obsidian"))).toBe(
            semanticFingerprint(parse(output, "obsidian")),
          );
        }
  });
  it("still separates ordinary headings and later independent blocks in Obsidian (#434)", () => {
    for (const heading of ["Heading", "\\[r]: a b", "[r] : a b", "[r][s]: a b", "More [r]: a b"])
      expect(spaced(`${heading}\n===\nText.\n`, "obsidian")).toBe(`${heading}\n===\n\nText.\n`);
    expect(spaced("Heading\nMore words\n---\nText.\n", "obsidian")).toBe(
      "Heading\nMore words\n---\n\nText.\n",
    );
    expect(spaced("[s]: https://example.org\nHeading\n===\nText.\n", "obsidian")).toBe(
      "[s]: https://example.org\nHeading\n===\n\nText.\n",
    );
    expect(spaced("[r]: a b\n===\nText.\n\n# Later\nMore.\n", "obsidian")).toBe(
      "[r]: a b\n===\nText.\n\n# Later\n\nMore.\n",
    );
  });
  it("keeps independent inline formatting and opt-out behavior in Obsidian (#434)", () => {
    const source = "[r]: *a* b\n===\nText.\n";
    expect(formatted(source, { extends: ["recommended", "obsidian"], dialect: "obsidian" })).toBe(
      "[r]: _a_ b\n===\nText.\n",
    );
    const compact = "[r]: a b\n===\nText.\n";
    expect(formatted(compact, only({ "style/block-spacing": "off" }, "obsidian"))).toBe(compact);
  });
  it.each(["commonmark", "github", "forgejo", "gitea"] as const)(
    "retains ordinary spacing after the definition-like heading in %s (#434)",
    (dialect) => {
      for (const heading of ["[r]: a b", "Heading\nMore words"])
        expect(spaced(`${heading}\n===\nText.\n`, dialect)).toBe(`${heading}\n===\n\nText.\n`);
    },
  );
  it.each([
    "a <b> *b*\n\nc *d*\n1. *e*\n",
    "a <div> *b*\n\nc\n# *d*\n",
    "1. a <b> *b*\n```js\nc\n```\n",
    "> ## a\n> b\n",
    "> a\n> - b\n",
    "> a\n> [!TIP] b\n> - [ ] c\n",
    ">\n> ## a\n> b\n",
    ">\n> - a\n> # b\n",
    "> > # a\n> > b\n",
    "- a\n> b\n",
    "1. a\n> b\n",
    "- a\n  - b\n> c\n",
    "-\ncedar\n",
    "a\n--:\nb\n-\nc\n",
    "<div>\na\n</div>\n\t\n1. b\n# c\n",
    "<div>\na\n</div>\n\t\n- b\n# c\n",
  ])("preserves the alternate Obsidian boundary in %j (#435–#439)", (body) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        for (const config of [
          only(rule, "obsidian"),
          { extends: ["recommended", "obsidian"], dialect: "obsidian" } satisfies Config,
        ]) {
          const source = bom + body.replaceAll("\n", newline);
          expect(formatted(source, config)).toBe(source);
          expect(
            lint(source, { config }).filter(({ rule }) => rule === "style/block-spacing"),
          ).toEqual([]);
        }
  });
  it.each([
    ["a <b>b</b>\n\nc\n1. d\n", "a <b>b</b>\n\nc\n\n1. d\n"],
    ["- a ``` b\n# c\n", "- a ``` b\n\n# c\n"],
    ["<div>\na\n</div>\n\n1. b\n# c\n", "<div>\na\n</div>\n\n1. b\n\n# c\n"],
    ["- a\n\n> b\n", "- a\n\n> b\n"],
    ["-\n\ncedar\n", "-\n\ncedar\n"],
    ["> a\n>\n> - b\n", "> a\n>\n> - b\n"],
    ["# Heading\n> quote\n", "# Heading\n\n> quote\n"],
  ])("keeps ordinary spacing available in %j (#435–#439)", (source, output) => {
    expect(spaced(source, "obsidian")).toBe(output);
  });
  it("resumes formatting after the confirmed inline HTML closer (#435)", () => {
    const source = "a <b> *literal*\n</b>\n# Later\nText *formats*.\n";
    expect(formatted(source, { extends: ["recommended", "obsidian"], dialect: "obsidian" })).toBe(
      "a <b> *literal*\n</b>\n\n# Later\n\nText _formats_.\n",
    );
    for (const [source, output] of [
      [
        "Words <span>text</span> *styled*\n\nLater *words*.\n",
        "Words <span>text</span> _styled_\n\nLater _words_.\n",
      ],
      ["a <b>*inside*</b> *after*\n", "a <b>*inside*</b> _after_\n"],
      [
        "a <b>*inside*</b> *between* <span>*literal*</span> *after*\n",
        "a <b>*inside*</b> _between_ <span>*literal*</span> _after_\n",
      ],
    ])
      expect(
        formatted(source!, { extends: ["recommended", "obsidian"], dialect: "obsidian" }),
      ).toBe(output);
  });
  it.each([
    "a <b> *literal*\n\nc\n1. d",
    "> # a\n> b",
    "- a\n> b",
    "-\ncedar",
    "<div>\na\n</div>\n\t\n1. b\n# c",
  ])("preserves the Obsidian boundary through EOF in %j (#435–#439)", (source) => {
    expect(formatted(source, only(rule, "obsidian"))).toBe(source);
  });
  it("formats between many closed inline HTML roots on one physical line (#435)", () => {
    const source = "a <b>literal</b> *styled* ".repeat(1_000) + "\n";
    expect(formatted(source, only({ "style/emphasis": "warn" }, "obsidian"))).toBe(
      "a <b>literal</b> _styled_ ".repeat(1_000) + "\n",
    );
  });
  it.each(["commonmark", "github", "forgejo", "gitea"] as const)(
    "retains normal separator proposals in the %s dialect (#435–#439)",
    (dialect) => {
      for (const [source, output] of [
        ["a <b> b\n\nc\n1. d\n", "a <b> b\n\nc\n\n1. d\n"],
        ["> # a\n> b\n", "> # a\n>\n> b\n"],
        ["- a\n> b\n", "- a\n\n> b\n"],
        ["-\ncedar\n", "-\n\ncedar\n"],
        ["<div>\na\n</div>\n\t\n1. b\n# c\n", "<div>\na\n</div>\n\t\n1. b\n\n# c\n"],
      ])
        expect(spaced(source!, dialect)).toBe(output);
    },
  );
  it("honours suppression comments", () => {
    const config = only({ "style/block-spacing": "warn", "style/emphasis": "warn" }, "github");
    const region =
      "<!-- mdtools-disable style/block-spacing -->\n\n# H\nText\n\n<!-- mdtools-enable style/block-spacing -->\n\n# I\nText\n";
    expect(formatted(region, config)).toBe(region.replace("# I\n", "# I\n\n"));
    const next = "<!-- mdtools-disable-next-line style/block-spacing -->\n# H\nText\n";
    expect(formatted(next, config)).toBe(next);
    expect(lint(next, { config })).toEqual([]);
    // A blank line would move the target of a directive for another rule.
    const other = "<!-- mdtools-disable-next-line style/emphasis -->\n# *Keep*\nText *change*\n";
    expect(formatted(other, config)).toBe(
      "<!-- mdtools-disable-next-line style/emphasis -->\n# *Keep*\n\nText _change_\n",
    );
    const inline = "Text <!-- mdtools-disable-next-line style/emphasis -->\n# *Keep*\n";
    expect(formatted(inline, config)).toBe(inline);
  });
  it("formats together with the other block rules", () => {
    const config = only(
      {
        "style/block-spacing": "warn",
        "style/heading": "warn",
        "style/table": "warn",
        "style/wrap": ["warn", { width: 30 }],
      },
      "github",
    );
    expect(
      formatted(
        "# A\nTitle\n===\n| a |\n|-|\n# B\nA paragraph that is long enough to wrap.\n- Item\n",
        config,
      ),
    ).toBe(
      "# A\n\n# Title\n\n| a   |\n| --- |\n\n# B\n\nA paragraph that is long\nenough to wrap.\n\n- Item\n",
    );
  });
  it("keeps the meaning of randomly assembled documents", () => {
    const blocks = fc.constantFrom(
      "# Heading",
      "Title\n=====",
      "Text.",
      "Two\nlines.",
      "- Item",
      "- One\n- Two",
      "* A\n\n* B",
      "1. First",
      "2) Second",
      "- -",
      "- 2. Step",
      "-",
      "-\n---",
      "```\ncode\n```",
      "    code",
      "<div>\nhtml",
      "<!-- comment -->",
      "$$\nx\n$$",
      "| a |\n| - |",
      "***",
      "> Quoted",
      "> [!NOTE]\n> - Item",
      "[a]: https://example.com",
      "[^1]: Note.",
      "^block-id",
      "lazy",
      "===",
    );
    const containers = fc.constantFrom(
      ["", ""],
      ["> ", "> "],
      ["> > ", "> > "],
      ["- ", "  "],
      ["- > ", "  > "],
      ["> - ", ">   "],
    );
    const group = fc.tuple(
      containers,
      fc.array(fc.tuple(blocks, fc.boolean()), { minLength: 1, maxLength: 6 }),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...dialects),
        fc.array(group, { minLength: 1, maxLength: 3 }),
        fc.constantFrom("\n", "\r\n"),
        (dialect, groups, newline) => {
          const lines: string[] = [];
          for (const [[first, rest], items] of groups)
            items.forEach(([block, blank], index) => {
              if (index > 0 && blank) lines.push(rest.trimEnd());
              block.split("\n").forEach((line, at) => {
                lines.push((index === 0 && at === 0 ? first : rest) + line);
              });
            });
          spaced(lines.join(newline) + newline, dialect);
        },
      ),
      { numRuns: 300, seed: 20261017 },
    );
  });
});

describe("style/emphasis and style/strong next to other delimiters", () => {
  const config = only({ "style/emphasis": "warn", "style/strong": "warn" });
  it.each(["_*foo*_", "*_foo_*", "_foo_*bar*", "*foo*_bar", "bar_*foo*", "*__foo__*", "__*foo*__"])(
    "leaves %s alone because the new marker would touch an existing one",
    (source) => {
      expect(formatted(`${source}\n`, config)).toBe(`${source}\n`);
      expect(lint(`${source}\n`, { config })).toEqual([]);
    },
  );
  it.each([
    ["***foo***\n", "_**foo**_\n"],
    ["___foo___\n", "_**foo**_\n"],
    ["*foo* *bar*\n", "_foo_ _bar_\n"],
    ["**foo** __bar__\n", "**foo** **bar**\n"],
    ["*foo*(bar)\n", "_foo_(bar)\n"],
  ])("still converts %j", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
  // Each would pair differently with the new markers: a `*` or `_` left as
  // text, a run of the new marker nearby, or a `~` between two markers.
  it.each([
    ["*a _b* c_\n", "_", "commonmark"],
    ["_a*b_ and _c*_\n", "*", "commonmark"],
    ["_]*__a__*i_\n", "*", "commonmark"],
    ["_~*a*e_\n", "*", "github"],
    ["_f~*a*e_\n", "*", "obsidian"],
  ] as const)("leaves the crossed delimiters of %j alone", (source, marker, dialect) => {
    const rules = only({ "style/emphasis": ["warn", { marker }] }, dialect);
    expect(formatted(source, rules)).toBe(source);
    expect(lint(source, { config: rules })).toEqual([]);
  });
  it.each([
    // A `*` or `_` left as text that the new markers cannot reach stays text.
    ["*a* and file_.\n", "_", "_a_ and file_.\n"],
    ["*a* and 2*3 and *b*\n", "_", "_a_ and 2*3 and _b_\n"],
    // Of emphases sharing a run, those that keep their pairs change.
    ["*a****c***\n", "_", "_a_***c***\n"],
    ["___b___ and ***c***\n", "*", "*__b__* and ***c***\n"],
  ] as const)("converts what keeps its pairs in %j", (source, marker, output) => {
    expect(formatted(source, only({ "style/emphasis": ["warn", { marker }] }))).toBe(output);
  });
  it.each(["*****a***\n", "___a_ x_\n", "***c***a\n", "**_c_**a\n"])(
    "formats the shared runs of %j safely with every marker",
    (source) => {
      // Which of these markers can change depends on micromark's version:
      // micromark-core-commonmark 2.0.4 no longer lets a run next to the other
      // marker close whatever follows it, as in `***c***a`.
      for (const emphasis of ["*", "_"] as const)
        for (const strong of ["*", "_"] as const) {
          const rules = only({
            "style/emphasis": ["warn", { marker: emphasis }],
            "style/strong": ["warn", { marker: strong }],
          });
          const output = formatted(source, rules);
          expect(semanticFingerprint(parse(output, "commonmark"))).toBe(
            semanticFingerprint(parse(source, "commonmark")),
          );
        }
    },
  );
  it.each(["github", "forgejo", "gitea"] as const)(
    "leaves markers next to dollar math alone on %s",
    (dialect) => {
      // A `_` after the closing dollar keeps `$x$` from being math.
      const source = "$x$_a_ and *$y$* and $z$ *b*\n";
      expect(
        formatted(source, only({ "style/emphasis": ["warn", { marker: "*" }] }, dialect)),
      ).toBe("$x$_a_ and *$y$* and $z$ *b*\n");
      expect(formatted(source, only({ "style/emphasis": "warn" }, dialect))).toBe(
        "$x$_a_ and *$y$* and $z$ _b_\n",
      );
      // CommonMark has no math, and Obsidian does not look for a `_` after it.
      for (const other of ["commonmark", "obsidian"] as const)
        expect(
          formatted(source, only({ "style/emphasis": ["warn", { marker: "*" }] }, other)),
        ).toBe("$x$*a* and *$y$* and $z$ *b*\n");
    },
  );
  it.each(["github", "forgejo", "gitea", "obsidian"] as const)(
    "leaves emphasis that holds a tilde run of strikethrough alone on %s",
    (dialect) => {
      // After `*a*`, the parser pairs `*c~~ d*`, which GitHub and Obsidian show
      // as text after a strikethrough of `b *c` (issue #320).
      const rules = only({ "style/emphasis": "warn" }, dialect);
      expect(formatted("Use *a* and ~~b *c~~ d* here.\n", rules)).toBe(
        "Use _a_ and ~~b *c~~ d* here.\n",
      );
      // One tilde marks strikethrough too, except in Obsidian (issue #319).
      expect(formatted("Use *a* and ~b *c~ d* here.\n", rules)).toBe(
        dialect === "obsidian" ? "Use _a_ and ~b _c~ d_ here.\n" : "Use _a_ and ~b *c~ d* here.\n",
      );
      // Without another run of tildes no strikethrough forms, and strikethrough
      // that the parser reads holds no tildes as text.
      expect(formatted("Some *about ~5 minutes* here.\n", rules)).toBe(
        "Some _about ~5 minutes_ here.\n",
      );
      expect(formatted("A *b ~~c~~ d* e.\n", rules)).toBe("A _b ~~c~~ d_ e.\n");
    },
  );
  it.each(["github", "forgejo", "gitea", "obsidian"] as const)(
    "leaves a `_` that tildes separate from a word alone on %s",
    (dialect) => {
      // GitHub reads such a `_` as inside the word, where it cannot open or
      // close, while the parser reads emphasis (issue #322).
      const underscores = only({ "style/emphasis": "warn" }, dialect);
      expect(formatted("x~~*b b*~~ y and *c*\n", underscores)).toBe("x~~*b b*~~ y and _c_\n");
      const stars = only({ "style/emphasis": ["warn", { marker: "*" }] }, dialect);
      expect(formatted("x~_b b_~ y and _c_\n", stars)).toBe("x~_b b_~ y and *c*\n");
      // Next to a space, a tilde does not join the marker to a word.
      expect(formatted("a ~*b* c\n", underscores)).toBe("a ~_b_ c\n");
    },
  );
  it.each(dialects)(
    "leaves markers alone where CommonMark pairs them otherwise than the parser on %s",
    (dialect) => {
      // micromark refuses the pair `***` and `*` by the rule of three, counting
      // what is left of `***`; CommonMark and GitHub count the whole run and
      // read emphasis around `*a* a` (issue #323).
      const rules = only({ "style/emphasis": "warn", "style/strong": "warn" }, dialect);
      expect(formatted("xab***a* a*y and *b*\n", rules)).toBe("xab***a* a*y and *b*\n");
      expect(formatted("xab***a* a*y\n\nAnd *b*.\n", rules)).toBe("xab***a* a*y\n\nAnd _b_.\n");
    },
  );
  it("reads strikethrough with two tildes only in Obsidian", () => {
    // Obsidian shows `~a~` as text (issue #319); GitHub, Forgejo, and Gitea
    // keep the parser's reading of one tilde.
    const deleted = (source: string, dialect: Dialect) =>
      parse(source, dialect).tree.children.flatMap((block) =>
        "children" in block ? block.children.filter((node) => node.type === "delete") : [],
      ).length;
    expect(deleted("~a~ and ~~b~~\n", "obsidian")).toBe(1);
    for (const dialect of ["github", "forgejo", "gitea"] as const)
      expect(deleted("~a~ and ~~b~~\n", dialect)).toBe(2);
    expect(
      formatted("Before ~b *c~ d* after.\n", only({ "style/emphasis": "warn" }, "obsidian")),
    ).toBe("Before ~b _c~ d_ after.\n");
  });
  it("keeps `*` next to an emoji, where `_` could neither open nor close", () => {
    // micromark reads each half of the emoji's surrogate pair as a letter.
    expect(formatted("🙂*a*🙂 and *b*\n", only({ "style/emphasis": "warn" }, "github"))).toBe(
      "🙂*a*🙂 and _b_\n",
    );
  });
  it("leaves emphasis from the line of a callout's or alert's marker into its body alone", () => {
    const rules = only({ "style/emphasis": ["warn", { marker: "*" }] }, "obsidian");
    expect(formatted("> [!note] _Title\n> body_ and _b_\n", rules)).toBe(
      "> [!note] _Title\n> body_ and *b*\n",
    );
    expect(formatted("> [!note] _Title_\n> _body_\n", rules)).toBe("> [!note] *Title*\n> *body*\n");
    // An alert's marker stays alone on its line in GitHub's reading too.
    const alert = "> [!NOTE] _Text\n> more_\n";
    expect(formatted(alert, { ...rules, dialect: "github" })).toBe(alert);
    // Also a marker written with an escape or a character reference (issue #294).
    expect(formatted("> &#91;!note] _Title\n> body_ and _b_\n", rules)).toBe(
      "> &#91;!note] _Title\n> body_ and *b*\n",
    );
    const escaped = "> \\[!NOTE] _Text\n> more_\n";
    expect(formatted(escaped, { ...rules, dialect: "github" })).toBe(escaped);
  });
  it("keeps the meaning of random runs of markers", () => {
    const words = fc.constantFrom(
      "a",
      "b c",
      "*",
      "_",
      "**",
      "__",
      "***",
      "*a*",
      "_a_",
      "**b**",
      "__b__",
      "***c***",
      "___c___",
      "*a _b* c_",
      "x_y",
      "2*3",
      "file_",
      "_f",
      "`c`",
      "\\*",
      "\\_",
      "~",
      "~~s~~",
      "$x$",
      "[*T*]",
      "[_T_][]",
      "[*T*](u)",
      "==h==",
      " ",
      "\n",
      "(",
      ".",
    );
    fc.assert(
      fc.property(
        fc.array(words, { minLength: 1, maxLength: 12 }),
        fc.constantFrom(...dialects),
        fc.constantFrom("*", "_"),
        fc.constantFrom("*", "_"),
        (parts, dialect, emphasis, strong) => {
          const source = `${parts.join("")}\n\n[*T*]: u\n`;
          const rules = only(
            {
              "style/emphasis": ["warn", { marker: emphasis }],
              "style/strong": ["warn", { marker: strong }],
            },
            dialect,
          );
          const output = formatted(source, rules);
          expect(semanticFingerprint(parse(output, dialect))).toBe(
            semanticFingerprint(parse(source, dialect)),
          );
        },
      ),
      { numRuns: 400, seed: 20261017 },
    );
  });
});

describe("style/emphasis and style/strong in reference labels", () => {
  const rules = { "style/emphasis": "warn", "style/strong": "warn" } as const;
  it("leaves the text of collapsed and shortcut references alone", () => {
    // The text is also the label, which would no longer match the definition.
    const source =
      "See [*Title*][] and [*Title*], [__Bold__] and [*Full*][t], and [*inline*](u).\n\n[*Title*]: u\n[__Bold__]: u\n[t]: u\n";
    expect(formatted(source, only(rules, "github"))).toBe(
      "See [*Title*][] and [*Title*], [__Bold__] and [_Full_][t], and [_inline_](u).\n\n[*Title*]: u\n[__Bold__]: u\n[t]: u\n",
    );
    expect(lint("[*Title*]\n\n[*Title*]: u\n", { config: only(rules) })).toEqual([]);
  });
  it("leaves bracketed text alone that would match a definition", () => {
    const config = only(
      { "style/emphasis": ["warn", { marker: "*" }], "style/strong": ["warn", { marker: "_" }] },
      "github",
    );
    const source = "[_T_], [**B**], [^_n_], and [_x_].\n\n[*T*]: u\n[__B__]: u\n[^*n*]: Note.\n";
    expect(formatted(source, config)).toBe(
      "[_T_], [**B**], [^_n_], and [*x*].\n\n[*T*]: u\n[__B__]: u\n[^*n*]: Note.\n",
    );
  });
});

describe("style/inline-code", () => {
  const rule = { "style/inline-code": "warn" } as const;
  it.each([
    // Joined, an `==` or `[[` left as text would open a highlight or wikilink.
    "Text with ==a highlight `code` `\nspan`== here.\n",
    "==mark `code\n==` here.\n",
    "See [[note `code\nspan`]] here.\n",
  ])("leaves %j unjoined in Obsidian", (source) => {
    expect(formatted(source, only(rule, "obsidian"))).toBe(source);
    expect(formatted(source, only(rule, "github"))).toBe(source.replace(/\n(?=\S+`)/, " "));
  });
  it("leaves a code span from the line of a callout's or alert's marker unjoined", () => {
    // That line holds an Obsidian callout's title, and an alert's marker alone.
    for (const source of [
      "> [!note] Title `code\n> span` here.\n",
      "> [!NOTE] `code\n> span` here.\n",
      // Also a marker written with an escape or a character reference (issue #294).
      "> &#91;!note] Title `code\n> span` here.\n",
      "> \\[!NOTE] `code\n> span` here.\n",
    ]) {
      for (const dialect of ["github", "forgejo", "gitea", "obsidian"] as const)
        expect(formatted(source, only(rule, dialect))).toBe(source);
      expect(formatted(source, only(rule))).toBe(source.replace("\n> ", " "));
    }
  });
  it.each(dialects)(
    "drops the indentation of the next line when it joins a code span in the %s dialect",
    (dialect) => {
      // CommonMark strips it from a paragraph's lines before it reads the span,
      // and GitHub shows `npm run build`; the parser keeps it in the span.
      for (const [source, output] of [
        ["Run `npm run\n   build` now.\n", "Run `npm run build` now.\n"],
        ["Run `npm run\n\tbuild` now.\n", "Run `npm run build` now.\n"],
        ["> Run `npm run\n>    build` now.\n", "> Run `npm run build` now.\n"],
        ["- Run `npm run\n     build` now.\n", "- Run `npm run build` now.\n"],
        ["- [ ] Run `npm run\n      build` now.\n", "- [ ] Run `npm run build` now.\n"],
      ] as const)
        expect(formatted(source, only(rule, dialect))).toBe(output);
    },
  );
  it("compares code spans without the indentation after their line endings", () => {
    const print = (source: string) => semanticFingerprint(parse(source, "github"));
    expect(print("Run `npm run\n   build` now.\n")).toBe(print("Run `npm run build` now.\n"));
    expect(print("Run `npm run\n   build` now.\n")).not.toBe(
      print("Run `npm run    build` now.\n"),
    );
    // A lazy line keeps its indentation, as GitHub shows it.
    expect(print("> Run `npm run\n   build` now.\n")).toBe(
      print("> Run `npm run    build` now.\n"),
    );
    expect(print("> Run `npm run\n   build` now.\n")).not.toBe(
      print("> Run `npm run build` now.\n"),
    );
  });
  // Issue #290, observed with `gh api markdown -f mode=markdown` on 2026-10-18,
  // comparing the text of each `<code>` element exactly: each case's code
  // spans as GitHub shows them, and as commonmark.js 0.31.2 shows them where
  // it differs. It differs only where a span goes on in a lazy continuation
  // line, one without its block quote's `>` or its list item's indentation,
  // that starts with spaces or tabs, which GitHub keeps in the span.
  const observed: [string, string[], string[]?][] = [
    ["Text ` \n   foo ` end.", [" foo"]],
    ["> Run `npm run\n   build` now.", ["npm run    build"], ["npm run build"]],
    ["Text ` foo \n   ` end.", ["foo "]],
    ["Text `\n   foo\n   ` end.", ["foo"]],
    ["> a `b\n>    c` d", ["b c"]],
    ["> a `b\n  c` d", ["b   c"], ["b c"]],
    ["> a `b\nc` d", ["b c"]],
    ["> > a `b\n>   c` d", ["b   c"], ["b c"]],
    ["> > a `b\n> >   c` d", ["b c"]],
    ["> > a `b\n   c` d", ["b    c"], ["b c"]],
    ["- a `b\n c` d", ["b  c"], ["b c"]],
    ["- a `b\n     c` d", ["b c"]],
    ["- a `b\n  c` d", ["b c"]],
    ["1. a `b\n  c` d", ["b   c"], ["b c"]],
    ["1. a `b\n      c` d", ["b c"]],
    ["- a\n  - b `c\n   d` e", ["c  d"], ["c d"]],
    ["- a\n  - b `c\n d` e", ["c  d"], ["c d"]],
    ["> - a `b\n>  c` d", ["b  c"], ["b c"]],
    ["> - a `b\n>     c` d", ["b c"]],
    ["> - a `b\n c` d", ["b  c"], ["b c"]],
    ["- > a `b\n  c` d", ["b c"]],
    ["- > a `b\n   c` d", ["b  c"], ["b c"]],
    ["- > a `b\n  >   c` d", ["b c"]],
    ["Ref[^a].\n\n[^a]: a `b\n c` d", ["b  c"]],
    ["Ref[^b].\n\n[^b]: a `b\n     c` d", ["b c"]],
    ["Ref[^c].\n\n[^c]: a `b\n    c` d", ["b c"]],
    ["Ref[^d].\n\n[^d]: a ` \n   foo ` d", ["    foo"]],
    ["Ref[^e].\n\n[^e]: a `\n  foo\n  ` d", ["  foo  "]],
    ["a `b\n   c`\n===", ["b c"]],
    ["> a `b\n  c`\n> ===", ["b   c"], ["b c"]],
    ["> [a `b\n  c`](u)", ["b   c"], ["b c"]],
    ["> *a `b\n  c`*", ["b   c"], ["b c"]],
    // Only spaces, which stay.
    ["a `  ` b", ["  "]],
    ["a ` \n ` b", ["  "]],
    ["a ` \n` b", ["  "]],
    ["a `\n ` b", [" "]],
    ["> a ` \n  ` b", ["    "], ["  "]],
    ["> a ` \n>   ` b", ["  "]],
    // A line break at an edge.
    ["a `\nfoo` b", [" foo"]],
    ["a `foo\n` b", ["foo "]],
    ["a `\nfoo\n` b", ["foo"]],
    ["a `\n   foo` b", [" foo"]],
    ["a `foo\n   ` b", ["foo "]],
    ["> a `\n   foo` b", ["    foo"], [" foo"]],
    ["> a `foo\n   ` b", ["foo    "], ["foo "]],
    ["> a `\n   foo\n   ` b", ["   foo   "], ["foo"]],
    ["> a `\n>   foo\n>   ` b", ["foo"]],
    ["- a `foo\n   ` b", ["foo "]],
    ["- a `foo\n ` b", ["foo  "], ["foo "]],
    ["a `b  \n  c` d", ["b   c"]],
    ["a ` b \n c ` d", ["b  c"]],
    ["a `` ` \n   `` b", ["` "]],
    ["> a `` x\n   ` `` b", ["x    `"], ["x `"]],
    // Tabs, which are not spaces, and count to the next multiple of four
    // columns where they indent.
    ["a `\tfoo\t` b", ["\tfoo\t"]],
    ["a ` \tfoo\t ` b", ["\tfoo\t"]],
    ["a `b\n\tc` d", ["b c"]],
    ["> a `b\n\tc` d", ["b \tc"], ["b c"]],
    ["> a `b\n>\tc` d", ["b c"]],
    ["> > a `b\n>\tc` d", ["b   c"], ["b c"]],
    ["- a `b\n\tc` d", ["b c"]],
    ["> a `\n\tfoo ` b", ["\tfoo"], ["foo"]],
    ["a ` \n\tfoo ` b", [" foo"]],
    ["> Run `npm run\r\n   build` now.", ["npm run    build"], ["npm run build"]],
    ["Text `\r\n   foo\r\n   ` end.", ["foo"]],
    ["> a `\r\n   foo\r\n   ` b", ["   foo   "], ["foo"]],
  ];
  it.each(observed)("reads the code spans of %j as GitHub shows them", (source, github, other) => {
    const spans = codeSpans(source, "github");
    expect(spans.map(codeSpanText)).toEqual(github);
    // commonmark.js has no footnotes.
    if (!source.includes("[^"))
      expect(spans.map(lazyIndentation)).toEqual(
        github.map((text, i) => (other?.[i] ?? text) !== text),
      );
  });
  it.each(observed)("joins the code spans of %j as GitHub shows them", (source, github) => {
    for (const dialect of dialects) {
      // CommonMark has no footnotes.
      if (dialect === "commonmark" && source.includes("[^")) continue;
      const output = formatted(source, only(rule, dialect));
      const spans = codeSpans(output, dialect);
      expect(spans.map(codeSpanText), dialect).toEqual(github);
      // Renderers differ on a lazy line's indentation: GitHub keeps it in the
      // span, and commonmark.js does not.
      if (dialect === "github")
        expect(spans.every((span) => !/[\r\n]/.test(output.slice(...range(span))))).toBe(true);
      else if (codeSpans(source, dialect).some(lazyIndentation)) expect(output).toBe(source);
    }
  });
  it("still joins code spans beside a single `==` or below a callout's title", () => {
    expect(formatted("An == sign and `code\nspan` here.\n", only(rule, "obsidian"))).toBe(
      "An == sign and `code span` here.\n",
    );
    expect(
      formatted("> [!note] Title\n> Body `code\n> span` here.\n", only(rule, "obsidian")),
    ).toBe("> [!note] Title\n> Body `code span` here.\n");
  });
  it.each([
    // The joined span opens with one backtick, which the earlier one would pair with.
    "A ` tick and ``code\nspan`` here.\n",
    "Text \\`` and ``code\nspan`` here.\n",
    "[link](u`v) and ``code\nspan`` here.\n",
  ])("leaves %j unjoined, where an earlier run of the new backticks would pair", (source) => {
    for (const dialect of dialects) expect(formatted(source, only(rule, dialect))).toBe(source);
  });
  it.each([
    ["Ticks ``code\nspan`` and a ` after.\n", "Ticks `code span` and a ` after.\n"],
    ["`a` and `b\nc` here.\n", "`a` and `b c` here.\n"],
  ])("still joins %j", (source, output) => {
    // In Obsidian, a backtick that nothing closes keeps its paragraph as
    // written, since Live Preview shows the text after it as code (#362).
    for (const dialect of dialects)
      expect(formatted(source, only(rule, dialect)), dialect).toBe(
        dialect === "obsidian" && source.includes(" ` ") ? source : output,
      );
  });
});

describe("Forgejo and Gitea backslash math", () => {
  const markers = { "style/emphasis": "warn", "style/strong": "warn" } as const;
  it.each(["forgejo", "gitea"] as const)(
    "leaves markers inside \\(...\\) alone on %s",
    (dialect) => {
      expect(formatted("\\(*x*\\) and *y*\n", only(markers, dialect))).toBe("\\(*x*\\) and _y_\n");
      expect(formatted("\\(__x__\\)\n", only(markers, dialect))).toBe("\\(__x__\\)\n");
      expect(formatted("\\(*x*\\)\n", only(markers, "github"))).toBe("\\(_x_\\)\n");
    },
  );
  it.each(["forgejo", "gitea"] as const)(
    "does not join a code span that would put \\( and \\) on one line on %s",
    (dialect) => {
      const source = "\\( `code\nspan` \\)\n";
      expect(formatted(source, only({ "style/inline-code": "warn" }, dialect))).toBe(source);
      expect(formatted(source, only({ "style/inline-code": "warn" }, "github"))).toBe(
        "\\( `code span` \\)\n",
      );
    },
  );
});

describe("style/emphasis and style/strong on Gitea", () => {
  const rules: Record<string, RuleSetting> = { "style/emphasis": "warn", "style/strong": "warn" };
  // Gitea renders `__init__.py` literally and `*config*.py` as emphasis; GFM
  // parses both as emphasis, so a marker change would alter Gitea's output.
  it.each([
    ["See __init__.py and __main__.py.\n", "See **init**.py and **main**.py.\n"],
    ["Edit *config*.py first.\n", "Edit _config_.py first.\n"],
    ["Use **setup**.py here.\n", "Use **setup**.py here.\n"],
    ["*a* and b_.py\n", "_a_ and b_.py\n"],
    ["*a* near `x_.py`\n", "_a_ near `x_.py`\n"],
    ["*.py files*\n", "_.py files_\n"],
  ])("leaves %j alone where `_.py` decides Gitea emphasis", (source, github) => {
    expect(formatted(source, only(rules, "gitea"))).toBe(source);
    expect(formatted(source, only(rules, "github"))).toBe(github);
  });
  it("converts markers on other lines", () => {
    const source = "*a* and __b__\n\n*c* on __init__.py\n";
    expect(formatted(source, only(rules, "gitea"))).toBe("_a_ and **b**\n\n*c* on __init__.py\n");
  });
  it("leaves multiline code spans on `_.py` lines unjoined", () => {
    const config = only({ "style/inline-code": "warn" }, "gitea");
    const source = "_a_ and `code\nspan` near b_.py\n";
    expect(formatted(source, config)).toBe(source);
    expect(formatted(source, { ...config, dialect: "github" })).toBe(
      "_a_ and `code span` near b_.py\n",
    );
  });
});

describe("style/emphasis and style/strong in Obsidian, next to a * or _ that is text", () => {
  const rules: Record<string, RuleSetting> = { "style/emphasis": "warn", "style/strong": "warn" };
  // Obsidian's Reading view pairs a `*` or `_` that CommonMark leaves as text
  // with a later one: `snake_case and _em_` shows `case and _em` as emphasis,
  // and `a * b *c*` shows ` b ` (issue #361).
  it.each([
    ["snake_case and *em*\n", "snake_case and _em_\n"],
    ["See file_name.md and *this*.\n", "See file_name.md and _this_.\n"],
    ["a * b *c*\n", "a * b _c_\n"],
    ["5 * 3 = 15 and __bold__\n", "5 * 3 = 15 and **bold**\n"],
    ["a ** b __c__\n", "a ** b **c**\n"],
    ["- an item with snake_case and *em*\n", "- an item with snake_case and _em_\n"],
    ["| a_b and *c* |\n| - |\n", "| a_b and _c_ |\n| - |\n"],
    ["# snake_case and *em*\n", "# snake_case and _em_\n"],
  ])("leaves %j as written", (source, github) => {
    expect(formatted(source, only(rules, "obsidian"))).toBe(source);
    expect(formatted(source, only(rules, "github"))).toBe(github);
  });
  it.each([
    // Escaped, in code, in math, or in a wikilink, a `*` or `_` is not text that pairs.
    ["a \\_ b *c*\n", "a \\_ b _c_\n"],
    ["`snake_case` and *em*\n", "`snake_case` and _em_\n"],
    ["$a_b$ and *em*\n", "$a_b$ and _em_\n"],
    ["[[snake_case]] and *em*\n", "[[snake_case]] and _em_\n"],
    // The other paragraphs and table cells are formatted, which Obsidian reads on their own.
    ["| a_b | *c* |\n| - | - |\n", "| a_b | _c_ |\n| - | - |\n"],
    ["snake_case\n\n*em* and __b__\n", "snake_case\n\n_em_ and **b**\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, only(rules, "obsidian"))).toBe(output);
  });
});

describe("style/emphasis and style/strong on long lines", () => {
  /** The lines that hold a range, searched character by character. */
  function lineOf(source: string, start: number, end: number): [number, number] {
    let lineStart = start;
    while (lineStart > 0 && !/[\r\n]/.test(source[lineStart - 1]!)) lineStart--;
    let lineEnd = end;
    while (lineEnd < source.length && !/[\r\n]/.test(source[lineEnd]!)) lineEnd++;
    return [lineStart, lineEnd];
  }
  it("find `_.py`, `\\(`, and `\\)` on a line as a search of the line does", () => {
    const text = fc
      .array(
        fc.constantFrom("a", " ", "\n", "\r", "\r\n", "_.py", "_.p", "\\(", "\\)", "\\", "("),
        {
          maxLength: 30,
        },
      )
      .map((parts) => parts.join(""));
    fc.assert(
      fc.property(text, fc.nat(), fc.nat(), (source, a, b) => {
        const start = a % (source.length + 1);
        const end = start + (b % (source.length - start + 1));
        const document = parse(source, "forgejo");
        const [lineStart, lineEnd] = lineOf(source, start, end);
        const before = source.slice(lineStart, start);
        expect(giteaPyLine(document, start, end)).toBe(
          source.slice(lineStart, lineEnd).includes("_.py"),
        );
        expect(inForgeMath(document, start, end)).toBe(
          before.lastIndexOf("\\(") > before.lastIndexOf("\\)") &&
            source.slice(end, lineEnd).includes("\\)"),
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe("Forgejo and Gitea heading attribute blocks", () => {
  const forges = ["forgejo", "gitea"] as const;
  const markers = { "style/emphasis": "warn", "style/strong": "warn" } as const;
  // Forgejo and Gitea read the trailing `{...}` block before they parse
  // emphasis; GFM parses the same characters as heading text. Rendered on
  // Forgejo 16.0.5 and Gitea 1.25.5, 1.27.3, and 28.0.0, each source below
  // differs from its GitHub-style rewrite in heading text, attributes, or anchor.
  it.each([
    // The rewritten block would be invalid: heading text and no `#bare` anchor.
    ["## Bare {#bare data-x=__init__}\n", "## Bare {#bare data-x=**init**}\n"],
    // The rewritten block would set another title.
    ['## Star {title="*x*"}\n', '## Star {title="_x_"}\n'],
    // No emphasis on the forges: it would start in the text and end in the block.
    ["## __Mode {.a__}\n", "## **Mode {.a**}\n"],
    // Emphasis and no block on the forges: `{.a*}` is invalid and `{.a_}` is not.
    ["## *Mode {.a*}\n", "## _Mode {.a_}\n"],
    ["Under *lined {.a*}\n===\n", "Under _lined {.a_}\n===\n"],
    // Each of the two nested emphases alone would leave the block invalid.
    ["## **Lead {.c* .d*}\n", "## __Lead {.c_ .d_}\n"],
    // Gitea before 1.26 also reads a block that a closing sequence follows.
    ["## Old {#old data-x=__init__} ##\n", "## Old {#old data-x=**init**} ##\n"],
    // From the first `{` on, every character can decide whether a block follows.
    ["## Use {braces} in *text*\n", "## Use {braces} in _text_\n"],
  ])("leaves the markers of %j alone", (source, github) => {
    for (const dialect of forges) expect(formatted(source, only(markers, dialect))).toBe(source);
    expect(formatted(source, only(markers, "github"))).toBe(github);
  });
  it.each(forges)("still converts markers outside a block on %s", (dialect) => {
    expect(
      formatted(
        "## *Install* and __run__ {#setup}\n\nA *b* {.c*}\n\n*Two*\nlines {#two}\n---\n",
        only(markers, dialect),
      ),
    ).toBe("## _Install_ and **run** {#setup}\n\nA _b_ {.c*}\n\n_Two_\nlines {#two}\n---\n");
  });
  it.each(forges)("keeps a heading's custom anchor through the %s preset", (dialect) => {
    const config: Config = { extends: ["recommended", dialect] };
    const source = "## Bare {#bare data-x=__init__}\n\n[link](#bare) and *text*\n";
    const workspace = createWorkspace({ "Doc.md": source });
    const result = format(source, { config, path: "Doc.md", workspace });
    expect(result.output).toBe("## Bare {#bare data-x=__init__}\n\n[link](#bare) and _text_\n");
    expect(result.diagnostics.filter((item) => item.rule !== "style/emphasis")).toEqual([]);
  });
  it.each([
    // A `#` run before the block would close the ATX heading on the forges.
    ["Run ## {#sid}\n===\n", "# Run \\## {#sid}\n", "# Run ## {#sid}\n"],
    ["Tight ##{#tid}\n---\n", "## Tight \\##{#tid}\n", "## Tight ##{#tid}\n"],
    ["Plain {#pid}\n---\n", "## Plain {#pid}\n", "## Plain {#pid}\n"],
    ["C# {#cs}\n---\n", "## C# {#cs}\n", "## C# {#cs}\n"],
    ["Run ## {#sid} #\n===\n", "# Run ## {#sid} \\#\n", "# Run ## {#sid} \\#\n"],
  ])("converts the Setext heading %j without changing its text", (source, forge, github) => {
    const config = { "style/heading": "warn" } as const;
    for (const dialect of forges) expect(formatted(source, only(config, dialect))).toBe(forge);
    expect(formatted(source, only(config, "github"))).toBe(github);
  });
  it.each([
    // Joined, the last line would hold a valid block.
    ['Join {title="`c\nd`"}\n---\n', 'Join {title="`c d`"}\n---\n'],
    // Forgejo builds the anchor from the last line alone: `#b-end`.
    ["Multi `a\nb` end\n===\n", "Multi `a b` end\n===\n"],
  ])("leaves the multiline code span of the heading %j unjoined", (source, github) => {
    const config = { "style/inline-code": "warn" } as const;
    for (const dialect of forges) {
      expect(formatted(source, only(config, dialect))).toBe(source);
      expect(formatted(`Text \`a\nb\` end\n\n${source}`, only(config, dialect))).toBe(
        `Text \`a b\` end\n\n${source}`,
      );
    }
    expect(formatted(source, only(config, "github"))).toBe(github);
  });
  it("leaves a link destination inside a block alone", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "relative", leadingDot: true }],
    };
    const source = '## Link {title="[x](y.md)"}\n\n[y](y.md)\n';
    const workspace = createWorkspace({ "Doc.md": source, "y.md": "" });
    const run = (dialect: Dialect) =>
      formatted(source, only(rules, dialect), { path: "Doc.md", workspace });
    for (const dialect of forges)
      expect(run(dialect)).toBe('## Link {title="[x](y.md)"}\n\n[y](./y.md)\n');
    expect(run("github")).toBe('## Link {title="[x](./y.md)"}\n\n[y](./y.md)\n');
  });
  it("refuses an edit by any rule that changes a block", () => {
    // In the GFM tree both spellings are the same emphasis, so only the
    // block's own text can tell them apart.
    const swap = (from: string, to: string): Plugin => ({
      name: "swap",
      rules: {
        markers: {
          kind: "style",
          description: "Replace the emphasis markers of the first heading",
          check: ({ document }) =>
            [...document.source.split("\n")[0]!.matchAll(/[*_]/g)]
              .filter((match) => match[0] === from)
              .map((match) => ({
                start: match.index,
                message: "Swap",
                edit: { start: match.index, end: match.index + 1, text: to },
              })),
        },
      },
    });
    const config = (dialect: Dialect) => only({ "swap/markers": "warn" }, dialect);
    for (const [source, from, to] of [
      ['## Star {title="*x*"}\n', "*", "_"],
      ["## *Mode {.a*}\n", "*", "_"],
      ["## _Mode {.a_}\n", "_", "*"],
      ["## Old {#old data-x=_i_} ##\n", "_", "*"],
    ] as const) {
      const plugins = [swap(from, to)];
      for (const dialect of forges) {
        const result = format(source, { config: config(dialect), plugins });
        expect(result.output).toBe(source);
        expect(refusals(result)).toMatchObject([{ rule: "engine/unsafe-format" }]);
      }
      expect(format(source, { config: config("github"), plugins }).output).toBe(
        source.replaceAll(from, to),
      );
    }
    // The same edit before a block that sets the id is an ordinary marker change.
    const plugins = [swap("*", "_")];
    expect(format("## *Mode* {#m}\n", { config: config("forgejo"), plugins }).output).toBe(
      "## _Mode_ {#m}\n",
    );
  });
  it("refuses an edit that adds or removes a closing sequence after a block", () => {
    // `## Title {#id}` is a block on every version; `## Title {#id} ##` only on
    // Gitea before 1.26. Both leave the same GFM tree and the same block text.
    const closing = (text: string): Plugin => ({
      name: "closing",
      rules: {
        sequence: {
          kind: "style",
          description: "Replace the first line",
          check: ({ document }) => {
            const end = document.source.indexOf("\n");
            return document.source.slice(0, end) === text
              ? []
              : [{ start: 0, message: "Replace", edit: { start: 0, end, text } }];
          },
        },
      },
    });
    for (const [source, text] of [
      ["## Title {#id} ##\n", "## Title {#id}"],
      ["## Title {#id}\n", "## Title {#id} ##"],
    ] as const) {
      for (const dialect of forges) {
        const result = format(source, {
          config: only({ "closing/sequence": "warn" }, dialect),
          plugins: [closing(text)],
        });
        expect(result.output).toBe(source);
        expect(refusals(result)).toMatchObject([{ rule: "engine/unsafe-format" }]);
      }
      const github = only({ "closing/sequence": "warn" }, "github");
      expect(format(source, { config: github, plugins: [closing(text)] }).output).toBe(`${text}\n`);
    }
  });
});

describe("Forgejo and Gitea heading anchors under formatting", () => {
  const forges = ["forgejo", "gitea"] as const;
  const markers = { "style/emphasis": "warn", "style/strong": "warn" } as const;
  // Forgejo 16.0.5 and Gitea 1.21.11, 1.23.8, and 1.25.5 build the anchor from
  // the heading's last line as written: `## Emph *star* end` is #emph-star-end
  // and `## Emph _star_ end` is #emph-_star_-end.
  it.each([
    ["## Emph *star* end\n", "## Emph _star_ end\n"],
    ["## Strong __init__ end\n", "## Strong **init** end\n"],
    ["Under *lined*\n===\n", "Under _lined_\n===\n"],
    ["> ## Quoted *star*\n", "> ## Quoted _star_\n"],
  ])("leaves the markers of the heading %j alone", (source, github) => {
    for (const dialect of forges) expect(formatted(source, only(markers, dialect))).toBe(source);
    expect(formatted(source, only(markers, "github"))).toBe(github);
  });
  it.each(forges)("still converts markers that cannot change an anchor on %s", (dialect) => {
    const source = "*Two*\n*lines*\n===\n\n## *Custom* {#id}\n\nA *b* and __c__.\n";
    expect(formatted(source, only(markers, dialect))).toBe(
      "_Two_\n*lines*\n===\n\n## _Custom_ {#id}\n\nA _b_ and **c**.\n",
    );
  });
  it("leaves a link destination in a heading alone", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "relative", leadingDot: true }],
    };
    const source = "## See [x](y.md) end\n\n## See [x](y.md) {#see}\n\n[y](y.md)\n";
    const workspace = createWorkspace({ "Doc.md": source, "y.md": "" });
    const run = (dialect: Dialect) =>
      formatted(source, only(rules, dialect), { path: "Doc.md", workspace });
    for (const dialect of forges)
      expect(run(dialect)).toBe(
        "## See [x](y.md) end\n\n## See [x](./y.md) {#see}\n\n[y](./y.md)\n",
      );
    expect(run("github")).toBe(
      "## See [x](./y.md) end\n\n## See [x](./y.md) {#see}\n\n[y](./y.md)\n",
    );
  });
  it.each(forges)("keeps every link to a heading valid through the %s preset", (dialect) => {
    const config: Config = { extends: ["recommended", dialect] };
    const source =
      "## Emph *star* end\n\n## Strong __init__ end\n\n[a](#emph-star-end) and [b](#strong-__init__-end) and *c*\n";
    const workspace = createWorkspace({ "Doc.md": source });
    const result = format(source, { config, path: "Doc.md", workspace });
    expect(result.output).toBe(source.replace("*c*", "_c_"));
    expect(result.diagnostics.filter((item) => item.rule !== "style/emphasis")).toEqual([]);
    // The links still resolve against the formatted document itself.
    const after = createWorkspace({ "Doc.md": result.output });
    expect(lint(result.output, { config, path: "Doc.md", workspace: after })).toEqual([]);
  });
  it.each(forges)("formats a quoted list heading's first line on %s", (dialect) => {
    // Rendered: Forgejo 16.0.5 and Gitea 1.25.5 give this heading `#last-keep`,
    // Gitea 28.0.0 `#first-last-keep`; only the last line is left alone.
    const source = "> - *First*\n>   Last *keep*\n>   ===\n\n[a](#last-keep)\n";
    const workspace = createWorkspace({ "Doc.md": source });
    const result = format(source, { config: only(markers, dialect), path: "Doc.md", workspace });
    expect(result.output).toBe("> - _First_\n>   Last *keep*\n>   ===\n\n[a](#last-keep)\n");
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
    expect(
      createWorkspace({ "Doc.md": result.output }).resolve("Doc.md", "#last-keep", dialect)
        .fragmentExists,
    ).toBe(true);
  });
  it.each(forges)("converts a Setext heading with a class block on %s", (dialect) => {
    // The `##` is heading text on both forms: Forgejo renders `#run`, Gitea
    // 1.25 `#run-`, before and after the conversion.
    const config = only({ "style/heading": "warn" }, dialect);
    expect(formatted("Run ## {.a}\n===\n", config)).toBe("# Run \\## {.a}\n");
    for (const source of ["Run ## {.a}\n===\n", "# Run \\## {.a}\n"]) {
      const resolves = (fragment: string, forge: Dialect) =>
        createWorkspace({ "Doc.md": source }).resolve("Doc.md", `#${fragment}`, forge)
          .fragmentExists;
      expect(resolves("run", "forgejo")).toBe(true);
      expect(resolves("run-", "gitea")).toBe(true);
    }
  });

  it("refuses an edit by any rule that changes an anchor", () => {
    const plugin: Plugin = {
      name: "swap",
      rules: {
        stars: {
          kind: "style",
          description: "Replace every asterisk with an underscore",
          check: ({ document }) =>
            [...document.source.matchAll(/\*/g)].map((match) => ({
              start: match.index,
              message: "Swap",
              edit: { start: match.index, end: match.index + 1, text: "_" },
            })),
        },
      },
    };
    const run = (source: string, dialect: Dialect) =>
      format(source, { config: only({ "swap/stars": "warn" }, dialect), plugins: [plugin] });
    for (const dialect of forges) {
      const result = run("## Emph *star* end\n", dialect);
      expect(result.output).toBe("## Emph *star* end\n");
      expect(refusals(result)).toMatchObject([{ rule: "engine/unsafe-format" }]);
      expect(run("*Two*\nlines\n===\n", dialect).output).toBe("_Two_\nlines\n===\n");
    }
    expect(run("## Emph *star* end\n", "github").output).toBe("## Emph _star_ end\n");
  });
});

describe("links/path wikilink rewriting", () => {
  const workspace = createWorkspace(
    { "Doc.md": "", "Folder/Note.md": "# Heading\n", "Other/Dup.md": "", "Folder/Dup.md": "" },
    { dialect: "obsidian" },
  );
  const rewrite = (rules: Record<string, RuleSetting>, source: string) =>
    formatted(source, only(rules, "obsidian"), { path: "Doc.md", workspace });
  it("normalizes aliased links and embeds but not bare wikilinks", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "root", extension: "omit" }],
    };
    expect(rewrite(rules, "[[Folder/Note.md|label]]\n")).toBe("[[Folder/Note|label]]\n");
    expect(rewrite(rules, "![[Folder/Note.md]]\n")).toBe("![[Folder/Note]]\n");
    expect(rewrite(rules, "[[Folder/Note.md#Heading|label]]\n")).toBe(
      "[[Folder/Note#Heading|label]]\n",
    );
    // A bare wikilink's target is also its label; changing it would change the rendering.
    expect(rewrite(rules, "[[Folder/Note.md]]\n")).toBe("[[Folder/Note.md]]\n");
    expect(rewrite(rules, "[[Folder/Note|label]]\n")).toBe("[[Folder/Note|label]]\n");
  });
  it("shortens to a basename only when the basename resolves to the same note", () => {
    const rules: Record<string, RuleSetting> = { "links/path": ["warn", { style: "shortest" }] };
    expect(rewrite(rules, "[[Folder/Note|label]]\n")).toBe("[[Note|label]]\n");
    expect(rewrite(rules, "[[Folder/Dup|label]]\n")).toBe("[[Folder/Dup|label]]\n");
  });
  it("adds a leading dot to relative destinations on request", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "relative", leadingDot: true }],
    };
    expect(rewrite(rules, "[[Folder/Note.md|label]]\n")).toBe("[[./Folder/Note.md|label]]\n");
    expect(formatted("[label](Folder/Note.md)\n", only(rules), { path: "Doc.md", workspace })).toBe(
      "[label](./Folder/Note.md)\n",
    );
  });
});

describe("links/path destination parsing", () => {
  const workspace = createWorkspace(
    { "Doc.md": "", "Folder/Note.md": "", "Folder/Note(1).md": "", "a>b.md": "" },
    { dialect: "commonmark" },
  );
  const angle = only({ "links/path": ["warn", { style: "relative", brackets: "angle" }] });
  const bare = only({ "links/path": ["warn", { style: "relative", brackets: "bare" }] });
  it.each([
    ["[a\\]b](./Folder/Note.md)\n", angle, "[a\\]b](<Folder/Note.md>)\n"],
    ["![a [b] c](./Folder/Note.md)\n", angle, "![a [b] c](<Folder/Note.md>)\n"],
    ["[a](<./Folder/Note.md>)\n", bare, "[a](Folder/Note.md)\n"],
    ["[a](<./a\\>b.md>)\n", angle, "[a](<a%3Eb.md>)\n"],
    ["[a](./Folder/Note(1).md)\n", angle, "[a](<Folder/Note(1).md>)\n"],
    ["[a](./Folder/Note\\(1\\).md)\n", angle, "[a](<Folder/Note(1).md>)\n"],
    ["[a](./Folder/Note(1).md)\n", bare, "[a](Folder/Note%281%29.md)\n"],
    ['[a](./Folder/Note.md "title")\n', angle, '[a](<Folder/Note.md> "title")\n'],
  ])("rewrites the destination of %j", (source, config, output) => {
    expect(formatted(source, config, { path: "Doc.md", workspace })).toBe(output);
  });
});

describe("links/valid definitions", () => {
  const config = only({ "links/valid": "error" });
  it("treats references without a definition as plain text", () => {
    const source = "[text][missing] and ![alt][gone] and [shortcut]\n";
    expect(parse(source, "github").tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: source.trimEnd() }],
    });
    expect(lint(source, { config })).toEqual([]);
    expect(lint("[text][known]\n\n[known]: https://example.test\n", { config })).toEqual([]);
    expect(lint("[text][known]\n\n[known]: missing.md\n", { config, workspace })).toMatchObject([
      { message: "Missing local target: missing.md.", line: 3 },
    ]);
  });
  const workspace = createWorkspace({ "document.md": "" });
});

describe("dialect markers", () => {
  it("leaves unknown GitHub alert types and known Obsidian types alone", () => {
    const github = only({ "github/alert-marker": "warn" }, "github");
    expect(formatted("> [!foo]\n> Text.\n", github)).toBe("> [!foo]\n> Text.\n");
    expect(formatted("> [!tip]\n> Text.\n", github)).toBe("> [!TIP]\n> Text.\n");
    const obsidian = only({ "obsidian/callout-marker": "warn" }, "obsidian");
    expect(formatted("> [!Custom-Type]- Title\n", obsidian)).toBe("> [!custom-type]- Title\n");
    expect(formatted("> [!note]\n", obsidian)).toBe("> [!note]\n");
  });
  it.each(["github", "forgejo", "gitea"] as const)(
    "changes only markers that GitHub shows as alerts on %s",
    (dialect) => {
      // GitHub shows these markers as text, whose letters would change (issue #334).
      const github = only({ "github/alert-marker": "warn" }, dialect);
      for (const source of [
        "> > [!note]\n> > Read.\n",
        "- > [!note]\n  > Read.\n",
        "> [!note] Read this.\n",
        "> [!note]\n",
        "> [!note]   \n",
        "Text.\n\n> Quote.\n>\n> > [!note]\n> > Read.\n",
      ])
        expect(formatted(source, github)).toBe(source);
      // A marker alone on its line, with content below it in the quote.
      for (const [source, output] of [
        ["> [!note]\n> Read.\n", "> [!NOTE]\n> Read.\n"],
        ["> [!tip] \t\n> Read.\n", "> [!TIP] \t\n> Read.\n"],
        ["> [!note]\n>\n> Read.\n", "> [!NOTE]\n>\n> Read.\n"],
        ["> [!note]\n> - One.\n", "> [!NOTE]\n> - One.\n"],
      ] as const)
        expect(formatted(source, github)).toBe(output);
    },
  );
  it("still lowercases Obsidian callouts in nested quotes and with titles", () => {
    const obsidian = only({ "obsidian/callout-marker": "warn" }, "obsidian");
    expect(formatted("> > [!NOTE] Title\n> > Body.\n", obsidian)).toBe(
      "> > [!note] Title\n> > Body.\n",
    );
  });
  it("leaves a marker that Obsidian shows as text, after more than one space", () => {
    // Obsidian reads a callout only where its marker follows the quote's `>`
    // and at most one space (issue #360).
    const obsidian = only({ "obsidian/callout-marker": "warn" }, "obsidian");
    for (const [source, output] of [
      [">[!NOTE] T\n", ">[!note] T\n"],
      ["> [!NOTE] T\n", "> [!note] T\n"],
      [">> [!NOTE] T\n", ">> [!note] T\n"],
      ["- > [!NOTE] T\n", "- > [!note] T\n"],
      [">  [!NOTE] T\n", ">  [!NOTE] T\n"],
      [">   [!NOTE]\n> body\n", ">   [!NOTE]\n> body\n"],
      [">>  [!Important] signal\n", ">>  [!Important] signal\n"],
      ["> >  [!NOTE] T\n", "> >  [!NOTE] T\n"],
    ] as const)
      expect(formatted(source, obsidian), JSON.stringify(source)).toBe(output);
  });
  it("applies GitHub alert casing to Forgejo documents only among GFM dialects", () => {
    const rules: Record<string, RuleSetting> = { "github/alert-marker": "warn" };
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "forgejo"))).toBe("> [!TIP]\n> Text.\n");
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "commonmark"))).toBe("> [!tip]\n> Text.\n");
  });
  it("applies GitHub alert casing to Gitea documents", () => {
    const rules: Record<string, RuleSetting> = { "github/alert-marker": "warn" };
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "gitea"))).toBe("> [!TIP]\n> Text.\n");
  });
  it("provides a Gitea preset with the GitHub rules", () => {
    expect(resolveConfig({ config: { extends: ["gitea"] } })).toMatchObject({
      dialect: "gitea",
      rules: {
        "github/task-marker": "warn",
        "github/alert-marker": "warn",
        "style/table": "warn",
        "forgejo/heading-id": "error",
      },
    });
    expect(canonicalDialect("gitea")).toBe("gitea");
  });
  it("provides Forgejo and Codeberg presets and accepts aliases in overrides", () => {
    const rules = {
      "github/task-marker": "warn",
      "github/alert-marker": "warn",
      "style/table": "warn",
      "forgejo/heading-id": "error",
    };
    expect(resolveConfig({ config: { extends: ["forgejo"] } })).toMatchObject({
      dialect: "forgejo",
      rules,
    });
    expect(resolveConfig({ config: { extends: ["codeberg"] } })).toMatchObject({
      dialect: "forgejo",
      rules,
    });
    expect(resolveConfig({ config: { dialect: "codeberg" } }).dialect).toBe("forgejo");
    expect(
      resolveConfig({
        config: { overrides: [{ files: ["forge/**"], dialect: "codeberg" }] },
        path: "forge/a.md",
      }).dialect,
    ).toBe("forgejo");
    expect(canonicalDialect("codeberg")).toBe("forgejo");
    expect(canonicalDialect("github")).toBe("github");
  });
});

describe("forgejo/heading-id", () => {
  const forges = ["forgejo", "gitea"] as const;
  const findings = (source: string, dialect: Dialect) =>
    lint(source, { config: only({ "forgejo/heading-id": "error" }, dialect) });
  // Rendered on local instances: Forgejo 16.0.5 and Gitea 1.21.11 showed an
  // empty page for each of these documents, Gitea 1.23.8 and 1.25.5 showed the
  // raw source, and Gitea 1.27.3 and 28.0.0 a heading with an empty id.
  it.each(["{id=5}", "{id=true}", "{id=null}", "{id=[1]}", "{id=-1.5e3}", "{#x id=5}"])(
    "reports a heading whose id is %s",
    (block) => {
      for (const dialect of forges) {
        const atx = findings(`# Before\n\n## Version ${block}\n\n## After\n`, dialect);
        expect(atx).toMatchObject([
          { rule: "forgejo/heading-id", severity: "error", line: 3, column: 12 },
        ]);
        expect(atx[0]!.message).toContain("not text");
        expect(atx[0]!.end).toBe(atx[0]!.start + block.length);
        expect(findings(`Version ${block}\n---\n`, dialect)).toHaveLength(1);
        expect(findings(`## Version ## ${block}\n`, dialect)).toHaveLength(1);
        // Gitea before 1.26 also reads a block followed by a closing sequence, and
        // rendered nothing for this one; the range ends with the block.
        const closed = findings(`## Version ${block} ##\n`, dialect);
        expect(closed).toHaveLength(1);
        expect(closed[0]!.end).toBe(closed[0]!.start + block.length);
        const quoted = findings(`> Version ${block}  \n> ---\n`, dialect);
        expect(quoted).toMatchObject([{ line: 1, column: 11 }]);
        expect(quoted[0]!.end).toBe(quoted[0]!.start + block.length);
      }
      for (const dialect of ["github", "commonmark", "obsidian"] as const)
        expect(findings(`## Version ${block}\n`, dialect)).toEqual([]);
    },
  );
  it.each([
    '{id="5"}',
    "{id=word}",
    "{#5}",
    "{.c data-level=5}",
    "{id=5} text",
    "\\{id=5}",
    "{#}",
    '{id=""}',
  ])("does not report %s", (block) => {
    for (const dialect of forges) expect(findings(`## Version ${block}\n`, dialect)).toEqual([]);
  });
  it("is an error in the Forgejo and Gitea presets and reports nothing elsewhere", () => {
    const source = "## Version {id=5}\n";
    for (const preset of ["forgejo", "codeberg", "gitea"]) {
      const result = lint(source, { config: { extends: [preset] } });
      expect(result.map((item) => `${item.rule}:${item.severity}`)).toEqual([
        "forgejo/heading-id:error",
      ]);
    }
    expect(lint(source, { config: { extends: ["github"] } })).toEqual([]);
    // Formatting leaves the heading alone and reports the problem.
    const result = format(source, { config: { extends: ["recommended", "forgejo"] } });
    expect(result.output).toBe(source);
    expect(result.diagnostics.map((item) => item.rule)).toEqual(["forgejo/heading-id"]);
  });
});

describe("engine edits and fingerprints", () => {
  it("applies identical edits from two rules once", () => {
    expect(
      applyEdits("abc", [
        { start: 0, end: 1, text: "x" },
        { start: 0, end: 1, text: "x" },
      ]),
    ).toBe("xbc");
    const rule = {
      kind: "style",
      description: "Use underscores for the first emphasis",
      check: ({ document }: { document: { source: string } }) =>
        document.source.startsWith("*")
          ? [
              { start: 0, message: "Same", edit: { start: 0, end: 1, text: "_" } },
              { start: 2, message: "Same", edit: { start: 2, end: 3, text: "_" } },
            ]
          : [],
    } as const;
    const plugin: Plugin = { name: "twin", rules: { one: rule, two: rule } };
    const result = format("*a*\n", {
      config: only({ "twin/one": "warn", "twin/two": "warn" }),
      plugins: [plugin],
    });
    expect(result.output).toBe("_a_\n");
    expect(result.diagnostics).toEqual([]);
  });
  it("distinguishes embeds from links and canonicalizes their targets", () => {
    const workspace = createWorkspace({ "Doc.md": "", "Note.md": "" }, { dialect: "obsidian" });
    const print = (source: string) =>
      semanticFingerprint(parse(source, "obsidian", "Doc.md"), workspace);
    expect(print("![[Note]]\n")).toBe(print("![[Note.md]]\n"));
    expect(print("![[Note|300]]\n")).not.toBe(print("![[Note]]\n"));
    expect(print("![[Note]]\n")).not.toBe(print("[[Note]]\n"));
    expect(print("![[Note]]\n")).toContain('"type":"embed"');
  });
});

describe("suppression directives at the end of a document", () => {
  const config = only({ "style/emphasis": "warn" });
  it("suppresses a final line without a trailing newline", () => {
    expect(formatted("<!-- mdtools-disable-next-line style/emphasis -->\n*keep*", config)).toBe(
      "<!-- mdtools-disable-next-line style/emphasis -->\n*keep*",
    );
  });
  it("ignores a next-line directive that has no next line", () => {
    expect(formatted("*change*\n<!-- mdtools-disable-next-line style/emphasis -->", config)).toBe(
      "_change_\n<!-- mdtools-disable-next-line style/emphasis -->",
    );
  });
});

describe("next-line suppression with each line ending", () => {
  const config = only({ "style/emphasis": "warn" });
  const directive = "<!-- mdtools-disable-next-line style/emphasis -->";
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("suppresses exactly the next line with %s", (_, newline) => {
    const source = [directive, "*keep*", "*change*", ""].join(newline);
    expect(formatted(source, config)).toBe(source.replace("*change*", "_change_"));
    const at = source.indexOf("*change*");
    expect(lint(source, { config }).map((item) => item.start)).toEqual([at, at + 7]);
    // The directive's own line ending, and the last line without one.
    const last = [directive, "*keep*"].join(newline);
    expect(formatted(last, config)).toBe(last);
    expect(formatted(`*change*${newline}${directive}`, config)).toBe(
      `_change_${newline}${directive}`,
    );
  });
  it.each([
    `${directive}\r\n*keep*\r*change*\n`,
    `${directive}\r*keep*\n*change*\r\n`,
    `${directive}\n*keep*\r\n*change*\r`,
    `${directive}\r\r*change*\n`,
  ])("suppresses one line when line endings are mixed (%j)", (source) => {
    expect(formatted(source, config)).toBe(source.replace("*change*", "_change_"));
  });
});

describe("Obsidian syntax at the end of a document", () => {
  const config = only({ "style/emphasis": "warn", "links/valid": "error" }, "obsidian");
  const workspace = createWorkspace({ "Doc.md": "" }, { dialect: "obsidian" });
  it.each([
    "%%\n*hidden* [[Missing]]\n%%",
    "%%\n*hidden* [[Missing]]\n",
    "%%\n*hidden* [[Missing]]",
  ])("keeps a block comment ending at EOF intact (%j)", (source) => {
    expect(formatted(source, config, { path: "Doc.md", workspace })).toBe(source);
    expect(lint(source, { config, path: "Doc.md", workspace })).toEqual([]);
  });
  it("excludes comment text from text content", () => {
    expect(textContent(parse("Text %% hidden %% more\n", "obsidian").tree)).toBe("Text  more");
    expect(textContent(parse("[[Note|label]] [[Other]]\n", "obsidian").tree)).toBe("label Other");
    expect(textContent(parse("---\n", "obsidian").tree)).toBe("");
  });
});

describe("Obsidian comments that start a line", () => {
  // Obsidian reads a comment as inline wherever a paragraph is open, also at
  // the start of a line below it, and when text follows it on its line (#357).
  const blocks = (source: string) =>
    parse(source, "obsidian").tree.children.map((node) => node.type);
  it("reads such a comment as part of the paragraph", () => {
    expect(blocks("a\n%%c%% d\n")).toEqual(["paragraph"]);
    expect(blocks("a\n%%\nc\n%%\n")).toEqual(["paragraph"]);
    expect(blocks("%%c%% d\nx\n")).toEqual(["paragraph"]);
    const item = parse("- a\n  %%c%% d\n", "obsidian").tree.children[0];
    expect(item?.type === "list" && item.children[0]?.children.map((node) => node.type)).toEqual([
      "paragraph",
    ]);
    expect(textContent(parse("a\n%%c%% d\n", "obsidian").tree)).toBe("a\n d");
  });
  it("still reads a comment that stands on its own lines as a block", () => {
    expect(blocks("a\n\n%%c%%\n\nb\n")).toEqual(["paragraph", "obsidianComment", "paragraph"]);
    expect(blocks("%%\none\n\ntwo\n%%\n")).toEqual(["obsidianComment"]);
    // Blank space, spaces or tabs, may follow the closing `%%`.
    for (const source of ["%%c%%  \n", "%%c%%\t\n", "%%c%% \t \n"])
      expect(blocks(source), JSON.stringify(source)).toEqual(["obsidianComment"]);
  });
  it("reads an empty comment as a comment, as Obsidian hides it", () => {
    expect(textContent(parse("a %%%% b\n", "obsidian").tree)).toBe("a  b");
    expect(textContent(parse("a\n%%%%\nb\n", "obsidian").tree)).toBe("a\n\nb");
    expect(blocks("%%%%\n")).toEqual(["obsidianComment"]);
    // `====` and `[[]]` stay text.
    expect(textContent(parse("a ==== b [[]]\n", "obsidian").tree)).toBe("a ==== b [[]]");
  });
  it("keeps the hard break above such a comment", () => {
    const config = only({ "style/trailing-space": "warn" }, "obsidian");
    for (const source of ["a  \n%%c%% d\n", "- [x] a  \n  %%c%% d\n"])
      expect(formatted(source, config), JSON.stringify(source)).toBe(source);
  });
  it("wraps such a comment with its paragraph", () => {
    const config = only({ "style/wrap": ["warn", { width: 80 }] }, "obsidian");
    const workspace = createWorkspace(
      { "Doc.md": "" },
      { dialect: "obsidian", strictLineBreaks: true },
    );
    expect(formatted("Some text\n%%c%% and more.\n", config, { path: "Doc.md", workspace })).toBe(
      "Some text %%c%% and more.\n",
    );
  });
});
