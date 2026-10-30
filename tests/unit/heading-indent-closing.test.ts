import { describe, expect, it } from "vitest";
import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import { dialects, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import { formatted, only } from "../support/rules.js";

describe("style/heading indentation and closed styles (#680, #700)", () => {
  const render = (source: string) => new HtmlRenderer().render(new Parser().parse(source));
  const markdown = new MarkdownIt();
  it.each(dialects)("removes heading-owned indentation on %s", (dialect) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      for (const style of ["atx", "setext", "consistent"] as const) {
        const config = only({ "style/heading": ["warn", { style }] }, dialect);
        for (const [source, expected] of [
          ["text\n\n  ### A\n", "text\n\n### A\n"],
          ["   ###\n", "###\n"],
          ["    # code\n", "    # code\n"],
          ["    code\n\n2) b\n   # H\n   Text\n", "    code\n\n2) b\n   # H\n   Text\n"],
          ["- item\n\n    ### A\n", "- item\n\n  ### A\n"],
          [">   ### A\n", "> ### A\n"],
          ["> - item\n>\n>     ### A\n", "> - item\n>\n>   ### A\n"],
          ["-   ### A\n", "-   ### A\n"],
          [">   Two\n>   lines\n>    ===\n", "> Two\n> lines\n> ===\n"],
          ["- item\n\n    Two\n    lines\n     ===\n", "- item\n\n  Two\n  lines\n  ===\n"],
          ["  Two\n   lines\n  ===\n", "Two\nlines\n===\n"],
        ]) {
          const input = source!.replaceAll("\n", newline);
          const output = formatted(input, config);
          // Obsidian's existing renderer protection retains indented
          // underlines, and a heading with any protected part keeps all of
          // its indentation (#434).
          const protectedExpected =
            dialect === "obsidian" &&
            [
              ">   Two\n>   lines\n>    ===\n",
              "- item\n\n    Two\n    lines\n     ===\n",
              "  Two\n   lines\n  ===\n",
            ].includes(source!)
              ? source!
              : expected!;
          expect(output).toBe(protectedExpected.replaceAll("\n", newline));
          expect(semanticFingerprint(parse(output, dialect))).toBe(
            semanticFingerprint(parse(input, dialect)),
          );
          expect(render(output)).toBe(render(input));
          expect(markdown.render(output)).toBe(markdown.render(input));
          expect(format(input, { config: only({}, dialect) }).output).toBe(input);
        }
        const input = `  Title${newline}   ===${newline}`;
        expect(formatted(input, config)).toBe(
          dialect === "obsidian"
            ? input
            : style === "atx"
              ? `# Title${newline}`
              : `Title${newline}===${newline}`,
        );
      }
    }
  });

  it.each(dialects)("adds matching closing sequences on %s", (dialect) => {
    const config = only({ "style/heading": ["warn", { closing: "add" }] }, dialect);
    for (const newline of ["\n", "\r\n", "\r"]) {
      for (const [source, expected] of [
        ["# A", "# A #"],
        ["## A ####", "## A ##"],
        ["###", "### ###"],
        ["##  \t", "## ##"],
        ["#  A", "# A #"],
        ["  # A", "# A #"],
        ["> ## A", "> ## A ##"],
        ["- ### A", "- ### A ###"],
        ["# C#", "# C# #"],
        ["# Text \\##", "# Text \\## #"],
        ["# `#`", "# `#` #"],
        ["# #tag", "# #tag #"],
      ]) {
        const input = source + newline;
        const output = formatted(input, config);
        expect(output).toBe(expected + newline);
        expect(semanticFingerprint(parse(output, dialect))).toBe(
          semanticFingerprint(parse(input, dialect)),
        );
        expect(render(output)).toBe(render(input));
        expect(markdown.render(output)).toBe(markdown.render(input));
      }
      const input = `Sharp ##${newline}===${newline}`;
      expect(formatted(input, config)).toBe(
        dialect === "obsidian" ? input : `# Sharp \\## #${newline}`,
      );
    }
    for (const style of ["setext", "consistent"] as const) {
      expect(
        formatted(
          "Title\n===\n\n### Deep\n\n> # Quote\n",
          only({ "style/heading": ["warn", { style, closing: "add" }] }, dialect),
        ),
      ).toBe("Title\n===\n\n### Deep ###\n\n> # Quote #\n");
    }
    expect(lint("# A\n", { config })).toMatchObject([{ rule: "style/heading" }]);
  });

  // Below a first line of `---` or `+++` that no line closes, the document has
  // no front matter. Without its indentation, an underline `  ---` or heading
  // text `  +++` would close it and make front matter of the lines above
  // (#278, #764).
  it.each(dialects)(
    "keeps the indentation of a line that would close front matter on %s",
    (dialect) => {
      for (const newline of ["\n", "\r\n"]) {
        const lines = (...text: string[]) => text.map((line) => line + newline).join("");
        for (const style of ["atx", "setext", "consistent"] as const) {
          const config = only({ "style/heading": ["warn", { style }] }, dialect);
          const keeps = dialect === "obsidian" || dialect === "vitepress";
          for (const source of [
            lines("---", "Title", "  ---"),
            lines("---", "[[toc]]", "  ---", "  title: T", "  ---", "", "> > # H"),
            lines("+++", "  +++", "==="),
          ]) {
            const output = formatted(source, config);
            expect(semanticFingerprint(parse(output, dialect))).toBe(
              semanticFingerprint(parse(source, dialect)),
            );
            expect(render(output)).toBe(render(source));
            expect(markdown.render(output)).toBe(markdown.render(source));
          }
          // Obsidian and VitePress read the unclosed opener as front matter to
          // the end, which stays as written.
          const output = formatted(lines("---", "Title", "  ---"), config);
          expect(output).toBe(
            keeps || style !== "atx" ? lines("---", "Title", "  ---") : lines("---", "## Title"),
          );
          expect(formatted(lines("---", "[[toc]]", "  ---", "  title: T", "  ---"), config)).toBe(
            keeps
              ? lines("---", "[[toc]]", "  ---", "  title: T", "  ---")
              : style === "atx"
                ? lines("---", "## [[toc]]", "## title: T")
                : lines("---", "[[toc]]", "  ---", "title: T", "  ---"),
          );
          // VitePress reads no TOML front matter.
          expect(formatted(lines("+++", "  +++", "==="), config)).toBe(
            lines("+++", dialect === "vitepress" ? "+++" : "  +++", "==="),
          );
          // Other indented headings below the opener still lose their indentation.
          expect(formatted(lines("---", "  Title", "  ===", "", "  ## Sub"), config)).toBe(
            keeps
              ? lines("---", "  Title", "  ===", "", "  ## Sub")
              : style === "atx"
                ? lines("---", "# Title", "", "## Sub")
                : // An underline of four dashes, which closes no front matter.
                  lines("---", "Title", "===", "", "Sub", "----"),
          );
        }
      }
    },
  );

  it.each(["forgejo", "gitea"] as const)("protects %s attribute suffixes", (dialect) => {
    const config = only({ "style/heading": ["warn", { closing: "add" }] }, dialect);
    for (const source of ["## Title {#id}\n", "## Title {#id}  ####\n"])
      expect(formatted(source, config)).toBe(source);
    expect(formatted("Title {#id}\n===\n", config)).toBe("# Title {#id}\n");
  });
});
