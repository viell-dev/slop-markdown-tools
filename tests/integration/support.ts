import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
afterEach(async () => {
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});
/** Create a temporary workspace holding `files`; it is removed after the current test. */
export async function fixture(files: Record<string, string>): Promise<string> {
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
/** Run the built CLI as a separate process, the way a consumer does. */
export function run(root: string, args: string[], input?: string) {
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
