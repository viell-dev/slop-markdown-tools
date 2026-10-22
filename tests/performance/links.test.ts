import { expect, it } from "vitest";
import { createWorkspace } from "../../src/index.js";
import { createForgejoSlugger, createGiteaSlugger } from "../../src/workspace/slug.js";
import { scaling } from "./scaling.js";
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

function unusualHtml(count: number) {
  return createWorkspace({
    "Doc.md": "",
    "Note.md": [
      `<a ${"x ".repeat(count * 10)}`,
      "<a ".repeat(count * 5),
      `<a id="${"x".repeat(count * 20)}`,
      `<a ${'id="a" '.repeat(count * 2)}${"'".repeat(count * 2)}`,
      // Real HTML blocks: many tags, a raw-text element that never closes,
      // and, last because it swallows the rest, a comment opener on every line.
      '<div>\n<span id="s"></span>\n'.repeat(count * 2),
      `<div>\n<textarea>${"<a id='t'></a>\n".repeat(count * 2)}`,
      "<!--\n".repeat(count * 5),
    ].join("\n\n"),
  });
}
it("finds only real anchors in large malformed HTML", () => {
  const hostile = unusualHtml(10000);
  expect(hostile.resolve("Doc.md", "Note.md#a", "forgejo").fragmentExists).toBe(false);
  expect(hostile.resolve("Doc.md", "Note.md#t", "forgejo").fragmentExists).toBe(false);
  expect(hostile.resolve("Doc.md", "Note.md#s", "forgejo").fragmentExists).toBe(true);
}, 40_000);

it("scans malformed HTML with linear scaling", () => {
  expect(
    scaling(
      [1000, 4000],
      unusualHtml,
      (workspace) =>
        ["a", "t", "s"].map(
          (fragment) =>
            workspace.resolve("Doc.md", `Note.md#${fragment}`, "forgejo").fragmentExists,
        ),
      (found) => expect(found).toEqual([false, false, true]),
    ),
  ).toBeLessThan(10);
});

function unclosedHeadings(count: number) {
  return {
    count,
    workspace: createWorkspace({
      "Doc.md": "",
      "Note.md": `${"<h2>x\n".repeat(count)}\n\n<div>\n${'<div title="<h2>">\n'.repeat(count * 0.4)}`,
    }),
  };
}
it("reads closed HTML headings and reports the last unclosed one as uncertain", () => {
  const { workspace: hostile } = unclosedHeadings(50000);
  expect(hostile.resolve("Doc.md", "Note.md#x", "github").fragmentExists).toBe(true);
  expect(hostile.resolve("Doc.md", "Note.md#x-49999", "github")).toMatchObject({
    status: "unreadable",
    fragmentIncomplete: true,
  });
});

it("reads unclosed headings with linear scaling", () => {
  expect(
    scaling(
      [2500, 10000],
      unclosedHeadings,
      ({ workspace, count }) => [
        workspace.resolve("Doc.md", "Note.md#x", "github").fragmentExists,
        workspace.resolve("Doc.md", `Note.md#x-${count - 1}`, "github").fragmentIncomplete,
      ],
      (found) => expect(found).toEqual([true, true]),
    ),
  ).toBeLessThan(10);
});
