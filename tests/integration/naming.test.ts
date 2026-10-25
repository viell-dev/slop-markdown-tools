import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, run } from "../support/cli.js";
import { parseExplanation, parseReport } from "../support/json.js";

describe("mdrefine naming after the 0.5.0 retirement (#601)", () => {
  const config = { extends: [], rules: { "style/emphasis": "off" } };
  const content = (extension: string) =>
    extension === "mjs"
      ? `export default ${JSON.stringify(config)};`
      : extension.endsWith("js")
        ? `module.exports = ${JSON.stringify(config)};`
        : JSON.stringify(config);

  it.each(["jsonc", "json", "mjs", "js", "cjs"])(
    "discovers mdrefine.config.%s",
    async (extension) => {
      const name = `mdrefine.config.${extension}`;
      const root = await fixture({
        [name]: content(extension),
        "package.json": '{"type":"commonjs"}',
        "note.md": "*unchanged*\n",
      });
      const explained = run(root, ["config", "explain", "note.md"]);
      expect(explained.status, explained.stderr).toBe(0);
      expect(parseExplanation(explained.stdout).config).toBe(path.join(root, name));
      expect(parseExplanation(explained.stdout).effective.rules["style/emphasis"]).toBe("off");
      expect(explained.stderr).toBe("");
      const checked = run(root, ["format", "--check", "--max-warnings", "0", "--json"]);
      expect(checked.status, checked.stderr).toBe(0);
      expect(parseReport(checked.stdout).files.flatMap((file) => file.diagnostics)).toEqual([]);
    },
  );

  it.each(["jsonc", "json", "mjs", "js", "cjs"])(
    "does not discover retired mdtools.config.%s",
    async (extension) => {
      const root = await fixture({
        [`mdtools.config.${extension}`]: content(extension),
        "package.json": '{"type":"commonjs"}',
        "note.md": "*one*\n",
      });
      const explained = run(root, ["config", "explain", "note.md"]);
      expect(explained.status, explained.stderr).toBe(0);
      expect(parseExplanation(explained.stdout).config).toBeNull();
      expect(explained.stderr).toBe("");
      const checked = run(root, ["lint", "note.md", "--json", "--max-warnings", "0"]);
      expect(checked.status, checked.stderr).toBe(1);
      expect(
        parseReport(checked.stdout).files[0]!.diagnostics.some(
          (item) => item.rule === "style/emphasis",
        ),
      ).toBe(true);
    },
  );

  it("rejects two current config files but permits explicit selection", async () => {
    const names = ["mdrefine.config.json", "mdrefine.config.jsonc"];
    const root = await fixture(
      Object.fromEntries(names.map((name) => [name, JSON.stringify(config)])),
    );
    const ambiguous = run(root, ["lint"]);
    expect(ambiguous.status).toBe(2);
    expect(ambiguous.stderr).toContain("Multiple mdrefine configuration files");
    for (const name of names)
      expect(run(root, ["lint", "--config", name, "--max-warnings", "0"]).status).toBe(0);
  });

  it("ignores old config names beside the current file and leaves old comments inert", async () => {
    const root = await fixture({
      "mdrefine.config.json": JSON.stringify({ extends: [], rules: { "style/emphasis": "error" } }),
      "mdtools.config.json": JSON.stringify(config),
      "note.md": "<!-- mdtools-disable -->\n\n*one*\n",
    });
    const explained = run(root, ["config", "explain", "note.md"]);
    expect(explained.status, explained.stderr).toBe(0);
    expect(parseExplanation(explained.stdout).config).toBe(path.join(root, "mdrefine.config.json"));
    const checked = run(root, ["lint", "--json"]);
    expect(checked.status, checked.stderr).toBe(1);
    expect(checked.stderr).toBe("");
    expect(parseReport(checked.stdout).files[0]!.diagnostics).toMatchObject([
      { rule: "style/emphasis", severity: "error" },
      { rule: "style/emphasis", severity: "error" },
    ]);
  });
});
