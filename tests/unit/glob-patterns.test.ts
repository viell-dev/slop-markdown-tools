import { Minimatch } from "minimatch";
import { expect, it } from "vitest";

it("bounds globparts amplification without changing ordinary matches (#837)", () => {
  // Reject the complete amplified pattern rather than silently keeping only
  // the first rows, which could change which paths match.
  expect(
    () =>
      new Minimatch(Array(8).fill("**/../a/b").join("/"), {
        optimizationLevel: 2,
        braceExpandMax: 16,
      }),
  ).toThrow(RangeError);
  const complete = new Minimatch(Array(4).fill("**/../a/b").join("/"), {
    optimizationLevel: 2,
    braceExpandMax: 16,
  });
  expect(complete.set).toHaveLength(16);
  const ordinary = new Minimatch("**/../a/b/**/../c/d", { optimizationLevel: 2 });
  expect(ordinary.match("../a/b/../c/d")).toBe(true);
  expect(ordinary.match("x/a/b/y/c/d")).toBe(true);
  expect(ordinary.match("x/a/b/y/c/e")).toBe(false);
});
