import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditArguments,
  evaluate,
  readExceptions,
  readReport,
  runGate,
  shippedPackages,
  threshold,
} from "../../scripts/dependency-audit.mjs";
import { repository } from "../support/cli.js";

// Synthetic npm audit reports, shaped like npm 11's `npm audit --json`: packages that npm finds
// vulnerable, each with its own advisories or the names of other vulnerable packages in `via`.
type Severity = "info" | "low" | "moderate" | "high" | "critical";
type Advisory = ReturnType<typeof advisory>;
type Exception = ReturnType<typeof readExceptions>[number];
let source = 1000;
const advisory = (name: string, id: string, severity: Severity, range = "<=4.0.7") => ({
  source: source++,
  name,
  dependency: name,
  title: `Synthetic ${severity} advisory for ${name}`,
  url: `https://github.com/advisories/${id}`,
  severity,
  cwe: ["CWE-1333"],
  cvss: { score: 0, vectorString: null },
  range,
});
const report = (entries: Record<string, { severity: Severity; via: (string | Advisory)[] }>) => {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const entry of Object.values(entries)) counts[entry.severity]++;
  return {
    auditReportVersion: 2,
    vulnerabilities: Object.fromEntries(
      Object.entries(entries).map(([name, entry]) => [
        name,
        {
          name,
          severity: entry.severity,
          isDirect: false,
          via: entry.via,
          effects: [],
          range: "*",
          nodes: [`node_modules/${name}`],
          fixAvailable: false,
        },
      ]),
    ),
    metadata: {
      vulnerabilities: { ...counts, total: Object.keys(entries).length },
      dependencies: { prod: 3, dev: 9, optional: 0, peer: 0, peerOptional: 0, total: 12 },
    },
  };
};
/** npm's result: JSON on standard output, with status 1 whenever it finds anything. */
const npm = (value: unknown, status = 1) => ({
  status,
  signal: null,
  stdout: typeof value === "string" ? value : JSON.stringify(value, null, 2),
});

const excusedId = "GHSA-2222-3333-4444";
const exception: Exception = {
  advisory: excusedId,
  package: "globber",
  severity: "high",
  range: "<=4.0.7",
  reason: "Synthetic: only development tools match the repository's own patterns with it.",
  issue: "https://github.com/viell-dev/slop-markdown-tools/issues/965",
  decided: "2026-11-18",
  reconsider: ["A fixed release.", "A changed advisory.", "Shipped code."],
};
const excusedAdvisory = advisory("globber", excusedId, "high");
const moderate = advisory("matcher", "GHSA-5555-6666-7777", "moderate", "<11.0.1");
/**
 * Modelled on the actual graph: one excused high advisory reached through several tools, a
 * cycle between a test runner and its coverage plugin, a linter that reaches the excused
 * advisory and a moderate one, and a plugin that npm reports as moderate although it reaches
 * the high advisory through another package, as npm does for typescript-eslint's packages.
 */
const entries = () => ({
  globber: { severity: "high" as Severity, via: [excusedAdvisory] },
  walker: { severity: "high" as Severity, via: ["globber"] },
  finder: { severity: "high" as Severity, via: ["walker", "globber"] },
  tester: { severity: "high" as Severity, via: ["coverage", "globber", "finder"] },
  coverage: { severity: "high" as Severity, via: ["tester"] },
  linter: { severity: "high" as Severity, via: ["matcher", "finder"] },
  matcher: { severity: "moderate" as Severity, via: [moderate] },
  formatter: { severity: "moderate" as Severity, via: ["matcher"] },
  plugin: { severity: "moderate" as Severity, via: ["finder", "matcher"] },
});
const reachers = ["coverage", "finder", "globber", "linter", "tester", "walker"];
const lockfile = (extra: Record<string, object> = {}) => ({
  name: "probe",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": { name: "probe", version: "1.0.0" },
    "node_modules/runtime": { version: "1.0.0" },
    "node_modules/globber": { version: "4.0.7", dev: true },
    "node_modules/walker": { version: "6.5.0", dev: true },
    ...extra,
  },
});
const bundled = [{ name: "parser-core", version: "1.0.0", license: "MIT" }];
const gate = (
  result: Parameters<typeof readReport>[0],
  {
    exceptions = [exception],
    lock = lockfile(),
    parser = bundled,
  }: { exceptions?: unknown; lock?: unknown; parser?: unknown } = {},
) => runGate({ result, exceptions: () => exceptions, lockfile: () => lock, bundled: () => parser });
const outcome = (value: unknown, shipped = new Map<string, string[]>()) =>
  evaluate(readReport(npm(value)), [exception], shipped);
