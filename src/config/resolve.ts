import { Ajv } from "ajv";
import { minimatch } from "minimatch";
import type { Config, Plugin, ResolvedConfig, RuleSetting } from "../core/types.js";

export const presets: Record<string, Config> = {
  recommended: {
    rules: {
      "style/wrap": ["warn", { width: 80 }],
      "style/emphasis": ["warn", { marker: "_" }],
      "style/strong": ["warn", { marker: "*" }],
      "style/final-newline": "warn",
      "links/valid": "error",
    },
  },
  github: {
    dialect: "github",
    rules: { "github/task-marker": "warn", "github/alert-marker": "warn", "style/table": "warn" },
  },
  obsidian: {
    dialect: "obsidian",
    rules: {
      "obsidian/callout-marker": "warn",
      "obsidian/block-reference": "error",
      "obsidian/strict-line-breaks": "warn",
      "github/task-marker": "warn",
      "style/table": "warn",
    },
  },
};
const severity = { enum: ["off", "warn", "error"] };
const rules = {
  type: "object",
  additionalProperties: {
    anyOf: [
      severity,
      { type: "array", items: [severity, { type: "object" }], minItems: 2, maxItems: 2 },
    ],
  },
};
export const configSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    extends: { type: "array", items: { type: "string" } },
    dialect: { enum: ["commonmark", "github", "obsidian"] },
    rules,
    ignore: { type: "array", items: { type: "string" } },
    plugins: { type: "array", items: { type: "string" } },
    overrides: {
      type: "array",
      items: {
        type: "object",
        required: ["files"],
        additionalProperties: false,
        properties: {
          files: { type: "array", items: { type: "string" }, minItems: 1 },
          dialect: { enum: ["commonmark", "github", "obsidian"] },
          rules,
        },
      },
    },
  },
};
const validate = new Ajv({ allErrors: true }).compile(configSchema);
export function validateConfig(value: unknown): asserts value is Config {
  if (!validate(value))
    throw new Error(`Invalid configuration: ${new Ajv().errorsText(validate.errors)}`);
}
export function setting(value: RuleSetting): {
  severity: "off" | "warn" | "error";
  options: Record<string, unknown>;
} {
  return Array.isArray(value)
    ? { severity: value[0], options: value[1] }
    : { severity: value, options: {} };
}
export function resolveConfig(
  config: Config = {},
  path = "document.md",
  plugins: Plugin[] = [],
): ResolvedConfig {
  validateConfig(config);
  const available = { ...presets };
  for (const plugin of plugins)
    for (const [name, preset] of Object.entries(plugin.presets ?? {}))
      available[`${plugin.name}/${name}`] = preset;
  const result: ResolvedConfig = { dialect: "commonmark", rules: {}, ignore: [] };
  const overrides: NonNullable<Config["overrides"]> = [];
  function merge(part: Config, chain: string[]) {
    validateConfig(part);
    for (const name of part.extends ?? []) {
      if (chain.includes(name))
        throw new Error(`Circular preset: ${[...chain, name].join(" -> ")}`);
      const preset = available[name];
      if (!preset) throw new Error(`Unknown preset: ${name}`);
      merge(preset, [...chain, name]);
    }
    if (part.dialect) result.dialect = part.dialect;
    Object.assign(result.rules, part.rules);
    result.ignore.push(...(part.ignore ?? []));
    overrides.push(...(part.overrides ?? []));
  }
  if (config.extends === undefined) merge(presets.recommended!, []);
  merge(config, []);
  for (const override of overrides) {
    if (
      override.files.some((pattern) =>
        minimatch(path.replaceAll("\\", "/"), pattern, { dot: true }),
      )
    ) {
      if (override.dialect) result.dialect = override.dialect;
      Object.assign(result.rules, override.rules);
    }
  }
  return result;
}
