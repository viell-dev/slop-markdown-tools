import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

/** @type {((options: {type: "major", execution: "async", flavor: "last-resort"}) => Promise<void>) | undefined} */
let gc;

/** Collect after the task ends, releasing compilation caches as well as stack roots. */
export async function collectGarbage() {
  await new Promise((resolve) => setImmediate(resolve));
  if (!gc) {
    setFlagsFromString("--expose-gc");
    gc = runInNewContext("gc");
  }
  await gc({ type: "major", execution: "async", flavor: "last-resort" });
}

const marks = ["plain", "é-𝒳"];

/** @param {number} scale */
export function memoryFixture(scale) {
  const long = (/** @type {string} */ words, /** @type {number} */ times) =>
    `${words} `.repeat(times * scale);
  const html = (/** @type {string} */ mark) =>
    `<p>${long(`filler ${mark} in an HTML block`, 80)}</p>`;
  const prose = (/** @type {string} */ mark) => long(`prose ${mark} in one paragraph`, 40);
  /** @type {Record<string, () => string>} */
  const files = {};
  marks.forEach((mark, target) => {
    files[`Wide ${target}.md`] = () =>
      [
        `## A heading of target ${target} that is long {#custom-heading-id-${mark}}`,
        "",
        `<div id="Explicit-Anchor-${mark}">`,
        html(mark),
        `<a name="lowercase-anchor-${mark}"></a>`,
        "</div>",
        "",
        "```",
        long(`code ${mark} in a block that makes the file larger than its parts`, 20),
        "```",
        "",
      ].join("\n");
    files[`Block ${target}.md`] = () => `${prose(mark)} ^block-identifier-${target}\n`;
  });
  /** @type {Map<string, number>} Counts only; wrappers never keep the generated source strings. */
  const reads = new Map();
  for (const [name, read] of Object.entries(files)) {
    files[name] = () => {
      reads.set(name, (reads.get(name) ?? 0) + 1);
      return read();
    };
  }
  return { files, reads, smallest: Math.min(html("plain").length, prose("plain").length) };
}

/** @type {[import("../../src/index.js").Dialect, string, (mark: string, target: number) => string][]} */
const anchors = [
  ["obsidian", "Block", (_, target) => `^block-identifier-${target}`],
  [
    "obsidian",
    "Wide",
    (mark, target) => `a heading of target ${target} that is long {%23custom-heading-id-${mark}}`,
  ],
  ["github", "Wide", (mark) => `explicit-anchor-${mark}`],
  ["commonmark", "Wide", (mark) => `EXPLICIT-ANCHOR-${mark.toUpperCase()}`],
  ["github", "Wide", (mark) => `lowercase-anchor-${mark}`],
  ["forgejo", "Wide", (mark) => `Explicit-Anchor-${mark}`],
  ["gitea", "Wide", (mark) => `lowercase-anchor-${mark}`],
  ["forgejo", "Wide", (mark) => `custom-heading-id-${mark}`],
  ["gitea", "Wide", (mark) => `custom-heading-id-${mark}`],
];

/** @param {import("../../src/index.js").Workspace} index */
export function checkMemoryAnchors(index) {
  for (const [dialect, file, anchor] of anchors)
    marks.forEach((mark, target) => {
      const link = `${file} ${target}.md#${anchor(mark, target)}`;
      assert.equal(index.resolve("Doc.md", link, dialect).fragmentExists, true, link);
      assert.equal(index.resolve("Doc.md", `${link}x`, dialect).fragmentExists, false, link);
    });
}
