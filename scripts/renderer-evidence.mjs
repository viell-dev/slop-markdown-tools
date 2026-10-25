// Native workload contracts. Plans come from fixture ownership, never completed loop output.
import assert from "node:assert/strict";
import { githubFixtures } from "./renderer-fixtures.mjs";
import { forgeFixtures, fileFixtures } from "./forge-fixtures.mjs";
import { fixtures as obsidianFixtures } from "./obsidian/fixtures.mjs";
import baseline from "./obsidian/baseline.json" with { type: "json" };
import { images, validateForgeEvidence } from "./forge-evidence.mjs";
import { knownSources } from "./renderer-differences.mjs";
import { fixedSeeds } from "./renderer-settings.mjs";

export const obsidianControls = [
  "retains rendered table content while a real cell editor owns focus (#550)",
  "retains heading boundaries while ignoring their optional blank separators (#544)",
  "retains inherited math typography across heading forms (#383, #569)",
  "normalizes styled Setext markers while retaining real heading content (#544)",
  "omits raw-source empty records while retaining visible paragraph splits (#545)",
  "normalizes styled fence separators while retaining code and info content (#533)",
  "checks invisible block-math margins against real Reading layout (#589)",
  "normalizes lone list paragraphs while retaining paragraph boundaries (#528)",
];
export const obsidianWidths = [80, 30];

/**
 * The intended workload, independently reconstructed by producers and consumers.
 * @returns {{ documents: { name: string, widths: number[], views: string[] }[], controls: string[] }}
 */
export function rendererPlan(renderer, { profile, seeds, count }) {
  assert(["github", "obsidian", "forges"].includes(renderer), "Unknown renderer");
  const documents = [],
    controls = [];
  const add = (host, fixtures, views, widths, prefix = "") => {
    const append = (name) => documents.push({ name: `${prefix}${name}`, widths, views });
    for (const fixture of fixtures) append(fixture.name);
    for (const seed of seeds)
      for (let index = 0; index < count; index++)
        append(host === "obsidian" ? `generated ${seed}/${index}` : `generated-${seed}-${index}`);
    if (profile === "adversarial")
      knownSources(host).forEach((_, index) =>
        append(host === "obsidian" ? `known ${index}` : `known-${index}`),
      );
  };
  if (renderer === "github") {
    add(
      "github",
      githubFixtures.map((item) => ({ name: `fixture-${item.name}` })),
      ["markdown", "gfm"],
      [80],
    );
    controls.push("markdown-text-difference", "gfm-text-difference");
  } else if (renderer === "obsidian") {
    add("obsidian", obsidianFixtures, ["livePreview", "reading"], obsidianWidths);
    controls.push(...obsidianControls);
  } else
    for (const image of images) {
      add(image.name, forgeFixtures, ["file-api"], [80], `${image.name}/`);
      for (const fixture of fileFixtures)
        documents.push({
          name: `${image.name}/repository-${fixture.name}`,
          widths: [80],
          views: ["repository-file"],
        });
      controls.push(
        ...["text-difference", "math-recognition", "repository-anchors"].map(
          (name) => `${image.name}/${name}`,
        ),
      );
    }
  assert.equal(
    new Set(documents.map((item) => item.name)).size,
    documents.length,
    "Duplicate planned document",
  );
  return { documents, controls };
}

/** Records survive a failed attempt; a completed formatting attempt may be unchanged. */
export function startDocument(report, name, width) {
  const record = { name, width, attempted: true, completed: false, changed: null, views: [] };
  report.documents.push(record);
  return record;
}

export function createRendererReport(renderer, settings) {
  return {
    schemaVersion: 1,
    renderer,
    profile: settings.profile,
    seeds: settings.seeds,
    count: settings.count,
    plan: rendererPlan(renderer, settings),
    documents: [],
    controls: [],
    compared: 0,
    unexpected: [],
    known: [],
    stale: [],
  };
}

