import { expect, it } from "vitest";
import { verifyContainerProduction } from "../support/parser/parser-containers-production.mjs";

it("bounds both compiled deep-list traversals with original-grammar controls (#859)", async () => {
  const result = await verifyContainerProduction();
  expect(result.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.observationComparisons).toBe(18);
  expect(result.observationCacheHits).toBeGreaterThan(0);
});

it.each([
  ["missing", /production container helper was not reached/],
  ["cache", /production container blankCodes work grew/],
  ["descendants", /production container listVisits work grew/],
] as const)("rejects the compiled %s mutant (#859)", async (mutant, message) => {
  await expect(verifyContainerProduction(mutant)).rejects.toThrow(message);
});
