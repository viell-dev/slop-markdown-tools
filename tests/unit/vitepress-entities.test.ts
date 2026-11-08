import { expect, it } from "vitest";
import { format, parse, semanticFingerprint } from "../../src/index.js";
import type { Config } from "../../src/index.js";
import { vitepressTokens } from "../../src/syntax/vitepress/projection.js";
import { semanticFingerprintWithCode } from "../../src/core/semantics.js";

const fingerprint = (source: string) => semanticFingerprint(parse(source, "vitepress"));

it.each([
  "&copy;",
  "&amp;",
  "\\&",
  "&#169;",
  "&#xA9;",
  "&#xD800;",
  "&#0;",
  "&NotEqualTilde;",
  "&#9;",
  "&#10;",
  "&#12;",
  "&#13;",
  "&#32;",
  "&#x20;",
  "&Tab;",
  "&NewLine;",
])("compares single and joined body %s without changing cached tokens (#863)", (entity) => {
  const source = `**x**\n${entity}\nTail\n`;
  const document = parse(source, "vitepress");
  const tokens = vitepressTokens(document);
  const before = JSON.stringify(tokens);
  expect(semanticFingerprint(document)).toBe(fingerprint(`**x** ${entity}\nTail\n`));
  expect(vitepressTokens(document)).toBe(tokens);
  expect(JSON.stringify(tokens)).toBe(before);
});

it.each(["&#x80;", "&#xFFFF;", "&#xFDD0;", "&#1;", "&lbrace;"])(
  "keeps the single/joined distinction for excluded body %s (#863)",
  (entity) => {
    expect(fingerprint(`**x** ${entity}\nTail\n`)).not.toBe(
      fingerprint(`**x**\n${entity}\nTail\n`),
    );
  },
);

it.each([
  ["**x** &copy;\nTail\n====\n", "**x**\n&copy;\nTail\n====\n"],
  ["![x &copy; tail](a.png)\n", "![x\n&copy; tail](a.png)\n"],
  ["Text <span>**x** &copy;\nTail</span>\n", "Text <span>**x**\n&copy;\nTail</span>\n"],
  ["{{ 1 }} **x** &copy;\nTail\n", "{{ 1 }} **x**\n&copy;\nTail\n"],
  ["`a`&NewLine;`b`\n", "`a` `b`\n"],
  ["&#123;&#123; 1 + 2 &#125;&#125;\n", "{{ 1 + 2 }}\n"],
  ["Before `&copy;` after.\n", "Before `©` after.\n"],
  ["Before &amp;copy; after.\n", "Before &copy; after.\n"],
  ["Before \\&copy; after.\n", "Before &copy; after.\n"],
  ["Before \\&#32; after.\n", "Before &#32; after.\n"],
  ["Before &amp;#32; after.\n", "Before &#32; after.\n"],
  ["Before &#38;#32; after.\n", "Before &#32; after.\n"],
  ["Before &amp;NewLine; after.\n", "Before &NewLine; after.\n"],
  ["`a` &NewLine; `b`\n", "`a` `b`\n"],
  ["**a** &#13; **b**\n", "**a** **b**\n"],
  ["**a**&#13;![b](a.png)\n", "**a**&#32;![b](a.png)\n"],
  ["**a**&NewLine;**b**\n", "**a** **b**\n"],
])("keeps contextual and literal entity distinctions in %s (#863)", (before, after) => {
  expect(fingerprint(before)).not.toBe(fingerprint(after));
});

