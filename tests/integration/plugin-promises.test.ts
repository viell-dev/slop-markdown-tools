import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { cli, fixture, repository } from "./support.js";

const cases = [
  ["fulfilled async function", "async check() { return []; }"],
  ["rejected async function", 'async check() { throw new Error("rejected"); }'],
  ["fulfilled Promise", "check() { return Promise.resolve([]); }"],
  ["rejected Promise", 'check() { return Promise.reject(new Error("rejected")); }'],
  [
    "later rejection",
    'async check() { await new Promise(resolve => setTimeout(resolve, 5)); throw new Error("later"); }',
  ],
  [
    "rejected thenable",
    'check() { return { then(resolve, reject) { reject(new Error("rejected")); } }; }',
  ],
  ["throwing then getter", 'check() { return { get then() { throw new Error("getter"); } }; }'],
  ["pending Promise", "check() { return new Promise(() => {}); }"],
];
const plugin = (check: string) => `{
  name: "local", rules: { invalid: {
    description: "Invalid asynchronous check", kind: "problem", ${check}
  } }
}`;

it.each(cases)("isolates a directly returned %s in the synchronous API (#457)", (_name, check) => {
  const script = `
    import assert from "node:assert/strict";
    import { lint, format } from ${JSON.stringify(pathToFileURL(path.join(repository, "dist/index.js")).href)};
    const before = process.listenerCount("unhandledRejection");
    const options = {
      config: { extends: [], rules: { "local/invalid": "error", "style/emphasis": "warn" } },
      plugins: [${plugin(check!)}],
    };
    for (const source of ["First *word*.\\n", "Second *word*.\\n"]) {
      const findings = lint(source, options);
      assert.equal(findings.filter(item => item.rule === "engine/rule-error").length, 1);
      const result = format(source, options);
      assert.equal(result.output, source.replaceAll("*", "_"));
      assert.ok(result.diagnostics.some(item => item.rule === "engine/rule-error"));
    }
    assert.equal(process.listenerCount("unhandledRejection"), before);
    console.log("completed");
  `;
  const result = spawnSync(
    process.execPath,
    ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
    {
      cwd: repository,
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  expect(result.error?.message).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("completed\n");
  expect(result.stderr).toBe("");
});

it.each(cases)("preserves CLI reports and exit status for a %s (#457)", async (_name, check) => {
  const root = await fixture({
    "a.md": "First *word*.\n",
    "b.md": "Second *word*.\n",
    "plugin.mjs": `export default ${plugin(check!)};`,
    "mdtools.config.mjs":
      'export default { extends: [], plugins: ["./plugin.mjs"], rules: { "local/invalid": "error", "style/emphasis": "warn" } };',
  });
  for (const command of ["lint", "format"]) {
    const result = spawnSync(
      process.execPath,
      ["--unhandled-rejections=strict", cli, command, "--json", "."],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(result.error?.message).toBeUndefined();
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as {
      files: {
        path: string;
        changed?: boolean;
        diagnostics: { rule: string; message: string }[];
      }[];
    };
    expect(report.files.map((item) => item.path)).toEqual(["a.md", "b.md"]);
    for (const file of report.files) {
      expect(file.diagnostics).toContainEqual(
        expect.objectContaining({
          rule: "engine/rule-error",
          message: expect.stringContaining(
            "Rule local/invalid returned an object instead of a list of findings",
          ),
        }),
      );
      if (command === "format") expect(file.changed).toBe(true);
    }
  }
});
