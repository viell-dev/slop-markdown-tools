// PR routing only. Release always runs all three native workflows at its exact commit.
// Keep this dependency-free: classification and enforcement run before npm installs anything.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** @type {readonly ["rendering", "obsidian", "forges"]} */
export const hosts = ["rendering", "obsidian", "forges"];

// Changes to these roots have no native semantic effect: they serve VitePress, offline
// references, types or ordinary tools. Everything else, including new roots and development
// emit/build tools (rolldown/TypeScript), is native.
// Shared indirect packages inherit every root's role, regardless of npm's `dev` flag.
export const nonNativeDependencies = {
  vitepress: [
    "@mdit-vue/plugin-component",
    "@mdit/plugin-attrs",
    "@mdit/plugin-container",
    "@mdit/plugin-emoji",
    "@mdit/plugin-footnote",
    "@mdit/plugin-tasklist",
    "markdown-it",
    "markdown-it-cjk-friendly",
    "markdown-it-mathjax3",
    "vitepress",
  ],
  tools: [
    "@eslint/js",
    "@types/commonmark",
    "@types/cross-spawn",
    "@types/mdast",
    "@types/node",
    "@types/unist",
    "@vitest/coverage-v8",
    "commonmark",
    "eslint",
    "fast-check",
    "hast-util-to-html",
    "mdast-util-to-hast",
    "prettier",
    "typescript-eslint",
    "vitest",
  ],
};
const nonNative = new Set(Object.values(nonNativeDependencies).flat());
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const sha = /^[a-f0-9]{40}$/;

/** JSON equality independent of object key order. Arrays remain ordered. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const without = (object, keys) =>
  Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
const all = (reason) => ({ rendering: true, obsidian: true, forges: true, reasons: [reason] });

/** Resolve npm lockfile v3 package locations using Node's ancestor node_modules lookup. */
function resolve(packages, from, name) {
  if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name)) throw new Error(`Unknown dependency name: ${name}`);
  for (let directory = from; ; directory = path.posix.dirname(directory)) {
    if (path.posix.basename(directory) !== "node_modules") {
      const location = path.posix.join(directory, "node_modules", name);
      if (Object.hasOwn(packages, location)) return location;
    }
    if (!directory || directory === ".") return undefined;
  }
}

/** Both reachability and native reachability; unclassified changed lock entries fail closed. */
function graph(manifest, lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""]) throw new Error("Unsupported lockfile");
  const packages = lock.packages;
  for (const field of dependencyFields)
    if (!equal(manifest[field] ?? {}, packages[""][field] ?? {}))
      throw new Error(`Manifest/lockfile disagreement: ${field}`);
  const reached = new Set();
  const native = new Set();
  const visited = new Set();
  const visit = (location, isNative) => {
    const key = `${isNative}:${location}`;
    if (visited.has(key)) return;
    visited.add(key);
    reached.add(location);
    if (isNative) native.add(location);
    const entry = packages[location];
    if (!entry || entry.link) throw new Error(`Unsupported package location: ${location}`);
    // A dependency can also be optional: npm lets optionalDependencies override dependencies.
    const required = { ...entry.dependencies, ...entry.peerDependencies };
    const optional = { ...entry.optionalDependencies };
    for (const [name, metadata] of Object.entries(entry.peerDependenciesMeta ?? {}))
      if (metadata.optional) optional[name] = required[name];
    for (const name of new Set([...Object.keys(required), ...Object.keys(optional)])) {
      const target = resolve(packages, location, name);
      if (!target && !Object.hasOwn(optional, name)) throw new Error(`Missing dependency: ${name}`);
      if (target) visit(target, isNative);
    }
  };
  for (const field of dependencyFields)
    for (const name of Object.keys(manifest[field] ?? {})) {
      const location = resolve(packages, "", name);
      if (!location) throw new Error(`Missing root dependency: ${name}`);
      visit(location, !nonNative.has(name));
    }
  return { reached, native };
}

/** Whether a root manifest/lockfile change can affect a native check. */
function nativeDependencies(before, after) {
  const left = graph(before.manifest, before.lock);
  const right = graph(after.manifest, after.lock);
  if (
    !equal(without(before.manifest, dependencyFields), without(after.manifest, dependencyFields)) ||
    !equal(without(before.lock, ["packages"]), without(after.lock, ["packages"])) ||
    !equal(
      without(before.lock.packages[""], dependencyFields),
      without(after.lock.packages[""], dependencyFields),
    )
  )
    return true;
  const roots = (manifest) =>
    Object.assign({}, ...dependencyFields.map((field) => manifest[field]));
  const oldRoots = roots(before.manifest);
  const newRoots = roots(after.manifest);
  for (const name of new Set([...Object.keys(oldRoots), ...Object.keys(newRoots)]))
    if (!equal(oldRoots[name], newRoots[name]) && !nonNative.has(name)) return true;
  for (const location of new Set([
    ...Object.keys(before.lock.packages),
    ...Object.keys(after.lock.packages),
  ])) {
    if (!location || equal(before.lock.packages[location], after.lock.packages[location])) continue;
    if (
      left.native.has(location) ||
      right.native.has(location) ||
      (!left.reached.has(location) && !right.reached.has(location))
    )
      return true;
  }
  return false;
}

