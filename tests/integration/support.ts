import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";

/** The checkout under test. Integration tests run the built CLI and library from it. */
export const repository = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const cli = path.join(repository, "dist/cli/main.js");
export const manifest = JSON.parse(
  await readFile(path.join(repository, "package.json"), "utf8"),
) as { name: string; version: string };

const temporary: string[] = [];
const restricted: string[] = [];
const denied: string[] = [];
afterEach(async () => {
  // Give permissions back first, also after a failed test: a directory that may
  // not be read cannot be emptied, and its workspace could not be removed.
  for (const file of restricted.splice(0).reverse())
    await chmod(file, 0o700).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  for (const file of denied.splice(0).reverse())
    spawnSync(path.join(system32, "icacls.exe"), [file, "/remove:d", `*${user()}`]);
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});
/**
 * Whether permissions can be taken away from this process with Unix modes: not
 * on Windows, where a file mode only holds the read-only flag, and not for
 * root, who may read anything. On Windows, `denyRead` does it instead.
 */
export const canRestrict = process.platform !== "win32" && process.getuid?.() !== 0;
/** Change a path's permissions (by default to none) until the current test ends. */
export async function restrict(file: string, mode = 0o000): Promise<void> {
  restricted.push(file);
  await chmod(file, mode);
}
/** The folder of Windows's own programs, which tests call where Node.js has no equivalent. */
const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
let sid: string | undefined;
/** The security identifier of the user running the tests on Windows. */
function user(): string {
  sid ??= /"(S-[\d-]+)"/.exec(
    execFileSync(path.join(system32, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
    }),
  )![1]!;
  return sid;
}
/**
 * On Windows, deny the current user reading a file, or listing a directory,
 * until the current test ends. Windows has no permission bits; this changes the
 * path's access control list, and Node.js reports the refusal as `EPERM`. The
 * file's attributes stay readable, so it can still be found and named.
 */
export function denyRead(file: string): void {
  denied.push(file);
  execFileSync(path.join(system32, "icacls.exe"), [file, "/deny", `*${user()}:(RD)`]);
}
/**
 * Link `target` from `file`, both directories: a junction on Windows, which
 * needs no privilege, and a symbolic link elsewhere.
 */
export async function linkDirectory(target: string, file: string): Promise<void> {
  await symlink(target, file, "junction");
}
/**
 * Whether this process may create a symbolic link to a file. Windows allows it
 * only in Developer Mode or with administrator rights.
 */
export const canSymlink = await (async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mdtools-link-"));
  try {
    await symlink(path.join(root, "target"), path.join(root, "link"), "file");
    return true;
  } catch {
    return false;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
})();
/**
 * Create a temporary workspace holding `files`, given as text or as bytes; it
 * is removed after the current test.
 */
export async function fixture(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mdtools-test-"));
  temporary.push(root);
  // Keep discovery inside the fixture even when the host's temp directory is a repository.
  await mkdir(path.join(root, ".git"));
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), value);
  }
  return root;
}
/** Copy a directory of the repository to a temporary location that tests may write to. */
export async function copyOf(directory: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mdtools-test-"));
  temporary.push(root);
  await cp(path.join(repository, directory), root, { recursive: true });
  return root;
}
/** Every file below `root`, keyed by forward-slash path, for comparing whole trees. */
export async function tree(root: string): Promise<Record<string, string>> {
  const files: [string, string][] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files.push([path.relative(root, file).split(path.sep).join("/"), await readFile(file, "utf8")]);
  }
  return Object.fromEntries(files.sort(([a], [b]) => (a < b ? -1 : 1)));
}
/** Run the built CLI as a separate process, the way a consumer does, with text or bytes on stdin. */
export function run(root: string, args: string[], input?: string | Uint8Array) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, input, encoding: "utf8" });
}
/** Run a script of the repository with Node, from `cwd`. */
export function node(script: string, args: string[] = [], input?: string, cwd = repository) {
  return spawnSync(process.execPath, [path.join(repository, script), ...args], {
    cwd,
    input,
    encoding: "utf8",
  });
}
