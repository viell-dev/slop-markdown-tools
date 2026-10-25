// Check that CI passed on the exact commit that a release is made from.
//
//   node scripts/release-evidence.mjs COMMIT
//
// The commit's check runs must include a successful run of every check that the ruleset for
// main requires (.github/rulesets/main.json), except the PR-only Native checks aggregate, from
// the app that the ruleset names, and of the
// CI workflow's unit coverage job. Built-in CI checks must belong to a push/main run of ci.yml
// in this repository; PR runs can test a synthetic merge tree instead of the named commit.
// A check that is queued or running is waited for, and so is a
// check that has not appeared yet, because the Release workflow is often dispatched right
// after a merge starts CI: for up to 40 minutes, the time CI's slowest job may take to start
// and finish, or for WAIT_MINUTES. A failed, cancelled, or skipped check fails at once. The Release workflow runs
// this before it prepares the package; it needs an authenticated gh (GH_TOKEN in GitHub
// Actions) with read access to checks and Actions runs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL, fileURLToPath } from "node:url";

/** Verify a deterministic native-renderer gate report, never discovery evidence. */
export function validateRendererEvidence(report) {
  if (
    report.profile !== "realistic" ||
    JSON.stringify(report.seeds) !== "[1,2,3,4,5]" ||
    !Number.isInteger(report.count) ||
    report.count <= 0 ||
    !Number.isInteger(report.compared) ||
    report.compared <= 0 ||
    !Array.isArray(report.unexpected) ||
    report.unexpected.length ||
    !Array.isArray(report.known) ||
    report.known.length ||
    !Array.isArray(report.stale) ||
    report.stale.length
  )
    throw new Error(
      "A release requires fixed-seed realistic renderer evidence with no differences",
    );
}

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
 * @property {string} head_sha
 * @property {{ id: number } | null} [check_suite]
 * @typedef {object} WorkflowRun The producer identity from GitHub's Actions API.
 * @property {number} id
 * @property {string} status
 * @property {string} head_sha
 * @property {string} head_branch
 * @property {string} event
 * @property {string} path
 * @property {number} check_suite_id
 * @property {{ full_name: string }} repository
 * @property {{ full_name: string }} head_repository
 */

/**
 * The checks a release needs: the ruleset's commit checks and unit coverage from CI.
 * Native checks is a PR-only aggregate; Release calls every native host afresh instead.
 * @param {{ rules: { type: string, parameters?: any }[] }} ruleset The ruleset for main.
 * @returns {Check[]}
 */
export function requiredChecks(ruleset) {
  const rule = ruleset.rules.find((entry) => entry.type === "required_status_checks");
  /** @type {Check[]} */
  const checks = (rule?.parameters?.required_status_checks ?? [])
    .filter((check) => !(check.context === "Native checks" && check.integration_id === 15368))
    .map((check) => ({
      name: check.context,
      app: check.integration_id,
    }));
  if (!checks.length) throw new Error("The ruleset for main requires no status checks");
  return [...checks, { name: "Unit coverage", app: 15368 }].filter(
    (check, index, all) =>
      all.findIndex((other) => other.name === check.name && other.app === check.app) === index,
  );
}

/**
 * The state of the required checks among a commit's check runs: "success" when each has a
 * successful run, "failure" when one has finished otherwise, and "pending" while one is missing,
 * queued, or running. With several runs of a check, as after a re-run, the newest one counts;
 * a run that has not started yet is the newest.
 * @param {CheckRun[]} checkRuns
 * @param {Check[]} required
 * @param {{ commit: string, repository: string, workflowRuns: WorkflowRun[] }} evidence
 * @returns {{ state: "success" | "pending" | "failure", lines: string[] }}
 */
export function evaluate(checkRuns, required, evidence) {
  // Do not use an older suite while a newer run is still starting, or the
  // previous attempt's checks while a rerun has not created its jobs yet.
  const producer = evidence.workflowRuns
    .filter(
      (run) =>
        run.head_sha === evidence.commit &&
        run.head_branch === "main" &&
        run.event === "push" &&
        run.path === ".github/workflows/ci.yml" &&
        run.repository?.full_name === evidence.repository &&
        run.head_repository?.full_name === evidence.repository &&
        Number.isSafeInteger(run.id) &&
        Number.isSafeInteger(run.check_suite_id),
    )
    .sort((a, b) => b.id - a.id)[0];
  /** When a run started; one that has not started yet sorts as the newest. */
  const started = (/** @type {CheckRun} */ run) =>
    run.started_at ? Date.parse(run.started_at) : Number.POSITIVE_INFINITY;
  /** @type {string[]} */
  const lines = [];
  /** @type {"success" | "pending" | "failure"} */
  let state = "success";
  for (const check of required) {
    const fromCI =
      check.app === 15368 && (check.name === "Unit coverage" || check.name.startsWith("verify ("));
    const runs = checkRuns
      .filter(
        (run) =>
          run.head_sha === evidence.commit &&
          run.name === check.name &&
          run.app?.id === check.app &&
          (!fromCI || run.check_suite?.id === producer?.check_suite_id),
      )
      .sort((a, b) => started(b) - started(a) || b.id - a.id);
    const run = runs[0];
    if (fromCI && producer && producer.status !== "completed") {
      lines.push(`${check.name}: CI producer ${producer.status}`);
      if (state === "success") state = "pending";
    } else if (!run || (fromCI && !producer)) {
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

/** The CI producer records, independently bound to their workflow, event, repository and SHA. */
function ciWorkflowRuns(repository, commit) {
  const pages = execFileSync(
    "gh",
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${commit}&per_page=100`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(pages).flatMap((page) => page.workflow_runs);
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
    const workflowRuns = ciWorkflowRuns(repository, commit);
    const { state, lines } = evaluate(checkRuns(repository, commit), required, {
      commit,
      repository,
      workflowRuns,
    });
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
