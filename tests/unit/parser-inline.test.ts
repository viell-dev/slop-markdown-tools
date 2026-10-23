import { expect, it } from "vitest";
import type { Extension } from "micromark-util-types";
import type { InlineCode, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
import { parse } from "../../src/index.js";
import type { Plugin } from "../../src/index.js";
import { codeSpanText, labelEnd, lazyIndentation } from "../../src/syntax/parse.js";
import examples from "../fixtures/commonmark/spec.json" with { type: "json" };
import {
  inlineSources,
  matchingWork,
  verifyInlineMatrix,
  verifyMatchingIdentity,
} from "../parser-inline-regressions.mjs";

const sources = inlineSources(examples);

// This group calls actual generated factories via bundleParser(), not public parse().
it.each(["commonmark", "gfm", "cjk"])(
  "keeps complete generated-parser AST/positions and AST-derived HTML in %s",
  async (mode) => {
    const result = await verifyInlineMatrix(mode, sources);
    expect(result.sources).toBe(sources.length);
    expect(result.astComparisons).toBe(sources.length * 2);
    expect(result.htmlComparisons).toBe(sources.length * 2);
  },
);

it("keeps matching survivors, partial tokens and older openers in repaired modules/CJK factories", async () => {
  expect(await verifyMatchingIdentity()).toEqual({ cases: 20 });
});

it.each([
  ["attention", "matched"],
  ["attention", "partial-open"],
  ["attention", "partial-close"],
  ["attention", "suffix-removal"],
  ["strike", "matched"],
  ["strike", "suffix-removal"],
] as const)(
  "keeps %s/%s event-array work proportional on a bounded successful-match family",
  async (kind, family) => {
    const oldSmall = await matchingWork(kind, family, "stock", 20);
    const oldLarge = await matchingWork(kind, family, "stock", 80);
    const newSmall = await matchingWork(kind, family, "fixed", 20);
    const newLarge = await matchingWork(kind, family, "fixed", 80);
    expect(newSmall.signature).toEqual(oldSmall.signature);
    expect(newLarge.signature).toEqual(oldLarge.signature);
    expect(newLarge.work / newSmall.work).toBeLessThan(6);
    expect(oldLarge.work / oldSmall.work).toBeGreaterThan(10);
  },
);

function observer(snapshots: string[], compatibility?: boolean[]): Extension {
  return {
    insideSpan: {
      null: [
        {
          resolveAll(events, context) {
            snapshots.push(JSON.stringify(context.events.map(([phase, token]) => [phase, token])));
            compatibility?.push(
              context.parser.constructs.disable.null?.includes("mdrefineDeferredInline") ?? false,
            );
            return events;
          },
        },
      ],
    },
  };
}
const publicCases = [
  "*****a** b***\n",
  "_ **a _ b** c_\n",
  "~~a ~b~~ c~\n",
  "~~a **b~~ c**\n",
  "漢*字*𠮷 **漢~~字~~**語\n",
  "> a `` b\n  c `` tail\n",
];

// This group exercises public parse() and its automatic external-syntax fallback.
it.each(["commonmark", "github", "vitepress"] as const)(
  "retains actual public parse syntax observers and ASTs for matching cases in %s",
  (dialect) => {
    let observations = 0;
    for (const source of publicCases) {
      const stockSnapshots: string[] = [];
      const productSnapshots: string[] = [];
      const flags: boolean[] = [];
      const extensions =
        dialect === "commonmark" ? [] : [gfm({ singleTilde: dialect !== "vitepress" })];
      if (dialect === "vitepress") extensions.push(cjkFriendlyExtension());
      const mdastExtensions = gfmFromMarkdown().map((extension) => {
        const copy = { ...extension };
        delete copy.transforms;
        return copy;
      });
      const stockTree = fromMarkdown(source, {
        extensions: [...extensions, observer(stockSnapshots)],
        ...(dialect === "commonmark" ? {} : { mdastExtensions }),
      });
      const plugin: Plugin = {
        name: "matching-observer",
        syntax: { micromark: observer(productSnapshots, flags), mdast: {} },
      };
      expect(parse(source, dialect, "matching.md", [plugin]).tree).toEqual(stockTree);
      expect(productSnapshots).toEqual(stockSnapshots);
      // Some inputs never invoke an insideSpan resolver in stock either.
      // Check every actual callback and keep positive controls per dialect.
      expect(flags).toEqual(stockSnapshots.map(() => true));
      observations += flags.length;
      // A rule-only plugin introduces no observer or syntax; its actual tree
      // still follows the no-plugin result. No internal-path identity is claimed.
      expect(parse(source, dialect, "rules.md", [{ name: "rules-only", rules: {} }]).tree).toEqual(
        parse(source, dialect, "plain.md").tree,
      );
    }
    expect(observations).toBeGreaterThan(0);
  },
);

function nodes(document: ReturnType<typeof parse>): Nodes[] {
  const found: Nodes[] = [];
  const visit = (node: Nodes) => {
    found.push(node);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(document.tree);
  return found;
}

const metadataCases: [string, string, boolean][] = [
  ["> Run `npm run\n   build` now.\n", "npm run    build", true],
  ["Text ` \n   foo ` end.\n", " foo", false],
  ["- a `b\n  c` d\n", "b c", false],
];
it("keeps public code-span padding/lazy metadata and image label offsets on both resolver paths", () => {
  const syntaxPlugin: Plugin = {
    name: "metadata-syntax",
    syntax: { micromark: {}, mdast: {} },
  };
  for (const plugins of [[], [syntaxPlugin]])
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"]) {
        for (const [source, expected, lazy] of metadataCases) {
          const document = parse(
            bom + source.replaceAll("\n", newline),
            "github",
            "metadata.md",
            plugins,
          );
          const spans = nodes(document).filter(
            (node): node is InlineCode => node.type === "inlineCode",
          );
          expect(spans).toHaveLength(1);
          expect(codeSpanText(spans[0]!)).toBe(expected);
          expect(lazyIndentation(spans[0]!)).toBe(lazy);
        }
        const source = "before ![a \\] and ``x\n y`` after](image.png) tail\n";
        const document = parse(
          bom + source.replaceAll("\n", newline),
          "obsidian",
          "image.md",
          plugins,
        );
        const image = nodes(document).find((node) => node.type === "image");
        expect(image).toBeDefined();
        expect(labelEnd(image!)).toBe(document.source.indexOf("](image.png)"));
      }
});
