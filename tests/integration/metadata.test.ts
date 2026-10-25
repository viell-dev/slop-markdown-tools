import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml, stringify } from "yaml";
import { dialectAliases, dialects } from "../../src/index.js";
import { repository } from "../support/cli.js";

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
type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
  "working-directory"?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = {
  name?: string;
  needs?: string[] | string;
  if?: string;
  uses?: string;
  "runs-on"?: string;
  permissions?: Record<string, string>;
  with?: Record<string, unknown>;
  strategy?: {
    matrix: { include: { os: string; node: number | string; "node-version": number | string }[] };
  };
  steps?: Step[];
};
type Workflow = {
  on: Record<string, { inputs?: Record<string, { default?: unknown }> } | null>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};
const workflow = (file: string) => parseYaml(read(file)) as Workflow;
// Keep every other field: failure handling and execution context are part of the contract.
const commandSteps = (steps: Step[]) =>
  steps.map((step) => ({ ...step, run: step.run?.trimEnd() }));
const verifyCommands = (ci: Workflow) => {
  const commands = commandSteps(ci.jobs.verify!.steps!);
  expect(commands).toContainEqual({
    if: "runner.os == 'Linux' && matrix.node == 24",
    run: "npm run check:ci",
  });
  expect(commands).toContainEqual({
    if: "runner.os != 'Linux' || matrix.node != 24",
    run: "npm run test:ci",
  });
};
const releaseHosts = (release: Workflow) => {
  expect(release.jobs.prepare!.needs).toEqual(
    expect.arrayContaining(["ci", "rendering", "obsidian", "forges"]),
  );
  for (const host of ["rendering", "obsidian", "forges"]) {
    expect(release.jobs[host]!.uses).toBe(`./.github/workflows/${host}.yml`);
    expect(release.jobs[host]!.with).toEqual({ profile: "realistic", seed: "none" });
  }
};
const coverageJob = (ci: Workflow) => {
  const coverage = ci.jobs.coverage!;
  expect(coverage.name).toBe("Unit coverage");
  expect(coverage["runs-on"]).toBe("ubuntu-latest");
  expect(
    String(
      coverage.steps!.find((step) => step.uses?.startsWith("actions/setup-node@"))?.with?.[
        "node-version"
      ],
    ),
  ).toBe("24");
  expect(commandSteps(coverage.steps!)).toContainEqual({ run: "npm run test:coverage" });
};
/** The options of the dropdown `id` in an issue form, as written. */
const dropdown = (file: string, id: string) => {
  const form = parseYaml(read(file)) as {
    body: { id?: string; attributes?: { options?: string[] } }[];
  };
  const options = form.body.find((field) => field.id === id)?.attributes?.options;
  expect(options, `${file}: ${id} has no options`).toBeDefined();
  return options!;
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
    expect(
      workflow(".github/workflows/ci.yml").jobs.verify!.strategy!.matrix.include.map((entry) => ({
        os: entry.os,
        node: String(entry.node),
        "node-version": String(entry["node-version"]),
      })),
    ).toContainEqual({
      os: "ubuntu-latest",
      node: major,
      "node-version": exact,
    });
    expect(pkg.devDependencies["@types/node"]!.split(".")[0]).toBe(major);
  });
  it("run every other workflow, and the Obsidian image, on the version in .nvmrc", () => {
    const development = read(".nvmrc").trim();
    expect(development).toMatch(/^\d+$/);
    for (const file of workflows.filter((file) => file !== ".github/workflows/ci.yml"))
      for (const job of Object.values(workflow(file).jobs))
        for (const step of job.steps ?? [])
          if (step.uses?.startsWith("actions/setup-node@"))
            expect(String(step.with?.["node-version"]), file).toBe(development);
    expect(
      workflow(".github/workflows/ci.yml").jobs.verify!.strategy!.matrix.include.map((entry) => ({
        os: entry.os,
        node: String(entry.node),
        "node-version": String(entry["node-version"]),
      })),
    ).toContainEqual({
      os: "ubuntu-latest",
      node: development,
      "node-version": development,
    });
    expect(read("scripts/obsidian/Dockerfile")).toMatch(
      new RegExp(`^FROM node:${development}\\.\\d+\\.\\d+-.*@sha256:[0-9a-f]{64}$`, "m"),
    );
    expect(read("CONTRIBUTING.md")).toContain(`\`.nvmrc\` names ${development},`);
  });
});

