import { execFile, type ChildProcess, type ExecFileException } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import spawn from "cross-spawn";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runFormatter } from "../../src/code/command.js";
import {
  endWindowsTree,
  signalProcessGroup,
  terminateTree,
  terminationWaitMs,
} from "../../src/code/terminate.js";
import type { CodeFormatter } from "../../src/core/types.js";

vi.mock("cross-spawn", () => ({ default: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: vi.fn(),
}));
vi.mock("../../src/code/terminate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/code/terminate.js")>()),
  terminateTree: vi.fn(),
}));

/** A spawned process whose exit and output the test emits. */
class Simulated extends EventEmitter {
  readonly pid = 4242;
  exitCode: number | null = null;
  readonly signalCode = null;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
  readonly unref = vi.fn();
  exit() {
    this.exitCode = 0;
    this.emit("exit", 0, null);
    this.emit("close", 0, null);
  }
}
const asChild = (simulated: Simulated) => simulated as unknown as ChildProcess;
const exitedFirst = "and had already exited, so any processes it started may not have been stopped";
const timedOut = "exceeded its 1000 ms timeout";
// Fake timers replace setTimeout only, so an immediate runs every pending callback.
const settled = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

/** Run a formatter on a simulated process, recording how its Promise settles. */
function start(extra: Partial<CodeFormatter> = {}) {
  const tool = new Simulated();
  vi.mocked(spawn).mockReturnValueOnce(asChild(tool));
  const outcome: { output?: string; error?: string } = {};
  const formatter = { id: "javascript", languages: ["js"], command: "tool", args: [] };
  void runFormatter(
    { ...formatter, timeoutMs: 1000, maxOutputBytes: 64, ...extra },
    "code\n",
    "workspace",
    "workspace/note.md",
  ).then(
    (output) => {
      outcome.output = output;
    },
    (error: Error) => {
      outcome.error = error.message;
    },
  );
  return { tool, outcome };
}
/** Make the next termination attempt wait until the test settles it. */
function heldTermination() {
  let settle: (outcome?: string) => void = () => {};
  vi.mocked(terminateTree).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  return {
    settle: (outcome?: string) => settle(outcome),
    signal: () => vi.mocked(terminateTree).mock.calls[0]![1],
  };
}

it.each([
  ["termination is confirmed before the tool closes", ["confirm", "close"]],
  ["the tool closes before termination is confirmed", ["close", "confirm"]],
])("reports a timeout once %s", async (_, steps) => {
  const termination = heldTermination();
  const { tool, outcome } = start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(terminateTree).toHaveBeenCalledWith(tool, expect.any(AbortSignal));
  // Far beyond the fixed grace that used to end the wait, and within the wait.
  await vi.advanceTimersByTimeAsync(terminationWaitMs - 1);
  for (const step of steps) {
    expect(outcome).toEqual({});
    if (step === "confirm") termination.settle();
    else tool.exit();
    await settled();
  }
  expect(outcome).toEqual({ error: timedOut });
  expect(termination.signal().aborted).toBe(true);
});

it.each([
  ["neither happens", []],
  ["only termination is confirmed", ["confirm"]],
  ["only the tool closes", ["close"]],
])("reports an unconfirmed stop when the wait ends and %s", async (_, steps) => {
  const termination = heldTermination();
  const { tool, outcome } = start();
  await vi.advanceTimersByTimeAsync(1000);
  for (const step of steps) {
    if (step === "confirm") termination.settle();
    else tool.exit();
  }
  await vi.advanceTimersByTimeAsync(terminationWaitMs - 1);
  expect(outcome).toEqual({});
  expect(termination.signal().aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(outcome).toEqual({
    error: `${timedOut}, and its processes may still be running (not confirmed stopped within ${terminationWaitMs} ms)`,
  });
  // The attempt is abandoned, and nothing of the tool holds the caller open.
  expect(termination.signal().aborted).toBe(true);
  expect(tool.unref).toHaveBeenCalled();
  for (const stream of [tool.stdin, tool.stdout, tool.stderr]) expect(stream.destroyed).toBe(true);
});

it("reports at once an outcome that termination could not confirm", async () => {
  const termination = heldTermination();
  const { outcome } = start();
  await vi.advanceTimersByTimeAsync(1000);
  termination.settle("and its processes may still be running (taskkill exited with code 1)");
  await settled();
  expect(outcome).toEqual({
    error: `${timedOut}, and its processes may still be running (taskkill exited with code 1)`,
  });
});

it("reports a failed termination attempt instead of leaving its rejection unhandled", async () => {
  vi.mocked(terminateTree).mockRejectedValueOnce(new Error("synthetic failure"));
  const { outcome } = start();
  await vi.advanceTimersByTimeAsync(1000);
  await settled();
  expect(outcome).toEqual({
    error: `${timedOut}, and its processes may still be running (synthetic failure)`,
  });
});

it("says when a Windows tool over its output limit had already exited", async () => {
  vi.mocked(terminateTree).mockImplementationOnce(endWindowsTree);
  const { tool, outcome } = start();
  // Node.js can handle the exit before the output that exceeds the limit.
  tool.exitCode = 0;
  tool.emit("exit", 0, null);
  tool.stdout.emit("data", Buffer.alloc(100));
  await settled();
  expect(execFile).not.toHaveBeenCalled();
  expect(outcome).toEqual({ error: `exceeded its 64 byte output limit, ${exitedFirst}` });
});

type Done = (error: ExecFileException | null, stdout: string, stderr: string) => void;
/** Make the next execFile call return a simulated taskkill that the test finishes. */
function taskkill() {
  const helper = new Simulated();
  let done: Done = () => {};
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    done = args[3] as Done;
    return asChild(helper);
  });
  return { helper, finish: (...args: Parameters<Done>) => done(...args) };
}
const failed = (code: number | string, message = "Command failed") =>
  Object.assign(new Error(message), { code });

