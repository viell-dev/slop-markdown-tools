import fc from "fast-check";
import { expect, it } from "vitest";
import { seededSlices } from "../support/property-slices.js";
import type { SliceParameters } from "../support/property-slices.js";

const generated = (parameters: Omit<SliceParameters, "path"> & { path?: string }): string[] => {
  const values: string[] = [];
  fc.assert(
    fc.property(fc.string(), fc.integer(), (text, number) => {
      values.push(JSON.stringify([text, number]));
    }),
    parameters,
  );
  return values;
};

it("replays a fixed-seed run's inputs in order across its slices (#902)", () => {
  const whole = generated({ numRuns: 120, seed: 902 });
  const slices = seededSlices(902, 120, 40);
  expect(slices.map(([offset]) => offset)).toEqual([0, 40, 80]);
  expect(slices.flatMap(([, parameters]) => generated(parameters))).toEqual(whole);
  expect(new Set(whole).size).toBeGreaterThan(1);
});

it("rejects slices that would leave runs out", () => {
  expect(() => seededSlices(902, 100, 30)).toThrow("Cannot split 100 runs into slices of 30");
  expect(() => seededSlices(902, 100, 0)).toThrow("Cannot split 100 runs into slices of 0");
});
