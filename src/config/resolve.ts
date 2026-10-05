import { Ajv } from "ajv";
import { minimatch } from "minimatch";
import type {
  Config,
  Dialect,
  DialectName,
  Plugin,
  ResolvedConfig,
  RuleSetting,
} from "../core/types.js";

/** Alias names that select an existing dialect; Codeberg runs Forgejo's renderer. */
export const dialectAliases: Record<string, Dialect> = { codeberg: "forgejo" };
export const dialects: Dialect[] = ["commonmark", "github", "forgejo", "gitea", "obsidian"];
/**
 * The dialect assumed when nothing names one and the caller knows no better.
 * GitHub's syntax is the common base of the Forgejo, Gitea, and Obsidian
 * dialects, so a table or a footnote written for any of them is not read as an
 * ordinary paragraph and reflowed.
 */
export const fallbackDialect: Dialect = "github";
export function canonicalDialect(name: DialectName): Dialect {
  return dialectAliases[name] ?? (name as Dialect);
}

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
  forgejo: {
    dialect: "forgejo",
    rules: {
      "github/task-marker": "warn",
      "github/alert-marker": "warn",
      "style/table": "warn",
      "forgejo/heading-id": "error",
    },
  },
  codeberg: { extends: ["forgejo"] },
  gitea: {
    dialect: "gitea",
    rules: {
      "github/task-marker": "warn",
      "github/alert-marker": "warn",
      "style/table": "warn",
      "forgejo/heading-id": "error",
    },
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
const dialect = { enum: [...dialects, ...Object.keys(dialectAliases)] };
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
    resolve: {
      type: "object",
      additionalProperties: false,
      properties: { gitIgnored: { type: "boolean" }, nestedRepositories: { type: "boolean" } },
    },
    extends: { type: "array", items: { type: "string" } },
    dialect,
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
          dialect,
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
/**
 * The configuration in effect for the document at `path`. `defaultDialect` is
 * the dialect to assume when neither the configuration, a preset, nor a
 * matching override names one: `github` unless the caller knows better, as the
 * CLI does at the root of an Obsidian vault.
 */
export function resolveConfig(
  config: Config = {},
  path = "document.md",
  plugins: Plugin[] = [],
  defaultDialect: DialectName = fallbackDialect,
): ResolvedConfig {
  validateConfig(config);
  if (!dialects.includes(canonicalDialect(defaultDialect)))
    throw new Error(`Unknown default dialect: ${String(defaultDialect)}`);
  const available = { ...presets };
  for (const plugin of plugins)
    for (const [name, preset] of Object.entries(plugin.presets ?? {}))
      available[`${plugin.name}/${name}`] = preset;
  const result: ResolvedConfig = {
    dialect: canonicalDialect(defaultDialect),
    rules: {},
    ignore: [],
    resolve: {},
  };
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
    if (part.dialect) result.dialect = canonicalDialect(part.dialect);
    Object.assign(result.rules, part.rules);
    Object.assign(result.resolve, part.resolve);
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
      if (override.dialect) result.dialect = canonicalDialect(override.dialect);
      Object.assign(result.rules, override.rules);
    }
  }
  return result;
}