const errors = (lines: string[]) => lines.filter((line) => line.startsWith("::error::"));
const warnings = (lines: string[]) => lines.filter((line) => line.startsWith("::warning::"));

/**
 * The test's environment with some variables replaced or removed. Windows ignores the case of
 * their names, so npm's `NPM_EXECPATH` would otherwise survive next to `npm_execpath`.
 */
const environment = (changes: Record<string, string | undefined>) => {
  const replaced = new Set(Object.keys(changes).map((name) => name.toLowerCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env))
    if (!replaced.has(name.toLowerCase())) env[name] = value;
  for (const [name, value] of Object.entries(changes)) if (value !== undefined) env[name] = value;
  return env;
};
/** The npm that runs these tests, as the other integration tests use it. */
const realNpm = () => {
  const npm = process.env.npm_execpath;
  expect(npm, "run the tests through npm").toBeTruthy();
  return npm!;
};

describe("the dependency audit's policy", () => {
  it("fails at high", () => {
    expect(threshold).toBe("high");
  });
  // npm's own reading of the arguments, under configuration that would narrow the audit.
  it.each(["dev", "optional", "peer"])(
    "audits the lockfile online with every package type, even when the environment omits %s, works offline and ignores the lockfile",
    (omitted) => {
      const result = spawnSync(
        process.execPath,
        [realNpm(), ...auditArguments.slice(1), "config", "get", "omit", "offline", "package-lock"],
        {
          cwd: repository,
          encoding: "utf8",
          windowsHide: true,
          env: environment({
            npm_config_omit: omitted,
            npm_config_offline: "true",
            npm_config_package_lock: "false",
          }),
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.split(/\r?\n/).filter(Boolean)).toEqual([
        "omit=",
        "offline=false",
        "package-lock=true",
      ]);
    },
  );
});

describe("listed advisories", () => {
  it("excuse a package that reaches only them, through via chains with a cycle", () => {
    const result = outcome(report(entries()));
    expect(result.blocking).toEqual([]);
    expect(result.unexplained).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.excused).toEqual([[exception, reachers]]);
    expect([result.above, result.below]).toEqual([6, 3]);
    const { passed, lines } = gate(npm(report(entries())));
    expect(passed).toBe(true);
    expect(errors(lines)).toEqual([]);
    expect(warnings(lines)).toEqual([]);
    expect(lines).toContain(
      `Excused ${excusedId} in globber (high), decided 2026-11-18 on ${exception.issue}; ` +
        `reached by ${reachers.join(", ")}.`,
    );
    expect(lines.at(-1)).toBe(
      "Dependency audit passed: 6 vulnerable packages at or above high, 3 below.",
    );
  });
  it("leave every other high or critical advisory failing", () => {
    for (const severity of ["high", "critical"] as const) {
      const other = advisory("loader", "GHSA-8888-9999-aaaa", severity);
      const value = report({ ...entries(), loader: { severity, via: [other] } });
      const result = outcome(value);
      expect(result.blocking).toEqual([
        {
          advisory: "GHSA-8888-9999-aaaa",
          package: "loader",
          severity,
          title: other.title,
          url: other.url,
          reachedBy: ["loader"],
        },
      ]);
      const { passed, lines } = gate(npm(value));
      expect(passed).toBe(false);
      expect(errors(lines)).toEqual([
        `::error::GHSA-8888-9999-aaaa in loader (${severity}) is not excused: ${other.title}. ` +
          `Reached by loader. ${other.url}`,
      ]);
      expect(lines.at(-1)).toMatch(/^Dependency audit failed: /);
    }
  });
  it("do not excuse another advisory of the same package, or the same advisory elsewhere", () => {
    const another = advisory("globber", "GHSA-cccc-dddd-eeee", "high");
    const sameId = advisory("other-glob", excusedId, "high");
    const value = report({
      ...entries(),
      globber: { severity: "high", via: [excusedAdvisory, another] },
      "other-glob": { severity: "high", via: [sameId] },
    });
    const result = outcome(value);
    expect(
      result.blocking.map((entry) => [entry.advisory, entry.package, entry.reachedBy]),
    ).toEqual([
      ["GHSA-cccc-dddd-eeee", "globber", reachers],
      [excusedId, "other-glob", ["other-glob"]],
    ]);
    expect(result.excused).toEqual([]);
    expect(gate(npm(value)).passed).toBe(false);
  });
  it("match the identifier only in an advisory's GitHub URL", () => {
    const bare = { ...excusedAdvisory, url: excusedId };
    const result = outcome(report({ globber: { severity: "high", via: [bare] } }));
    expect(result.blocking.map((entry) => [entry.advisory, entry.package])).toEqual([
      [excusedId, "globber"],
    ]);
    expect(result.excused).toEqual([]);
  });
  it("fail a package that reaches a listed advisory and another one through via", () => {
    const other = advisory("loader", "GHSA-8888-9999-aaaa", "critical");
    const value = report({
      ...entries(),
      bundler: { severity: "critical", via: ["walker", "loader"] },
      loader: { severity: "critical", via: [other] },
    });
    const result = outcome(value);
    expect(result.blocking.map((entry) => [entry.advisory, entry.reachedBy])).toEqual([
      ["GHSA-8888-9999-aaaa", ["bundler", "loader"]],
    ]);
    // The parent passes only when every advisory it reaches is listed.
    expect(result.excused).toEqual([[exception, reachers]]);
    expect(gate(npm(value)).passed).toBe(false);
  });
  it("leave moderate and low findings below the threshold", () => {
    const value = report({
      ...entries(),
      quiet: { severity: "low", via: [advisory("quiet", "GHSA-ffff-gggg-hhhh", "low")] },
    });
    const result = outcome(value);
    expect(result.blocking).toEqual([]);
    expect([result.above, result.below]).toEqual([6, 4]);
    // Only moderate and low findings: nothing fails, and the listed advisory is not needed.
    const { passed, lines } = gate(
      npm(
        report({
          matcher: entries().matcher,
          formatter: entries().formatter,
        }),
      ),
    );
    expect(passed).toBe(true);
    expect(errors(lines)).toEqual([]);
    expect(lines.at(-1)).toBe(
      "Dependency audit passed: 0 vulnerable packages at or above high, 2 below.",
    );
  });
});

