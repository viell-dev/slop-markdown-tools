import { readFile } from "node:fs/promises";
import type { Extension, TokenizeContext } from "micromark-util-types";
import ts from "typescript";
import { expect, it } from "vitest";
import { parse } from "../../src/index.js";
import type { DialectName, Plugin, VitePressOptions } from "../../src/core/types.js";
import {
  frontMatterReading,
  githubFileReading,
  otherReading,
  plainReading,
} from "../../src/syntax/parse.js";
import {
  barrierMutationFallback,
  customFootnoteSchedule,
  generatedLabelAdapter,
  labelMechanism,
  labelSources,
  verifyCustomDefinitionFallback,
  verifyLabelGraphs,
} from "../support/parser/parser-label-regressions.mjs";

const sources = labelSources();
const emptySyntax: Plugin = { name: "labels-empty-syntax", syntax: { micromark: {}, mdast: {} } };
const ruleOnly: Plugin = { name: "labels-rule-only", rules: {} };
const profiles: Array<{ dialect: DialectName; vitepress?: VitePressOptions }> = [
  ...(["commonmark", "github", "forgejo", "gitea", "obsidian"] as const).map((dialect) => ({
    dialect,
  })),
  { dialect: "vitepress" },
  { dialect: "vitepress", vitepress: { footnote: true, math: true } },
  { dialect: "vitepress", vitepress: { footnote: false, math: true, cjkFriendlyEmphasis: false } },
];

it.each(["commonmark", "gfm", "footnote", "cjk"])(
  "keeps raw stock/generated positioned trees and token observations equal in %s, on all marker paths",
  async (mode) => {
    const result = await verifyLabelGraphs(mode, sources);
    expect(result.sources).toBe(sources.length);
    expect(result.astComparisons).toBe(sources.length * 4);
    expect(result.observations).toBeGreaterThan(0);
  },
);

it.each(profiles)(
  "keeps public fast/fallback/rule-only trees equal for $dialect/$vitepress",
  ({ dialect, vitepress }) => {
    for (const source of sources) {
      const expected = parse(source, dialect, "labels.md", [emptySyntax], vitepress).tree;
      expect(
        parse(source, dialect, "labels.md", [], vitepress).tree,
        JSON.stringify(source),
      ).toEqual(expected);
      expect(
        parse(source, dialect, "labels.md", [ruleOnly], vitepress).tree,
        JSON.stringify(source),
      ).toEqual(expected);
    }
  },
);

it("routes VitePress's standalone footnote factory through the six-export adapter", async () => {
  const adapter = await generatedLabelAdapter();
  expect(typeof adapter.gfmFootnote).toBe("function");
  const source = await readFile(new URL("../../src/syntax/parse.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    "parse.ts",
    source,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  const imports: string[] = [];
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((entry) => entry.name.text === "gfmFootnote")
    )
      imports.push(statement.moduleSpecifier.text);
  }
  expect(imports).toEqual(["./parser.generated.js"]);
  // The graph helper also checks aggregate/standalone tokenizer identity in one
  // actual generated module. Presence below verifies VitePress on/off policy.
  for (const footnote of [undefined, true, false]) {
    const parsers = new Map<object, Flags>();
    const options: VitePressOptions = footnote === undefined ? {} : { footnote };
    parse("*a* [x] ![^a]\n\n[^a]: note\n", "vitepress", "vp.md", [flagObserver(parsers)], options);
    expect(parsers.size).toBeGreaterThan(0);
    for (const flags of parsers.values()) expect(flags.footnote).toBe(footnote !== false);
  }
});

