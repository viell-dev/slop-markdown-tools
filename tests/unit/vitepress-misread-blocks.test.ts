import { describe, expect, it } from "vitest";
import { format, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect, RuleSetting } from "../../src/index.js";
import { readVitePress } from "../../src/syntax/vitepress/reader.js";

const crlf = (source: string) => source.replaceAll("\n", "\r\n");
const preset = (dialect: Dialect): Config => ({
  extends: ["recommended", ...(dialect === "commonmark" || dialect === "gitea" ? [] : [dialect])],
  dialect,
});
const only = (dialect: Dialect, rules: Record<string, RuleSetting>): Config => ({
  extends: [],
  dialect,
  rules,
});
/** Formats `source`, checking that no edit is refused, the output converges and the reading holds. */
function checked(source: string, config: Config) {
  const result = format(source, { config });
  expect(
    result.diagnostics.filter(({ rule }) => rule.startsWith("engine/")),
    JSON.stringify(source),
  ).toEqual([]);
  expect(format(result.output, { config }).output).toBe(result.output);
  const dialect = config.dialect!;
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  return result.output;
}
/** Checks `source` and its CRLF form against the expected output. */
function formats(source: string, config: Config, expected: string) {
  expect(checked(source, config), JSON.stringify(source)).toBe(expected);
  expect(checked(crlf(source), config), JSON.stringify(crlf(source))).toBe(crlf(expected));
}
/** The containers around each table that markdown-it reads, as `"list_item"` or `""`. */
function markdownItTables(source: string): string[] {
  const open: string[] = [];
  const tables: string[] = [];
  for (const token of readVitePress(source, {})) {
    if (token.type === "table_open") tables.push(open.join(" "));
    else if (token.nesting === 1) open.push(token.type.replace(/_open$/, ""));
    else if (token.nesting === -1) open.pop();
  }
  return tables.map((path) => path.replace(/(?:bullet|ordered)_list ?/g, "").trim());
}

// markdown-it, which VitePress uses, tries a table before a list, so a list
// item whose first line holds a pipe, above a delimiter row indented less than
// four columns, is a table whose first cell holds the marker (#763).
describe("a list item's pipe line above a delimiter row in VitePress (#763)", () => {
  // Each source, with the containers of the table that markdown-it reads.
  const placements = [
    ["* a | b\n  --|--\n", ""],
    ["+ a | b\n  --|--\n+ c\n", ""],
    ["- a | b\n  --|--\n  | c | d |\n", ""],
    ["1) a | b\n   --|--\n", ""],
    ["- outer\n  * a | b\n    --|--\n", "list_item"],
    ["> * a | b\n>   --|--\n", "blockquote"],
    ["::: tip\n* a | b\n  --|--\n:::\n", "container_tip"],
  ] as const;
  const misread = placements.map(([source]) => source);

  it("is a table outside the item for markdown-it", () => {
    for (const [source, containers] of placements)
      expect(markdownItTables(source), source).toEqual([containers]);
  });

  it.each([
    ["recommended", preset("vitepress")],
    ["style/list-marker", only("vitepress", { "style/list-marker": "warn" })],
    ["style/list-indent", only("vitepress", { "style/list-indent": "warn" })],
    ["style/table", only("vitepress", { "style/table": "warn" })],
    ["style/wrap", only("vitepress", { "style/wrap": ["warn", { width: 20 }] })],
    ["style/lazy-continuation", only("vitepress", { "style/lazy-continuation": "warn" })],
  ])("stays as written with %s", (_name, config) => {
    for (const source of misread) formats(source, config, source);
  });

  it("formats the text around it", () => {
    const paragraph =
      "A long paragraph that has many words and keeps going far past the eighty column limit.\n";
    formats(
      `- a | b\n  --|--\n\n${paragraph}`,
      preset("vitepress"),
      "- a | b\n  --|--\n\nA long paragraph that has many words and keeps going far past the eighty column\nlimit.\n",
    );
  });

  it("keeps a list beside it that another marker would join to it", () => {
    // `- x` would continue the list, and markdown-it would then read the table
    // inside its second item.
    for (const source of ["+ x\n- a | b\n  --|--\n", "1. x\n2) a | b\n   --|--\n"]) {
      const output = checked(source, preset("vitepress"));
      expect(output.replaceAll("\n\n", "\n")).toBe(source);
    }
  });

  it("keeps the marker and indentation where markdown-it reads the item's table", () => {
    // With less indentation, the delimiter row would make a table outside the list.
    const source = "*   a | b\n    :-|-:\n    c | d\n";
    expect(markdownItTables(source)).toEqual(["list_item"]);
    expect(markdownItTables("* a | b\n  :-|-:\n  c | d\n")).toEqual([""]);
    for (const rule of ["style/list-marker", "style/list-indent"])
      formats(source, only("vitepress", { [rule]: "warn" }), source);
    formats(source, preset("vitepress"), "*   a   | b   |\n    :-- | --: |\n    c   | d   |\n");
  });

  it.each(["github", "forgejo", "gitea", "obsidian", "commonmark"] as const)(
    "is formatted as the list that %s reads",
    (dialect) => {
      const config = preset(dialect);
      const table = dialect !== "commonmark";
      formats(
        "* a | b\n  --|--\n",
        config,
        table ? "- a   | b   |\n  --- | --- |\n" : "- a | b --|--\n",
      );
      formats(
        "*   a | b\n    :-|-:\n    c | d\n",
        config,
        table ? "- a   | b   |\n  :-- | --: |\n  c   | d   |\n" : "- a | b :-|-: c | d\n",
      );
    },
  );

  it("formats ordinary lists and tables in VitePress", () => {
    const config = preset("vitepress");
    formats("* one\n* two\n\n+ three\n", config, "- one\n- two\n\n* three\n");
    formats("*   item\n    more\n", config, "- item more\n");
    formats("a|b\n-|-\nc|d\n", config, "| a   | b   |\n| --- | --- |\n| c   | d   |\n");
    formats("- x\n\n  a | b\n  --|--\n", config, "- x\n\n  | a   | b   |\n  | --- | --- |\n");
    formats("- | a | b |\n  |--|--|\n", config, "- | a   | b   |\n  | --- | --- |\n");
  });
});

