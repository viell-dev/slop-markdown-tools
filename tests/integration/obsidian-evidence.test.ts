import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "../../src/index.js";
import {
  createRendererReport,
  obsidianControls,
  obsidianWidths,
  startDocument,
  validateRendererReport,
} from "../../scripts/renderer-evidence.mjs";
import baseline from "../../scripts/obsidian/baseline.json" with { type: "json" };

const harness = readFileSync(
  new URL("../../scripts/obsidian/obsidian.e2e.mjs", import.meta.url),
  "utf8",
);
const start = harness.indexOf('  it("shows the same in Live Preview and in Reading view",');
const end = harness.lastIndexOf("\n});");
if (start < 0 || end <= start) throw new Error("Changed Obsidian comparison callback boundaries");
// Execute the actual producer callback with capture and I/O seams. This checks
// bookkeeping, while native jobs prove what the real host captures.
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- Verbatim harness callback probe.
const callback = new Function(
  "scope",
  `const { reduce, probe, identifyHost, report, console, createWorkspace, widths,
    documents, startDocument, compare, obsidianPage, browser, classifyDifferences,
    profile, seeds, count, checkpoint, validateRendererReport, expect, parse } = scope;
  let run;
  const it = (_title, body) => { run = body; };
  ${harness.slice(start, end)}
  return run;`,
) as (scope: Record<string, unknown>) => (this: { skip(): never }) => Promise<void>;

function captured(views: string[], converts = true) {
  const settings = { profile: "realistic", seeds: [1], count: 0 };
  const report = {
    ...createRendererReport("obsidian", settings),
    requested: { app: baseline.app, installer: baseline.installer },
    widths: obsidianWidths,
    identity: {
      app: baseline.app,
      installer: baseline.installer,
      electron: baseline.electron,
      chrome: baseline.chrome,
      image: {
        id: `sha256:${"a".repeat(64)}`,
        declaredBase: baseline.baseImage,
        platform: "linux/amd64",
      },
    },
    controls: obsidianControls.map((name) => ({ name, passed: true })),
  };
  let recordedMode: string | undefined;
  let recordedReferences: boolean | undefined;
  const run = callback({
    ...settings,
    reduce: undefined,
    probe: undefined,
    report,
    identifyHost: async () => {},
    console: { log() {} },
    createWorkspace: () => ({}),
    parse,
    widths: obsidianWidths,
    documents: () =>
      report.plan.documents.map(({ name, wrapMode, referenceLinks }) => ({
        name,
        wrapMode,
        referenceLinks,
        source: "Synthetic.\n",
      })),
    startDocument: (
      report: unknown,
      name: string,
      width: number,
      wrapMode?: string,
      referenceLinks?: boolean,
    ) => {
      recordedMode = wrapMode;
      recordedReferences = referenceLinks;
      return startDocument(report, name, width, wrapMode, referenceLinks);
    },
    compare: (
      _source: string,
      _width: number,
      _workspace: unknown,
      wrapMode?: string,
      referenceLinks?: boolean,
    ) => {
      expect(wrapMode).toBe(recordedMode);
      expect(referenceLinks).toBe(recordedReferences);
      return Promise.resolve({
        output:
          referenceLinks && converts
            ? "[Changed synthetic][guide].\n\n[guide]: /guide\n"
            : "Changed synthetic.\n",
        views: Object.fromEntries(views.map((name) => [name, ["same", "same"]])),
        changed: [],
      });
    },
    checkpoint() {},
    validateRendererReport,
    classifyDifferences: () => ({ unexpected: [], known: [], stale: [] }),
    expect,
  });
  return {
    report,
    run: () =>
      run.call({
        skip() {
          throw new Error("unexpected skip");
        },
      }),
  };
}

it("records the actual captured views for every changed Obsidian document", async () => {
  const evidence = captured(["livePreview", "reading"]);
  await expect(evidence.run()).resolves.toBeUndefined();
  expect(evidence.report.documents).toHaveLength(evidence.report.plan.documents.length * 2);
});

it("rejects a lost Reading capture instead of recording the planned view as completed", async () => {
  const evidence = captured(["livePreview"]);
  await expect(evidence.run()).rejects.toThrow("Missing or duplicate native views");
});

it("rejects a fixture that changed without actually converting a reference", async () => {
  const evidence = captured(["livePreview", "reading"], false);
  await expect(evidence.run()).rejects.toThrow("Reference conversion fixture did not convert");
});
