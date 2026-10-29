import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { dialects, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

function config(dialect: Dialect, style = "fenced"): Config {
  return { extends: [], dialect, rules: { "style/code-block": ["warn", { style }] } };
}

const cases = [
  "    code\n",
  "    code",
  "\tcode\n",
  "    \tcode\n",
  "    a  \n    \n    b\n",
  "    ```\n    ~~~~\n    `````\n",
  ">     code\n>\n>     more\n",
  "- Item\n\n      code\n      more\n",
  "> - Item\n>\n>       code\n",
  "-     code\n",
  "# Heading\n\n    <b> {{ value }} \\* | $$\n\nText\n",
  "::: code-group\n\n    code\n\n:::\n",
];

describe("style/code-block", () => {
  it.each(dialects)("preserves code and is idempotent in %s", (dialect) => {
    for (const eol of ["\n", "\r\n"])
      for (const input of cases) {
        const source = input.replaceAll("\n", eol);
        const result = format(source, { config: config(dialect) });
        expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
        if (dialect === "vitepress") {
          expect(result.output).toBe(source);
          expect(lint(source, { config: config(dialect) })).toMatchObject([
            { rule: "style/code-block" },
          ]);
        } else expect(result.output).not.toBe(source);
        expect(format(result.output, { config: config(dialect) }).output).toBe(result.output);
        expect(semanticFingerprint(parse(result.output, dialect))).toBe(
          semanticFingerprint(parse(source, dialect)),
        );
        const renderer = new HtmlRenderer();
        const parser = new Parser();
        expect(renderer.render(parser.parse(result.output))).toBe(
          renderer.render(parser.parse(source)),
        );
        const markdown = new MarkdownIt();
        expect(markdown.render(result.output)).toBe(markdown.render(source));
        expect(format(source, { config: { extends: [], dialect, rules: {} } }).output).toBe(source);
      }
  });
  it("uses a fence longer than content runs and keeps internal blank code lines", () => {
    expect(format("    ```\n    \n    x\n", { config: config("github") }).output).toBe(
      "````\n```\n\nx\n````\n",
    );
  });
  it("takes the first code form for consistent style", () => {
    const fencedFirst = "~~~\na\n~~~\n\n    b\n";
    expect(format(fencedFirst, { config: config("github", "consistent") }).output).toBe(
      "~~~\na\n~~~\n\n```\nb\n```\n",
    );
    const indentedFirst = "    a\n\n```js\nb\n```\n";
    expect(format(indentedFirst, { config: config("github", "consistent") }).output).toBe(
      indentedFirst,
    );
    expect(lint(indentedFirst, { config: config("github", "consistent") })).toMatchObject([
      { rule: "style/code-block", message: "Use indented code blocks." },
    ]);
  });
  it.each(dialects)("reports fenced blocks without losing info or blank lines on %s", (dialect) => {
    for (const source of [
      "```js {1} [demo]\nx\n```\n",
      "```\n\nx\n\n```\n",
      "Text\n```\nx\n```\n",
      "```\nx\n```\n",
    ]) {
      const findings = lint(source, { config: config(dialect, "indented") });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.edit).toBeUndefined();
      expect(format(source, { config: config(dialect, "indented") }).output).toBe(source);
    }
  });
  it("does not mistake continuation paragraphs for code (#695)", () => {
    const source =
      "- First paragraph\n\n  Continuation paragraph\n\n[^n]: Note\n\n    Continued note\n";
    expect(lint(source, { config: config("github") })).toEqual([]);
  });
  it("defaults to consistent and rejects unknown styles", () => {
    expect(
      lint("    a\n", { config: { extends: [], rules: { "style/code-block": "warn" } } }),
    ).toEqual([]);
    expect(() => lint("", { config: config("github", "other") })).toThrow("Invalid options");
  });
});
