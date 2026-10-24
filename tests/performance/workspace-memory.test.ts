import { isMap, isPair, isSeq, parseDocument } from "yaml";
import { frontMatterReading, plainReading } from "../../src/syntax/parse.js";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  getHeapCodeStatistics,
  getHeapSpaceStatistics,
  getHeapStatistics,
  setFlagsFromString,
  writeHeapSnapshot,
} from "node:v8";
import { runInNewContext, runInThisContext } from "node:vm";
import type { Nodes } from "mdast";
import { expect, it, vi } from "vitest";
import { createWorkspace } from "../../src/index.js";
import type { Dialect, Document } from "../../src/index.js";
import { headingAttributes } from "../../src/workspace/heading-attributes.js";
vi.mock("yaml", async (importOriginal) => {
  const actual = await importOriginal<typeof import("yaml")>();
  return { ...actual, parseDocument: vi.fn(actual.parseDocument) };
});
vi.mock("../../src/workspace/heading-attributes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/workspace/heading-attributes.js")>();
  return { ...actual, headingAttributes: vi.fn(actual.headingAttributes) };
});
// Let a test follow every document that is parsed, to check that the workspace lets go of them.
const parses = vi.hoisted(() => ({
  watch: undefined as ((document: Document) => void) | undefined,
}));
vi.mock("../../src/syntax/parse.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/syntax/parse.js")>();
  const parse: typeof actual.parse = (...parameters) => {
    const document = actual.parse(...parameters);
    parses.watch?.(document);
    return document;
  };
  return { ...actual, parse };
});
type AsyncGc = (options: {
  type: "major";
  execution: "async";
  flavor: "last-resort";
}) => Promise<void>;
let gc: AsyncGc | undefined;
/** Collect after the JavaScript stack unwinds, without conservative stack roots. */
async function collectGarbage(): Promise<void> {
  // A WeakRef keeps its target alive until the task that created it has ended.
  await new Promise((resolve) => setImmediate(resolve));
  if (!gc) {
    setFlagsFromString("--expose-gc");
    gc = runInNewContext("gc") as AsyncGc;
  }
  // A synchronous collection may retain stale stack pointers. The async task
  // has no JavaScript stack roots. Regular major GC is not V8's collect-all
  // operation: last-resort also releases compilation caches and collects until
  // the root set is stable. Sample once after that operation, not after a
  // selected successful retry (#413). Strongly retained anchors still survive.
  await gc({ type: "major", execution: "async", flavor: "last-resort" });
}

/** No caller keeps this source; only V8's ordinary compilation cache can. */
function compileAndDiscard(): number {
  return runInThisContext(
    `/*${"synthetic compilation cache fixture ".repeat(200_000)}*/ 0`,
  ) as number;
}

it("does not count V8 compilation caches as workspace retention (#413)", async () => {
  await collectGarbage();
  const before = process.memoryUsage().heapUsed;
  expect(compileAndDiscard()).toBe(0);
  await collectGarbage();
  // The synthetic script is over 7 MB, but no application value retains it.
  // A regular major GC leaves its source cached and fails this same allowance.
  expect(process.memoryUsage().heapUsed - before).toBeLessThan(1_160_000 / 3);
});

