import { describe, expect, it } from "vitest";
import { createWorkspace, format, parse, semanticFingerprint } from "../../src/index.js";
import type { Config } from "../../src/index.js";

const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
const config: Config = {
  extends: [],
  dialect: "obsidian",
  rules: { "style/wrap": ["warn", { width: 30 }], "style/emphasis": "warn" },
};
function checked(source: string, settings = config) {
  const options = { config: settings, workspace };
  const result = format(source, options);
  expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  expect(semanticFingerprint(parse(result.output, "obsidian"))).toBe(
    semanticFingerprint(parse(source, "obsidian")),
  );
  expect(format(source, { config: { extends: [], dialect: "obsidian" }, workspace }).output).toBe(
    source,
  );
  return result.output;
}
function variants(source: string, output = source) {
  for (const newline of ["\n", "\r\n", "\r"])
    for (const bom of ["", String.fromCharCode(0xfeff)])
      expect(checked(bom + source.replaceAll("\n", newline))).toBe(
        bom + output.replaceAll("\n", newline),
      );
}

describe("Obsidian reference-like container lines (#411)", () => {
  it("keeps the label beside the preceding word when wrapping a list item", () => {
    variants(
      "1. words before [a]: <https://example.com/x> after\n",
      "1. words\n   before [a]: <https://example.com/x>\n   after\n",
    );
  });
  it.each([
    ["- ", "  "],
    ["1. ", "   "],
    ["> ", "> "],
    ["> > ", "> > "],
    ["> - ", ">   "],
    ["- - ", "    "],
    [" ", " "],
  ])("keeps an existing reference line below %j", (first, next) => {
    for (const tail of [
      "https://example.com/x",
      "<https://example.com/x>",
      "word",
      "#frag",
      "relative.md",
    ])
      variants(`${first}before\n${next}[a]: ${tail}\n${next}after\n`);
  });
  it.each(["    ", "\t"])("keeps an indented paragraph continuation with %j", (indent) => {
    variants(`before\n${indent}[a]: https://example.com/x\nafter\n`);
  });
  it.each([
    "> before\n> [a]:\n> https://example.com/x\n> after\n",
    "1. before\n   [a]:\n   <https://example.com/x>\n   after\n",
    "> before\n> [a]:\n>\n> ordinary *after*\n",
    "> before\n> [a]:\n> *word* ordinary after\n",
    "> before\n> [a\n> b]: https://example.com/x after\n",
    "before [a\nb]: word after\n",
    "> before [a[b]: https://example.com/x ordinary after\n",
    "> before [a]:\thttps://example.com/x ordinary after\n",
  ])("keeps a pending or split reference label in %j", (source) => variants(source));
  it("keeps all of a long label on one line", () => {
    const label = "[a label with several words inside it]:";
    const output = checked(`> Some words before ${label} word after\n`);
    expect(output).toContain(`before ${label}`);
    expect(output).not.toContain("> [a");
  });
  it("keeps ordinary wrapping on a list's marker line", () => {
    expect(checked("- [a]: word ordinary after and enough words to wrap at thirty columns\n")).toBe(
      "- [a]: word ordinary after and\n  enough words to wrap at\n  thirty columns\n",
    );
  });
  it.each([
    "> before\n> \\[a]: https://example.com/x\n> ordinary after\n",
    "> before\n> `[a]: https://example.com/x`\n> ordinary after\n",
    "> before\n> [a] : https://example.com/x\n> ordinary after\n",
  ])("still wraps non-definition control %j", (source) => {
    expect(
      checked(source, { ...config, rules: { "style/wrap": ["warn", { width: 80 }] } }),
    ).not.toBe(source);
  });
  it("keeps independent inline and later paragraph formatting", () => {
    expect(checked("> *before*\n> [a]: word\n> after *it*\n\nLater *text*.\n")).toBe(
      "> _before_\n> [a]: word\n> after _it_\n\nLater _text_.\n",
    );
  });
});

