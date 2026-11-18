// The dependency audit of CI and the Release workflow.
//
//   npm run check:audit
//
// Audits the committed lockfile's full root tree, development, optional and peer dependencies
// included, even when npm's configuration would omit them, ignore the lockfile or work offline.
// It fails on every high or critical advisory apart from those listed in audit-exceptions.json.
// A package that npm reports at or above that threshold passes only when every advisory at or
// above it that the package reaches through its `via` chain is listed. Each entry excuses one
// advisory of one package, and only while that package is in neither the installed dependency
// tree nor the bundled parser's reviewed package graph (parser-packages.json). An entry whose
// advisory no longer needs it, or has changed since the decision, prints a warning. An audit
// that fails to run, or a report that this script cannot read, fails the step: npm exits with
// the same status for its own errors as for findings. The Obsidian harness in scripts/obsidian/
// has its own dependency tree, which this audit does not cover. The dependency guide,
// internals/dependencies.md, describes when an entry may be added.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** @typedef {"info" | "low" | "moderate" | "high" | "critical"} Severity */
/** @typedef {{ name: string, title: string, url: string, range: string, severity: Severity }} Advisory */
/** @typedef {{ name: string, severity: Severity, via: (string | Advisory)[] }} Vulnerability */
/** @typedef {{ vulnerabilities: Record<string, Vulnerability> }} Report */
/**
 * @typedef {{ advisory: string, package: string, severity: Severity, range: string, reason: string,
 *   issue: string, decided: string, reconsider: string[] }} Exception
 */

/** npm's severities, lowest first. @type {Severity[]} */
export const severities = ["info", "low", "moderate", "high", "critical"];
/** The lowest severity that fails the audit. */
export const threshold = "high";
/**
 * The whole root tree of the committed lockfile, whatever the environment's npm configuration
 * says. npm leaves out of the request every package type that `omit` names and `include` does
 * not; in offline mode it prints an empty report without asking the registry; and without
 * `package-lock` it audits a tree resolved afresh from what is installed.
 */
export const auditArguments = [
  "audit",
  "--json",
  "--offline=false",
  "--package-lock=true",
  "--include=dev",
  "--include=optional",
  "--include=peer",
];

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rank = (severity) => severities.indexOf(severity);
const limit = rank(threshold);
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim() !== "";
const ghsa = /^GHSA(?:-[0-9a-z]{4}){3}$/;
const advisoryUrl = /^https:\/\/github\.com\/advisories\/(GHSA(?:-[0-9a-z]{4}){3})$/;
const issueUrl = /^https:\/\/github\.com\/viell-dev\/slop-markdown-tools\/issues\/[1-9]\d*$/;
const packageName = /^(?:@[^\s/@]+\/)?[^\s/@]+$/;
const exceptionFields = [
  "advisory",
  "package",
  "severity",
  "range",
  "reason",
  "issue",
  "decided",
  "reconsider",
];
const fail = (message) => {
  throw new Error(message);
};
/** Report text on one line, so that it cannot start a workflow command of its own. */
const oneLine = (value) => String(value).replace(/[\r\n]+/g, " ");
/** A GitHub workflow annotation, with its message escaped as the runner expects. */
const annotation = (kind, message) => `::${kind}::${oneLine(message).replaceAll("%", "%25")}`;

/**
 * Check the listed exceptions, so that a malformed entry cannot excuse anything.
 * @param {unknown} entries
 * @returns {Exception[]}
 */
export function readExceptions(entries) {
  if (!Array.isArray(entries)) fail("The audit exceptions are not a list");
  const seen = new Set();
  for (const entry of entries) {
    const label = isObject(entry) && text(entry.advisory) ? entry.advisory : "An audit exception";
    if (!isObject(entry)) fail(`${label} is not an object`);
    const fields = Object.keys(entry);
    if (
      fields.length !== exceptionFields.length ||
      !exceptionFields.every((field) => fields.includes(field))
    )
      fail(`${label} must have exactly the fields ${exceptionFields.join(", ")}`);
    if (!ghsa.test(entry.advisory)) fail(`${label}: advisory is not a GHSA identifier`);
    if (typeof entry.package !== "string" || !packageName.test(entry.package))
      fail(`${label}: package is not a package name`);
    // An entry below the threshold would excuse nothing.
    if (rank(entry.severity) < limit) fail(`${label}: severity must be ${threshold} or above`);
    if (!text(entry.range)) fail(`${label}: range is empty`);
    if (!text(entry.reason)) fail(`${label}: reason is empty`);
    if (typeof entry.issue !== "string" || !issueUrl.test(entry.issue))
      fail(`${label}: issue is not an issue of this repository`);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(entry.decided) ? new Date(entry.decided) : undefined;
    if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== entry.decided)
      fail(`${label}: decided is not a date written YYYY-MM-DD`);
    if (!Array.isArray(entry.reconsider) || !entry.reconsider.length)
      fail(`${label}: reconsider lists no triggers`);
    if (!entry.reconsider.every(text)) fail(`${label}: reconsider has an empty trigger`);
    const key = `${entry.advisory} ${entry.package}`;
    if (seen.has(key)) fail(`${label} is listed twice for ${entry.package}`);
    seen.add(key);
  }
  return entries;
}

