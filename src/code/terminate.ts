import { execFile, type ChildProcess } from "node:child_process";
import path from "node:path";

/** How long a stopped formatter has to be confirmed ended before it is reported anyway. */
export const terminationWaitMs = 10000;

/**
 * Forcibly end a formatter process and the processes it started. Resolves once
 * the operating system has carried that out, or with the reason it could not.
 */
export function terminateTree(child: ChildProcess): Promise<string | undefined> {
  const { pid } = child;
  if (pid === undefined) return Promise.resolve(undefined);
  // Once Node.js has reaped the process, its ID can belong to another process.
  const running = child.exitCode === null && child.signalCode === null;
  if (process.platform === "win32") {
    if (!running) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      // npm command shims can have a child; terminating cmd alone leaves it
      // running. taskkill can take seconds to start on a busy machine, so it is
      // given no deadline of its own: the caller bounds the wait instead.
      execFile(
        path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true },
        (error, _stdout, stderr) => {
          if (!error) return resolve(undefined);
          const detail = stderr.trim();
          resolve(
            `${typeof error.code === "number" ? `taskkill exited with code ${error.code}` : `taskkill failed (${error.message})`}${detail ? `: ${detail}` : ""}`,
          );
        },
      ).unref();
    });
  }
  try {
    // The tool leads its own process group, which outlives the tool while any
    // process it started remains in it.
    process.kill(-pid, "SIGKILL");
  } catch {
    // The tool left its group; end the tool itself if it still runs.
    if (running) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          return Promise.resolve(`could not be signalled (${(error as Error).message})`);
      }
    }
  }
  return Promise.resolve(undefined);
}
