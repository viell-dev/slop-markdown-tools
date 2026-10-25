import type { Nodes } from "mdast";
import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { obsidianSyntax } from "../../src/syntax/obsidian.js";
import type { WikiLink } from "../../src/syntax/obsidian.js";
import { literalWork } from "../support/obsidian-literal-work.mjs";

function wikiLinks(source: string): WikiLink[] {
  const pending: Nodes[] = [parse(source, "obsidian").tree];
  const result: WikiLink[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "wikiLink") result.push(node);
    if ("children" in node)
      for (let index = node.children.length - 1; index >= 0; index--)
        pending.push(node.children[index]!);
  }
  return result;
}

describe("Obsidian failed wikilink suffixes", () => {
  it.each([
    ["brackets", (n: number) => "[".repeat(n)],
    ["one closer", (n: number) => "[".repeat(n) + "]"],
    ["embeds", (n: number) => "![[".repeat(n)],
  ] as const)("bounds the actual literal tokenizer's work on %s", (_name, make) => {
    for (const size of [16, 64, 256]) {
      const source = make(size);
      const work = literalWork(obsidianSyntax, source);
      expect(work.outcomes.every((outcome: { accepted: boolean }) => !outcome.accepted)).toBe(true);
      expect(work.consumed).toBeLessThanOrEqual(source.length + 2);
      expect(work.states).toBeLessThanOrEqual(source.length * 3 + 4);
      // This count concerns only the exposed literal tokenizer; core label
      // resolution and whole public-parse work have their own checks.
      expect(wikiLinks(source)).toEqual([]);
    }
  });

  it("does not memoize an empty closed literal as a missing closer", () => {
    const source = "[[]] [[target|label]] ![[]] ![[image.png]]\n";
    expect(wikiLinks(source).map(({ target, label, embed }) => ({ target, label, embed }))).toEqual(
      [
        { target: "target", label: "label", embed: false },
        { target: "image.png", label: undefined, embed: true },
      ],
    );
  });

  it.each(["\n", "\r\n", "\r"])("leaves the next physical line eligible with %j", (newline) => {
    const source = `[[unclosed${newline}[[next]]${newline}`;
    for (const bom of ["", "\uFEFF"]) {
      const links = wikiLinks(bom + source);
      expect(links.map(({ target }) => target)).toEqual(["next"]);
      // parse() strips the BOM before establishing positioned source offsets.
      expect(links[0]?.position?.start.offset).toBe(source.indexOf("[[next]]"));
      expect(links[0]?.position?.end.offset).toBe(source.indexOf("[[next]]") + "[[next]]".length);
    }
  });

  it("scopes failed ranges to one tokenizer rather than the exported extension singleton", () => {
    expect(wikiLinks("[".repeat(32))).toEqual([]);
    expect(wikiLinks("[[fresh]]").map(({ target }) => target)).toEqual(["fresh"]);
  });

  it("keeps offset rewinds and retries correct on the same direct-state context", () => {
    const rewound = literalWork(obsidianSyntax, "[[xxx[[yyy", [5, 0, 5, 1]);
    expect(rewound.outcomes.map(({ accepted }: { accepted: boolean }) => accepted)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const lines = literalWork(obsidianSyntax, "[[bad\n[[good]]", [0, 6, 0]);
    expect(lines.outcomes.map(({ accepted }: { accepted: boolean }) => accepted)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("keeps literal parsing inside ordinary Markdown labels", () => {
    expect(
      wikiLinks("[![[target]]](outer) [[next]]\n").map(({ target, embed }) => ({ target, embed })),
    ).toEqual([
      { target: "target", embed: true },
      { target: "next", embed: false },
    ]);
  });
});
