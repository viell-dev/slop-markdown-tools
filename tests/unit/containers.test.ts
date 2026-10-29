import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { normalizeHtml } from "../../scripts/rendering.mjs";
import { forgeFixtures } from "../fixtures/renderers/forges.mjs";
import {
  createWorkspace,
  format,
  lint,
  parse,
  presets,
  semanticFingerprint,
} from "../../src/index.js";
import type { Config, Dialect, RuleSetting } from "../../src/index.js";

const quote = { "style/quote-marker": "warn" } as const;
const lazy = { "style/lazy-continuation": "warn" } as const;
function only(rules: Record<string, RuleSetting>, dialect: Dialect = "github"): Config {
  return { extends: [], dialect, rules };
}
const commonmarkReader = new Parser();
const commonmarkWriter = new HtmlRenderer();
const markdownIt = new MarkdownIt({ html: true });
/** What commonmark.js and markdown-it render, which the parser's reading cannot show. */
const rendered = (source: string) => [
  normalizeHtml(commonmarkWriter.render(commonmarkReader.parse(source))),
  normalizeHtml(markdownIt.render(source)),
];
/**
 * Format, and require what every edit of these rules must keep: no engine
 * findings, the parsed meaning, nothing left to change on a second run, and
 * the source as written with the rules turned off.
 */
function formatted(source: string, config: Config) {
  const dialect = config.dialect as Dialect;
  const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
  const result = format(source, { config, workspace });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  expect(format(result.output, { config, workspace }).output).toBe(result.output);
  expect(format(source, { config: { extends: [], dialect }, workspace }).output).toBe(source);
  return result.output;
}
const messages = (source: string, config: Config) =>
  lint(source, { config }).map(({ rule, message }) => `${rule}: ${message}`);

