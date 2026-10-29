import { describe, expect, it } from "vitest";
import { format, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect, RuleSetting } from "../../src/index.js";
import { commonFixtures } from "../fixtures/renderers/common.mjs";

const crlf = (source: string) => source.replaceAll("\n", "\r\n");
const preset = (dialect: Dialect): Config => ({
  extends: ["recommended", ...(dialect === "commonmark" ? [] : [dialect])],
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
  expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
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

// Each source's rendering before and after formatting was compared with
// `gh api markdown` in both modes and with the pinned Forgejo and Gitea hosts'
// markup API (#770); markdown-it's reading is VitePress's own guard.
describe("a table whose header row is a complete tag alone on its line (#770)", () => {
  const header = '| <b title=" | ">  |\n';
  const delimiter = "| ---------- | --- |\n";
  const tables = ["github", "forgejo", "gitea", "vitepress"] as const;

  it.each(tables)("formats the table that %s reads", (dialect) => {
    const config = preset(dialect);
    formats('a\n<b title="|">\n|-|-|\n*w*\n', config, `a\n\n${header}${delimiter}| _w_        |\n`);
    formats(
      '- a\n  <b title="|">\n  |-|-|\n  *w*\n',
      config,
      `- a\n  ${header}  ${delimiter}  | _w_        |\n`,
    );
    formats(
      '> a\n> <b title="|">\n> |-|-|\n> *w*\n',
      config,
      `> a\n>\n> ${header}> ${delimiter}> | _w_        |\n`,
    );
    formats(
      '> - a\n>   <b title="|">\n>   |-|-|\n',
      config,
      `> - a\n>   ${header}>   ${delimiter.trimEnd()}\n`,
    );
  });

  it.each(["github", "forgejo", "gitea", "vitepress", "obsidian"] as const)(
    "keeps the tag line below the text when the table stays as written in %s",
    (dialect) => {
      // After a blank line the tag line would start an HTML block instead.
      const spacing = only(dialect, { "style/block-spacing": "warn" });
      for (const source of [
        'a\n<b title="|">\n|-|-|\n*w*\n',
        'a\n   <b title="|">\n|-|-|\n',
        'a\nb\n<i title="|">\n|-|-|\n',
        'a\n<b title="x">\n|-|\n',
        '> a\n> <b title="|">\n> |-|-|\n',
      ])
        formats(source, spacing, source);
      // An indented header, which the table rule leaves as written.
      formats('a\n   <b title="|">\n|-|-|\n', preset(dialect), 'a\n   <b title="|">\n|-|-|\n');
    },
  );

  it("leaves Obsidian's paragraph text as written", () => {
    // Obsidian reads no table directly below text in either view, here one
    // paragraph with inline HTML, so the parser's table keeps its boundary.
    for (const source of [
      'a\n<b title="|">\n|-|-|\n*w*\n',
      '- a\n  <b title="|">\n  |-|-|\n  *w*\n',
      '> a\n> <b title="|">\n> |-|-|\n> *w*\n',
    ])
      formats(source, preset("obsidian"), source);
  });

  it("formats CommonMark's paragraph", () => {
    formats(
      'a\n<b title="|">\n|-|-|\n*w*\n',
      preset("commonmark"),
      'a\n<b title="|">\n|-|-|\n_w_\n',
    );
  });

  it("keeps a lazy header line where GitHub or Goldmark reads otherwise", () => {
    const lazy = '- a\n<b title="|">\n  |-|-|\n*w*\n';
    // GitHub ends the list and reads HTML through the blank line (#762);
    // Forgejo and Gitea read `*w*` as a lazy body row of the item's table.
    for (const dialect of ["github", "forgejo", "gitea"] as const)
      formats(lazy, preset(dialect), lazy);
    // markdown-it reads the lazy line's table outside the list, which stays
    // as written (#763).
    formats(lazy, preset("vitepress"), lazy);
    const quote = '> a\n<b title="|">\n> |-|-|\n';
    formats(quote, preset("github"), quote);
    for (const dialect of ["forgejo", "gitea"] as const)
      formats(quote, preset(dialect), `> a\n${header}> ${delimiter}`);
    // markdown-it continues the quote's paragraph lazily: no table there.
    formats(quote, preset("vitepress"), quote);
  });
});

describe("the native fixtures of #770", () => {
  it.each(["github", "forgejo", "gitea"] as const)("format without refusal in %s", (dialect) => {
    for (const name of ["table-tag-header", "table-tag-header-lazy"]) {
      const { source } = commonFixtures.find((fixture) => fixture.name === name)!;
      // Formatting changes each fixture, so the native comparison renders it.
      expect(checked(source, preset(dialect)), name).not.toBe(source);
    }
  });
  it("keeps the lazy forms as written on the hosts that read them otherwise", () => {
    const { source } = commonFixtures.find(({ name }) => name === "table-tag-header-lazy")!;
    // GitHub reads HTML in both; Goldmark reads the item's lazy body row and
    // the quote's table, which it reads as the parser does.
    const item = source.slice(source.indexOf("- An item"), source.indexOf("\n\n> A quote"));
    const quote = source.slice(source.indexOf("> A quote"), source.indexOf("\n\nA *closing*"));
    expect(checked(source, preset("github"))).toContain(`${item}\n\n${quote}`);
    for (const dialect of ["forgejo", "gitea"] as const)
      expect(checked(source, preset(dialect))).toContain(item);
  });
});

describe("Goldmark's lazy rows below a table in a container (#770)", () => {
  // Forgejo and Gitea build a table from a paragraph, which takes a lazy line
  // as one more row; GFM ends the list item before it. A blank line above
  // `*w*` moves that row out of the table there.
  it.each([
    "- a\n  | x | y |\n  |-|-|\n*w*\n",
    "- | x | y |\n  |-|-|\n*w*\n",
    "> | x | y |\n> |-|-|\n*w*\n",
  ])("leaves %j as written on Forgejo and Gitea", (source) => {
    for (const dialect of ["forgejo", "gitea"] as const) formats(source, preset(dialect), source);
  });
  it("formats the list on GitHub, which ends the table there", () => {
    formats(
      "- a\n  | x | y |\n  |-|-|\n*w*\n",
      preset("github"),
      "- a\n  | x   | y   |\n  | --- | --- |\n\n_w_\n",
    );
  });
});

describe("a lazy table header line in a block quote", () => {
  // A line of the quote's markers above the lazy header would end the quote.
  it.each(["github", "forgejo", "gitea"] as const)("proposes no blank line in %s", (dialect) => {
    formats("> a\nx | y\n> |-|-|\n", preset(dialect), "> a\n| x   | y   |\n> | --- | --- |\n");
    const spacing = only(dialect, { "style/block-spacing": "warn" });
    formats("> a\nx | y\n> |-|-|\n", spacing, "> a\nx | y\n> |-|-|\n");
    formats("> > a\n> x | y\n> > |-|-|\n", spacing, "> > a\n> x | y\n> > |-|-|\n");
  });
});

describe("tables that markdown-it reads otherwise in VitePress", () => {
  // The table rule formats only a table that VitePress reads on the same lines.
  it.each(["a\nb\n|-|\n", "> a\nx | y\n> |-|-|\n", 'a\n<b title="x">\n|-|\n'])(
    "leaves %j as written",
    (source) => formats(source, preset("vitepress"), source),
  );
  it("still formats the tables it reads", () => {
    formats("| a |\n|-|\n", preset("vitepress"), "| a   |\n| --- |\n");
    formats("a\n\n| x | y |\n|-|-|\n", preset("vitepress"), "a\n\n| x   | y   |\n| --- | --- |\n");
  });
});