/** Failure evidence for #413; receives no workspace, document, source or WeakRef. */
function retainedTextFailure(
  before: number,
  held: number,
  smallest: number,
  references: number,
): void {
  try {
    const directory = `artifacts/workspace-memory/${process.pid}`;
    // The measured delta is already fixed. Do not dereference the observations
    // or copy a mock's arguments/results before taking this heap snapshot.
    const report = {
      issue: 413,
      stage: "after-fixed-measurement",
      collection: { type: "major", execution: "async", flavor: "last-resort" },
      runtime: {
        node: process.version,
        v8: process.versions.v8,
        platform: process.platform,
        architecture: process.arch,
        pid: process.pid,
      },
      run: { id: process.env.GITHUB_RUN_ID ?? null, sha: process.env.GITHUB_SHA ?? null },
      sample: { before, after: before + held, held, smallest, allowance: smallest / 3, references },
      mocks: {
        yaml: {
          calls: vi.mocked(parseDocument).mock.calls.length,
          results: vi.mocked(parseDocument).mock.results.length,
        },
        headingAttributes: {
          calls: vi.mocked(headingAttributes).mock.calls.length,
          results: vi.mocked(headingAttributes).mock.results.length,
        },
      },
      memory: process.memoryUsage(),
      heap: getHeapStatistics(),
      code: getHeapCodeStatistics(),
      spaces: getHeapSpaceStatistics(),
    };
    const json = JSON.stringify(report, null, 2) + "\n";
    mkdirSync(directory, { recursive: true });
    // Retain numeric evidence even if snapshot generation fails or exhausts
    // the worker. A successful snapshot is a separate file, not a JSON claim.
    writeFileSync(`${directory}/report.json`, json, "utf8");
    // Full heaps can contain process credentials. Only capture one in an
    // explicitly isolated synthetic environment; CI uploads numeric JSON only.
    if (process.env.MDREFINE_MEMORY_HEAP_SNAPSHOT === "1")
      writeHeapSnapshot(`${directory}/heap.heapsnapshot`);
    // Console interception/stack formatting can itself run regular expressions.
    console.error("Retained-text failure diagnostics (#413):", json);
  } catch (error) {
    // Diagnostic I/O must not replace the original retained-text assertion.
    console.error("Could not capture retained-text failure (#413):", String(error));
  }
}

it("keeps a target's anchors without its parsed document", async () => {
  const parsed: WeakRef<object>[] = [];
  const follow = (node: Nodes) => {
    parsed.push(new WeakRef(node));
    if ("children" in node) node.children.forEach(follow);
  };
  const index = createWorkspace({
    "Doc.md": "",
    "Target.md": '## Install {#setup}\n\n<a name="explicit"></a>\n\n<h2>Html</h2>\n\nText. ^id\n',
  });
  const exists = (fragment: string, dialect: Dialect) =>
    index.resolve("Doc.md", `Target.md#${fragment}`, dialect).fragmentExists;
  const check = () => {
    expect(exists("^id", "obsidian")).toBe(true);
    expect(exists("html", "github")).toBe(true);
    expect(exists("explicit", "commonmark")).toBe(true);
    expect(exists("setup", "forgejo")).toBe(true);
    expect(exists("html", "gitea")).toBe(true);
  };
  parses.watch = (document) => {
    parsed.push(new WeakRef(document));
    follow(document.tree);
  };
  try {
    check();
    expect(parsed.length).toBeGreaterThan(0);
    // The counting mock above records the document it was called with.
    vi.mocked(headingAttributes).mockClear();
    await collectGarbage();
    expect(parsed.filter((node) => node.deref() !== undefined)).toEqual([]);
    // The anchors answer later links without another parse.
    parsed.length = 0;
    check();
    expect(parsed).toEqual([]);
  } finally {
    parses.watch = undefined;
  }
});

