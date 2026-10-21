// Compare the live state of the repository's publications and settings with what the
// repository records, without changing anything.
//
//   node scripts/check-live.mjs
//
// - GitHub's labels are exactly those of .github/labels.json, with their colors and
//   descriptions, and its rulesets are those of .github/rulesets/.
// - The About description is the README's opening paragraph followed by "Agent-maintained.",
//   the homepage is package.json's, and the topics name every dialect's renderer.
// - The repository, Actions, environment, and Pages settings are those AGENTS.md and
//   RELEASING.md list, and the issue that AGENTS.md names is pinned.
// - The newest stable GitHub release is npm's `latest`, its assets are the tarball and its
//   checksum, and the tarball is the one npm serves.
// - The deployed site's version.json names that release, its tag's commit, and a commit that is
//   the tag's or descends from it with changes to docs/ only.
//
// Needs an authenticated gh with administrator access to the repository, which reading the
// Actions and environment settings requires, and the network. Each line of the report says
// what matched or how it differs; any difference exits with status 1. Maintainers run it at the
// start of maintenance, after changing a setting, and after each release.
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const file = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const manifest = JSON.parse(file("package.json"));
const repository = new URL(manifest.repository.url.replace(/^git\+/, "")).pathname
  .replace(/^\//, "")
  .replace(/\.git$/, "");
/** The renderers' topics, by dialect. */
const topics = {
  commonmark: "commonmark",
  github: "github-flavored-markdown",
  forgejo: "forgejo",
  gitea: "gitea",
  obsidian: "obsidian",
  vitepress: "vitepress",
};

/** `gh api` with the arguments, parsed as JSON. */
function gh(...parameters) {
  const text = execFileSync("gh", ["api", ...parameters], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(text);
}
/** JSON with sorted keys, so that two values compare by content. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const report = [];
let differences = 0;
/** Record one comparison: `problem` is undefined when it matched. */
function check(what, problem) {
  if (problem) differences++;
  report.push(`${problem ? "DIFFERS" : "ok"}  ${what}${problem ? `: ${problem}` : ""}`);
}
/** Run `compare`, recording what it throws as a difference rather than stopping. */
async function section(what, compare) {
  try {
    await compare();
  } catch (error) {
    const message = error instanceof Error ? (error.stderr || error.message).trim() : error;
    check(what, `could not be read: ${String(message).split("\n")[0]}`);
  }
}
const equal = (actual, expected) =>
  canonical(actual) === canonical(expected)
    ? undefined
    : `is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;

await section("labels", () => {
  const expected = JSON.parse(file(".github/labels.json"));
  const live = gh("--paginate", "--slurp", `repos/${repository}/labels?per_page=100`).flat();
  const byName = new Map(live.map((label) => [label.name, label]));
  for (const label of expected) {
    const actual = byName.get(label.name);
    check(
      `label ${label.name}`,
      actual
        ? equal(
            { color: actual.color, description: actual.description },
            { color: label.color, description: label.description },
          )
        : "is missing on GitHub",
    );
    byName.delete(label.name);
  }
  for (const name of byName.keys()) check(`label ${name}`, "is on GitHub but not in labels.json");
});

await section("rulesets", () => {
  const live = gh(`repos/${repository}/rulesets`);
  const files = readdirSync(new URL("../.github/rulesets/", import.meta.url)).filter((name) =>
    name.endsWith(".json"),
  );
  const names = new Set();
  for (const name of files) {
    const expected = JSON.parse(file(`.github/rulesets/${name}`));
    names.add(expected.name);
    const summary = live.find((ruleset) => ruleset.name === expected.name);
    if (!summary) {
      check(`ruleset ${expected.name}`, "is missing on GitHub");
      continue;
    }
    const actual = gh(`repos/${repository}/rulesets/${summary.id}`);
    const fields = ["target", "enforcement", "bypass_actors", "conditions", "rules"];
    check(
      `ruleset ${expected.name} (${name})`,
      fields
        .filter((field) => canonical(actual[field]) !== canonical(expected[field]))
        .map(
          (field) =>
            `${field} is ${canonical(actual[field])}, expected ${canonical(expected[field])}`,
        )
        .join("; ") || undefined,
    );
  }
  for (const ruleset of live)
    if (!names.has(ruleset.name)) check(`ruleset ${ruleset.name}`, "has no file");
});

await section("repository settings", () => {
  const live = gh(`repos/${repository}`);
  const opening = file("README.md")
    .split(/\r?\n\r?\n/)[1]
    .replace(/\s+/g, " ")
    .trim();
  check("About description", equal(live.description, `${opening} Agent-maintained.`));
  check("homepage", equal(live.homepage, manifest.homepage));
  const missing = Object.values(topics).filter((topic) => !live.topics.includes(topic));
  check("topics", missing.length ? `lack ${missing.join(", ")}` : undefined);
  check(
    "features and merge methods",
    equal(
      {
        has_wiki: live.has_wiki,
        has_projects: live.has_projects,
        has_discussions: live.has_discussions,
        allow_merge_commit: live.allow_merge_commit,
        allow_squash_merge: live.allow_squash_merge,
        allow_rebase_merge: live.allow_rebase_merge,
        delete_branch_on_merge: live.delete_branch_on_merge,
      },
      {
        has_wiki: false,
        has_projects: false,
        has_discussions: false,
        allow_merge_commit: true,
        allow_squash_merge: false,
        allow_rebase_merge: false,
        delete_branch_on_merge: true,
      },
    ),
  );
});

await section("Actions permissions", () => {
  const permissions = gh(`repos/${repository}/actions/permissions`);
  const selected = gh(`repos/${repository}/actions/permissions/selected-actions`);
  check(
    "Actions permissions",
    equal(
      {
        enabled: permissions.enabled,
        allowed_actions: permissions.allowed_actions,
        sha_pinning_required: permissions.sha_pinning_required,
        github_owned_allowed: selected.github_owned_allowed,
        verified_allowed: selected.verified_allowed,
        patterns_allowed: selected.patterns_allowed,
      },
      {
        enabled: true,
        allowed_actions: "selected",
        sha_pinning_required: true,
        github_owned_allowed: true,
        verified_allowed: false,
        patterns_allowed: [],
      },
    ),
  );
});

await section("publication settings", () => {
  for (const environment of ["npm-release", "github-pages"]) {
    const policies = gh(
      `repos/${repository}/environments/${environment}/deployment-branch-policies`,
    ).branch_policies.map((policy) => ({ name: policy.name, type: policy.type }));
    check(`environment ${environment}`, equal(policies, [{ name: "main", type: "branch" }]));
  }
  const variable = gh(`repos/${repository}/actions/variables/NPM_PUBLISH_ENABLED`);
  check("NPM_PUBLISH_ENABLED", equal(variable.value, "true"));
  check("Pages source", equal(gh(`repos/${repository}/pages`).build_type, "workflow"));
});

await section("pinned issue", () => {
  const pinned = /^- #(\d+), the overview of upstream defects, is pinned\.$/m.exec(
    file("AGENTS.md"),
  );
  const [owner, name] = repository.split("/");
  const result = gh(
    "graphql",
    "-f",
    `query=query { repository(owner: "${owner}", name: "${name}") { pinnedIssues(first: 3) { nodes { issue { number } } } } }`,
  );
  const numbers = result.data.repository.pinnedIssues.nodes.map((node) => node.issue.number);
  check(
    `issue #${pinned?.[1]} pinned`,
    pinned && numbers.includes(Number(pinned[1])) ? undefined : `pinned are ${numbers}`,
  );
});

