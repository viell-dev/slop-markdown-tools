import { expect, it } from "vitest";
import { parse, range } from "../../src/index.js";
import type { Dialect } from "../../src/index.js";
import type { Nodes } from "mdast";

/** The source text of every formula the tool reads in a document, in order. */
function formulas(source: string, dialect: Dialect): string[] {
  const found: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "inlineMath" || node.type === "math")
      found.push(source.slice(...range(node)));
    else if (node.type === "code" && node.lang === "math") found.push(source.slice(...range(node)));
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(parse(source, dialect).tree);
  return found;
}
it("reads a paragraph of many prices once, not once for each price", () => {
  // In Obsidian a dollar that cannot close is read past, so every price opens a
  // search to the end of the paragraph unless the first failed search is remembered.
  const source = `${"pay $5 and $6 now ".repeat(6000)}\n`;
  const started = performance.now();
  expect(formulas(source, "obsidian")).toEqual([]);
  expect(performance.now() - started).toBeLessThan(10000);
  // A formula after the prices is still found, by the search that the first price began.
  expect(formulas(`${"pay $5 and $6 now ".repeat(50)}and $x$ too.\n`, "obsidian")).toHaveLength(1);
});
