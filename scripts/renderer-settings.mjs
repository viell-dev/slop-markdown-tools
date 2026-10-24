// Shared corpus selection for native renderer gates and non-gating discovery (#603).
import { randomInt } from "node:crypto";

export const fixedSeeds = [1, 2, 3, 4, 5];

/**
 * @param {Record<string, string | undefined>} values
 * @returns {{ profile: "realistic" | "adversarial", seeds: number[], count: number }}
 */
export function rendererSettings(values = {}) {
  const profile = values.PROFILE || "realistic";
  if (profile !== "realistic" && profile !== "adversarial")
    throw new Error("PROFILE must be realistic or adversarial");
  const number = (text) => {
    if (!/^\d{1,10}$/.test(text) || Number(text) >= 2 ** 32)
      throw new Error("Renderer seeds and counts must be unsigned 32-bit integers");
    return Number(text);
  };
  let seeds =
    values.SEEDS === undefined
      ? profile === "realistic"
        ? [...fixedSeeds]
        : []
      : values.SEEDS === ""
        ? []
        : values.SEEDS.split(",").map(number);
  const seed = values.SEED || (profile === "adversarial" ? "random" : "none");
  if (seed === "random") {
    if (profile !== "adversarial") throw new Error("Random seeds are discovery-only");
    seeds.push(randomInt(1, 2 ** 32));
  } else if (seed !== "none") seeds.push(number(seed));
  seeds = [...new Set(seeds)];
  const count = number(values.COUNT || (profile === "realistic" ? "10" : "100"));
  if (count > 0 && seeds.length === 0) throw new Error("Generated documents need a seed");
  return { profile, seeds, count };
}
