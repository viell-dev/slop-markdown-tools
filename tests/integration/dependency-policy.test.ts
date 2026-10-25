import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { repository } from "../support/cli.js";

type Field = "dependencies" | "devDependencies";
type Update = "minor" | "patch" | "major";
type Group = {
  patterns?: string[];
  "exclude-patterns"?: string[];
  "dependency-type"?: "development" | "production";
  "update-types": Update[];
};
type Ignore = {
  "dependency-name": string;
  versions?: string[];
  "update-types"?: string[];
};
type Policy = {
  "package-ecosystem": string;
  directory: string;
  labels: string[];
  schedule: { interval: string };
  cooldown: { "default-days": number };
  ignore?: Ignore[];
  groups?: Record<string, Group>;
};
const read = (file: string) => readFileSync(path.join(repository, file), "utf8");
const { updates } = parse(read(".github/dependabot.yml")) as { updates: Policy[] };
const root = updates.find(
  (entry) => entry["package-ecosystem"] === "npm" && entry.directory === "/",
)!;
const obsidian = updates.find(
  (entry) => entry["package-ecosystem"] === "npm" && entry.directory === "/scripts/obsidian",
)!;
const manifest = JSON.parse(read("package.json")) as Record<Field, Record<string, string>>;

// Finite assertions of this configuration's documented wildcard/group rules, not a Dependabot
// resolver, service execution or evidence that a proposed upgrade installs or renders correctly.
const matches = (name: string, pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`).test(name);
const matchesGroup = (name: string, field: Field, update: Update, group: Group) =>
  (!group.patterns || group.patterns.some((pattern) => matches(name, pattern))) &&
  !group["exclude-patterns"]?.some((pattern) => matches(name, pattern)) &&
  (!group["dependency-type"] ||
    group["dependency-type"] === (field === "devDependencies" ? "development" : "production")) &&
  group["update-types"].includes(update);
const groupFor = (name: string, field: Field, update: Update, policy = root) =>
  Object.entries(policy.groups ?? {}).find(([, group]) =>
    matchesGroup(name, field, update, group),
  )?.[0];

describe("dependency update policy", () => {
  it("keeps weekly, seven-day version proposals and maintenance labels for every ecosystem", () => {
    expect(updates.map((entry) => [entry["package-ecosystem"], entry.directory])).toEqual([
      ["npm", "/"],
      ["npm", "/scripts/obsidian"],
      ["docker", "/scripts/obsidian"],
      ["github-actions", "/"],
    ]);
    for (const entry of updates) {
      expect(entry.schedule).toEqual({ interval: "weekly" });
      expect(entry.cooldown).toEqual({ "default-days": 7 });
      expect(entry.labels).toEqual(["Type: Maintenance"]);
    }
  });

  it("orders named compatibility units before the tooling fallback and separates major migrations", () => {
    expect(Object.keys(root.groups!)).toEqual(["parser", "vitepress", "references", "tools"]);
    for (const policy of [root, obsidian])
      for (const group of Object.values(policy.groups!))
        expect(group["update-types"]).toEqual(["minor", "patch"]);
    for (const [field, dependencies] of Object.entries(manifest).filter(([key]) =>
      ["dependencies", "devDependencies"].includes(key),
    ))
      for (const name of Object.keys(dependencies))
        expect(groupFor(name, field as Field, "major"), name).toBeUndefined();
  });

  it("keeps parser syntax, tree and public type inputs together across declaration fields", () => {
    const names = [
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.devDependencies),
    ].filter(
      (name) =>
        name.startsWith("micromark") ||
        /^mdast-util-(?:from-markdown|frontmatter|gfm(?:-|$)|math)/.test(name) ||
        ["@types/mdast", "@types/unist", "decode-named-character-reference"].includes(name),
    );
    expect(names).toContain("mdast-util-from-markdown");
    expect(names).toContain("micromark-extension-gfm");
    for (const name of names)
      for (const field of ["dependencies", "devDependencies"] as const) {
        expect(groupFor(name, field, "patch"), `${field}: ${name}`).toBe("parser");
        expect(matchesGroup(name, field, "patch", root.groups!.tools!)).toBe(false);
      }
    for (const name of [
      "micromark-extension-gfm",
      "micromark-extension-gfm-autolink-literal",
      "micromark-extension-gfm-footnote",
      "micromark-extension-gfm-strikethrough",
      "micromark-extension-cjk-friendly",
    ])
      expect(
        manifest.devDependencies,
        "bundled inputs retain their parser maintenance role",
      ).toHaveProperty(name);
    for (const name of ["@types/mdast", "mdast-util-from-markdown", "micromark-util-types"])
      expect(
        manifest.dependencies,
        "public declaration dependencies remain installed",
      ).toHaveProperty(name);
  });

  it.each([
    ["markdown-it", "dependencies", "vitepress"],
    ["@mdit/plugin-attrs", "dependencies", "vitepress"],
    ["@mdit-vue/plugin-component", "dependencies", "vitepress"],
    ["markdown-it-mathjax3", "devDependencies", "vitepress"],
    ["vitepress", "devDependencies", "vitepress"],
    ["commonmark", "devDependencies", "references"],
    ["@types/commonmark", "devDependencies", "references"],
    ["mdast-util-to-hast", "devDependencies", "references"],
    ["hast-util-to-html", "devDependencies", "references"],
    ["eslint", "devDependencies", "tools"],
    ["typescript-eslint", "devDependencies", "tools"],
    ["vitest", "devDependencies", "tools"],
    ["@vitest/coverage-v8", "devDependencies", "tools"],
  ] as const)("assigns routine %s from %s to %s", (name, field, group) => {
    expect(manifest[field]).toHaveProperty(name);
    for (const update of ["minor", "patch"] as const)
      expect(groupFor(name, field, update)).toBe(group);
    if (group !== "tools")
      expect(matchesGroup(name, field, "patch", root.groups!.tools!)).toBe(false);
  });

  it("isolates the bundler/compiler and does not silently batch unclassified production or tree inputs", () => {
    for (const name of ["rolldown", "typescript", "mdast-util-future"])
      for (const update of ["minor", "patch", "major"] as const)
        expect(groupFor(name, "devDependencies", update), name).toBeUndefined();
    expect(groupFor("future-tool", "devDependencies", "patch")).toBe("tools");
    expect(groupFor("future-runtime", "dependencies", "patch")).toBeUndefined();
    expect(groupFor("micromark-extension-future", "devDependencies", "patch")).toBe("parser");
  });

  it.each([
    ["markdown-it-mathjax3", ">=5.0.0 <6.0.0", "4.3.2", "5.2.0", "6.0.0"],
    ["markdown-it", ">=15.0.0 <16.0.0", "14.3.3", "15.0.3", "16.0.0"],
    ["@mdit/plugin-attrs", ">=1.3.0 <2.0.0", "1.2.0", "1.3.4", "2.0.0"],
    ["@mdit/plugin-container", ">=2.0.0 <3.0.0", "1.0.2", "2.0.3", "3.0.0"],
    ["@mdit/plugin-emoji", ">=1.2.0 <2.0.0", "1.1.1", "1.2.3", "2.0.0"],
    ["@mdit/plugin-footnote", ">=1.1.0 <2.0.0", "1.0.2", "1.1.3", "2.0.0"],
    ["@mdit/plugin-tasklist", ">=1.1.0 <2.0.0", "1.0.2", "1.1.4", "2.0.0"],
  ])(
    "retains %s's bounded deferral and leaves its compatible older line eligible",
    (name, range, older, blocked, future) => {
      const rules = root.ignore!.filter((entry) => matches(name, entry["dependency-name"]));
      expect(rules).toEqual([{ "dependency-name": name, versions: [range] }]);
      // Only this policy's finite stable >=lower <upper examples: not arbitrary SemVer,
      // prerelease handling, a resolver or a claim that the future major is compatible.
      const bounds = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(rules[0]!.versions![0]!)!;
      const inside = (version: string) =>
        version.localeCompare(bounds[1]!, "en", { numeric: true }) >= 0 &&
        version.localeCompare(bounds[2]!, "en", { numeric: true }) < 0;
      expect(inside(older)).toBe(false);
      expect(inside(blocked)).toBe(true);
      expect(inside(bounds[1]!)).toBe(true);
      expect(inside(future)).toBe(false);
      expect(manifest.dependencies[name] ?? manifest.devDependencies[name]).toBe(older);
    },
  );

  it("retains support-based TypeScript, minimum-Node and Obsidian major deferrals", () => {
    expect(root.ignore!.filter((entry) => entry["dependency-name"] === "typescript")).toEqual([
      { "dependency-name": "typescript", versions: ["7.x"] },
    ]);
    expect(root.ignore!.filter((entry) => entry["dependency-name"] === "@types/node")).toEqual([
      { "dependency-name": "@types/node", "update-types": ["version-update:semver-major"] },
    ]);
    expect(obsidian.ignore).toEqual([
      { "dependency-name": "webdriverio", "update-types": ["version-update:semver-major"] },
      { "dependency-name": "@wdio/*", "update-types": ["version-update:semver-major"] },
    ]);
    for (const name of ["webdriverio", "@wdio/cli", "wdio-obsidian-service", "obsidian"])
      expect(groupFor(name, "devDependencies", "minor", obsidian)).toBe("obsidian-check");
    const docker = updates.find((entry) => entry["package-ecosystem"] === "docker")!;
    expect(docker.ignore).toEqual([
      { "dependency-name": "node", "update-types": ["version-update:semver-major"] },
    ]);
    expect(root.ignore).toHaveLength(9);
  });
});
