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
    "- <!-- a --!>\n*b*\n\nAfter *c*.\n",
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
  it.each([
    "- <hr>\n> <div>\n\n*b*\n</div>\n\nAfter *c*.\n",
    "- <div></div>\n> <section>\n\n*b*\n</section>\n\nAfter *c*.\n",
    "- <hr>\n- <div>\n\n*b*\n</div>\n\nAfter *c*.\n",
    "- <hr><div>\n\n*b*\n</div>\n\nAfter *c*.\n",
    "- <hr>\n  <div>\n\n*b*\n</div>\n\nAfter *c*.\n",
    "- <div></div><section>\n\n*b*\n</section>\n\nAfter *c*.\n",
    "> - <hr>\n>   <div>\n\n*b*\n</div>\n\nAfter *c*.\n",
    "- - <hr><div>\n\n*b*\n</div>\n\nAfter *c*.\n",
  ])("keeps a later opener inside an earlier HTML region in %j", (source) => {
    variants(source, source.replaceAll("After *c*.", "After _c_."));
  });
  it("keeps the end of an unfinished later opener", () => {
    variants("- <hr><div>\n\n*b*");
  });
  it("still formats below consecutive closed HTML roots", () => {
    variants(
      "- <hr><div></div>\n\n*b*\n\nAfter *c*.\n",
      "- <hr><div></div>\n\n_b_\n\nAfter _c_.\n",
    );
  });
  it.each(["<!-- c -->", "<?probe ?>", "<!DOCTYPE probe>", "<![CDATA[c]]>"])(
    "keeps a later HTML root after the explicit token %s",
    (token) =>
      variants(
        `- ${token} <div>\n\n*b*\n</div>\n\nAfter *c*.\n`,
        `- ${token} <div>\n\n*b*\n</div>\n\nAfter _c_.\n`,
      ),
  );
  it("continues through later openers on a closing source line", () => {
    variants(
      "- <div>\n*b*\n</div><section>\n\n*c*\n</section>\n\nAfter *d*.\n",
      "- <div>\n*b*\n</div><section>\n\n*c*\n</section>\n\nAfter _d_.\n",
    );
  });
  it.each(["`<div>`", "\\<div>"])(
    "still formats below the Markdown control %s after a void root",
    (text) => {
      for (const between of [" ", "\n  "])
        variants(
          `- <hr>${between}${text}\n\n*b*\n\nAfter *c*.\n`,
          `- <hr>${between}${text}\n\n_b_\n\nAfter _c_.\n`,
        );
    },
  );
  it("scans consecutive void roots before an unclosed HTML root", () => {
    const html = "<hr>".repeat(4000) + "<div>";
    expect(checked(`- ${html}\n\n*b*\n</div>\n\nAfter *c*.\n`)).toBe(
      `- ${html}\n\n*b*\n</div>\n\nAfter _c_.\n`,
    );
  });
  it.each(["`", "``"])("ends an inactive %s code run with its physical line", (tick) => {
    variants(
      `- <hr> ${tick}\n  <div>\n  ${tick}\n\n*b*\n</div>\n\nAfter *c*.\n`,
      `- <hr> ${tick}\n  <div>\n  ${tick}\n\n*b*\n</div>\n\nAfter _c_.\n`,
    );
    variants(
      `- <hr> ${tick}<div>\n\n*b*\n</div>\n\nAfter *c*.\n`,
      `- <hr> ${tick}<div>\n\n_b_\n</div>\n\nAfter _c_.\n`,
    );
  });
  it("lets a backslash-preceded backtick close an inactive code span", () => {
    variants(
      "- <hr> `a\\` <div> `\n\n*b*\n</div>\n\nAfter *c*.\n",
      "- <hr> `a\\` <div> `\n\n*b*\n</div>\n\nAfter _c_.\n",
    );
  });
  it.each(["<https://example.com>", "<a@example.org>"])(
    "keeps the autolink control %s from opening HTML mode",
    (link) => variants(`- <hr> ${link}\n\nAfter *c*.\n`, `- <hr> ${link}\n\nAfter _c_.\n`),
  );
  it("still recognizes a custom HTML root after a void root", () => {
    variants(
      "- <hr> <x-probe>\n\n*b*\n</x-probe>\n\nAfter *c*.\n",
      "- <hr> <x-probe>\n\n*b*\n</x-probe>\n\nAfter _c_.\n",
    );
  });
  it.each(["<!-- </div> -->", "<?probe </div> ?>", "<![CDATA[</div>]]>"])(
    "keeps a closing tag inside %s from ending the HTML region",
    (token) =>
      variants(
        `- <div>\n${token}\n\n*b*\n</div>\n\nAfter *c*.\n`,
        `- <div>\n${token}\n\n*b*\n</div>\n\nAfter _c_.\n`,
      ),
  );
  it("scans many tags and comments before the container's HTML closer", () => {
    const html = "<x-probe/> <!-- </div> --> ".repeat(2000);
    expect(checked(`- <div>\n${html}\n\n*b*\n</div>\n\nAfter *c*.\n`)).toBe(
      `- <div>\n${html}\n\n*b*\n</div>\n\nAfter _c_.\n`,
    );
  });
  it.each(["\\<div>", "`<div>`", "<span>text</span>"])(
    "still formats an inline or escaped control %s",
    (tag) => {
      expect(checked(`- ${tag} a\n*b*\n\nAfter *c*.\n`)).toContain("_b_");
    },
  );
});

describe("Obsidian code mode after a contained HTML root (#433)", () => {
  const source = "- <hr> ```\n  <div>\n  ```\n\n*b*\n</div>\n\nAfter *c*.\n";
  it("keeps the unfinished code region", () => variants(source));
  it("keeps its EOF under the recommended preset", () => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)]) {
        const input = bom + source.trimEnd().replaceAll("\n", newline);
        expect(checked(input, { extends: ["recommended", "obsidian"], dialect: "obsidian" })).toBe(
          input,
        );
      }
  });
  it("isolates final-newline protection to the unfinished transition", () => {
    const settings: Config = {
      extends: [],
      dialect: "obsidian",
      rules: { "style/final-newline": "warn" },
    };
    expect(checked(source.trimEnd(), settings)).toBe(source.trimEnd());
    const control = "- <hr> `<div>`\n\nAfter *c*.";
    expect(checked(control, settings)).toBe(control + "\n");
  });
  it("protects a long inline run without a later closer", () => {
    variants("- <hr> ```<div>\n\n*b*\n</div>\n\nAfter *c*.\n");
  });
  it.each([
    "- <hr> ```<div>```\n\n*b*\n\nAfter *c*.\n",
    "- <hr> ```\n  <div>\n  words ```\n\n*b*\n</div>\n\nAfter *c*.\n",
  ])("still formats below the confirmed code end in %j", (input) => {
    variants(input, input.replaceAll("*b*", "_b_").replaceAll("*c*", "_c_"));
  });
  it.each(["commonmark", "github", "forgejo", "gitea"] as const)(
    "keeps ordinary emphasis formatting in the %s dialect",
    (dialect) => {
      const result = format(source, {
        config: { extends: [], dialect, rules: { "style/emphasis": "warn" } },
      });
      expect(result.output).toContain("_b_");
      expect(result.output).toContain("After _c_.");
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
