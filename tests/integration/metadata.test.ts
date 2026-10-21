import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dialectAliases, dialects } from "../../src/index.js";
import { repository } from "./support.js";

// What the package, the README, the site, the issue forms, and the workflows say about the same
// facts. Live settings, such as GitHub's labels and About description, are compared by
// scripts/check-live.mjs instead, which needs the network.
const read = (file: string) => readFileSync(path.join(repository, file), "utf8");
const pkg = JSON.parse(read("package.json")) as {
  version: string;
  description: string;
  keywords: string[];
  engines: { node: string };
  devDependencies: Record<string, string>;
};
const workflows = readdirSync(path.join(repository, ".github/workflows")).map(
  (name) => `.github/workflows/${name}`,
);
/** How the documents name each dialect and alias. */
const names: Record<string, string> = {
  commonmark: "CommonMark",
  github: "GitHub",
  forgejo: "Forgejo",
  codeberg: "Codeberg",
  gitea: "Gitea",
  obsidian: "Obsidian",
  vitepress: "VitePress",
};
const everyDialect = [...dialects, ...Object.keys(dialectAliases)];
/** The options of the dropdown `id` in an issue form, as written. */
const dropdown = (file: string, id: string) => {
  const form = read(file);
  const start = form.indexOf(`id: ${id}\n`);
  expect(start, `${file} has no field ${id}`).toBeGreaterThan(-1);
  const options = /\n {6}options:\n((?: {8}- .*\n)+)/.exec(form.slice(start));
  expect(options, `${file}: ${id} has no options`).not.toBeNull();
  return options![1]!
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^ *- /, ""));
};

describe("supported dialects", () => {
  it("each have a name the documents use", () => {
    expect(Object.keys(names).sort()).toEqual([...everyDialect].sort());
  });
  it("are named in the README's opening, the package's description, and the site's", () => {
    const opening = read("README.md").split("\n\n")[1]!;
    const site = /\n {2}description:\n? *"([^"]+)"/.exec(read("docs/.vitepress/config.mts"));
    expect(site?.[1]).toBe(`${pkg.description}.`);
    for (const dialect of dialects) {
      expect(opening, "README.md").toContain(names[dialect]);
      expect(pkg.description, "package.json").toContain(names[dialect]);
    }
  });
  it("are package keywords, aliases included", () => {
    for (const dialect of everyDialect) expect(pkg.keywords).toContain(dialect);
  });
  it("can be chosen in the issue forms", () => {
    for (const [file, id] of [
      [".github/ISSUE_TEMPLATE/bug.yml", "dialect"],
      [".github/ISSUE_TEMPLATE/feature.yml", "dialects"],
    ] as const) {
      const options = dropdown(file, id).join("\n");
      for (const dialect of everyDialect) expect(options, file).toContain(names[dialect]);
    }
  });
});

describe("Node.js versions", () => {
  const lowest = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(pkg.engines.node);
  it("have an exact lower bound in engines", () => {
    expect(lowest, pkg.engines.node).not.toBeNull();
  });
  const [, major, minor] = lowest ?? [];
  const exact = lowest?.slice(1).join(".");
  it("give users the lowest supported version", () => {
    for (const file of ["README.md", "docs/quick-start.md"])
      expect(read(file).replaceAll("\n", " "), file).toContain(
        `needs Node.js ${major}.${minor} or newer`,
      );
  });
  it("test the lowest supported version in the CI job named for its major version", () => {
    expect(read(".github/workflows/ci.yml")).toMatch(
      new RegExp(`\\n {12}node: ${major}\\n {12}node-version: ${exact!.replaceAll(".", "\\.")}\\n`),
    );
    expect(pkg.devDependencies["@types/node"]!.split(".")[0]).toBe(major);
  });
  it("run every other workflow, and the Obsidian image, on the version in .nvmrc", () => {
    const development = read(".nvmrc").trim();
    expect(development).toMatch(/^\d+$/);
    for (const file of workflows)
      for (const [, value] of read(file).matchAll(/\bnode-version: (.+)/g))
        if (!value!.startsWith("${{") && file !== ".github/workflows/ci.yml")
          expect(value, file).toBe(development);
    expect(read(".github/workflows/ci.yml")).toMatch(
      new RegExp(`\\n {12}node: ${development}\\n {12}node-version: ${development}\\n`),
    );
    expect(read("scripts/obsidian/Dockerfile")).toMatch(
      new RegExp(`^FROM node:${development}-`, "m"),
    );
    expect(read("CONTRIBUTING.md")).toContain(`\`.nvmrc\` names ${development},`);
  });
});

