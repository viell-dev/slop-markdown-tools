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
