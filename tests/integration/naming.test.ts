import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, manifest, repository, run } from "./support.js";
import { parseExplanation, parseReport } from "./json.js";

describe("mdrefine naming and 0.4.x compatibility (#600, #601)", () => {
  const notice = "mdtools names are deprecated and will be removed in 0.5.0";
  const config = { extends: [], rules: { "style/emphasis": "off" } };

  for (const prefix of ["mdrefine", "mdtools"])
    it.each(["jsonc", "json", "mjs", "js", "cjs"])(
      `discovers ${prefix}.config.%s and preserves clean-check status`,
      async (extension) => {
        const name = `${prefix}.config.${extension}`;
        const content = JSON.stringify(config);
        const root = await fixture({
          [name]:
            extension === "mjs"
              ? `export default ${content};`
              : extension.endsWith("js")
                ? `module.exports = ${content};`
                : content,
          "package.json": '{"type":"commonjs"}',
          "note.md": "*unchanged*\n",
        });
        const explained = run(root, ["config", "explain", "note.md"]);
        expect(explained.status, explained.stderr).toBe(0);
        expect(parseExplanation(explained.stdout).config).toBe(path.join(root, name));
        expect(parseExplanation(explained.stdout).effective.rules["style/emphasis"]).toBe("off");
        expect(explained.stderr.includes(notice)).toBe(prefix === "mdtools");
        const checked = run(root, ["format", "--check", "--max-warnings", "0", "--json"]);
        expect(checked.status, checked.stderr).toBe(0);
        expect(parseReport(checked.stdout).files.flatMap(({ diagnostics }) => diagnostics)).toEqual(
          [],
        );
      },
    );

  it.each([
    ["mdrefine.config.json", "mdrefine.config.jsonc"],
    ["mdtools.config.json", "mdtools.config.jsonc"],
    ["mdrefine.config.json", "mdtools.config.json"],
  ])("rejects ambiguous discovery of %s and %s, but permits explicit selection", async (a, b) => {
    const root = await fixture({ [a]: JSON.stringify(config), [b]: JSON.stringify(config) });
    const ambiguous = run(root, ["lint"]);
    expect(ambiguous.status).toBe(2);
    expect(ambiguous.stderr).toContain("Multiple mdrefine configuration files");
    for (const name of [a, b])
      expect(run(root, ["lint", "--config", name, "--max-warnings", "0"]).status).toBe(0);
  });

  it("runs the legacy command with one notice for command, config and multiple comments", async () => {
    const root = await fixture({
      "mdtools.config.json": JSON.stringify({ extends: [], rules: { "style/emphasis": "error" } }),
      "a.md": "<!-- mdtools-disable -->\n\n*one*\n",
      "b.md": "<!-- mdtools-disable-next-line style/emphasis -->\n*two*\n",
    });
    const result = spawnSync(
      process.execPath,
      [path.join(repository, "dist/cli/mdtools.js"), "lint", "--json", "--max-warnings", "0"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr.split(notice)).toHaveLength(2);
    expect(parseReport(result.stdout).files.flatMap(({ diagnostics }) => diagnostics)).toEqual([]);
    const version = spawnSync(
      process.execPath,
      [path.join(repository, "dist/cli/mdtools.js"), "--version"],
      { cwd: root, encoding: "utf8" },
    );
    expect(version.stdout.trim()).toBe(manifest.version);
    expect(version.status).toBe(0);
    expect(version.stderr).toContain(notice);
  });

  it("warns for real legacy directives, not code examples or ordinary mentions", async () => {
    const root = await fixture({
      "mdrefine.config.json": '{"extends":[]}',
      "note.md":
        "`<!-- mdtools-disable -->`\n\n```md\n<!-- mdtools-enable -->\n```\n\nmdtools-disable is old.\n",
      "old.md": "<!-- mdtools-disable -->\n",
    });
    expect(run(root, ["lint", "note.md"]).stderr).not.toContain(notice);
    const actual = run(root, ["lint", "old.md", "--json", "--max-warnings", "0"]);
    expect(actual.status).toBe(0);
    expect(actual.stderr).toContain(notice);
  });
});
