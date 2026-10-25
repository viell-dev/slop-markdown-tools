import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
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
  scripts: Record<string, string>;
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
      new RegExp(`^FROM node:${development}\\.\\d+\\.\\d+-.*@sha256:[0-9a-f]{64}$`, "m"),
    );
    expect(read("CONTRIBUTING.md")).toContain(`\`.nvmrc\` names ${development},`);
  });
});

describe("release workflow", () => {
  it("reuses gated CI while freshly packing and testing the release artifact", () => {
    const release = parseYaml(read(".github/workflows/release.yml")) as {
      jobs: {
        ci: { permissions: Record<string, string> };
        prepare: { needs: string[]; steps: { run?: string }[] };
      };
    };
    expect(release.jobs.ci.permissions).toEqual({
      actions: "read",
      checks: "read",
      contents: "read",
    });
    expect(release.jobs.prepare.needs).toContain("ci");
    expect(release.jobs.prepare.steps.map((step) => step.run)).toContain("npm run release:pack");
    expect(release.jobs.prepare.steps.map((step) => step.run)).not.toContain(
      "npm run release:prepare",
    );
    expect(pkg.scripts["release:prepare"]).toBe(
      "node scripts/with-build.mjs check:built release:pack:built",
    );
    expect(pkg.scripts["release:pack"]).toBe("node scripts/with-build.mjs release:pack:built");
  });
  it("prepares the version in package.json by default", () => {
    const input = /\n {6}version:\n(?: {8}.*\n)*? {8}default: (.+)\n/.exec(
      read(".github/workflows/release.yml"),
    );
    expect(input?.[1]).toBe(pkg.version);
  });
  it("runs every renderer check before it prepares the package", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain("uses: ./.github/workflows/rendering.yml\n");
    expect(release).toContain("uses: ./.github/workflows/obsidian.yml\n");
    expect(release).toContain("needs: [ci, rendering, obsidian, forges]\n");
    expect(release).toContain(
      "uses: ./.github/workflows/forges.yml\n    with:\n      profile: realistic\n      seed: none\n",
    );
    // Fixed documents only, so that the result depends on the commit rather than a random seed.
    expect(release).toContain(
      "uses: ./.github/workflows/rendering.yml\n    with:\n      profile: realistic\n      seed: none\n",
    );
    expect(release).toContain(
      "uses: ./.github/workflows/obsidian.yml\n    with:\n      profile: realistic\n      seed: none\n",
    );
  });
});

describe("CI evidence ownership", () => {
  it("runs Linux 24 units once with coverage, isolated from performance and integration", () => {
    const ci = parseYaml(read(".github/workflows/ci.yml")) as {
      jobs: Record<
        string,
        { name: string; "runs-on": string; steps: { run?: string; if?: string }[] }
      >;
    };
    expect(ci.jobs.coverage!.name).toBe("Unit coverage");
    expect(ci.jobs.coverage!["runs-on"]).toBe("ubuntu-latest");
    expect(ci.jobs.coverage!.steps.map((step) => step.run)).toContain("npm run test:coverage");
    expect(pkg.scripts["test:coverage"]).toBe("vitest run --project unit --coverage");
    expect(pkg.scripts["check:ci"]).toBe(
      "node scripts/with-build.mjs check:static test:nonunit test:package:installed",
    );
    expect(pkg.scripts["test:nonunit"]).toBe(
      "vitest run --project performance --project integration",
    );
    expect(pkg.scripts["test:ci"]).toBe("node scripts/with-build.mjs test test:package:installed");
    expect(ci.jobs.verify!.steps).toContainEqual({
      if: "runner.os == 'Linux' && matrix.node == 24",
      run: "npm run check:ci",
    });
    expect(ci.jobs.verify!.steps).toContainEqual({
      if: "runner.os != 'Linux' || matrix.node != 24",
      run: "npm run test:ci",
    });
    const ruleset = JSON.parse(read(".github/rulesets/main.json")) as {
      rules: { type: string; parameters?: { required_status_checks: unknown[] } }[];
    };
    expect(
      ruleset.rules.find((rule) => rule.type === "required_status_checks")!.parameters!
        .required_status_checks,
    ).toContainEqual({ context: "Unit coverage", integration_id: 15368 });
  });
});

