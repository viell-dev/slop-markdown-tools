import { Ajv } from "ajv";
import { minimatch } from "minimatch";
import { configErrors } from "./problems.js";
import { deepFreeze } from "../core/frozen.js";
import type {
  Config,
  Dialect,
  DialectName,
  JsonSchemaObject,
  ResolveConfigOptions,
  ResolvedConfig,
  RuleSetting,
} from "../core/types.js";

/**
 * Alias names that select an existing dialect, mapped to that dialect:
 * Codeberg runs Forgejo's renderer. The table is frozen.
 */
export const dialectAliases: Readonly<Record<Exclude<DialectName, Dialect>, Dialect>> =
  Object.freeze({ codeberg: "forgejo" });
/** The dialects, in the order the documentation lists them. The list is frozen. */
export const dialects: readonly Dialect[] = Object.freeze([
  "commonmark",
  "github",
  "forgejo",
  "gitea",
  "obsidian",
]);
/**
 * The dialect assumed when nothing names one and the caller knows no better.
 * GitHub's syntax is the common base of the Forgejo, Gitea, and Obsidian
 * dialects, so a table or a footnote written for any of them is not read as an
 * ordinary paragraph and reflowed.
 */
export const fallbackDialect: Dialect = "github";
/**
 * The dialect that `name` stands for: an alias's dialect, or `name` itself.
 * A name that is neither is returned as it is.
 */
export function canonicalDialect(name: DialectName): Dialect {
  return Object.hasOwn(dialectAliases, name)
    ? dialectAliases[name as keyof typeof dialectAliases]
    : (name as Dialect);
}
/** The dialect that `name` stands for, or an error that says what was named. */
export function knownDialect(name: DialectName, what = "dialect"): Dialect {
  const dialect = canonicalDialect(name);
  if (!dialects.includes(dialect)) throw new Error(`Unknown ${what}: ${String(name)}`);
  return dialect;
}

/**
 * The built-in presets by name. The table and everything in it are frozen, so
 * that no caller can change what another one gets.
 */