describe("Obsidian HTML continued outside a container (#428)", () => {
  it.each([
    "- <div> a\n*b*\n",
    "> <section> a\n*b*\n",
    "- <span>\n*b*\n",
    "- <x-probe>\n*b*\n",
    "- <script>\n*b*\n",
    "- <pre>\n*b*\n",
    "- <textarea>\n*b*\n",
    "- <!-- a\n*b*\n",
    "- <?probe a\n*b*\n",
    "- <!DOCTYPE probe\n*b*\n",
    "- <![CDATA[a\n*b*\n",
    "1. item\n   - <div> a\n   *b*\n",
    "> - <div> a\n*b*\n",
    "- > <div> a\n*b*\n",
    "- <div> a\n*b*",
    "- <div> a\n*b*\n\nAfter *c*.\n",
    "- <!-->\n*b*\n\nAfter *c*.\n",
    "- <!--->\n*b*\n\nAfter *c*.\n",
    "- <?>\n*b*\n\nAfter *c*.\n",
  ])("keeps the literal region in %j", (source) => variants(source));
  it.each([
    ["<script>", "</script>"],
    ["<pre>", "</pre>"],
    ["<!-- a", "-->"],
    ["<?probe a", "?>"],
    ["<!DOCTYPE probe", ">"],
    ["<![CDATA[a", "]]>"],
  ])("stops an explicitly terminated %s region", (open, close) => {
    variants(
      `- ${open}\n*b*\n${close}\n*c*\n\nAfter *d*.\n`,
      `- ${open}\n*b*\n${close}\n_c_\n\nAfter _d_.\n`,
    );
  });
  it.each(["<div></div>", "<div/>", "<hr>", "<br>", "<x-probe/>"])(
    "keeps Reading view's raw text after %s until a blank line",
    (tag) => variants(`- ${tag}\n*b*\n\nAfter *c*.\n`, `- ${tag}\n*b*\n\nAfter _c_.\n`),
  );
  it("keeps the longer of the two views' regions", () => {
    variants(
      "- <div> a\n*b*\n\nAfter *c*\n</div>\nOutside *d*\n\nIndependent *e*\n",
      "- <div> a\n*b*\n\nAfter *c*\n</div>\nOutside *d*\n\nIndependent _e_\n",
    );
  });
  it("waits for the outer tag's closer", () => {
    variants(
      "- <div><span> a\n*b*\n</span>\n*c*\n</div>\n*d*\n\nAfter *e*\n",
      "- <div><span> a\n*b*\n</span>\n*c*\n</div>\n*d*\n\nAfter _e_\n",
    );
  });
  it("keeps a quoted closing tag from ending the HTML region", () => {
    variants(
      '- <div title="</div>"> a\n*b*\n</div>\n*c*\n\nAfter *d*\n',
      '- <div title="</div>"> a\n*b*\n</div>\n*c*\n\nAfter _d_\n',
    );
  });
  it.each(["\\<div>", "`<div>`", "<span>text</span>"])(
    "still formats an inline or escaped control %s",
    (tag) => {
      expect(checked(`- ${tag} a\n*b*\n\nAfter *c*.\n`)).toContain("_b_");
    },
  );
});

describe("Obsidian quotes on a list marker line (#429)", () => {
  it.each([
    "1. > words inside a block quote on a list marker line\n",
    "- > words inside a block quote on a list marker line\n",
    "- > first words\n  > other words on a quote continuation\n",
    "> - > words inside a nested quote on the list marker line\n",
    "- - > words inside a nested quote on the list marker line\n",
    "- >> words inside a doubly nested quote on the marker line\n",
  ])("keeps the first-line boundary in %j", (source) => variants(source));
  it("still applies inline style rules", () => {
    expect(checked("- > Some *words* on a list marker line and many other words.\n")).toBe(
      "- > Some _words_ on a list marker line and many other words.\n",
    );
  });
  it("still wraps a later paragraph in the same quote", () => {
    const source =
      "- > First line kept here.\n  >\n  > A later paragraph with many words that should wrap at thirty columns.\n";
    const output = checked(source);
    expect(output.startsWith("- > First line kept here.\n  >\n")).toBe(true);
    expect(output).toContain("  > A later paragraph with\n  > many words");
  });
  it.each([
    "- Item\n\n  > ordinary quote after a paragraph with enough words to wrap\n",
    "-\n  > ordinary quote beginning below an empty list marker with many words\n",
    "> ordinary quote outside a list with enough words to wrap at thirty columns\n",
  ])("still wraps ordinary quote control %j", (source) => {
    expect(checked(source)).not.toBe(source);
  });
});
