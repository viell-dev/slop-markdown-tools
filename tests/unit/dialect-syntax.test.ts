import { describe, expect, it } from "vitest";
import {
  canonicalDialect,
  createWorkspace,
  lint,
  parse,
  resolveConfig,
  textContent,
} from "../../src/index.js";
import type { RuleSetting } from "../../src/index.js";
import { only, formatted } from "../support/rules.js";
describe("dialect markers", () => {
  it("leaves unknown GitHub alert types and known Obsidian types alone", () => {
    const github = only({ "github/alert-marker": "warn" }, "github");
    expect(formatted("> [!foo]\n> Text.\n", github)).toBe("> [!foo]\n> Text.\n");
    expect(formatted("> [!tip]\n> Text.\n", github)).toBe("> [!TIP]\n> Text.\n");
    const obsidian = only({ "obsidian/callout-marker": "warn" }, "obsidian");
    expect(formatted("> [!Custom-Type]- Title\n", obsidian)).toBe("> [!custom-type]- Title\n");
    expect(formatted("> [!note]\n", obsidian)).toBe("> [!note]\n");
  });
  it.each(["github", "forgejo", "gitea"] as const)(
    "changes only markers that GitHub shows as alerts on %s",
    (dialect) => {
      // GitHub shows these markers as text, whose letters would change (issue #334).
      const github = only({ "github/alert-marker": "warn" }, dialect);
      for (const source of [
        "> > [!note]\n> > Read.\n",
        "- > [!note]\n  > Read.\n",
        "> [!note] Read this.\n",
        "> [!note]\n",
        "> [!note]   \n",
        "Text.\n\n> Quote.\n>\n> > [!note]\n> > Read.\n",
      ])
        expect(formatted(source, github)).toBe(source);
      // A marker alone on its line, with content below it in the quote.
      for (const [source, output] of [
        ["> [!note]\n> Read.\n", "> [!NOTE]\n> Read.\n"],
        ["> [!tip] \t\n> Read.\n", "> [!TIP] \t\n> Read.\n"],
        ["> [!note]\n>\n> Read.\n", "> [!NOTE]\n>\n> Read.\n"],
        ["> [!note]\n> - One.\n", "> [!NOTE]\n> - One.\n"],
      ] as const)
        expect(formatted(source, github)).toBe(output);
    },
  );
  it("still lowercases Obsidian callouts in nested quotes and with titles", () => {
    const obsidian = only({ "obsidian/callout-marker": "warn" }, "obsidian");
    expect(formatted("> > [!NOTE] Title\n> > Body.\n", obsidian)).toBe(
      "> > [!note] Title\n> > Body.\n",
    );
  });
  it("leaves a marker that Obsidian shows as text, after more than one space", () => {
    // Obsidian reads a callout only where its marker follows the quote's `>`
    // and at most one space (issue #360).
    const obsidian = only({ "obsidian/callout-marker": "warn" }, "obsidian");
    for (const [source, output] of [
      [">[!NOTE] T\n", ">[!note] T\n"],
      ["> [!NOTE] T\n", "> [!note] T\n"],
      [">> [!NOTE] T\n", ">> [!note] T\n"],
      ["- > [!NOTE] T\n", "- > [!note] T\n"],
      [">  [!NOTE] T\n", ">  [!NOTE] T\n"],
      [">   [!NOTE]\n> body\n", ">   [!NOTE]\n> body\n"],
      [">>  [!Important] signal\n", ">>  [!Important] signal\n"],
      ["> >  [!NOTE] T\n", "> >  [!NOTE] T\n"],
    ] as const)
      expect(formatted(source, obsidian), JSON.stringify(source)).toBe(output);
  });
  it("applies GitHub alert casing to Forgejo documents only among GFM dialects", () => {
    const rules: Record<string, RuleSetting> = { "github/alert-marker": "warn" };
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "forgejo"))).toBe("> [!TIP]\n> Text.\n");
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "commonmark"))).toBe("> [!tip]\n> Text.\n");
  });
  it("applies GitHub alert casing to Gitea documents", () => {
    const rules: Record<string, RuleSetting> = { "github/alert-marker": "warn" };
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "gitea"))).toBe("> [!TIP]\n> Text.\n");
  });
  it("provides a Gitea preset with the GitHub rules", () => {
    expect(resolveConfig({ config: { extends: ["gitea"] } })).toMatchObject({
      dialect: "gitea",
      rules: {
        "github/task-marker": "warn",
        "github/alert-marker": "warn",
        "style/table": "warn",
        "forgejo/heading-id": "error",
      },
    });
    expect(canonicalDialect("gitea")).toBe("gitea");
  });
  it("provides Forgejo and Codeberg presets and accepts aliases in overrides", () => {
    const rules = {
      "github/task-marker": "warn",
      "github/alert-marker": "warn",
      "style/table": "warn",
      "forgejo/heading-id": "error",
    };
    expect(resolveConfig({ config: { extends: ["forgejo"] } })).toMatchObject({
      dialect: "forgejo",
      rules,
    });
    expect(resolveConfig({ config: { extends: ["codeberg"] } })).toMatchObject({
      dialect: "forgejo",
      rules,
    });
    expect(resolveConfig({ config: { dialect: "codeberg" } }).dialect).toBe("forgejo");
    expect(
      resolveConfig({
        config: { overrides: [{ files: ["forge/**"], dialect: "codeberg" }] },
        path: "forge/a.md",
      }).dialect,
    ).toBe("forgejo");
    expect(canonicalDialect("codeberg")).toBe("forgejo");
    expect(canonicalDialect("github")).toBe("github");
  });
});

