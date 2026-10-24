// Only exact, issue-linked adversarial observations can be known differences.
import known from "./renderer-known-differences.json" with { type: "json" };

/**
 * @typedef {{ renderer: string, issue: number, source: string, output: string, view: string, width?: number }} KnownDifference
 * @typedef {{ source: string, output: string, view: string, width?: number, name?: string }} Difference
 */
/** @type {KnownDifference[]} */
export const knownDifferences = known;

/** Retained known inputs are replayed during discovery even when its new seed changes. */
export function knownSources(renderer) {
  return [
    ...new Set(
      knownDifferences.filter((entry) => entry.renderer === renderer).map((entry) => entry.source),
    ),
  ];
}

/**
 * Realistic gates never accept known differences. Discovery keeps exact source/output/view
 * pairs and fails on stale entries, so a fixed case cannot remain silently listed.
 * @param {string} renderer
 * @param {string} profile
 * @param {Difference[]} differences
 * @param {KnownDifference[]} [catalog]
 */
export function classifyDifferences(renderer, profile, differences, catalog = knownDifferences) {
  const entries =
    profile === "adversarial" ? catalog.filter((entry) => entry.renderer === renderer) : [];
  const matches = (entry, difference) =>
    entry.source === difference.source &&
    entry.output === difference.output &&
    entry.view === difference.view &&
    entry.width === difference.width;
  return {
    unexpected: differences.filter(
      (difference) => !entries.some((entry) => matches(entry, difference)),
    ),
    known: differences.filter((difference) => entries.some((entry) => matches(entry, difference))),
    stale: entries.filter((entry) => !differences.some((difference) => matches(entry, difference))),
  };
}
