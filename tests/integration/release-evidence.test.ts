import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { evaluate as evaluateChecks, requiredChecks } from "../../scripts/release-evidence.mjs";
import { fixture, linkDirectory, repository } from "../support/cli.js";

const read = (file: string) => readFileSync(path.join(repository, file), "utf8");
const required = requiredChecks(
  JSON.parse(read(".github/rulesets/main.json")) as Parameters<typeof requiredChecks>[0],
);
const actions = 15368;
const commit = "a".repeat(40);
const producer = {
  id: 10,
  status: "completed",
  conclusion: "success",
  head_sha: commit,
  head_branch: "main",
  event: "push",
  path: ".github/workflows/ci.yml",
  check_suite_id: 100,
  repository: { full_name: "example/project" },
  head_repository: { full_name: "example/project" },
};
const evidence = { commit, repository: "example/project", workflowRuns: [producer] };
const evaluate = (
  runs: Parameters<typeof evaluateChecks>[0],
  checks: Parameters<typeof evaluateChecks>[1],
  context: Parameters<typeof evaluateChecks>[2] = evidence,
) => evaluateChecks(runs, checks, context);
let id = 0;
/** A check run as GitHub's API describes it. */
const run = (name: string, status: string, conclusion: string | null, started = "2026-10-21") => ({
  id: ++id,
  name,
  status,
  conclusion,
  started_at: `${started}T00:00:00Z`,
  html_url: `https://github.com/runs/${id}`,
  app: { id: actions },
  head_sha: commit,
  check_suite: { id: producer.check_suite_id },
});
const passing = () => required.map((check) => run(check.name, "completed", "success"));
type CIWorkflow = {
  jobs: {
    verify: {
      name: string;
      strategy: {
        matrix: { include: { os: string; node: number | string; optional?: boolean }[] };
      };
    };
    coverage: { name: string };
  };
};
const verifyProducerIdentities = (ci: CIWorkflow) => {
  expect(ci.jobs.verify.name).toBe("verify (${{ matrix.os }}, ${{ matrix.node }})");
  expect(
    [
      ...ci.jobs.verify.strategy.matrix.include
        .filter((entry) => !entry.optional)
        .map(({ os, node }) => `verify (${os}, ${node})`),
      ci.jobs.coverage.name,
    ].sort(),
  ).toEqual(required.map((check) => check.name).sort());
};

