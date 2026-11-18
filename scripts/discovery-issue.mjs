// Offline preparation; only publish invokes gh, and never reads generated documents.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const discoveryHosts = {
  Rendering: { artifact: "rendering", report: "github-rendering/report.json" },
  Obsidian: { artifact: "obsidian", report: "report.json" },
  Forges: { artifact: "forges", report: "report.json" },
};

export function shouldReport(run) {
  return (
    run.event === "schedule" &&
    run.conclusion === "failure" &&
    Object.hasOwn(discoveryHosts, run.name)
  );
}

// JSON string notation makes names unambiguous; HTML escaping prevents injected mentions/markup.
const literal = (value) =>
  JSON.stringify(value ?? "unavailable")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "&#64;")
    .replaceAll("`", "&#96;");

export function discoveryIssue(run, report, problem) {
  if (!shouldReport(run)) return undefined;
  const marker = `<!-- mdrefine-discovery-run:${run.id} -->`;
  const counts = ["compared", "count"].map((key) => `${key}: ${literal(report?.[key])}`);
  for (const key of ["unexpected", "known", "stale"])
    counts.push(`${key}: ${Array.isArray(report?.[key]) ? report[key].length : "unavailable"}`);
  const names = [
    ...new Set(
      (report?.unexpected ?? []).map((item) =>
        [item.renderer, item.name, item.view, item.width]
          .filter((value) => value !== undefined)
          .map(literal)
          .join(" / "),
      ),
    ),
  ];
  return {
    marker,
    title: `Discovery candidate: ${run.name} run ${run.id}`,
    labels: ["Type: Maintenance"],
    body: [
      "> [!NOTE]",
      "> Automated discovery report submitted on the owner's behalf by GitHub Actions; not reviewed by the owner.",
      "",
      marker,
      "",
      `Workflow: ${run.name}; [run and artifacts](${run.html_url}); attempt ${run.run_attempt}.`,
      `Commit: ${run.head_sha}.`,
      `Profile: ${literal(report?.profile)}; seeds: ${literal(report?.seeds)}.`,
      counts.join("; ") + ".",
      "",
      "This failed scheduled run is a candidate for investigation, not a confirmed defect.",
      "Read the log and report, then triage under CONTRIBUTING.md's Bounded renderer work.",
      "Link accepted defects or documented limits here; infrastructure failures also need a disposition.",
      "Discovery does not gate merges or releases.",
      "",
      problem
        ? `Report unavailable or unreadable: ${literal(problem)}. Read the run log; seed and counts may be unavailable.`
        : "Differing document / view / width names from the report:",
      ...names.map((name) => `- ${name}`),
      ...(!names.length
        ? [
            "No differing document names were available; this can be an infrastructure or incomplete run.",
          ]
        : []),
    ].join("\n"),
  };
}

/** Treat partial or malformed JSON as unavailable evidence, never as a clean run. */
export function prepareDiscovery(run, text) {
  try {
    const report = JSON.parse(text);
    if (
      !Array.isArray(report.unexpected) ||
      report.unexpected.some((item) => !item || typeof item !== "object")
    )
      throw new Error("Missing or malformed unexpected array");
    return discoveryIssue(run, report);
  } catch (error) {
    return discoveryIssue(run, undefined, error.message);
  }
}

export function existingDiscovery(issues, marker) {
  return issues.find((issue) => !issue.pull_request && issue.body?.includes(marker));
}

// REST listing includes open AND closed issues without search-index delay. Fail closed if it fails.
export function publishDiscovery(repository, issue, gh) {
  const issues = gh([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repository}/issues?state=all&per_page=100`,
  ]).flat();
  const existing = existingDiscovery(issues, issue.marker);
  if (existing) return existing.html_url;
  return gh(
    ["api", "--method", "POST", `repos/${repository}/issues`, "--input", "-"],
    JSON.stringify({ title: issue.title, body: issue.body, labels: issue.labels }),
  ).html_url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "prepare") {
    const run = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).workflow_run;
    let issue;
    try {
      issue = prepareDiscovery(
        run,
        readFileSync(`discovery/${discoveryHosts[run.name].report}`, "utf8"),
      );
    } catch (error) {
      issue = discoveryIssue(run, undefined, error.message);
    }
    writeFileSync("discovery-issue.json", JSON.stringify(issue));
  } else if (process.argv[2] === "publish") {
    const issue = JSON.parse(readFileSync("discovery-issue.json", "utf8"));
    const gh = (args, input) =>
      JSON.parse(
        execFileSync("gh", args, {
          input,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        }),
      );
    process.stdout.write(`${publishDiscovery(process.env.GITHUB_REPOSITORY, issue, gh)}\n`);
  } else throw new Error("Expected prepare or publish");
}
