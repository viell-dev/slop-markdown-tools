import { describe, expect, it, vi } from "vitest";
import { Ajv } from "ajv";
import { format, lint, ruleRegistry, canonicalDialect } from "../../src/index.js";
import type { Config, Dialect, Plugin, Rule } from "../../src/index.js";

describe("rules that fail", () => {
  it("rejects a plugin named engine, whose findings would pass for the engine's own", () => {
    const check = () => [{ start: 0, message: "not the engine" }];
    const plugins: Plugin[] = [
      { name: "engine", rules: { "unsafe-format": { kind: "problem", description: "x", check } } },
    ];
    const message = "Invalid plugin name: engine is reserved for the engine's own diagnostics";
    expect(() => ruleRegistry(plugins)).toThrow(message);
    const config: Config = { extends: [], rules: { "engine/unsafe-format": "warn" } };
    for (const run of [lint, format])
      expect(() => run("Text.\n", { plugins, config })).toThrow(message);
  });
  it.each([
    [
      { kind: "style", phase: "Inline" },
      'its phase is "Inline", not "inline", "block", or "document"',
    ],
    [{ kind: "Style" }, 'its kind is "Style", not "style" or "problem"'],
    [{ kind: "problem", check: undefined }, "its check is undefined, not a function"],
    [{ kind: "problem", description: undefined }, "its description is undefined, not a string"],
    [{ kind: "problem", schema: "object" }, 'its schema is "object", not a JSON Schema'],
  ])("rejects a plugin rule that does not have the shape of a rule: %j", (fields, problem) => {
    const rule = { description: "Invalid", check: () => [], ...fields } as unknown as Rule;
    const plugins: Plugin[] = [{ name: "test", rules: { invalid: rule } }];
    const message = `Invalid rule test/invalid: ${problem}.`;
    expect(() => ruleRegistry(plugins)).toThrow(message);
    // Also when the rule is off: a plugin with an invalid rule is unusable.
    for (const run of [lint, format])
      expect(() => run("Text.\n", { plugins, config: { extends: [] } })).toThrow(message);
    expect(() =>
      ruleRegistry([{ name: "test", rules: { invalid: null as unknown as Rule } }]),
    ).toThrow("Invalid rule test/invalid: it is null, not an object.");
  });
  it("looks rule and preset names up only among those defined", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      const rules = JSON.parse(`{"${name}": "warn"}`) as NonNullable<Config["rules"]>;
      expect(() => lint("Text.\n", { config: { rules } })).toThrow(`Unknown rule: ${name}`);
      expect(() => format("Text.\n", { config: { extends: [name] } })).toThrow(
        `Unknown preset: ${name}`,
      );
    }
    expect(canonicalDialect("toString" as Dialect)).toBe("toString");
  });
  it("names the rule whose option schema cannot be compiled", () => {
    const plugins: Plugin[] = [
      {
        name: "test",
        rules: {
          options: {
            kind: "problem",
            description: "Invalid schema",
            schema: { type: "nonsense" },
            check: () => [],
          },
        },
      },
    ];
    expect(() =>
      lint("Text.\n", { plugins, config: { extends: [], rules: { "test/options": "warn" } } }),
    ).toThrow("Invalid rule test/options: its schema cannot be compiled: schema is invalid");
  });
  it("enforces an option schema of false, which no options pass", () => {
    const plugins: Plugin[] = [
      {
        name: "test",
        rules: {
          none: { kind: "problem", description: "No options", schema: false, check: () => [] },
        },
      },
    ];
    expect(
      lint("Text.\n", { plugins, config: { extends: [], rules: { "test/none": "warn" } } }),
    ).toEqual([]);
    expect(() =>
      lint("Text.\n", {
        plugins,
        config: { extends: [], rules: { "test/none": ["warn", { n: 1 }] } },
      }),
    ).toThrow("Invalid options for test/none");
  });
  it("refuses an asynchronous option schema when the rule set is built", async () => {
    const rejected: unknown[] = [];
    const record = (reason: unknown) => rejected.push(reason);
    process.on("unhandledRejection", record);
    try {
      const schema = { $async: true, type: "object", properties: { n: { type: "integer" } } };
      const plugins: Plugin[] = [
        {
          name: "test",
          rules: { slow: { kind: "problem", description: "Async", schema, check: () => [] } },
        },
      ];
      for (const options of [{}, { n: "x" }])
        expect(() =>
          lint("Text.\n", {
            plugins,
            config: { extends: [], rules: { "test/slow": ["warn", options] } },
          }),
        ).toThrow(
          "Invalid rule test/slow: its schema is asynchronous ($async), and options are checked synchronously",
        );
      // Before, the check returned a promise that rejected after the run.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(rejected).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
  it("compiles each option schema once, however many documents use it", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { level: { type: "integer" } },
    };
    const plugins: Plugin[] = [
      {
        name: "test",
        rules: { options: { kind: "problem", description: "Options", schema, check: () => [] } },
      },
    ];
    const compile = vi.spyOn(Ajv.prototype, "compile");
    try {
      for (let level = 0; level < 5; level++)
        lint("Text.\n", {
          plugins,
          config: { extends: [], rules: { "test/options": ["warn", { level }] } },
        });
      expect(() =>
        lint("Text.\n", {
          plugins,
          config: { extends: [], rules: { "test/options": ["warn", { level: "high" }] } },
        }),
      ).toThrow('Invalid options for test/options: "level" must be an integer, not "high"');
      expect(compile.mock.calls.filter(([compiled]) => compiled === schema)).toHaveLength(1);
    } finally {
      compile.mockRestore();
    }
  });
});
describe("configuration and plugins", () => {
  it("supports custom diagnostics and rejects semantic-changing style plugins", () => {
    const plugin: Plugin = {
      name: "example",
      rules: {
        forbidden: {
          kind: "problem",
          description: "Detect a word",
          check: ({ document }) =>
            document.source.includes("secret") ? [{ start: 0, message: "Contains secret." }] : [],
        },
        destructive: {
          kind: "style",
          description: "Bad plugin",
          check: () => [
            { start: 0, message: "Replace", edit: { start: 0, end: 4, text: "other" } },
          ],
        },
      },
    };
    expect(
      lint("secret", {
        config: { extends: [], rules: { "example/forbidden": "error" } },
        plugins: [plugin],
      })[0]?.rule,
    ).toBe("example/forbidden");
    const result = format("word\n", {
      config: { extends: [], rules: { "example/destructive": "warn" } },
      plugins: [plugin],
    });
    expect(result.output).toBe("word\n");
    expect(result.diagnostics[0]?.rule).toBe("engine/unsafe-format");
  });
  it("validates changing options and scopes custom schema IDs to each invocation", () => {
    expect(() =>
      lint("", { config: { rules: { "style/wrap": ["warn", { width: 30 }] } } }),
    ).not.toThrow();
    expect(() => lint("", { config: { rules: { "style/wrap": ["warn", { width: 1 }] } } })).toThrow(
      "Invalid options",
    );
    for (const field of ["first", "second"]) {
      const plugin: Plugin = {
        name: "local",
        rules: {
          check: {
            kind: "problem",
            description: "Schema isolation",
            check: () => [],
            schema: {
              $id: "https://example.test/options",
              type: "object",
              required: [field],
              properties: { [field]: { type: "boolean" } },
            },
          },
        },
      };
      expect(() =>
        lint("", {
          plugins: [plugin],
          config: { extends: [], rules: { "local/check": ["warn", { [field]: true }] } },
        }),
      ).not.toThrow();
    }
  });
});
