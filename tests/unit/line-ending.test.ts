import { expect, it } from "vitest";
import { format, lint, parse, semanticFingerprint, dialects } from "../../src/index.js";
import type { Config } from "../../src/index.js";

it.each(dialects)("normalizes line endings safely and idempotently in %s", (dialect) => {
  for (const endOfLine of ["lf", "crlf", "cr", "auto"] as const) {
    const ending =
      endOfLine === "crlf" || endOfLine === "auto" ? "\r\n" : endOfLine === "cr" ? "\r" : "\n";
    const source = "# Title\r\n\nA  \rbreak\\\nnext.\r\n\r- item\n";
    const config: Config = {
      extends: [],
      dialect,
      rules: { "style/line-ending": ["warn", { endOfLine }] },
    };
    const result = format(source, { config });
    expect(result.output).toBe(source.replace(/\r\n|\r|\n/g, ending));
    expect(result.diagnostics).toEqual([]);
    expect(semanticFingerprint(parse(result.output, dialect))).toBe(
      semanticFingerprint(parse(source, dialect)),
    );
    expect(format(result.output, { config }).changed).toBe(false);
    expect(format(source, { config: { extends: [], dialect } }).output).toBe(source);
  }
});
it.each(dialects)("preserves literal bytes and normalizes independent prose in %s", (dialect) => {
  const source =
    "---\r\ntitle: x\r\ntags: [a,b]\r\n---\r\n\r\n```js\r\na\r\nb\r\n```\r\n\r\n<div>\r\nx\r\n</div>\r\n\r\n$$\r\na\r\nb\r\n$$\r\n\r\nText.\r\n";
  const config: Config = { extends: [], dialect, rules: { "style/line-ending": "warn" } };
  const result = format(source, { config });
  expect(result.output).toContain("a\r\nb");
  expect(result.output).toContain("<div>\r\nx\r\n</div>");
  expect(result.output.endsWith("Text.\n")).toBe(true);
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config }).output).toBe(result.output);
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
});
it("keeps inline literals' line endings and still converts the prose around them", () => {
  const config: Config = { extends: [], dialect: "github", rules: { "style/line-ending": "warn" } };
  for (const [source, expected] of [
    // Inline math across lines once blocked every conversion in the document.
    ["Text $a\r\nb$ end.\r\n\r\nText.\r\n", "Text $a\r\nb$ end.\n\nText.\n"],
    // A code span's bytes are kept, as the docs promise for literal content.
    ["Text `code\r\nspan` end.\r\n", "Text `code\r\nspan` end.\n"],
    ['[a](u "t\r\nx") end.\r\n\r\nNext.\r\n', '[a](u "t\r\nx") end.\n\nNext.\n'],
  ]) {
    const result = format(source, { config });
    expect(result.output, source).toBe(expected);
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
    expect(format(result.output, { config }).output).toBe(result.output);
  }
});
it("defaults to LF only when enabled and validates the option", () => {
  expect(
    format("A\rB\r", { config: { extends: [], rules: { "style/line-ending": "warn" } } }).output,
  ).toBe("A\nB\n");
  expect(() =>
    lint("A\n", { config: { rules: { "style/line-ending": ["warn", { endOfLine: "bad" }] } } }),
  ).toThrow();
});

it.each(dialects)("retains newline runs at protected boundaries in %s", (dialect) => {
  const source = "<div>\ncontent\n</div>\n\nText.\n".replace(/\n/g, (_, offset: number) =>
    offset % 2 ? "\r\n" : "\r",
  );
  for (const endOfLine of ["lf", "crlf", "cr", "auto"]) {
    const config: Config = {
      extends: [],
      dialect,
      rules: { "style/line-ending": ["warn", { endOfLine }] },
    };
    const result = format(source, { config });
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
    expect(semanticFingerprint(parse(result.output, dialect))).toBe(
      semanticFingerprint(parse(source, dialect)),
    );
    expect(format(result.output, { config }).changed).toBe(false);
  }
});
