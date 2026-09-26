import { describe, expect, it } from "vitest";
import {
  applyEdits,
  canonicalDialect,
  createWorkspace,
  format,
  lint,
  parse,
  resolveConfig,
  semanticFingerprint,
  textContent,
} from "../src/index.js";
import type { Config, Dialect, Plugin, RuleSetting } from "../src/index.js";

function only(rules: Record<string, RuleSetting>, dialect: Dialect = "commonmark"): Config {
  return { extends: [], dialect, rules };
}
/** Format, require no engine diagnostics, and require idempotence. */
function formatted(source: string, config: Config, options: Record<string, unknown> = {}) {
  const result = format(source, { config, ...options });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config, ...options }).output).toBe(result.output);
  return result.output;
}

describe("style/heading", () => {
  const config = only({ "style/heading": "warn" });
  it.each([
    ["Title\n=====\n", "# Title\n"],
    ["Sub\n---\n", "## Sub\n"],
    ["*Title* with `code`\n===\n", "# *Title* with `code`\n"],
    ["C#\n---\n", "## C#\n"],
    ["Sharp #\n---\n", "## Sharp \\#\n"],
    ["Sharp ##\n===\n", "# Sharp \\##\n"],
    ["Sharp \\#\n---\n", "## Sharp \\#\n"],
  ])("converts %j to an ATX heading", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
  it("reports the conversion with the proposed text", () => {
    const [finding] = lint("Title\n===\n", { config });
    expect(finding).toMatchObject({ rule: "style/heading", line: 1, column: 1 });
    expect(finding?.edit?.text).toBe("# Title");
  });
  it.each([
    ["# Already ATX\n"],
    ["Line one\nLine two\n---\n"],
    ["- Item\n  ---\n"],
    ["> Quoted\n> ---\n"],
  ])("leaves %j unchanged", (source) => {
    expect(formatted(source, config)).toBe(source);
    expect(lint(source, { config })).toEqual([]);
  });
});

describe("style/emphasis and style/strong next to other delimiters", () => {
  const config = only({ "style/emphasis": "warn", "style/strong": "warn" });
  it.each(["_*foo*_", "*_foo_*", "_foo_*bar*", "*foo*_bar", "bar_*foo*", "*__foo__*", "__*foo*__"])(
    "leaves %s alone because the new marker would touch an existing one",
    (source) => {
      expect(formatted(`${source}\n`, config)).toBe(`${source}\n`);
      expect(lint(`${source}\n`, { config })).toEqual([]);
    },
  );
  it.each([
    ["***foo***\n", "_**foo**_\n"],
    ["___foo___\n", "_**foo**_\n"],
    ["*foo* *bar*\n", "_foo_ _bar_\n"],
    ["**foo** __bar__\n", "**foo** **bar**\n"],
    ["*foo*(bar)\n", "_foo_(bar)\n"],
  ])("still converts %j", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
});

describe("links/path wikilink rewriting", () => {
  const workspace = createWorkspace(
    { "Doc.md": "", "Folder/Note.md": "# Heading\n", "Other/Dup.md": "", "Folder/Dup.md": "" },
    { dialect: "obsidian" },
  );
  const rewrite = (rules: Record<string, RuleSetting>, source: string) =>
    formatted(source, only(rules, "obsidian"), { path: "Doc.md", workspace });
  it("normalizes aliased links and embeds but not bare wikilinks", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "root", extension: "omit" }],
    };
    expect(rewrite(rules, "[[Folder/Note.md|label]]\n")).toBe("[[Folder/Note|label]]\n");
    expect(rewrite(rules, "![[Folder/Note.md]]\n")).toBe("![[Folder/Note]]\n");
    expect(rewrite(rules, "[[Folder/Note.md#Heading|label]]\n")).toBe(
      "[[Folder/Note#Heading|label]]\n",
    );
    // A bare wikilink's target is also its label; changing it would change the rendering.
    expect(rewrite(rules, "[[Folder/Note.md]]\n")).toBe("[[Folder/Note.md]]\n");
    expect(rewrite(rules, "[[Folder/Note|label]]\n")).toBe("[[Folder/Note|label]]\n");
  });
  it("shortens to a basename only when the basename resolves to the same note", () => {
    const rules: Record<string, RuleSetting> = { "links/path": ["warn", { style: "shortest" }] };
    expect(rewrite(rules, "[[Folder/Note|label]]\n")).toBe("[[Note|label]]\n");
    expect(rewrite(rules, "[[Folder/Dup|label]]\n")).toBe("[[Folder/Dup|label]]\n");
  });
  it("adds a leading dot to relative destinations on request", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "relative", leadingDot: true }],
    };
    expect(rewrite(rules, "[[Folder/Note.md|label]]\n")).toBe("[[./Folder/Note.md|label]]\n");
    expect(formatted("[label](Folder/Note.md)\n", only(rules), { path: "Doc.md", workspace })).toBe(
      "[label](./Folder/Note.md)\n",
    );
  });
});

