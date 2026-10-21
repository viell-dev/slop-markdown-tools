import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, run } from "./support.js";
import { parseExplanation, parseReport } from "./json.js";
describe("without a named dialect", () => {
  // Tables and footnotes on GitHub, Forgejo, Gitea, and in Obsidian. CommonMark, which
  // was assumed up to 0.2.0-rc.1, reads the tables and the consecutive definitions as
  // paragraphs, which the default rules reflow, and a definition as a link to a file.
  const table = "| Sensor | Unit |\n|---|---|\n| Temperature | °C |\n";
  // The default rules align tables, which they would not do to a paragraph.
  const aligned = "| Sensor      | Unit |\n| ----------- | ---- |\n| Temperature | °C   |\n";
  const sources = {
    "outer-pipes.md": [table, aligned],
    "no-outer-pipes.md": ["Sensor | Unit\n---|---\nTemperature | °C\n", aligned],
    "wide.md": [
      "| Sensor name in a long header cell | Unit of measurement in a long header cell | Notes |\n" +
        "|---|---|---|\n" +
        "| Temperature measured at the north wall | Degrees Celsius, to one decimal place | Calibrated yearly |\n",
      "| Sensor name in a long header cell      | Unit of measurement in a long header cell | Notes             |\n" +
        "| -------------------------------------- | ----------------------------------------- | ----------------- |\n" +
        "| Temperature measured at the north wall | Degrees Celsius, to one decimal place     | Calibrated yearly |\n",
    ],
    "footnotes.md": Array(2).fill(
      "Text with two notes.[^1][^2]\n\n[^1]: First note.\n[^2]: Second note.\n",
    ) as [string, string],
  };
  /** The documents as the default rules leave them. */
  const files = {
    ...Object.fromEntries(Object.entries(sources).map(([name, [, output]]) => [name, output])),
    "footnote.md": "Text with a note.[^1]\n\n[^1]: Text.\n",
  } as Record<string, string>;
  const dialect = (root: string, file: string, ...flags: string[]) => {
    const explained = run(root, ["config", ...flags, "explain", file]);
    expect(explained.status, explained.stderr).toBe(0);
    return (parseExplanation(explained.stdout) as { effective: { dialect: string } }).effective
      .dialect;
  };
  it("assumes GitHub Markdown and says so", async () => {
    const root = await fixture(files);
    expect(dialect(root, "outer-pipes.md")).toBe("github");
    // Only the dialect is assumed: the rules are those of the recommended preset.
    const explained = parseExplanation(run(root, ["config", "explain", "outer-pipes.md"]).stdout);
    expect(explained.config).toBeNull();
    expect(Object.keys(explained.effective.rules)).not.toContain("github/task-marker");
    // A configuration that names no dialect is read the same way.
    const configured = await fixture({
      ...files,
      "mdtools.config.jsonc": '{ "rules": { "style/emphasis": "off" } }',
    });
    expect(dialect(configured, "outer-pipes.md")).toBe("github");
    expect(run(configured, ["format", "--check"]).status).toBe(0);
  });
  it.each(Object.keys(sources))(
    "formats %s as a table or footnotes, not as prose",
    async (name) => {
      const [source, output] = sources[name as keyof typeof sources];
      const root = await fixture({ [name]: source });
      expect(run(root, ["format", "--write"]).status).toBe(0);
      expect(await readFile(path.join(root, name), "utf8")).toBe(output);
      const checked = run(root, ["format", "--check"]);
      expect(checked.status, checked.stderr).toBe(0);
      expect(checked.stderr).toBe("1 file(s) processed; 0 would change.\n");
      const piped = run(root, ["format", "-"], source);
      expect(piped.status, piped.stderr).toBe(0);
      expect(piped.stdout).toBe(output);
    },
  );
  it("lints a footnote definition without reporting a missing file", async () => {
    const root = await fixture(files);
    const linted = run(root, ["lint"]);
    expect(linted.status, linted.stderr).toBe(0);
    expect(linted.stderr).toBe("5 file(s) linted; 0 error(s), 0 warning(s).\n");
    const piped = run(root, ["lint", "-"], files["footnote.md"]);
    expect(piped.status, piped.stderr).toBe(0);
    expect(piped.stderr).toBe("");
  });
  it("still reads CommonMark when --dialect or the configuration names it", async () => {
    const joined = "| Sensor | Unit | |---|---| | Temperature | °C |\n";
    const root = await fixture(files);
    expect(dialect(root, "outer-pipes.md", "--dialect", "commonmark")).toBe("commonmark");
    expect(run(root, ["format", "-", "--dialect", "commonmark"], table).stdout).toBe(joined);
    const linted = run(root, ["lint", "--dialect", "commonmark", "footnote.md"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toContain(
      "footnote.md:3:1: error links/valid: Missing local target: Text..",
    );
    const configured = await fixture({
      ...files,
      "outer-pipes.md": table,
      "mdtools.config.jsonc": '{ "dialect": "commonmark" }',
    });
    expect(dialect(configured, "outer-pipes.md")).toBe("commonmark");
    expect(run(configured, ["format", "-"], table).stdout).toBe(joined);
    expect(run(configured, ["format", "--write", "outer-pipes.md"]).status).toBe(0);
    expect(await readFile(path.join(configured, "outer-pipes.md"), "utf8")).toBe(joined);
    // --dialect replaces the configuration's dialect, in this direction as well.
    expect(run(configured, ["format", "-", "--dialect", "github"], table).stdout).toBe(aligned);
  });
  it("leaves the choice to a preset or an override that names a dialect", async () => {
    const root = await fixture({
      "mdtools.config.jsonc": `{
        "extends": ["recommended", "forgejo"],
        "overrides": [{ "files": ["plain/**"], "dialect": "commonmark" }],
      }`,
      "docs/table.md": table,
      "plain/table.md": table,
    });
    expect(dialect(root, "docs/table.md")).toBe("forgejo");
    expect(dialect(root, "plain/table.md")).toBe("commonmark");
    const previewed = run(root, ["format", "--json"]);
    expect(previewed.status, previewed.stderr).toBe(0);
    const changed = (parseReport(previewed.stdout) as { files: { path: string }[] }).files;
    expect(changed).toMatchObject([
      // The forgejo preset aligns the table; CommonMark reflows its lines as prose.
      { path: "docs/table.md", changed: true },
      { path: "plain/table.md", changed: true },
    ]);
    expect(run(root, ["format", "--write"]).status).toBe(0);
    expect(await readFile(path.join(root, "docs/table.md"), "utf8")).toBe(
      "| Sensor      | Unit |\n| ----------- | ---- |\n| Temperature | °C   |\n",
    );
    expect(await readFile(path.join(root, "plain/table.md"), "utf8")).toBe(
      "| Sensor | Unit | |---|---| | Temperature | °C |\n",
    );
  });
});