describe("shipped code", () => {
  it.each([
    ["a production dependency", { "node_modules/runtime/node_modules/globber": { version: "1" } }],
    [
      "an optional dependency also reached in development",
      { "node_modules/runtime/node_modules/globber": { version: "1", devOptional: true } },
    ],
    ["an alias", { "node_modules/glob-alias": { name: "globber", version: "1" } }],
  ])("fails a listed package installed as %s", (_, extra) => {
    const shipped = shippedPackages(lockfile(extra), bundled);
    expect(shipped.get("globber")).toEqual(["installed tree"]);
    const { passed, lines } = gate(npm(report(entries())), { lock: lockfile(extra) });
    expect(passed).toBe(false);
    expect(errors(lines)).toEqual([
      `::error::globber is in the installed tree, so the exception for ${excusedId} no longer holds: ` +
        `an exception covers only packages outside the installed and bundled code. ` +
        `Remove it, or reconsider it on ${exception.issue}.`,
    ]);
  });
  it("fails a listed package in the bundled parser's package graph", () => {
    const parser = [...bundled, { name: "globber", version: "4.0.7", license: "MIT" }];
    expect(shippedPackages(lockfile(), parser).get("globber")).toEqual(["bundled parser"]);
    const { passed, lines } = gate(npm(report(entries())), { parser });
    expect(passed).toBe(false);
    expect(errors(lines)[0]).toMatch(/^::error::globber is in the bundled parser, /);
  });
  it("leaves development-only packages out", () => {
    const shipped = shippedPackages(lockfile(), bundled);
    expect([...shipped.keys()].sort()).toEqual(["parser-core", "runtime"]);
  });
  it("covers this repository's installed and bundled packages, and no listed one", () => {
    const read = (file: string) =>
      JSON.parse(readFileSync(path.join(repository, file), "utf8")) as unknown;
    const shipped = shippedPackages(
      read("package-lock.json"),
      read("scripts/parser-packages.json"),
    );
    // A production dependency and a bundled-only parser input, so the guard is not vacuous.
    expect(shipped.get("minimatch")).toEqual(["installed tree"]);
    expect(shipped.get("micromark-extension-gfm")).toEqual(["bundled parser"]);
    const listed = readExceptions(read("scripts/audit-exceptions.json"));
    for (const entry of listed) expect(shipped.has(entry.package), entry.package).toBe(false);
  });
});

