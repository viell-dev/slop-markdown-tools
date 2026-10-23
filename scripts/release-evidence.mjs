// Check that CI passed on the exact commit that a release is made from.
//
//   node scripts/release-evidence.mjs COMMIT
//
// The commit's check runs must include a successful run of every check that the ruleset for
// main requires (.github/rulesets/main.json), from the app that the ruleset names, and of the
// CI workflow's unit coverage job. A check that is queued or running is waited for, and so is a
// check that has not appeared yet, because the Release workflow is often dispatched right
// after a merge starts CI: for up to 40 minutes, the time CI's slowest job may take to start
// and finish, or for WAIT_MINUTES. A failed, cancelled, or skipped check fails at once. The Release workflow runs
// this before it prepares the package; it needs an authenticated gh (GH_TOKEN in GitHub
// Actions) with read access to checks.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL, fileURLToPath } from "node:url";

/**
 * @typedef {{ name: string, app: number }} Check A check by its name and the app that reports it.
 * @typedef {object} CheckRun A check run as GitHub's API describes it.
 * @property {number} id
 * @property {string} name
 * @property {string} status
 * @property {string | null} conclusion
 * @property {string | null} [started_at]
 * @property {string} html_url
 * @property {{ id: number } | null} [app]
 */

/**
 * The checks a release needs: the ruleset's required checks, and unit coverage from CI.
 * @param {{ rules: { type: string, parameters?: any }[] }} ruleset The ruleset for main.
 * @returns {Check[]}
 */
export function requiredChecks(ruleset) {
  const rule = ruleset.rules.find((entry) => entry.type === "required_status_checks");
  /** @type {Check[]} */
  const checks = (rule?.parameters?.required_status_checks ?? []).map((check) => ({
    name: check.context,
    app: check.integration_id,
  }));
  if (!checks.length) throw new Error("The ruleset for main requires no status checks");
  return [...checks, { name: "Unit coverage", app: checks[0].app }];
}

/**
 * The state of the required checks among a commit's check runs: "success" when each has a
 * successful run, "failure" when one has finished otherwise, and "pending" while one is missing,
 * queued, or running. With several runs of a check, as after a re-run, the newest one counts;
 * a run that has not started yet is the newest.
 * @param {CheckRun[]} checkRuns
 * @param {Check[]} required
 * @returns {{ state: "success" | "pending" | "failure", lines: string[] }}
 */
export function evaluate(checkRuns, required) {
  /** When a run started; one that has not started yet sorts as the newest. */
  const started = (/** @type {CheckRun} */ run) =>
    run.started_at ? Date.parse(run.started_at) : Number.POSITIVE_INFINITY;
  /** @type {string[]} */
  const lines = [];
  /** @type {"success" | "pending" | "failure"} */
  let state = "success";
  for (const check of required) {
    const runs = checkRuns
      .filter((run) => run.name === check.name && run.app?.id === check.app)
      .sort((a, b) => started(b) - started(a) || b.id - a.id);
    const run = runs[0];
    if (!run) {
      lines.push(`${check.name}: not started`);
      if (state === "success") state = "pending";
    } else if (run.status !== "completed") {
      lines.push(`${check.name}: ${run.status}`);
      if (state === "success") state = "pending";
    } else {
      lines.push(`${check.name}: ${run.conclusion} (${run.html_url})`);
      if (run.conclusion !== "success") state = "failure";
    }
  }
  return { state, lines };
}

/** Every check run of `commit`, through the GitHub API. */
function checkRuns(repository, commit) {
  const pages = execFileSync(
    "gh",
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/commits/${commit}/check-runs?filter=all&per_page=100`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(pages).flatMap((page) => page.check_runs);
}

async function main() {
  const commit = process.argv[2];
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) {
    process.stderr.write("Usage: node scripts/release-evidence.mjs COMMIT (a full SHA)\n");
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const repository = new URL(manifest.repository.url.replace(/^git\+/, "")).pathname
    .replace(/^\//, "")
    .replace(/\.git$/, "");
  const ruleset = JSON.parse(
    readFileSync(new URL("../.github/rulesets/main.json", import.meta.url), "utf8"),
  );
  const required = requiredChecks(ruleset);
  const minutes = Number(process.env.WAIT_MINUTES || 40);
  const deadline = Date.now() + minutes * 60 * 1000;
  for (;;) {
    const { state, lines } = evaluate(checkRuns(repository, commit), required);
    if (state === "success" || state === "failure" || Date.now() > deadline) {
      process.stdout.write(`CI of ${commit}:\n${lines.map((line) => `- ${line}`).join("\n")}\n`);
      if (state === "success") return;
      process.stderr.write(
        state === "failure"
          ? "A required check did not pass on this commit; nothing can be released from it.\n"
          : "The required checks did not finish in time; dispatch the release again later.\n",
      );
      process.exit(1);
    }
    process.stderr.write(`Waiting for CI of ${commit}: ${lines.join("; ")}\n`);
    await delay(30 * 1000);
  }
}

async function invokedAsMain() {
  if (!process.argv[1]) return false;
  const scriptPath = await realpath(fileURLToPath(import.meta.url));
  try {
    return (await realpath(process.argv[1])) === scriptPath;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

if (await invokedAsMain()) await main();
