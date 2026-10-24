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
// Environment: SEED repeats a run's generated documents, COUNT sets how many (100),
// OBSIDIAN_VERSION picks the Obsidian version (latest), and REDUCE, a comma-separated list of
// generated documents' names from a report, reduces those to the lines that show the difference.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const output = fileURLToPath(new URL("../artifacts/obsidian/", import.meta.url));
const image = "mdrefine-obsidian-check";

/** Runs docker with the arguments, its output going to this process's, and returns its status. */
function docker(...parameters) {
  const result = spawnSync("docker", parameters, { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (docker("build", "--tag", image, fileURLToPath(new URL("obsidian", import.meta.url))) !== 0)
  process.exit(2);
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
  image,
);
process.exit(status);
