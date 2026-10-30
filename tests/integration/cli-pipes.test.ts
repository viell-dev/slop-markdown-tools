import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cli, fixture } from "../support/cli.js";

/**
 * Run the command with one of its output streams closed by the reader before the
 * command writes to it, as `mdrefine lint --json | head -c 100` closes it after a
 * few bytes, and collect the other stream.
 */
function closed(root: string, args: string[], stream: "stdout" | "stderr") {
  return new Promise<{ status: number | null; other: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let other = "";
    child[stream === "stdout" ? "stderr" : "stdout"]
      .setEncoding("utf8")
      .on("data", (text: string) => (other += text));
    child[stream].destroy();
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, other }));
  });
}

describe("output into a pipe that the reader closes early (#820)", () => {
  // Enough findings that the report is written after the reader is gone.
  const files = { "note.md": "A *note*.\n\n".repeat(2000) };
  it("drops the rest of the output without an error, keeping the exit code", async () => {
    const root = await fixture(files);
    // Warnings alone exit 0, and with --max-warnings 0 they exit 1.
    expect(await closed(root, ["lint", "--json"], "stdout")).toEqual({ status: 0, other: "" });
    expect(await closed(root, ["lint", "--json", "--max-warnings", "0"], "stdout")).toEqual({
      status: 1,
      other: "",
    });
    // Bare format exits 1 when a file would change; its summary is on stderr.
    const format = await closed(root, ["format"], "stdout");
    expect(format.status).toBe(1);
    expect(format.other).not.toContain("EPIPE");
    expect(await closed(root, ["rules"], "stdout")).toEqual({ status: 0, other: "" });
  });
  it("also when the reader of the text findings on stderr stops", async () => {
    const root = await fixture(files);
    expect(await closed(root, ["lint"], "stderr")).toEqual({ status: 0, other: "" });
    expect(await closed(root, ["lint", "--max-warnings", "0"], "stderr")).toEqual({
      status: 1,
      other: "",
    });
  });
});
