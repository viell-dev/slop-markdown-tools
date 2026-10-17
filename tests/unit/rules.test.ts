import fc from "fast-check";
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
  resolveConfig,
  semanticFingerprint,
  textContent,
} from "../../src/index.js";
import type { Config, Dialect, Plugin, RuleSetting } from "../../src/index.js";

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
    ["Text\n- 2. Step\n"],
    ["Text\n- -\n"],
    ["> Text\n> - 2) Step\n"],
    ["Text\n- > 3. Step\n"],
    ["[a]: https://example.com\n- -\n"],
    ["[a]: https://example.com\n-\n---\n"],
    // Below a table that ends in a list or quote, the parser reads the next
    // table as a paragraph or heading text, and a blank line would make it a table.
    ["- | a |\n  | - |\n| b |\n| - |\n"],
    ["> - | a |\n>   | - |\n> | b |\n> | - |\n"],
    ["> | a |\n> | - |\n| b |\n| - |\n---\n"],
  ])("leaves %j unchanged", (source) => {
    expect(spaced(source)).toBe(source);
    expect(lint(source, { config: only(rule, "github") })).toEqual([]);
  });
  it.each(dialects)("separates the same blocks in the %s dialect", (dialect) => {
    expect(spaced("> # H\n> Text\n> - A\n- B\n## I\n", dialect)).toBe(
      "> # H\n>\n> Text\n>\n> - A\n\n- B\n\n## I\n",
    );
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
  it("is enabled by no preset and formats nothing when off", () => {
    const source = "# Setup\nInstall the package.\n- Run the command.\n";
    expect(format(source, { config: { extends: ["recommended", "github"] } }).output).toBe(source);
    expect(format(source, { config: only({ "style/block-spacing": "off" }) }).output).toBe(source);
    for (const preset of Object.values(presets))
      expect(Object.keys(preset.rules ?? {})).not.toContain("style/block-spacing");
  });
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
  // text, a run shared with other emphasis, or a `~` between two markers.
  it.each([
    ["*a _b* c_\n", "_", "commonmark"],
    ["*****a***\n", "_", "commonmark"],
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
    // A `_` that can only close, after the emphasis, cannot pair with it.
    ["*a* and file_.\n", "_", "_a_ and file_.\n"],
    ["*a* and 2*3 and *b*\n", "_", "_a_ and 2*3 and _b_\n"],
    // Of emphases sharing a run, those that keep their pairs change.
    ["*a****c***\n", "_", "_a_***c***\n"],
    ["___a_ x_\n", "*", "_*_a_ x*\n"],
    ["___b___ and ***c***\n", "*", "*__b__* and ***c***\n"],
  ] as const)("converts what keeps its pairs in %j", (source, marker, output) => {
    expect(formatted(source, only({ "style/emphasis": ["warn", { marker }] }))).toBe(output);
  });
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
  it("keeps `*` next to an emoji, where `_` could neither open nor close", () => {
    // micromark reads each half of the emoji's surrogate pair as a letter.
    expect(formatted("🙂*a*🙂 and *b*\n", only({ "style/emphasis": "warn" }, "github"))).toBe(
      "🙂*a*🙂 and _b_\n",
    );
  });
  it("leaves emphasis from an Obsidian callout's title into its body alone", () => {
    const rules = only({ "style/emphasis": ["warn", { marker: "*" }] }, "obsidian");
    expect(formatted("> [!note] _Title\n> body_ and _b_\n", rules)).toBe(
      "> [!note] _Title\n> body_ and *b*\n",
    );
    expect(formatted("> [!note] _Title_\n> _body_\n", rules)).toBe("> [!note] *Title*\n> *body*\n");
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
    // Joining would move text into a callout's title.
    "> [!note] Title `code\n> span` here.\n",
  ])("leaves %j unjoined in Obsidian", (source) => {
    expect(formatted(source, only(rule, "obsidian"))).toBe(source);
    expect(formatted(source, only(rule, "github"))).toBe(source.replace(/\n(?:> )?(?=\S+`)/, " "));
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
    for (const dialect of dialects) expect(formatted(source, only(rule, dialect))).toBe(output);
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
  it("finds heading lines in time proportional to the document", () => {
    // Every heading used to be searched for a `{` up to the end of the document.
    const source = `${"## Heading\n\n".repeat(20000)}*x*\n`;
    const start = performance.now();
    expect(formatted(source, only(markers, "forgejo"))).toBe(source.replace("*x*", "_x_"));
    expect(performance.now() - start).toBeLessThan(10000);
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
  it("checks a heading with many links in time proportional to its length", () => {
    const source = `## ${"[x](y.md) ".repeat(10000)}{#h}\n`;
    const workspace = createWorkspace({ "Doc.md": source, "y.md": "" });
    const start = performance.now();
    const result = format(source, {
      config: only({ "links/path": ["warn", { style: "relative", leadingDot: true }] }, "forgejo"),
      path: "Doc.md",
      workspace,
    });
    expect(result.output).toBe(source.replaceAll("(y.md)", "(./y.md)"));
    expect(performance.now() - start).toBeLessThan(10000);
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
    expect(resolveConfig({ extends: ["gitea"] })).toMatchObject({
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
    expect(resolveConfig({ extends: ["forgejo"] })).toMatchObject({ dialect: "forgejo", rules });
    expect(resolveConfig({ extends: ["codeberg"] })).toMatchObject({ dialect: "forgejo", rules });
    expect(resolveConfig({ dialect: "codeberg" }).dialect).toBe("forgejo");
    expect(
      resolveConfig({ overrides: [{ files: ["forge/**"], dialect: "codeberg" }] }, "forge/a.md")
        .dialect,
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
