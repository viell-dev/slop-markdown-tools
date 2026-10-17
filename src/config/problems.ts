import type { ErrorObject } from "ajv";

/** A short description of a value that was given where something else belongs. */
export function shown(value: unknown): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
    case "number":
    case "bigint":
    case "boolean":
    case "undefined":
      return String(value);
    case "function":
      return "a function";
    case "symbol":
      return "a symbol";
    default:
      return value === null ? "null" : Array.isArray(value) ? "a list" : "an object";
  }
}
/** Alternatives in prose: `"a", "b", or "c"`. */
function either(items: readonly string[]): string {
  return items.length < 3
    ? items.join(" or ")
    : `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
}
/** The keys of a JSON pointer, such as `/rules/style~1wrap`, unescaped. */
function keys(pointer: string): string[] {
  return pointer
    ? pointer
        .slice(1)
        .split("/")
        .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"))
    : [];
}
/** Keys as a path written the way a reader finds them in a file: `overrides[0].files`. */
function written(path: readonly string[]): string {
  let text = "";
  for (const key of path) text += /^\d+$/.test(key) ? `[${key}]` : text ? `.${key}` : key;
  return text;
}
/** The part of `value` at `path`. */
function at(value: unknown, path: readonly string[]): unknown {
  for (const key of path)
    value =
      value && typeof value === "object" && Object.hasOwn(value, key)
        ? (value as Record<string, unknown>)[key]
        : undefined;
  return value;
}
const typeWords: Record<string, string> = {
  string: "a string",
  number: "a number",
  integer: "an integer",
  boolean: "true or false",
  object: "an object",
  array: "a list",
  null: "null",
};
/** Limits in plain words, by keyword. */
const limits: Record<string, (limit: unknown) => string> = {
  minimum: (limit) => `must be at least ${String(limit)}`,
  maximum: (limit) => `must be at most ${String(limit)}`,
  exclusiveMinimum: (limit) => `must be more than ${String(limit)}`,
  exclusiveMaximum: (limit) => `must be less than ${String(limit)}`,
  minItems: (limit) => `must hold at least ${String(limit)} item(s)`,
  maxItems: (limit) => `must hold at most ${String(limit)} item(s)`,
  minLength: (limit) => `must be at least ${String(limit)} character(s) long`,
  maxLength: (limit) => `must be at most ${String(limit)} character(s) long`,
};
/** Keywords whose failure means that the value itself is of the wrong kind, so naming it helps. */
const kinds = new Set(["type", "enum", "const"]);

/** What a part of the configuration is called in a message, and what it must be. */
interface Place {
  /** Places of one setting, whose errors are reported together. */
  setting: string;
  label: string;
  expected?: string;
}
const severities = either(['"off"', '"warn"', '"error"']);
/** Where `path` lies in a configuration, or in the override `scope` when it is set. */
function place(path: readonly string[], dialects: readonly string[], scope?: string): Place {
  const [key, ...rest] = path;
  const name = (keys: readonly string[]) => `"${scope ? `${scope}.` : ""}${written(keys)}"`;
  const setting = written(scope ? [scope, ...path.slice(0, 1)] : path.slice(0, 1));
  const item = (whole: string, one: string): Place =>
    rest.length
      ? { setting, label: name(path.slice(0, 2)), expected: one }
      : { setting, label: name(path), expected: whole };
  switch (key) {
    case undefined:
      return scope
        ? { setting: scope, label: `"${scope}"`, expected: 'an object with "files"' }
        : { setting: "", label: "the configuration", expected: "an object" };
    case "$schema":
      return { setting, label: name(path), expected: "a string" };
    case "resolve":
      return rest.length
        ? {
            setting: written(path.slice(0, 2)),
            label: name(path.slice(0, 2)),
            expected: "true or false",
          }
        : { setting, label: name(path), expected: "an object" };
    case "extends":
      return item("a preset name or a list of preset names", "a preset name");
    case "dialect":
      return { setting, label: name(path), expected: either(dialects.map((item) => `"${item}"`)) };
    case "ignore":
      return item("a list of path patterns", "a path pattern");
    case "plugins":
      return item("a list of file or package names", "a file or package name");
    case "files":
      return item("a list of one or more path patterns", "a path pattern");
    case "rules": {
      const [id, part] = rest;
      if (id === undefined)
        return { setting, label: name(path), expected: "an object of rule IDs and their settings" };
      const of = `"${id}"${scope ? ` in "${scope}"` : ""}`;
      const rule = `${setting}/${id}`;
      if (part === "0")
        return { setting: rule, label: `the severity of ${of}`, expected: severities };
      if (part === "1")
        return { setting: rule, label: `the options of ${of}`, expected: "an object" };
      return {
        setting: rule,
        label: `the setting of ${of}`,
        expected: `${severities}, or a list of a severity and, optionally, the rule's options`,
      };
    }
    case "overrides": {
      const [index, ...inside] = rest;
      if (index === undefined)
        return { setting, label: name(path), expected: 'a list of objects with "files"' };
      return place(inside, dialects, `overrides[${index}]`);
    }
    default:
      return { setting: written(path), label: name(path) };
  }
}

