import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const harness = readFileSync(
  new URL("../../scripts/obsidian/obsidian.e2e.mjs", import.meta.url),
  "utf8",
);
const start = harness.indexOf('  it("shows the documents to probe",');
const end = harness.indexOf(
  '  it("reduces documents to the lines that show the difference",',
  start,
);
if (start < 0 || end <= start) throw new Error("Changed Obsidian probe callback boundaries");
type ProbeCallback = (this: { skip(): never }) => Promise<void>;
// Execute the actual harness callback with I/O seams supplied. These checks
// cover evidence bookkeeping; the real renderer is verified separately.
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- Verbatim harness callback probe.
const factory = new Function(
  "scope",
  `
  const { probe, browser, process, createHash, readFileSync, writeFileSync,
    obsidianPage, shown, cleanHtml, livePreview, console } = scope;
  let callback;
  const it = (_title, run) => { callback = run; };
  ${harness.slice(start, end)}
  return callback;
`,
) as (scope: Record<string, unknown>) => ProbeCallback;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function probeRun(
  options: { fail?: boolean; absent?: boolean; versions?: Record<string, string> } = {},
) {
  const sources = ["[[target]]\n", "****alpha****\n"];
  const packet = JSON.stringify(sources);
  const files = new Map<string, string>();
  const metadata: string[] = [];
  let observed = 0;
  const callback = factory({
    probe: options.absent ? null : sources,
    process: { env: { OBSIDIAN_VERSION: "requested-only", PROBE: packet } },
    createHash,
    readFileSync: (filename: string) => {
      if (filename === "/check/obsidian.e2e.mjs") return harness;
      const value = files.get(filename);
      if (value === undefined) throw new Error(`Unexpected read: ${filename}`);
      return value;
    },
    writeFileSync: (filename: string, value: string) => {
      files.set(filename, value);
      if (filename.endsWith("probe-metadata.json")) metadata.push(value);
    },
    browser: {
      executeObsidian: (
        read: (context: {
          obsidian: { apiVersion: string };
          require: (name: string) => { versions: Record<string, string> };
        }) => unknown,
      ) => {
        observed++;
        return Promise.resolve(
          read({
            obsidian: { apiVersion: "observed-app" },
            require(name) {
              expect(name).toBe("node:process");
              return {
                versions: options.versions ?? {
                  chrome: "observed-chrome",
                  electron: "observed-electron",
                },
              };
            },
          }),
        );
      },
    },
    obsidianPage: { write: async () => {} },
    shown: (_path: string, source: string) => {
      if (options.fail) throw new Error("interrupted capture");
      return Promise.resolve({
        reading: source,
        rawReading: source,
        preview: source,
        lines: [source],
      });
    },
    cleanHtml: (value: string) => value,
    livePreview: (value: string[]) => value,
    console: { log() {} },
  });
  return {
    files,
    metadata,
    packet,
    sources,
    observed: () => observed,
    run: () =>
      callback.call({
        skip() {
          throw new Error("skipped");
        },
      }),
  };
}

it("binds probe evidence to observed renderer metadata and the completed capture (#580)", async () => {
  const probe = probeRun();
  await probe.run();
  expect(probe.observed()).toBe(1);
  expect(probe.metadata).toHaveLength(2);
  expect(JSON.parse(probe.metadata[0]!)).toMatchObject({ captureSha256: null });
  expect(JSON.parse(probe.metadata[1]!)).toEqual({
    schemaVersion: 1,
    requestedObsidian: "requested-only",
    observedObsidian: "observed-app",
    browser: { chrome: "observed-chrome", electron: "observed-electron" },
    probeCount: probe.sources.length,
    sourcePacketSha256: digest(probe.packet),
    specSha256: digest(harness),
    captureSha256: digest(probe.files.get("/out/probes.json")!),
  });
  expect(JSON.parse(probe.files.get("/out/probes.json")!)).toEqual(
    probe.sources.map((source) => ({
      source,
      reading: source,
      preview: source,
      livePreview: [source],
      rawReading: source,
      lines: [source],
    })),
  );
});

it("retains incomplete evidence on capture failure without inventing renderer versions (#580)", async () => {
  const probe = probeRun({ fail: true, versions: {} });
  await expect(probe.run()).rejects.toThrow("interrupted capture");
  expect(probe.metadata).toHaveLength(1);
  expect(JSON.parse(probe.metadata[0]!)).toMatchObject({
    observedObsidian: "observed-app",
    browser: { chrome: null, electron: null },
    captureSha256: null,
  });
  expect(probe.files.has("/out/probes.json")).toBe(false);
});

it("leaves ordinary comparison runs outside the probe metadata path (#580)", async () => {
  const probe = probeRun({ absent: true });
  await expect(probe.run()).rejects.toThrow("skipped");
  expect(probe.observed()).toBe(0);
  expect(probe.files.size).toBe(0);
});
