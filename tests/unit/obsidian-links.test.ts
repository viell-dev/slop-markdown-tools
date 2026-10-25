import { describe, expect, it } from "vitest";
import { format, lint, createWorkspace } from "../../src/index.js";
import type { Config, ProcessOptions } from "../../src/index.js";
import { formatted } from "../support/engine.js";
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
  it("preserves multiline comments including blank lines and apparent Markdown", () => {
    const source = "%%\n*hidden emphasis*\n\n[[Missing]]\n\n# Hidden heading\n%%\n\n*visible*\n";
    const output = formatted(source, { workspace, config, path: "note.md" });
    expect(output).toBe(source.replace("*visible*", "_visible_"));
    expect(lint(output, { workspace, config, path: "note.md" })).toEqual([]);
  });
  it("preserves inline comments spanning soft lines", () => {
    const source = "Text %% hidden\n*emphasis* [[Missing]] %% after.\n";
    expect(formatted(source, { workspace, config, path: "note.md" })).toBe(source);
  });
  it.each(["\n", "\r\n"])(
    "preserves inline comments spanning several physical lines (%j)",
    (newline) => {
      for (const prefix of ["", "> ", "- "]) {
        const continuation = prefix === "- " ? "  " : prefix;
        const source = `${prefix}Before %% hidden${newline}${continuation}*hidden* [[Missing]]${newline}${continuation}still hidden %% after.${newline}`;
        expect(formatted(source, { config, workspace, path: "note.md" })).toBe(source);
        expect(lint(source, { config, workspace, path: "note.md" })).toEqual([]);
      }
    },
  );
  it("preserves comments inside quote containers", () => {
    const source = "> %%\n> *hidden* [[Missing]]\n>\n> %%\n\n*visible*\n";
    expect(formatted(source, { workspace, config, path: "note.md" })).toBe(
      source.replace("*visible*", "_visible_"),
    );
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
  it("resolves shortened Obsidian Markdown links and preserves their targets during conversion", () => {
    expect(workspace.resolve("note.md", "Target", "obsidian").target).toBe("folder/Target.md");
    const output = formatted("[[Target|label]]\n", {
      path: "note.md",
      workspace,
      config: { ...config, rules: { "links/notation": ["warn", { style: "markdown" }] } },
    });
    expect(output).toBe("[label](<Target>)\n");
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
