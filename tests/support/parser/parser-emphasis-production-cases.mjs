import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

/** @typedef {import("../../../src/core/types.js").DialectName} EmphasisDialect */
/** @typedef {"core" | "text" | "strike" | "cjk"} EmphasisRegistration */
/** @typedef {"primary" | "generated" | "fileIdentity" | "yamlPlain" | "tomlOther" | "githubFile" | "githubPlainFile" | "eagerFrontMatter"} EmphasisCaseKind */
/** @typedef {{id: string, kind: EmphasisCaseKind, dialect: EmphasisDialect, source: string, expectHit: boolean, markers?: string[], plugin?: boolean}} EmphasisProductionCase */
/** @typedef {EmphasisProductionCase & {registration: EmphasisRegistration}} EmphasisRegistrationCase */

/** @param {unknown} value @returns {asserts value is EmphasisProductionCase} */
function assertEmphasisProductionCase(value) {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "Invalid production case",
  );
  assert("id" in value && typeof value.id === "string" && value.id.length > 0);
  assert("source" in value && typeof value.source === "string");
  assert("dialect" in value && profiles.some((profile) => profile === value.dialect));
  assert(
    "kind" in value &&
      [
        "primary",
        "generated",
        "fileIdentity",
        "yamlPlain",
        "tomlOther",
        "githubFile",
        "githubPlainFile",
        "eagerFrontMatter",
      ].some((kind) => kind === value.kind),
  );
  assert("expectHit" in value && typeof value.expectHit === "boolean");
  if ("markers" in value && value.markers !== undefined)
    assert(
      Array.isArray(value.markers) && value.markers.every((marker) => typeof marker === "string"),
    );
  if ("plugin" in value && value.plugin !== undefined) assert.equal(typeof value.plugin, "boolean");
}

/** @type {readonly EmphasisDialect[]} */
export const profiles = ["commonmark", "github", "forgejo", "gitea", "obsidian", "vitepress"];