interface Flags {
  deferred: boolean;
  builtin: boolean;
  footnote: boolean;
}
function flagObserver(parsers: Map<object, Flags>): Plugin {
  const capture = (parser: TokenizeContext["parser"]) => {
    const candidates = [parser.constructs.text?.[93] ?? []].flat();
    parsers.set(parser, {
      deferred: parser.constructs.disable.null?.includes("mdrefineDeferredInline") ?? false,
      builtin: parser.constructs.disable.null?.includes("mdrefineBuiltinLabels") ?? false,
      footnote: candidates.some((construct) => construct.name === "gfmPotentialFootnoteCall"),
    });
  };
  const micromark: Extension = {
    text: {
      [91]: {
        previous() {
          capture(this.parser);
          return false;
        },
        tokenize(_effects, _ok, nok) {
          capture(this.parser);
          return nok;
        },
      },
    },
    insideSpan: {
      null: [
        {
          resolveAll(events, context) {
            capture(context.parser);
            return events;
          },
        },
      ],
    },
  };
  return { name: "labels-flag-observer", syntax: { micromark, mdast: {} } };
}
function fallbackFlags(parsers: Map<object, Flags>, count: number): void {
  expect(parsers.size).toBe(count);
  for (const flags of parsers.values()) {
    expect(flags.deferred).toBe(true);
    expect(flags.builtin).toBe(false);
  }
}

it("keeps observer fallback on primary and cached lazy YAML/GitHub file readings", () => {
  const parsers = new Map<object, Flags>();
  const root = parse("---\ntitle: demo\n---\n*a* $x$ [b]\n", "github", "yaml.md", [
    flagObserver(parsers),
  ]).tree;
  fallbackFlags(parsers, 1);
  const file = githubFileReading(root);
  expect(file).not.toBe(root);
  fallbackFlags(parsers, 2);
  const plain = plainReading(root);
  expect(plain).not.toBe(root);
  fallbackFlags(parsers, 3);
  const plainFile = githubFileReading(plain);
  expect(plainFile).not.toBe(plain);
  fallbackFlags(parsers, 4);
  expect(githubFileReading(root)).toBe(file);
  expect(plainReading(root)).toBe(plain);
  expect(githubFileReading(plain)).toBe(plainFile);
  expect(otherReading(root)).toBeUndefined();
  fallbackFlags(parsers, 4);
});

it("keeps observer fallback on lazy TOML, eager alternate and projected readings", () => {
  const tomlParsers = new Map<object, Flags>();
  const toml = parse("+++\na=1\n+++\n*a* [b]\n", "github", "toml.md", [
    flagObserver(tomlParsers),
  ]).tree;
  fallbackFlags(tomlParsers, 1);
  const other = otherReading(toml);
  expect(other).toBeDefined();
  expect(otherReading(toml)).toBe(other);
  fallbackFlags(tomlParsers, 2);
  const eagerParsers = new Map<object, Flags>();
  const eager = parse("---\n```\n---\n*a*\n```\n*b* [c]\n", "obsidian", "eager.md", [
    flagObserver(eagerParsers),
  ]).tree;
  expect(frontMatterReading(eager)?.children[0]?.type).toBe("yaml");
  fallbackFlags(eagerParsers, 2);
  const projected = new Map<object, Flags>();
  parse("---\ntitle: demo\n---\n*a* [b]\n", "vitepress", "vp.md", [flagObserver(projected)]);
  fallbackFlags(projected, 1);
});

it("preserves arbitrary nonempty custom identifiers outside the trusted marker", async () => {
  expect(await verifyCustomDefinitionFallback()).toEqual({ cases: 3 });
  for (const marker of ["default", "deferred", "both"])
    expect(await customFootnoteSchedule(marker)).toEqual({ cases: 1 });
  for (const marker of ["default", "deferred", "both"])
    for (const family of ["positive", "negative"])
      expect(await barrierMutationFallback(marker, family)).toEqual({ cases: 1 });
});

