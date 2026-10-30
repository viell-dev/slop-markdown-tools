import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, run } from "../support/cli.js";
import { parseReport } from "../support/json.js";
describe("paths and configuration files that cannot be used", () => {
  const fails = (root: string, args: string[], message: string) => {
    const result = run(root, args);
    expect(result.status, args.join(" ")).toBe(2);
    expect(result.stdout, args.join(" ")).toBe("");
    expect(result.stderr, args.join(" ")).toBe(`mdrefine: ${message}\n`);
  };
  it("says what is wrong with a workspace root, an input, and a configuration file", async () => {
    const root = await fixture({ "note.md": "A note.\n", "folder/other.md": "Text.\n" });
    // The root is named with its full path, as discovery names it.
    for (const command of [["lint"], ["format", "--write"], ["config", "explain", "note.md"]]) {
      const [name, ...rest] = command as [string, ...string[]];
      fails(
        root,
        [name, "--root", "absent", ...rest],
        `Workspace root does not exist: ${path.join(root, "absent")}`,
      );
      fails(
        root,
        [name, "--root", "note.md", ...rest],
        `Workspace root is not a directory: ${path.join(root, "note.md")}`,
      );
    }
    // An input and a configuration file are named as they were given.
    fails(root, ["lint", "absent.md"], "Input does not exist: absent.md");
    fails(root, ["lint", "note.md", "folder/absent"], "Input does not exist: folder/absent");
    fails(root, ["format", "--write", "note.md/inside"], "Input does not exist: note.md/inside");
    fails(
      root,
      ["lint", "--config", "absent.json"],
      "Configuration file does not exist: absent.json",
    );
    fails(
      root,
      ["lint", "--config", "absent.mjs"],
      "Configuration file does not exist: absent.mjs",
    );
    fails(root, ["lint", "--config", "folder"], "Configuration file is not a file: folder");
    fails(
      root,
      ["config", "--config", "absent.jsonc", "explain", "note.md"],
      "Configuration file does not exist: absent.jsonc",
    );
    // An excluded path that does not exist excludes nothing, also below a file.
    for (const excluded of ["absent.md", "note.md/inside"]) {
      const linted = run(root, ["lint", "--exclude", excluded]);
      expect(linted.status, linted.stderr).toBe(0);
      expect(linted.stderr).toBe("2 file(s) linted; 0 error(s), 0 warning(s).\n");
    }
  });
  it("names the configuration file whose content is at fault", async () => {
    const cut = await fixture({
      "mdrefine.config.json": '{ "rules": ',
      "sub/note.md": "A note.\n",
    });
    // Found by searching upward, the file is named with its full path.
    fails(
      path.join(cut, "sub"),
      ["lint"],
      `Invalid JSON configuration in ${path.join(cut, "mdrefine.config.json")} at line 1, column 12: a value is expected`,
    );
    const wrong = await fixture({
      "odd.jsonc": '{ "rules": 5 }',
      "gitlab.json": '{ "dialect": "gitlab" }',
      "note.md": "A note.\n",
    });
    // An enumerated setting names the values it allows.
    fails(
      wrong,
      ["lint", "--config", "gitlab.json"],
      'Invalid configuration in gitlab.json: "dialect" must be "commonmark", "github", "forgejo", "codeberg", "gitea", "obsidian", or "vitepress", not "gitlab"',
    );
    fails(
      wrong,
      ["lint", "--config", "odd.jsonc"],
      'Invalid configuration in odd.jsonc: "rules" must be an object of rule IDs and their settings, not 5',
    );
    const script = await fixture({
      "mdrefine.config.mjs": "export default {\n",
      "wrong.mjs": "export default { rules: 5 };\n",
      "throws.mjs": 'throw new Error("no settings today");\n',
      "note.md": "A note.\n",
    });
    const broken = run(script, ["lint"]);
    expect(broken.status).toBe(2);
    expect(broken.stderr).toMatch(
      new RegExp(
        `^mdrefine: Cannot load configuration file ${path.join(script, "mdrefine.config.mjs").replaceAll("\\", "\\\\")}: .+\\n$`,
      ),
    );
    fails(
      script,
      ["lint", "--config", "wrong.mjs"],
      'Invalid configuration in wrong.mjs: "rules" must be an object of rule IDs and their settings, not 5',
    );
    fails(
      script,
      ["lint", "--config", "throws.mjs"],
      "Cannot load configuration file throws.mjs: no settings today",
    );
    // A syntax error is placed by line and column, whatever the line endings, and only the
    // first is reported: the parser's later errors follow from it.
    const lines = await fixture({
      "crlf.json":
        '{\r\n  "extends": ["recommended"],\r\n  "rules": { "style/wrap": "warn" "x": 1 }\r\n}\r\n',
      "quoted.jsonc": "{\n  // Comments are allowed here.\n  'dialect': 'github'\n}\n",
      "comment.json": '{\n  "dialect": "github" // A comment.\n}\n',
      "note.md": "A note.\n",
    });
    fails(
      lines,
      ["lint", "--config", "crlf.json"],
      "Invalid JSON configuration in crlf.json at line 3, column 35: a comma is expected",
    );
    fails(
      lines,
      ["lint", "--config", "quoted.jsonc"],
      `Invalid JSON configuration in quoted.jsonc at line 3, column 3: "'dialect'" is not valid JSON here`,
    );
    fails(
      lines,
      ["lint", "--config", "comment.json"],
      "Invalid JSON configuration in comment.json at line 2, column 23: a .json file cannot hold comments; name it .jsonc to keep them",
    );
    // A folder with the name of a configuration file is found, and is not one.
    const folder = await fixture({ "note.md": "A note.\n" });
    await mkdir(path.join(folder, "mdrefine.config.jsonc"));
    fails(
      folder,
      ["lint"],
      `Configuration file is not a file: ${path.join(folder, "mdrefine.config.jsonc")}`,
    );
  });
  it("refuses blank lines around headings that style/blank-lines would remove", async () => {
    const source = "Text\n# H\n";
    const spacing = { "style/block-spacing": ["warn", { linesAbove: [1, 2] }] };
    const root = await fixture({
      "mdrefine.config.json": JSON.stringify({ rules: spacing }),
      "allowed.json": JSON.stringify({
        rules: { ...spacing, "style/blank-lines": ["warn", { maximum: 2 }] },
      }),
      "note.md": source,
    });
    for (const args of [["lint"], ["format", "--write"]])
      fails(
        root,
        args,
        // The message names the configuration file that holds the settings (#788).
        `Invalid configuration in ${path.join(root, "mdrefine.config.json")}: ` +
          'Invalid options for style/block-spacing: "linesAbove" asks for 2 blank lines at heading level 2, but style/blank-lines removes blank lines beyond 1 in a row; set its "maximum" to at least 2, or lower "linesAbove"',
      );
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(source);
    const allowed = run(root, ["format", "--write", "--config", "allowed.json"]);
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("Text\n\n# H\n");
  });
  it("finds JavaScript configuration files and loads them as Node.js reads them", async () => {
    const esm = 'export default { rules: { "style/emphasis": "off" } };\n';
    const cjs = 'module.exports = { rules: { "style/emphasis": "off" } };\n';
    for (const files of [
      { "mdrefine.config.js": esm },
      { "mdrefine.config.js": cjs },
      { "mdrefine.config.js": esm, "package.json": '{ "type": "module" }' },
      { "mdrefine.config.js": cjs, "package.json": '{ "type": "commonjs" }' },
      { "mdrefine.config.cjs": cjs, "package.json": '{ "type": "module" }' },
      { "sub/mdrefine.config.cjs": cjs },
    ]) {
      const root = await fixture({ ...files, "sub/note.md": "*keep*\n" });
      // Found from the documents' folder or above it, the file turns emphasis off.
      const checked = run(path.join(root, "sub"), ["format", "--check"]);
      expect(checked.stderr, JSON.stringify(files)).toBe("1 file(s) processed; 0 would change.\n");
      expect(checked.status).toBe(0);
    }
    const both = await fixture({ "mdrefine.config.js": esm, "mdrefine.config.cjs": cjs });
    fails(both, ["lint"], `Multiple mdrefine configuration files in ${both}. Use --config.`);
    // Named explicitly, any of the three extensions is JavaScript.
    const named = await fixture({ "settings.cjs": cjs, "note.md": "*keep*\n" });
    expect(run(named, ["format", "--check", "--config", "settings.cjs"]).status).toBe(0);
  });
  it("counts the findings in the lint summary and the changes in the format summary", async () => {
    const root = await fixture({
      "clean.md": "A clean note.\n",
      "note.md": "A *note* with a [missing link](absent.md).\n",
    });
    const linted = run(root, ["lint"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toBe(
      'note.md:1:3: warn style/emphasis: Use "_" for emphasis.\n' +
        'note.md:1:8: warn style/emphasis: Use "_" for emphasis.\n' +
        "note.md:1:17: error links/valid: Missing local target: absent.md.\n" +
        "2 file(s) linted; 1 error(s), 2 warning(s).\n",
    );
    expect(run(root, ["lint", "clean.md"]).stderr).toBe(
      "1 file(s) linted; 0 error(s), 0 warning(s).\n",
    );
    // Formatting still says what it changed or would change, and a check names the files.
    expect(run(root, ["format", "--check"]).stderr).toBe(
      "note.md:1:17: error links/valid: Missing local target: absent.md.\n" +
        "note.md\n" +
        "2 file(s) processed; 1 would change.\n",
    );
    expect(run(root, ["format", "--write"]).stderr).toBe(
      "note.md:1:17: error links/valid: Missing local target: absent.md.\n" +
        "2 file(s) processed; 1 written.\n",
    );
    // The summary is not part of a JSON report.
    const report = run(root, ["lint", "--json"]);
    expect(report.stderr).toBe("");
    expect(Object.keys(parseReport(report.stdout))).toEqual([
      "version",
      "mode",
      "root",
      "files",
      "written",
    ]);
  });
});
