import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readEvidence } from "../../scripts/release-evidence.mjs";

const io = vi.hoisted(() => ({
  query: vi.fn<(command: string, args: string[], options: unknown) => string>(),
  sleep: vi.fn<(milliseconds: number) => Promise<void>>(),
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: io.query,
}));
vi.mock("node:timers/promises", () => ({ setTimeout: io.sleep }));

const commit = "a".repeat(40);
const repository = "example/project";
const name = "verify (ubuntu-latest, 24)";
const required = [{ name, app: 15368 }];
const producer = {
  id: 10,
  status: "completed",
  conclusion: "success",
  head_sha: commit,
  head_branch: "main",
  event: "push",
  path: ".github/workflows/ci.yml",
  check_suite_id: 100,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
};
const check = {
  id: 20,
  name,
  status: "completed",
  conclusion: "success",
  head_sha: commit,
  html_url: "https://github.com/runs/20",
  app: { id: 15368 },
  check_suite: { id: 100 },
};
const workflow = `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${commit}&per_page=100`;
const checks = `repos/${repository}/commits/${commit}/check-runs?filter=all&per_page=100`;
const payload = (endpoint: string) =>
  JSON.stringify(
    endpoint === workflow ? [{ workflow_runs: [producer] }] : [{ check_runs: [check] }],
  );
const failure = (stderr: string | Buffer) =>
  Object.assign(new Error("gh api failed"), { stderr, status: 1 });
let now = 0;

beforeEach(() => {
  now = 0;
  io.query.mockReset().mockImplementation((_command, args) => payload(args[3]!));
  io.sleep.mockReset().mockImplementation((milliseconds) => {
    now += milliseconds;
    return Promise.resolve();
  });
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

describe("release API recovery (#880)", () => {
  it("keeps the normal exact-commit paginated reads without a delay", async () => {
    expect((await readEvidence(repository, commit, required, 10000)).state).toBe("success");
    expect(io.query.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["gh", ["api", "--paginate", "--slurp", workflow]],
      ["gh", ["api", "--paginate", "--slurp", checks]],
    ]);
    expect(io.sleep).not.toHaveBeenCalled();
  });

  it.each([500, 502, 503, 504])("recovers an HTTP %i from either endpoint", async (status) => {
    for (const endpoint of [workflow, checks]) {
      let failed = false;
      io.query.mockClear().mockImplementation((_command, args) => {
        if (args[3] === endpoint && !failed) {
          failed = true;
          throw failure(`gh: Server unavailable (HTTP ${status})\n`);
        }
        return payload(args[3]!);
      });
      io.sleep.mockClear();
      expect((await readEvidence(repository, commit, required, 10000)).state).toBe("success");
      expect(io.sleep.mock.calls).toEqual([[1000]]);
      expect(io.query.mock.calls.filter((call) => call[1][3] === workflow)).toHaveLength(2);
    }
  });

  it.each([workflow, checks])(
    "fails after three snapshots when %s keeps failing",
    async (endpoint) => {
      const error = failure(Buffer.from("gh: HTTP 500\r\n"));
      io.query.mockImplementation((_command, args) => {
        if (args[3] === endpoint) throw error;
        return payload(args[3]!);
      });
      await expect(readEvidence(repository, commit, required, 10000)).rejects.toBe(error);
      expect(io.query.mock.calls.filter((call) => call[1][3] === endpoint)).toHaveLength(3);
      expect(io.sleep.mock.calls).toEqual([[1000], [2000]]);
    },
  );

  it.each([401, 403, 404, 429, 501])("does not retry HTTP %i", async (status) => {
    const error = failure(`gh: HTTP 500 in this message is not the status (HTTP ${status})\n`);
    io.query.mockImplementation(() => {
      throw error;
    });
    await expect(readEvidence(repository, commit, required, 10000)).rejects.toBe(error);
    expect(io.query).toHaveBeenCalledTimes(1);
    expect(io.sleep).not.toHaveBeenCalled();
  });

  it("does not infer a server status from an unknown transport failure", async () => {
    const error = Object.assign(new Error("HTTP 500"), { stdout: "gh: HTTP 500\n" });
    io.query.mockImplementation(() => {
      throw error;
    });
    await expect(readEvidence(repository, commit, required, 10000)).rejects.toBe(error);
    expect(io.query).toHaveBeenCalledTimes(1);
    expect(io.sleep).not.toHaveBeenCalled();
  });

  it.each([workflow, checks])("fails immediately on malformed JSON from %s", async (endpoint) => {
    io.query.mockImplementation((_command, args) =>
      args[3] === endpoint ? "{" : payload(args[3]!),
    );
    await expect(readEvidence(repository, commit, required, 10000)).rejects.toBeInstanceOf(
      SyntaxError,
    );
    expect(io.sleep).not.toHaveBeenCalled();
  });

  it("does not wait when the delay would consume the remaining deadline", async () => {
    const error = failure("gh: HTTP 500\n");
    io.query.mockImplementation(() => {
      throw error;
    });
    await expect(readEvidence(repository, commit, required, 1000)).rejects.toBe(error);
    expect(io.query).toHaveBeenCalledTimes(1);
    expect(io.sleep).not.toHaveBeenCalled();
  });

  it("rechecks the original deadline after a delayed timer", async () => {
    const error = failure("gh: HTTP 503\n");
    io.query.mockImplementation(() => {
      throw error;
    });
    io.sleep.mockImplementation(() => {
      now = 10000;
      return Promise.resolve();
    });
    await expect(readEvidence(repository, commit, required, 10000)).rejects.toBe(error);
    expect(io.query).toHaveBeenCalledTimes(1);
    expect(io.sleep.mock.calls).toEqual([[1000]]);
  });

  it("discards the old producer when checks fail and a newer producer starts", async () => {
    let workflowReads = 0;
    let failed = false;
    io.query.mockImplementation((_command, args) => {
      if (args[3] === workflow) {
        workflowReads++;
        return JSON.stringify([
          {
            workflow_runs:
              workflowReads === 1
                ? [producer]
                : [
                    producer,
                    {
                      ...producer,
                      id: 11,
                      status: "queued",
                      check_suite_id: 101,
                    },
                  ],
          },
        ]);
      }
      if (!failed) {
        failed = true;
        throw failure("gh: HTTP 502\n");
      }
      return payload(checks);
    });
    expect((await readEvidence(repository, commit, required, 10000)).state).toBe("pending");
    expect(workflowReads).toBe(2);
    expect(io.query).toHaveBeenCalledTimes(4);
  });

  it("returns actual CI failure after recovery without retrying it", async () => {
    let failed = false;
    io.query.mockImplementation((_command, args) => {
      if (!failed) {
        failed = true;
        throw failure("gh: HTTP 504\n");
      }
      return args[3] === workflow
        ? payload(workflow)
        : JSON.stringify([{ check_runs: [{ ...check, conclusion: "failure" }] }]);
    });
    expect((await readEvidence(repository, commit, required, 10000)).state).toBe("failure");
    expect(io.query).toHaveBeenCalledTimes(3);
    expect(io.sleep.mock.calls).toEqual([[1000]]);
  });
});
