import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  format,
  lint,
  parse,
  resolveConfig,
  createWorkspace,
  applyEdits,
  semanticFingerprint,
} from "../src/index.js";
import type { Config, Plugin, ProcessOptions } from "../src/index.js";

const narrow: Config = {
  extends: ["recommended", "github"],
  rules: { "style/wrap": ["warn", { width: 35 }] },
};
function formatted(source: string, options: ProcessOptions = {}) {
  const result = format(source, options);
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  return result.output;
}
describe("formatting contracts", () => {
  it("preserves genuine lists following prose", () => {
    const source = "Some items follow\n- First item\n- Second item\n";
    expect(formatted(source)).toBe(source);
  });
  it("reflows prose while protecting inline code and links", () => {
    const source =
      "A *small* paragraph with `some inline code` and [a link](https://example.test/path) followed by more words.\n";
    const output = formatted(source, { config: narrow });
    expect(output).toContain("_small_");
    expect(output).toContain("`some inline code`");
    expect(output).toContain("[a link](https://example.test/path)");
    expect(output.split("\n").length).toBeGreaterThan(3);
  });
  it.each([
    "- A fairly long paragraph inside a list item that requires wrapping with the correct indentation.\n",
    "> A fairly long paragraph inside a blockquote that requires wrapping with the correct quotation prefix.\n",
    "> - A fairly long paragraph inside a quoted list that requires wrapping without changing structure.\n",
    "- [X] A fairly long task item that requires wrapping while retaining its completed state.\n",
    "A sentence about numbers 1. and 2. and the literal symbols # and > that must stay ordinary prose.\n",
    "Use ``an `embedded` backtick`` and more words in a long line to exercise code span preservation.\n",
    "Escaped \\*literal\\* syntax and &amp; entities remain spelled the same after a paragraph is reflowed.\n",
  ])("preserves semantics in containers and inline syntax: %s", (source) => {
    const output = formatted(source, { config: narrow });
    expect(semanticFingerprint(parse(output, "github"))).toBe(
      semanticFingerprint(parse(source, "github")),
    );
  });
  it("preserves explicit hard breaks, front matter, code, and HTML", () => {
    const source =
      "---\ntitle: '*unchanged*'\n---\n\n```md\n*code* and [link](missing.md)\n```\n\nAn explicit break.  \nAnother line.\n\n<div>\n*raw*\n</div>\n";
    expect(formatted(source)).toBe(source);
  });
  it("does not lint links in multi-backtick code spans", () => {
    const source = "``[link](missing.md)``\n";
    const workspace = createWorkspace({ "note.md": source });
    expect(lint(source, { workspace, path: "note.md" })).toEqual([]);
  });
  it("preserves disabled style choices", () => {
    const source =
      "A *small* paragraph that needs to be wrapped into multiple lines without changing its emphasis.\n";
    const output = formatted(source, {
      config: { ...narrow, rules: { ...narrow.rules, "style/emphasis": "off" } },
    });
    expect(output).toContain("*small*");
    expect(output).not.toBe(source);
    expect(formatted(source, { config: { extends: [] } })).toBe(source);
  });
  it("preserves CRLF when editing", () => {
    expect(formatted("A *small* paragraph.\r\n")).toBe("A _small_ paragraph.\r\n");
  });
  it("leaves intraword emphasis valid", () => {
    expect(formatted("foo*bar*baz\n")).toBe("foo*bar*baz\n");
  });
  it("aligns tables without changing disabled inline style", () => {
    const input = "| A | B |\n| :- | -: |\n| *wide text* | `a\\|b` |\n";
    const output = formatted(input, {
      config: { extends: ["github"], rules: { "style/emphasis": "off" } },
    });
    expect(output).toContain("*wide text*");
    expect(output).toContain("`a\\|b`");
    expect(output).not.toBe(input);
  });
  it("normalizes GitHub alerts and preserves math and footnotes", () => {
    const source =
      "> [!note]\n> Some details.\n\n$x + y$ and ~~removed~~ with a note[^a].\n\n[^a]: *Reference*.\n";
    expect(formatted(source, { config: { extends: ["recommended", "github"] } })).toContain(
      "> [!NOTE]",
    );
  });
  it("has property-tested idempotence and semantic preservation for varied prose widths", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            "alpha",
            "bravo",
            "éclair",
            "日本語",
            "🙂",
            "*italic*",
            "`code span`",
            "[a](https://example.test)",
          ),
          { minLength: 1, maxLength: 70 },
        ),
        fc.integer({ min: 20, max: 110 }),
        (words, width) => {
          const source = words.join(" ") + "\n";
          const options = {
            config: { extends: ["recommended"], rules: { "style/wrap": ["warn", { width }] } },
          } satisfies ProcessOptions;
          const output = formatted(source, options);
          expect(semanticFingerprint(parse(output, "commonmark"))).toBe(
            semanticFingerprint(parse(source, "commonmark")),
          );
        },
      ),
      { numRuns: 120, seed: 20260918 },
    );
  });
});

