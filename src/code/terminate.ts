import { execFile, type ChildProcess } from "node:child_process";
import path from "node:path";

/** How long a stopped formatter has to be confirmed ended before it is reported anyway. */
export const terminationWaitMs = 10000;

/** A clause, following the reason for stopping, for an outcome that is not known. */
export const unconfirmed = (detail: string) => `and its processes may still be running (${detail})`;

// On Windows the processes a tool started are found from its process ID, which
// no longer leads to them once the tool has exited.
const exitedFirst = "and had already exited, so any processes it started may not have been stopped";

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
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(exitedFirst);
  return new Promise((resolve) => {
    let helper: ChildProcess;
    const abandon = () => {
      // The helper's pipes would keep the event loop, and so the CLI, alive.
      helper.kill();
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
        (error, _stdout, stderr) => {
          signal.removeEventListener("abort", abandon);
          if (!error) return resolve(undefined);
          // 128: no process has the ID any longer, as when the tool exited meanwhile.
          if (error.code === 128) return resolve(exitedFirst);
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
      return resolve(unconfirmed(`taskkill failed (${(error as Error).message})`));
    }
    if (signal.aborted) abandon();
    else signal.addEventListener("abort", abandon, { once: true });
  });
}

/** Send `SIGKILL` to the tool's process group, which outlives the tool while a member runs. */
export function signalProcessGroup(child: ChildProcess): Promise<string | undefined> {
  const { pid } = child;
  if (pid === undefined) return Promise.resolve(undefined);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The tool left its group; end the tool itself unless it has exited.
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          return Promise.resolve(
            unconfirmed(`could not be signalled: ${(error as Error).message}`),
          );
      }
    }
  }
  return Promise.resolve(undefined);
}
