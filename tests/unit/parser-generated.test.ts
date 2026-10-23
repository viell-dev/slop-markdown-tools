import { expect, it } from "vitest";
import type { Extension } from "micromark-util-types";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
import { parse } from "../../src/index.js";
import type { Plugin } from "../../src/index.js";
import {
  frontMatterReading,
  githubFileReading,
  otherReading,
  plainReading,
} from "../../src/syntax/parse.js";

it.each(["github", "obsidian", "forgejo", "gitea", "vitepress"] as const)(
  "exposes correct tight and loose footnote item positions in %s",
  (dialect) => {
    for (const loose of [false, true])
      for (const eol of ["\n", "\r\n"]) {
        const source = ["[^a]: x", "", "    - a", ...(loose ? [""] : []), "    - b", ""].join(eol);
        const definition = parse(source, dialect).tree.children.find(
          (node) => node.type === "footnoteDefinition",
        );
        if (definition?.type !== "footnoteDefinition") throw new Error("Missing expected footnote");
        const list = definition.children.find((node) => node.type === "list");
        if (list?.type !== "list") throw new Error("Missing expected footnote list");
        const expected =
          eol === "\n"
            ? loose
              ? [
                  [13, 16],
                  [22, 25],
                ]
              : [
                  [13, 16],
                  [21, 24],
                ]
            : loose
              ? [
                  [15, 18],
                  [26, 29],
                ]
              : [
                  [15, 18],
                  [24, 27],
                ];
        expect(
          list.children.map(({ position }) => [position?.start.offset, position?.end.offset]),
        ).toEqual(expected);
        expect(list.spread).toBe(loose);
        expect(list.children.map(({ spread }) => spread)).toEqual([false, false]);
      }
  },
);

function observer(snapshots: string[]): Extension {
  return {
    insideSpan: {
      null: [
        {
          resolveAll(events, context) {
            snapshots.push(
              context.events
                .map(
                  ([event, token]) =>
                    `${event}:${token.type}:${token.start.offset}-${token.end.offset}`,
                )
                .join(" "),
            );
            return events;
          },
        },
      ],
    },
  };
}

it.each(["commonmark", "github", "vitepress"] as const)(
  "automatically preserves external syntax observers in %s",
  (dialect) => {
    for (const source of ["*a* *b*\n", "~~a~~ ~~b~~\n"]) {
      const stockSnapshots: string[] = [];
      const productSnapshots: string[] = [];
      const extensions =
        dialect === "commonmark" ? [] : [gfm({ singleTilde: dialect !== "vitepress" })];
      if (dialect === "vitepress") extensions.push(cjkFriendlyExtension());
      const stockTree = fromMarkdown(source, {
        extensions: [...extensions, observer(stockSnapshots)],
        ...(dialect === "commonmark" ? {} : { mdastExtensions: [gfmFromMarkdown()] }),
      });
      const plugin: Plugin = {
        name: "event-observer",
        syntax: { micromark: observer(productSnapshots), mdast: {} },
      };
      const productTree = parse(source, dialect, "observer.md", [plugin]).tree;
      // Do not add the disable marker here: this verifies the public parse()
      // wiring adds it for plugin.syntax instead of testing manual opt-out only.
      expect(productSnapshots).toEqual(stockSnapshots);
      expect(productTree).toEqual(stockTree);
    }
  },
);

function parserObserver(parsers: Map<object, boolean>): Plugin {
  return {
    name: "parser-observer",
    syntax: {
      micromark: {
        insideSpan: {
          null: [
            {
              resolveAll(events, context) {
                parsers.set(
                  context.parser,
                  context.parser.constructs.disable.null?.includes("mdrefineDeferredInline") ??
                    false,
                );
                return events;
              },
            },
          ],
        },
      },
      mdast: {},
    },
  };
}

it("retains plugin event compatibility in both eager front-matter readings", () => {
  const parsers = new Map<object, boolean>();
  const document = parse("---\n```\n---\n*a*\n```\n*b*\n", "obsidian", "alternate.md", [
    parserObserver(parsers),
  ]);
  expect(frontMatterReading(document.tree)?.children[0]?.type).toBe("yaml");
  expect(document.tree.children.some((node) => node.type === "code")).toBe(true);
  expect(parsers.size).toBe(2);
  expect([...parsers.values()]).toEqual([true, true]);
});

it("retains plugin event compatibility in lazy TOML readings", () => {
  const parsers = new Map<object, boolean>();
  const document = parse("+++\na=1\n+++\n*a* *b*\n", "github", "toml.md", [
    parserObserver(parsers),
  ]);
  expect(parsers.size).toBe(1);
  const plain = otherReading(document.tree);
  expect(plain).toBeDefined();
  expect(parsers.size).toBe(2);
  expect([...parsers.values()]).toEqual([true, true]);
  expect(otherReading(document.tree)).toBe(plain);
  expect(parsers.size).toBe(2);
});

it("retains plugin event compatibility in cached plain YAML readings (#540)", () => {
  const parsers = new Map<object, boolean>();
  const document = parse("---\ntitle: demo\n---\n*a* *b*\n", "github", "yaml.md", [
    parserObserver(parsers),
  ]);
  expect(document.tree.children[0]?.type).toBe("yaml");
  expect(parsers.size).toBe(1);
  const plain = plainReading(document.tree);
  expect(plain).not.toBe(document.tree);
  expect(plain.children[0]?.type).not.toBe("yaml");
  expect(parsers.size).toBe(2);
  expect([...parsers.values()]).toEqual([true, true]);
  expect(plainReading(document.tree)).toBe(plain);
  expect(otherReading(document.tree)).toBeUndefined();
  expect(parsers.size).toBe(2);
});

it("retains syntax compatibility in selected lazy GitHub file readings (#570)", () => {
  const parsers = new Map<object, boolean>();
  const document = parse("---\ntitle: demo\n---\n*a* $x$ ~~b~~\n", "github", "file.md", [
    parserObserver(parsers),
  ]);
  expect(parsers.size).toBe(1);
  const file = githubFileReading(document.tree);
  expect(file).not.toBe(document.tree);
  expect(file.children[0]?.type).toBe("yaml");
  expect(parsers.size).toBe(2);
  expect([...parsers.values()]).toEqual([true, true]);
  expect(githubFileReading(document.tree)).toBe(file);
  expect(parsers.size).toBe(2);

  const plain = plainReading(document.tree);
  expect(parsers.size).toBe(3);
  const plainFile = githubFileReading(plain);
  expect(plainFile).not.toBe(plain);
  expect(parsers.size).toBe(4);
  expect([...parsers.values()]).toEqual([true, true, true, true]);
  expect(plainReading(document.tree)).toBe(plain);
  expect(githubFileReading(plain)).toBe(plainFile);
  expect(otherReading(document.tree)).toBeUndefined();
  expect(parsers.size).toBe(4);
});

it("retains plugin event compatibility through VitePress projection", () => {
  const parsers = new Map<object, boolean>();
  const document = parse("---\ntitle: demo\n---\n*a* ~~b~~中文*c*\n", "vitepress", "projected.md", [
    parserObserver(parsers),
  ]);
  expect(document.vitepress).toBeDefined();
  expect(parsers.size).toBe(1);
  expect([...parsers.values()]).toEqual([true]);
});
