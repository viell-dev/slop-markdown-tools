import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, requiredChecks } from "../../scripts/release-evidence.mjs";
import { repository } from "./support.js";

const read = (file: string) => readFileSync(path.join(repository, file), "utf8");
const required = requiredChecks(
  JSON.parse(read(".github/rulesets/main.json")) as Parameters<typeof requiredChecks>[0],
);
const actions = 15368;
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
});
const passing = () => required.map((check) => run(check.name, "completed", "success"));

describe("release evidence", () => {
  it("requires the ruleset's checks and unit coverage, which CI's jobs produce", () => {
    expect(required.map((check) => check.name)).toEqual([
      "verify (ubuntu-latest, 22)",
      "verify (ubuntu-latest, 24)",
      "verify (windows-latest, 24)",
      "Unit coverage",
    ]);
    for (const check of required) expect(check.app).toBe(actions);
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("name: verify (${{ matrix.os }}, ${{ matrix.node }})");
    expect(ci).toContain("    name: Unit coverage\n");
  });
  it("passes when every required check succeeded", () => {
    expect(evaluate(passing(), required).state).toBe("success");
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
  it("ignores a check of the same name from another app", () => {
    const runs = passing().slice(1);
    runs.push({ ...run(required[0]!.name, "completed", "success"), app: { id: 1 } });
    expect(evaluate(runs, required).state).toBe("pending");
  });
});
