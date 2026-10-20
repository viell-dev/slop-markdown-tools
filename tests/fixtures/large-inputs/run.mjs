import assert from "node:assert/strict";
import process from "node:process";
import { createWorkspace, format, lint, resolveConfig } from "../../../dist/index.js";

const count = 130000;
const scenario = process.argv[2];
const noEngineErrors = (diagnostics) =>
  assert.ok(!diagnostics.some((item) => item.rule.startsWith("engine/")), "Internal diagnostic");

if (scenario === "findings") {
  const plugin = {
    name: "many",
    rules: {
      findings: {
        description: "Many findings without edits",
        kind: "style",
        check: () => Array.from({ length: count }, () => ({ start: 0, message: "Finding" })),
      },
    },
  };
  const options = { config: { extends: [], rules: { "many/findings": "warn" } }, plugins: [plugin] };
  for (let iteration = 0; iteration < 2; iteration++) {
    const result = format("x\n", options);
    noEngineErrors(result.diagnostics);
    assert.equal(result.diagnostics.length, count);
    assert.equal(result.output, "x\n");
    assert.equal(result.changed, false);
  }
} else if (scenario === "ignore") {
  const patterns = ["first/**", ...Array(count).fill("generated/**"), "last/**"];
  const result = resolveConfig({ config: { extends: [], ignore: patterns } });
  assert.deepEqual(result.ignore, patterns);
} else if (scenario === "overrides") {
  const result = resolveConfig({
    path: "document.md",
    config: {
      extends: [],
      overrides: [
        ...Array(count).fill({ files: ["never.md"] }),
        { files: ["document.md"], rules: { "style/emphasis": "warn" } },
      ],
    },
  });
  assert.deepEqual(result.rules, { "style/emphasis": "warn" });
} else if (scenario === "lookup") {
  const workspace = createWorkspace(
    Object.fromEntries(Array.from({ length: count }, (_, n) => [`folder${n}/Shared.md`, ""])),
    { dialect: "obsidian" },
  );
  assert.equal(workspace.resolve("Note.md", "Shared.md", "obsidian").status, "ambiguous");
  assert.equal(workspace.resolve("Note.md", "folder0/Shared.md", "obsidian").status, "resolved");
} else {
  const tick = String.fromCharCode(96);
  const cases = {
    table: {
      source: "| a |\n| --- |\n" + "| x |\n".repeat(count),
      expected: "| a   |\n| --- |\n" + "| x   |\n".repeat(count),
      rule: "style/table",
    },
    wrap: { source: "word ".repeat(count) + "end\n", rule: "style/wrap" },
    "inline-code": {
      source: tick.repeat(2) + " " + (tick + "x").repeat(count) + "\ny " + tick.repeat(2) + "\n",
      rule: "style/inline-code",
    },
  };
  const input = cases[scenario];
  assert.ok(input, "Unknown scenario");
  const options = { config: { extends: [], rules: { [input.rule]: "warn" } } };
  const diagnostics = lint(input.source, options);
  noEngineErrors(diagnostics);
  assert.ok(diagnostics.some((item) => item.rule === input.rule));
  const result = format(input.source, options);
  noEngineErrors(result.diagnostics);
  assert.equal(result.changed, true);
  if (input.expected) assert.ok(result.output === input.expected, "Unexpected table output");
  if (scenario === "wrap") {
    assert.equal(result.output.replaceAll(/\s/g, ""), input.source.replaceAll(/\s/g, ""));
  }
  if (scenario === "inline-code") {
    assert.ok(result.output === input.source.replace("\ny", " y"), "Unexpected code span output");
  }
  const repeated = format(result.output, options);
  noEngineErrors(repeated.diagnostics);
  assert.ok(repeated.output === result.output, "Formatting is not stable");
  assert.equal(repeated.changed, false);
}

process.stdout.write(JSON.stringify({ scenario, ok: true }));
