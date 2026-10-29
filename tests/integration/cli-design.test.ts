import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, run } from "../support/cli.js";
import { parseReport } from "../support/json.js";

describe("CLI defaults and discovery (#788)", () => {
  it("checks with a diff by default and supports explicit preview and check plus diff", async () => {
    const root = await fixture({ "note.md": "A *note*.\n" });
    for (const [options, status, diff] of [
      [[], 1, true],
      [["--diff"], 0, true],
      [["--check", "--diff"], 1, true],
      [["--check"], 1, false],
    ] as const) {
      for (const json of [false, true]) {
        const result = run(root, ["format", ...options, ...(json ? ["--json"] : [])]);
        expect(result.status, JSON.stringify({ options, json })).toBe(status);
        if (json) {
          expect(parseReport(result.stdout).files[0]!.changed).toBe(true);
          expect(result.stdout).not.toContain("--- a/");
          expect(result.stderr).toBe("");
        } else {
          expect(result.stdout.includes("+A _note_.")).toBe(diff);
          expect(result.stderr.endsWith("Use --write to apply formatting changes.\n")).toBe(diff);
        }
      }
    }
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A *note*.\n");
    for (const option of ["--check", "--diff"]) {
      expect(run(root, ["format", "--write", option]).status).toBe(2);
    }
    const written = run(root, ["format", "--write"]);
    expect(written.status).toBe(0);
    expect(written.stdout).toBe("");
    expect(written.stderr).not.toContain("Use --write");
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A _note_.\n");
    expect(run(root, ["format"]).status).toBe(0);
  });
  it("keeps remaining errors failing in every formatting mode", async () => {
    const root = await fixture({ "note.md": "[broken](missing.md)\n" });
    for (const options of [[], ["--diff"], ["--check"], ["--check", "--diff"], ["--write"]]) {
      const result = run(root, ["format", ...options, "--json"]);
      expect(result.status).toBe(1);
      expect(parseReport(result.stdout).files[0]!.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rule: "links/valid", severity: "error" }),
        ]),
      );
    }
  });
  it("infers stdin from its filepath and refuses file paths and writes", async () => {
    const root = await fixture({ "note.md": "A *file*.\n" });
    for (const command of ["lint", "format"]) {
      for (const extra of [[], ["--json"], ["--check"]]) {
        if (command === "lint" && extra.includes("--check")) continue;
        const inferred = run(
          root,
          [command, "--stdin-filepath", "note.md", ...extra],
          "A *stdin*.\n",
        );
        const explicit = run(
          root,
          [command, "-", "--stdin-filepath", "note.md", ...extra],
          "A *stdin*.\n",
        );
        expect(inferred).toMatchObject({
          status: explicit.status,
          stdout: explicit.stdout,
          stderr: explicit.stderr,
        });
      }
      const invalid = run(root, [command, "note.md", "--stdin-filepath", "note.md"]);
      expect(invalid.status).toBe(2);
      expect(invalid.stdout).toBe("");
      expect(invalid.stderr).toContain("with no paths or with - to read stdin");
    }
    expect(run(root, ["format", "--stdin-filepath", "note.md", "--write"], "text").status).toBe(2);
    const stdin = run(root, ["format", "--stdin-filepath", "note.md"], "A *stdin*.\n");
    expect(stdin.status).toBe(0);
    expect(stdin.stdout).toBe("A _stdin_.\n");
    expect(stdin.stderr).toBe("");
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A *file*.\n");
  });
  it("redirects mistaken commands and lint modes without exposing aliases", async () => {
    const root = await fixture({ "note.md": "A *note*.\n" });
    for (const [args, mode] of [
      [["check"], "check"],
      [["fix"], "write"],
      [["lint", "--write"], "write"],
      [["lint", "--check"], "check"],
    ] as const) {
      const result = run(root, [...args]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`mdrefine format --${mode}`);
    }
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A *note*.\n");
  });
  it("loads rules plugins from --root and validates the root", async () => {
    const root = await fixture({
      "nested/mdrefine.config.mjs": 'export default { plugins: ["./plugin.mjs"] };',
      "nested/plugin.mjs":
        'export default { name: "test", rules: { custom: {kind:"problem",description:"Test",check:()=>[]} } };',
    });
    const result = run(root, ["rules", "--root", "nested", "--json"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test/custom");
    expect(run(root, ["rules", "--root", "absent"]).status).toBe(2);
  });
  it("notices empty selections on stderr while preserving JSON and success", async () => {
    const root = await fixture({});
    for (const command of ["lint", "format"]) {
      for (const json of [false, true]) {
        const result = run(root, [command, ...(json ? ["--json"] : [])]);
        expect(result.status).toBe(0);
        expect(result.stderr).toContain("No documents selected.");
        if (json) expect(parseReport(result.stdout).files).toEqual([]);
        else expect(result.stdout).toBe("");
      }
    }
  });
  it("gives contextual help within 80 columns including nested help routes", async () => {
    const root = await fixture({});
    for (const command of [
      ["lint"],
      ["format"],
      ["rules"],
      ["config"],
      ["config", "explain"],
      ["config", "convert"],
    ]) {
      const result = run(root, [...command, "--help"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("including files above a subdirectory");
      expect(result.stdout).toContain("Stdin");
      expect(result.stdout).toContain(
        "Exit codes: 0 success; 1 findings or required changes; 2 usage or run failure.",
      );
      expect(result.stdout).toContain("Examples:");
      expect(Math.max(...result.stdout.split("\n").map((line) => line.length))).toBeLessThanOrEqual(
        80,
      );
      expect(run(root, ["help", ...command]).stdout).toBe(result.stdout);
    }
    const help = run(root, ["--help"]).stdout;
    expect(help).toContain("config explain");
    expect(help).toContain("config convert");
    const format = run(root, ["format", "--help"]).stdout;
    expect(format).toContain(
      "Stdin prints the formatted document by default. --json omits the diff.",
    );
    expect(format).toContain("remaining errors exit 1");
  });
});
