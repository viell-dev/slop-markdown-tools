import { describe, expect, it } from "vitest";
import { format, lint, parse, semanticFingerprint } from "../src/index.js";
import type { Config } from "../src/index.js";

function wrap(options: Record<string, unknown> = {}): Config {
  return { extends: [], rules: { "style/wrap": ["warn", { width: 40, ...options }] } };
}
function verify(source: string, config: Config) {
  const result = format(source, { config });
  expect(result.diagnostics.some((item) => item.rule.startsWith("engine/"))).toBe(false);
  expect(semanticFingerprint(parse(result.output, config.dialect ?? "commonmark"))).toBe(
    semanticFingerprint(parse(source, config.dialect ?? "commonmark")),
  );
  expect(format(result.output, { config }).output).toBe(result.output);
  return result;
}
describe("wrapping controls", () => {
  it.each(["2015.", "-", "#", ">", "1)", "***"])("moves the preceding word with %s", (marker) => {
    const source = `aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb ${marker} Its move is Happy Hour.\n`;
    const result = verify(source, wrap());
    expect(result.output).toBe(
      `aaaa aaaa aaaa aaaa aaaa aaaa aaaa\nbbbb ${marker} Its move is Happy Hour.\n`,
    );
    expect(format(source, { config: { extends: [] } }).output).toBe(source);
  });
  it("groups consecutive protected markers", () => {
    const result = verify("aaaa aaaa aaaa aaaa aaaa aaaa aaaa bbbb # > tail\n", wrap());
    expect(result.output).toContain("\nbbbb # > tail");
  });
  it("counts Unicode scalar values when requested", () => {
    const source = "aaaa aaaa aaaa aaaa aaaa 日本語 🙂 e\u0301 ending\n";
    expect(verify(source, wrap({ measure: "codepoints" })).output).toBe(source);
    expect(verify(source, wrap()).output).not.toBe(source);
    expect(
      lint(source, { config: wrap({ width: 30, measure: "codepoints" }) })[0]?.message,
    ).toContain("code points");
  });
  it.each([
    "[revision](https://example.test/a-very-long-revision-identifier)",
    "![image](https://example.test/a-very-long-image-identifier)",
    "`01234567890123456789012345678901234567890123456789`",
  ])("keeps a short label with an oversized atom: %s", (atom) => {
    const source = `- **Revision:** ${atom}\n`;
    expect(verify(source, wrap({ keepLabelWithAtom: true })).output).toBe(source);
    expect(verify(source, wrap()).output).toContain("**Revision:**\n  ");
    const prose = verify(
      source.trimEnd() + " more words after the value\n",
      wrap({ keepLabelWithAtom: true }),
    );
    expect(prose.output).toBe(source + "  more words after the value\n");
  });
  it("still wraps labels with values that fit on a continuation line", () => {
    const source = "- **Revision:** `123456789012345678901234567890`\n";
    expect(verify(source, wrap({ keepLabelWithAtom: true })).output).toContain("**Revision:**\n  ");
  });
  it.each([
    ["A long line with many words that will not be reflowed.  \nNext line.\n", "hard line break"],
    ["A long line with many words that will not be reflowed. ^id\n", "block identifier"],
    [
      "A long line with a `code span that crosses\na line` and more words than the configured width.\n",
      "multiline inline syntax",
    ],
    ["A long line with <b>inline HTML</b> and many more words.\n", "inline HTML"],
  ])("optionally reports protected over-width paragraphs", (source, reason) => {
    const result = verify(source!, wrap({ reportUnreflowed: true }));
    expect(result.output).toBe(source);
    expect(result.diagnostics[0]?.message).toContain(reason);
    expect(result.diagnostics[0]?.edit).toBeUndefined();
    expect(lint(source!, { config: wrap() })).toEqual([]);
  });
  it("optionally reports unbreakable overflow after formatting", () => {
    const source = "[label](https://example.test/a-very-long-unbreakable-link)\n";
    const result = verify(source, wrap({ reportUnbreakable: true }));
    expect(result.diagnostics[0]?.message).toContain("unbreakable atom");
    expect(result.diagnostics[0]?.edit).toBeUndefined();
    expect(lint(source, { config: wrap() })).toEqual([]);
  });
});
describe("multiline code spans", () => {
  const config: Config = {
    extends: [],
    rules: { "style/inline-code": "warn", "style/wrap": ["warn", { width: 40 }] },
  };
  it.each(["\n", "\r\n", "\r"])(
    "normalizes only code line endings in fingerprints (%j)",
    (newline) => {
      expect(semanticFingerprint(parse(`A \`one${newline}two\`.`, "commonmark"))).toBe(
        semanticFingerprint(parse("A `one two`.", "commonmark")),
      );
      expect(semanticFingerprint(parse("A `one  two`.", "commonmark"))).not.toBe(
        semanticFingerprint(parse("A `one two`.", "commonmark")),
      );
    },
  );
  it.each([
    ["A `one\ntwo` here.\n", "A `one two` here.\n"],
    ["> A `one\n> two` here.\n", "> A `one two` here.\n"],
    ["- A `one\n  two` here.\n", "- A `one two` here.\n"],
    ["A `` `one\ntwo` `` here.\n", "A `` `one two` `` here.\n"],
    ["A `  one\ntwo  ` here.\n", "A `  one two  ` here.\n"],
    ["A ` \n ` here.\n", "A `   ` here.\n"],
    ["A `one\r\ntwo` here.\r\n", "A `one two` here.\r\n"],
  ])("joins parsed code without deleting content or container syntax", (source, expected) => {
    expect(verify(source!, config).output).toBe(expected);
    expect(format(source!, { config: { extends: [] } }).output).toBe(source);
  });
});
