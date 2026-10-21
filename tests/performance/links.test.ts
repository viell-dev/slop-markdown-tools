import { expect, it } from "vitest";
import { createWorkspace } from "../../src/index.js";
import { createForgejoSlugger, createGiteaSlugger } from "../../src/workspace/slug.js";
const sluggers = [
  ["forgejo", createForgejoSlugger],
  ["gitea", createGiteaSlugger],
] as const;

it.each(sluggers)("number many repeats on %s in linear time", (_, create) => {
  const count = 10000;
  const fastest = (texts: string[]) => {
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const slugger = create();
      const started = performance.now();
      for (const text of texts) slugger.slug(text);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  const repeated = Array.from({ length: count }, () => "Fixed");
  const distinct = Array.from({ length: count }, (_, index) => `Fixed ${index}`);
  // Distinct headings need no numbers, which makes them a linear baseline.
  // Searching from `-1` for each repeat took thousands of times as long.
  expect(fastest(repeated) / fastest(distinct)).toBeLessThan(10);
});

it("scans unusual HTML in linear time", () => {
  const hostile = createWorkspace({
    "Doc.md": "",
    "Note.md": [
      `<a ${"x ".repeat(100000)}`,
      "<a ".repeat(50000),
      `<a id="${"x".repeat(200000)}`,
      `<a ${'id="a" '.repeat(20000)}${"'".repeat(20000)}`,
      // Real HTML blocks: many tags, a raw-text element that never closes,
      // and, last because it swallows the rest, a comment opener on every line.
      '<div>\n<span id="s"></span>\n'.repeat(20000),
      `<div>\n<textarea>${"<a id='t'></a>\n".repeat(20000)}`,
      "<!--\n".repeat(50000),
    ].join("\n\n"),
  });
  const start = performance.now();
  expect(hostile.resolve("Doc.md", "Note.md#a", "forgejo").fragmentExists).toBe(false);
  expect(hostile.resolve("Doc.md", "Note.md#t", "forgejo").fragmentExists).toBe(false);
  expect(hostile.resolve("Doc.md", "Note.md#s", "forgejo").fragmentExists).toBe(true);
  // The bound tells linear from quadratic growth, which would take minutes here. It leaves
  // room for a slow CI runner and for GFM parsing, which the workspace now uses when no
  // dialect is named and which takes about half as long again as CommonMark on this input.
  // The scan takes 2 to 4 seconds, but a Windows runner once needed 14 (issue #185).
  expect(performance.now() - start).toBeLessThan(30000);
}, 40_000);

it("reads many unclosed headings in linear time", () => {
  const hostile = createWorkspace({
    "Doc.md": "",
    "Note.md": `${"<h2>x\n".repeat(50000)}\n\n<div>\n${'<div title="<h2>">\n'.repeat(20000)}`,
  });
  const start = performance.now();
  expect(hostile.resolve("Doc.md", "Note.md#x", "github").fragmentExists).toBe(true);
  expect(hostile.resolve("Doc.md", "Note.md#x-49999", "github").fragmentExists).toBe(false);
  expect(performance.now() - start).toBeLessThan(4000);
});
