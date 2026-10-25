// Compares what Obsidian shows before and after formatting, in Live Preview and in Reading
// view, with Obsidian itself running in Docker. Build the repository first (`npm run build`);
// `npm run check:obsidian` does both. Docker must be running.
//
// The image (scripts/obsidian/Dockerfile) holds a virtual display and WebdriverIO with
// wdio-obsidian-service, which downloads the Obsidian version to test at run time into the
// `mdrefine-obsidian-cache` volume; no image holds Obsidian, whose terms do not allow
// redistributing it. The repository is mounted read-only, and the report, report.json with
// screenshots of the first differences, is written to artifacts/obsidian/.
//
// Environment: SEED repeats generated documents, COUNT sets documents per seed (10 realistic),
// OBSIDIAN_VERSION/OBSIDIAN_INSTALLER_VERSION override the pinned baseline, and REDUCE, a list of
// generated documents' names from a report, reduces those to the lines that show the difference.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import baseline from "./obsidian/baseline.json" with { type: "json" };

const repository = fileURLToPath(new URL("..", import.meta.url));
const output = fileURLToPath(new URL("../artifacts/obsidian/", import.meta.url));
const image = "mdrefine-obsidian-check";

/** Runs docker with the arguments, its output going to this process's, and returns its status. */
function docker(...parameters) {
  const result = spawnSync("docker", parameters, { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const temporary = mkdtempSync(path.join(tmpdir(), "mdrefine-obsidian-image-"));
const iidfile = path.join(temporary, "image-id");
let identity;
try {
  if (
    docker(
      "build",
      "--iidfile",
      iidfile,
      "--tag",
      image,
      fileURLToPath(new URL("obsidian", import.meta.url)),
    ) !== 0
  )
    throw new Error("Obsidian image build failed");
  const id = readFileSync(iidfile, "utf8").trim();
  assert.match(id, /^sha256:[0-9a-f]{64}$/);
  const inspected = spawnSync("docker", ["image", "inspect", id], { encoding: "utf8" });
  if (inspected.error) throw inspected.error;
  assert.equal(inspected.status, 0, inspected.stderr);
  const [observed] = JSON.parse(inspected.stdout);
  assert.equal(observed.Id, id);
  identity = {
    id,
    base: observed.Config.Labels["org.mdrefine.base-image"],
    platform: `${observed.Os}/${observed.Architecture}`,
  };
  assert.equal(identity.base, baseline.baseImage);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
// The container writes as its own user, which on Linux need not own the checkout, as on a
// GitHub-hosted runner.
chmodSync(output, 0o777);
const environment = [
  "PROFILE",
  "SEEDS",
  "SEED",
  "COUNT",
  "OBSIDIAN_VERSION",
  "OBSIDIAN_INSTALLER_VERSION",
  "REDUCE",
  "PROBE",
].flatMap((name) =>
  // Docker reads a named variable from its inherited environment. Large PROBE batches must
  // not become process arguments, which Windows limits to about 32,000 characters.
  process.env[name] ? ["--env", name] : [],
);
const status = docker(
  "run",
  "--rm",
  "--shm-size=1g",
  "--volume",
  `${repository}:/repo:ro`,
  "--volume",
  `${output}:/out`,
  "--volume",
  "mdrefine-obsidian-cache:/check/.obsidian-cache",
  ...environment,
  "--env",
  `OBSIDIAN_IMAGE=${JSON.stringify(identity)}`,
  identity.id,
);
process.exit(status);
