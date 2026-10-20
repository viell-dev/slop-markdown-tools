import { expect, it } from "vitest";
import {
  canonicalDialect,
  createWorkspace,
  dialects,
  format,
  lint,
  parse,
  semanticFingerprint,
} from "../../src/index.js";
import type { Config } from "../../src/index.js";

/** A rule's edits preserve meaning, converge, and disappear when the rule is disabled. */
function verify(source: string, config: Config) {
  const dialect = canonicalDialect(config.dialect ?? "github");
  const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
  const result = format(source, { config, workspace });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  expect(format(result.output, { config, workspace }).output).toBe(result.output);
  expect(format(source, { config: { extends: [], dialect }, workspace }).output).toBe(source);
  return result;
}

it.each(dialects)("keeps colon-container boundaries out of tables in %s", (dialect) => {
  const config: Config = {
    extends: [],
    dialect,
    rules: { "style/table": "warn", "content/table-columns": "warn" },
  };
  for (const newline of ["\n", "\r\n", "\r"])
    for (const boundary of [":::", "   ::: \t", "::::", ":::tip", "::: details A | B"])
      for (const prefix of ["", "> ", "- "])
        for (const header of [false, true]) {
          const lines = header
            ? [boundary, "| - | - |", "| 1 | 2 |", "more text"]
            : ["| a | b |", "| - | - |", "| 1 | 2 |", boundary, "more text"];
          const source =
            lines
              .map((line, index) => (index && prefix === "- " ? "  " : prefix) + line)
              .join(newline) + newline;
          const result = verify(source, config);
          expect(result.output).toBe(source);
          expect(result.diagnostics).toEqual([]);
        }
});

it("still formats ordinary table cells containing colon runs", () => {
  const source = "| a | b |\n| - | - |\n| ::: | :::: |\n";
  const result = verify(source, {
    extends: [],
    dialect: "github",
    rules: { "style/table": "warn", "content/table-columns": "warn" },
  });
  expect(result.output).toBe("| a   | b    |\n| --- | ---- |\n| ::: | :::: |\n");
});

it("reports malformed rows before a container boundary, without treating later text as rows", () => {
  const source = "| a | b |\n| - | - |\n| 1 |\n:::\nmore text\n";
  expect(
    lint(source, {
      config: { extends: [], dialect: "github", rules: { "content/table-columns": "warn" } },
    }).map((item) => item.line),
  ).toEqual([3]);
});

it.each(dialects)("keeps snippet-import paragraphs as written in %s", (dialect) => {
  const config: Config = {
    extends: [],
    dialect,
    rules: { "style/wrap": ["warn", { width: 40 }] },
  };
  for (const newline of ["\n", "\r\n", "\r"])
    for (const prefix of ["", "> ", "- "])
      for (const lines of [
        ["<<< ./a.js", "<<< ./b.js"],
        ["<<<./a.js{1,2 js:line-numbers} [a long title that exceeds forty columns]"],
      ]) {
        const source =
          lines
            .map((line, index) => (index && prefix === "- " ? "  " : prefix) + line)
            .join(newline) + newline;
        expect(verify(source, config).output).toBe(source);
      }
  const mention = "A paragraph mentions <<< as ordinary text and still has enough words to wrap.\n";
  expect(verify(mention, config).output).not.toBe(mention);
});

it.each(["[[toc]]", "[[TOC]]", "[[ToC]]"])("keeps %s away from a new line's start", (marker) => {
  const config: Config = {
    extends: [],
    dialect: "github",
    rules: { "style/wrap": ["warn", { width: 40 }] },
  };
  for (const prefix of ["", "> ", "- "]) {
    const source = `${prefix}${"word ".repeat(7)}${marker} and more words follow here.\n`;
    const result = verify(source, config);
    expect(result.output).not.toBe(source);
    expect(result.output).not.toMatch(new RegExp(`^\\s*(?:>\\s*)?\\[\\[toc\\]\\]`, "im"));
    const existing = `${prefix}${marker}\tand more words that exceed forty columns follow here.\n`;
    expect(verify(existing, config).output).toBe(existing);
  }
});

it("still wraps an opaque code span containing a table-of-contents marker", () => {
  const source = `${"word ".repeat(7)}\`[[toc]]\` and more words follow here.\n`;
  expect(
    verify(source, {
      extends: [],
      dialect: "github",
      rules: { "style/wrap": ["warn", { width: 40 }] },
    }).output,
  ).toContain("\n`[[toc]]`");
});