describe("entries that are no longer needed", () => {
  it("warn without failing when the advisory no longer appears", () => {
    const { passed, lines } = gate(npm(report({ matcher: entries().matcher })));
    expect(passed).toBe(true);
    expect(warnings(lines)).toEqual([
      `::warning::${excusedId} in globber no longer appears in the audit: ` +
        `its exception can be removed (${exception.issue}).`,
    ]);
    // A clean audit, which npm reports with status 0.
    const clean = gate(npm(report({}), 0));
    expect(clean.passed).toBe(true);
    expect(warnings(clean.lines)).toHaveLength(1);
  });
  it("warn without failing when the advisory is now below the threshold", () => {
    const lowered = advisory("globber", excusedId, "moderate");
    const value = report({
      globber: { severity: "moderate", via: [lowered] },
      walker: { severity: "moderate", via: ["globber"] },
    });
    const { passed, lines } = gate(npm(value));
    expect(passed).toBe(true);
    expect(warnings(lines)).toEqual([
      `::warning::${excusedId} in globber is now below high: ` +
        `its exception can be removed (${exception.issue}).`,
    ]);
  });
  it.each([
    ["a fixed release", "high", "<4.0.8"],
    ["a raised severity", "critical", "<=4.0.7"],
  ] as const)(
    "warn to reconsider an advisory changed by %s, still excusing it",
    (_, severity, range) => {
      const changed = advisory("globber", excusedId, severity, range);
      const all = entries();
      const value = report(
        Object.fromEntries(
          Object.entries(all).map(([name, entry]) => [
            name,
            entry.severity === "high"
              ? { severity, via: name === "globber" ? [changed] : entry.via }
              : entry,
          ]),
        ),
      );
      const { passed, lines } = gate(npm(value));
      expect(passed).toBe(true);
      expect(warnings(lines)).toEqual([
        `::warning::${excusedId} in globber has changed since the decision of 2026-11-18 ` +
          `(now ${severity} for ${range}): reconsider its exception on ${exception.issue}.`,
      ]);
    },
  );
});

