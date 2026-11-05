import { Buffer } from "node:buffer";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, rmdir, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, onTestFailed } from "vitest";
import { buildParser, bundleParser } from "../../scripts/build-parser.mjs";
import { parserAdaptationFiles } from "../../scripts/parser-adaptations.mjs";
import { fixture, linkDirectory, repository } from "../support/cli.js";

const artifactNames = [
  "parser.generated.d.ts",
  "parser.generated.LICENSES.txt",
  "parser.generated.manifest.json",
  "parser.generated.js",
] as const;
type ArtifactName = (typeof artifactNames)[number];
let expected: Record<ArtifactName, Buffer>;

async function expectedArtifacts(repositoryRoot: string): Promise<Record<ArtifactName, Buffer>> {
  // The real in-memory production builder is the byte oracle. Nothing is mocked
  // or written to the checkout's dist, and no parser implementation is copied.
  const bundle = await bundleParser({ repositoryRoot });
  return {
    "parser.generated.d.ts": Buffer.from(bundle.declaration),
    "parser.generated.LICENSES.txt": Buffer.from(bundle.licenses),
    "parser.generated.manifest.json": Buffer.from(`${JSON.stringify(bundle.manifest, null, 2)}\n`),
    "parser.generated.js": Buffer.from(bundle.code),
  };
}

beforeAll(async () => {
  expected = await expectedArtifacts(repository);
}, 30000);

async function completeArtifacts(directory: string, oracle = expected): Promise<void> {
  expect((await readdir(directory)).sort()).toEqual([...artifactNames].sort());
  for (const name of artifactNames) {
    const filename = path.join(directory, name);
    expect((await stat(filename)).isFile(), name).toBe(true);
    expect((await readFile(filename)).equals(oracle[name]), name).toBe(true);
  }
  const manifest = JSON.parse(
    await readFile(path.join(directory, "parser.generated.manifest.json"), "utf8"),
  ) as { runtimeSha256: string; declarationSha256: string; licensesSha256: string };
  for (const [name, hash] of [
    ["parser.generated.js", manifest.runtimeSha256],
    ["parser.generated.d.ts", manifest.declarationSha256],
    ["parser.generated.LICENSES.txt", manifest.licensesSha256],
  ] as const)
    expect(
      createHash("sha256")
        .update(await readFile(path.join(directory, name)))
        .digest("hex"),
    ).toBe(hash);
}