/** @returns {Promise<EmphasisProductionCase[]>} */
export async function productionCases() {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../fixtures/parser-emphasis-reachability.json", import.meta.url),
      "utf8",
    ),
  );
  /** @type {EmphasisProductionCase[]} */
  const cases = [];
  const ids = new Set();
  /** @param {unknown} value */
  const add = (value) => {
    assertEmphasisProductionCase(value);
    assert(!ids.has(value.id), `Duplicate reachability case ${value.id}`);
    ids.add(value.id);
    cases.push(value);
  };
  const expand = (template, expected) => {
    // Expand the frozen manifest's four profiles to all six product profiles.
    // Forgejo/Gitea have the same applicable GFM table callback pipeline.
    const selected = template.profiles
      ? profiles.filter(
          (profile) =>
            template.profiles.includes(profile) ||
            (["forgejo", "gitea"].includes(profile) && template.profiles.includes("github")),
        )
      : profiles;
    const parameterized = template.source.includes("{run}") || template.source.includes("{endRun}");
    const markers = parameterized ? (template.markers ?? manifest.expansion.markers) : ["literal"];
    // All widths from the frozen manifest, including unequal/leftover cases.
    const widths = parameterized ? (template.widths ?? manifest.expansion.defaultWidths) : [[0, 0]];
    for (const dialect of selected)
      for (const marker of markers)
        for (const [left, right] of widths) {
          const source = template.source
            .replaceAll("{run}", marker.repeat(left))
            .replaceAll("{endRun}", marker.repeat(right));
          add({
            id: `${template.name}/${dialect}/${marker}/${left}-${right}`,
            kind: "primary",
            dialect,
            source,
            expectHit: template.expectHit ?? expected,
          });
        }
  };
  for (const template of manifest.requiredPositiveBoundaryTemplates) expand(template, true);
  for (const template of manifest.neighborTemplates) expand(template, template.expectHit);
  for (const [name, markers, expectHit] of [
    ["default", [], false],
    ["explicit-positive", ["mdrefineHomogeneousAttention"], true],
    ["negative-wins", ["mdrefineHomogeneousAttention", "mdrefineDeferredInline"], false],
  ])
    add({
      id: `generated/${name}`,
      kind: "generated",
      dialect: "commonmark",
      source: "****alpha****",
      markers,
      expectHit,
    });

  for (const dialect of profiles) {
    for (const marker of ["*", "_"]) {
      const run = marker.repeat(16);
      for (const eol of ["\n", "\r\n", "\r"]) {
        add({
          id: `BOM/${dialect}/${marker}/${JSON.stringify(eol)}`,
          kind: "primary",
          dialect,
          source: `\uFEFF${run}alpha${run}${eol}`,
          expectHit: true,
        });
      }
    }
    add({
      id: `plugin-original/${dialect}`,
      kind: "primary",
      dialect,
      source: "****alpha****",
      plugin: true,
      expectHit: false,
    });
    add({
      id: `file-identity/${dialect}`,
      kind: "fileIdentity",
      dialect,
      source: "****alpha****",
      expectHit: false,
    });
    for (const plugin of [false, true]) {
      add({
        id: `yaml-plain/${dialect}/plugin-${plugin}`,
        kind: "yamlPlain",
        dialect,
        plugin,
        source: "---\ntitle: demo\n---\n****alpha****\n",
        expectHit: !plugin && dialect !== "vitepress",
      });
      add({
        id: `toml-other/${dialect}/plugin-${plugin}`,
        kind: "tomlOther",
        dialect,
        plugin,
        source: "+++\ntitle='demo'\n+++\n****alpha****\n",
        expectHit: !plugin && dialect !== "vitepress",
      });
    }
  }
  for (const kind of ["githubFile", "githubPlainFile"])
    for (const plugin of [false, true]) {
      add({
        id: `${kind}/github/plugin-${plugin}`,
        kind,
        dialect: "github",
        plugin,
        source: "---\ntitle: demo\n---\n****alpha**** $x$\n",
        expectHit: !plugin,
      });
    }
  for (const dialect of ["github", "obsidian"])
    for (const plugin of [false, true]) {
      add({
        id: `eager-frontmatter/${dialect}/plugin-${plugin}`,
        kind: "eagerFrontMatter",
        dialect,
        plugin,
        source: "---\n```\n---\n****inside****\n```\n****outside****\n",
        expectHit: !plugin,
      });
    }
  const cjkSwitchCases = [];
  for (const enabled of [false, true]) {
    for (const [suffixName, suffix, expectHit] of [
      ["NUL", "\0", true],
      ["replacement", "\uFFFD", true],
      ["ASCII", "z", false],
    ])
      cjkSwitchCases.push({
        id: `cjk-underscore-flanking/${enabled}/${suffixName}`,
        kind: "primary",
        dialect: "vitepress",
        source: `____alpha____${suffix}`,
        expectHit,
        vitepress: { cjkFriendlyEmphasis: enabled },
      });
  }

  for (const entry of cjkSwitchCases) add(entry);
  assert(cases.length > 0);
  for (const entry of cases) assert.equal(typeof entry.expectHit, "boolean");
  return cases;
}

/** @returns {EmphasisRegistrationCase[]} */
export function registrationCases() {
  return [
    {
      id: "registration/core",
      registration: "core",
      kind: "primary",
      dialect: "commonmark",
      source: "****alpha****",
      expectHit: true,
    },
    {
      id: "registration/text",
      registration: "text",
      kind: "primary",
      dialect: "commonmark",
      source: "****alpha****",
      expectHit: true,
    },
    {
      id: "registration/strike",
      registration: "strike",
      kind: "primary",
      dialect: "github",
      source: "****alpha****",
      expectHit: true,
    },
    {
      id: "registration/cjk",
      registration: "cjk",
      kind: "primary",
      dialect: "vitepress",
      source: "****alpha****",
      expectHit: true,
    },
  ];
}
