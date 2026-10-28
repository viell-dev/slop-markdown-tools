import { expect, it } from "vitest";
import { createWorkspace, lint } from "../../src/index.js";
import type { Config } from "../../src/index.js";
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

function obsidianHeadings(count: number, suffix: string) {
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": Array.from({ length: count }, (_, index) => `# Heading ${index}${suffix}`).join(
      "\n\n",
    ),
  });
  // Reading the note's anchors once is linear, and stays outside the timed lookups.
  workspace.resolve("Doc.md", `Note.md#${encodeURIComponent(`Heading 0${suffix}`)}`, "obsidian");
  return { workspace, count };
}
// Recovering `fragmentAnchor` by lowercasing every heading on each lookup took
// 1,380 ms for 3,000 lookups in 10,000 headings, against 16 ms. A heading with
// a literal `#` then still searched the outline for a chain of headings spelled
// as the fragment is: 1,215 ms against 17 ms.
it.each(["", " C#"])(
  "spells the heading of a fragment in other letter case without scanning the headings, with suffix %j",
  (suffix) => {
    expect(
      scaling(
        [1000, 16000],
        (count) => obsidianHeadings(count, suffix),
        ({ workspace, count }) => {
          const fragment = encodeURIComponent(`heading ${count - 1}${suffix}`.toLowerCase());
          let result = workspace.resolve("Doc.md", "Note.md", "obsidian");
          for (let lookup = 0; lookup < 3000; lookup++)
            result = workspace.resolve("Doc.md", `Note.md#${fragment}`, "obsidian");
          return result;
        },
        (result, { count }) =>
          expect(result).toMatchObject({
            fragmentExists: true,
            fragmentAnchor: `Heading ${count - 1}${suffix}`,
          }),
      ),
    ).toBeLessThan(4);
  },
);

/** A note with many headings of one name, and last a heading whose name holds a `#`. */
function repeatedHeadings(count: number) {
  const workspace = createWorkspace(
    { "Doc.md": "", "Note.md": `${"# Heading\n\n".repeat(count)}# Heading#Tail\n` },
    { dialect: "obsidian" },
  );
  // Reading the note's anchors once is linear, and stays outside the timed lookups.
  workspace.resolve("Doc.md", "Note.md#Heading", "obsidian");
  return workspace;
}
const repeatedLink = "Note.md#heading%23tail";
// Spelling the fragment's anchor for every resolution, wanted or not, looked for
// a chain of headings spelled as the fragment is among all those of the name in
// any case: 1,090 ms for 3,000 lookups in 10,000 headings, against 23 ms.
it("resolves a fragment in other letter case without searching repeated headings", () => {
  expect(
    scaling(
      [1000, 16000],
      repeatedHeadings,
      (workspace) => {
        let result = workspace.resolve("Doc.md", "Note.md", "obsidian");
        for (let lookup = 0; lookup < 3000; lookup++)
          result = workspace.resolve("Doc.md", repeatedLink, "obsidian");
        return result;
      },
      (result) =>
        expect(result).toMatchObject({ fragmentExists: true, fragmentAnchor: "Heading#Tail" }),
    ),
  ).toBeLessThan(4);
});
// With `exactCase`, each link reads the spelling, which the target's headings
// are searched for once rather than once per link: searching for each link took
// 2,000 ms for 3,000 links to 16,000 headings, against 340 ms.
it("spells a repeated fragment for exactCase once per target", () => {
  const source = `[a](${repeatedLink})\n`.repeat(3000);
  const config: Config = {
    extends: [],
    dialect: "obsidian",
    rules: { "links/valid": ["error", { exactCase: true }] },
  };
  expect(
    scaling(
      [1000, 32000],
      repeatedHeadings,
      (workspace) => lint(source, { config, path: "Doc.md", workspace }),
      (findings) => {
        expect(findings).toHaveLength(3000);
        expect(findings[0]?.message).toBe(
          `Fragment in ${repeatedLink} differs in letter case from its anchor, #Heading#Tail; other renderers may not find it.`,
        );
      },
    ),
  ).toBeLessThan(4);
});