describe("release workflow", () => {
  it("prepares the version in package.json by default", () => {
    const input = /\n {6}version:\n(?: {8}.*\n)*? {8}default: (.+)\n/.exec(
      read(".github/workflows/release.yml"),
    );
    expect(input?.[1]).toBe(pkg.version);
  });
  it("runs both renderer checks before it prepares the package", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain("uses: ./.github/workflows/rendering.yml\n");
    expect(release).toContain("uses: ./.github/workflows/obsidian.yml\n");
    expect(release).toContain("needs: [ci, rendering, obsidian]\n");
    // Fixed documents only, so that the result depends on the commit rather than a random seed.
    expect(release).toContain(
      "uses: ./.github/workflows/rendering.yml\n    with:\n      seed: none\n",
    );
    expect(release).toContain(
      'uses: ./.github/workflows/obsidian.yml\n    with:\n      count: "0"\n',
    );
  });
});

describe("renderer checks", () => {
  /** The pull_request paths of a workflow. */
  const paths = (file: string) => {
    const list = /\n {2}pull_request:\n {4}paths:\n((?: {6}- .*\n)+)/.exec(read(file));
    expect(list, file).not.toBeNull();
    return list![1]!
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(/^ *- /, ""));
  };
  /** Whether a path is one check's own file rather than a renderer-sensitive one. */
  const own = (file: string) =>
    /^(?:scripts\/github-rendering\.mjs|scripts\/obsidian.*|\.github\/workflows\/.*)$/.test(file);
  it("run for the same renderer-sensitive paths, apart from their own files", () => {
    const rendering = paths(".github/workflows/rendering.yml");
    const obsidian = paths(".github/workflows/obsidian.yml");
    expect(rendering.filter((file) => !own(file))).toEqual(obsidian.filter((file) => !own(file)));
    expect(rendering).toContain(".github/workflows/rendering.yml");
    expect(obsidian).toContain(".github/workflows/obsidian.yml");
  });
  it("can be called from the Release workflow", () => {
    for (const file of [".github/workflows/rendering.yml", ".github/workflows/obsidian.yml"])
      expect(read(file), file).toMatch(/\n {2}workflow_call:\n/);
  });
});

describe("labels", () => {
  const labels = JSON.parse(read(".github/labels.json")) as {
    name: string;
    color: string;
    description: string;
  }[];
  const defined = new Set(labels.map((label) => label.name));
  it("are defined once each, with a color and a description that GitHub accepts", () => {
    expect(defined.size).toBe(labels.length);
    for (const label of labels) {
      expect(label.color, label.name).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.length, label.name).toBeGreaterThan(0);
      expect(label.description.length, label.name).toBeLessThanOrEqual(100);
    }
  });
  it("include every label that the issue forms and Dependabot apply", () => {
    const files = [
      ...readdirSync(path.join(repository, ".github/ISSUE_TEMPLATE")).map(
        (name) => `.github/ISSUE_TEMPLATE/${name}`,
      ),
      ".github/dependabot.yml",
    ];
    let applied = 0;
    for (const file of files)
      for (const [, list] of read(file).matchAll(/^ *labels: \[(.*)\]$/gm))
        for (const [, name] of list!.matchAll(/"([^"]+)"/g)) {
          expect(defined, file).toContain(name);
          applied++;
        }
    expect(applied).toBeGreaterThan(0);
  });
  it("include every label that the maintenance documents name", () => {
    const pattern = /`((?:Type|Status|Needs): [^`]+|Good First Issue|Help Wanted)`/g;
    for (const file of [
      "AGENTS.md",
      "CONTRIBUTING.md",
      "RELEASING.md",
      ".github/pull_request_template.md",
    ])
      for (const [, name] of read(file).matchAll(pattern)) expect(defined, file).toContain(name);
  });
});
