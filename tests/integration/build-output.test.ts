import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { assertDistFiles, buildProduct, ordinaryFiles, verifyBuild } from "../../scripts/build.mjs";
import { withBuild } from "../../scripts/with-build.mjs";
import { fixture, linkDirectory, repository } from "./support.js";

async function productFixture(): Promise<string> {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "mdrefine-output-fixture",
      version: "0.0.0",
      type: "module",
      files: ["dist"],
    }),
    "package-lock.json": "{}\n",
    ".nvmrc": "24\n",
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        declaration: true,
        sourceMap: true,
        inlineSources: true,
        noEmitOnError: true,
        skipLibCheck: true,
        types: [],
        outDir: "dist",
      },
    }),
    "tsconfig.build.json": JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { rootDir: "src" },
      include: ["src/**/*.ts"],
    }),
    "src/index.ts": "export const current = 1;\n",
    "src/removed.ts": "export const renamed = 1;\n",
    "src/discarded.ts": "export const discarded = 1;\n",
    "src/was-file.js/nested.ts": "export const oldNested = 1;\n",
  };
  for (const name of [
    "scripts/build.mjs",
    "scripts/build-parser.mjs",
    "scripts/with-build.mjs",
    "scripts/parser-patches.mjs",
    "scripts/parser-labels.mjs",
    "scripts/parser-packages.json",
    "src/syntax/parser.generated.d.ts",
  ])
    files[name] = await readFile(path.join(repository, name), "utf8");
  const root = await fixture(files);
  // Copy the actual reviewed parser graph inside the fixture; shared build
  // tools are read-only links. No tracked source or installed dependency changes.
  const packages = JSON.parse(files["scripts/parser-packages.json"]!) as { name: string }[];
  const pending = packages.map(({ name }) => name);
  const copied = new Set<string>();
  while (pending.length) {
    const name = pending.pop()!;
    if (copied.has(name)) continue;
    copied.add(name);
    const installed = path.join(repository, "node_modules", name);
    const metadata = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    pending.push(...Object.keys(metadata.dependencies ?? {}));
    await cp(installed, path.join(root, "node_modules", name), {
      recursive: true,
      dereference: true,
    });
  }
  for (const name of ["rolldown", "typescript"])
    await linkDirectory(
      path.join(repository, "node_modules", name),
      path.join(root, "node_modules", name),
    );
  return root;
}

it("rebuilds from current source, rejects unknown output, preserves failed preparation and supports concurrent producers", async () => {
  const root = await productFixture();
  await buildProduct(root);
  await rename(path.join(root, "src/removed.ts"), path.join(root, "src/renamed.ts"));
  await rm(path.join(root, "src/discarded.ts"));
  await rm(path.join(root, "src/was-file.js/nested.ts"));
  await writeFile(path.join(root, "src/was-file.ts"), "export const newFile = 1;\n");
  await writeFile(path.join(root, "dist/unexpected.txt"), "must not ship\n");
  await expect(assertDistFiles(root)).rejects.toThrow("Build output differs from current source");
  await buildProduct(root);
  await assertDistFiles(root);
  const output = await ordinaryFiles(path.join(root, "dist"));
  expect(output.some((file: string) => /removed|discarded|unexpected/.test(file))).toBe(false);
  expect(output).toContain("renamed.js");
  expect(output).toContain("was-file.js");
  expect(output.some((file) => file.startsWith("was-file.js/"))).toBe(false);
  expect(JSON.parse(await readFile(path.join(root, "dist/renamed.js.map"), "utf8"))).toMatchObject({
    sources: ["../src/renamed.ts"],
    sourcesContent: ["export const renamed = 1;\n"],
  });
  const npm = process.env.npm_execpath!;
  const packed = JSON.parse(
    execFileSync(process.execPath, [npm, "pack", "--json"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }),
  ) as unknown;
  const result = (
    Array.isArray(packed) ? packed[0] : Object.values(packed as Record<string, unknown>)[0]
  ) as { files: { path: string }[] };
  await assertDistFiles(
    root,
    result.files
      .filter((file) => file.path.startsWith("dist/"))
      .map((file) => file.path.slice(5))
      .sort(),
  );

  const previous = await Promise.all(
    output.map((file: string) => readFile(path.join(root, "dist", file))),
  );
  await writeFile(path.join(root, "src/index.ts"), "export const broken = ;\n");
  await expect(buildProduct(root)).rejects.toThrow();
  expect(await ordinaryFiles(path.join(root, "dist"))).toEqual(output);
  expect(
    await Promise.all(output.map((file: string) => readFile(path.join(root, "dist", file)))),
  ).toEqual(previous);
  expect((await readdir(root)).some((file) => file.startsWith(".mdrefine-build-"))).toBe(false);
  await writeFile(path.join(root, "src/index.ts"), "export const current = 2;\n");
  // Force both actual producers to publish changed files, not just no-op writes.
  for (const file of output) await writeFile(path.join(root, "dist", file), "// stale\n");
  const outcomes = await Promise.allSettled([buildProduct(root), buildProduct(root)]);
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
  await assertDistFiles(root);
  expect(await readFile(path.join(root, "dist/index.js"), "utf8")).toContain("current = 2");
  expect((await readdir(root)).some((file) => file.startsWith(".mdrefine-build-"))).toBe(false);
}, 90000);

