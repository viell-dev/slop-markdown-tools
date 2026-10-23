import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, requiredChecks } from "../../scripts/release-evidence.mjs";
import { fixture, linkDirectory, repository } from "./support.js";

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
