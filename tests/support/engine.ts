import { expect } from "vitest";
import { format } from "../../src/index.js";
import type { Config, ProcessOptions } from "../../src/index.js";

export const narrow: Config = {
  extends: ["recommended", "github"],
  rules: { "style/wrap": ["warn", { width: 35 }] },
};
export function formatted(source: string, options: ProcessOptions = {}) {
  const result = format(source, options);
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  return result.output;
}