describe("configuration and plugins", () => {
  it("supports defaults, overrides, and explicit empty presets", () => {
    expect(resolveConfig({}).rules["style/wrap"]).toBeDefined();
    expect(resolveConfig({ extends: [] }).rules).toEqual({});
    expect(
      resolveConfig(
        {
          overrides: [
            { files: ["vault/**/*.md"], dialect: "obsidian", rules: { "style/wrap": "off" } },
          ],
        },
        "vault/a.md",
      ).rules["style/wrap"],
    ).toBe("off");
  });
  it("rejects unknown configuration, rules, options, and preset cycles", () => {
    expect(() => lint("", { config: { rules: { typo: "warn" } } })).toThrow("Unknown rule");
    expect(() => lint("", { config: { rules: { "style/wrap": ["warn", { width: 2 }] } } })).toThrow(
      "Invalid options",
    );
    expect(() => resolveConfig({ typo: true } as Config)).toThrow("Invalid configuration");
    expect(() =>
      resolveConfig({ extends: ["local/a"] }, "a.md", [
        { name: "local", presets: { a: { extends: ["local/a"] } } },
      ]),
    ).toThrow("Circular");
  });
  it("supports custom diagnostics and rejects semantic-changing style plugins", () => {
    const plugin: Plugin = {
      name: "example",
      rules: {
        forbidden: {
          kind: "problem",
          description: "Detect a word",
          check: ({ document }) =>
            document.source.includes("secret") ? [{ start: 0, message: "Contains secret." }] : [],
        },
        destructive: {
          kind: "style",
          description: "Bad plugin",
          check: () => [
            { start: 0, message: "Replace", edit: { start: 0, end: 4, text: "other" } },
          ],
        },
      },
    };
    expect(
      lint("secret", {
        config: { extends: [], rules: { "example/forbidden": "error" } },
        plugins: [plugin],
      })[0]?.rule,
    ).toBe("example/forbidden");
    const result = format("word\n", {
      config: { extends: [], rules: { "example/destructive": "warn" } },
      plugins: [plugin],
    });
    expect(result.output).toBe("word\n");
    expect(result.diagnostics[0]?.rule).toBe("engine/unsafe-format");
  });
  it("rejects overlapping edits", () => {
    expect(() =>
      applyEdits("abc", [
        { start: 0, end: 2, text: "a" },
        { start: 1, end: 3, text: "b" },
      ]),
    ).toThrow("overlapping");
    expect(() => applyEdits("abc", [{ start: -1, end: 2, text: "a" }])).toThrow("invalid");
  });
});

