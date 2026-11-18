import path from "node:path";
import spawn from "cross-spawn";
import type { CodeFormatter } from "../core/types.js";
import { terminateTree, terminationWaitMs } from "./terminate.js";

/** Run a configured executable with argument arrays and a bounded UTF-8 response. */
export function runFormatter(
  formatter: CodeFormatter,
  source: string,
  cwd: string,
  filepath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = Buffer.from(source, "utf8");
    if (input.toString("utf8") !== source) {
      reject(new Error("could not receive input without replacing invalid Unicode"));
      return;
    }
    const env = { ...process.env };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    env[pathKey] =
      `${path.join(cwd, "node_modules", ".bin")}${path.delimiter}${env[pathKey] ?? ""}`;
    const child = spawn(
      formatter.command,
      formatter.args.map((argument) => argument.replaceAll("{filepath}", filepath)),
      {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: "pipe",
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let failure: string | undefined;
    let finished = false;
    let terminated = false;
    let closed = false;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const limit = formatter.maxOutputBytes ?? 1024 * 1024;
    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(wait);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      if (error) reject(new Error(error));
      else {
        try {
          resolve(
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
              Buffer.concat(stdout),
            ),
          );
        } catch {
          reject(new Error("returned output that could not be decoded as UTF-8 text"));
        }
      }
    };
    // A stopped tool is reported only once it and the processes it started have
    // ended and released its output, so that none of them still runs when the
    // caller moves on. A failed or unfinished termination is reported as such.
    const reportStopped = () => {
      if (terminated && closed) finish(failure);
    };
    const stop = (reason: string) => {
      if (failure || finished) return;
      failure = reason;
      wait = setTimeout(
        () =>
          finish(
            `${reason}, and its processes may still be running (not confirmed stopped within ${terminationWaitMs} ms)`,
          ),
        terminationWaitMs,
      );
      void terminateTree(child).then((problem) => {
        if (problem) finish(`${reason}, and its processes may still be running (${problem})`);
        else {
          terminated = true;
          reportStopped();
        }
      });
    };
    const timer = setTimeout(
      () => stop(`exceeded its ${formatter.timeoutMs ?? 10000} ms timeout`),
      formatter.timeoutMs ?? 10000,
    );
    child.once("error", (error) => finish(`could not start (${error.message})`));
    child.stdout!.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > limit) stop(`exceeded its ${limit} byte output limit`);
      else if (!failure) stdout.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      const remaining = 65536 - errorBytes;
      if (remaining > 0) stderr.push(chunk.subarray(0, remaining));
      errorBytes += chunk.length;
    });
    child.once("close", (code, signal) => {
      closed = true;
      if (failure) return reportStopped();
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      finish(
        code === 0
          ? undefined
          : `exited ${signal ? `with signal ${signal}` : `with code ${String(code)}`}${detail ? `: ${detail}` : ""}`,
      );
    });
    // An early successful exit can close stdin before consuming it; its exit
    // status and complete stdout still determine the result.
    child.stdin!.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED")
        stop(`could not receive code (${error.message})`);
    });
    child.stdin!.end(input);
  });
}