/**
 * Validation errors of a JSON Schema as one message in plain words, with each
 * part named as it is written in the file: `"extends[1]" must be a preset name,
 * not 5`. `describe` names a part and says what it must be; without
 * `expected`, the validator's own words say it. Of the errors of one setting,
 * only those deepest in the value are kept: they are the ones that a list or
 * an object allowed as a whole still breaks.
 */
function phrased(
  errors: readonly ErrorObject[],
  value: unknown,
  describe: (path: readonly string[]) => Place,
  unknown: string,
): string {
  const messages = new Set<string>();
  /** The remaining errors of each setting, at the depth that counts. */
  const settings = new Map<string, { depth: number; errors: ErrorObject[] }>();
  for (const error of errors) {
    const path = keys(error.instancePath);
    if (error.keyword === "additionalProperties") {
      const extra = String((error.params as { additionalProperty: string }).additionalProperty);
      messages.add(`unknown ${unknown} "${written([...path, extra])}"`);
      continue;
    }
    if (error.keyword === "required") {
      const missing = String((error.params as { missingProperty: string }).missingProperty);
      messages.add(`${describe(path).label} must have "${missing}"`);
      continue;
    }
    // A summary of alternatives that each failed; the alternatives say how.
    if (error.keyword === "anyOf" || error.keyword === "oneOf") continue;
    const { setting } = describe(path);
    const held = settings.get(setting);
    if (!held || path.length > held.depth)
      settings.set(setting, { depth: path.length, errors: [error] });
    else if (path.length === held.depth) held.errors.push(error);
  }
  for (const { errors: kept } of settings.values()) {
    const byPath = new Map<string, ErrorObject[]>();
    for (const error of kept)
      byPath.set(error.instancePath, [...(byPath.get(error.instancePath) ?? []), error]);
    for (const [pointer, group] of byPath) {
      const path = keys(pointer);
      const { label, expected } = describe(path);
      const given = group.every((error) => kinds.has(error.keyword))
        ? `, not ${shown(at(value, path))}`
        : "";
      if (expected) messages.add(`${label} must be ${expected}${given}`);
      else {
        const types = group.flatMap((error) =>
          error.keyword === "type" ? [error.params as { type: string | string[] }] : [],
        );
        if (types.length === group.length)
          messages.add(
            `${label} must be ${either(types.flatMap(({ type }) => type).map((type) => typeWords[type] ?? type))}${given}`,
          );
        else
          for (const error of group) {
            const { allowedValues, limit } = error.params as {
              allowedValues?: unknown[];
              limit?: unknown;
            };
            const limited = limits[error.keyword];
            messages.add(
              error.keyword === "enum" && allowedValues
                ? `${label} must be ${either(allowedValues.map((item) => JSON.stringify(item)))}${given}`
                : limited && limit !== undefined
                  ? `${label} ${limited(limit)}`
                  : `${label} ${error.message ?? "is not valid"}${kinds.has(error.keyword) ? given : ""}`,
            );
          }
      }
    }
  }
  return [...messages].join("; ");
}

/** The configuration's validation errors in plain words, naming each setting as it is written. */
export function configErrors(
  errors: readonly ErrorObject[],
  value: unknown,
  dialects: readonly string[],
): string {
  return phrased(errors, value, (path) => place(path, dialects), "setting");
}
/** A rule's option errors in plain words, naming each option as it is written. */
export function optionErrors(errors: readonly ErrorObject[], value: unknown): string {
  return phrased(
    errors,
    value,
    (path) => ({
      setting: written(path),
      label: path.length ? `"${written(path)}"` : "the options",
    }),
    "option",
  );
}