describe("release evidence", () => {
  it("requires exact-commit core checks and coverage without the PR-only native aggregate", () => {
    expect(required.map((check) => check.name)).toEqual([
      "verify (ubuntu-latest, 22)",
      "verify (ubuntu-latest, 24)",
      "verify (windows-latest, 24)",
      "Unit coverage",
    ]);
    for (const check of required) expect(check.app).toBe(actions);
    verifyProducerIdentities(parse(read(".github/workflows/ci.yml")) as CIWorkflow);
    // Every current required CI identity must actually be bound to the producer,
    // not merely appear in the ruleset and workflow under the same name.
    for (const check of required) {
      const wrongSuite = passing();
      wrongSuite.find((run) => run.name === check.name)!.check_suite.id = 999;
      expect(evaluate(wrongSuite, required).state, check.name).toBe("pending");
    }
    const ruleset = JSON.parse(read(".github/rulesets/main.json")) as {
      rules: {
        type: string;
        parameters?: { required_status_checks: { context: string; integration_id: number }[] };
      }[];
    };
    expect(
      ruleset.rules.find((rule) => rule.type === "required_status_checks")!.parameters!
        .required_status_checks,
    ).toContainEqual({ context: "Native checks", integration_id: actions });
    expect(
      evaluate([...passing(), run("Native checks", "completed", "failure")], required).state,
    ).toBe("success");
  });
  it("allows matrix reordering without changing required producer identities", () => {
    const ci = parse(read(".github/workflows/ci.yml")) as CIWorkflow;
    ci.jobs.verify.strategy.matrix.include.reverse();
    verifyProducerIdentities(ci);
  });
  it("exempts exactly Native checks from Actions, retaining other names and apps", () => {
    const checks = [
      { context: "verify (ubuntu-latest, 24)", integration_id: actions },
      { context: "Native checks", integration_id: actions },
      { context: "Native checks", integration_id: 1 },
      { context: "Other required check", integration_id: actions },
    ];
    expect(
      requiredChecks({
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: checks,
            },
          },
        ],
      }),
    ).toEqual([
      { name: "verify (ubuntu-latest, 24)", app: actions },
      { name: "Native checks", app: 1 },
      { name: "Other required check", app: actions },
      { name: "Unit coverage", app: actions },
    ]);
    expect(() =>
      requiredChecks({
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [checks[1]],
            },
          },
        ],
      }),
    ).toThrow("no status checks");
  });
  it("passes when every required check succeeded", () => {
    expect(evaluate(passing(), required).state).toBe("success");
  });
  it("requires coverage once, from Actions even when another app owns the first rule", () => {
    expect(required.filter((check) => check.name === "Unit coverage")).toEqual([
      { name: "Unit coverage", app: actions },
    ]);
    expect(
      requiredChecks({
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: "External check", integration_id: 1 }],
            },
          },
        ],
      }),
    ).toEqual([
      { name: "External check", app: 1 },
      { name: "Unit coverage", app: actions },
    ]);
    for (const conclusion of ["failure", "skipped", "cancelled", "timed_out", "neutral"]) {
      const runs = passing();
      runs.find((entry) => entry.name === "Unit coverage")!.conclusion = conclusion;
      expect(evaluate(runs, required).state, conclusion).toBe("failure");
    }
    expect(
      evaluate(
        passing().filter((entry) => entry.name !== "Unit coverage"),
        required,
      ).state,
    ).toBe("pending");
  });
  it("rejects same-named checks from another commit or another CI producer", () => {
    const runs = passing();
    for (const change of [
      { head_sha: "b".repeat(40) },
      { check_suite: { id: 101 } },
      { check_suite: null },
    ])
      expect(evaluate([{ ...runs[0]!, ...change }, ...runs.slice(1)], required).state).toBe(
        "pending",
      );
    for (const change of [
      { head_sha: "b".repeat(40) },
      { event: "pull_request" },
      { event: "workflow_dispatch" },
      { event: "workflow_run" },
      { head_branch: "task-branch" },
      { path: ".github/workflows/other.yml" },
      { repository: { full_name: "other/project" } },
      { head_repository: { full_name: "fork/project" } },
      { check_suite_id: 101 },
    ])
      expect(
        evaluate(runs, required, {
          ...evidence,
          workflowRuns: [{ ...producer, ...change }],
        }).state,
      ).toBe("pending");
    expect(evaluate(runs, required, { ...evidence, workflowRuns: [] }).state).toBe("pending");
  });
  it("retains exact-commit third-party requirements without claiming they came from CI", () => {
    const checks = [{ name: "External check", app: 1 }];
    const external = {
      ...run("External check", "completed", "success"),
      app: { id: 1 },
      check_suite: { id: 999 },
    };
    const context = { ...evidence, workflowRuns: [] };
    expect(evaluate([external], checks, context).state).toBe("success");
    expect(evaluate([{ ...external, head_sha: "b".repeat(40) }], checks, context).state).toBe(
      "pending",
    );
    expect(evaluate([{ ...external, app: { id: actions } }], checks, context).state).toBe(
      "pending",
    );
    expect(evaluate([{ ...external, conclusion: "failure" }], checks, context).state).toBe(
      "failure",
    );
  });
  it("waits for a newer producer or attempt before its job checks appear", () => {
    for (const status of ["queued", "in_progress", "waiting", "pending"]) {
      const context = {
        ...evidence,
        workflowRuns: [
          producer,
          {
            ...producer,
            id: 11,
            check_suite_id: 101,
            status,
          },
        ],
      };
      expect(evaluate(passing(), required, context).state, status).toBe("pending");
      expect(
        evaluate(passing(), required, {
          ...evidence,
          workflowRuns: [{ ...producer, status }],
        }).state,
        `rerun ${status}`,
      ).toBe("pending");
    }
    const context = {
      ...evidence,
      workflowRuns: [
        {
          ...producer,
          id: 11,
          check_suite_id: 101,
        },
        producer,
      ],
    };
    expect(evaluate(passing(), required, context).state).toBe("pending");
    const fresh = passing().map((entry) => ({ ...entry, check_suite: { id: 101 } }));
    expect(evaluate(fresh, required, context).state).toBe("success");
    fresh[0]!.conclusion = "failure";
    expect(evaluate([...passing(), ...fresh], required, context).state).toBe("failure");
  });
  it("rejects a completed unsuccessful rerun even before replacement job checks appear", () => {
    for (const conclusion of ["failure", "cancelled", "skipped", "timed_out", "neutral", null]) {
      expect(
        evaluate(passing(), required, {
          ...evidence,
          workflowRuns: [{ ...producer, conclusion }],
        }).state,
        String(conclusion),
      ).toBe("failure");
    }
  });
  it("waits for a check that is missing, queued, or running", () => {
    const runs = passing();
    expect(evaluate(runs.slice(1), required).state).toBe("pending");
    runs[0] = run(required[0]!.name, "in_progress", null);
    expect(evaluate(runs, required).state).toBe("pending");
    expect(evaluate([], required).state).toBe("pending");
  });
  it("fails on any other conclusion, also while other checks still run", () => {
    for (const conclusion of ["failure", "cancelled", "skipped", "timed_out", "neutral"]) {
      const runs = passing();
      runs[1] = run(required[1]!.name, "completed", conclusion);
      runs[2] = run(required[2]!.name, "queued", null);
      expect(evaluate(runs, required).state, conclusion).toBe("failure");
    }
  });
  it("counts the newest run of a check that ran again", () => {
    const name = required[0]!.name;
    const rerun = [...passing(), run(name, "completed", "failure", "2026-10-20")];
    expect(evaluate(rerun, required).state).toBe("success");
    const failedAgain = [...passing(), run(name, "completed", "failure", "2026-10-22")];
    expect(evaluate(failedAgain, required).state).toBe("failure");
  });
  it("waits for a run that was queued again after a failure", () => {
    const name = required[0]!.name;
    const queued = { ...run(name, "queued", null), started_at: null };
    const runs = [...passing().slice(1), run(name, "completed", "failure"), queued];
    expect(evaluate(runs, required).state).toBe("pending");
  });
  it("refuses a ruleset that requires no checks rather than passing", () => {
    expect(() => requiredChecks({ rules: [{ type: "deletion" }] })).toThrow(/no status checks/);
    expect(() =>
      requiredChecks({
        rules: [{ type: "required_status_checks", parameters: { required_status_checks: [] } }],
      }),
    ).toThrow(/no status checks/);
  });
  it("ignores a check of the same name from another app", () => {
    const runs = passing().slice(1);
    runs.push({ ...run(required[0]!.name, "completed", "success"), app: { id: 1 } });
    expect(evaluate(runs, required).state).toBe("pending");
  });
});

