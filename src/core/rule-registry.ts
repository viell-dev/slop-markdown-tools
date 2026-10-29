import { Ajv } from "ajv";
import type { AnySchema, ValidateFunction } from "ajv";
import { deepFreeze } from "./frozen.js";
import { resolveConfig, setting } from "../config/resolve.js";
import { optionErrors, shown } from "../config/problems.js";
import { styleRules } from "../rules/style.js";
import { blockRules } from "../rules/blocks.js";
import { dialectRules } from "../rules/dialects.js";
import { structureRules } from "../rules/structure.js";
import { linkStyleRules } from "../rules/link-style.js";
import { linkRules } from "../rules/links.js";
import { contentRules } from "../rules/content.js";
import { listRules } from "../rules/lists.js";
import type { JsonSchema, Plugin, ProcessOptions, Rule } from "./types.js";

/**
 * The built-in rules by rule ID. The table and the rules in it are frozen, so
 * that no caller can change what another one runs.
 */
export const builtInRules: Readonly<Record<string, Readonly<Rule>>> = deepFreeze({
  ...styleRules,
  ...blockRules,
  ...dialectRules,
  ...linkRules,
  ...linkStyleRules,
  ...structureRules,
  ...contentRules,
  ...listRules,
});
export const phases = ["inline", "block", "document"] as const;
/** What is wrong with a plugin's rule, or undefined when it has the shape of a `Rule`. */
function ruleProblem(rule: unknown): string | undefined {
  if (!rule || typeof rule !== "object") return `it is ${shown(rule)}, not an object`;
  const { check, kind, phase, description, schema } = rule as Record<string, unknown>;
  if (typeof check !== "function") return `its check is ${shown(check)}, not a function`;
  if (kind !== "style" && kind !== "problem")
    return `its kind is ${shown(kind)}, not "style" or "problem"`;
  if (phase !== undefined && !(phases as readonly unknown[]).includes(phase))
    return `its phase is ${shown(phase)}, not "inline", "block", or "document"`;
  if (typeof description !== "string")
    return `its description is ${shown(description)}, not a string`;
  if (
    schema !== undefined &&
    typeof schema !== "boolean" &&
    (!schema || typeof schema !== "object" || Array.isArray(schema))
  )
    return `its schema is ${shown(schema)}, not a JSON Schema`;
  // Options are checked before each run, synchronously; an asynchronous
  // check would come back after the run, too late to stop it.
  if (schema && typeof schema === "object" && (schema as { $async?: unknown }).$async === true)
    return "its schema is asynchronous ($async), and options are checked synchronously";
  return undefined;
}
/**
 * The prefix of the engine's own diagnostics, such as `engine/rule-error`. A
 * plugin of this name could report findings that pass for the engine's, which
 * concern the whole document and make the CLI exit with code 2.
 */
export const reservedPluginName = "engine";
/**
 * The built-in rules and those of `plugins`, by rule ID, in a new table. A
 * plugin name that is invalid, reserved, or used twice, a rule ID that exists
 * already, and a plugin rule that does not have the shape of a `Rule` are
 * errors that name them.
 */
export function ruleRegistry(plugins: readonly Plugin[] = []): Record<string, Readonly<Rule>> {
  const rules = { ...builtInRules };
  const names = new Set<string>();
  for (const plugin of plugins) {
    if (plugin.name === reservedPluginName)
      throw new Error(
        `Invalid plugin name: ${reservedPluginName} is reserved for the engine's own diagnostics`,
      );
    if (!/^[a-z][a-z\d-]*$/.test(plugin.name) || names.has(plugin.name))
      throw new Error(`Invalid or duplicate plugin name: ${plugin.name}`);
    names.add(plugin.name);
    for (const [name, rule] of Object.entries(plugin.rules ?? {})) {
      const id = `${plugin.name}/${name}`;
      if (Object.hasOwn(rules, id)) throw new Error(`Duplicate rule: ${id}`);
      const problem = ruleProblem(rule);
      if (problem) throw new Error(`Invalid rule ${id}: ${problem}.`);
      rules[id] = rule;
    }
  }
  return rules;
}
/** Option schemas can check JavaScript pattern syntax without running the pattern. */
function optionsCompiler() {
  return new Ajv({ allErrors: true }).addFormat("regex", (pattern: string) => {
    try {
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  });
}
/** Checks the options of built-in rules, whose schemas have no `$id` that could collide. */
const ruleValidator = optionsCompiler();
const builtInSchemas = new Set(Object.values(builtInRules).map((rule) => rule.schema));
/**
 * Each option schema compiled once, however many documents use it. A plugin
 * schema gets a validator of its own, because distinct plugins may
 * legitimately reuse an `$id` with different schemas.
 */
const compiledSchemas = new WeakMap<object, ValidateFunction>();
function optionsValidator(name: string, schema: JsonSchema): ValidateFunction {
  // Ajv keeps compiled boolean schemas itself.
  if (typeof schema !== "object") return ruleValidator.compile(schema);
  let validate = compiledSchemas.get(schema);
  if (!validate) {
    try {
      validate = (builtInSchemas.has(schema) ? ruleValidator : optionsCompiler()).compile(
        schema as AnySchema,
      );
    } catch (error) {
      throw new Error(
        `Invalid rule ${name}: its schema cannot be compiled: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    // A schema can become asynchronous through one that it refers to.
    if ((validate as { $async?: unknown }).$async === true)
      throw new Error(
        `Invalid rule ${name}: its schema is asynchronous ($async), and options are checked synchronously`,
      );
    compiledSchemas.set(schema, validate);
  }
  return validate;
}
export function prepare(options: ProcessOptions) {
  // Only these options, so that resolveConfig's check for the prereleases' form sees no others.
  const { config: given, path, plugins, defaultDialect } = options;
  const config = resolveConfig({ config: given, path, plugins, defaultDialect });
  const rules = ruleRegistry(options.plugins);
  for (const [name, value] of Object.entries(config.rules)) {
    // Names such as `toString` are found on every object; only defined rules count.
    if (!Object.hasOwn(rules, name)) throw new Error(`Unknown rule: ${name}`);
    const rule = rules[name]!;
    const enabled = setting(value);
    // A schema of `false` means that the rule takes no options. A setting that
    // gives none is checked as empty options, which `false` would refuse too.
    if (rule.schema === false && enabled.severity !== "off") {
      if (Object.keys(enabled.options).length)
        throw new Error(`Invalid options for ${name}: the rule takes no options`);
    } else if (rule.schema !== undefined && enabled.severity !== "off") {
      const validate = optionsValidator(name, rule.schema);
      if (!validate(enabled.options))
        throw new Error(
          `Invalid options for ${name}: ${optionErrors(validate.errors ?? [], enabled.options)}`,
        );
    }
  }
  return { config, rules };
}
