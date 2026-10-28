import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { lint } from "../../src/index.js";
import type { Dialect } from "../../src/index.js";
import { formatted, only } from "../support/rules.js";
const dialects: Dialect[] = ["commonmark", "github", "forgejo", "gitea", "obsidian", "vitepress"];
describe("link notation checks", () => {
  it.each(dialects)("reports reversed destinations only in prose (%s)", (dialect) => {
    const config = only({ "links/reversed": "warn" }, dialect);
    for (const destination of [
      "https://example.com",
      "a@example.com",
      "a/b",
      "./a",
      "../b",
      "#part",
      "file.md",
    ]) {
      const source = `(text)[${destination}]\n`;
      expect(lint(source, { config }), source).toHaveLength(1);
      expect(formatted(source, config)).toBe(source);
    }
    for (const source of [
      "(Smith 2020)[1]",
      "(see above)[note]",
      "(text)[^1]",
      "(text)[[file.md]]",
      "`(text)[file.md]`",
      "<div>\n(text)[file.md]\n</div>",
      "<span>(text)[file.md]</span>",
      "[a (text)[file.md]](target)",
      "[a](https://example.com/(text)[file.md])",
      "(text)[FILE.MD]\n\n[file.md]: target",
      "(text)[STRASSE.MD]\n\n[Straße.md]: target",
      "- [x] task",
    ]) {
      expect(lint(source, { config }), source).toEqual([]);
    }
    if (dialect !== "commonmark" && dialect !== "vitepress")
      expect(lint("$(text)[file.md]$", { config })).toEqual([]);
    if (dialect === "forgejo" || dialect === "gitea")
      expect(lint("\\((text)[file.md]\\)", { config })).toEqual([]);
  });
  it.each(dialects)("reports bare addresses and preserves authored syntax (%s)", (dialect) => {
    const config = only({ "links/bare-url": "warn" }, dialect);
    for (const ending of ["\n", "\r\n"]) {
      const source = `See https://example.com and a@example.com.${ending}`;
      expect(lint(source, { config })).toHaveLength(2);
      const output = formatted(source, config);
      if (dialect === "commonmark") expect(output).toBe(source);
      else expect(output).toBe(`See <https://example.com> and <a@example.com>.${ending}`);
    }
    for (const source of [
      "[https://example.com](target)",
      "![https://example.com](target)",
      "[a](https://example.com)",
      "[[Page|https://example.com]]",
      "<https://example.com>",
      "<https://example.com/a b>",
      "`https://example.com`",
      "```\nhttps://example.com\n```",
      "<div>\nhttps://example.com\n</div>",
      "<span>https://example.com</span>",
      "[a]: https://example.com",
      "[a]: https://example.com <!-- comment -->",
      "---\nurl: https://example.com\n---",
    ]) {
      expect(lint(source, { config }), source).toEqual([]);
    }
    if (dialect !== "commonmark" && dialect !== "vitepress")
      expect(lint("$https://example.com$", { config })).toEqual([]);
    // Extent comes from the renderer's parsed literal, never a greedy replacement.
    expect(formatted("https://example.com/foo).\n", config)).toContain(".\n");
    expect(formatted("https://example.com/a?x=1&y=2\n", config)).toBe(
      "https://example.com/a?x=1&y=2\n",
    );
  });
  it.each(dialects)("restricts parsed link and image forms (%s)", (dialect) => {
    const forms = {
      autolink: "<https://example.com>",
      inline: "[text](target)",
      full: "[text][LABEL]",
      collapsed: "[label][]",
      shortcut: "[LABEL]",
      urlInline: "[https://example.com](https://example.com)",
    };
    for (const [option, form] of Object.entries(forms)) {
      const source = `${form}\n\n[label]: target\n`;
      expect(lint(source, { config: only({ "links/allowed-notation": "warn" }, dialect) })).toEqual(
        [],
      );
      const config = only({ "links/allowed-notation": ["warn", { [option]: false }] }, dialect);
      expect(lint(source, { config }), option).toHaveLength(1);
      const output = formatted(source, config);
      expect(output).toBe(
        option === "urlInline" ? "<https://example.com>\n\n[label]: target\n" : source,
      );
      if (["inline", "full", "collapsed", "shortcut"].includes(option))
        expect(lint(`!${source}`, { config }), option).toHaveLength(1);
    }
    const config = only({ "links/allowed-notation": ["warn", { urlInline: false }] }, dialect);
    for (const source of [
      '[https://example.com](https://example.com "title")',
      "[https://example.com/a?x=1&y=2](https://example.com/a?x=1&y=2)",
      "[https://example.com/a\\*](https://example.com/a*)",
      "[https://example.com/a&amp;b](https://example.com/a&b)",
      "[https://example.com/a b](<https://example.com/a b>)",
    ]) {
      expect(formatted(source, config)).toBe(source);
    }
    expect(lint("[text](target)", { config })).toEqual([]);
    expect(
      lint("[STRASSE\tMD]\n\n[Straße MD]: target", {
        config: only({ "links/allowed-notation": ["warn", { shortcut: false }] }, dialect),
      }),
    ).toHaveLength(1);
  });
  it("validates boolean options", () => {
    expect(() =>
      lint("", { config: only({ "links/allowed-notation": ["warn", { inline: "no" }] }) }),
    ).toThrow("Invalid options");
  });
});

describe("rendered link preservation", () => {
  it("keeps exact HTML in independent CommonMark and markdown-it readers", () => {
    const writer = new HtmlRenderer();
    const parser = new Parser();
    const markdown = new MarkdownIt({ html: true, linkify: true });
    markdown.linkify.set({ fuzzyLink: false });
    for (const source of [
      "https://example.com.\n",
      "a@example.com\n",
      "https://example.com/a).\n",
      "https://example.com/a?x=1&y=2\n",
    ]) {
      const output = formatted(source, only({ "links/bare-url": "warn" }, "vitepress"));
      expect(markdown.render(output)).toBe(markdown.render(source));
      expect(formatted(source, only({ "links/bare-url": "warn" }))).toBe(source);
    }
    for (const source of [
      "[https://example.com](https://example.com)\n",
      "[https://example.com/a?x=1&y=2](https://example.com/a?x=1&y=2)\n",
    ]) {
      const output = formatted(
        source,
        only({ "links/allowed-notation": ["warn", { urlInline: false }] }),
      );
      expect(writer.render(parser.parse(output))).toBe(writer.render(parser.parse(source)));
      expect(markdown.render(output)).toBe(markdown.render(source));
    }
  });
});
