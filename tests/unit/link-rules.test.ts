import { describe, expect, it } from "vitest";
import { createWorkspace, lint, parse } from "../../src/index.js";
import type { RuleSetting } from "../../src/index.js";
import { only, formatted } from "../support/rules.js";
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