let release;
await section("newest release", async () => {
  release = gh(`repos/${repository}/releases/latest`);
  const version = release.tag_name;
  const tags = await (
    await globalThis.fetch(`https://registry.npmjs.org/-/package/${manifest.name}/dist-tags`)
  ).json();
  check(`npm latest is the newest GitHub release, ${version}`, equal(tags.latest, version));
  const tarball = `${manifest.name}-${version}.tgz`;
  const assets = release.assets.map((asset) => asset.name).sort();
  check(`assets of ${version}`, equal(assets, ["SHA256SUMS", tarball]));
  const asset = (name) => release.assets.find((entry) => entry.name === name);
  if (!asset(tarball) || !asset("SHA256SUMS")) return;
  const download = async (name) =>
    Buffer.from(await (await globalThis.fetch(asset(name).browser_download_url)).arrayBuffer());
  const bytes = await download(tarball);
  const sums = (await download("SHA256SUMS")).toString("utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  check(
    `SHA256SUMS of ${version}`,
    sums.split("\n").some((line) => line.trim() === `${sha256}  ${tarball}`)
      ? undefined
      : `does not list ${sha256} for ${tarball}`,
  );
  const published = await (
    await globalThis.fetch(`https://registry.npmjs.org/${manifest.name}/${version}`)
  ).json();
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  check(
    `npm serves the tarball of the ${version} release`,
    equal(published.dist.integrity, integrity),
  );
});

await section("deployed site", async () => {
  if (!release) throw new Error("the newest release is unknown");
  const version = release.tag_name;
  const tagCommit = gh(`repos/${repository}/commits/tags/${version}`).sha;
  const response = await globalThis.fetch(new URL("version.json", manifest.homepage));
  if (!response.ok) throw new Error(`version.json: HTTP ${response.status}`);
  const site = await response.json();
  check(`site version`, equal(site.version, version));
  check(`site tag commit`, equal(site.tag?.commit, tagCommit));
  if (site.commit === tagCommit) return check("site commit is the tag's", undefined);
  const comparison = gh(`repos/${repository}/compare/${tagCommit}...${site.commit}`);
  const outside = comparison.files
    .map((entry) => entry.filename)
    .filter((name) => !name.startsWith("docs/"));
  check(
    `site commit ${site.commit} corrects the documentation of ${version}`,
    comparison.status !== "ahead"
      ? `is ${comparison.status} of the tag`
      : outside.length
        ? `also changes ${outside.join(", ")}`
        : undefined,
  );
});

process.stdout.write(`${report.join("\n")}\n`);
process.stdout.write(
  differences ? `${differences} differences.\n` : "The live state matches the repository.\n",
);
process.exit(differences ? 1 : 0);