describe("links/path destination parsing", () => {
  const workspace = createWorkspace(
    { "Doc.md": "", "Folder/Note.md": "", "Folder/Note(1).md": "", "a>b.md": "" },
    { dialect: "commonmark" },
  );
  const angle = only({ "links/path": ["warn", { style: "relative", brackets: "angle" }] });
  const bare = only({ "links/path": ["warn", { style: "relative", brackets: "bare" }] });
  it.each([
    ["[a\\]b](./Folder/Note.md)\n", angle, "[a\\]b](<Folder/Note.md>)\n"],
    ["![a [b] c](./Folder/Note.md)\n", angle, "![a [b] c](<Folder/Note.md>)\n"],
    ["[a](<./Folder/Note.md>)\n", bare, "[a](Folder/Note.md)\n"],
    ["[a](<./a\\>b.md>)\n", angle, "[a](<a%3Eb.md>)\n"],
    ["[a](./Folder/Note(1).md)\n", angle, "[a](<Folder/Note(1).md>)\n"],
    ["[a](./Folder/Note\\(1\\).md)\n", angle, "[a](<Folder/Note(1).md>)\n"],
    ["[a](./Folder/Note(1).md)\n", bare, "[a](Folder/Note%281%29.md)\n"],
    ['[a](./Folder/Note.md "title")\n', angle, '[a](<Folder/Note.md> "title")\n'],
  ])("rewrites the destination of %j", (source, config, output) => {
    expect(formatted(source, config, { path: "Doc.md", workspace })).toBe(output);
  });
});

describe("links/valid definitions", () => {
  const config = only({ "links/valid": "error" });
  it("treats references without a definition as plain text", () => {
    const source = "[text][missing] and ![alt][gone] and [shortcut]\n";
    expect(parse(source, "github").tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: source.trimEnd() }],
    });
    expect(lint(source, { config })).toEqual([]);
    expect(lint("[text][known]\n\n[known]: https://example.test\n", { config })).toEqual([]);
    expect(lint("[text][known]\n\n[known]: missing.md\n", { config, workspace })).toMatchObject([
      { message: "Missing local target: missing.md.", line: 3 },
    ]);
  });
  const workspace = createWorkspace({ "document.md": "" });
});

describe("dialect markers", () => {
  it("leaves unknown GitHub alert types and known Obsidian types alone", () => {
    const github = only({ "github/alert-marker": "warn" }, "github");
    expect(formatted("> [!foo]\n> Text.\n", github)).toBe("> [!foo]\n> Text.\n");
    expect(formatted("> [!tip]\n> Text.\n", github)).toBe("> [!TIP]\n> Text.\n");
    const obsidian = only({ "obsidian/callout-marker": "warn" }, "obsidian");
    expect(formatted("> [!Custom-Type]- Title\n", obsidian)).toBe("> [!custom-type]- Title\n");
    expect(formatted("> [!note]\n", obsidian)).toBe("> [!note]\n");
  });
  it("applies GitHub alert casing to Forgejo documents only among GFM dialects", () => {
    const rules: Record<string, RuleSetting> = { "github/alert-marker": "warn" };
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "forgejo"))).toBe("> [!TIP]\n> Text.\n");
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "commonmark"))).toBe("> [!tip]\n> Text.\n");
  });
  it("provides Forgejo and Codeberg presets and accepts aliases in overrides", () => {
    const rules = {
      "github/task-marker": "warn",
      "github/alert-marker": "warn",
      "style/table": "warn",
    };
    expect(resolveConfig({ extends: ["forgejo"] })).toMatchObject({ dialect: "forgejo", rules });
    expect(resolveConfig({ extends: ["codeberg"] })).toMatchObject({ dialect: "forgejo", rules });
    expect(resolveConfig({ dialect: "codeberg" }).dialect).toBe("forgejo");
    expect(
      resolveConfig({ overrides: [{ files: ["forge/**"], dialect: "codeberg" }] }, "forge/a.md")
        .dialect,
    ).toBe("forgejo");
    expect(canonicalDialect("codeberg")).toBe("forgejo");
    expect(canonicalDialect("github")).toBe("github");
  });
});

describe("engine edits and fingerprints", () => {
  it("applies identical edits from two rules once", () => {
    expect(
      applyEdits("abc", [
        { start: 0, end: 1, text: "x" },
        { start: 0, end: 1, text: "x" },
      ]),
    ).toBe("xbc");
    const rule = {
      kind: "style",
      description: "Use underscores for the first emphasis",
      check: ({ document }: { document: { source: string } }) =>
        document.source.startsWith("*")
          ? [
              { start: 0, message: "Same", edit: { start: 0, end: 1, text: "_" } },
              { start: 2, message: "Same", edit: { start: 2, end: 3, text: "_" } },
            ]
          : [],
    } as const;
    const plugin: Plugin = { name: "twin", rules: { one: rule, two: rule } };
    const result = format("*a*\n", {
      config: only({ "twin/one": "warn", "twin/two": "warn" }),
      plugins: [plugin],
    });
    expect(result.output).toBe("_a_\n");
    expect(result.diagnostics).toEqual([]);
  });
  it("distinguishes embeds from links and canonicalizes their targets", () => {
    const workspace = createWorkspace({ "Doc.md": "", "Note.md": "" }, { dialect: "obsidian" });
    const print = (source: string) =>
      semanticFingerprint(parse(source, "obsidian", "Doc.md"), workspace);
    expect(print("![[Note]]\n")).toBe(print("![[Note.md]]\n"));
    expect(print("![[Note|300]]\n")).not.toBe(print("![[Note]]\n"));
    expect(print("![[Note]]\n")).not.toBe(print("[[Note]]\n"));
    expect(print("![[Note]]\n")).toContain('"type":"embed"');
  });
});

describe("suppression directives at the end of a document", () => {
  const config = only({ "style/emphasis": "warn" });
  it("suppresses a final line without a trailing newline", () => {
    expect(formatted("<!-- mdtools-disable-next-line style/emphasis -->\n*keep*", config)).toBe(
      "<!-- mdtools-disable-next-line style/emphasis -->\n*keep*",
    );
  });
  it("ignores a next-line directive that has no next line", () => {
    expect(formatted("*change*\n<!-- mdtools-disable-next-line style/emphasis -->", config)).toBe(
      "_change_\n<!-- mdtools-disable-next-line style/emphasis -->",
    );
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
