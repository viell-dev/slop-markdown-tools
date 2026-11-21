import { expect, it } from "vitest";
import { createPhaseTimeline } from "../support/parser/parser-emphasis-production-support.mjs";

// The registration-mutant tests pass Vitest's `onTestFailed` here. A stand-in
// hook keeps both outcomes deterministic: a passing test never calls the
// registered handler, and a failure or timeout calls it once (#992).
function recorded() {
  let clock = 1000;
  const written: unknown[][] = [];
  const handlers: (() => void)[] = [];
  const timeline = createPhaseTimeline("Missing-core mutant", {
    now: () => clock,
    write: (...values) => written.push(values),
  });
  timeline.reportOnFailure((handler) => handlers.push(handler));
  const advance = (ms: number): void => {
    clock += ms;
  };
  return { timeline, written, handlers, advance };
}

it("keeps phase times in memory while the test has not failed", () => {
  const { timeline, written, handlers, advance } = recorded();
  timeline.mark("copy-dist", { files: 3 });
  advance(12.34);
  timeline.mark("done");
  expect(handlers).toHaveLength(1);
  expect(written).toEqual([]);
});

it("writes the phases reached so far when the failure handler runs", () => {
  const { timeline, written, handlers, advance } = recorded();
  timeline.mark("assert-binding-before-copy");
  advance(5);
  timeline.mark("copy-dist", { files: 3 });
  // A copy abandoned by a timeout leaves its progress without a later phase.
  timeline.progress.copy = { files: 3, copiedFiles: 1, copiedBytes: 42, current: "dist/b.js" };
  advance(30000.06);
  handlers[0]?.();
  expect(written).toHaveLength(1);
  const [label, json] = written[0] ?? [];
  expect(label).toBe("Missing-core mutant failure phases:");
  expect(typeof json).toBe("string");
  const report: unknown = JSON.parse(String(json));
  expect(report).toMatchObject({
    node: process.version,
    platform: process.platform,
    elapsedMs: 30005.1,
    phases: [
      { phase: "assert-binding-before-copy", elapsedMs: 0 },
      { phase: "copy-dist", elapsedMs: 5, files: 3 },
    ],
    progress: {
      copy: { files: 3, copiedFiles: 1, copiedBytes: 42, current: "dist/b.js" },
    },
  });
  expect(report).toHaveProperty("startedAt");
  expect(report).toHaveProperty("resources.userCPUTime");
});
