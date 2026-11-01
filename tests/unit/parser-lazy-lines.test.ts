import { expect, it } from "vitest";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import type { Extension } from "micromark-util-types";
import { parse } from "../../src/index.js";
import type { Plugin } from "../../src/index.js";
import { lazyLineWork, verifyLazyLineWitnesses } from "../support/parser/parser-lazy-lines.mjs";

it("bounds lazy-line event reads and rejects the original search and cache-bypass mutant (#796)", async () => {
  const stock = await lazyLineWork("stock");
  const fixed = await lazyLineWork("fixed");
  const mutant = await lazyLineWork("fixed", "cache");
  const small = fixed(20),
    large = fixed(80);
  expect(small.signature).toEqual(stock(20).signature);
  expect(large.signature).toEqual(stock(80).signature);
  expect(large.work / small.work).toBeLessThan(6);
  expect(stock(80).work / stock(20).work).toBeGreaterThan(10);
  expect(mutant(80).work / mutant(20).work).toBeGreaterThan(10);
});

it("validates membership and current bounds without token/event mutation (#796)", async () => {
  expect(await verifyLazyLineWitnesses()).toEqual({ controls: 12, mutations: 256 });
  await expect(verifyLazyLineWitnesses("identity")).rejects.toThrow(/identity: replaced token/);
  await expect(verifyLazyLineWitnesses("bounds")).rejects.toThrow(/bounds: closed at the boundary/);
});

const sources = [
  "- a\nline\nline\nline\n",
  "> a\nline\n  continued\nline\n",
  "- a\nline\n\n- b\nnext\n",
  "- a\nline\n# Heading\n",
  "- a\nline\n===\n",
  "- a\nline\n```js\ncode\n```\n",
  "- a\nline\n    indented\nmore\n",
  "- a\nline\n[x]: /url\n[label][x]\n",
  "- | a | b |\nline\n| - | - |\nmore\n",
  "- a\nline\n| a | b |\n| - | - |\n| c | d |\n",
  "- a\nline\n<script>\nvalue\n</script>\n",
];

it.each(["commonmark", "github"] as const)(
  "preserves positioned %s trees and resolver observations on lazy transitions (#796)",
  (dialect) => {
    for (const source of sources)
      for (const eol of ["\n", "\r\n", "\r"]) {
        const snapshots = (values: string[]): Extension => ({
          insideSpan: {
            null: [
              {
                resolveAll(events, context) {
                  values.push(
                    JSON.stringify(
                      context.events.map(([kind, token]) => [
                        kind,
                        token.type,
                        token.start,
                        token.end,
                        Object.keys(token),
                      ]),
                    ),
                  );
                  return events;
                },
              },
            ],
          },
        });
        const stockEvents: string[] = [],
          productEvents: string[] = [];
        const input = source.replace("a", "*a*").replaceAll("\n", eol);
        const stockTree = fromMarkdown(input, {
          extensions: [...(dialect === "github" ? [gfm()] : []), snapshots(stockEvents)],
          ...(dialect === "github" ? { mdastExtensions: [gfmFromMarkdown()] } : {}),
        });
        const plugin: Plugin = {
          name: "lazy-observer",
          syntax: { micromark: snapshots(productEvents), mdast: {} },
        };
        const productTree = parse(input, dialect, "document.md", [plugin]).tree;
        expect(productTree, source).toEqual(stockTree);
        expect(stockEvents.length, source).toBeGreaterThan(0);
        expect(productEvents, source).toEqual(stockEvents);
      }
  },
);