export const presets: Readonly<Record<string, Readonly<Config>>> = {
  recommended: {
    rules: {
      "style/wrap": ["warn", { width: 80 }],
      "style/emphasis": ["warn", { marker: "_" }],
      "style/strong": ["warn", { marker: "*" }],
      "style/final-newline": "warn",
      "links/valid": "error",
      "links/undefined-reference": "warn",
      "links/unused-definition": "warn",
      "links/empty": "warn",
      "structure/heading-increment": "warn",
      "content/image-alt": "warn",
      "content/table-columns": "warn",
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
deepFreeze(presets);
// Each dialect is followed by its aliases, as the command line lists them.
const dialectNames = dialects.flatMap((dialect) => [
  dialect,
  ...Object.entries(dialectAliases).flatMap(([alias, of]) => (of === dialect ? [alias] : [])),
]);
const strings = { type: "array", items: { type: "string" } };
/**
 * The configuration's JSON Schema, which `validateConfig` enforces. The
 * package ships it as `config.schema.json`, which a test keeps equal to it,
 * and the documentation site serves it for editors.
 */
export const configSchema: JsonSchemaObject = deepFreeze({
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "mdtools configuration",
  description:
    "Configuration of the mdtools command of mdrefine: https://viell-dev.github.io/slop-markdown-tools/configuration.html",
  type: "object",
  additionalProperties: false,
  properties: {
    $schema: { description: "The JSON Schema for editors; the tool ignores it.", type: "string" },
    resolve: {
      description: "Files that links may lead to, which are never linted or formatted.",
      type: "object",
      additionalProperties: false,
      properties: {
        gitIgnored: {
          description: "Files that .gitignore files exclude are link targets. Default: false.",
          type: "boolean",
        },
        nestedRepositories: {
          description: "Files of nested Git repositories are link targets. Default: false.",
          type: "boolean",
        },
      },
    },
    extends: {
      description:
        "Presets to start from, in order: a preset name or a list of them. Without it, the configuration starts from recommended.",
      anyOf: [{ type: "string" }, strings],
    },
    dialect: { $ref: "#/definitions/dialect" },
    rules: { $ref: "#/definitions/rules" },
    ignore: {
      description:
        "Path patterns of documents that are never linted or formatted. They stay link targets.",
      ...strings,
    },
    plugins: {
      description: "Plugins to load: files relative to this file, or package names.",
      ...strings,
    },
    overrides: {
      description: "Settings for the documents that match one of the patterns in files.",
      type: "array",
      items: {
        type: "object",
        required: ["files"],
        additionalProperties: false,
        properties: {
          files: {
            description: "Path patterns, matched against paths relative to the workspace root.",
            ...strings,
            minItems: 1,
          },
          dialect: { $ref: "#/definitions/dialect" },
          rules: { $ref: "#/definitions/rules" },
        },
      },
    },
  },
  definitions: {
    dialect: {
      description:
        "The renderer whose syntax documents are read in. When nothing names one, github is assumed, or obsidian inside a vault.",
      enum: dialectNames,
    },
    severity: { enum: ["off", "warn", "error"] },
    rules: {
      description:
        'Rule IDs and their settings: a severity, or a list of a severity and the rule\'s options, as in ["warn", { "width": 100 }].',
      type: "object",
      additionalProperties: {
        anyOf: [
          { $ref: "#/definitions/severity" },
          { type: "array", items: [{ $ref: "#/definitions/severity" }], minItems: 1, maxItems: 1 },
          {
            type: "array",
            items: [{ $ref: "#/definitions/severity" }, { type: "object" }],
            minItems: 2,
            maxItems: 2,
          },
        ],
      },
    },
  },
});
const validate = new Ajv({ allErrors: true }).compile(configSchema);
/** What is wrong with `value` as a configuration, in plain words, or undefined when it is valid. */
export function configProblem(value: unknown): string | undefined {
  return validate(value) ? undefined : configErrors(validate.errors ?? [], value, dialectNames);
}
/**
 * Throws an error that says what is wrong when `value` is not a configuration
 * that `configSchema` describes, naming each setting as it is written, as in
 * `Invalid configuration: "extends[1]" must be a preset name, not 5`. Rule IDs,
 * preset names, and rule options are checked when a document is processed.
 */
export function validateConfig(value: unknown): asserts value is Config {
  const problem = configProblem(value);
  if (problem) throw new Error(`Invalid configuration: ${problem}`);
}
const noOptions: Readonly<Record<string, unknown>> = Object.freeze({});
export function setting(value: RuleSetting): {
  severity: "off" | "warn" | "error";
  options: Readonly<Record<string, unknown>>;
} {
  return Array.isArray(value)
    ? { severity: value[0], options: value[1] ?? noOptions }
    : { severity: value as Exclude<RuleSetting, readonly unknown[]>, options: noOptions };
}
/**
 * Set each of `rules` in `target`. A rule named `__proto__` becomes a setting
 * like any other, to be reported as unknown, instead of replacing the
 * object's prototype as an assignment would.
 */
function addRules(target: Record<string, RuleSetting>, rules: Config["rules"] = {}) {
  for (const [name, value] of Object.entries(rules))
    Object.defineProperty(target, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
}
/** Settings that only a configuration has, which show a call in the prereleases' form. */
const configOnly = new Set(
  Object.keys(configSchema.properties as object).filter((key) => key !== "plugins"),
);
/**
 * The configuration in effect for one document: its dialect, rule settings,
 * `ignore` patterns, and `resolve` settings. It takes the `path`, `config`,
 * `plugins`, and `defaultDialect` that `lint` and `format` take, so their
 * options serve as they are. `defaultDialect` is the dialect to assume when
 * neither the configuration, a preset, nor a matching override names one:
 * `github` unless the caller knows better, as the CLI does inside an Obsidian
 * vault. An invalid configuration or default dialect, an unknown preset, and a
 * cycle of presets throw an error.
 */
export function resolveConfig(options: ResolveConfigOptions = {}): ResolvedConfig {
  // The prereleases took the configuration, path, plugins, and default dialect one by one.
  if (
    arguments.length > 1 ||
    typeof options !== "object" ||
    options === null ||
    Object.keys(options).some((key) => configOnly.has(key))
  )
    throw new TypeError(
      "resolveConfig takes one options object, { path, config, plugins, defaultDialect }, since mdrefine 0.2.0.",
    );
  const { config = {}, path = "document.md", plugins = [] } = options;
  validateConfig(config);
  const assumed = knownDialect(options.defaultDialect ?? fallbackDialect, "default dialect");
  const available: Record<string, Readonly<Config>> = { ...presets };
  for (const plugin of plugins)
    for (const [name, preset] of Object.entries(plugin.presets ?? {}))
      available[`${plugin.name}/${name}`] = preset;
  const result: ResolvedConfig = { dialect: assumed, rules: {}, ignore: [], resolve: {} };
  const overrides: NonNullable<Config["overrides"]>[number][] = [];
  function merge(part: Readonly<Config>, chain: readonly string[]) {
    validateConfig(part);
    for (const name of typeof part.extends === "string" ? [part.extends] : (part.extends ?? [])) {
      if (chain.includes(name))
        throw new Error(`Circular preset: ${[...chain, name].join(" -> ")}`);
      // Names such as `toString` are found on every object; only defined presets count.
      if (!Object.hasOwn(available, name)) throw new Error(`Unknown preset: ${name}`);
      merge(available[name]!, [...chain, name]);
    }
    if (part.dialect) result.dialect = canonicalDialect(part.dialect);
    addRules(result.rules, part.rules);
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
      addRules(result.rules, override.rules);
    }
  }
  return result;
}
