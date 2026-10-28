import { describe, expect, it } from "vitest";
import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import { dialects, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

function check(
  source: string,
  rule: string,
  options: Record<string, unknown>,
  dialect: Dialect,
  expected = source,
) {
  const config: Config = { extends: [], dialect, rules: { [rule]: ["warn", options] } };
  const result = format(source, { config });
  expect(result.output).toBe(expected);
  expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config }).output).toBe(result.output);
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  for (const render of [
    (text: string) => new HtmlRenderer().render(new Parser().parse(text)),
    (text: string) => new MarkdownIt().render(text),
  ]) {
    expect(render(result.output)).toBe(render(source));
  }
  expect(format(source, { config: { extends: [], dialect, rules: {} } }).output).toBe(source);
  return { config, result };
}

describe.each(dialects)("style options in %s", (dialect) => {
  it.each(["\n", "\r\n"])("normalizes exact hard-break spaces with %j", (eol) => {
    check(
      `one   ${eol}two   ${eol}`,
      "style/trailing-space",
      { hardBreakSpaces: 2 },
      dialect,
      `one  ${eol}two${eol}`,
    );
    check(
      `one  ${eol}two${eol}`,
      "style/trailing-space",
      { hardBreakSpaces: 4 },
      dialect,
      `one    ${eol}two${eol}`,
    );
    check(`one   ${eol}two${eol}`, "style/trailing-space", {}, dialect);
    check(
      `one   ${eol}two${eol}`,
      "style/trailing-space",
      { hardBreakSpaces: 4, hardBreak: "backslash" },
      dialect,
      `one\\${eol}two${eol}`,
    );
    check(`one\t   ${eol}two${eol}`, "style/trailing-space", { hardBreakSpaces: 2 }, dialect);
    check(
      `- one${eol}  ${eol}  two${eol}`,
      "style/trailing-space",
      { listItemEmptyLines: true },
      dialect,
    );
  });
  it("reports code without editing it", () => {
    for (const source of [
      "```\ncode   \n```\n",
      "    code   \n",
      "- ```\n  code   \n  ```\n",
      "```\r\ncode\t \r\n```\r\n",
    ]) {
      const { config } = check(source, "style/trailing-space", { codeBlocks: true }, dialect);
      const findings = lint(source, { config });
      // VitePress deliberately suppresses all ordinary findings in opaque indented code.
      expect(findings).toHaveLength(dialect === "vitepress" && source.startsWith("    ") ? 0 : 1);
      expect(findings[0]?.edit).toBeUndefined();
      expect(
        lint(source, { config: { ...config, rules: { "style/trailing-space": "warn" } } }),
      ).toEqual([]);
    }
  });
  it.each(["* * *", "-----", "_\t_\t_"])("uses exact thematic text %j", (marker) => {
    check("Text\n\n***\n", "style/thematic-break", { marker }, dialect, `Text\n\n${marker}\n`);
    check(
      `Text\r\n\r\n${marker}\r\n\r\n***\r\n`,
      "style/thematic-break",
      { marker: "consistent" },
      dialect,
      `Text\r\n\r\n${marker}\r\n\r\n${marker}\r\n`,
    );
  });
  it("keeps ambiguous thematic boundaries", () => {
    check("Text\n***\n", "style/thematic-break", { marker: "-----" }, dialect);
    check("+++\nx = 1\n+++\n***\n", "style/thematic-break", { marker: "-----" }, dialect);
    check("- ***\n", "style/thematic-break", { marker: "- - -" }, dialect);
    check(
      "***\n\nText\n\n***\n",
      "style/thematic-break",
      { marker: "---" },
      dialect,
      "***\n\nText\n\n---\n",
    );
  });
  it.each(["\n", "\r\n"])("indents first-level lists with %j", (eol) => {
    check(
      `- one${eol}- two${eol}`,
      "style/list-indent",
      { startIndented: true },
      dialect,
      `  - one${eol}  - two${eol}`,
    );
    check(
      `- one${eol}  - nested${eol}`,
      "style/list-indent",
      { startIndented: true, startIndent: 1 },
      dialect,
      ` - one${eol}   - nested${eol}`,
    );
    check(
      `> - one${eol}`,
      "style/list-indent",
      { startIndented: true, startIndent: 3 },
      dialect,
      `>    - one${eol}`,
    );
    check(`1. one${eol}`, "style/list-indent", { startIndented: true }, dialect, `  1. one${eol}`);
    check(`- one${eol}`, "style/list-indent", { startIndented: true, startIndent: 4 }, dialect);
    check(`Text${eol}- one${eol}`, "style/list-indent", { startIndented: true }, dialect);
    check(`- one${eol}`, "style/list-indent", { startIndent: 3 }, dialect);
    // A list after one left as written must not reach into its last item.
    check(
      `Text${eol}- a${eol}${eol}* b${eol}`,
      "style/list-indent",
      { startIndented: true },
      dialect,
    );
    check(
      `- a${eol}${eol}* b${eol}`,
      "style/list-indent",
      { startIndented: true },
      dialect,
      `  - a${eol}${eol}  * b${eol}`,
    );
    // A blank quote line is no text above the list; quoted text is.
    check(
      `>${eol}> - item${eol}`,
      "style/list-indent",
      { startIndented: true },
      dialect,
      `>${eol}>   - item${eol}`,
    );
    check(`> text${eol}> - item${eol}`, "style/list-indent", { startIndented: true }, dialect);
  });
});

it("validates style option values", () => {
  for (const [rule, options] of [
    ["style/thematic-break", { marker: "--" }],
    ["style/thematic-break", { marker: "***\n" }],
    ["style/thematic-break", { marker: "*-*" }],
    ["style/trailing-space", { hardBreakSpaces: 1 }],
    ["style/trailing-space", { codeBlocks: "yes" }],
    ["style/list-indent", { startIndent: -1 }],
  ] as const) {
    expect(() =>
      format("Text\n", { config: { extends: [], rules: { [rule]: ["warn", options] } } }),
    ).toThrow();
  }
});