describe("release workflow", () => {
  it("reuses gated CI while freshly packing and testing the release artifact", () => {
    const release = workflow(".github/workflows/release.yml");
    expect(release.jobs.ci!.permissions).toEqual({
      actions: "read",
      checks: "read",
      contents: "read",
    });
    expect(release.jobs.prepare!.needs).toContain("ci");
    expect(release.jobs.prepare!.steps!.map((step) => step.run?.trimEnd())).toContain(
      "npm run release:pack",
    );
    expect(release.jobs.prepare!.steps!.map((step) => step.run?.trimEnd())).not.toContain(
      "npm run release:prepare",
    );
    expect(pkg.scripts["release:prepare"]).toBe(
      "node scripts/with-build.mjs check:built release:pack:built",
    );
    expect(pkg.scripts["release:pack"]).toBe("node scripts/with-build.mjs release:pack:built");
  });
  it("prepares the version in package.json by default", () => {
    expect(
      workflow(".github/workflows/release.yml").on.workflow_dispatch?.inputs?.version?.default,
    ).toBe(pkg.version);
  });
  it("runs every renderer check before it prepares the package", () => {
    releaseHosts(workflow(".github/workflows/release.yml"));
  });
});

describe("CI evidence ownership", () => {
  it("runs Linux 24 units once with coverage, isolated from performance and integration", () => {
    const ci = workflow(".github/workflows/ci.yml");
    coverageJob(ci);
    expect(pkg.scripts["test:coverage"]).toBe("vitest run --project unit --coverage");
    expect(pkg.scripts["check:ci"]).toBe(
      "node scripts/with-build.mjs check:static test:nonunit test:package:installed",
    );
    expect(pkg.scripts["test:nonunit"]).toBe(
      "vitest run --project performance --project integration",
    );
    expect(pkg.scripts["test:ci"]).toBe("node scripts/with-build.mjs test test:package:installed");
    verifyCommands(ci);
    const ruleset = JSON.parse(read(".github/rulesets/main.json")) as {
      rules: { type: string; parameters?: { required_status_checks: unknown[] } }[];
    };
    expect(
      ruleset.rules.find((rule) => rule.type === "required_status_checks")!.parameters!
        .required_status_checks,
    ).toContainEqual({ context: "Unit coverage", integration_id: 15368 });
  });
});