/**
 * An allowlist of irrelevant paths, with small host-specific scopes. Unknown paths select all.
 * @param {string[]} files Complete changed paths, including both sides of renames/deletions.
 * @param {{ manifest: any, lock: any }} [before]
 * @param {{ manifest: any, lock: any }} [after]
 */
export function classifyChanges(files, before, after) {
  const selection = { rendering: false, obsidian: false, forges: false, reasons: [] };
  if (!files.length) return all("No safe nonempty comparison; run every native check.");
  for (const file of files) {
    if (file === "package.json" || file === "package-lock.json") {
      try {
        if (!before || !after || nativeDependencies(before, after))
          return all("Native or unclassified dependency/manifest change.");
      } catch {
        return all("Dependency comparison unavailable or ambiguous; run every native check.");
      }
      selection.reasons.push(`${file}: only dependencies unused by native checks changed.`);
    } else if (/^(?:scripts\/obsidian(?:\/|-)|\.github\/workflows\/obsidian\.yml$)/.test(file)) {
      selection.obsidian = true;
      selection.reasons.push(`${file}: Obsidian harness.`);
    } else if (/^(?:scripts\/forge-|\.github\/workflows\/forges\.yml$)/.test(file)) {
      selection.forges = true;
      selection.reasons.push(`${file}: Forgejo/Gitea harness.`);
    } else if (
      /^(?:scripts\/github-rendering\.mjs|\.github\/workflows\/rendering\.yml)$/.test(file)
    ) {
      selection.rendering = true;
      selection.reasons.push(`${file}: GitHub harness.`);
    } else if (file.startsWith("tests/fixtures/renderers/")) {
      return all(`${file}: native renderer regression input.`);
    } else if (
      /^(?:docs\/|examples\/|benchmarks\/|tests\/|src\/syntax\/vitepress\/)/.test(file) ||
      /^(?:README|CHANGELOG|CONTRIBUTING|RELEASING|AGENTS|CODE_OF_CONDUCT|SECURITY)\.md$/.test(
        file,
      ) ||
      /^(?:LICENSE|THIRD_PARTY_NOTICES|\.gitignore|\.prettierignore|\.prettierrc\.json|eslint\.config\.js|vitest\.config\.ts)$/.test(
        file,
      ) ||
      /^\.github\/(?:ISSUE_TEMPLATE\/|labels\.json$|dependabot\.yml$|pull_request_template\.md$)/.test(
        file,
      )
    ) {
      selection.reasons.push(`${file}: offline checks cover this input.`);
    } else {
      return all(`${file}: shared native input or unknown path; run every native check.`);
    }
  }
  return selection;
}

/** Compare exact PR revisions locally, never GitHub's truncated changed-files API. */
export function classifyPullRequest(event, cwd = process.cwd()) {
  try {
    const { base, head } = event.pull_request;
    if (!sha.test(base.sha) || !sha.test(head.sha)) throw new Error("Missing PR revisions");
    const git = (...args) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    const ancestor = git("merge-base", "--all", base.sha, head.sha).trim();
    if (!sha.test(ancestor)) throw new Error("No unique merge base");
    const files = git("diff", "--no-renames", "--name-only", "-z", ancestor, head.sha, "--")
      .split("\0")
      .filter(Boolean);
    const snapshot = (ref) => ({
      manifest: JSON.parse(git("show", `${ref}:package.json`)),
      lock: JSON.parse(git("show", `${ref}:package-lock.json`)),
    });
    return files.some((file) => file === "package.json" || file === "package-lock.json")
      ? classifyChanges(files, snapshot(ancestor), snapshot(head.sha))
      : classifyChanges(files);
  } catch {
    return all("PR comparison unavailable or ambiguous; run every native check.");
  }
}

/** Reject a failed classifier, unknown output, or absent/unsuccessful applicable native call. */
export function validateNativeChecks(needs) {
  if (needs.classify?.result !== "success")
    throw new Error("Native classification did not succeed");
  const lines = [];
  for (const host of hosts) {
    const selected = needs.classify.outputs?.[host];
    if (selected !== "true" && selected !== "false") throw new Error(`Unknown selection: ${host}`);
    const expected = selected === "true" ? "success" : "skipped";
    if (needs[host]?.result !== expected)
      throw new Error(`${host}: expected ${expected} native call`);
    lines.push(`${host}: ${selected === "true" ? "passed" : "not applicable"}`);
  }
  return lines;
}

function main() {
  if (process.argv[2] === "classify") {
    const result =
      process.env.GITHUB_EVENT_NAME === "pull_request"
        ? classifyPullRequest(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")))
        : all("Not a pull request comparison; run every native check.");
    for (const host of hosts)
      appendFileSync(process.env.GITHUB_OUTPUT, `${host}=${result[host]}\n`);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Native input classification\n\n${result.reasons.map((reason) => `- ${reason}`).join("\n")}\n`,
    );
  } else if (process.argv[2] === "gate") {
    const lines = validateNativeChecks(JSON.parse(process.env.NATIVE_NEEDS));
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Native checks\n\n${lines.join("\n\n")}\n`);
  } else {
    throw new Error("Usage: node scripts/native-checks.mjs classify|gate");
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
