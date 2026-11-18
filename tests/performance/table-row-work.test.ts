import { afterAll, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { rendererProtections } from "../../src/syntax/renderer-protections.js";
import { blockCounter } from "./document-work.js";

// Nothing else in this file may run the parser or the protections: V8 counts
// their blocks only if they are first compiled after this starts.
const counter = blockCounter("src/syntax/");
afterAll(() => counter.stop());

// Counted work repeats exactly, so small documents are enough, and the former
// scan, quadratic here, finishes quickly rather than running under observation.
const sizes = [200, 800] as const;

it("scans a shared Obsidian table-row region once (#505, #969)", () => {
  const [small, large] = sizes.map((count) => {
    // Each unit is a table whose following pipe rows reach the end of the
    // document. Scanning that union once per table repeats the scan of the rest.
    const document = parse("a | b\n-- | --\n# row | b\n".repeat(count), "obsidian");
    const { result, blocks } = counter.measure(() => rendererProtections(document));
    expect(
      [...result.tableText].some(
        (node) =>
          node.position!.start.offset! < document.source.indexOf("# row") &&
          node.position!.end.offset === document.source.length - 1,
      ),
    ).toBe(true);
    return { blocks };
  });
  // Four times the units should take four times the work, a growth of 1, which
  // the counts showed exactly. At 1.25, a quadratic term fails once it is about
  // 9% of the work at the smaller size; the former scan measured a growth of 3.45.
  // Timing could not separate the two on loaded machines (#969). Block counts
  // cannot see inside a native search, and the source-read counter cannot follow
  // these collectors' own uses of the source, such as splitting it into lines.
  const growth = large!.blocks / ((sizes[1] / sizes[0]) * small!.blocks);
  expect(growth, JSON.stringify({ sizes, small, large })).toBeLessThan(1.25);
});
