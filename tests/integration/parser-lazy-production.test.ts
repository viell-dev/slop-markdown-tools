import { expect, it } from "vitest";
import { verifyLazyLineProduction } from "../support/parser/parser-lazy-production.mjs";

it("reaches the built lazy-line cache and bounds its event work (#796)", async () => {
  const result = await verifyLazyLineProduction();
  expect(result.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.results.every((sample) => sample.hits > 0)).toBe(true);
});

it("rejects a built missing-helper mutant by its production hit check (#796)", async () => {
  await expect(verifyLazyLineProduction("missing")).rejects.toThrow(
    "production lazy-line helper was not reached",
  );
});

it("rejects a built cache-bypass mutant by event work (#796)", async () => {
  await expect(verifyLazyLineProduction("cache")).rejects.toThrow(/production lazy-line work grew/);
});
