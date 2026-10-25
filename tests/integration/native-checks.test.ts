import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyChanges,
  classifyPullRequest,
  hosts,
  validateNativeChecks,
} from "../../scripts/native-checks.mjs";
import { fixture, repository } from "../support/cli.js";

interface Package {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}
interface Snapshot {
  manifest: Package;
  lock: { lockfileVersion: number; packages: Record<string, Package> };
}
const original: Snapshot = {
  manifest: JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8")) as Package,
  lock: JSON.parse(
    readFileSync(path.join(repository, "package-lock.json"), "utf8"),
  ) as Snapshot["lock"],
};
const selected = (result: ReturnType<typeof classifyChanges>) =>
  hosts.filter((host) => result[host]);
const update = (name: string) => {
  const after = structuredClone(original);
  const field = Object.hasOwn(after.manifest.dependencies!, name)
    ? "dependencies"
    : "devDependencies";
  after.manifest[field]![name] = "99.0.0";
  after.lock.packages[""]![field]![name] = "99.0.0";
  after.lock.packages[`node_modules/${name}`]!.version = "99.0.0";
  return after;
};

describe("native input classification", () => {
  it.each(["prettier", "eslint", "@mdit/plugin-attrs", "vitepress", "markdown-it-mathjax3"])(
    "avoids native hosts for a %s-only update in the actual dependency graph",
    (name) => {
      expect(
        selected(classifyChanges(["package.json", "package-lock.json"], original, update(name))),
      ).toEqual([]);
    },
  );
  it.each(["rolldown", "typescript", "npm-run-all2", "micromark-extension-gfm", "entities"])(
    "retains native coverage for %s regardless of development/production labels",
    (name) => {
      expect(
        selected(classifyChanges(["package.json", "package-lock.json"], original, update(name))),
      ).toEqual(hosts);
    },
  );
  it("routes lockfile-only indirect updates by all roots that reach their actual location", () => {
    for (const [name, expected] of [
      ["entities", hosts],
      ["@xmldom/xmldom", []],
    ] as const) {
      const after = structuredClone(original);
      after.lock.packages[`node_modules/${name}`]!.version = "99.0.0";
      expect(selected(classifyChanges(["package-lock.json"], original, after)), name).toEqual(
        expected,
      );
    }
  });
  it("handles nested copies, shared peer dependencies and optional packages conservatively", () => {
    const before: Snapshot = {
      manifest: { dependencies: { prettier: "1", parser: "1" } },
      lock: {
        lockfileVersion: 3,
        packages: {
          "": { dependencies: { prettier: "1", parser: "1" } },
          "node_modules/prettier": { dependencies: { shared: "1", nested: "1" } },
          "node_modules/parser": {
            peerDependencies: { shared: "1" },
            optionalDependencies: { absent: "1" },
          },
          "node_modules/shared": { version: "1" },
          "node_modules/prettier/node_modules/nested": { version: "1" },
        },
      },
    };
    const nested = structuredClone(before);
    nested.lock.packages["node_modules/prettier/node_modules/nested"]!.version = "2";
    expect(selected(classifyChanges(["package-lock.json"], before, nested))).toEqual([]);
    const shared = structuredClone(before);
    shared.lock.packages["node_modules/shared"]!.version = "2";
    expect(selected(classifyChanges(["package-lock.json"], before, shared))).toEqual(hosts);
    const removed = structuredClone(before);
    delete removed.lock.packages["node_modules/shared"];
    expect(selected(classifyChanges(["package-lock.json"], before, removed))).toEqual(hosts);
  });
  it("selects all for unknown roots, entries, lock formats, links and missing comparisons", () => {
    const changes = [
      (after: Snapshot) => {
        after.manifest.dependencies!.unknown = "1";
      },
      (after: Snapshot) => {
        after.lock.packages["node_modules/unknown"] = { version: "1" };
      },
      (after: Snapshot) => {
        after.lock.lockfileVersion = 2;
      },
      (after: Snapshot) => {
        after.lock.packages["node_modules/prettier"]!.link = true;
      },
      (after: Snapshot) => {
        after.manifest.scripts = { build: "changed" };
      },
      (after: Snapshot) => {
        after.manifest.overrides = { shared: "2" };
      },
    ];
    for (const change of changes) {
      const after = update("prettier");
      change(after);
      expect(
        selected(classifyChanges(["package.json", "package-lock.json"], original, after)),
      ).toEqual(hosts);
    }
    expect(selected(classifyChanges(["package.json"]))).toEqual(hosts);
  });
  it.each([
    "src/core/engine.ts",
    "src/syntax/parse.ts",
    "src/syntax/vitepress/reader.ts",
    "src/syntax/vitepress/projection.ts",
    "src/syntax/vitepress/links.ts",
    "src/workspace/html.ts",
    "src/workspace/github-file-anchors.ts",
    "src/workspace/slug.ts",
    "scripts/build-parser.mjs",
    "scripts/parser-labels.mjs",
    "tests/fixtures/renderers/common.mjs",
    "tests/fixtures/renderers/forges.mjs",
    "tests/fixtures/renderers/obsidian.mjs",
    "tests/fixtures/renderers/obsidian-boundaries.mjs",
    "tests/fixtures/renderers/obsidian/508.txt",
    "scripts/rendering.mjs",
    "scripts/release-evidence.mjs",
    "scripts/native-checks.mjs",
    ".github/workflows/native.yml",
    "new/unknown-input.ts",
    ".nvmrc",
    "tsconfig.build.json",
    "tests/fixtures/renderers/obsidian-comment-setext-3693217873.md",
  ])("retains all hosts for shared, transitive or unclassified input %s", (file) => {
    expect(selected(classifyChanges([file]))).toEqual(hosts);
  });
  it("retains the Obsidian corpus's shared Markdown inputs", () => {
    const boundaries = readFileSync(
      path.join(repository, "tests/fixtures/renderers/obsidian-boundaries.mjs"),
      "utf8",
    );
    const inputs = [...boundaries.matchAll(/"\.\/(obsidian-[^"\n]+\.md)"/g)].map(
      (match) => `tests/fixtures/renderers/${match[1]!}`,
    );
    expect(inputs).toHaveLength(4);
    for (const input of inputs) expect(selected(classifyChanges([input]))).toContain("obsidian");
  });
  it.each([
    ["scripts/github-rendering.mjs", ["rendering"]],
    [".github/workflows/rendering.yml", ["rendering"]],
    ["scripts/obsidian/package-lock.json", ["obsidian"]],
    ["scripts/forge-html.mjs", ["forges"]],
    ["scripts/forge-evidence.mjs", ["forges"]],
    [".github/workflows/forges.yml", ["forges"]],
    ["docs/quick-start.md", []],
    ["tests/unit/inline-rules.test.ts", []],
  ])("selects applicable hosts for %s", (file, expected) => {
    expect(selected(classifyChanges([file]))).toEqual(expected);
  });
  it("unions host-specific changes and never waives an unknown path alongside an irrelevant one", () => {
    expect(
      selected(classifyChanges(["scripts/forge-html.mjs", "scripts/obsidian-check.mjs"])),
    ).toEqual(["obsidian", "forges"]);
    expect(selected(classifyChanges(["docs/index.md", "scripts/new-helper.mjs"]))).toEqual(hosts);
    expect(selected(classifyChanges([]))).toEqual(hosts);
  });
});

