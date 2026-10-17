import { stat } from "node:fs/promises";

/**
 * The error codes with which a system refuses to let the process read a path:
 * `EACCES` for permission bits and access control lists, `EPERM` for
 * operating-system policy such as a privacy-protected or system folder and for
 * access control lists on Windows, and `EBUSY` for a file that another program
 * has locked, which Windows allows. Any other read error is a fault, such as a
 * path that vanished during the run, a failing device, or exhausted resources,
 * and is never treated as a refusal.
 */
const refusals = {
  EACCES: "permission denied",
  EPERM: "operation not permitted",
  EBUSY: "resource busy or locked",
} as const;
export type RefusalCode = keyof typeof refusals;

/** The code of an error that refuses a read, or undefined for any other error. */
export function refusal(error: unknown): RefusalCode | undefined {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && Object.hasOwn(refusals, code)
    ? (code as RefusalCode)
    : undefined;
}
/** A refusal in words, such as `EACCES: permission denied`. */
export function refusalText(code: RefusalCode): string {
  return `${code}: ${refusals[code]}`;
}
/**
 * A system error in words, without the paths that the system's message names,
 * such as `EROFS: read-only file system`, or undefined for an error that does
 * not come from the system.
 */
export function systemErrorText(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error;
  if (typeof code !== "string") return undefined;
  const refused = refusal(error);
  if (refused) return refusalText(refused);
  // Node.js writes `CODE: description, syscall 'path'`.
  const message = error instanceof Error ? error.message : "";
  const syscall = "syscall" in error && typeof error.syscall === "string" ? error.syscall : "";
  const end = syscall ? message.indexOf(`, ${syscall}`) : -1;
  return message.startsWith(`${code}: `) && end > 0 ? message.slice(0, end) : code;
}
/**
 * The error to report for a path that the user named and that cannot be used:
 * what the path was named as, the path as it was given, and whether nothing is
 * there or the system refuses to let it be read. The system's own message names
 * the internal step that failed, which tells the user nothing. Any other error
 * is a fault and is returned as it is.
 */
export function pathError(role: string, given: string, error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  // A path through something that is not a directory leads nowhere either.
  if (code === "ENOENT" || code === "ENOTDIR")
    return new Error(`${role} does not exist: ${given}`, { cause: error });
  const refused = refusal(error);
  return refused
    ? new Error(`${role} cannot be read: ${given} (${refusalText(refused)})`, { cause: error })
    : error;
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