it.each([
  ["B%%\n&#32;\n", "B%% &#32;\n"],
  ['x [a.](u "t. U") &#32; ', 'x [a.](u "t. U")\n&#32;'],
  ['> [a.](u "t. U") &#32;\n', '> [a.](u "t. U")\n> &#32;\n'],
])("wraps whitespace entities without withholding edits for %j (#905)", (source, expected) => {
  for (const mode of ["always", "sentences"])
    for (const eol of source.includes("\n") ? ["\n", "\r\n", "\r"] : ["\n"]) {
      const input = source.replaceAll("\n", eol);
      const config: Config = {
        extends: [],
        dialect: "vitepress",
        rules: { "style/wrap": ["warn", { mode, width: 20 }] },
      };
      const result = format(input, { config });
      expect(result.diagnostics).toEqual([]);
      expect(result.output).toBe(expected.replaceAll("\n", eol));
      expect(fingerprint(result.output)).toBe(fingerprint(input));
      expect(format(result.output, { config }).output).toBe(result.output);
      expect(format(input, { config: { ...config, rules: {} } }).output).toBe(input);
    }
});

it.each(["always", "sentences"])(
  "keeps other paragraph fixes beside an entity in %s mode (#905)",
  (mode) => {
    const source =
      "B%%\n&#32;\n\nThis is an ordinary paragraph that should wrap at twenty columns.\n";
    const config: Config = {
      extends: [],
      dialect: "vitepress",
      rules: { "style/wrap": ["warn", { mode, width: 20 }] },
    };
    const result = format(source, { config });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toBe(
      "B%% &#32;\n\nThis is an ordinary\nparagraph that\nshould wrap at\ntwenty columns.\n",
    );
    expect(fingerprint(result.output)).toBe(fingerprint(source));
    expect(format(result.output, { config }).output).toBe(result.output);
  },
);

it("varies only approved code values beside normalized body entities (#905)", () => {
  const source = "B%%\n&#32;\n\n```js\nold\n```\n\n```txt\nkept\n```\n";
  const before = parse(source, "vitepress");
  const after = source.replace("B%%\n&#32;", "B%% &#32;").replace("old", "formatted");
  const selected = before.tree.children.find((node) => node.type === "code")!;
  const approved = new WeakMap([[selected, "formatted"]]);
  expect(semanticFingerprint(before)).not.toBe(fingerprint(after));
  expect(semanticFingerprintWithCode(before, approved)).toBe(fingerprint(after));
  expect(semanticFingerprintWithCode(before, approved)).not.toBe(
    fingerprint(after.replace("kept", "changed")),
  );
  expect(semanticFingerprintWithCode(before, approved)).not.toBe(
    fingerprint(after.replace("formatted", "other")),
  );
});

it.each([
  ["`a`\\\n&NewLine;`b`\n", "`a`\\\n&#32;`b`\n"],
  ["**a**  \n&NewLine;**b**\n", "**a**  \n&#32;**b**\n"],
])("keeps equivalent entity gaps after a hard break: %j (#905)", (before, after) => {
  expect(fingerprint(before)).toBe(fingerprint(after));
});

it.each(["", " "])("keeps entity gaps before a hard break with prefix %j (#905)", (prefix) => {
  for (const hardbreak of ["\\\n", "  \n"]) {
    const before = `**a**${prefix}&NewLine;${hardbreak}**b**\n`;
    const after = `**a**${prefix}&#32;${hardbreak}**b**\n`;
    expect(fingerprint(before)).not.toBe(fingerprint(after));
  }
});

it.each(["\n", "\r\n", "\r"])("wraps body entities with %j line endings (#863)", (eol) => {
  const original =
    "- saddle needle __ember__ *zephyr amber* candle anchor basket \n" +
    "  * engine fern walnut [kettle signal](page.md) lantern ribbon\n" +
    "    __lantern__ &copy;";
  for (const eof of ["", "\n"]) {
    const source = (original + eof).replaceAll("\n", eol);
    for (const rules of [undefined, { "style/wrap": "warn" }] as const) {
      const config: Config = rules
        ? { extends: [], dialect: "vitepress", rules }
        : { extends: ["recommended", "vitepress"], dialect: "vitepress" };
      const result = format(source, { config });
      expect(result.diagnostics).toEqual([]);
      expect(result.output).toContain(`${eol}    &copy;`);
      expect(fingerprint(result.output)).toBe(fingerprint(source));
      expect(format(result.output, { config }).output).toBe(result.output);
    }
  }
});
