import { Minimatch } from "minimatch";
import { expect, it } from "vitest";

it("bounds globparts amplification without changing ordinary matches (#837)", () => {
  const bounded = new Minimatch(Array(8).fill("**/../a/b").join("/"), {
    optimizationLevel: 2,
    braceExpandMax: 16,
  });
  expect(bounded.set).toHaveLength(16);
  const ordinary = new Minimatch("**/../a/b/**/../c/d", { optimizationLevel: 2 });
  expect(ordinary.match("../a/b/../c/d")).toBe(true);
  expect(ordinary.match("x/a/b/y/c/d")).toBe(true);
  expect(ordinary.match("x/a/b/y/c/e")).toBe(false);
});
