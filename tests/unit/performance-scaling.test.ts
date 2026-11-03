import { afterEach, expect, it, vi } from "vitest";
import { measureScaling, scaling } from "../performance/scaling.js";

afterEach(() => vi.restoreAllMocks());

it.each([
  {
    name: "default measurement",
    mode: "measurement",
    maxCalls: undefined,
    targetMs: undefined,
    calls: 5,
  },
  { name: "default ratio", mode: "ratio", maxCalls: undefined, targetMs: undefined, calls: 5 },
  {
    name: "explicit measurement target",
    mode: "measurement",
    maxCalls: 32,
    targetMs: 60,
    calls: 12,
  },
  { name: "explicit ratio target", mode: "ratio", maxCalls: 32, targetMs: 60, calls: 12 },
  {
    name: "bounded measurement target",
    mode: "measurement",
    maxCalls: 32,
    targetMs: 200,
    calls: 32,
  },
])("retains the scaling gate's timing contract ($name)", ({ mode, maxCalls, targetMs, calls }) => {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const costs = [
    // The calibration minimum is five milliseconds per call.
    7,
    9,
    10,
    5,
    8,
    ...[5, 20, 15, 10, 7, 25, 18, 6].flatMap((cost) => Array<number>(calls).fill(cost)),
  ];
  const prepared: number[] = [];
  const verified: number[] = [];
  const measure = mode === "measurement" ? measureScaling : scaling;
  const result = measure(
    [2, 8],
    (size) => {
      clock += 1_000_000;
      prepared.push(size);
      return { size };
    },
    (input) => {
      const cost = costs.shift();
      if (cost === undefined) throw new Error("Unexpected measured call");
      clock += cost;
      return { size: input.size };
    },
    (output, input) => {
      clock += 1_000_000;
      expect(output).toEqual(input);
      verified.push(input.size);
    },
    maxCalls,
    targetMs,
  );
  const expected = {
    sizes: [2, 8],
    targetMs: targetMs ?? 25,
    warmup: [7, 9],
    calibration: [10, 5, 8],
    calls,
    samples: [
      [5, 10, 7, 6].map((cost) => cost * calls),
      [20, 15, 25, 18].map((cost) => cost * calls),
    ],
    ratio: 3,
  };
  expect(result).toEqual(mode === "measurement" ? expected : expected.ratio);
  expect(costs).toEqual([]);
  // Preparation and verification cover every operation, including calibration.
  // Their million-ms costs must never enter the reported windows or ratio.
  const initial = [2, 8, 2, 2, 2];
  expect(prepared).toEqual([
    ...initial,
    ...[2, 8, 2, 8, 2, 8, 2, 8].flatMap((size) => Array<number>(calls).fill(size)),
  ]);
  expect(verified).toEqual([
    ...initial,
    ...[2, 8, 8, 2, 2, 8, 8, 2].flatMap((size) => Array<number>(calls).fill(size)),
  ]);
});
