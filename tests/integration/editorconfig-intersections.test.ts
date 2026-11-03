import path from "node:path";
import { resolveConfig as prettierResolve } from "prettier";
import { describe, expect, it } from "vitest";
import { fixture, run } from "../support/cli.js";
import { parseExplanation } from "../support/json.js";

async function editorFixture(editor: string, files: readonly string[]): Promise<string> {
  return fixture({
    ".prettierrc": '{"proseWrap":"always"}',
    ".editorconfig": `root=true\n${editor}`,
    ...Object.fromEntries(files.map((file) => [file, "text\n"])),
  });
}

async function comparePrettier(root: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const reference = await prettierResolve(path.join(root, file), { editorconfig: true });
    const explained = run(root, ["config", "explain", file]);
    expect(explained.status, explained.stderr).toBe(0);
    const rules = parseExplanation(explained.stdout).effective.rules;
    expect(rules["style/list-indent"], file).toEqual([
      "warn",
      expect.objectContaining({ nestedIndent: reference?.tabWidth ?? 2 }),
    ]);
    expect(rules["style/wrap"], file).toEqual([
      "warn",
      expect.objectContaining({ width: reference?.printWidth ?? 80 }),
    ]);
    expect(rules["style/line-ending"], file).toEqual([
      "warn",
      { endOfLine: reference?.endOfLine ?? "lf" },
    ]);
  }
}

describe("EditorConfig intersection conversion (#840)", () => {
  it.each([
    { initial: "**/*.md", alternatives: "md,m?" },
    { initial: "**/*.md", alternatives: "m?,md" },
    { initial: "**/*.{md,markdown}", alternatives: "m?,md" },
  ])("retains exact branches of $initial and $alternatives", async ({ initial, alternatives }) => {
    const files = ["a/one.md", "a/two.markdown", "b/three.md", "a/deep/four.md", "a/one.mz"];
    const root = await editorFixture(
      `[${initial}]\nindent_style=space\nindent_size=3\n[a/*.{${alternatives}}]\ntab_width=8\n`,
      files,
    );
    // The matching md branch must retain indent_style/indent_size even though
    // the remaining m? component comparison is outside the supported subset.
    await comparePrettier(root, files);
    const converted = run(root, ["config", "convert", "--write", "--root", "."]);
    expect(converted.status, converted.stderr).toBe(0);
    expect(converted.stderr).toContain("not carried over exactly");
    await comparePrettier(root, files);
  });

  it.each(["md,m?", "m?,md"])(
    "retains ancestor intersections after rebasing %s into a child",
    async (alternatives) => {
      const files = ["a/one.md", "a/two.markdown", "b/three.md", "a/deep/four.md", "a/one.mz"];
      const root = await editorFixture(
        `[sub/**/*.md]\nindent_style=space\nindent_size=3\n[sub/a/*.{${alternatives}}]\ntab_width=8\n`,
        files.map((file) => `sub/${file}`),
      );
      const child = path.join(root, "sub");
      await comparePrettier(child, files);
      const converted = run(child, ["config", "convert", "--write", "--root", "."]);
      expect(converted.status, converted.stderr).toBe(0);
      expect(converted.stderr).toContain("not carried over exactly");
      await comparePrettier(child, files);
    },
  );

  it("carries the original brace fixture without false overlap omissions", async () => {
    const files = ["a/one.md", "b/two.md", "c/three.md", "a/four.markdown", "a/deep/five.md"];
    const root = await editorFixture(
      "[**/*.md]\nindent_size=3\n[{a,b}/**]\nmax_line_length=42\n[a/*.{md,markdown}]\nindent_size=8\n[*]\nend_of_line=lf\n",
      files,
    );
    await comparePrettier(root, files);
    const converted = run(root, ["config", "convert", "--write", "--root", "."]);
    expect(converted.status, converted.stderr).toBe(0);
    expect(converted.stderr).not.toContain("overlapping EditorConfig sections");
    await comparePrettier(root, files);
  });

  it("proves distinct literal extensions disjoint", async () => {
    const files = ["a/one.md", "a/two.markdown", "b/three.md"];
    const root = await editorFixture(
      "[**/*.md]\nindent_style=space\nindent_size=3\n[a/*.markdown]\ntab_width=8\n",
      files,
    );
    await comparePrettier(root, files);
    const converted = run(root, ["config", "convert", "--write", "--root", "."]);
    expect(converted.status, converted.stderr).toBe(0);
    expect(converted.stderr).not.toContain("overlapping EditorConfig sections");
    await comparePrettier(root, files);
  });

  it("keeps exact and disjoint literal brace combinations", async () => {
    const files = ["a/one.md", "a/two.md", "a/three.md", "a/other.md"];
    const root = await editorFixture(
      "[a/{one,two}.md]\nindent_style=space\nindent_size=3\n[a/{two,three}.md]\ntab_width=8\n",
      files,
    );
    await comparePrettier(root, files);
    const converted = run(root, ["config", "convert", "--write", "--root", "."]);
    expect(converted.status, converted.stderr).toBe(0);
    expect(converted.stderr).not.toContain("overlapping EditorConfig sections");
    await comparePrettier(root, files);
  });

  it("reports an unsupported remainder without approximating its scope", async () => {
    const controls = ["a/ax.md", "a/bz.md", "a/none.md"];
    const root = await editorFixture(
      "[a/a*.md]\nindent_style=space\nindent_size=3\n[a/*z.md]\ntab_width=8\n",
      [...controls, "a/az.md"],
    );
    // The overlapping az file remains a reported manual-migration case. These
    // controls must not acquire an invented wider intersection's settings.
    await comparePrettier(root, controls);
    const converted = run(root, ["config", "convert", "--write", "--root", "."]);
    expect(converted.status, converted.stderr).toBe(0);
    expect(converted.stderr).toContain("not carried over exactly");
    await comparePrettier(root, controls);
  });
});
