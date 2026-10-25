import { expect, it } from "vitest";
import {
  createCoverageDeltaReader,
  successFunctionRange,
} from "../support/parser/parser-emphasis-production-support.mjs";

const url = "file:///owned/parser.generated.js";
interface Range {
  startOffset: number;
  endOffset: number;
  count: number;
}
interface FunctionRecord {
  functionName: string;
  ranges: Range[];
  isBlockCoverage: boolean;
}
interface ScriptRecord {
  url: string;
  scriptId: string;
  functions: FunctionRecord[];
}
const source = "function mdrefineReplaceAttentionRegion() { return 0; }\n";
const range = successFunctionRange(source);
const fn = (count = 0): FunctionRecord => ({
  functionName: "mdrefineReplaceAttentionRegion",
  ranges: [{ ...range, count }],
  isBlockCoverage: false,
});
const script = (
  functions: FunctionRecord[] = [fn()],
  scriptId = "actual-script",
): ScriptRecord => ({ url, scriptId, functions });
const snapshot = (...scripts: ScriptRecord[]) => ({ result: scripts });
const fresh = () => createCoverageDeltaReader(snapshot(script()), url, range);

it("reads only calibrated delta omissions as zero while preserving actual positive calls", () => {
  const reader = fresh();
  expect(reader.read(snapshot())).toEqual({ calls: 0, observation: "script-omitted" });
  expect(reader.read(snapshot(script([])))).toEqual({ calls: 0, observation: "function-omitted" });
  expect(reader.read(snapshot(script([fn(1)])))).toEqual({ calls: 1, observation: "reported" });
  expect(reader.read(snapshot(script([fn(0)])))).toEqual({ calls: 0, observation: "reported" });
});

it("requires an actual initial target catalog rather than source presence alone", () => {
  expect(() => createCoverageDeltaReader(snapshot(), url, range)).toThrow();
  expect(() => createCoverageDeltaReader(snapshot(script([])), url, range)).toThrow();
  expect(() => createCoverageDeltaReader(snapshot(script(), script()), url, range)).toThrow();
  expect(() => createCoverageDeltaReader(snapshot(script([fn(), fn()])), url, range)).toThrow();
  expect(() =>
    createCoverageDeltaReader(snapshot(script()), url, {
      startOffset: range.startOffset + 1,
      endOffset: range.endOffset,
    }),
  ).toThrow();
});

it("rejects later script, range, name, count and ambiguity changes", () => {
  for (const delta of [
    snapshot(script([], "different-script")),
    snapshot(script(), script()),
    snapshot(script([fn(), fn()])),
    snapshot(
      script([{ ...fn(), ranges: [{ ...range, endOffset: range.endOffset - 1, count: 1 }] }]),
    ),
    snapshot(script([{ ...fn(), functionName: "renamed" }])),
    snapshot(script([{ ...fn(), ranges: [] }])),
    snapshot(script([fn(-1)])),
    snapshot(script([fn(Number.NaN)])),
  ])
    expect(() => fresh().read(delta)).toThrow();
});

it("allows zero-count catalog entries to become detailed block coverage without changing identity", () => {
  const detailed = {
    ...fn(1),
    isBlockCoverage: true,
    ranges: [
      { ...range, count: 1 },
      { startOffset: range.startOffset + 1, endOffset: range.endOffset - 1, count: 0 },
    ],
  };
  expect(fresh().read(snapshot(script([detailed]))).calls).toBe(1);
});

it("retains its established range if the caller later mutates its input object", () => {
  const expected = { ...range };
  const reader = createCoverageDeltaReader(snapshot(script()), url, expected);
  expected.startOffset++;
  expect(reader.read(snapshot(script([fn(1)]))).calls).toBe(1);
  expect(reader.catalog.startOffset).toBe(range.startOffset);
});
