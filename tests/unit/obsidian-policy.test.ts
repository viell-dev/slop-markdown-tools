import { describe, expect, it } from "vitest";
import { createWorkspace, format, lint } from "../../src/index.js";
import type { Config } from "../../src/index.js";

const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
const options = (rules: Config["rules"]) => ({
  workspace,
  config: { extends: [], dialect: "obsidian", rules } as Config,
});

describe("general Obsidian boundary policy (#603)", () => {
  it.each(["<span>a</span>\n+ b\n", "> <span>a</span>\n> + b\n", "<span>a\n\nb</span>\n+ c\n"])(
    "keeps inline HTML inside the ordinary text boundary policy: %j",
    (body) => {
      const settings = options({ "style/list-marker": "warn" });
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", "\uFEFF"]) {
          const source = bom + body.replaceAll("\n", newline);
          const result = format(source, settings);
          expect(result.output).toBe(source);
          expect(result.diagnostics).toMatchObject([
            { rule: "style/list-marker", severity: "warn" },
          ]);
          expect(result.diagnostics[0]!.message).toMatch(/^Left as written/);
          expect(result.diagnostics[0]!.edit).toBeUndefined();
          expect(format(result.output, settings).output).toBe(source);
        }
    },
  );
  it.each(["\n", "\r\n", "\r"])(
    "holds adjacent list markers and reports configured findings with %j",
    (newline) => {
      const source = `Some authored text.${newline}+ One item${newline}`;
      const settings = options({ "style/list-marker": "error" });
      const result = format(source, settings);
      expect(result.output).toBe(source);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          rule: "style/list-marker",
          severity: "error",
          line: 2,
        }),
      ]);
      expect(result.diagnostics[0]!.message).toMatch(/^Left as written/);
      expect(result.diagnostics[0]).not.toHaveProperty("edit");
      expect(format(result.output, settings).output).toBe(source);
      expect(lint(source, settings)).toEqual(result.diagnostics);
    },
  );
  it("permits separated blocks, ordinary ATX spacing, safe inline edits and other dialects", () => {
    expect(format("- Parent\n  + Nested\n", options({ "style/list-marker": "warn" })).output).toBe(
      "- Parent\n  - Nested\n",
    );
    expect(format("Text.\n\n+ Item\n", options({ "style/list-marker": "warn" })).output).toBe(
      "Text.\n\n- Item\n",
    );
    expect(format("Text.\n# Heading\n", options({ "style/block-spacing": "warn" })).output).toBe(
      "Text.\n\n# Heading\n",
    );
    expect(
      format("Text *one*.\n+ Item *two*\n", options({ "style/emphasis": "warn" })).output,
    ).toBe("Text _one_.\n+ Item _two_\n");
    expect(
      format("Text.\n+ Item\n", {
        config: { extends: [], dialect: "github", rules: { "style/list-marker": "warn" } },
      }).output,
    ).toBe("Text.\n- Item\n");
  });
  it("makes existing native protection refusals visible without engine errors", () => {
    const source = ">\t*literal*\n";
    const result = format(source, options({ "style/emphasis": "warn" }));
    expect(result.output).toBe(source);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        rule: "style/emphasis",
        severity: "warn",
      }),
    );
    expect(result.diagnostics[0]!.message).toMatch(/^Left as written/);
    expect(result.diagnostics.some((d) => d.rule.startsWith("engine/"))).toBe(false);
    expect(format(source, options({})).diagnostics).toEqual([]);
  });
  it("retains inline styles independently of structural refusals", () => {
    const source = "Text *one*.\n+ Item *two*\n";
    const result = format(
      source,
      options({ "style/list-marker": "warn", "style/emphasis": "warn" }),
    );
    expect(result.output).toBe("Text _one_.\n+ Item _two_\n");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        rule: "style/list-marker",
      }),
    );
    expect(result.diagnostics[0]!.message).toMatch(/^Left as written/);
    expect(
      format(result.output, options({ "style/list-marker": "warn", "style/emphasis": "warn" }))
        .output,
    ).toBe(result.output);
  });
});
