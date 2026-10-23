import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, rmdir, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildParser, bundleParser } from "../../scripts/build-parser.mjs";
import { fixture, linkDirectory, repository } from "./support.js";

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
  it("runs the command-line build through a linked checkout path", async () => {
    const files: Record<string, string> = {};
    for (const name of [
      "package.json",
      "scripts/build-parser.mjs",
      "scripts/parser-patches.mjs",
      "scripts/parser-packages.json",
      "src/syntax/parser.generated.d.ts",
    ])
      files[`source/${name}`] = await readFile(path.join(repository, name), "utf8");
    const root = await fixture(files);
    const source = path.join(root, "source");
    await linkDirectory(path.join(repository, "node_modules"), path.join(source, "node_modules"));
    const linked = path.join(root, "linked");
    await linkDirectory(source, linked);
    // Rolldown's region comments depend on the build root. Compare against
    // the actual in-memory builder at this copied root, with the same graph.
    const oracle = await expectedArtifacts(source);
    const output = execFileSync(process.execPath, [path.join(linked, "scripts/build-parser.mjs")], {
      cwd: linked,
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
    expect(output).toContain("Parser adapter ready (4 artifacts changed).");
    await completeArtifacts(path.join(source, "dist/syntax"), oracle);
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

  it("finishes two concurrent deterministic writers with complete artifacts and no owned temps", async () => {
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