describe("the actual generated-parser writer", { concurrent: false }, () => {
  // The whole test took 11 to 17 seconds on passing hosted Windows runs, and its
  // three builds alone took 15 on a loaded runner (#786), which the integration
  // default leaves too little room for. Its child processes keep shorter limits.
  it("runs the command-line build through a linked checkout path", async () => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const phases: { phase: string; elapsedMs: number }[] = [];
    let copiedPackages = 0;
    const copyingPackages = new Set<string>();
    const mark = (phase: string): void => {
      phases.push({ phase, elapsedMs: performance.now() - started });
    };
    // Keep the passing path in memory; a failed body (including a timeout)
    // reports its last reached boundary without changing the work or deadline.
    onTestFailed(() => {
      console.error(
        "Linked-checkout failure phases:",
        JSON.stringify(
          {
            node: process.version,
            platform: process.platform,
            startedAt,
            elapsedMs: performance.now() - started,
            phases,
            copiedPackages,
            copyingPackages: [...copyingPackages],
            resources: process.resourceUsage(),
          },
          null,
          2,
        ),
      );
    });
    mark("read-inputs");
    const files: Record<string, string> = {};
    for (const name of [
      "package.json",
      "scripts/build-parser.mjs",
      "scripts/parser-patches.mjs",
      "scripts/parser-labels.mjs",
      "scripts/parser-adaptations.mjs",
      "scripts/parser-packages.json",
      "src/syntax/parser.generated.d.ts",
      ...parserAdaptationFiles(),
    ])
      files[`dev/micromark-util-edit-map/source/${name}`] = await readFile(
        path.join(repository, name),
        "utf8",
      );
    mark("create-fixture");
    const root = await fixture(files);
    const source = path.join(root, "dev/micromark-util-edit-map/source");
    // Checkout ancestors named dev or micromark-util-edit-map are legitimate;
    // they do not identify a development entry or an unadapted EditMap module.
    // The graph must stay inside the checkout;
    // canonical containment rejects outside inputs on every platform. Only
    // the build tool stays shared.
    mark("copy-dependencies");
    const packages = JSON.parse(
      await readFile(path.join(repository, "scripts/parser-packages.json"), "utf8"),
    ) as { name: string }[];
    const pending = packages.map(({ name }) => name);
    const closure = new Set<string>();
    while (pending.length) {
      const name = pending.pop()!;
      if (closure.has(name)) continue;
      closure.add(name);
      const metadata = JSON.parse(
        await readFile(path.join(repository, "node_modules", name, "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      // Bundlers resolve imports before tree shaking; include dependencies
      // whose code is absent from the final 34-package runtime graph too.
      pending.push(...Object.keys(metadata.dependencies ?? {}));
    }
    // The closure is hundreds of tiny files, and a loaded Windows runner spent
    // 26 ms on each (#786). Skip what the build never reads and overlap the rest:
    // the artifact comparison below rejects a copy that lost anything it needs.
    await Promise.all(
      [...closure].map(async (name) => {
        copyingPackages.add(name);
        await cp(
          path.join(repository, "node_modules", name),
          path.join(source, "node_modules", name),
          {
            recursive: true,
            dereference: true,
            filter: (file) => !/(?:\.d\.ts(?:\.map)?|[\\/]readme\.md)$/i.test(file),
          },
        );
        copyingPackages.delete(name);
        copiedPackages++;
      }),
    );
    mark("link-checkout");
    for (const name of ["rolldown", "typescript"])
      await linkDirectory(
        path.join(repository, "node_modules", name),
        path.join(source, "node_modules", name),
      );
    const linked = path.join(root, "linked");
    await linkDirectory(source, linked);
    // Compare against the actual builder at this copied root and require the
    // same portable bytes as the original checkout.
    mark("physical-oracle");
    const oracle = await expectedArtifacts(source);
    expect(oracle).toEqual(expected);
    mark("linked-oracle");
    expect(await expectedArtifacts(linked)).toEqual(expected);
    mark("command-line-build");
    const output = execFileSync(process.execPath, [path.join(linked, "scripts/build-parser.mjs")], {
      cwd: linked,
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
    expect(output).toContain("Parser adapter ready (4 artifacts changed).");
    mark("verify-artifacts");
    await completeArtifacts(path.join(source, "dist/syntax"), oracle);

    for (const checkout of [source, linked]) {
      mark(checkout === source ? "physical-import-guard" : "linked-import-guard");
      const code = `process.argv[1] = ${JSON.stringify(path.join(checkout, "package.json", "child"))};
const module = await import(${JSON.stringify(pathToFileURL(path.join(checkout, "scripts/build-parser.mjs")).href)});
process.stdout.write(typeof module.buildParser);`;
      const imported = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      });
      expect(imported.error).toBeUndefined();
      expect(imported.signal).toBeNull();
      expect(imported.status).toBe(0);
      expect(imported.stdout).toBe("function");
      expect(imported.stderr).toBe("");
    }

    // A package's actual dev entry is different from the checkout's ancestor.
    // Redirect an unadapted entry inside this owned copy, retaining its exact
    // source bytes, package version and license. It must still be rejected.
    mark("development-entry-rejection");
    const packageRoot = path.join(source, "node_modules/micromark-extension-gfm");
    const packageFile = path.join(packageRoot, "package.json");
    const metadata = JSON.parse(await readFile(packageFile, "utf8")) as { exports: string };
    await mkdir(path.join(packageRoot, "dev"));
    await cp(path.join(packageRoot, "index.js"), path.join(packageRoot, "dev/index.js"));
    metadata.exports = "./dev/index.js";
    await writeFile(packageFile, JSON.stringify(metadata));
    await expect(
      buildParser({
        repositoryRoot: source,
        outputDirectory: path.join(root, "development-output"),
      }),
    ).rejects.toThrow("Unexpected development parser input");
    expect(await readdir(root)).not.toContain("development-output");
    mark("complete");
  }, 60_000);

  it("rejects a parser graph physically outside its checkout before writing artifacts", async () => {
    const root = await fixture({
      "package.json": await readFile(path.join(repository, "package.json"), "utf8"),
    });
    await linkDirectory(path.join(repository, "node_modules"), path.join(root, "node_modules"));
    const previousEntries = (await readdir(root)).sort();
    await expect(buildParser({ repositoryRoot: root })).rejects.toThrow(
      "Parser graph input resolves outside the repository root",
    );
    expect((await readdir(root)).sort()).toEqual(previousEntries);
  });

  it("retains all unchanged bytes and deliberately old timestamps", async () => {
    const root = await fixture({});
    const outputDirectory = path.join(root, "generated");
    const first = await buildParser({ repositoryRoot: repository, outputDirectory });
    expect([...first.changed].sort()).toEqual([...artifactNames].sort());
    await completeArtifacts(outputDirectory);
    // Historical timestamps avoid depending on sleeps or filesystem clock
    // resolution: even an immediate unconditional rewrite must change these.
    const old = new Date("2000-01-01T00:00:00.000Z");
    const timestamps = new Map<ArtifactName, bigint>();
    for (const name of artifactNames) {
      const filename = path.join(outputDirectory, name);
      await utimes(filename, old, old);
      timestamps.set(name, (await stat(filename, { bigint: true })).mtimeNs);
    }
    const again = await buildParser({ repositoryRoot: repository, outputDirectory });
    expect(again.changed).toEqual([]);
    await completeArtifacts(outputDirectory);
    for (const name of artifactNames)
      expect((await stat(path.join(outputDirectory, name), { bigint: true })).mtimeNs, name).toBe(
        timestamps.get(name),
      );
  });

  it("finishes two concurrent deterministic builders with complete artifacts and no owned temps", async () => {
    const root = await fixture({});
    const outputDirectory = path.join(root, "concurrent");
    // Wait for both even when one fails, so fixture cleanup cannot race a live
    // builder. No scheduling hooks, fs mocks or assumed winner are involved.
    const outcomes = await Promise.allSettled([
      buildParser({ repositoryRoot: repository, outputDirectory }),
      buildParser({ repositoryRoot: repository, outputDirectory }),
    ]);
    const written = new Set<string>();
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") throw outcome.reason;
      expect(outcome.value.outputDirectory).toBe(outputDirectory);
      expect(new Set(outcome.value.changed).size).toBe(outcome.value.changed.length);
      for (const name of outcome.value.changed) {
        expect(artifactNames as readonly string[]).toContain(name);
        written.add(name);
      }
    }
    expect([...written].sort()).toEqual([...artifactNames].sort());
    await completeArtifacts(outputDirectory);
  });

  it("retains the previous runtime on a companion directory fault and completes a clean retry", async () => {
    const root = await fixture({});
    const outputDirectory = path.join(root, "recover");
    await mkdir(outputDirectory);
    const runtime = path.join(outputDirectory, "parser.generated.js");
    const previous = Buffer.from(
      "// Previous complete runtime must survive a failed build.\nexport {};\n",
    );
    await writeFile(runtime, previous);
    const old = new Date("2000-01-01T00:00:00.000Z");
    await utimes(runtime, old, old);
    const previousTimestamp = (await stat(runtime, { bigint: true })).mtimeNs;
    const obstruction = path.join(outputDirectory, "parser.generated.manifest.json");
    await mkdir(obstruction);
    const retained = path.join(obstruction, "retain.txt");
    await writeFile(retained, "deliberate companion-path obstruction\n");
    let failure: NodeJS.ErrnoException | undefined;
    try {
      await buildParser({ repositoryRoot: repository, outputDirectory });
    } catch (error) {
      failure = error as NodeJS.ErrnoException;
    }
    expect(failure).toBeDefined();
    expect(["EISDIR", "EPERM", "EACCES"]).toContain(failure?.code);
    expect((await stat(obstruction)).isDirectory()).toBe(true);
    expect(await readFile(retained, "utf8")).toBe("deliberate companion-path obstruction\n");
    expect((await readFile(runtime)).equals(previous)).toBe(true);
    expect((await stat(runtime, { bigint: true })).mtimeNs).toBe(previousTimestamp);
    // The first two companions legitimately finish before the third fails.
    // No wildcard cleanup may remove the obstruction or advance the runtime.
    for (const name of ["parser.generated.d.ts", "parser.generated.LICENSES.txt"] as const)
      expect((await readFile(path.join(outputDirectory, name))).equals(expected[name]), name).toBe(
        true,
      );
    expect((await readdir(outputDirectory)).sort()).toEqual([...artifactNames].sort());

    // Remove only the obstruction this test created, without recursive deletion.
    await rm(retained);
    await rmdir(obstruction);
    const recovered = await buildParser({ repositoryRoot: repository, outputDirectory });
    expect(recovered.changed).toEqual(["parser.generated.manifest.json", "parser.generated.js"]);
    await completeArtifacts(outputDirectory);
    const stable = await buildParser({ repositoryRoot: repository, outputDirectory });
    expect(stable.changed).toEqual([]);
    await completeArtifacts(outputDirectory);
  });
});