describe("Obsidian syntax at the end of a document", () => {
  const config = only({ "style/emphasis": "warn", "links/valid": "error" }, "obsidian");
  const workspace = createWorkspace({ "Doc.md": "" }, { dialect: "obsidian" });
  it.each([
    "%%\n*hidden* [[Missing]]\n%%",
    "%%\n*hidden* [[Missing]]\n",
    "%%\n*hidden* [[Missing]]",
  ])("keeps a block comment ending at EOF intact (%j)", (source) => {
    expect(formatted(source, config, { path: "Doc.md", workspace })).toBe(source);
    expect(lint(source, { config, path: "Doc.md", workspace })).toEqual([]);
  });
  it("excludes comment text from text content", () => {
    expect(textContent(parse("Text %% hidden %% more\n", "obsidian").tree)).toBe("Text  more");
    expect(textContent(parse("[[Note|label]] [[Other]]\n", "obsidian").tree)).toBe("label Other");
    expect(textContent(parse("---\n", "obsidian").tree)).toBe("");
  });
});

describe("Obsidian comments that start a line", () => {
  // Obsidian reads a comment as inline wherever a paragraph is open, also at
  // the start of a line below it, and when text follows it on its line (#357).
  const blocks = (source: string) =>
    parse(source, "obsidian").tree.children.map((node) => node.type);
  it("reads such a comment as part of the paragraph", () => {
    expect(blocks("a\n%%c%% d\n")).toEqual(["paragraph"]);
    expect(blocks("a\n%%\nc\n%%\n")).toEqual(["paragraph"]);
    expect(blocks("%%c%% d\nx\n")).toEqual(["paragraph"]);
    const item = parse("- a\n  %%c%% d\n", "obsidian").tree.children[0];
    expect(item?.type === "list" && item.children[0]?.children.map((node) => node.type)).toEqual([
      "paragraph",
    ]);
    expect(textContent(parse("a\n%%c%% d\n", "obsidian").tree)).toBe("a\n d");
  });
  it("still reads a comment that stands on its own lines as a block", () => {
    expect(blocks("a\n\n%%c%%\n\nb\n")).toEqual(["paragraph", "obsidianComment", "paragraph"]);
    expect(blocks("%%\none\n\ntwo\n%%\n")).toEqual(["obsidianComment"]);
    // Blank space, spaces or tabs, may follow the closing `%%`.
    for (const source of ["%%c%%  \n", "%%c%%\t\n", "%%c%% \t \n"])
      expect(blocks(source), JSON.stringify(source)).toEqual(["obsidianComment"]);
  });
  it("reads an empty comment as a comment, as Obsidian hides it", () => {
    expect(textContent(parse("a %%%% b\n", "obsidian").tree)).toBe("a  b");
    expect(textContent(parse("a\n%%%%\nb\n", "obsidian").tree)).toBe("a\n\nb");
    expect(blocks("%%%%\n")).toEqual(["obsidianComment"]);
    // `====` and `[[]]` stay text.
    expect(textContent(parse("a ==== b [[]]\n", "obsidian").tree)).toBe("a ==== b [[]]");
  });
  it("keeps the hard break above such a comment", () => {
    const config = only({ "style/trailing-space": "warn" }, "obsidian");
    for (const source of ["a  \n%%c%% d\n", "- [x] a  \n  %%c%% d\n"])
      expect(formatted(source, config), JSON.stringify(source)).toBe(source);
  });
  it("wraps such a comment with its paragraph", () => {
    const config = only({ "style/wrap": ["warn", { width: 80 }] }, "obsidian");
    const workspace = createWorkspace(
      { "Doc.md": "" },
      { dialect: "obsidian", strictLineBreaks: true },
    );
    expect(formatted("Some text\n%%c%% and more.\n", config, { path: "Doc.md", workspace })).toBe(
      "Some text %%c%% and more.\n",
    );
  });
});