// The component plugin reads a component line that interrupts a paragraph as
// a block, and the paragraph ends there. Below it, a line without the item's
// indentation is a paragraph after the list, where mdast reads lazy text of
// the item's paragraph (#769).
describe("a lazy line below a component line in a VitePress list item (#769)", () => {
  const sources = [
    "- Alpha words\n    <custom-tag/>\nmore words after\n",
    "- Alpha words\n\t<custom-tag/>\nmore words after\n",
    "- Alpha words\n  <custom-tag></custom-tag>\nmore words after\n",
    "> - Alpha words\n>   <MyComponent />\n> more words after\n",
    "Alpha words\n<MyComponent />\nmore words after\n",
  ];

  it("ends the paragraph at the component for markdown-it", () => {
    const tokens = readVitePress(sources[0]!, {});
    expect(tokens.map((token) => token.type)).toContain("html_inline");
    expect(tokens.find((token) => token.type === "bullet_list_close")).toBeDefined();
    expect(tokens.at(-2)).toMatchObject({ type: "inline", content: "more words after" });
    expect(tokens.at(-2)!.level).toBe(1);
  });

  it.each([
    ["recommended", preset("vitepress")],
    ["style/lazy-continuation", only("vitepress", { "style/lazy-continuation": "warn" })],
    ["style/wrap", only("vitepress", { "style/wrap": ["warn", { width: 20 }] })],
  ])("stays as written with %s", (_name, config) => {
    for (const source of sources) formats(source, config, source);
  });

  it("keeps a list beside it that another marker would join to it", () => {
    for (const source of [
      "* ember\n- Alpha words\n    <custom-tag/>\n",
      "- Alpha\n  <custom-tag/>\n+ zephyr\n",
      '- Alpha\n    <Badge text="x" />\n* kettle\n',
    ]) {
      const output = checked(source, preset("vitepress"));
      expect(output.replaceAll("\n\n", "\n")).toBe(source);
      formats(source, only("vitepress", { "style/list-marker": "warn" }), source);
    }
  });

  it("indents the lazy line where the line above is not a component", () => {
    const config = preset("vitepress");
    formats("- item\nlazy text\n", config, "- item lazy text\n");
    const lazy = only("vitepress", { "style/lazy-continuation": "warn" });
    formats("- item\nlazy text\n", lazy, "- item\n  lazy text\n");
    formats("- Alpha\n  <span>x</span>\nlazy\n", lazy, "- Alpha\n  <span>x</span>\n  lazy\n");
    formats("> Alpha\nlazy\n", lazy, "> Alpha\n> lazy\n");
  });

  it.each(["github", "forgejo", "gitea", "obsidian", "commonmark"] as const)(
    "indents the lazy line, which %s reads in the paragraph",
    (dialect) => {
      const lazy = only(dialect, { "style/lazy-continuation": "warn" });
      formats(sources[0]!, lazy, "- Alpha words\n    <custom-tag/>\n  more words after\n");
      formats(sources[1]!, lazy, "- Alpha words\n\t<custom-tag/>\n  more words after\n");
    },
  );
});
