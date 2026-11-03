import { writeFile } from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { getFileInfo } from "prettier";
import { describe, expect, it } from "vitest";
import { canRestrict, denyRead, fixture, restrict, run } from "../support/cli.js";
import { parseReport } from "../support/json.js";

const markdownlint = '{"default":false,"MD018":true}';

function documents(files: readonly string[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file, "#Title\n"]));
}

function selected(root: string): { files: string[]; stderr: string } {
  const result = run(root, ["lint", "--root", ".", "--json"]);
  expect([0, 1], result.stderr).toContain(result.status);
  return {
    files: parseReport(result.stdout)
      .files.map((file) => file.path)
      .sort(),
    stderr: result.stderr,
  };
}

function convert(root: string): string {
  const result = run(root, ["config", "convert", "--write", "--root", "."]);
  expect(result.status, result.stderr).toBe(0);
  return result.stderr;
}

describe(".markdownlintignore conversion (#803)", () => {
  it.each([".markdownlintignore", ".prettierignore"])(
    "reads the first pattern after a UTF-8 BOM in %s (#877)",
    async (name) => {
      const pattern = "\ufeff/ignored/\n";
      const root = await fixture({
        ".markdownlint.json": markdownlint,
        ".prettierrc": '{"proseWrap":"always"}',
        [name]: pattern,
        ...documents(["ignored/a.md", "keep.md"]),
      });
      if (name === ".prettierignore")
        expect(
          (
            await getFileInfo(path.join(root, "ignored/a.md"), {
              ignorePath: path.join(root, name),
            })
          ).ignored,
        ).toBe(true);
      else expect(ignore().add(pattern).ignores("ignored/a.md")).toBe(true);
      expect(selected(root).files).toEqual(["keep.md"]);
      convert(root);
      expect(selected(root).files).toEqual(["keep.md"]);
    },
  );

  // Selection was checked against installed markdownlint-cli 0.50.0. Every
  // candidate file violates enabled MD018, so its JSON findings reveal selection.
  it.each([
    {
      name: "rooted directory",
      ignore: "/docs/\n",
      files: ["docs/a.md", "sub/docs/b.md", "keep.md"],
      expected: ["keep.md", "sub/docs/b.md"],
    },
    {
      name: "basename",
      ignore: "skip.md\n",
      files: ["skip.md", "sub/skip.md", "keep.md", "sub/keep.md"],
      expected: ["keep.md", "sub/keep.md"],
    },
    {
      name: "directory descendants",
      ignore: "generated/\n",
      files: ["generated/a.md", "nested/generated/b.md", "keep.md"],
      expected: ["keep.md"],
    },
    {
      name: "rooted file",
      ignore: "/skip.md\n",
      files: ["skip.md", "sub/skip.md", "keep.md"],
      expected: ["keep.md", "sub/skip.md"],
    },
    {
      name: "literal punctuation",
      ignore: "# comment\n\\#skip.md\n\\!skip.md\nliteral{a,b}.md\n",
      files: ["#skip.md", "!skip.md", "literal{a,b}.md", "literala.md", "keep.md"],
      expected: ["keep.md", "literala.md"],
    },
    {
      name: "markdown extension",
      ignore: "*.markdown\n",
      files: ["skip.markdown", "sub/skip.markdown", "keep.md"],
      expected: ["keep.md"],
    },
  ])(
    "preserves CLI1 $name selection before and after writing",
    async ({ ignore, files, expected }) => {
      const root = await fixture({
        ".markdownlint.json": markdownlint,
        ".markdownlintignore": ignore,
        ...documents(files),
      });
      expect(selected(root).files).toEqual(expected);
      convert(root);
      expect(selected(root).files).toEqual(expected);
    },
  );

  it("rebases an ancestor ignore into a child workspace", async () => {
    const root = await fixture({
      ".markdownlint.json": markdownlint,
      ".markdownlintignore": "/sub/skip.md\n",
      ...documents(["sub/skip.md", "sub/nested/skip.md", "sub/keep.md", "outside.md"]),
    });
    const child = path.join(root, "sub");
    expect(selected(child).files).toEqual(["keep.md", "nested/skip.md"]);
    convert(child);
    expect(selected(child).files).toEqual(["keep.md", "nested/skip.md"]);
  });

  it.each([".markdownlintignore", ".prettierignore"])(
    "keeps the other file active when %s contains negation",
    async (negatedFile) => {
      const other =
        negatedFile === ".markdownlintignore" ? ".prettierignore" : ".markdownlintignore";
      const root = await fixture({
        ".markdownlint.json": markdownlint,
        ".prettierrc": '{"proseWrap":"always"}',
        [negatedFile]: "generated/**\n!generated/keep.md\n",
        [other]: "other.md\n",
        ...documents(["generated/drop.md", "generated/keep.md", "other.md", "keep.md"]),
      });
      const fallback = selected(root);
      expect(fallback.files).toEqual(["generated/drop.md", "generated/keep.md", "keep.md"]);
      expect(fallback.stderr).toContain(`not using ${negatedFile}`);
      expect(fallback.stderr).toContain("negated entries");
      const written = convert(root);
      expect(written).toContain("negated pattern !generated/keep.md");
      // Written conversion reports the exception for manual migration; the
      // independent native ignore globs carry only the supported exclusions.
      expect(selected(root).files).toEqual(["keep.md"]);
    },
  );

  it("combines participating CLI1 and Prettier exclusions", async () => {
    const root = await fixture({
      ".markdownlint.json": markdownlint,
      ".prettierrc": '{"proseWrap":"always"}',
      ".markdownlintignore": "legacy.md\n",
      ".prettierignore": "formatter.md\n",
      ...documents(["legacy.md", "formatter.md", "keep.md"]),
    });
    expect(selected(root).files).toEqual(["keep.md"]);
    convert(root);
    expect(selected(root).files).toEqual(["keep.md"]);
  });

  it("discloses case-sensitive conversion without excluding differently cased controls", async () => {
    const root = await fixture({
      ".markdownlint.json": markdownlint,
      ".markdownlintignore": "SKIP.MD\n",
      ...documents(["skip.md", "keep.md"]),
    });
    expect(selected(root).files).toEqual(["keep.md", "skip.md"]);
    expect(convert(root)).toContain(
      "markdownlint-cli matches its patterns without regard to letter case",
    );
    expect(selected(root).files).toEqual(["keep.md", "skip.md"]);
  });

  it("reports unsupported character classes and retains their files", async () => {
    const root = await fixture({
      ".markdownlint.json": markdownlint,
      ".markdownlintignore": "[ab].md\n",
      ...documents(["a.md", "b.md", "keep.md"]),
    });
    expect(selected(root).files).toEqual(["a.md", "b.md", "keep.md"]);
    expect(convert(root)).toContain("outside the supported gitignore subset");
    expect(selected(root).files).toEqual(["a.md", "b.md", "keep.md"]);
  });

  it("keeps CLI2 selection and explains the legacy file is unused", async () => {
    const root = await fixture({
      ".markdownlint.json": markdownlint,
      ".markdownlint-cli2.jsonc": JSON.stringify({
        config: { default: false, MD018: true },
        ignores: ["cli2.md"],
      }),
      ".markdownlintignore": "legacy.md\n",
      ...documents(["legacy.md", "cli2.md", "keep.md"]),
    });
    const fallback = selected(root);
    expect(fallback.files).toEqual(["keep.md", "legacy.md"]);
    expect(fallback.stderr).toContain("markdownlint-cli2 does not read this file");
    expect(convert(root)).toContain("markdownlint-cli2 does not read this file");
    expect(selected(root).files).toEqual(["keep.md", "legacy.md"]);
  });

  it("does not activate the fallback from an ignore file alone", async () => {
    const root = await fixture({
      ".markdownlintignore": "skip.md\n",
      ...documents(["skip.md", "keep.md"]),
    });
    const explained = run(root, ["config", "explain", "keep.md"]);
    expect(explained.status, explained.stderr).toBe(0);
    expect((JSON.parse(explained.stdout) as { conversion?: unknown }).conversion).toBeUndefined();
    expect(selected(root).files).toEqual(["keep.md", "skip.md"]);
  });

  it.skipIf(!canRestrict && process.platform !== "win32")(
    "reports a read error only for a participating ignore",
    async () => {
      const root = await fixture({
        ".prettierrc": "{}",
        ".markdownlintignore": "skip.md\n",
        ...documents(["skip.md", "keep.md"]),
      });
      const file = path.join(root, ".markdownlintignore");
      if (process.platform === "win32") denyRead(file);
      else await restrict(file);
      // An unrelated ignore does not become a read requirement for Prettier.
      expect(selected(root).files).toEqual(["keep.md", "skip.md"]);
      await writeFile(path.join(root, ".markdownlint.json"), markdownlint);
      for (const args of [
        ["lint", "--json"],
        ["config", "convert", "--root", "."],
      ]) {
        const result = run(root, args);
        expect(result.status, result.stderr).toBe(2);
        expect(result.stderr).toContain(".markdownlintignore");
      }
    },
  );
});
