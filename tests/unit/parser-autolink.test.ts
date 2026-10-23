import { expect, it } from "vitest";
import { verifyAutolinkCompatibility } from "../parser-autolink-compatibility.mjs";

it("keeps the new autolink cache private and invalidates stale jumps", async () => {
  const result = await verifyAutolinkCompatibility();
  expect(result.cases).toBe(27);
  expect(result.astComparisons).toBe(54);
  expect(result.observations).toBeGreaterThan(0);
  expect(result.invalidatedCacheCases).toBe(8);
});
