import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discover } from "../../src/workspace/files.js";
import { fixture } from "../support/cli.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the configuration's ignore patterns", () => {
  it("are compiled once, not for every file", async () => {
    const names = Array.from({ length: 2000 }, (_, index) => `docs/${index}.md`);
    const root = await fixture(Object.fromEntries(names.map((name) => [name, "Text.\n"])));
    // Patterns that match none of the files, so that each is tried for each.
    const ignore = Array.from({ length: 16 }, (_, index) => `drafts-${index}/**`);
    // Without Git to start, discovery itself is what is timed.
    vi.stubEnv("PATH", path.join(root, "no-programs"));
    const fastest = async (patterns: string[]) => {
      let best = Infinity;
      for (let run = 0; run < 5; run++) {
        const started = performance.now();
        expect((await discover(root, [], patterns)).selected).toHaveLength(names.length);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    // Discovery without patterns is the baseline. Matching the patterns takes
    // about four times as long as that, and compiling them for each file took
    // about twenty times as long.
    expect((await fastest(ignore)) / (await fastest([]))).toBeLessThan(9);
  });
});
