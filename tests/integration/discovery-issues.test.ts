import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  discoveryIssue,
  existingDiscovery,
  publishDiscovery,
  prepareDiscovery,
  shouldReport,
} from "../../scripts/discovery-issue.mjs";
import { repository } from "../support/cli.js";

const run = {
  name: "Rendering",
  event: "schedule",
  conclusion: "failure",
  id: 123,
  run_attempt: 1,
  html_url: "https://github.com/example/repo/actions/runs/123",
  head_sha: "abc",
};
const report = {
  profile: "adversarial",
  seeds: [42],
  count: 100,
  compared: 200,
  unexpected: [{ name: "generated-42-3", view: "gfm", width: 80 }],
  known: [],
  stale: [],
};
const issue = () => discoveryIssue(run, report)!;

describe("discovery reporting offline", () => {
  it.each(["Rendering", "Obsidian", "Forges"])(
    "reports %s scheduled failure with evidence",
    (name) => {
      const result = discoveryIssue({ ...run, name }, report)!;
      expect(result.labels).toEqual(["Type: Maintenance"]);
      for (const text of [
        name,
        run.html_url,
        "abc",
        "adversarial",
        "42",
        "compared: 200",
        "count: 100",
        "unexpected: 1",
        "known: 0",
        "stale: 0",
        "generated-42-3",
        "gfm",
        "80",
        "not a confirmed defect",
      ])
        expect(result.body).toContain(text);
    },
  );
  it.each([
    { event: "pull_request" },
    { event: "workflow_dispatch" },
    { event: "push" },
    { conclusion: "success" },
    { conclusion: "cancelled" },
    { name: "Release" },
  ])("does not report %j", (changed) => {
    expect(shouldReport({ ...run, ...changed })).toBe(false);
    expect(discoveryIssue({ ...run, ...changed }, report)).toBeUndefined();
  });
  it("reports missing evidence without inventing a seed or a difference", () => {
    const result = discoveryIssue(run, undefined, "No report")!;
    expect(result.body).toContain("No report");
    expect(result.body).toContain('seeds: "unavailable"');
    expect(result.body).toContain("No differing document names");
    expect(result.body).toContain(run.html_url);
  });
  it.each(["{", "null", '{"unexpected":[null]}', "{}"])(
    "retains malformed report failure %s",
    (text) => {
      const result = prepareDiscovery(run, text)!;
      expect(result.body).toContain("Report unavailable or unreadable");
      expect(result.body).toContain(run.html_url);
    },
  );
  it("escapes document markup and mentions", () => {
    const result = discoveryIssue(run, { ...report, unexpected: [{ name: "<script>@owner`" }] })!;
    expect(result.body).toContain("&lt;script&gt;&#64;owner&#96;");
    expect(result.body).not.toContain("<script>");
  });
  it.each(["open", "closed"])("suppresses a rerun when the original issue is %s", (state) => {
    const original = { state, body: issue().body, html_url: "original" };
    const gh = vi.fn(() => [[original]]);
    expect(
      publishDiscovery("example/repo", discoveryIssue({ ...run, run_attempt: 2 }, report)!, gh),
    ).toBe("original");
    expect(gh).toHaveBeenCalledExactlyOnceWith([
      "api",
      "--paginate",
      "--slurp",
      "repos/example/repo/issues?state=all&per_page=100",
    ]);
  });
  it("ignores PR markers and other runs, then posts the prepared issue only", () => {
    expect(
      existingDiscovery(
        [
          { body: issue().marker, pull_request: {} },
          { body: "<!-- mdrefine-discovery-run:1234 -->" },
        ],
        issue().marker,
      ),
    ).toBeUndefined();
    const gh = vi.fn().mockReturnValueOnce([[]]).mockReturnValueOnce({ html_url: "created" });
    expect(publishDiscovery("example/repo", issue(), gh)).toBe("created");
    expect(gh.mock.calls[1]).toEqual([
      ["api", "--method", "POST", "repos/example/repo/issues", "--input", "-"],
      JSON.stringify({ title: issue().title, body: issue().body, labels: issue().labels }),
    ]);
  });
  it("fails closed when listing fails", () => {
    const gh = vi.fn(() => {
      throw new Error("offline");
    });
    expect(() => {
      publishDiscovery("example/repo", issue(), gh);
    }).toThrow("offline");
    expect(gh).toHaveBeenCalledTimes(1);
  });
});

type Step = {
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Workflow = {
  on: unknown;
  permissions: object;
  concurrency?: object;
  jobs: Record<string, { if?: string; permissions?: object; steps: Step[] }>;
};
const workflow = (name: string) =>
  parse(readFileSync(path.join(repository, `.github/workflows/${name}.yml`), "utf8")) as Workflow;
describe("discovery workflow trust boundary", () => {
  it("only reports failed scheduled source runs, serializes by run ID and uses least privilege", () => {
    const value = workflow("discovery-issues");
    expect(value.on).toEqual({
      workflow_run: { workflows: ["Rendering", "Obsidian", "Forges"], types: ["completed"] },
    });
    expect(value.permissions).toEqual({});
    expect(value.concurrency).toEqual({
      group: "discovery-issue-${{ github.event.workflow_run.id }}",
      "cancel-in-progress": false,
    });
    const job = value.jobs.report!;
    expect(job.if).toBe(
      "${{ github.event.workflow_run.event == 'schedule' && github.event.workflow_run.conclusion == 'failure' }}",
    );
    expect(job.permissions).toEqual({ contents: "read", actions: "read", issues: "write" });
    expect(job.steps[0]!.with).toEqual({
      "persist-credentials": false,
      "sparse-checkout": "scripts/discovery-issue.mjs",
      "sparse-checkout-cone-mode": false,
    });
    expect(job.steps.flatMap((s) => (s.run ? [s.run] : []))).toEqual([
      "node scripts/discovery-issue.mjs prepare",
      "node scripts/discovery-issue.mjs publish",
    ]);
    expect(job.steps.filter((s) => s.env?.GH_TOKEN).map((s) => s.run)).toEqual([
      "node scripts/discovery-issue.mjs publish",
    ]);
    for (const step of job.steps)
      if (step.uses) expect(step.uses).toMatch(/^actions\/[a-z-]+@[a-f0-9]{40}$/);
  });
  it.each(["rendering", "obsidian", "forges"])("keeps %s read only with 90-day reports", (host) => {
    const value = workflow(host);
    expect(value.permissions).toEqual({ contents: "read" });
    expect(Object.keys(value.jobs)).toEqual(["compare"]);
    expect(value.jobs.compare!.permissions).toBeUndefined();
    const upload = value.jobs.compare!.steps.find((s) =>
      s.uses?.startsWith("actions/upload-artifact@"),
    );
    expect(upload?.with?.["retention-days"]).toBe(90);
  });
});