describe("an audit that cannot be read", () => {
  const registryError = {
    message: "request to https://registry.example/-/npm/v1/security/advisories/bulk failed",
    error: { summary: "", detail: "" },
  };
  const lockError = {
    error: { code: "ENOLOCK", summary: "This command requires an existing lockfile.", detail: "" },
  };
  const valid = report(entries());
  const miscounted = structuredClone(valid);
  miscounted.metadata.vulnerabilities.high = 5;
  const dangling = report({ ...entries(), walker: { severity: "high", via: ["missing"] } });
  const unknownSeverity = report(entries());
  (unknownSeverity.vulnerabilities.walker as { severity: string }).severity = "severe";
  const brokenAdvisory = report({
    ...entries(),
    globber: { severity: "high", via: [{ ...excusedAdvisory, url: undefined } as never] },
  });
  it.each([
    ["a registry failure", npm(registryError), `npm audit failed: ${registryError.message}`],
    [
      "a missing lockfile",
      npm(lockError),
      "npm audit failed: ENOLOCK: This command requires an existing lockfile.",
    ],
    [
      "an error given as text",
      npm({ error: "audit endpoint returned an error" }),
      "npm audit failed: audit endpoint returned an error",
    ],
    ["text that is not JSON", npm("npm ERR! something went wrong"), "printed no JSON report"],
    ["no output", npm(""), "printed no JSON report"],
    ["a JSON value that is not a report", npm("[]"), "printed no JSON report"],
    ["another report version", npm({ ...valid, auditReportVersion: 1 }), "unknown version 1"],
    ["no vulnerability list", npm({ auditReportVersion: 2 }), "without its vulnerabilities"],
    ["counts that disagree", npm(miscounted), "high count disagrees"],
    ["a via name it does not list", npm(dangling), "unexpected via entry for walker"],
    ["an unknown severity", npm(unknownSeverity), "unexpected entry for walker"],
    ["an advisory without its URL", npm(brokenAdvisory), "unexpected via entry for globber"],
    [
      // It would otherwise borrow the exception of the package that the advisory names.
      "an advisory listed under another package",
      npm(report({ ...entries(), other: { severity: "high", via: [excusedAdvisory] } })),
      "unexpected via entry for other",
    ],
    [
      "a package below its own advisory",
      npm(report({ ...entries(), globber: { severity: "moderate", via: [excusedAdvisory] } })),
      "reports globber below the severity of its own advisory",
    ],
    ["failure status without findings", npm(report({}), 1), "without findings or an error"],
    ["another exit status", npm(valid, 2), "ended with status 2"],
    ["a signal", { status: null, signal: "SIGTERM", stdout: "" }, "ended with signal SIGTERM"],
    [
      "a failed start",
      { status: null, error: new Error("spawn ENOENT") },
      "did not run: spawn ENOENT",
    ],
  ])("fails on %s", (_, result, message) => {
    expect(() => readReport(result)).toThrow(message);
    const { passed, lines } = gate(result);
    expect(passed).toBe(false);
    expect(errors(lines)).toHaveLength(1);
    expect(errors(lines)[0]).toContain(message);
  });
  it("fails a package that npm reports as high without a high advisory", () => {
    const value = report({
      ...entries(),
      odd: { severity: "high", via: [advisory("odd", "GHSA-jjjj-kkkk-mmmm", "moderate")] },
    });
    const { passed, lines } = gate(npm(value));
    expect(passed).toBe(false);
    expect(errors(lines)).toEqual([
      "::error::npm reports odd as high, but it reaches no advisory at or above high.",
    ]);
  });
  it("keeps report text on one line, so that it cannot start a workflow command", () => {
    const other = {
      ...advisory("loader", "GHSA-8888-9999-aaaa", "high"),
      title: "Line one\n::warning::injected 100%",
    };
    const { lines } = gate(
      npm(report({ ...entries(), loader: { severity: "high", via: [other] } })),
    );
    expect(lines.some((line) => line.startsWith("::warning::"))).toBe(false);
    expect(errors(lines)[0]).toContain("Line one ::warning::injected 100%25.");
  });
});

describe("the exception list", () => {
  it("is valid in this repository", () => {
    const listed = readExceptions(
      JSON.parse(readFileSync(path.join(repository, "scripts/audit-exceptions.json"), "utf8")),
    );
    for (const entry of listed) expect(entry.issue).toMatch(/\/issues\/\d+$/);
  });
  it.each([
    ["a missing field", { reason: undefined }, "must have exactly the fields"],
    ["an end date", { expires: "2026-12-01" }, "must have exactly the fields"],
    ["a malformed identifier", { advisory: "CVE-2026-112366" }, "not a GHSA identifier"],
    ["no package", { package: "" }, "not a package name"],
    ["a moderate severity", { severity: "moderate" }, "severity must be high or above"],
    ["no range", { range: " " }, "range is empty"],
    ["no reason", { reason: "" }, "reason is empty"],
    [
      "another repository's issue",
      { issue: "https://github.com/micromatch/picomatch/issues/234" },
      "not an issue of this repository",
    ],
    ["an impossible date", { decided: "2026-02-30" }, "not a date written YYYY-MM-DD"],
    ["no triggers", { reconsider: [] }, "lists no triggers"],
    ["an empty trigger", { reconsider: ["A fixed release.", ""] }, "has an empty trigger"],
  ])("rejects %s, failing the gate", (_, change, message) => {
    const entry = JSON.parse(JSON.stringify({ ...exception, ...change })) as unknown;
    expect(() => readExceptions([entry])).toThrow(message);
    const { passed, lines } = gate(npm(report(entries())), { exceptions: [entry] });
    expect(passed).toBe(false);
    expect(errors(lines)[0]).toContain(message);
  });
  it("rejects a duplicate entry and a list that is not one", () => {
    expect(() => readExceptions([exception, { ...exception }])).toThrow("listed twice");
    expect(() => readExceptions({ ...exception })).toThrow("not a list");
  });
  it("fails the gate when the lockfile or the parser graph cannot be used", () => {
    expect(gate(npm(report(entries())), { lock: { lockfileVersion: 1 } }).passed).toBe(false);
    expect(gate(npm(report(entries())), { parser: [] }).passed).toBe(false);
  });
});