describe("complete Git comparisons", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
    }).trim();
  const commit = (cwd: string) => {
    git(cwd, "add", ".");
    git(
      cwd,
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=synthetic@example.invalid",
      "commit",
      "-qm",
      "Synthetic input",
    );
    return git(cwd, "rev-parse", "HEAD");
  };
  const setup = async () => {
    const cwd = await fixture({
      "package.json": JSON.stringify(original.manifest),
      "package-lock.json": JSON.stringify(original.lock),
      "src/workspace/html.ts": "// Synthetic semantic helper.\n",
    });
    git(cwd, "init", "-q", "-b", "main");
    return { cwd, base: { sha: commit(cwd) } };
  };
  it("includes removed/renamed relevant files even when their new name is irrelevant", async () => {
    const { cwd, base } = await setup();
    await mkdir(path.join(cwd, "docs"));
    await rename(path.join(cwd, "src/workspace/html.ts"), path.join(cwd, "docs/helper.md"));
    const head = { sha: commit(cwd) };
    expect(selected(classifyPullRequest({ pull_request: { base, head } }, cwd))).toEqual(hosts);
  });
  it("uses the unique merge base rather than including unrelated base-branch changes", async () => {
    const { cwd, base } = await setup();
    git(cwd, "switch", "-qc", "task");
    await writeFile(path.join(cwd, "README.md"), "Synthetic documentation.\n");
    const head = { sha: commit(cwd) };
    git(cwd, "switch", "-q", "main");
    await writeFile(path.join(cwd, "src/workspace/html.ts"), "// Unrelated base change.\n");
    base.sha = commit(cwd);
    expect(selected(classifyPullRequest({ pull_request: { base, head } }, cwd))).toEqual([]);
  });
  it("fails closed for missing history, unsafe revisions, empty diffs and malformed lock JSON", async () => {
    const { cwd, base } = await setup();
    expect(selected(classifyPullRequest({ pull_request: { base, head: base } }, cwd))).toEqual(
      hosts,
    );
    for (const invalid of ["--all", "f".repeat(40), "", undefined])
      expect(
        selected(classifyPullRequest({ pull_request: { base, head: { sha: invalid } } }, cwd)),
      ).toEqual(hosts);
    expect(selected(classifyPullRequest({}, cwd))).toEqual(hosts);
    await writeFile(path.join(cwd, "package-lock.json"), "not JSON\n");
    const head = { sha: commit(cwd) };
    expect(selected(classifyPullRequest({ pull_request: { base, head } }, cwd))).toEqual(hosts);
  });
});