it("validates receipt identity and invalidation, then expires the orchestration-owned receipt on failure", async () => {
  const root = await productFixture();
  const context = await buildProduct(root);
  const receipt = path.join(root, "receipt.json");
  await writeFile(receipt, JSON.stringify({ ...context, ownerPid: process.pid }));
  const inherited = process.env.MDREFINE_BUILD_RECEIPT;
  try {
    process.env.MDREFINE_BUILD_RECEIPT = receipt;
    await verifyBuild(root);
    await expect(verifyBuild(repository)).rejects.toThrow("another checkout");
    await writeFile(receipt, JSON.stringify({ ...context, ownerPid: process.pid, node: "v0.0.0" }));
    await expect(verifyBuild(root)).rejects.toThrow("another Node.js version");
    await writeFile(receipt, JSON.stringify({ ...context, ownerPid: -1 }));
    await expect(verifyBuild(root)).rejects.toThrow("Invalid build owner");
    await writeFile(receipt, JSON.stringify({ ...context, ownerPid: process.pid }));
    for (const file of [
      "src/index.ts",
      "tsconfig.json",
      "package-lock.json",
      "scripts/build.mjs",
      "node_modules/micromark/lib/parse.js",
      "node_modules/micromark/package.json",
      "node_modules/micromark/license",
    ]) {
      const filename = path.join(root, file);
      const bytes = await readFile(filename);
      await writeFile(filename, Buffer.concat([bytes, Buffer.from("\n")]));
      await expect(verifyBuild(root), file).rejects.toThrow("Build inputs changed");
      await writeFile(filename, bytes);
    }
    const runtime = path.join(root, "dist/index.js");
    const bytes = await readFile(runtime);
    await writeFile(runtime, "// changed output\n");
    await expect(verifyBuild(root)).rejects.toThrow("Build output changed");
    await writeFile(runtime, bytes);
    await writeFile(path.join(root, "dist/extra.js"), "export {};\n");
    await expect(verifyBuild(root)).rejects.toThrow("Build output differs from current source");
    await rm(path.join(root, "dist/extra.js"));
    await verifyBuild(root);
    delete process.env.MDREFINE_BUILD_RECEIPT;
    await expect(verifyBuild(root)).rejects.toThrow("Missing build context");

    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    manifest.scripts = { fail: "node consumer.mjs", unreachable: "node consumer.mjs" };
    await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
    await writeFile(
      path.join(root, "consumer.mjs"),
      'import {writeFileSync} from "node:fs"; writeFileSync("observed-receipt.txt", process.env.MDREFINE_BUILD_RECEIPT); process.exit(7);\n',
    );
    expect(await withBuild([{ script: "fail" }, { script: "unreachable" }], root)).toBe(7);
    const expired = await readFile(path.join(root, "observed-receipt.txt"), "utf8");
    await expect(readFile(expired)).rejects.toMatchObject({ code: "ENOENT" });
    expect(process.env.MDREFINE_BUILD_RECEIPT).toBeUndefined();
  } finally {
    if (inherited === undefined) delete process.env.MDREFINE_BUILD_RECEIPT;
    else process.env.MDREFINE_BUILD_RECEIPT = inherited;
  }
}, 60000);

it("rejects a linked output target without touching it", async () => {
  const root = await fixture({ "src/index.ts": "export {};\n" });
  const outside = await fixture({ "keep.txt": "retained\n" });
  await mkdir(path.join(root, "dist"));
  await linkDirectory(outside, path.join(root, "dist/linked"));
  await expect(ordinaryFiles(path.join(root, "dist"))).rejects.toThrow(
    "Build tree contains a link",
  );
  expect(await readFile(path.join(outside, "keep.txt"), "utf8")).toBe("retained\n");
});