describe("style/quote-marker", () => {
  const config = only(quote);
  it.each([
    // More than one space, or none, becomes one, in every block whose text
    // the quote's marker may start: paragraphs, headings, and breaks.
    [">  text\n", "> text\n"],
    [">text\n", "> text\n"],
    [">   # Heading\n", "> # Heading\n"],
    [">  Title\n>  ===\n", "> Title\n> ===\n"],
    [">  ***\n", "> ***\n"],
    // A paragraph's later lines may start with any number of spaces.
    ["> a\n>      b\n", "> a\n> b\n"],
    // Nested quotes, also where the inner `>` is indented.
    [">>a\n", "> > a\n"],
    [">  > a\n>  > b\n", "> > a\n> > b\n"],
    ["> >  > a\n", "> > > a\n"],
    // The quote takes one space after its marker, so writing one where it has
    // none moves no block after it.
    [">```\n>code\n>```\n", "> ```\n> code\n> ```\n"],
    ["><div>\n></div>\n", "> <div>\n> </div>\n"],
    [">| a |\n>| - |\n", "> | a |\n> | - |\n"],
    [">-\n>1. a\n", "> -\n> 1. a\n"],
    // An indented quote keeps its indentation, which is not after its marker.
    ["   >  a\n", "   > a\n"],
    ["> a\r\n>  b\r\n", "> a\r\n> b\r\n"],
    [">  a\r>  b\r", "> a\r> b\r"],
  ])("writes %j as %j", (source, output) => {
    expect(formatted(source, config)).toBe(output);
    expect(rendered(output)).toEqual(rendered(source));
  });
  it.each([
    // Five spaces start indented code, whose spaces are its content.
    [">     code\n"],
    [">     a\n>     b\n"],
    // Inside fenced code and HTML, spaces after the quote's take are content.
    [">  ```\n>    x\n>  ```\n"],
    [">  <div>\n>    x\n>  </div>\n"],
    // A blank quote line's spaces are trailing space.
    [">  \n> a\n"],
    // A tab counts to the next tab stop.
    [">\ta\n"],
    ["> a\n>\t b\n"],
    // The parser keeps a code span's indentation on its next line, where
    // GitHub and commonmark.js do not.
    ["> `a\n>    b`\n"],
    // Site generators read their containers and template tags by line.
    [">  {{ title }}\n>  text\n"],
    // Renderers can read the line below a quote as more of it, where the
    // parser starts another list (#543).
    [">1. first\n2) second\n"],
  ])("keeps %j", (source) => {
    expect(formatted(source, config)).toBe(source);
  });
  it("finds the markers to change and says why", () => {
    expect(messages(">text\n>  more\n", config)).toEqual([
      "style/quote-marker: Add a space after the block quote marker.",
      "style/quote-marker: Use one space after the block quote marker.",
    ]);
  });

  describe("list items", () => {
    it("moves a list that starts a quote's line with its lines", () => {
      // The spaces before the marker are the list's indentation.
      expect(formatted(">  - a\n>    b\n>  - c\n", config)).toBe("> - a\n>   b\n> - c\n");
      expect(formatted(">   1. a\n>\n>      b\n", config)).toBe("> 1. a\n>\n>    b\n");
      // A list in a quote in a list item.
      expect(formatted("- >  - a\n  >    b\n", config)).toBe("- > - a\n  >   b\n");
    });
    it("leaves a list whose marker line has a tab", () => {
      expect(formatted(">  -\ta\n>    b\n", config)).toBe(">  -\ta\n>    b\n");
    });
    it("leaves list items alone with listItems false", () => {
      const settings = only({ "style/quote-marker": ["warn", { listItems: false }] });
      expect(formatted(">  - a\n>    b\n>  text\n", settings)).toBe(">  - a\n>    b\n>  text\n");
      expect(formatted(">  text\n\n>  - a\n", settings)).toBe("> text\n\n>  - a\n");
      // So that `style/list-indent` can indent lists that start a quote's line.
      const indented = only({
        "style/quote-marker": ["warn", { listItems: false }],
        "style/list-indent": ["warn", { startIndented: true, startIndent: 2 }],
      });
      expect(formatted("> - a\n>   b\n", indented)).toBe(">   - a\n>     b\n");
    });
    it("leaves the spaces on an item's other lines to the item", () => {
      expect(formatted("> - a\n>   b\n", config)).toBe("> - a\n>   b\n");
      expect(formatted("> - a\n>\n>     b\n", config)).toBe("> - a\n>\n>     b\n");
    });
  });

  describe("dialects", () => {
    it.each(["github", "forgejo", "gitea", "vitepress", "commonmark", "obsidian"] as const)(
      "writes one space in %s",
      (dialect) => {
        expect(formatted(">  a\n>b\n\n>>c\n", only(quote, dialect))).toBe("> a\n> b\n\n> > c\n");
      },
    );
    it.each(["github", "forgejo", "gitea", "vitepress", "commonmark", "obsidian"] as const)(
      "keeps the spaces that keep a paragraph's later line from starting a block in %s",
      (dialect) => {
        const settings = only(quote, dialect);
        // Without the spaces, each line would start a heading, a break, a
        // fence, a list, HTML, an underline, a quote, a table row, or a
        // definition.
        for (const line of [
          "# Heading",
          "---",
          "```",
          "~~~",
          "1. b",
          "2. b",
          "1) b",
          "- b",
          "+ b",
          "<div>",
          "===",
          "> b",
          "| b |",
          "[b]: /url",
        ]) {
          const source = `> a\n>     ${line}\n`;
          expect(formatted(source, settings)).toBe(source);
          expect(formatted(`> > a\n> >      ${line}\n`, settings)).toBe(
            `> > a\n> >      ${line}\n`,
          );
        }
        // Text that starts no block loses them.
        expect(formatted("> a\n>     b\n>     2nd\n", settings)).toBe("> a\n> b\n> 2nd\n");
        expect(formatted("> Title\n>     more\n> ===\n", settings)).toBe(
          "> Title\n> more\n> ===\n",
        );
      },
    );
    it("follows Obsidian's boundary policy like the list rules", () => {
      // A paragraph directly above a nested quote is a block boundary there.
      const source = ">  a\n>b\n>>c\n";
      const obsidian = only(quote, "obsidian");
      expect(formatted(source, obsidian)).toBe("> a\n>b\n>>c\n");
      expect(messages(source, obsidian)).toContain(
        "style/quote-marker: Left as written to preserve Obsidian rendering: Add a space after the block quote marker.",
      );
    });
    it("keeps a tag directly after `>` in Obsidian, which Live Preview reads as text (#409)", () => {
      const obsidian = only(quote, "obsidian");
      expect(formatted(">#tag text\n", obsidian)).toBe(">#tag text\n");
      expect(formatted(">  #tag text\n", obsidian)).toBe("> #tag text\n");
      expect(formatted(">#123 text\n", obsidian)).toBe("> #123 text\n");
      expect(formatted(">#tag text\n", only(quote))).toBe("> #tag text\n");
    });
    it("keeps a callout's marker that two spaces make text in Obsidian", () => {
      const obsidian = only(quote, "obsidian");
      expect(formatted(">  [!tip] Title\n> body\n", obsidian)).toBe(">  [!tip] Title\n> body\n");
      expect(formatted(">  \\[!tip] Title\n", obsidian)).toBe(">  \\[!tip] Title\n");
      // With one space or none, the marker is a callout's either way.
      expect(formatted(">[!tip] Title\n>body\n", obsidian)).toBe("> [!tip] Title\n> body\n");
      // GitHub reads an alert after any number of spaces.
      expect(formatted(">  [!NOTE]\n>  body\n", only(quote))).toBe("> [!NOTE]\n> body\n");
    });
    it("keeps the quotes of a VitePress document with a container in a quote", () => {
      const vitepress = only(quote, "vitepress");
      const source = ">  ::: tip\n>  text\n>  :::\n";
      expect(formatted(source, vitepress)).toBe(source);
      expect(formatted(">  text\n\n::: tip\nx\n:::\n", vitepress)).toBe(
        "> text\n\n::: tip\nx\n:::\n",
      );
    });
  });
});

