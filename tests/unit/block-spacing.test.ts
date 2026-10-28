import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dialects, format, lint, parse, presets, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";
import { only, formatted } from "../support/rules.js";
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
  describe("standalone Obsidian comment boundaries (#357)", () => {
    it.each([
      "%%c%%\nalpha\n---\n",
      "%%c%%\nalpha\nbeta\n---\n",
      "%%c%%\nalpha\nbeta\n===\n",
      "%%c%%\n# alpha\n",
      "%%c%%\n- alpha\n",
      "%%one\ntwo%%\nalpha\nbeta\n---\n",
      "%%one\n\ntwo%%\nalpha\nbeta\n---\n",
      "%%one%%\n%%two%%\nalpha\nbeta\n---\n",
      "%%%%\nalpha\nbeta\n---\n",
    ])("keeps the following boundary in %j", (source) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const mark of ["", "\uFEFF"]) {
          const input = mark + source.replaceAll("\n", newline);
          expect(spaced(input, "obsidian")).toBe(input);
        }
    });
    it("still separates a preceding heading", () => {
      expect(spaced("# heading\n%%c%%\nalpha\nbeta\n---\n", "obsidian")).toBe(
        "# heading\n\n%%c%%\nalpha\nbeta\n---\n",
      );
    });
    it.each(["%%c%%\n\nalpha\nbeta\n---\n", "%%c%%\n\n# alpha\n", "%%c%%\n\n- alpha\n"])(
      "keeps an existing blank in %j",
      (source) => {
        expect(spaced(source, "obsidian")).toBe(source);
      },
    );
    it("allows inline style edits in the following block", () => {
      const source = "%%c%%\n__alpha__\nbeta\n---\n";
      expect(
        formatted(
          source,
          only({ "style/block-spacing": "warn", "style/strong": "warn" }, "obsidian"),
        ),
      ).toBe("%%c%%\n**alpha**\nbeta\n---\n");
    });
    it("retains ordinary heading spacing and the other dialects", () => {
      expect(spaced("alpha\n# heading\n", "obsidian")).toBe("alpha\n\n# heading\n");
      for (const dialect of ["commonmark", "github"] as const)
        expect(spaced("%%c%%\n# heading\n", dialect)).toBe("%%c%%\n\n# heading\n");
    });
  });
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
    // Continuation lines, and blocks that are neither headings, lists, closed
    // fences, nor tables.
    ["Text\n2. Two\n"],
    ["- A\nlazy\n"],
    ["Text\n> Quote\n"],
    ["Text\n$$\nx\n$$\n"],
    // Comments, callouts, and lines the parser reads differently below text.
    ["<!-- note -->\n# H\n"],
    ["<!-- mdrefine-disable-next-line style/emphasis -->\n- *A*\n"],
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
        ? "> # H\n> Text\n> - A\n- B\n\n## I\n"
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
  it.each(dialects.filter((dialect) => dialect !== "vitepress"))(
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
    ["a <b>b</b>\n\nc\n1. d\n", "a <b>b</b>\n\nc\n1. d\n"],
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
      "<!-- mdrefine-disable style/block-spacing -->\n\n# H\nText\n\n<!-- mdrefine-enable style/block-spacing -->\n\n# I\nText\n";
    expect(formatted(region, config)).toBe(region.replace("# I\n", "# I\n\n"));
    const next = "<!-- mdrefine-disable-next-line style/block-spacing -->\n# H\nText\n";
    expect(formatted(next, config)).toBe(next);
    expect(lint(next, { config })).toEqual([]);
    // A blank line would move the target of a directive for another rule.
    const other = "<!-- mdrefine-disable-next-line style/emphasis -->\n# *Keep*\nText *change*\n";
    expect(formatted(other, config)).toBe(
      "<!-- mdrefine-disable-next-line style/emphasis -->\n# *Keep*\n\nText _change_\n",
    );
    const inline = "Text <!-- mdrefine-disable-next-line style/emphasis -->\n# *Keep*\n";
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
  describe("fenced code blocks and tables (#684, #697)", () => {
    const newlines = ["\n", "\r\n", "\r"];
    it.each([
      // A closed fence, in either marker, with indentation, or a longer closer.
      ["Text\n```js\ncode\n```\nMore\n", "Text\n\n```js\ncode\n```\n\nMore\n"],
      ["Text\n~~~\ncode\n~~~\nMore\n", "Text\n\n~~~\ncode\n~~~\n\nMore\n"],
      ["Text\n  ```\n  code\n  ```\nMore\n", "Text\n\n  ```\n  code\n  ```\n\nMore\n"],
      ["Text\n```\ncode\n````\nMore\n", "Text\n\n```\ncode\n````\n\nMore\n"],
      ["```\na\n```\n~~~\nb\n~~~\n", "```\na\n```\n\n~~~\nb\n~~~\n"],
      ["    code\n```\nb\n```\n", "    code\n\n```\nb\n```\n"],
      ["> Quote\n```\ncode\n```\n> Quote\n", "> Quote\n\n```\ncode\n```\n\n> Quote\n"],
      ["$$\nx\n$$\n```\ncode\n```\n", "$$\nx\n$$\n\n```\ncode\n```\n"],
      [
        "[a]: https://example.com\n```\ncode\n```\n",
        "[a]: https://example.com\n\n```\ncode\n```\n",
      ],
      ["```\ncode\n```\n^id\n", "```\ncode\n```\n\n^id\n"],
      // In a block quote at any depth, with the quote's markers.
      ["> Text\n> ```\n> code\n> ```\n> More\n", "> Text\n>\n> ```\n> code\n> ```\n>\n> More\n"],
      ["> > Text\n> > ```\n> > code\n> > ```\n", "> > Text\n> >\n> > ```\n> > code\n> > ```\n"],
      // A table directly below text that the parser reads as a separate paragraph.
      ["Text\n| a | b |\n| - | - |\n", "Text\n\n| a | b |\n| - | - |\n"],
      ["Two\nlines\n| a | b |\n| - | - |\n", "Two\nlines\n\n| a | b |\n| - | - |\n"],
      ["> Text\n> | a |\n> | - |\n> > Quote\n", "> Text\n>\n> | a |\n> | - |\n>\n> > Quote\n"],
      // Blocks that end a table, and blocks whose end a table can start below.
      ["| a | b |\n| - | - |\n> Quote\n", "| a | b |\n| - | - |\n\n> Quote\n"],
      ["| a | b |\n| - | - |\n```\ncode\n```\n", "| a | b |\n| - | - |\n\n```\ncode\n```\n"],
      ["| a | b |\n| - | - |\n***\n", "| a | b |\n| - | - |\n\n***\n"],
      ["| a | b |\n| - | - |\n<div>x</div>\n", "| a | b |\n| - | - |\n\n<div>x</div>\n"],
      ["| a | b |\n| - | - |\n<!-- c -->\n", "| a | b |\n| - | - |\n\n<!-- c -->\n"],
      ["```\ncode\n```\n| a | b |\n| - | - |\n", "```\ncode\n```\n\n| a | b |\n| - | - |\n"],
      ["***\n| a | b |\n| - | - |\n", "***\n\n| a | b |\n| - | - |\n"],
      ["<pre>\nx\n</pre>\n| a | b |\n| - | - |\n", "<pre>\nx\n</pre>\n\n| a | b |\n| - | - |\n"],
      ["    code\n| a | b |\n| - | - |\n", "    code\n\n| a | b |\n| - | - |\n"],
    ])("separates %j", (source, output) => {
      for (const newline of newlines)
        expect(spaced(source.replaceAll("\n", newline))).toBe(output.replaceAll("\n", newline));
    });
    it.each([
      // Do not imitate MD031's `list_items: true`: a blank line between the
      // blocks of a tight list item makes the list loose.
      ["- Item\n  ```\n  code\n  ```\n  More\n- Next\n"],
      ["1. Item\n   | a |\n   | - |\n   > Quote\n"],
      ["[^1]: Note\n    ```\n    code\n    ```\n    More\n"],
      // Do not imitate a separator between a table and text below it, which
      // GFM reads as another row, nor before other lines that some renderer
      // reads as one: Forgejo and Gitea take in indented code, and GitHub
      // shows a definition directly above a table as text.
      ["| a | b |\n| - | - |\nText\n"],
      ["| a | b |\n| - | - |\n    indented\n"],
      ["| a | b |\n| - | - |\n[^1]: Note\n"],
      ["| a | b |\n| - | - |\n$$\nx\n$$\n"],
      ["[a]: https://example.com\nText\n| a | b |\n| - | - |\n"],
      ["[a]: https://example.com\n[b]: https://example.org\nText\n| a | b |\n| - | - |\n"],
      ["[a]: https://example.com\n| a | b |\n| - | - |\n"],
      ["> [a]: https://example.com\n> Text\n> | a |\n> | - |\n"],
      // A container or math above a table, whose text renderers may continue.
      ["> Quote\n| a | b |\n| - | - |\n"],
      ["[^1]: Note\n| a | b |\n| - | - |\n"],
      ["$$\nx\n$$\n| a | b |\n| - | - |\n"],
      // A fence without its closing fence keeps its existing handling.
      ["Text\n```\nunclosed\n"],
      ["> Text\n> ```\n> unclosed\n"],
      // Comments, directives, callout titles, and front matter.
      ["<!-- note -->\n```\ncode\n```\n"],
      ["<!-- mdrefine-disable-next-line style/emphasis -->\n| *a* |\n| - |\n"],
      ["> [!NOTE]\n> ```\n> code\n> ```\n"],
      ["---\ntitle: T\n---\n```\ncode\n```\n"],
      ["+++\ntitle = 'T'\n+++\n| a |\n| - |\n"],
      // Existing blank lines, also lines of quote markers, stay as they are.
      ["Text\n\n```\ncode\n```\n\n\nMore\n"],
      ["> Text\n>\n> | a |\n> | - |\n"],
    ])("leaves %j unchanged", (source) => {
      for (const newline of newlines) {
        const input = source.replaceAll("\n", newline);
        expect(spaced(input)).toBe(input);
        expect(lint(input, { config: only(rule, "github") })).toEqual([]);
      }
    });
    it("keeps a tight list item tight", () => {
      const source = "- Item\n  ```\n  code\n  ```\n  More\n- Next\n";
      const list = parse(spaced(source), "github").tree.children[0];
      expect(list).toMatchObject({ type: "list", spread: false });
    });
    it("reports each place at the fence or table that needs the blank line", () => {
      expect(
        lint("Text\n```\ncode\n```\n| a |\n| - |\n", { config: only(rule, "github") }),
      ).toEqual([
        {
          rule: "style/block-spacing",
          severity: "warn",
          line: 2,
          column: 1,
          start: 5,
          message: "Add a blank line before the fenced code block.",
          edit: { start: 4, end: 5, text: "\n\n" },
        },
        {
          rule: "style/block-spacing",
          severity: "warn",
          line: 4,
          column: 4,
          start: 17,
          message: "Add a blank line after the fenced code block.",
          edit: { start: 17, end: 18, text: "\n\n" },
        },
      ]);
      expect(lint("| a |\n| - |\n> Quote\n", { config: only(rule, "github") })).toEqual([
        {
          rule: "style/block-spacing",
          severity: "warn",
          line: 2,
          column: 6,
          start: 11,
          message: "Add a blank line after the table.",
          edit: { start: 11, end: 12, text: "\n\n" },
        },
      ]);
      expect(lint("Text\n| a |\n| - |\n", { config: only(rule, "github") })).toMatchObject([
        { line: 2, column: 1, message: "Add a blank line before the table." },
      ]);
    });
    it.each(dialects)("follows the %s parser's reading of tables", (dialect) => {
      const fences = "Text\n```\ncode\n```\nMore\n";
      const table = "Text\n| a | b |\n| - | - |\n> Quote\n";
      if (dialect === "obsidian") {
        // Both views keep text with an adjacent fence or table; the rule
        // reports the place without changing it.
        expect(spaced(fences, dialect)).toBe(fences);
        expect(spaced(table, dialect)).toBe("Text\n| a | b |\n| - | - |\n\n> Quote\n");
        expect(
          lint(fences, { config: only(rule, dialect) }).map(({ line, message }) => [line, message]),
        ).toEqual([
          [
            2,
            "Left as written to preserve Obsidian rendering: Add a blank line before the fenced code block.",
          ],
          [
            4,
            "Left as written to preserve Obsidian rendering: Add a blank line after the fenced code block.",
          ],
        ]);
      } else {
        expect(spaced(fences, dialect)).toBe("Text\n\n```\ncode\n```\n\nMore\n");
        // CommonMark has no tables: its text continues to the quote.
        expect(spaced(table, dialect)).toBe(
          dialect === "commonmark" ? table : "Text\n\n| a | b |\n| - | - |\n\n> Quote\n",
        );
      }
    });
    it.each(["forgejo", "gitea"] as const)(
      "keeps a table in the definition description above it in the %s dialect",
      (dialect) => {
        for (const source of [
          "Term\n: Description\n| a |\n| - |\n",
          "Term\n: Description\nmore\n| a |\n| - |\n",
        ])
          for (const newline of newlines) {
            const input = source.replaceAll("\n", newline);
            expect(spaced(input, dialect)).toBe(input);
            expect(lint(input, { config: only(rule, dialect) })).toEqual([]);
          }
        expect(spaced("Term\n: Description\n```\ncode\n```\n", dialect)).toBe(
          "Term\n: Description\n\n```\ncode\n```\n",
        );
        expect(spaced("Term\n: Description\n| a |\n| - |\n")).toBe(
          "Term\n: Description\n\n| a |\n| - |\n",
        );
      },
    );
    it("keeps Obsidian's readings of tilde fences and lines below a table", () => {
      for (const source of [
        "Text\n~~~ a`b\ncode\n~~~\nMore\n",
        "| a | b |\n| - | - |\n~~~ a`b\ncode\n~~~\n",
        "| a | b |\n| - | - |\n> c | d\n",
        "| a | b |\n| - | - |\n| c | d |\n---\n",
      ])
        expect(spaced(source, "obsidian")).toBe(source);
      expect(spaced("| a | b |\n| - | - |\n~~~ a`b\ncode\n~~~\n")).toBe(
        "| a | b |\n| - | - |\n\n~~~ a`b\ncode\n~~~\n",
      );
      expect(spaced("| a | b |\n| - | - |\n> c | d\n")).toBe("| a | b |\n| - | - |\n\n> c | d\n");
    });
    it.each([
      "```\ncode\n```\n| a | b |\n| - | - |\n",
      "***\n| a | b |\n| - | - |\n",
      "<pre>\nx\n</pre>\n| a | b |\n| - | - |\n",
      "    code\n| a | b |\n| - | - |\n",
      "Text\n| a | b |\n| - | - |\n",
    ])("keeps the block above an Obsidian table in %j", (source) => {
      // Live Preview shows the rows of a table directly below another block as
      // text, where Reading view shows a table; a blank line would make them a
      // table in Live Preview too.
      for (const newline of newlines) {
        const input = source.replaceAll("\n", newline);
        expect(spaced(input, "obsidian")).toBe(input);
        expect(lint(input, { config: only(rule, "obsidian") })).toEqual([]);
        expect(spaced(input)).toBe(input.replace(`${newline}|`, `${newline}${newline}|`));
      }
    });
    it("separates the fences of a VitePress code group", () => {
      const source = "::: code-group\n```js [a.js]\na\n```\n```ts [b.ts]\nb\n```\n:::\n";
      expect(spaced(source, "vitepress")).toBe(
        "::: code-group\n```js [a.js]\na\n```\n\n```ts [b.ts]\nb\n```\n:::\n",
      );
    });
    it("separates them under recommended and leaves them when the rule is off", () => {
      const source = "Text\n```js\ncode\n```\n| a | b |\n| - | - |\n> Quote\n";
      expect(formatted(source, { extends: ["recommended"], dialect: "github" })).toBe(
        "Text\n\n```js\ncode\n```\n\n| a   | b   |\n| --- | --- |\n\n> Quote\n",
      );
      expect(formatted(source, only({ "style/block-spacing": "off" }, "github"))).toBe(source);
    });
    it("keeps the meaning of randomly assembled fences and tables", () => {
      const blocks = fc.constantFrom(
        "Text.",
        "Two\nlines.",
        "```\ncode\n```",
        "~~~js\ncode\n~~~",
        "  ```\n  code\n  ```",
        "~~~ a`b\ncode\n~~~",
        "```\nunclosed",
        "    code",
        "| a | b |\n| - | - |",
        "| a | b |\n| - | - |\n| c | d |",
        "a | b\n--|--",
        "> Quoted",
        "> c | d",
        "***",
        "---",
        "<div>x</div>",
        "<!-- comment -->",
        "$$\nx\n$$",
        "[a]: https://example.com",
        "[^1]: Note.",
        "Term\n: Description",
        "- Item",
        "# Heading",
        "lazy",
      );
      const containers = fc.constantFrom(["", ""], ["> ", "> "], ["- ", "  "], ["> > ", "> > "]);
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
        { numRuns: 300, seed: 20261028 },
      );
    });
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
