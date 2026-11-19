import { execFile, type ChildProcess } from "node:child_process";
import path from "node:path";

/** How long a stopped formatter has to be confirmed ended before it is reported anyway. */
export const terminationWaitMs = 10000;

/** A clause, following the reason for stopping, for an outcome that is not known. */
export const unconfirmed = (detail: string) => `and its processes may still be running (${detail})`;

// On Windows the processes a tool started are found from its process ID, which
// no longer leads to them once the tool has exited.
const exitedFirst = "and had already exited, so any processes it started may not have been stopped";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const notFound = (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH";
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/**
 * Whether `taskkill` found the tool's own process gone, which happens when the
 * tool exits while `taskkill` starts. `taskkill` then exits with code 128,
 * prints nothing to stdout, because it ended nothing, and its message contains
 * one number: the process ID it was given. It can also exit with code 128 for
 * a descendant that it could not end, whose message names that descendant and
 * its parent. Its messages are localized, so only that structure is read,
 * counting whole runs of digits in any script, and Node.js must also have seen
 * the tool exit.
 */
function toolWasGone(child: ChildProcess, code: unknown, stdout: string, stderr: string): boolean {
  const ids = stderr.match(/\p{Nd}+/gu);
  return (
    code === 128 &&
    stdout.trim() === "" &&
    ids?.length === 1 &&
    ids[0] === String(child.pid) &&
    exited(child)
  );
}

/**
 * Forcibly end a formatter process and the processes it started. Resolves with
 * nothing once the operating system has carried that out, or with a clause,
 * following the reason for stopping, that says why that is not known. Aborting
 * `signal` abandons the attempt and releases everything it holds open.
 */
export function terminateTree(
  child: ChildProcess,
  signal: AbortSignal,
): Promise<string | undefined> {
  return process.platform === "win32" ? endWindowsTree(child, signal) : signalProcessGroup(child);
}

/** End the tree with `taskkill /T /F`, which follows parent process IDs. */
export function endWindowsTree(
  child: ChildProcess,
  signal: AbortSignal,
): Promise<string | undefined> {
  const { pid } = child;
  if (pid === undefined) return Promise.resolve(undefined);
  // Once Node.js has handled the exit, the ID can belong to another process.
  if (exited(child)) return Promise.resolve(exitedFirst);
  return new Promise((resolve) => {
    let helper: ChildProcess;
    const abandon = () => {
      try {
        helper.kill();
      } catch {
        // A helper that cannot be signalled is still released below.
      }
      // The helper's pipes would keep the event loop, and so the CLI, alive.
      helper.stdin?.destroy();
      helper.stdout?.destroy();
      helper.stderr?.destroy();
      helper.unref();
      resolve(unconfirmed("taskkill did not finish"));
    };
    try {
      // npm command shims can have a child; terminating cmd alone leaves it
      // running. taskkill can take seconds to start on a busy machine, so it
      // has no deadline of its own; the caller aborts it when its wait ends.
      // The tool can still exit before taskkill resolves its ID, which Windows
      // may then have given to another process; that bounded wait limits how
      // long this window stays open.
      helper = execFile(
        path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true },
        (error, stdout, stderr) => {
          signal.removeEventListener("abort", abandon);
          if (!error) return resolve(undefined);
          if (toolWasGone(child, error.code, stdout, stderr)) return resolve(exitedFirst);
          // Any other failure, including code 128 for a descendant that
          // taskkill could not end, leaves the outcome unknown.
          const detail = stderr.trim();
          resolve(
            unconfirmed(
              typeof error.code === "number"
                ? `taskkill exited with code ${error.code}${detail ? `: ${detail}` : ""}`
                : `taskkill failed (${error.message})`,
            ),
          );
        },
      );
    } catch (error) {
      // An invalid executable makes the launch throw instead of calling back.
      return resolve(unconfirmed(`taskkill failed (${message(error)})`));
    }
    if (signal.aborted) abandon();
    else signal.addEventListener("abort", abandon, { once: true });
  });
}

/**
 * Send `SIGKILL` to the tool's process group, which outlives the tool while a
 * member runs. The call succeeds once it signals any member, so members that
 * the caller may not signal can survive a success; when it may signal none of
 * them, it fails with `EPERM`.
 */
export function signalProcessGroup(child: ChildProcess): Promise<string | undefined> {
  const { pid } = child;
  if (pid === undefined) return Promise.resolve(undefined);
  let problem: string | undefined;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (group) {
    // `ESRCH` means that no member is left; anything else leaves them running.
    if (!notFound(group)) problem = `its process group could not be signalled: ${message(group)}`;
    // A tool that left its group is ended itself, unless it has exited.
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (!notFound(error)) problem ??= `it could not be signalled: ${message(error)}`;
      }
    }
  }
  return Promise.resolve(problem === undefined ? undefined : unconfirmed(problem));
}
