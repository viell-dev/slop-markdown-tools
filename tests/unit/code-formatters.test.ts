import { expect, it } from "vitest";
import { format, resolveConfig, validateConfig } from "../../src/index.js";
import type { CodeFormatter } from "../../src/index.js";
const tool: CodeFormatter = {
  id: "javascript",
  languages: ["js", "javascript"],
  command: "missing-tool",
  args: [],
};

it("runs no tools by default, and replaces or disables inherited routes in overrides", () => {
  expect(resolveConfig().codeFormatters).toEqual([]);
  const config = {
    codeFormatters: [tool],
    overrides: [
      { files: ["draft/**"], codeFormatters: false as const },
      {
        files: ["draft/keep.md"],
        codeFormatters: [{ ...tool, id: "other", languages: ["other"] }],
      },
    ],
  };
  expect(resolveConfig({ config, path: "note.md" }).codeFormatters).toEqual([tool]);
  expect(resolveConfig({ config, path: "draft/note.md" }).codeFormatters).toEqual([]);
  expect(resolveConfig({ config, path: "draft/keep.md" }).codeFormatters).toEqual([
    { ...tool, id: "other", languages: ["other"] },
  ]);
  expect(format("A *word*.\n", { config }).output).toBe("A _word_.\n");
});
const invalid = [
  [{ ...tool, id: "Bad" }],
  [{ ...tool, languages: [] }],
  [{ ...tool, languages: ["js", "*"] }],
  [{ ...tool, languages: ["js", "js"] }],
  [{ ...tool, timeoutMs: 0 }],
  [{ ...tool, timeoutMs: 2147483648 }],
  [{ ...tool, maxOutputBytes: 0 }],
  [{ ...tool, args: [5] }],
  [tool, { ...tool, languages: ["rs"] }],
  [tool, { ...tool, id: "other", languages: ["js"] }],
  [
    { ...tool, languages: ["*"] },
    { ...tool, id: "other", languages: ["*"] },
  ],
];
it.each(invalid.map((codeFormatters) => ({ codeFormatters })))(
  "rejects invalid or ambiguous code routes: %j",
  ({ codeFormatters }) => {
    expect(() => validateConfig({ codeFormatters })).toThrow("Invalid configuration");
  },
);
