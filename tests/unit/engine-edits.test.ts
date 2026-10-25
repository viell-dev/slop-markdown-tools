import { describe, expect, it } from "vitest";
import {
  applyEdits,
  createWorkspace,
  format,
  parse,
  semanticFingerprint,
} from "../../src/index.js";
import type { Plugin } from "../../src/index.js";
import { only } from "../support/rules.js";
describe("engine edits and fingerprints", () => {
  it("applies identical edits from two rules once", () => {
    expect(
      applyEdits("abc", [
        { start: 0, end: 1, text: "x" },
        { start: 0, end: 1, text: "x" },
      ]),
    ).toBe("xbc");
    const rule = {
      kind: "style",
      description: "Use underscores for the first emphasis",
      check: ({ document }: { document: { source: string } }) =>
        document.source.startsWith("*")
          ? [
              { start: 0, message: "Same", edit: { start: 0, end: 1, text: "_" } },
              { start: 2, message: "Same", edit: { start: 2, end: 3, text: "_" } },
            ]
          : [],
    } as const;
    const plugin: Plugin = { name: "twin", rules: { one: rule, two: rule } };
    const result = format("*a*\n", {
      config: only({ "twin/one": "warn", "twin/two": "warn" }),
      plugins: [plugin],
    });
    expect(result.output).toBe("_a_\n");
    expect(result.diagnostics).toEqual([]);
  });
  it("distinguishes embeds from links and canonicalizes their targets", () => {
    const workspace = createWorkspace({ "Doc.md": "", "Note.md": "" }, { dialect: "obsidian" });
    const print = (source: string) =>
      semanticFingerprint(parse(source, "obsidian", "Doc.md"), workspace);
    expect(print("![[Note]]\n")).toBe(print("![[Note.md]]\n"));
    expect(print("![[Note|300]]\n")).not.toBe(print("![[Note]]\n"));
    expect(print("![[Note]]\n")).not.toBe(print("[[Note]]\n"));
    expect(print("![[Note]]\n")).toContain('"type":"embed"');
  });
});