/**
 * The packages that ship with mdrefine, with where each ships: every lockfile entry outside
 * the development-only tree, and the bundled parser's reviewed package graph.
 * @param {unknown} lockfile package-lock.json
 * @param {unknown} bundled scripts/parser-packages.json
 * @returns {Map<string, string[]>}
 */
export function shippedPackages(lockfile, bundled) {
  if (
    !isObject(lockfile) ||
    ![2, 3].includes(lockfile.lockfileVersion) ||
    !isObject(lockfile.packages)
  )
    fail("package-lock.json is not a lockfile of version 2 or 3");
  if (!Array.isArray(bundled) || !bundled.length || !bundled.every((entry) => text(entry?.name)))
    fail("scripts/parser-packages.json is not a list of packages");
  /** @type {Map<string, string[]>} */
  const shipped = new Map();
  const add = (name, place) => {
    const places = shipped.get(name) ?? [];
    if (!places.includes(place)) places.push(place);
    shipped.set(name, places);
  };
  const directory = "node_modules/";
  for (const [location, entry] of Object.entries(lockfile.packages)) {
    if (!isObject(entry)) fail(`package-lock.json has an unexpected entry at ${location}`);
    // npm marks the packages that only development dependencies reach; the rest install with
    // mdrefine, optional ones included.
    if (location === "" || entry.dev === true) continue;
    const index = location.lastIndexOf(directory);
    add(
      entry.name ?? (index < 0 ? location : location.slice(index + directory.length)),
      "installed tree",
    );
  }
  for (const { name } of bundled) add(name, "bundled parser");
  return shipped;
}

const describeError = (report) =>
  oneLine(
    [
      typeof report.error === "string" ? report.error : report.error?.code,
      report.error?.summary,
      report.message,
    ]
      .filter((part) => text(part))
      .join(": ") || "no description",
  );
const isAdvisory = (via) =>
  isObject(via) &&
  text(via.name) &&
  typeof via.title === "string" &&
  typeof via.url === "string" &&
  typeof via.range === "string" &&
  severities.includes(via.severity);

/**
 * Read npm's result as an audit report of version 2 whose counts agree with its entries.
 * Anything else, including npm's own error report, throws.
 * @param {{ status: number | null, signal?: string | null, stdout?: string, error?: Error }} result
 * @returns {Report}
 */