it("confirms a taskkill that ends a running tool's tree, without a deadline of its own", async () => {
  const { finish } = taskkill();
  const pending = endWindowsTree(asChild(new Simulated()), new AbortController().signal);
  expect(execFile).toHaveBeenCalledWith(
    expect.stringMatching(/taskkill\.exe$/),
    ["/PID", "4242", "/T", "/F"],
    { windowsHide: true },
    expect.any(Function),
  );
  finish(null, "SUCCESS\r\n", "");
  await expect(pending).resolves.toBeUndefined();
});

it.each([
  [
    "exits with an error",
    failed(1),
    "ERROR: synthetic\r\n",
    "and its processes may still be running (taskkill exited with code 1: ERROR: synthetic)",
  ],
  [
    "cannot be found",
    failed("ENOENT", "spawn taskkill.exe ENOENT"),
    "",
    "and its processes may still be running (taskkill failed (spawn taskkill.exe ENOENT))",
  ],
  [
    "cannot end a descendant, with code 128",
    failed(128),
    "ERROR: The process with PID 5150 (child process of PID 4242) could not be terminated.\r\nReason: synthetic.\r\n",
    "and its processes may still be running (taskkill exited with code 128: ERROR: The process with PID 5150 (child process of PID 4242) could not be terminated.\r\nReason: synthetic.)",
  ],
  [
    "no longer finds the tool, with code 128",
    failed(128),
    'ERROR: The process "4242" not found.\r\n',
    'and its processes may still be running (taskkill exited with code 128: ERROR: The process "4242" not found.)',
  ],
])("reports a taskkill that %s", async (_, error, stderr, clause) => {
  const { finish } = taskkill();
  const pending = endWindowsTree(asChild(new Simulated()), new AbortController().signal);
  finish(error, "", stderr);
  await expect(pending).resolves.toBe(clause);
});

const gone = 'ERROR: The process "4242" not found.\r\n';
const stuck =
  "ERROR: The process with PID 5150 (child process of PID 4242) could not be terminated.\r\n";
it.each([
  ["no longer finds the tool", failed(128), "", gone, exitedFirst],
  // A synthetic message in another language, with the same structure.
  [
    "no longer finds the tool, in another language",
    failed(128),
    "",
    'エラー: プロセス "4242" が見つかりませんでした。\r\n',
    exitedFirst,
  ],
  [
    "ends the tool but not a descendant, with code 128",
    failed(128),
    "SUCCESS: The process with PID 4242 (child process of PID 1000) has been terminated.\r\n",
    `${stuck}Reason: synthetic.\r\n`,
    "and its processes may still be running (taskkill exited with code 128: ERROR: The process with PID 5150 (child process of PID 4242) could not be terminated.\r\nReason: synthetic.)",
  ],
  [
    "ends nothing and not a descendant, with code 128",
    failed(128),
    "",
    `${stuck}Reason: synthetic.\r\n`,
    "and its processes may still be running (taskkill exited with code 128: ERROR: The process with PID 5150 (child process of PID 4242) could not be terminated.\r\nReason: synthetic.)",
  ],
  // The form that a public report shows for a descendant in Japanese.
  [
    "ends nothing and not a descendant, in another language",
    failed(128),
    "",
    "エラー: PID 5150 のプロセス (PID 4242 の子プロセス) を終了できませんでした。\r\n理由: synthetic.\r\n",
    "and its processes may still be running (taskkill exited with code 128: エラー: PID 5150 のプロセス (PID 4242 の子プロセス) を終了できませんでした。\r\n理由: synthetic.)",
  ],
  // As Windows 11 reports a descendant that taskkill may not open.
  [
    "is denied a descendant, with code 255",
    failed(255),
    "SUCCESS: The process with PID 4242 (child process of PID 1000) has been terminated.\r\n",
    `${stuck}Reason: Access is denied.\r\r\n`,
    "and its processes may still be running (taskkill exited with code 255: ERROR: The process with PID 5150 (child process of PID 4242) could not be terminated.\r\nReason: Access is denied.)",
  ],
  [
    "no longer finds another process",
    failed(128),
    "",
    'ERROR: The process "5150" not found.\r\n',
    'and its processes may still be running (taskkill exited with code 128: ERROR: The process "5150" not found.)',
  ],
  [
    "ends a process although it no longer finds the tool",
    failed(128),
    "SUCCESS: The process with PID 5150 (child process of PID 4242) has been terminated.\r\n",
    gone,
    'and its processes may still be running (taskkill exited with code 128: ERROR: The process "4242" not found.)',
  ],
  [
    "no longer finds the tool, with another code",
    failed(1),
    "",
    gone,
    'and its processes may still be running (taskkill exited with code 1: ERROR: The process "4242" not found.)',
  ],
  [
    "exits with code 128 without a message",
    failed(128),
    "",
    "",
    "and its processes may still be running (taskkill exited with code 128)",
  ],
])(
  "reports a taskkill that %s, once Node.js has seen the tool exit",
  async (_, error, stdout, stderr, clause) => {
    const { finish } = taskkill();
    const tool = new Simulated();
    const pending = endWindowsTree(asChild(tool), new AbortController().signal);
    expect(execFile).toHaveBeenCalledOnce();
    tool.exit();
    finish(error, stdout, stderr);
    await expect(pending).resolves.toBe(clause);
  },
);

