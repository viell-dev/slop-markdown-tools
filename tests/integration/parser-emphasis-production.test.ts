import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import {
  productionCases,
  profiles,
  registrationCases,
} from "../support/parser/parser-emphasis-production-cases.mjs";
import {
  assertBinding,
  assertSources,
  createRegistrationMutant,
  productionBinding,
  runCoverageChild,
} from "../support/parser/parser-emphasis-production-support.mjs";

let root: string;
let binding: Awaited<ReturnType<typeof productionBinding>>;

beforeAll(async () => {
  root = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
  // Requires the normal build first. Never rebuild or silently repair stale dist.
  binding = await productionBinding(root);
});

it.each(profiles)(
  "reaches checked emphasis in compiled production and lazy readings for %s",
  async (dialect) => {
    const cases = (await productionCases()).filter((entry) => entry.dialect === dialect);
    const child = await runCoverageChild({
      schema: 1,
      sourceRoot: root,
      runtimeRoot: root,
      binding,
      cases,
    });
    expect(child.stderr).toBe("");
    expect(child.result.failures, JSON.stringify(child.result.failures)).toEqual([]);
    expect(child.code).toBe(0);
    expect(child.result.status).toBe("passed");
    expect(child.result.hashesStable).toBe(true);
    expect(child.result.caseCount).toBe(cases.length);
    expect(new Set(child.result.rows.map((row: { dialect: string }) => row.dialect))).toEqual(
      new Set([dialect]),
    );
    expect(child.result.rows.length).toBeGreaterThan(cases.length); // actual lazy/cached phases
    expect(child.result.rows.every((row: { astParity: boolean }) => row.astParity)).toBe(true);
    await assertBinding(root, binding);
    await assertSources(root, binding);
  },
);

it.each(registrationCases())(
  "kills the missing-$registration mutant by a failed production-hit assertion",
  async (entry) => {
    const mutant = await createRegistrationMutant(root, binding, entry.registration);
    try {
      const child = await runCoverageChild({
        schema: 1,
        sourceRoot: root,
        runtimeRoot: mutant.root,
        binding,
        mutation: mutant.mutation,
        cases: [entry],
      });
      expect(child.stderr).toBe("");
      expect(child.code).toBe(1);
      expect(child.result.status).toBe("failed");
      expect(child.result.hashesStable).toBe(true);
      expect(child.result.rows).toHaveLength(1);
      const row = child.result.rows[0];
      assert(row, "Missing actual registration-mutant row");
      expect(row).toMatchObject({ calls: 0, expectHit: true, astParity: true });
      expect(row.treeHash).toBe(row.originalResolverTreeHash);
      expect(child.result.failures).toHaveLength(1);
      expect(child.result.failures[0]).toMatchObject({
        kind: "reachability",
        id: `${entry.id}/primary`,
        calls: 0,
        expectHit: true,
      });
      // Only the exact registration CallExpression span changed. The helper
      // records first-arg replacement and verifies all other copied dist bytes.
      assert.equal(mutant.mutation.normalHash, binding.hashes[binding.parserFile]);
      expect(child.result.mutation).toEqual(mutant.mutation);
    } finally {
      await mutant.cleanup();
    }
    await assertBinding(root, binding);
    await assertSources(root, binding);
  },
);
