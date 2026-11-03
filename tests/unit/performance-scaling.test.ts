import { afterEach, expect, it, vi } from "vitest";
import { measureScaling, scaling } from "../performance/scaling.js";

afterEach(() => vi.restoreAllMocks());

it.each(["measurement", "ratio"])("retains the scaling gate's timing contract (%s)", (mode) => {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const costs = [
    // Warm-up and calibration select five calls per measured window.
    7,
    9,
    10,
    5,
    8,
    ...[5, 20, 15, 10, 7, 25, 18, 6].flatMap((cost) => Array<number>(5).fill(cost)),
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
  );
  const expected = {
    sizes: [2, 8],
    warmup: [7, 9],
    calibration: [10, 5, 8],
    calls: 5,
    samples: [
      [25, 50, 35, 30],
      [100, 75, 125, 90],
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
    ...[2, 8, 2, 8, 2, 8, 2, 8].flatMap((size) => Array<number>(5).fill(size)),
  ]);
  expect(verified).toEqual([
    ...initial,
    ...[2, 8, 8, 2, 2, 8, 8, 2].flatMap((size) => Array<number>(5).fill(size)),
  ]);
});
