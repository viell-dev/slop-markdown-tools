import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rmdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildProduct, verifyBuild } from "./build.mjs";

/** Run a bounded sequence against one invocation-owned verified product build.
 * @param {Array<{ script: string, args?: string[] }>} commands
 * @param {string} [repositoryRoot]
 */
export async function withBuild(
  commands,
  repositoryRoot = path.resolve(import.meta.dirname, ".."),
) {
  const npm = process.env.npm_execpath;
  assert(npm, "Run through npm, for example npm run check.");
  assert(commands.length, "Name at least one internal npm script");
  let owned;
  try {
    if (process.env.MDREFINE_BUILD_RECEIPT) await verifyBuild(repositoryRoot);
    else {
      const context = await buildProduct(repositoryRoot);
      owned = await mkdtemp(path.join(tmpdir(), "mdrefine-build-context-"));
      const receipt = path.join(owned, "receipt.json");
      await writeFile(receipt, JSON.stringify({ ...context, ownerPid: process.pid }));
      process.env.MDREFINE_BUILD_RECEIPT = receipt;
      process.stdout.write("Product build ready (fresh staged output).\n");
    }
    for (const { script, args = [] } of commands) {
      await verifyBuild(repositoryRoot);
      const result = spawnSync(process.execPath, [npm, "run", script, "--", ...args], {
        cwd: repositoryRoot,
        stdio: "inherit",
        windowsHide: true,
      });
      if (result.error) throw result.error;
      assert.equal(result.signal, null, `Internal command interrupted: ${script}`);
      if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
  } finally {
    if (owned) {
      delete process.env.MDREFINE_BUILD_RECEIPT;
      await rm(path.join(owned, "receipt.json"), { force: true });
      await rmdir(owned);
    }
  }
}

async function invokedAsMain() {
  if (!process.argv[1]) return false;
  const scriptPath = await realpath(fileURLToPath(import.meta.url));
  try {
    return (await realpath(process.argv[1])) === scriptPath;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

if (await invokedAsMain()) {
  const commands = process.argv.slice(2);
  if (commands[0] === "--verify") {
    assert.equal(commands.length, 1);
    await verifyBuild();
  } else {
    process.exitCode = await withBuild(commands.map((script) => ({ script })));
  }
}