async function copiedEvidenceScript() {
  const root = await fixture({
    "source/scripts/release-evidence.mjs": read("scripts/release-evidence.mjs"),
    "source/import-host.mjs": "// Synthetic existing import host.\n",
  });
  const source = path.join(root, "source");
  const linked = path.join(root, "linked");
  await linkDirectory(source, linked);
  return { root, source, linked };
}

describe("release-evidence command entry (#574)", { concurrent: false }, () => {
  it.each([
    ["normal absolute", false, false],
    ["linked absolute", true, false],
    ["normal relative", false, true],
    ["linked relative", true, true],
  ] as const)("rejects an invalid commit through %s", async (_name, useLink, relative) => {
    const { root, source, linked } = await copiedEvidenceScript();
    const checkout = useLink ? linked : source;
    const script = relative
      ? path.join("scripts", "release-evidence.mjs")
      : path.join(checkout, "scripts", "release-evidence.mjs");
    for (const args of [[], ["not-a-commit"]]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: relative ? checkout : root,
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.replaceAll("\r\n", "\n")).toBe(
        "Usage: node scripts/release-evidence.mjs COMMIT (a full SHA)\n",
      );
    }
  });

  it.each(["absent", "missing", "non-directory", "different existing"] as const)(
    "imports without running the CLI when the host argv path is %s",
    async (host) => {
      const { root, source, linked } = await copiedEvidenceScript();
      for (const checkout of [source, linked]) {
        const script = path.join(checkout, "scripts", "release-evidence.mjs");
        const hostPath =
          host === "different existing"
            ? path.join(checkout, "import-host.mjs")
            : host === "non-directory"
              ? path.join(checkout, "import-host.mjs", "child")
              : path.join(root, "missing-host.mjs");
        // Only the child process's argv changes. A nonexistent import host is
        // valid for eval/embedded callers; it must not suppress a normal import.
        const argv =
          host === "absent"
            ? "delete process.argv[1];"
            : `process.argv[1] = ${JSON.stringify(hostPath)};`;
        const code = `${argv}
process.argv[2] = "not-a-commit";
const module = await import(${JSON.stringify(pathToFileURL(script).href)});
process.stdout.write([typeof module.evaluate, typeof module.requiredChecks].join("|") + "\\n");`;
        const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
          cwd: root,
          encoding: "utf8",
          timeout: 5000,
          windowsHide: true,
        });
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("function|function\n");
        expect(result.stderr).toBe("");
      }
    },
  );
});