describe("style/lazy-continuation", () => {
  const config = only(lazy);
  it.each([
    // A quote's marker, a list item's indentation, or both.
    ["> a\nb\n", "> a\n> b\n"],
    ["> a\nb\nc\n", "> a\n> b\n> c\n"],
    ["- a\nb\n", "- a\n  b\n"],
    ["10. a\nb\n", "10. a\n    b\n"],
    ["> - a\n> b\n", "> - a\n>   b\n"],
    ["> - a\nb\n", "> - a\n>   b\n"],
    ["- > a\nb\n", "- > a\n  > b\n"],
    ["- > a\n  b\n", "- > a\n  > b\n"],
    ["> > a\nb\n", "> > a\n> > b\n"],
    ["> > a\n> b\n", "> > a\n> > b\n"],
    ["- - a\nb\n", "- - a\n    b\n"],
    // The item's content indentation, not the spaces written plus more.
    ["- a\n b\n", "- a\n  b\n"],
    ["> a\n   b\n", "> a\n> b\n"],
    // A quote keeps the indentation of its first line, and its marker's space.
    ["  > a\nb\n", "  > a\n  > b\n"],
    [">- a\n>b\n", ">- a\n>   b\n"],
    // Text that starts no block wherever it is.
    ["> a\n*b* and `c`\n", "> a\n> *b* and `c`\n"],
    ["> a\n[link](b.md) and ![image](c.png)\n", "> a\n> [link](b.md) and ![image](c.png)\n"],
    ["> a\n2nd (b)\n", "> a\n> 2nd (b)\n"],
    ["> a  \nb\n", "> a  \n> b\n"],
    ["> a\r\nb\r\n", "> a\r\n> b\r\n"],
    ["- a\rb\r", "- a\r  b\r"],
  ])("writes %j as %j", (source, output) => {
    expect(formatted(source, config)).toBe(output);
    expect(rendered(output)).toEqual(rendered(source));
  });
  it.each([
    // Inside the container, these could start a list, an underlined heading,
    // a table, HTML, or a heading, which the lazy line does not.
    ["> a\n2. b\n"],
    ["- a\n===\n"],
    ["> a\n| b |\n"],
    ["> a\n<span>b</span>\n"],
    ["> a\n#tag\n"],
    ["> a\n\\- b\n"],
    ["> a\n[b]: /url\n"],
    ["> a\n{{ b }}\n"],
    // The paragraph keeps all its lazy lines when one of them stays.
    ["> a\nb\n=\n"],
    ["- a\nb\n=\n"],
    // A code span keeps the indentation of its later lines for GitHub.
    ["> a `b\nc` d\n"],
    // Tabs make the columns uncertain.
    ["> a\n\tb\n"],
    ["-\ta\nb\n"],
    // A lazy first line below a definition.
    ["> [a]: /url\nb\n"],
  ])("keeps %j", (source) => {
    expect(formatted(source, config)).toBe(source);
  });
  it.each(["github", "forgejo", "gitea", "vitepress", "commonmark", "obsidian"] as const)(
    "keeps a lazy line that could start a list inside its containers in %s",
    (dialect) => {
      // Renderers differ on which ordered markers start a list inside a
      // container, and markdown-it reads an indented one below a nested quote
      // as code, so no marker gets the prefixes.
      for (const source of [
        "> a\n    1. b\n",
        "> a\n    2. b\n",
        "> a\n    1) b\n",
        "> a\n    10. b\n",
        "> > a\n    2. b\n",
        "> > a\n    1. b\n",
        "10. a\n  2. b\n",
        "- > a\n    2. b\n",
      ])
        expect(formatted(source, only(lazy, dialect))).toBe(source);
      // A number that is no marker is text; the engine's Obsidian protections
      // hold an indented lazy line whatever its text.
      expect(formatted("> a\n    2nd b\n", only(lazy, dialect))).toBe(
        dialect === "obsidian" ? "> a\n    2nd b\n" : "> a\n> 2nd b\n",
      );
      // A decimal or a version is no marker: such a line is handled like words,
      // while `3) x` is one and stays as written.
      for (const lead of ["2.5 litres", "2026.10 release", "3) x"]) {
        const words = (source: string, rules: Record<string, "warn">) =>
          formatted(source.replace("{}", "plain words"), only(rules, dialect)).replace(
            "plain words",
            lead,
          );
        const keepsLikeWords = (source: string, rules: Record<string, "warn">) =>
          lead === "3) x"
            ? expect(formatted(source.replace("{}", lead), only(rules, dialect))).toBe(
                source.replace("{}", lead),
              )
            : expect(formatted(source.replace("{}", lead), only(rules, dialect))).toBe(
                words(source, rules),
              );
        keepsLikeWords("> a\n{}\n", lazy);
        keepsLikeWords("> a\n>     {}\n", quote);
      }
    },
  );
  it("finds each lazy line and says what it lacks", () => {
    expect(messages("> a\nb\n\n- c\nd\n\n- > e\nf\n", config)).toEqual([
      "style/lazy-continuation: Add the block quote marker to the lazy continuation line.",
      "style/lazy-continuation: Indent the lazy continuation line to the list item's content.",
      "style/lazy-continuation: Add the container markers and indentation to the lazy continuation line.",
    ]);
  });

  describe("footnote definitions", () => {
    it("indents a continuation and keeps the first line on the label's line", () => {
      // Prettier moves `a` below the label; GitHub, VitePress, and
      // CommonMark-based readers continue the definition either way.
      expect(formatted("x[^1]\n\n[^1]: a\nb\n", config)).toBe("x[^1]\n\n[^1]: a\n    b\n");
      expect(formatted("x[^1]\n\n[^1]: a\nb\n\n    c\n", config)).toBe(
        "x[^1]\n\n[^1]: a\n    b\n\n    c\n",
      );
      expect(formatted("x[^1]\n\n[^1]: a\nb\n", only(lazy, "vitepress"))).toBe(
        "x[^1]\n\n[^1]: a\n    b\n",
      );
    });
    it("reads a footnote's label as a definition only where the dialect has footnotes", () => {
      expect(formatted("x[^1]\n\n[^1]: a\nb\n", only(lazy, "commonmark"))).toBe(
        "x[^1]\n\n[^1]: a\nb\n",
      );
    });
  });

  describe("Obsidian", () => {
    const obsidian = only(lazy, "obsidian");
    it.each([
      // Observed in Obsidian 1.14.5: both views show these the same.
      ["> a\nb\n", "> a\n> b\n"],
      ["> > a\nb\n", "> > a\n> > b\n"],
      ["- a\nb\n", "- a\n  b\n"],
      ["- a\nb\n- c\n", "- a\n  b\n- c\n"],
      ["> - a\n> b\n", "> - a\n>   b\n"],
      ["- - a\nb\n", "- - a\n    b\n"],
    ])("writes %j as %j", (source, output) => {
      expect(formatted(source, obsidian)).toBe(output);
    });
    it.each([
      // Live Preview shows these otherwise once the line has its prefix.
      ["x[^1]\n\n[^1]: a\nb\n", "Indent the lazy continuation line of the footnote definition."],
      ["> > a\n> b\n", "Add the block quote marker to the lazy continuation line."],
      ["- > a\nb\n", "Add the container markers and indentation to the lazy continuation line."],
      // Not observed, so left as written too.
      ["> - a\nb\n", "Add the container markers and indentation to the lazy continuation line."],
      // Live Preview reads the blocks after the lazy line outside the item (#376).
      ["- a\nb\n\n  c\n", "Indent the lazy continuation line to the list item's content."],
    ])("leaves %j as written and says so", (source, message) => {
      expect(formatted(source, obsidian)).toBe(source);
      expect(messages(source, obsidian)).toContain(
        `style/lazy-continuation: Left as written to preserve Obsidian rendering: ${message}`,
      );
    });
  });

  it("agrees with style/wrap", () => {
    const wrapping = only({ ...lazy, "style/wrap": ["warn", { width: 80 }] });
    // Wrapping joins the lazy line, or writes the prefix where it breaks one.
    expect(formatted("> a\nb\n", wrapping)).toBe("> a b\n");
    expect(
      formatted(
        "> one two three four\nfive six seven\n",
        only({ ...lazy, "style/wrap": ["warn", { width: 20 }] }),
      ),
    ).toBe("> one two three four\n> five six seven\n");
    // Where wrapping keeps the line break, the line gets its prefix.
    expect(formatted("> a  \nb\n", wrapping)).toBe("> a  \n> b\n");
  });
});

describe("the presets", () => {
  it("enable both rules in recommended", () => {
    expect(presets.recommended!.rules!["style/quote-marker"]).toBe("warn");
    expect(presets.recommended!.rules!["style/lazy-continuation"]).toBe("warn");
    expect(formatted(">text\nlazy\n", { extends: ["recommended"], dialect: "github" })).toBe(
      "> text lazy\n",
    );
  });
  it.each(["forgejo", "gitea"] as const)(
    "format the authored forge fixture for #665 in %s as the forges were shown it",
    (dialect) => {
      const { source } = forgeFixtures.find(({ name }) => name === "quoted-stray-markers")!;
      const output = formatted(source, { extends: ["recommended", dialect], dialect });
      // The quote's lines move the stray `~` to the next physical line.
      expect(output).toContain(
        "> > candle __kettle__ fabric harbor delta meadow pebble zephyr *xba_a`x.~x.*ab ~\n> > ~ .** engine",
      );
    },
  );
});