describe("renderer checks", () => {
  type Job = {
    name?: string;
    needs?: string[] | string;
    if?: string;
    uses?: string;
    with?: Record<string, unknown>;
    steps?: { uses?: string; run?: string; with?: Record<string, unknown> }[];
  };
  const workflow = (file: string) =>
    parseYaml(read(file)) as {
      on: Record<string, unknown>;
      permissions: Record<string, string>;
      jobs: Record<string, Job>;
    };
  it("always reports a read-only PR aggregate and routes all hosts through one classification", () => {
    const native = workflow(".github/workflows/native.yml");
    expect(native.on).toEqual({ pull_request: null });
    expect(native.permissions).toEqual({ contents: "read" });
    expect(native.jobs.gate!.name).toBe("Native checks");
    expect(native.jobs.gate!.needs).toEqual(["classify", "rendering", "obsidian", "forges"]);
    expect(native.jobs.gate!.if).toBe("${{ always() }}");
    expect(native.jobs.gate!.steps?.at(-1)?.run).toBe("node scripts/native-checks.mjs gate");
    expect(native.jobs.classify!.steps?.at(-1)?.run).toBe(
      "node scripts/native-checks.mjs classify",
    );
    expect(native.jobs.classify!.steps?.[0]?.with).toEqual({
      "fetch-depth": 0,
      "persist-credentials": false,
    });
    for (const host of ["rendering", "obsidian", "forges"]) {
      expect(native.jobs[host]!.needs).toBe("classify");
      expect(native.jobs[host]!.if).toBe(`\${{ needs.classify.outputs.${host} == 'true' }}`);
      expect(native.jobs[host]!.uses).toBe(`./.github/workflows/${host}.yml`);
      expect(native.jobs[host]!.with).toEqual({ profile: "realistic", seed: "none" });
    }
    for (const job of Object.values(native.jobs)) {
      expect(job).not.toHaveProperty("secrets");
      expect(job).not.toHaveProperty("permissions");
      for (const step of job.steps ?? [])
        if (step.uses?.startsWith("actions/checkout@"))
          expect(step.with?.["persist-credentials"]).toBe(false);
    }
  });
  it("keeps unique host jobs, schedules, manual inputs and read-only reusable release calls", () => {
    const names = new Set<string>();
    for (const host of ["rendering", "obsidian", "forges"]) {
      const native = workflow(`.github/workflows/${host}.yml`);
      expect(Object.keys(native.on).sort()).toEqual([
        "schedule",
        "workflow_call",
        "workflow_dispatch",
      ]);
      expect(native.permissions).toEqual({ contents: "read" });
      expect(Object.keys(native.jobs)).toEqual(["compare"]);
      expect(native.jobs.compare!.name).toBeTruthy();
      names.add(native.jobs.compare!.name!);
      const steps = native.jobs.compare!.steps!;
      expect(steps.some((step) => step.uses?.startsWith("actions/upload-artifact@"))).toBe(true);
      expect(steps.some((step) => step.run?.includes("validateRendererEvidence"))).toBe(true);
      expect(steps[0]!.with?.["persist-credentials"]).toBe(false);
    }
    expect(names.size).toBe(3);
  });
  it("uses fixed realistic gates and reserves adversarial sampling for discovery", () => {
    for (const file of [
      ".github/workflows/rendering.yml",
      ".github/workflows/obsidian.yml",
      ".github/workflows/forges.yml",
    ]) {
      const workflow = read(file);
      expect(workflow).toContain(
        "github.event_name == 'schedule' && 'adversarial' || inputs.profile || 'realistic'",
      );
      expect(workflow).toContain("default: realistic");
    }
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
