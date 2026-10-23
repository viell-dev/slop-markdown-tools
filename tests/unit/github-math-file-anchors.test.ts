import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createWorkspace, lint, semanticFingerprint } from "../../src/index.js";
import * as syntax from "../../src/syntax/parse.js";
import { githubAnchors } from "../../src/workspace/anchors.js";
import { githubFileAnchors } from "../../src/workspace/github-file-anchors.js";
import manifest from "../fixtures/renderers/github-math-anchors/manifest.json" with { type: "json" };

const sourceOf = (file: string) =>
  readFileSync(
    new URL(`../fixtures/renderers/github-math-anchors/${file}`, import.meta.url),
    "utf8",
  );

describe("GitHub file anchors in dollar-math source (#570)", () => {
  it.each(manifest.cases)("matches immutable Contents IDs for $file", (fixture) => {
    const source = sourceOf(fixture.file);
    expect(createHash("sha256").update(source).digest("hex")).toBe(fixture.sourceSha256);
    const document = syntax.parse(source, "github");
    const before = semanticFingerprint(document);
    const primary = githubAnchors(document);
    const file = githubFileAnchors(document, primary, source);
    expect(file.complete).toBe(true);
    expect([...file.slugs]).toEqual(fixture.generatedIds);
    expect([...file.explicit]).toEqual(fixture.explicitIds);
    expect(semanticFingerprint(document)).toBe(before);

    const read = vi.fn(() => source);
    const workspace = createWorkspace({ "Target.md": read }, { dialect: "github" });
    const entry = vi.spyOn(syntax, "parse");
    const expected = new Set([...fixture.generatedIds, ...fixture.explicitIds]);
    const invalid = [...new Set([...primary.slugs, ...primary.explicit])].filter(
      (id) => !expected.has(id),
    );
    for (const id of [...expected, ...invalid])
      expect(workspace.resolve("From.md", `Target.md#${id}`, "github").fragmentExists, id).toBe(
        expected.has(id),
      );
    // Exercise empty-anchor documents too, and an ID absent from every fixture.
    expect(
      workspace.resolve("From.md", "Target.md#not-a-real-calibration-anchor", "github")
        .fragmentExists,
    ).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(entry).toHaveBeenCalledTimes(1);
    entry.mockRestore();
    const links =
      [...expected, ...invalid].map((id) => `[${id}](Target.md#${id})`).join(" ") + "\n";
    expect(
      lint(links, {
        path: "From.md",
        workspace,
        config: { extends: [], dialect: "github", rules: { "links/valid": "error" } },
      }).map(({ message }) => message),
    ).toEqual(invalid.map((id) => `Missing fragment in Target.md#${id}.`));
  });

  it.each(["\n", "\r\n", "\r"])("retains normalized positions with %j endings", (newline) => {
    for (const bom of ["", "\uFEFF"]) {
      const source = bom + "$$\nx\n$$\nTitle\n---\n".replaceAll("\n", newline);
      const document = syntax.parse(source, "github");
      const reading = syntax.githubFileReading(document.tree);
      expect(reading).not.toBe(document.tree);
      expect(syntax.githubFileReading(document.tree)).toBe(reading);
      expect(reading.children[0]?.position?.start.offset).toBe(0);
      expect([...githubFileAnchors(document).slugs]).toEqual(["xtitle"]);
      expect(document.tree.children[0]?.type).toBe("math");
      expect(syntax.otherReading(document.tree)).toBeUndefined();
      expect(syntax.plainReading(document.tree)).toBe(document.tree);
    }
  });

  it.each(["# Ordinary\n", "# Escaped \\$x\\$\n", "```math\n$x$\n```\n"])(
    "keeps identity when no dollar-math nodes need another reading: %j",
    (source) => {
      const tree = syntax.parse(source, "github").tree;
      expect(syntax.githubFileReading(tree)).toBe(tree);
      expect(syntax.githubFileReading(tree)).toBe(tree);
    },
  );

  it.each(["commonmark", "forgejo", "gitea", "obsidian", "vitepress"] as const)(
    "retains the %s reading",
    (dialect) => {
      const tree = syntax.parse("## Math $_x_$\n", dialect).tree;
      expect(syntax.githubFileReading(tree)).toBe(tree);
    },
  );

  it("keeps selected YAML/plain routes and formatter reading identities separate", () => {
    const document = syntax.parse("---\ntitle: Text\n---\n\n$$\nx\n$$\nTitle\n---\n", "github");
    const plain = syntax.plainReading(document.tree);
    const metadataFile = syntax.githubFileReading(document.tree);
    const plainFile = syntax.githubFileReading(plain);
    expect(metadataFile.children[0]?.type).toBe("yaml");
    expect(plainFile.children[0]?.type).toBe("thematicBreak");
    expect(syntax.githubFileReading(document.tree)).toBe(metadataFile);
    expect(syntax.githubFileReading(plain)).toBe(plainFile);
    expect(syntax.plainReading(document.tree)).toBe(plain);
    expect(syntax.otherReading(document.tree)).toBeUndefined();
    expect(document.tree.children.some(({ type }) => type === "math")).toBe(true);
  });
});
