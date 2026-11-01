import { expect, it } from "vitest";
import { format, parse, semanticFingerprint } from "../../src/index.js";
import type { Config } from "../../src/index.js";
import { vitepressTokens } from "../../src/syntax/vitepress/projection.js";

const fingerprint = (source: string) => semanticFingerprint(parse(source, "vitepress"));

it.each(["&copy;", "&amp;", "\\&", "&#169;", "&#xA9;", "&#xD800;", "&#0;", "&NotEqualTilde;"])(
  "compares single and joined body %s without changing cached tokens (#863)",
  (entity) => {
    const source = `**x**\n${entity}\nTail\n`;
    const document = parse(source, "vitepress");
    const tokens = vitepressTokens(document);
    const before = JSON.stringify(tokens);
    expect(semanticFingerprint(document)).toBe(fingerprint(`**x** ${entity}\nTail\n`));
    expect(vitepressTokens(document)).toBe(tokens);
    expect(JSON.stringify(tokens)).toBe(before);
  },
);

it.each(["&#x80;", "&#xFFFF;", "&#xFDD0;", "&#1;", "&#32;", "&NewLine;", "&#12;", "&lbrace;"])(
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
])("keeps contextual and literal entity distinctions in %s (#863)", (before, after) => {
  expect(fingerprint(before)).not.toBe(fingerprint(after));
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