describe("Obsidian and links", () => {
  const files = {
    "note.md": "# Note\n",
    "folder/Target.md": "# Target\n\n## Exact Heading\n\nA block. ^block-id\n",
    "picture.png": null,
  };
  const workspace = createWorkspace(files, { dialect: "obsidian", strictLineBreaks: true });
  const config: Config = { extends: ["recommended", "obsidian"] };
  it("parses and actively validates wiki links, embeds, headings, and blocks", () => {
    const source = "[[Target#Exact Heading|label]] ![[picture.png|200]] [[Target#^block-id]]\n";
    expect(lint(source, { workspace, config, path: "note.md" })).toEqual([]);
    expect(lint("[[Target#missing]]\n", { workspace, config, path: "note.md" })[0]?.rule).toBe(
      "links/valid",
    );
    expect(lint("![[missing.png]]\n", { workspace, config, path: "note.md" })[0]?.rule).toBe(
      "links/valid",
    );
  });
  it("ignores link-looking text in code and comments", () => {
    const source = "`[[Missing]]` %% [[Missing]] %% ==highlight==\n";
    expect(lint(source, { workspace, config, path: "note.md" })).toEqual([]);
    expect(formatted(source, { workspace, config, path: "note.md" })).toBe(source);
  });
  it("formats callouts without altering folding state or title", () => {
    expect(formatted("> [!NOTE]- Custom title\n> Details.\n", { config, workspace })).toBe(
      "> [!note]- Custom title\n> Details.\n",
    );
  });
  it("reports duplicate block IDs", () => {
    expect(
      lint("One. ^same\n\nTwo. ^same\n", { config, workspace }).some(
        (item) => item.rule === "obsidian/block-reference",
      ),
    ).toBe(true);
  });
  it("normalizes verified paths and retains titles", () => {
    const source = '[label](folder/Target.md#Exact%20Heading "title")\n';
    const output = formatted(source, {
      path: "note.md",
      workspace,
      config: {
        ...config,
        rules: { "links/path": ["warn", { style: "root", brackets: "angle", extension: "omit" }] },
      },
    });
    expect(output).toBe('[label](<folder/Target#Exact Heading> "title")\n');
  });
  it("converts explicit-label wikilinks and Markdown links", () => {
    const options = {
      path: "note.md",
      workspace,
      config: { ...config, rules: { "links/notation": ["warn", { style: "markdown" }] } },
    } satisfies ProcessOptions;
    expect(formatted("[[folder/Target|label]]\n", options)).toBe("[label](<folder/Target>)\n");
    options.config.rules["links/notation"] = ["warn", { style: "wiki" }];
    expect(formatted("[label](<folder/Target>)\n", options)).toBe("[[folder/Target|label]]\n");
  });
  it("does not guess ambiguous target names", () => {
    const ambiguous = createWorkspace(
      { "note.md": "", "a/Target.md": "", "b/Target.md": "" },
      { dialect: "obsidian" },
    );
    expect(ambiguous.resolve("note.md", "Target", "obsidian", true).status).toBe("ambiguous");
  });
  it("splits URL components before decoding escaped hashes", () => {
    const indexed = createWorkspace({ "note.md": "", "A#B.md": "# Heading\n" });
    expect(indexed.resolve("note.md", "A%23B.md#heading", "github")).toMatchObject({
      status: "resolved",
      target: "A#B.md",
      fragmentExists: true,
    });
  });
  it("uses GitHub duplicate-heading slugs and exact Obsidian headings", () => {
    const indexed = createWorkspace({ "note.md": "# A Heading\n\n## A Heading\n" });
    expect(indexed.resolve("note.md", "#a-heading-1", "github").fragmentExists).toBe(true);
    expect(indexed.resolve("note.md", "#A Heading", "obsidian").fragmentExists).toBe(true);
    expect(indexed.resolve("note.md", "#a-heading", "obsidian").fragmentExists).toBe(false);
  });
  it("refuses Obsidian reflow without verified soft-break behavior", () => {
    const source = "A deliberately short line\nfollowed by another deliberately short line.\n";
    const result = format(source, { config });
    expect(result.output).toBe(source);
    expect(result.diagnostics.some((item) => item.rule === "obsidian/strict-line-breaks")).toBe(
      true,
    );
  });
});