describe("required native PR decision", () => {
  const needs = (selected: string) => ({
    classify: {
      result: "success",
      outputs: { rendering: selected, obsidian: selected, forges: selected },
    },
    rendering: { result: selected === "true" ? "success" : "skipped" },
    obsidian: { result: selected === "true" ? "success" : "skipped" },
    forges: { result: selected === "true" ? "success" : "skipped" },
  });
  it("accepts successful applicable calls and explicitly reports each inapplicable host", () => {
    expect(validateNativeChecks(needs("true"))).toEqual(hosts.map((host) => `${host}: passed`));
    expect(validateNativeChecks(needs("false"))).toEqual(
      hosts.map((host) => `${host}: not applicable`),
    );
  });
  it("rejects missing/failed/skipped/cancelled applicable calls and any unknown result", () => {
    for (const host of hosts)
      for (const result of [
        undefined,
        "failure",
        "skipped",
        "cancelled",
        "timed_out",
        "neutral",
        "queued",
      ]) {
        expect(
          () => validateNativeChecks({ ...needs("true"), [host]: { result } }),
          `${host}: ${result}`,
        ).toThrow();
      }
    for (const result of ["failure", "skipped", "cancelled"]) {
      const input = needs("false");
      input.classify.result = result;
      expect(() => validateNativeChecks(input)).toThrow("classification did not succeed");
    }
    for (const selection of ["", "unknown", "TRUE", "null"])
      expect(() => validateNativeChecks(needs(selection))).toThrow("Unknown selection");
    expect(() => validateNativeChecks({ ...needs("false"), rendering: undefined })).toThrow();
    expect(() =>
      validateNativeChecks({ ...needs("false"), rendering: { result: "success" } }),
    ).toThrow();
    expect(() =>
      validateNativeChecks({ ...needs("false"), classify: { result: "success", outputs: {} } }),
    ).toThrow("Unknown selection");
    expect(() => validateNativeChecks({})).toThrow();
  });
});
