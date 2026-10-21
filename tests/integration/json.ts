import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import { configSchema, dialects, validateConfig } from "../../src/index.js";
import type { Config, Diagnostic, ResolvedConfig } from "../../src/index.js";
import type { Skipped } from "../../src/node.js";

export interface CliReport {
  version: string;
  mode: "lint" | "format";
  root: string;
  files: { path: string; changed?: boolean; output?: string; diagnostics: Diagnostic[] }[];
  written: string[];
  skipped?: Skipped[];
}
interface Explanation {
  root: string;
  config: string | null;
  path: string;
  effective: ResolvedConfig;
}
interface Rules {
  rules: { id: string; kind: "problem" | "style"; description: string }[];
}

const configId = "urn:mdrefine:test-config";
const ajv = new Ajv({ allErrors: true }).addSchema(configSchema, configId);
const strings = { type: "array", items: { type: "string" } };
const offset = { type: "integer", minimum: 0 };
const diagnostic = {
  type: "object",
  required: ["message", "start", "rule", "severity", "line", "column"],
  properties: {
    message: { type: "string" },
    start: offset,
    end: offset,
    rule: { type: "string" },
    severity: { enum: ["warn", "error"] },
    line: { type: "integer", minimum: 1 },
    column: { type: "integer", minimum: 1 },
    edit: {
      type: "object",
      required: ["start", "end", "text"],
      properties: { start: offset, end: offset, text: { type: "string" } },
    },
  },
};
const report = ajv.compile<CliReport>({
  type: "object",
  required: ["version", "mode", "root", "files", "written"],
  properties: {
    version: { type: "string" },
    mode: { enum: ["lint", "format"] },
    root: { type: "string" },
    written: strings,
    files: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "diagnostics"],
        properties: {
          path: { type: "string" },
          changed: { type: "boolean" },
          output: { type: "string" },
          diagnostics: { type: "array", items: diagnostic },
        },
      },
    },
    skipped: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "type", "code", "message"],
        properties: {
          path: { type: "string" },
          type: { enum: ["directory", "file"] },
          code: { enum: ["EACCES", "EPERM", "EBUSY", "INVALID", "IGNORED"] },
          message: { type: "string" },
        },
      },
    },
  },
});
const explanation = ajv.compile<Explanation>({
  type: "object",
  required: ["root", "config", "path", "effective"],
  properties: {
    root: { type: "string" },
    config: { type: ["string", "null"] },
    path: { type: "string" },
    effective: {
      allOf: [
        { $ref: configId },
        {
          type: "object",
          required: ["dialect", "rules", "ignore", "resolve", "codeFormatters"],
          properties: { dialect: { type: "string", enum: dialects } },
        },
      ],
    },
  },
});
const rules = ajv.compile<Rules>({
  type: "object",
  required: ["rules"],
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "kind", "description"],
        properties: {
          id: { type: "string" },
          kind: { enum: ["problem", "style"] },
          description: { type: "string" },
        },
      },
    },
  },
});

/** Keep the actual payload, including extra keys that an assertion may check. */
function decode<T>(source: string, validate: ValidateFunction<T>): T {
  const value: unknown = JSON.parse(source);
  if (!validate(value)) throw new Error(`Invalid CLI JSON: ${ajv.errorsText(validate.errors)}`);
  return value;
}
export const parseReport = (source: string): CliReport => decode(source, report);
export const parseExplanation = (source: string): Explanation => decode(source, explanation);
export const parseRules = (source: string): Rules => decode(source, rules);
export function parseConfig(source: string): Config {
  const value: unknown = JSON.parse(source);
  validateConfig(value);
  return value;
}