describe("workflow structural regression controls", () => {
  it("accepts a quoted action version and a literal-block standalone command", () => {
    const ci = workflow(".github/workflows/ci.yml");
    const setup = ci.jobs.coverage!.steps!.find((step) =>
      step.uses?.startsWith("actions/setup-node@"),
    )!;
    // Real YAML input forms, applied to the current workflow rather than an unrelated sample.
    setup.with = { ...setup.with, ...(parseYaml('node-version: "24"') as Record<string, unknown>) };
    for (const [job, command] of [
      ["verify", "npm run check:ci"],
      ["verify", "npm run test:ci"],
      ["coverage", "npm run test:coverage"],
    ]) {
      const literal = parseYaml(`run: |\n  ${command}\n`) as Step;
      ci.jobs[job!]!.steps!.find((step) => step.run?.trimEnd() === command)!.run = literal.run!;
    }
    const reformatted = parseYaml(stringify(ci)) as Workflow;
    coverageJob(reformatted);
    verifyCommands(reformatted);
  });
  it("accepts comments, quoted scalars, alternate indentation and block dependency lists", () => {
    for (const [file, verify] of [
      ["release", releaseHosts],
      ["ci", coverageJob],
    ] as const) {
      const original = workflow(`.github/workflows/${file}.yml`);
      const reformatted = `# Presentation is not a workflow contract.\n${stringify(original, {
        indent: 4,
        defaultStringType: "QUOTE_DOUBLE",
      })}`;
      expect(reformatted).not.toBe(read(`.github/workflows/${file}.yml`));
      const parsed = parseYaml(reformatted) as Workflow;
      expect(parsed).toEqual(original);
      verify(parsed);
      if (file === "ci") verifyCommands(parsed);
    }
  });
  it.each([
    ["verify", "npm run check:ci"],
    ["verify", "npm run test:ci"],
    ["coverage", "npm run test:coverage"],
  ])("rejects failure swallowing or changed execution context for %s / %s", (job, command) => {
    for (const extra of [
      { "continue-on-error": true },
      { env: { NODE_OPTIONS: "--no-warnings" } },
      { "working-directory": "other" },
    ]) {
      const ci = workflow(".github/workflows/ci.yml");
      const step = ci.jobs[job]!.steps!.find((step) => step.run?.trimEnd() === command)!;
      Object.assign(step, extra);
      expect(() => (job === "coverage" ? coverageJob(ci) : verifyCommands(ci))).toThrow();
    }
  });
  it.each(["ci", "rendering", "obsidian", "forges"])(
    "rejects a missing release dependency on %s",
    (host) => {
      const release = workflow(".github/workflows/release.yml");
      release.jobs.prepare!.needs = (release.jobs.prepare!.needs as string[]).filter(
        (name) => name !== host,
      );
      expect(() => releaseHosts(release)).toThrow();
    },
  );
  it.each(["rendering", "obsidian", "forges"])("rejects a wrong %s workload or call", (host) => {
    for (const fault of ["uses", "profile", "seed"]) {
      const release = workflow(".github/workflows/release.yml");
      const job = release.jobs[host]!;
      if (fault === "uses") job.uses = "./.github/workflows/ci.yml";
      else job.with![fault] = "adversarial";
      expect(() => releaseHosts(release)).toThrow();
    }
  });
  it.each(["name", "runner", "node", "command"])("rejects incorrect coverage %s", (fault) => {
    const ci = workflow(".github/workflows/ci.yml");
    const job = ci.jobs.coverage!;
    if (fault === "name") job.name = "Other coverage";
    if (fault === "runner") job["runs-on"] = "windows-latest";
    if (fault === "node")
      job.steps!.find((step) => step.uses?.startsWith("actions/setup-node@"))!.with![
        "node-version"
      ] = 26;
    if (fault === "command")
      job.steps!.find((step) => step.run?.trimEnd() === "npm run test:coverage")!.run =
        "npm run test:unit";
    expect(() => coverageJob(ci)).toThrow();
  });
});

describe("renderer checks", () => {
  it("always reports a read-only PR aggregate and routes all hosts through one classification", () => {
    const native = workflow(".github/workflows/native.yml");
    expect(native.on).toEqual({ pull_request: null });
    expect(native.permissions).toEqual({ contents: "read" });
    expect(native.jobs.gate!.name).toBe("Native checks");
    expect(native.jobs.gate!.needs).toEqual(["classify", "rendering", "obsidian", "forges"]);
    expect(native.jobs.gate!.if).toBe("${{ always() }}");
    expect(native.jobs.gate!.steps?.at(-1)?.run?.trimEnd()).toBe(
      "node scripts/native-checks.mjs gate",
    );
    expect(native.jobs.classify!.steps?.at(-1)?.run?.trimEnd()).toBe(
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
      const native = workflow(file);
      const profiles = native.jobs
        .compare!.steps!.filter((step) => step.env?.PROFILE !== undefined)
        .map((step) => step.env!.PROFILE);
      expect(profiles).toEqual([
        "${{ github.event_name == 'schedule' && 'adversarial' || inputs.profile || 'realistic' }}",
      ]);
      expect(native.on.workflow_call?.inputs?.profile?.default).toBe("realistic");
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
