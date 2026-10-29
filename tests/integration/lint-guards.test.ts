import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { repository } from "../support/cli.js";

// Node.js 26 does not match a surrogate pair with a bracketed class that stands right
// before the end-of-input `$` under the `u` flag (#743), so the ESLint configuration
// rejects that shape in regular expression literals.
describe("the regular expression guard for Node.js 26 (#743)", () => {
  const eslint = new ESLint({ cwd: repository });
  const restricted = async (literal: string) => {
    const [result] = await eslint.lintText(`export const pattern = ${literal};\n`, {
      filePath: path.join(repository, "scripts/regular-expression-guard.mjs"),
    });
    return result!.messages.filter((message) => message.ruleId === "no-restricted-syntax").length;
  };

  it.each([
    String.raw`/[\p{L}]$/u`,
    String.raw`/[\p{L}\p{N}\p{M}_$]$/u`,
    String.raw`/[\s\S]$/u`,
    String.raw`/[^a]$/u`,
    String.raw`/(?:[\p{L}])$/u`,
    String.raw`/([\p{L}])$/u`,
    String.raw`/[\p{L}]{1}$/u`,
    String.raw`/[\p{L}]$/iu`,
    String.raw`/a(?:[\p{L}]$)/u`,
    String.raw`/[a]$|b/u`,
    String.raw`/^a|[\p{L}]$/u`,
  ])("rejects %s", async (literal) => {
    expect(await restricted(literal)).toBe(1);
  });

  it.each([
    String.raw`/^[\p{L}\p{N}]/u`,
    String.raw`/^[\p{L}\p{N}]$/u`,
    String.raw`/^a[\p{L}]$/u`,
    String.raw`/[\p{L}]+$/u`,
    String.raw`/\p{L}$/u`,
    String.raw`/.$/u`,
    String.raw`/[\p{L}]$/v`,
    String.raw`/[\p{L}]$/`,
    String.raw`/\]$/u`,
    String.raw`/[\p{L}]x/u`,
    String.raw`/[\p{L}](?=x)/u`,
  ])("allows %s", async (literal) => {
    expect(await restricted(literal)).toBe(0);
  });
});
