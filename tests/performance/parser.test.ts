import { expect, it } from "vitest";
import { parse, textContent } from "../../src/index.js";
import type { Dialect, Document } from "../../src/index.js";
import type { Nodes } from "mdast";
import { scaling } from "./scaling.js";

interface Case {
  name: string;
  dialect: Dialect;
  sizes: [number, number];
  source(count: number): string;
  counts?: Readonly<Record<string, number>>;
  literal?: boolean;
}
const cases: Case[] = [
  {
    name: "nested container transitions (#300/#527)",
    dialect: "obsidian",
    sizes: [500, 2000],
    source: (n) => "- a\n  - b\n    - > # h\nlazy *w*\n".repeat(n),
    counts: { heading: 1, emphasis: 1 },
  },
  {
    name: "list/table transitions (#300)",
    dialect: "github",
    sizes: [500, 2000],
    source: (n) => "- one\n- two\n\n| a | b |\n| - | - |\n| c | d |\n\n".repeat(n),
    counts: { table: 1, listItem: 2 },
  },
  {
    name: "inline code data merging (#151)",
    dialect: "github",
    sizes: [1000, 4000],
    source: (n) => "see `x` and ".repeat(n),
    counts: { inlineCode: 1 },
  },
  {
    name: "multiline code-span merging",
    dialect: "commonmark",
    sizes: [1000, 4000],
    source: (n) => `\`a b\n${"c d\n".repeat(n)}\``,
  },
  {
    name: "undefined reference pairs (#240)",
    dialect: "github",
    sizes: [1000, 4000],
    source: (n) => "[a][b] ".repeat(n),
    literal: true,
  },
  {
    name: "open-label autolink scanning (#542)",
    dialect: "github",
    sizes: [500, 2000],
    source: (n) => "[ " + "some text http and more words here abc@def ".repeat(n),
    literal: true,
  },
  {
    name: "CJK attention and strikethrough",
    dialect: "vitepress",
    sizes: [500, 2000],
    source: (n) => "漢*字*漢 ~~字~~ ".repeat(n),
    counts: { emphasis: 1, delete: 1 },
  },
];

function nodeCounts(document: Document): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: Nodes): void => {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(document.tree);
  return counts;
}

// Draft sizes: calibrate once when the shared performance environment is idle.
// The deterministic unit checks already prove the old algorithms fail. Never
// weaken this existing <10 bound in response to an unexplained timing failure.
it.each(cases)("parses $name with proportional growth", (test) => {
  expect(
    scaling(
      test.sizes,
      (count) => ({ source: test.source(count), count }),
      ({ source }) => parse(source, test.dialect),
      (document, input) => {
        expect(document.source).toBe(input.source);
        expect(document.tree.position?.end.offset).toBe(input.source.length);
        const counts = nodeCounts(document);
        for (const [type, perUnit] of Object.entries(test.counts ?? {}))
          expect(counts.get(type)).toBe(input.count * perUnit);
        if (test.literal) {
          expect(textContent(document.tree).trimEnd()).toBe(input.source.trimEnd());
          expect(counts.get("link") ?? 0).toBe(0);
        }
        if (test.name === "multiline code-span merging") {
          expect(counts.get("inlineCode")).toBe(1);
          expect(textContent(document.tree)).toBe("a b " + "c d ".repeat(input.count));
        }
      },
      1,
    ),
  ).toBeLessThan(10);
});
