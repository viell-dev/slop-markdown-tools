import { describe, expect, it, vi } from "vitest";
import { createWorkspace, format, lint, parse, semanticFingerprint } from "../src/index.js";
import type { Config } from "../src/index.js";

const config: Config = {
  extends: [],
  dialect: "obsidian",
  rules: { "links/valid": "error", "links/path": ["warn", { style: "root", brackets: "angle" }] },
};
describe("local target resolution", () => {
  const workspace = createWorkspace(
    {
      "README.md": "# Root\n",
      "Sub/README.md": "# Sub\n",
      "Sub/Doc.md": "",
      "Elsewhere/Unique.md": "# Unique\n",
      "Other/README.md": "",
      "Sub/Local.md": "",
      "Other/Local.md": "",
    },
    { dialect: "obsidian" },
  );
  it.each([
    ["README.md", "README.md"],
    ["/README.md", "README.md"],
    ["./README.md", "Sub/README.md"],
    ["../README.md", "README.md"],
    ["Sub/README", "Sub/README.md"],
    ["Local", "Sub/Local.md"],
    ["Unique", "Elsewhere/Unique.md"],
  ])("resolves %s by explicit, root, relative, then suffix precedence", (url, target) => {
    expect(workspace.resolve("Sub/Doc.md", url!, "obsidian")).toMatchObject({
      status: "resolved",
      target,
    });
  });
  it("does not guess between suffix matches without an exact target", () => {
    expect(workspace.resolve("Elsewhere/Doc.md", "Local", "obsidian").status).toBe("ambiguous");
    expect(workspace.resolve("Elsewhere/Doc.md", "/Local", "obsidian").status).toBe("missing");
    expect(workspace.resolve("Sub/Doc.md", "../../README.md", "obsidian").status).toBe("missing");
  });
  it("keeps root rewrites semantically valid with duplicate basenames", () => {
    const source = "[root](../README.md)\n";
    const result = format(source, { path: "Sub/Doc.md", config, workspace });
    expect(result.output).toBe("[root](<README.md>)\n");
    expect(result.diagnostics).toEqual([]);
    expect(format(result.output, { path: "Sub/Doc.md", config, workspace }).changed).toBe(false);
    expect(semanticFingerprint(parse(source, "obsidian", "Sub/Doc.md"), workspace)).toBe(
      semanticFingerprint(parse(result.output, "obsidian", "Sub/Doc.md"), workspace),
    );
  });
  it("makes relative rewrites explicit when they would otherwise resolve to the root", () => {
    const relative: Config = {
      ...config,
      rules: { "links/path": ["warn", { style: "relative" }] },
    };
    const result = format("[local](Sub/README.md)\n", {
      path: "Sub/Doc.md",
      config: relative,
      workspace,
    });
    expect(result.output).toBe("[local](./README.md)\n");
    expect(result.diagnostics).toEqual([]);
    expect(format(result.output, { path: "Sub/Doc.md", config: relative, workspace }).changed).toBe(
      false,
    );
  });
  it("keeps CommonMark relative resolution and normalizes Windows source paths", () => {
    expect(workspace.resolve("Sub/Doc.md", "README.md", "github").target).toBe("Sub/README.md");
    expect(workspace.resolve("Sub\\Doc.md", "./README.md", "obsidian").target).toBe(
      "Sub/README.md",
    );
  });
  it("distinguishes directories, including empty ones, without guessing an index note", () => {
    const index = createWorkspace({ "Sub/README.md": "" }, { directories: ["Empty"] });
    for (const destination of ["Sub", "Sub/", "Empty"]) {
      const source = `[folder](<${destination}>)\n`;
      expect(lint(source, { config, workspace: index })[0]?.message).toBe(
        `Local target is a directory: ${destination}.`,
      );
      expect(format(source, { config, workspace: index }).output).toBe(source);
      expect(
        lint(source, { config: { rules: { "links/valid": "error" } }, workspace: index }),
      ).toEqual([]);
    }
  });
  it("does not load target contents until a fragment is checked, then caches them", () => {
    const read = vi.fn(() => "# Heading\n\n## Heading\n\nA block. ^id\n");
    const unused = vi.fn(() => {
      throw new Error("must not read");
    });
    const index = createWorkspace(
      { "Target.md": read, "Unused.md": unused },
      { dialect: "obsidian" },
    );
    expect(index.resolve("Doc.md", "Target.md", "obsidian").status).toBe("resolved");
    expect(read).not.toHaveBeenCalled();
    expect(index.resolve("Doc.md", "Target.md#Heading", "obsidian").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#^id", "obsidian").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#heading-1", "github").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#Missing", "obsidian").fragmentExists).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
  });
});
describe("Obsidian case-insensitive resolution", () => {
  const files = {
    "Doc.md": "",
    "Note.md": "# Note\n\n## Heading Two\n\nA block. ^id\n",
    "Folder/Inner.md": "",
    "Dup.md": "",
    "dup.md": "",
    "Other/Same.md": "",
    "Other/same.md": "",
  };
  const workspace = createWorkspace(files, { dialect: "obsidian" });
  it.each([
    ["note", "Note.md"],
    ["NOTE.md", "Note.md"],
    ["folder/inner", "Folder/Inner.md"],
    ["inner", "Folder/Inner.md"],
    ["/Folder/INNER", "Folder/Inner.md"],
  ])("resolves %s like Obsidian", (url, target) => {
    expect(workspace.resolve("Doc.md", url, "obsidian")).toMatchObject({
      status: "resolved",
      target,
    });
  });
  it("matches heading subpaths case-insensitively but block identifiers exactly", () => {
    expect(workspace.resolve("Doc.md", "note#heading two", "obsidian")).toMatchObject({
      status: "resolved",
      target: "Note.md",
      fragmentExists: true,
    });
    expect(workspace.resolve("Doc.md", "Note#HEADING TWO", "obsidian").fragmentExists).toBe(true);
    expect(workspace.resolve("Doc.md", "Note#Heading Three", "obsidian").fragmentExists).toBe(
      false,
    );
    expect(workspace.resolve("Doc.md", "Note#^id", "obsidian").fragmentExists).toBe(true);
    expect(workspace.resolve("Doc.md", "Note#^ID", "obsidian").fragmentExists).toBe(false);
  });
  it("reports names that differ only by case as ambiguous", () => {
    for (const url of ["Dup", "dup", "DUP.md", "Other/Same", "same"])
      expect(workspace.resolve("Doc.md", url, "obsidian").status, url).toBe("ambiguous");
  });
  it("keeps CommonMark and GitHub resolution case-sensitive", () => {
    for (const dialect of ["commonmark", "github"] as const) {
      expect(workspace.resolve("Doc.md", "note.md", dialect).status).toBe("missing");
      expect(workspace.resolve("Doc.md", "Note.md#heading-two", dialect).fragmentExists).toBe(true);
      expect(workspace.resolve("Doc.md", "Note.md#Heading-Two", dialect).fragmentExists).toBe(
        false,
      );
    }
    expect(workspace.resolve("Doc.md", "Dup.md", "github").status).toBe("resolved");
  });
  it("lints and rewrites case-insensitive links in Obsidian documents", () => {
    const config: Config = {
      extends: [],
      dialect: "obsidian",
      rules: { "links/valid": "error", "links/path": ["warn", { style: "root" }] },
    };
    const source = "See [[note]], [[other/same]], and [[note#heading two|there]].\n";
    expect(lint(source, { path: "Doc.md", config, workspace })).toMatchObject([
      { rule: "links/valid", message: "Ambiguous local target: other/same." },
      { rule: "links/path", message: "Normalize wikilink destination." },
    ]);
    const result = format(source, { path: "Doc.md", config, workspace });
    expect(result.output).toBe("See [[note]], [[other/same]], and [[Note#heading two|there]].\n");
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  });
});

describe("Forgejo heading anchors", () => {
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": [
      "# test.0.1",
      "## Placeholder to force scrolling on link's click",
      "## a啊啊b",
      "## c🤔️🤔️d",
      "## Same",
      "## Same",
      "## a-b-c----",
      "## tes a a   a  a",
      "## a_b_c",
      "## ...",
    ].join("\n\n"),
  });
  it.each([
    ["test-0-1", true],
    ["test01", false],
    ["placeholder-to-force-scrolling-on-link-s-click", true],
    ["a啊啊b", true],
    ["c-d", true],
    ["same", true],
    ["same-1", true],
    ["same-2", false],
    ["a-b-c", true],
    ["tes-a-a-a-a", true],
    ["a_b_c", true],
    ["heading", true],
  ])("resolves #%s as %s", (fragment, exists) => {
    expect(workspace.resolve("Doc.md", `Note.md#${fragment}`, "forgejo").fragmentExists).toBe(
      exists,
    );
  });
  it("keeps GitHub anchors for the GitHub dialect", () => {
    expect(workspace.resolve("Doc.md", "Note.md#test01", "github").fragmentExists).toBe(true);
    expect(workspace.resolve("Doc.md", "Note.md#test-0-1", "github").fragmentExists).toBe(false);
  });
  it("validates fragments with the document's dialect", () => {
    const options = (dialect: "github" | "forgejo") => ({
      config: { extends: [], dialect, rules: { "links/valid": "error" } } as Config,
      path: "Doc.md",
      workspace,
    });
    expect(lint("[x](Note.md#test-0-1)\n", options("forgejo"))).toEqual([]);
    expect(lint("[x](Note.md#test-0-1)\n", options("github"))).toHaveLength(1);
  });
});
describe("destination spelling", () => {
  it.each([
    ["What is this? A test.md", "What is this? A test.md"],
    ["100% sure.md", "100% sure.md"],
    ["100% sure.md", "100%25 sure.md"],
    ["A#B.md", "A%23B.md"],
    ["A%20B.md", "A%2520B.md"],
  ])("preserves an already compliant destination: %s / %s", (name, url) => {
    const workspace = createWorkspace({ [`Sub/${name}`]: "# Heading\n" });
    const source = `[label](<Sub/${url}>)\n`;
    expect(lint(source, { path: "Sub/Doc.md", config, workspace })).toEqual([]);
    expect(format(source, { path: "Sub/Doc.md", config, workspace }).output).toBe(source);
  });
  it("safely encodes hashes and literal percent sequences when rewriting a path", () => {
    const workspace = createWorkspace({ "Sub/A#B%20.md": "# Heading\n" });
    const source = "[label](./A%23B%2520.md#Heading)\n";
    const result = format(source, { path: "Sub/Doc.md", config, workspace });
    expect(result.output).toBe("[label](<Sub/A%23B%2520.md#Heading>)\n");
    expect(result.diagnostics).toEqual([]);
  });
});