// The command itself, with a stand-in for npm, so that nothing reaches the registry.
describe("npm run check:audit", () => {
  const script = path.join(repository, "scripts/dependency-audit.mjs");
  let directory = "";
  const listed = readExceptions(
    JSON.parse(readFileSync(path.join(repository, "scripts/audit-exceptions.json"), "utf8")),
  );
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "mdrefine-audit-"));
    await writeFile(
      path.join(directory, "npm.mjs"),
      `import { readFileSync, writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_NPM_ARGUMENTS, JSON.stringify(process.argv.slice(2)));
process.stdout.write(readFileSync(process.env.FAKE_NPM_OUTPUT, "utf8"));
process.exitCode = Number(process.env.FAKE_NPM_STATUS);
`,
    );
  });
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const run = async (output: unknown, status = 1, args: string[] = []) => {
    await writeFile(path.join(directory, "output.json"), JSON.stringify(output));
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: repository,
      encoding: "utf8",
      env: environment({
        npm_execpath: path.join(directory, "npm.mjs"),
        FAKE_NPM_ARGUMENTS: path.join(directory, "arguments.json"),
        FAKE_NPM_OUTPUT: path.join(directory, "output.json"),
        FAKE_NPM_STATUS: String(status),
      }),
    });
    return { ...result, lines: result.stdout.split("\n").filter(Boolean) };
  };
  it("passes with this repository's listed advisories and runs npm with the policy's arguments", async () => {
    const value = report(
      Object.fromEntries(
        listed.map((entry) => [
          entry.package,
          {
            severity: entry.severity,
            via: [advisory(entry.package, entry.advisory, entry.severity, entry.range)],
          },
        ]),
      ),
    );
    // npm exits with status 1 when it reports anything, and 0 for a clean audit.
    const result = await run(value, listed.length ? 1 : 0);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(errors(result.lines)).toEqual([]);
    expect(warnings(result.lines)).toEqual([]);
    expect(result.lines.filter((line) => line.startsWith("Excused "))).toHaveLength(listed.length);
    expect(
      JSON.parse(readFileSync(path.join(directory, "arguments.json"), "utf8")) as unknown,
    ).toEqual(auditArguments);
  });
  it("fails on an advisory that is not listed, and on npm's error report", async () => {
    const other = advisory("loader", "GHSA-8888-9999-aaaa", "high");
    const findings = await run(report({ loader: { severity: "high", via: [other] } }));
    expect(findings.status).toBe(1);
    expect(errors(findings.lines)[0]).toMatch(/^::error::GHSA-8888-9999-aaaa in loader /);
    const failure = await run({ error: { code: "ENOLOCK", summary: "No lockfile." } });
    expect(failure.status).toBe(1);
    expect(errors(failure.lines)).toEqual([
      "::error::Dependency audit failed: npm audit failed: ENOLOCK: No lockfile.",
    ]);
  });
  it("warns about each listed advisory that a clean audit no longer reports", async () => {
    const result = await run(report({}), 0);
    expect(result.status).toBe(0);
    expect(warnings(result.lines)).toHaveLength(listed.length);
  });
  it("fails with the real npm in offline mode when the registry cannot be reached", () => {
    // Offline, npm would print an empty report without asking the registry, which passes.
    const result = spawnSync(process.execPath, [script], {
      cwd: repository,
      encoding: "utf8",
      windowsHide: true,
      env: environment({
        npm_execpath: realNpm(),
        npm_config_offline: "true",
        npm_config_registry: "http://127.0.0.1:1/",
        npm_config_fetch_retries: "0",
      }),
    });
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(errors(result.stdout.split("\n"))).toEqual([
      expect.stringMatching(
        /^::error::Dependency audit failed: npm audit failed: .*127\.0\.0\.1:1/,
      ),
    ]);
  });
  it("refuses arguments and a run outside npm", async () => {
    expect((await run(report({}), 0, ["--omit=dev"])).status).toBe(2);
    const outside = spawnSync(process.execPath, [script], {
      cwd: repository,
      encoding: "utf8",
      env: environment({ npm_execpath: undefined }),
    });
    expect(outside.status).toBe(2);
    expect(outside.stderr).toContain("Usage: npm run check:audit");
  });
});
