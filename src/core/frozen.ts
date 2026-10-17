/**
 * `value`, with every object and list that it holds, frozen: a table that the
 * package exports is shared by every caller in the process, and a change that
 * one of them made would reach all the others. Functions are left as they are.
 */
export function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value))
      deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return value;
}