export function readReport(result) {
  if (result.error) fail(`npm audit did not run: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1)
    fail(
      `npm audit ended with ${result.signal ? `signal ${result.signal}` : `status ${result.status}`}`,
    );
  let report;
  try {
    report = JSON.parse(result.stdout ?? "");
  } catch {
    fail("npm audit printed no JSON report");
  }
  if (!isObject(report)) fail("npm audit printed no JSON report");
  if (Object.hasOwn(report, "error")) fail(`npm audit failed: ${describeError(report)}`);
  if (report.auditReportVersion !== 2)
    fail(`npm audit printed a report of unknown version ${oneLine(report.auditReportVersion)}`);
  const { vulnerabilities, metadata } = report;
  if (!isObject(vulnerabilities) || !isObject(metadata?.vulnerabilities))
    fail("npm audit printed a report without its vulnerabilities or their counts");
  const counts = new Map(severities.map((severity) => [severity, 0]));
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!isObject(entry) || entry.name !== name || !severities.includes(entry.severity))
      fail(`npm audit printed an unexpected entry for ${oneLine(name)}`);
    if (!Array.isArray(entry.via) || !entry.via.length)
      fail(`npm audit printed no via list for ${oneLine(name)}`);
    for (const via of entry.via) {
      // npm lists each advisory under the package it affects, and another vulnerable package
      // that this one depends on by that package's name.
      if (
        typeof via === "string"
          ? !Object.hasOwn(vulnerabilities, via)
          : !isAdvisory(via) || via.name !== name
      )
        fail(`npm audit printed an unexpected via entry for ${oneLine(name)}`);
      // The gate reads each package's severity, as `npm audit --audit-level` does. npm gives a
      // package at least the severity of its own advisories; a package that only reaches an
      // advisory through another one can have less, and that other package then counts.
      if (typeof via !== "string" && rank(via.severity) > rank(entry.severity))
        fail(`npm audit reports ${oneLine(name)} below the severity of its own advisory`);
    }
    counts.set(entry.severity, counts.get(entry.severity) + 1);
  }
  const total = Object.keys(vulnerabilities).length;
  for (const [severity, count] of counts)
    if (metadata.vulnerabilities[severity] !== count)
      fail(`npm audit's ${severity} count disagrees with its entries`);
  if (metadata.vulnerabilities.total !== total)
    fail("npm audit's total disagrees with its entries");
  if (result.status === 1 && total === 0) fail("npm audit failed without findings or an error");
  return report;
}

/**
 * The advisories that a package reaches through its via chain, its own included. The chain
 * can have cycles: two packages can each name the other.
 * @param {Record<string, Vulnerability>} vulnerabilities
 * @param {string} name
 * @returns {Advisory[]}
 */
function reachedAdvisories(vulnerabilities, name) {
  /** @type {Set<Advisory>} */
  const advisories = new Set();
  const visited = new Set();
  const pending = [name];
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const via of vulnerabilities[current].via)
      if (typeof via === "string") pending.push(via);
      else advisories.add(via);
  }
  return [...advisories];
}

/** The advisory's GHSA identifier, read only from a GitHub advisory URL. */
const advisoryGhsa = (advisory) => advisoryUrl.exec(advisory.url)?.[1];
const advisoryId = (advisory) => advisoryGhsa(advisory) ?? advisory.url;
const excuses = (exception, advisory) =>
  advisory.name === exception.package && advisoryGhsa(advisory) === exception.advisory;

/**
 * Apply the exceptions to a report from readReport.
 * @param {Report} report
 * @param {Exception[]} exceptions
 * @param {Map<string, string[]>} shipped from shippedPackages
 */
export function evaluate(report, exceptions, shipped) {
  const { vulnerabilities } = report;
  /**
   * Advisories that are not excused, by package and URL, with the packages that reach them.
   * @type {Map<string, { advisory: string, package: string, severity: Severity, title: string, url: string, reachedBy: string[] }>}
   */
  const blocking = new Map();
  /**
   * Packages at or above the threshold that reach no advisory that is.
   * @type {{ package: string, severity: Severity }[]}
   */
  const unexplained = [];
  /**
   * Packages at or above the threshold that reach only excused advisories, by exception.
   * @type {Map<Exception, string[]>}
   */
  const excused = new Map(exceptions.map((exception) => [exception, []]));
  let below = 0;
  for (const name of Object.keys(vulnerabilities).sort()) {
    const { severity } = vulnerabilities[name];
    if (rank(severity) < limit) {
      below++;
      continue;
    }
    const serious = reachedAdvisories(vulnerabilities, name).filter(
      (advisory) => rank(advisory.severity) >= limit,
    );
    if (!serious.length) unexplained.push({ package: name, severity });
    const unexcused = serious.filter(
      (advisory) => !exceptions.some((exception) => excuses(exception, advisory)),
    );
    // A package passes only when every advisory at or above the threshold that it reaches is
    // listed; otherwise it counts once for each advisory that is not.
    if (serious.length && !unexcused.length)
      for (const exception of exceptions)
        if (serious.some((advisory) => excuses(exception, advisory)))
          excused.get(exception).push(name);
    for (const advisory of unexcused) {
      const key = `${advisory.name} ${advisory.url}`;
      const entry = blocking.get(key) ?? {
        advisory: advisoryId(advisory),
        package: advisory.name,
        severity: advisory.severity,
        title: advisory.title,
        url: advisory.url,
        reachedBy: [],
      };
      entry.reachedBy.push(name);
      blocking.set(key, entry);
    }
  }
  /** @type {{ exception: Exception, places: string[] }[]} */
  const shippedExceptions = [];
  /** @type {{ exception: Exception, state: "absent" | "below" | "changed", now?: string[] }[]} */
  const stale = [];
  /** @type {Advisory[]} */
  const listed = Object.values(vulnerabilities).flatMap((entry) =>
    entry.via.filter((via) => typeof via !== "string"),
  );
  for (const exception of exceptions) {
    const places = shipped.get(exception.package);
    if (places) shippedExceptions.push({ exception, places });
    const matching = listed.filter((advisory) => excuses(exception, advisory));
    if (!matching.length) stale.push({ exception, state: "absent" });
    else if (matching.every((advisory) => rank(advisory.severity) < limit))
      stale.push({ exception, state: "below" });
    else if (
      matching.some(
        (advisory) =>
          advisory.severity !== exception.severity || advisory.range !== exception.range,
      )
    )
      stale.push({
        exception,
        state: "changed",
        now: matching.map((advisory) => `${advisory.severity} for ${advisory.range}`),
      });
  }
  return {
    blocking: [...blocking.values()],
    unexplained,
    shipped: shippedExceptions,
    excused: [...excused].filter(([, names]) => names.length),
    stale,
    above: Object.keys(vulnerabilities).length - below,
    below,
  };
}

