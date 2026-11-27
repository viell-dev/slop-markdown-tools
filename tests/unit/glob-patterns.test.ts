import { minimatch, Minimatch } from "minimatch";
import { expect, it } from "vitest";

it("keeps an escaped backslash when it expands a brace group (#994)", () => {
  // Input patterns expand their braces with braceExpand() before compiling
  // each alternative. minimatch 11.0.5 returned sub/a\b.md, whose backslash
  // then escaped the b, so the pattern matched sub/ab.md.
  expect(minimatch.braceExpand(String.raw`sub/a\\{b,c}.md`)).toEqual([
    String.raw`sub/a\\b.md`,
    String.raw`sub/a\\c.md`,
  ]);
});

it("matches a long numeric range inside a repeating extglob as its expansion does (#1020)", () => {
  // `ignore`, overrides and code-formatter excludes compile their braces in
  // Minimatch. From 100 values, minimatch 11.0.8 matched a range as one class,
  // so *(...) and +(...) could repeat different values: *({1..100}).md matched
  // 510.md, which no expanded pattern such as *(5).md or *(10).md matches.
  for (const pattern of ["*({1..100}).md", "+({1..100}).md"]) {
    const matcher = new Minimatch(pattern, { dot: true });
    expect(matcher.match("510.md")).toBe(false);
    expect(matcher.match("1010.md")).toBe(true);
    expect(matcher.match("100.md")).toBe(true);
  }
});

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
