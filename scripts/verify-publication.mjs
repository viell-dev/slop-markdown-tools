// Check that the npm registry serves the tested tarball for a published version, with provenance.
//
//   node scripts/verify-publication.mjs VERSION TARBALL [COMMIT]
//
// The registry's checksums of the version, `dist.integrity` (SHA-512) and `dist.shasum` (SHA-1),
// must match TARBALL. The registry must report a SLSA provenance attestation for the version,
// and the attestation must name the tarball's SHA-512 digest, this repository's Release
// workflow, and, when given, COMMIT as the source. Just after publication the registry can
// answer 404 for about a minute, so a missing version or attestation is retried for that long;
// a checksum or provenance that differs fails at once. The Release workflow runs this script
// after publishing; run it by hand to check a publication whose workflow did not finish.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const [version, tarball, commit] = process.argv.slice(2);
if (!version || !tarball) {
  process.stderr.write("Usage: node scripts/verify-publication.mjs VERSION TARBALL [COMMIT]\n");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
// "git+https://github.com/OWNER/REPO.git" is written "https://github.com/OWNER/REPO" there.
const repository = manifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
const workflow = ".github/workflows/release.yml";
const provenance = "https://slsa.dev/provenance/v1";
const attempts = 12;
const pause = 5000;

/** Fetch JSON from `url`, retrying while it is missing or `missing(body)` names what is absent. */
async function fetchJson(url, missing) {
  for (let attempt = 1; ; attempt++) {
    let problem;
    try {
      const response = await globalThis.fetch(url, { headers: { accept: "application/json" } });
      if (response.ok) {
        const body = await response.json();
        problem = missing(body);
        if (!problem) return body;
      } else problem = `HTTP ${response.status}`;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (attempt === attempts) throw new Error(`${url}: ${problem} after ${attempts} attempts`);
    process.stderr.write(`${url}: ${problem}; trying again in ${pause / 1000} seconds\n`);
    await delay(pause);
  }
}

/** Throw unless `actual` is `expected`. */
function expect(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what} is ${actual}; expected ${expected}`);
}

try {
  const bytes = readFileSync(tarball);
  const sha512 = createHash("sha512").update(bytes).digest();
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  const document = await fetchJson(
    `https://registry.npmjs.org/${manifest.name}/${version}`,
    (body) => (body.dist?.attestations ? undefined : "no attestations"),
  );
  expect(document.version, version, "The registry's version");
  expect(document.dist.integrity, `sha512-${sha512.toString("base64")}`, "dist.integrity");
  expect(document.dist.shasum, sha1, "dist.shasum");
  expect(document.dist.attestations.provenance?.predicateType, provenance, "The provenance type");
  const { attestations } = await fetchJson(document.dist.attestations.url, (body) =>
    body.attestations?.some((attestation) => attestation.predicateType === provenance)
      ? undefined
      : "no provenance attestation",
  );
  const bundle = attestations.find((attestation) => attestation.predicateType === provenance).bundle;
  const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));
  const subject = `pkg:npm/${manifest.name}@${version}`;
  expect(
    statement.subject.find((entry) => entry.name === subject)?.digest?.sha512,
    sha512.toString("hex"),
    `The provenance's SHA-512 digest of ${subject}`,
  );
  const build = statement.predicate.buildDefinition;
  expect(build.externalParameters.workflow.repository, repository, "The provenance's repository");
  expect(build.externalParameters.workflow.path, workflow, "The provenance's workflow");
  const source = build.resolvedDependencies.find((entry) => entry.digest?.gitCommit)?.digest;
  if (commit) expect(source?.gitCommit, commit, "The provenance's commit");
  process.stdout.write(
    `${subject}: the registry's integrity and shasum match ${tarball}, and its provenance names ` +
      `${workflow} in ${repository} at commit ${source?.gitCommit}.\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
