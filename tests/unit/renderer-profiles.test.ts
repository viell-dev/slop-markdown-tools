import { describe, expect, it } from "vitest";
import { format, parse } from "../../src/index.js";
import type { Config } from "../../src/index.js";
import { walk } from "../../src/syntax/walk.js";
import { generateDocument } from "../../scripts/rendering.mjs";
import { fixedSeeds, rendererSettings } from "../../scripts/renderer-settings.mjs";
import { classifyDifferences, knownDifferences } from "../../scripts/renderer-differences.mjs";

describe("renderer corpus scope (#603)", () => {
  it("defaults gates to realistic fixed seeds and keeps discovery explicit", () => {
    expect(rendererSettings()).toEqual({ profile: "realistic", seeds: fixedSeeds, count: 10 });
    expect(rendererSettings({ COUNT: "", SEED: "" })).toEqual(rendererSettings());
    expect(rendererSettings({ PROFILE: "adversarial", SEED: "42" })).toEqual({
      profile: "adversarial",
      seeds: [42],
      count: 100,
    });
    expect(rendererSettings({ PROFILE: "adversarial", SEED: "none", COUNT: "0" })).toEqual({
      profile: "adversarial",
      seeds: [],
      count: 0,
    });
    expect(() => rendererSettings({ PROFILE: "realistic", SEED: "random" })).toThrow(
      "discovery-only",
    );
    for (const values of [
      { PROFILE: "unknown" },
      { COUNT: "-1" },
      { SEED: "4294967296" },
      { SEEDS: "1,,2" },
    ])
      expect(() => rendererSettings(values)).toThrow();
  });

  it.each(["commonmark", "gfm", "github", "obsidian", "forgejo", "gitea"] as const)(
    "generates separated, closed, properly nested authored blocks for %s",
    (syntax) => {
      for (let seed = 1; seed <= 20; seed++) {
        const source = generateDocument(seed, syntax, "realistic");
        expect(generateDocument(seed, syntax, "realistic")).toBe(source);
        expect(source).not.toMatch(/^[ \t]+$/m);
        expect(source).not.toMatch(/^>(?! )/m);
        expect(source).not.toMatch(/:::|\{%/);
        const tree = parse(source, syntax === "gfm" ? "github" : syntax).tree;
        for (let index = 1; index < tree.children.length; index++) {
          const before = tree.children[index - 1]!,
            after = tree.children[index]!;
          if (before.position!.end.offset! <= after.position!.start.offset!)
            expect(
              source.slice(before.position!.end.offset, after.position!.start.offset),
            ).toContain("\n\n");
        }
        walk(tree, (node) => {
          if (node.type === "list" && node.ordered) expect(node.start).toBe(1);
          if (node.type === "code") {
            const raw = source.slice(node.position!.start.offset, node.position!.end.offset);
            const fence = /^(?:`{3,}|~{3,})/.exec(raw)?.[0];
            if (fence) expect(raw.trimEnd().endsWith(fence)).toBe(true);
          }
        });
      }
    },
  );

  it("retains legacy adversarial seed behavior for existing regression callers", () => {
    for (const syntax of ["commonmark", "gfm", "github", "obsidian"] as const)
      for (const seed of fixedSeeds)
        expect(generateDocument(seed, syntax)).toBe(generateDocument(seed, syntax, "adversarial"));
  });
});

describe("issue-linked discovery differences (#603)", () => {
  const entry = {
    renderer: "obsidian",
    issue: 603,
    source: "before",
    output: "after",
    view: "reading",
    width: 30,
  };
  const difference = { source: "before", output: "after", view: "reading", width: 30 };
  it("cannot accept a known discovery difference in a realistic gate", () => {
    expect(classifyDifferences("obsidian", "realistic", [difference], [entry]).unexpected).toEqual([
      difference,
    ]);
    expect(classifyDifferences("obsidian", "adversarial", [difference], [entry]).known).toEqual([
      difference,
    ]);
  });
  it("reports new views, widths, outputs and stale fixed cases", () => {
    for (const changed of [
      { ...difference, view: "livePreview" },
      { ...difference, width: 80 },
      { ...difference, output: "new output" },
    ]) {
      const result = classifyDifferences("obsidian", "adversarial", [changed], [entry]);
      expect(result.unexpected).toEqual([changed]);
      expect(result.stale).toEqual([entry]);
    }
    expect(classifyDifferences("obsidian", "adversarial", [], [entry]).stale).toEqual([entry]);
  });
  it("keeps catalog entries issue-linked and bound to current formatter output offline", () => {
    const keys = new Set<string>();
    for (const entry of knownDifferences) {
      expect(Number.isInteger(entry.issue) && entry.issue > 0).toBe(true);
      expect(["github", "obsidian", "forgejo", "gitea"]).toContain(entry.renderer);
      const key = JSON.stringify([entry.renderer, entry.source, entry.view, entry.width]);
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      const rules: Config["rules"] =
        entry.renderer === "github" && entry.view === "markdown"
          ? { "github/task-marker": "off", "github/alert-marker": "off" }
          : entry.width
            ? { "style/wrap": ["warn", { width: entry.width }] }
            : {};
      expect(
        format(entry.source, { config: { extends: ["recommended", entry.renderer], rules } })
          .output,
      ).toBe(entry.output);
      expect(entry.source).not.toBe(entry.output);
    }
  });
});