const sizes = [32, 128] as const;
it.each(["core", "positive", "negative", "closer"] as const)(
  "measures actual tokenizer work for %s, with sensitive independent mutant and unchanged records",
  async (family) => {
    const mutant = family === "core" ? "nested" : family === "closer" ? "closer" : "prefix";
    const good: number[] = [];
    const stock: number[] = [];
    const broken: number[] = [];
    for (const size of sizes) {
      const original = await labelMechanism(family, "stock", size);
      const fixed = await labelMechanism(family, "fixed", size);
      const changed = await labelMechanism(family, "fixed", size, "fast", mutant);
      expect(fixed.observation).toEqual(original.observation);
      expect(changed.observation).toEqual(original.observation);
      expect(fixed.observation.sameArray).toBe(true);
      expect(fixed.observation.samePointIdentities).toBe(true);
      expect(fixed.observation.sameTupleAndTokenIdentities).toBe(true);
      expect(fixed.observation.defined).toEqual(["UNRELATED"]);
      expect(fixed.observation.footnotes).toEqual(["UNRELATED"]);
      if (family === "core" || family === "closer") {
        expect(fixed.work.serializedCalls).toBe(1);
        expect(fixed.work.serializedCharacters).toBeGreaterThan(0);
        expect(fixed.work.serializedCharacters).toBeLessThanOrEqual(fixed.sourceLength);
        expect(original.work.serializedCalls).toBe(size);
        expect(changed.work.serializedCalls).toBe(size);
      }
      if (family === "positive" || family === "closer") {
        expect(fixed.work.positiveHits).toBeGreaterThan(0);
        expect(fixed.work.negativeHits).toBe(0);
      }
      if (family === "negative") {
        expect(fixed.work.negativeHits).toBeGreaterThan(0);
        expect(fixed.work.positiveHits).toBe(0);
      }
      if (mutant === "prefix") {
        expect(changed.work.positiveHits).toBe(0);
        expect(changed.work.negativeHits).toBe(0);
        expect(fixed.work.serializedCalls).toBe(0);
      }
      if (family === "closer") expect(changed.work.positiveHits).toBeGreaterThan(0);
      const metric =
        family === "core" || family === "closer" ? "serializedCharacters" : "eventReads";
      good.push(fixed.work[metric]);
      stock.push(original.work[metric]);
      broken.push(changed.work[metric]);
    }
    // Proposed deterministic bounds, NOT timing limits or measured results.
    // Investigate any failure before changing sizes or these sensitivity bounds.
    expect(good[0]).toBeGreaterThan(0);
    expect(stock[0]).toBeGreaterThan(0);
    expect(broken[0]).toBeGreaterThan(0);
    expect(good[1]! / good[0]!).toBeLessThan(6);
    expect(stock[1]! / stock[0]!).toBeGreaterThan(10);
    expect(broken[1]! / broken[0]!).toBeGreaterThan(10);
  },
);

it.each(["default", "fast", "deferred", "both"] as const)(
  "shortcuts empty dictionaries safely on the %s path",
  async (mode) => {
    for (const family of ["core", "positive"] as const) {
      const original = await labelMechanism(family, "stock", 8, mode, "none", true);
      const fixed = await labelMechanism(family, "fixed", 8, mode, "none", true);
      expect(fixed.observation).toEqual(original.observation);
      expect(fixed.work.serializedCalls).toBe(0);
      expect(fixed.work.serializedCharacters).toBe(0);
      if (family === "positive") expect(fixed.work.eventReads).toBe(0);
    }
  },
);

it.each(["default", "deferred", "both"] as const)(
  "keeps nonempty direct tokenizer behavior original on the %s path",
  async (mode) => {
    for (const family of ["core", "positive", "negative", "closer"] as const) {
      const original = await labelMechanism(family, "stock", 12, mode);
      const fixed = await labelMechanism(family, "fixed", 12, mode);
      expect(fixed.observation).toEqual(original.observation);
      expect(fixed.work.serializedCharacters).toBe(original.work.serializedCharacters);
      expect(fixed.work.positiveHits).toBe(0);
      expect(fixed.work.negativeHits).toBe(0);
    }
  },
);
