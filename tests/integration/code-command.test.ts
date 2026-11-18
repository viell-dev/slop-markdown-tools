import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { terminateTree, terminationWaitMs } from "../../src/code/terminate.js";
import { formatWithCode } from "../../src/node.js";
import { block, calls, setup } from "../support/code-format.js";
import { run } from "../support/cli.js";
import { parseReport } from "../support/json.js";

// Termination runs for real unless a test makes it slow or unconfirmed.
vi.mock("../../src/code/terminate.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/code/terminate.js")>();
  return { ...original, terminateTree: vi.fn(original.terminateTree) };
});
const actual = await vi.importActual<typeof import("../../src/code/terminate.js")>(
  "../../src/code/terminate.js",
);
const timedOut = (ms: number, outcome = "") =>
  `Code formatter "javascript" exceeded its ${ms} ms timeout${outcome}; this block was left unchanged.`;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(terminateTree).mockReset();
});

it("finds a local command before PATH and passes filename arguments literally", async () => {
  const { root, record, tool, config } = await setup();
  const local = path.join(root, "node_modules", ".bin");
  const other = path.join(root, "path-bin");
  await mkdir(local, { recursive: true });
  await mkdir(other);
  const windows = process.platform === "win32";
  const name = windows ? "probe-code.cmd" : "probe-code";
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const script = windows
    ? `@echo off\r\n"${process.execPath}" "${path.join(root, "adapter.mjs")}" %*\r\n`
    : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(root, "adapter.mjs"))} "$@"\n`;
  await writeFile(path.join(local, name), script);
  await writeFile(path.join(other, name), windows ? "@exit /b 88\r\n" : "#!/bin/sh\nexit 88\n");
  if (!windows) {
    await chmod(path.join(local, name), 0o755);
    await chmod(path.join(other, name), 0o755);
  }
  vi.stubEnv("PATH", `${other}${path.delimiter}${process.env.PATH ?? ""}`);
  const filename = "nested/Östra %PATH% & (x)! [a].md";
  const result = await formatWithCode(block(), {
    cwd: root,
    path: filename,
    config: config([tool({ command: "probe-code", args: ["constant", "{filepath}", record] })]),
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(block("formatted"));
  expect((await calls(record))[0]?.filepath).toBe(path.resolve(root, filename));
});

it("reports missing commands with exit 2 and still writes safe edits to both files", async () => {
  const { root, tool, config } = await setup();
  const configured = {
    ...config([
      tool({ command: path.join(root, "not-an-executable") }),
      tool({ id: "rust", languages: ["rs"] }),
    ]),
    extends: ["recommended"],
  };
  await writeFile(path.join(root, "mdrefine.config.json"), JSON.stringify(configured));
  await writeFile(path.join(root, "bad.md"), "A *word*.\n\n" + block());
  await writeFile(path.join(root, "good.md"), block("old", "rs"));
  const result = run(root, ["format", "--write", "--json", "bad.md", "good.md"]);
  expect(result.status).toBe(2);
  const report = parseReport(result.stdout);
  expect(report.files).toEqual([
    {
      path: "bad.md",
      changed: true,
      diagnostics: [expect.objectContaining({ rule: "engine/code-formatter", severity: "error" })],
    },
    { path: "good.md", changed: true, diagnostics: [] },
  ]);
  expect(await readFile(path.join(root, "bad.md"), "utf8")).toBe("A _word_.\n\n" + block());
  expect(await readFile(path.join(root, "good.md"), "utf8")).toBe(block("formatted", "rs"));
});

it("terminates the formatter's child process on a timeout", async () => {
  const { root, record, tool, config } = await setup("tree");
  const source = block();
  const result = await formatWithCode(source, {
    cwd: root,
    config: config([tool({ timeoutMs: 3000 })]),
  });
  expect(result.output).toBe(source);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({ rule: "engine/code-formatter", message: timedOut(3000) }),
  ]);
  const before = await readFile(record + ".heartbeat", "utf8");
  await setTimeout(250);
  expect(await readFile(record + ".heartbeat", "utf8")).toBe(before);
});

it("reports a timeout only after slow termination has finished", async () => {
  const { root, tool, config } = await setup("timeout");
  const events: string[] = [];
  vi.mocked(terminateTree).mockImplementationOnce(async (child) => {
    const closed = once(child, "close");
    const problem = await actual.terminateTree(child);
    await closed;
    events.push("closed");
    // Longer than the fixed grace after which a timeout used to be reported
    // whether or not termination had finished.
    await setTimeout(1500);
    events.push("confirmed");
    return problem;
  });
  const result = await formatWithCode(block(), {
    cwd: root,
    config: config([tool({ timeoutMs: 1000 })]),
  }).finally(() => events.push("reported"));
  expect(events).toEqual(["closed", "confirmed", "reported"]);
  expect(result.diagnostics).toEqual([expect.objectContaining({ message: timedOut(1000) })]);
});

it("reports a formatter whose termination fails or is not confirmed in time", async () => {
  const { root, tool, config } = await setup("timeout");
  const configured = { cwd: root, config: config([tool({ timeoutMs: 1000 })]) };
  const ended: Promise<unknown>[] = [];
  const end = (child: ChildProcess) =>
    ended.push(Promise.all([once(child, "exit"), actual.terminateTree(child)]));
  vi.mocked(terminateTree).mockImplementationOnce((child) => {
    end(child);
    return Promise.resolve("taskkill exited with code 1: ERROR: synthetic");
  });
  expect((await formatWithCode(block(), configured)).diagnostics).toEqual([
    expect.objectContaining({
      message: timedOut(
        1000,
        ", and its processes may still be running (taskkill exited with code 1: ERROR: synthetic)",
      ),
    }),
  ]);
  vi.mocked(terminateTree).mockImplementationOnce((child) => {
    end(child);
    return new Promise(() => {});
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const pending = formatWithCode(block(), configured);
    await vi.advanceTimersByTimeAsync(1000 + terminationWaitMs);
    expect((await pending).diagnostics).toEqual([
      expect.objectContaining({
        message: timedOut(
          1000,
          `, and its processes may still be running (not confirmed stopped within ${terminationWaitMs} ms)`,
        ),
      }),
    ]);
  } finally {
    vi.useRealTimers();
  }
  await Promise.all(ended);
});

it("keeps a document changed during the formatter run instead of overwriting it", async () => {
  const { root, config } = await setup("rewrite");
  await writeFile(path.join(root, "mdrefine.config.json"), JSON.stringify(config()));
  await writeFile(path.join(root, "note.md"), block());
  const result = run(root, ["format", "--write", "--json", "note.md"]);
  expect(result.status).toBe(2);
  expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("outside change\n");
  expect(parseReport(result.stdout).files[0]?.diagnostics).toEqual([
    expect.objectContaining({ rule: "engine/unwritable-file", severity: "error" }),
  ]);
});
