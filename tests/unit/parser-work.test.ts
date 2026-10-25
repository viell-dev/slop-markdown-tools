import { expect, it } from "vitest";
import { createOperationProbe } from "../support/parser/parser-module-probes.mjs";

// Deterministic algorithm checks belong in the ordinary unit suite. These small
// counts measure array traffic rather than clock time or native parser speed.
it.each(["editMap", "text", "code", "attention", "strike", "autolink"] as const)(
  "keeps %s array work proportional and rejects its former algorithm",
  async (kind) => {
    const stock = await createOperationProbe(kind, "stock");
    const fixed = await createOperationProbe(kind, "fixed");
    const oldSmall = stock(20);
    const oldLarge = stock(80);
    const newSmall = fixed(20);
    const newLarge = fixed(80);
    expect(newSmall.signature).toEqual(oldSmall.signature);
    expect(newLarge.signature).toEqual(oldLarge.signature);
    expect(newSmall.arrayIdentity && newLarge.arrayIdentity).toBe(true);
    expect(newSmall.survivorIdentity && newLarge.survivorIdentity).toBe(true);
    // Four times the workload: the corrected array traffic stays below 6x,
    // while the unchanged dependency exceeds 10x on these exact fixtures.
    expect(newLarge.work / newSmall.work).toBeLessThan(6);
    expect(oldLarge.work / oldSmall.work).toBeGreaterThan(10);
  },
);
