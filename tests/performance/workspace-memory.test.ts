import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMap, isPair, isSeq, parseDocument } from "yaml";
import { frontMatterReading, plainReading } from "../../src/syntax/parse.js";
import { runInThisContext } from "node:vm";
import type { Nodes } from "mdast";
import { expect, it, vi } from "vitest";
import { createWorkspace } from "../../src/index.js";
import type { Dialect, Document } from "../../src/index.js";
import { headingAttributes } from "../../src/workspace/heading-attributes.js";
import { checkMemoryAnchors, collectGarbage, memoryFixture } from "../support/workspace-memory.mjs";
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

it("keeps large target documents collectible without reloading their anchors", async () => {
  const fixture = memoryFixture(1000);
  const documents: WeakRef<object>[] = [];
  parses.watch = (document) => documents.push(new WeakRef(document), new WeakRef(document.tree));
  try {
    const index = createWorkspace(fixture.files);
    checkMemoryAnchors(index);
    const reads = [...fixture.reads];
    vi.mocked(headingAttributes).mockClear();
    await collectGarbage();
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.filter((document) => document.deref() !== undefined)).toEqual([]);
    checkMemoryAnchors(index);
    expect([...fixture.reads]).toEqual(reads);
  } finally {
    parses.watch = undefined;
  }
}, 60_000);

it("does not keep a target's text alive through its anchors", () => {
  // This runner-only root exceeds the source allowance. It must not enter the
  // child's heap delta, unlike the original process-wide Vitest measurement.
  const unrelated = Array.from({ length: 1_000_000 }, (_, index) => index);
  const measured = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../support/workspace-memory-child.mjs", import.meta.url))],
    { encoding: "utf8", windowsHide: true, timeout: 45_000, maxBuffer: 1024 * 1024 },
  );
  expect(unrelated.at(-1)).toBe(999_999);
  expect(measured.error, measured.stderr).toBeUndefined();
  expect(measured.signal, measured.stderr).toBeNull();
  expect(measured.status, measured.stderr + measured.stdout).toBe(0);
  const report: unknown = JSON.parse(measured.stdout);
  expect(report).toMatchObject({
    issue: 413,
    measurement: "isolated-compiled-product",
    collection: { type: "major", execution: "async", flavor: "last-resort" },
    sample: { smallest: 1_160_000, allowance: 1_160_000 / 3 },
  });
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