/**
 * Run the gate on npm's result and the repository's data, given as functions that read it.
 * Every problem, including one that stops the audit or the data from being read, fails it.
 * @param {{ result: Parameters<typeof readReport>[0], exceptions: () => unknown, lockfile: () => unknown, bundled: () => unknown }} inputs
 */
export function runGate({ result, exceptions, lockfile, bundled }) {
  const lines = [];
  try {
    const listed = readExceptions(exceptions());
    const shipped = shippedPackages(lockfile(), bundled());
    const outcome = evaluate(readReport(result), listed, shipped);
    for (const entry of outcome.blocking)
      lines.push(
        annotation(
          "error",
          `${entry.advisory} in ${entry.package} (${entry.severity}) is not excused: ${entry.title}. ` +
            `Reached by ${entry.reachedBy.join(", ")}. ${entry.url}`,
        ),
      );
    for (const entry of outcome.unexplained)
      lines.push(
        annotation(
          "error",
          `npm reports ${entry.package} as ${entry.severity}, but it reaches no advisory at or above ${threshold}.`,
        ),
      );
    for (const { exception, places } of outcome.shipped)
      lines.push(
        annotation(
          "error",
          `${exception.package} is in the ${places.join(" and ")}, so the exception for ${exception.advisory} no longer holds: ` +
            `an exception covers only packages outside the installed and bundled code. Remove it, or reconsider it on ${exception.issue}.`,
        ),
      );
    for (const { exception, state, now } of outcome.stale)
      lines.push(
        annotation(
          "warning",
          state === "changed"
            ? `${exception.advisory} in ${exception.package} has changed since the decision of ${exception.decided} ` +
                `(now ${now.join("; ")}): reconsider its exception on ${exception.issue}.`
            : `${exception.advisory} in ${exception.package} ${state === "absent" ? "no longer appears in the audit" : `is now below ${threshold}`}: ` +
                `its exception can be removed (${exception.issue}).`,
        ),
      );
    for (const [exception, names] of outcome.excused)
      lines.push(
        `Excused ${exception.advisory} in ${exception.package} (${exception.severity}), decided ${exception.decided} on ${exception.issue}; ` +
          `reached by ${names.map(oneLine).join(", ")}.`,
      );
    const failed = outcome.blocking.length + outcome.unexplained.length + outcome.shipped.length;
    lines.push(
      `Dependency audit ${failed ? "failed" : "passed"}: ${outcome.above} vulnerable packages at or above ${threshold}, ${outcome.below} below.`,
    );
    return { passed: !failed, lines };
  } catch (error) {
    lines.push(annotation("error", `Dependency audit failed: ${error.message}`));
    return { passed: false, lines };
  }
}

function main() {
  const npm = process.env.npm_execpath;
  if (!npm || process.argv.length > 2) {
    process.stderr.write("Usage: npm run check:audit\n");
    process.exit(2);
  }
  const read = (file) => () => JSON.parse(readFileSync(path.join(root, file), "utf8"));
  const result = spawnSync(process.execPath, [npm, ...auditArguments], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  const gate = runGate({
    result,
    exceptions: read("scripts/audit-exceptions.json"),
    lockfile: read("package-lock.json"),
    bundled: read("scripts/parser-packages.json"),
  });
  process.stdout.write(`${gate.lines.join("\n")}\n`);
  process.exitCode = gate.passed ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