/** Validate a complete run against the caller's intended settings, not the report's plan. */
export function validateRendererReport(report, settings, renderer) {
  assert.equal(report.renderer, renderer, "Report belongs to another native renderer");
  assert.equal(report.schemaVersion, 1, "Missing native report contract");
  for (const key of ["profile", "seeds", "count"]) assert.deepEqual(report[key], settings[key]);
  const expected = rendererPlan(report.renderer, settings);
  assert.deepEqual(report.plan, expected, "Native plan differs from intended workload");
  const keys = expected.documents.flatMap((item) =>
    item.widths.map((width) => JSON.stringify([item.name, width])),
  );
  assert(Array.isArray(report.documents), "Missing document records");
  assert.deepEqual(
    report.documents.map((item) => JSON.stringify([item.name, item.width])).sort(),
    keys.sort(),
    "Missing or duplicate native documents/widths",
  );
  let compared = 0;
  for (const record of report.documents) {
    const planned = expected.documents.find((item) => item.name === record.name);
    assert.equal(record.attempted, true);
    assert.equal(record.completed, true, `Incomplete document: ${record.name}`);
    assert.equal(typeof record.changed, "boolean");
    assert.deepEqual(
      record.views.map((view) => view.name).sort(),
      [...planned.views].sort(),
      "Missing or duplicate native views",
    );
    assert.equal(
      record.changed,
      record.views.some((view) => view.changed),
    );
    for (const view of record.views) {
      assert.equal(typeof view.changed, "boolean");
      assert(["compared", "unchanged"].includes(view.status));
      if (view.status === "unchanged") assert.equal(view.changed, false);
      if (view.name === "repository-file") assert.equal(view.status, "compared");
    }
    if (record.views.some((view) => view.status === "compared")) compared++;
  }
  assert.equal(report.compared, compared, "Comparison count disagrees with completed views");
  assert.deepEqual(
    report.controls.map((item) => item.name).sort(),
    [...expected.controls].sort(),
    "Missing or duplicate native controls",
  );
  for (const control of report.controls)
    assert.equal(control.passed, true, `Failed control: ${control.name}`);
  if (report.renderer === "github") {
    assert.deepEqual(report.identity, {
      service: "GitHub Markdown API",
      version: "externally-uncontrolled",
    });
  } else if (report.renderer === "obsidian") {
    const host = report.identity;
    for (const key of ["app", "installer", "electron", "chrome"])
      assert.match(host?.[key] ?? "", /^\d+\.\d+\.\d+(?:\.\d+)?$/, `Missing observed ${key}`);
    for (const key of ["app", "installer"]) {
      const requested = report.requested?.[key];
      assert(requested === "latest" || /^\d+\.\d+\.\d+$/.test(requested ?? ""));
      if (requested !== "latest")
        assert.equal(host[key], requested, `Observed ${key} differs from request`);
    }
    assert.equal(host.image?.declaredBase, baseline.baseImage);
    assert.match(host.image?.id ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.match(host.image?.platform ?? "", /^linux\/(?:amd64|arm64)$/);
    assert.deepEqual(report.widths, obsidianWidths);
  } else {
    validateForgeEvidence(report);
    for (const host of report.renderers) {
      const documents = report.documents.filter((item) => item.name.startsWith(`${host.name}/`));
      assert.equal(
        host.compared,
        documents.filter((item) => item.views.some((view) => view.status === "compared")).length,
      );
      assert.equal(
        host.fileViews,
        documents.filter((item) =>
          item.views.some((view) => view.name === "repository-file" && view.status === "compared"),
        ).length * 2,
      );
    }
  }
}

/** Release and PR gates use a canonical workload, independent of report-supplied sizes. */
export function validateRendererEvidence(report, renderer) {
  const settings = {
    profile: "realistic",
    seeds: fixedSeeds,
    count: renderer === "github" ? 25 : 10,
  };
  validateRendererReport(report, settings, renderer);
  assert(report.compared > 0, "No native documents compared");
  if (report.renderer === "obsidian") {
    assert.deepEqual(report.requested, { app: baseline.app, installer: baseline.installer });
    for (const key of ["electron", "chrome"]) assert.equal(report.identity[key], baseline[key]);
  }
  for (const key of ["unexpected", "known", "stale"])
    assert.deepEqual(report[key], [], `Native ${key} differences`);
}
