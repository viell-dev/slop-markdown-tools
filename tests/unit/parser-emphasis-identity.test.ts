import { expect, it } from "vitest";
import { emphasisGraph } from "../support/parser/parser-emphasis-graph.mjs";
import {
  emphasisSources,
  verifyActualNulAndAsciiFlanking,
  emphasisWork,
  verifyEmphasisDeclines,
  verifyEmphasisIdentity,
  verifyEmphasisIdentityMutant,
  verifyEmphasisTokenizer,
  verifyLargeReplacement,
  verifyNoCloser,
  verifyReplacementDirections,
} from "../support/parser/parser-emphasis-regressions.mjs";

it("preserves stock original tokens, fresh leftover tuples, points and first real pipeline identities", async () => {
  const result = await verifyEmphasisIdentity();
  expect(result.comparisons).toBeGreaterThan(0);
});

it("uses the signed post-resolution delta for actual data compaction at k=1/7/8 and large k", async () => {
  expect(await verifyReplacementDirections()).toEqual({ comparisons: 12 });
});

it("moves a >10k balanced suffix once despite >10k actual output tuples", async () => {
  expect(await verifyLargeReplacement()).toEqual({ comparisons: 1 });
});

it.each(["attention", "strike"] as const)(
  "performs exact %s no-closer cleanup before allocations/registry/matching",
  async (kind) => {
    expect(await verifyNoCloser(kind)).toEqual({ comparisons: 13 });
  },
);

it("counts real serialization, interior calls and input/scratch/output work", async () => {
  expect(await emphasisWork()).toEqual({ comparisons: 2 });
});

it("declines absent/deferred/both opt-in, unknown identities and reordered pipelines", async () => {
  expect(await verifyEmphasisDeclines()).toEqual({ comparisons: 5 });
});

const sources = emphasisSources();
it.each(["commonmark", "gfm", "cjk"])(
  "preserves actual %s tokenizer coordinates, flags, off-array tokens and lossless ASTs",
  async (mode) => {
    const result = await verifyEmphasisTokenizer(mode, sources);
    expect(result.sources).toBe(sources.length);
    expect(result.comparisons).toBe(sources.length * 4);
    expect(result.nativeCoordinateCases).toBeGreaterThan(0);
  },
);

// Compile/load each actual repaired mutant BEFORE expecting the mechanism
// assertion to fail. An anchor/build/registration failure must fail this test,
// never masquerade as sensitivity. Every mechanism runner checks stock parity
// before its work assertion. No synthetic matching algorithm is used as oracle.
it.each([
  ["serialize-each-layer", /Marker serialization must happen only once/],
  ["interior-each-layer", /Repeated interior callbacks forbidden/],
  ["interior-copy-each-layer", /Interior copying must happen once/],
] as const)("rejects the independent %s work mutant", async (mutant, message) => {
  await emphasisGraph("fixed", mutant);
  await expect(emphasisWork(mutant)).rejects.toThrow(message);
});

it.each(["attention", "strike"] as const)(
  "rejects %s scratch restoration on no-closer calls",
  async (kind) => {
    await emphasisGraph("fixed", "scratch-no-closer");
    await expect(verifyNoCloser(kind, "scratch-no-closer")).rejects.toThrow(
      /forbidden work: leftAllocations/,
    );
  },
);

it("rejects registry work even on empty nested attention calls", async () => {
  await emphasisGraph("fixed", "registry-before-empty");
  await expect(verifyNoCloser("attention", "registry-before-empty")).rejects.toThrow(
    /forbidden work: registryCalls/,
  );
});

it.each(["attention", "strike"] as const)(
  "rejects the generic-close %s pre-scan mutant",
  async (kind) => {
    await emphasisGraph("fixed", "generic-close");
    await expect(verifyNoCloser(kind, "generic-close")).rejects.toThrow(/Exactly one pre-scan/);
  },
);

it.each(["backward-only", "forward-only", "positive-delta"] as const)(
  "rejects %s signed replacement corruption with original stock references",
  async (mutant) => {
    await emphasisGraph("fixed", mutant);
    await expect(verifyReplacementDirections(mutant)).rejects.toThrow(/Signed replacement/);
  },
);

it("rejects restored chunked insertion through actual suffix movement", async () => {
  await emphasisGraph("fixed", "chunked-replacement");
  await expect(verifyLargeReplacement("chunked-replacement")).rejects.toThrow(
    /One suffix move per tuple/,
  );
});

it.each([
  ["reuse-leftovers", /Leftover tuple must be fresh/],
  ["clean-consumed", /Consumed off-array original retains raw type/],
] as const)("rejects the %s reference mutant", async (mutant, message) => {
  await emphasisGraph("fixed", mutant);
  await expect(verifyEmphasisIdentityMutant(mutant)).rejects.toThrow(message);
});

it("records real stock/fixed NUL and ASCII flanking flags before mutation", async () => {
  expect((await verifyActualNulAndAsciiFlanking()).cases).toBe(36);
});