it("does not keep a target's text alive through its anchors", async () => {
  // An engine may store a substring as a reference into the string it was cut
  // from, so a kept anchor could keep megabytes of text. Each target here is
  // large, its anchors are few and long enough to be stored that way, and
  // nothing but the index can hold its text: a loader builds it anew on every
  // call. One target of each kind is plain ASCII and one is not, because the
  // engine stores and lowercases the two differently.
  const marks = ["plain", "é-𝒳"];
  const workspace = (scale: number) => {
    const long = (words: string, times: number) => `${words} `.repeat(times * scale);
    const html = (mark: string) => `<p>${long(`filler ${mark} in an HTML block`, 80)}</p>`;
    const prose = (mark: string) => long(`prose ${mark} in one paragraph`, 40);
    const files: Record<string, () => string> = {};
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
    return { files, smallest: Math.min(html("plain").length, prose("plain").length) };
  };
  const anchors: [Dialect, string, (mark: string, target: number) => string][] = [
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
  const check = (files: Record<string, () => string>) => {
    const index = createWorkspace(files);
    for (const [dialect, file, anchor] of anchors)
      marks.forEach((mark, target) => {
        const link = `${file} ${target}.md#${anchor(mark, target)}`;
        expect(index.resolve("Doc.md", link, dialect).fragmentExists, link).toBe(true);
        expect(index.resolve("Doc.md", `${link}x`, dialect).fragmentExists, link).toBe(false);
      });
    vi.mocked(headingAttributes).mockClear();
    return index;
  };
  const settle = async () => {
    // The last string that a regular expression was run on stays referenced.
    /-/.test("-");
    await collectGarbage();
    return process.memoryUsage().heapUsed;
  };
  // The engine compiles code on the first runs, which also takes memory.
  check(workspace(1).files);
  check(workspace(1).files);
  const { files, smallest } = workspace(1000);
  expect(smallest).toBeGreaterThan(1_000_000);
  const documents: WeakRef<object>[] = [];
  const before = await settle();
  parses.watch = (document) => documents.push(new WeakRef(document), new WeakRef(document.tree));
  let index: ReturnType<typeof createWorkspace>;
  try {
    index = check(files);
  } finally {
    parses.watch = undefined;
  }
  const held = (await settle()) - before;
  if (!(held < smallest / 3)) retainedTextFailure(before, held, smallest, documents.length);
  expect(documents.length).toBeGreaterThan(0);
  expect(documents.filter((document) => document.deref() !== undefined)).toEqual([]);
  // The anchors alone are a few kilobytes. Any one kind of them that kept its
  // text alive would hold at least the smallest of the large blocks.
  expect(held).toBeLessThan(smallest / 3);
  // The anchors are still there.
  expect(index.resolve("Doc.md", "Wide 0.md#missing", "github").fragmentExists).toBe(false);
}, 60_000);

it("keeps paired file anchors without either Markdown reading or the YAML AST", async () => {
  const held: WeakRef<object>[] = [];
  const reads = [
    vi.fn(() => "---\ntitle: |\n  ```js\n---\n# Body\n"),
    vi.fn(() => "---\n2001-12-15\n---\n# 2001-12-15\n\n# 2001-12-15-1\n"),
  ];
  const index = createWorkspace({ "Selected.md": reads[0]!, "Unsettled.md": reads[1]! });
  const check = () => {
    expect(index.resolve("From.md", "Selected.md#body", "github").fragmentExists).toBe(true);
    expect(index.resolve("From.md", "Selected.md#body", "commonmark").fragmentExists).toBe(false);
    expect(index.resolve("From.md", "Unsettled.md#2001-12-15", "github").fragmentExists).toBe(true);
    expect(index.resolve("From.md", "Unsettled.md#missing", "github").fragmentIncomplete).toBe(
      true,
    );
  };
  parses.watch = (document) => {
    held.push(new WeakRef(document));
    const candidate = frontMatterReading(document.tree) ?? document.tree;
    const pending: Nodes[] = [document.tree, candidate, plainReading(candidate)];
    const seen = new Set<Nodes>();
    while (pending.length) {
      const node = pending.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      held.push(new WeakRef(node));
      if ("children" in node) for (const child of node.children) pending.push(child);
    }
  };
  try {
    check();
    // Keep returned ASTs out of this async function's resumable locals.
    const recordYamlResults = (): void => {
      for (const result of vi.mocked(parseDocument).mock.results) {
        if (result.type !== "return") continue;
        held.push(new WeakRef(result.value));
        const pending: unknown[] = [result.value.contents];
        while (pending.length) {
          const node = pending.pop();
          if (node === null || typeof node !== "object") continue;
          held.push(new WeakRef(node));
          if (isPair(node)) pending.push(node.key, node.value);
          else if (isMap(node) || isSeq(node)) for (const item of node.items) pending.push(item);
        }
      }
    };
    recordYamlResults();
    expect(held.length).toBeGreaterThan(0);
    // Mocks' result logs themselves retain their arguments/AST results.
    vi.mocked(parseDocument).mockClear();
    vi.mocked(headingAttributes).mockClear();
    await collectGarbage();
    expect(held.filter((value) => value.deref() !== undefined)).toEqual([]);
    check();
    expect(reads.every((read) => read.mock.calls.length === 1)).toBe(true);
    expect(parseDocument).not.toHaveBeenCalled();
  } finally {
    parses.watch = undefined;
    vi.mocked(parseDocument).mockClear();
  }
});