it("says when a Windows tool over its output limit exited while taskkill started", async () => {
  vi.mocked(terminateTree).mockImplementationOnce(endWindowsTree);
  const { finish } = taskkill();
  const { tool, outcome } = start();
  tool.stdout.emit("data", Buffer.alloc(100));
  await settled();
  expect(execFile).toHaveBeenCalledOnce();
  // Node.js handles the tool's exit before taskkill's, which no longer finds it.
  tool.exit();
  finish(failed(128), "", gone);
  await settled();
  expect(outcome).toEqual({ error: `exceeded its 64 byte output limit, ${exitedFirst}` });
});

it("reports a taskkill whose launch throws", async () => {
  // Node.js throws `spawn UNKNOWN` for an executable that is not a program.
  vi.mocked(execFile).mockImplementationOnce(() => {
    throw failed("UNKNOWN", "spawn UNKNOWN");
  });
  await expect(
    endWindowsTree(asChild(new Simulated()), new AbortController().signal),
  ).resolves.toBe("and its processes may still be running (taskkill failed (spawn UNKNOWN))");
});

it("runs no taskkill for a tool that has exited, whose ID can be another process's", async () => {
  const tool = new Simulated();
  tool.exitCode = 0;
  await expect(endWindowsTree(asChild(tool), new AbortController().signal)).resolves.toBe(
    exitedFirst,
  );
  expect(execFile).not.toHaveBeenCalled();
});

it.each([
  ["", () => true],
  [
    " whose kill throws",
    () => {
      throw new Error("kill EINVAL");
    },
  ],
])("ends an abandoned taskkill%s and releases its pipes", async (_, kill) => {
  const { helper } = taskkill();
  helper.kill.mockImplementation(kill);
  const abandon = new AbortController();
  const pending = endWindowsTree(asChild(new Simulated()), abandon.signal);
  abandon.abort();
  // An exception in the listener would surface on a later turn.
  await settled();
  await expect(pending).resolves.toBe(
    "and its processes may still be running (taskkill did not finish)",
  );
  expect(helper.kill).toHaveBeenCalled();
  expect(helper.unref).toHaveBeenCalled();
  for (const stream of [helper.stdin, helper.stdout, helper.stderr])
    expect(stream.destroyed).toBe(true);
});

const errno = (code: string) => Object.assign(new Error(`kill ${code}`), { code });

it("signals the tool's process group", async () => {
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  await expect(signalProcessGroup(asChild(new Simulated()))).resolves.toBeUndefined();
  expect(kill.mock.calls).toEqual([[-4242, "SIGKILL"]]);
});

it("signals a tool that left its group and reports when that fails", async () => {
  const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
    throw errno(pid < 0 ? "ESRCH" : "EPERM");
  });
  await expect(signalProcessGroup(asChild(new Simulated()))).resolves.toBe(
    "and its processes may still be running (it could not be signalled: kill EPERM)",
  );
  expect(kill.mock.calls).toEqual([
    [-4242, "SIGKILL"],
    [4242, "SIGKILL"],
  ]);
});

it.each([
  ["after the tool exited", 0, [[-4242, "SIGKILL"]]],
  [
    "although signalling the tool itself succeeds",
    null,
    [
      [-4242, "SIGKILL"],
      [4242, "SIGKILL"],
    ],
  ],
])("reports a process group it may not signal %s", async (_, exitCode, calls) => {
  // Linux fails with EPERM when no member is the caller's to signal.
  const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
    if (pid < 0) throw errno("EPERM");
    return true;
  });
  const tool = new Simulated();
  tool.exitCode = exitCode;
  await expect(signalProcessGroup(asChild(tool))).resolves.toBe(
    "and its processes may still be running (its process group could not be signalled: kill EPERM)",
  );
  expect(kill.mock.calls).toEqual(calls);
});

it("signals no exited tool outside its group", async () => {
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    throw errno("ESRCH");
  });
  const tool = new Simulated();
  tool.exitCode = 0;
  await expect(signalProcessGroup(asChild(tool))).resolves.toBeUndefined();
  expect(kill.mock.calls).toEqual([[-4242, "SIGKILL"]]);
});
