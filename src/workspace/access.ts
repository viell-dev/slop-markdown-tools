import { stat } from "node:fs/promises";

/**
 * The error codes with which a system refuses to let the process read a path:
 * `EACCES` for permission bits and access control lists, `EPERM` for
 * operating-system policy such as a privacy-protected or system folder. Any
 * other read error is a fault, such as a path that vanished during the run, a
 * failing device, or exhausted resources, and is never treated as a refusal.
 */
const refusals = { EACCES: "permission denied", EPERM: "operation not permitted" } as const;
export type RefusalCode = keyof typeof refusals;

/** The code of an error that refuses a read, or undefined for any other error. */
export function refusal(error: unknown): RefusalCode | undefined {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return code === "EACCES" || code === "EPERM" ? code : undefined;
}
/** A refusal in words, such as `EACCES: permission denied`. */
export function refusalText(code: RefusalCode): string {
  return `${code}: ${refusals[code]}`;
}
/**
 * Whether something exists at `file`. A path through something that is not a
 * directory leads nowhere; a refusal, or any other error, is not an answer.
 */
export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}
