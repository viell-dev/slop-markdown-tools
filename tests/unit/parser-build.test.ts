import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { beforeAll, expect, expectTypeOf, it } from "vitest";
import { assertPortableRegions, bundleParser } from "../../scripts/build-parser.mjs";
import {
  repairParserSource,
  repairReviewedParserSource,
  sourceGuards,
} from "../../scripts/parser-patches.mjs";
import { readReviewedSource } from "../support/parser/parser-module-probes.mjs";
import { compileParserAdaptation } from "../../scripts/parser-adaptations.mjs";

let bundle: Awaited<ReturnType<typeof bundleParser>>;
beforeAll(async () => {
  bundle = await bundleParser();
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

it("keeps bundled factory declarations aligned with the pinned upstream signatures", () => {
  expectTypeOf<typeof import("../../src/syntax/parser.generated.js").gfm>().toEqualTypeOf<
    typeof import("micromark-extension-gfm").gfm
  >();
  expectTypeOf<
    typeof import("../../src/syntax/parser.generated.js").gfmAutolinkLiteral
  >().toEqualTypeOf<typeof import("micromark-extension-gfm-autolink-literal").gfmAutolinkLiteral>();
  expectTypeOf<typeof import("../../src/syntax/parser.generated.js").gfmFootnote>().toEqualTypeOf<
    typeof import("micromark-extension-gfm-footnote").gfmFootnote
  >();
  expectTypeOf<
    typeof import("../../src/syntax/parser.generated.js").gfmStrikethrough
  >().toEqualTypeOf<typeof import("micromark-extension-gfm-strikethrough").gfmStrikethrough>();
  expectTypeOf<
    typeof import("../../src/syntax/parser.generated.js").cjkFriendlyExtension
  >().toEqualTypeOf<typeof import("micromark-extension-cjk-friendly").cjkFriendlyExtension>();
});

it("rejects changed dependency identities, source bytes and missing anchors", async () => {
  for (const kind of Object.keys(sourceGuards)) {
    const { source, metadata } = await readReviewedSource(kind);
    expect(() => repairReviewedParserSource(kind, source, metadata)).not.toThrow();
    expect(() =>
      repairReviewedParserSource(kind, source, { ...metadata, name: "changed" }),
    ).toThrow();
    expect(() =>
      repairReviewedParserSource(kind, source, { ...metadata, version: "999.0.0" }),
    ).toThrow();
    expect(() => repairReviewedParserSource(kind, `${source}\n`, metadata)).toThrow();
  }
  const { source } = await readReviewedSource("editMap");
  const anchor = "    vecs.push(events.slice());\n    events.length = 0;\n";
  expect(() => repairParserSource("editMap", source.replace(anchor, ""))).toThrow();
  expect(() => repairParserSource("editMap", source.replace(anchor, anchor + anchor))).toThrow();
});

it("ships the reviewed complete graph and exact correction counts", () => {
  expect(bundle.manifest.resolution).toEqual({
    platform: "neutral",
    conditions: ["import", "default"],
  });
  expect(bundle.manifest.exports).toEqual([
    "cjkFriendlyExtension",
    "fromMarkdown",
    "gfm",
    "gfmAutolinkLiteral",
    "gfmFootnote",
    "gfmStrikethrough",
  ]);
  expect(bundle.manifest.transformCounts).toEqual({
    attention: 1,
    autolink: 1,
    cjk: 1,
    code: 1,
    footnote: 1,
    footnoteSyntax: 1,
    labelEnd: 1,
    strike: 1,
    text: 1,
  });
  expect(bundle.manifest.patches.map((entry) => entry.kind).sort()).toEqual([
    "attention",
    "autolink",
    "cjk",
    "code",
    "editMap",
    "footnote",
    "footnoteSyntax",
    "labelEnd",
    "strike",
    "text",
  ]);
  expect(bundle.manifest.editMapImporters).toEqual([
    "micromark-core-commonmark/lib/setext-underline.js",
    "micromark/lib/initialize/document.js",
    "micromark/lib/initialize/text.js",
  ]);
  expect(bundle.manifest.moduleCount).toBe(78);
  expect(bundle.manifest.inputs).toHaveLength(76);
  for (const { file } of bundle.manifest.inputs) {
    expect(path.posix.isAbsolute(file) || path.win32.isAbsolute(file)).toBe(false);
    expect(file).not.toContain("\\");
    expect(file).not.toContain("/dev/");
  }
  const ast = ts.createSourceFile(
    "parser.generated.js",
    bundle.code,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.JS,
  );
  let imports = 0;
  let dynamicImports = 0;
  const inspect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) imports++;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      dynamicImports++;
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  expect(imports).toBe(0);
  expect(dynamicImports).toBe(0);
  expect(hash(bundle.code)).toBe(bundle.manifest.runtimeSha256);
  expect(hash(bundle.declaration)).toBe(bundle.manifest.declarationSha256);
  expect(hash(bundle.licenses)).toBe(bundle.manifest.licensesSha256);
});

it("binds every local parser generator and maintained implementation source", async () => {
  expect(bundle.manifest.localSources.map(({ file }) => file)).toEqual([
    "scripts/build-parser.mjs",
    "scripts/parser-patches.mjs",
    "scripts/parser-labels.mjs",
    "scripts/parser-adaptations.mjs",
    "scripts/parser-packages.json",
    "src/syntax/parser.generated.d.ts",
    "scripts/parser-adaptations/attention.ts",
    "scripts/parser-adaptations/autolink.ts",
    "scripts/parser-adaptations/compact-code.ts",
    "scripts/parser-adaptations/compact-text.ts",
    "scripts/parser-adaptations/footnote.ts",
    "scripts/parser-adaptations/strike.ts",
    "scripts/parser-adaptations/tsconfig.json",
    "scripts/parser-adaptations/types.ts",
  ]);
  for (const { file, sha256 } of bundle.manifest.localSources) {
    if (typeof file !== "string") throw new Error("Non-string local parser source");
    const bytes = await readFile(new URL(`../../${file}`, import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(sha256);
  }
});

it("keeps patch tracking in the authoritative guarded records and generated provenance", () => {
  for (const patch of bundle.manifest.patches) {
    const guard = sourceGuards[patch.kind];
    expect(patch.provenance).toBe(guard.provenance);
    expect(patch.tracking).toEqual(guard.tracking);
    expect(patch.tracking.dependencyIndex).toBe(
      "https://github.com/viell-dev/slop-markdown-tools/issues/330",
    );
    expect(patch.tracking.issues.length).toBeGreaterThan(0);
    for (const issue of patch.tracking.issues) {
      expect(issue).toMatch(/^https:\/\/github\.com\/viell-dev\/slop-markdown-tools\/issues\/\d+$/);
    }
    expect(patch.tracking.owner).toBe("mdrefine maintaining agents");
    expect(patch.tracking.removalCondition.length).toBeGreaterThan(80);
  }
});

it("inserts literal fragment source while rejecting additional runtime boundaries", () => {
  const compiled = compileParserAdaptation(
    'import type { Token } from "./types.js"; declare const token: Token; export function value() { return [token.type, "$$", "$&"]; }',
    "literal.ts",
  );
  expect(compiled).toContain('"$$"');
  expect(compiled).toContain('"$&"');
  expect(compiled).not.toContain("export ");
  expect(compiled).not.toContain("import ");
  for (const source of [
    'import "additional-runtime";',
    'export function value() { return import("additional-runtime"); }',
    "export function value() { return import.meta; }",
    'export { value } from "additional-runtime";',
    "const value = 1; export { value };",
    "export default 1;",
    "export const value = 1;",
    "namespace Additional { export const value = 1; }",
    "const __helper = 1;",
  ]) {
    expect(() => compileParserAdaptation(source, "unexpected.ts"), source).toThrow();
  }
});

it("removes only parsed exports while preserving template literal bytes and generator syntax", () => {
  const template =
    "`before\nexport function value() {}\nexport class Value {}\nexport {};\nimport.meta\n$$ $&\nafter`";
  const compiled = compileParserAdaptation(
    `export function value() { return ${template}; }\nexport class Value {}`,
    "template.ts",
  );
  expect(compiled).toContain(template);
  const value: unknown = runInNewContext(`${compiled}\nvalue()`);
  expect(value).toBe(template.slice(1, -1));

  const generator = compileParserAdaptation(
    'export function* values() { yield "$$"; yield "$&"; }',
    "generator.ts",
  );
  const values: unknown = runInNewContext(`${generator}\nArray.from(values())`);
  expect(values).toEqual(["$$", "$&"]);
  const ast = ts.createSourceFile(
    "inserted.js",
    compiled + generator,
    ts.ScriptTarget.ES2023,
    true,
  );
  const inspect = (node: ts.Node): void => {
    expect(ts.isExportDeclaration(node)).toBe(false);
    if (ts.canHaveModifiers(node)) {
      expect(
        ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      ).not.toBe(true);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
});

it("rejects ambient Node.js globals through the actual fragment TypeScript project", () => {
  const directory = path.resolve(import.meta.dirname, "../../scripts/parser-adaptations");
  const loaded = ts.readConfigFile(path.join(directory, "tsconfig.json"), (filename) =>
    ts.sys.readFile(filename),
  );
  expect(loaded.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, directory);
  expect(parsed.errors).toHaveLength(0);
  const attention = path.join(directory, "attention.ts");
  const host = ts.createCompilerHost(parsed.options);
  const originalRead = host.readFile.bind(host);
  host.readFile = (filename) => {
    const source = originalRead(filename);
    return path.resolve(filename) === attention && source !== undefined
      ? `${source}\nexport function mdrefineNodeAmbientControl() { return [Buffer, process, require]; }\n`
      : source;
  };
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  expect(errors).toHaveLength(3);
  for (const name of ["Buffer", "process", "require"]) {
    expect(
      errors.some((message) => message.includes(`Cannot find name '${name}'`)),
      name,
    ).toBe(true);
  }
});

it("packs every complete reviewed license text, rather than headers or SPDX labels", async () => {
  interface LicensedPackage {
    name: string;
    version: string;
    licenseSha256: string;
  }
  const expected = JSON.parse(
    await readFile(new URL("../../scripts/parser-packages.json", import.meta.url), "utf8"),
  ) as LicensedPackage[];
  expected.sort((a, b) => {
    const left = `${a.name}@${a.version}`;
    const right = `${b.name}@${b.version}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const marker = (entry: LicensedPackage) =>
    `------------------------------------------------------------------------\n${entry.name}@${entry.version}\n------------------------------------------------------------------------\n\n`;
  expect(expected).toHaveLength(34);
  expected.forEach((entry, index) => {
    const prefix = marker(entry);
    const at = bundle.licenses.indexOf(prefix);
    expect(at).toBeGreaterThanOrEqual(0);
    const end =
      index + 1 < expected.length
        ? bundle.licenses.indexOf(marker(expected[index + 1]!), at + prefix.length)
        : bundle.licenses.length;
    expect(end).toBeGreaterThan(at + prefix.length);
    let text = bundle.licenses.slice(at + prefix.length, end);
    if (index + 1 < expected.length) text = text.slice(0, -1); // presentation separator between sections
    // The aggregate adds one final LF only when an upstream file has none.
    expect([hash(text), hash(text.endsWith("\n") ? text.slice(0, -1) : text)]).toContain(
      entry.licenseSha256,
    );
  });
});

it("records actual uppercase license filenames and unchanged raw provenance", async () => {
  // Resolve the utility from its declaring package, including under strict pnpm.
  const fromCjk = createRequire(
    createRequire(import.meta.url).resolve("micromark-extension-cjk-friendly/package.json"),
  );
  for (const expected of [
    {
      name: "micromark-extension-cjk-friendly",
      version: "2.0.2",
      licenseFile: "LICENSE",
      licenseSha256: "ba752b39ec76e0887ed1b66d3eb4507d41dd3cff41be66d475d556e15d6a9520",
    },
    {
      name: "micromark-extension-cjk-friendly-util",
      version: "3.0.1",
      licenseFile: "LICENSE",
      licenseSha256: "e4078c730a92cb9c2803a46b6f288a26bf196433e2b009e90ef4789217b49907",
    },
  ]) {
    const directory = path.dirname(fromCjk.resolve(expected.name + "/package.json"));
    // Directory entries are the case-sensitive oracle even on Windows, where
    // reading the wrong-case path would otherwise succeed.
    expect(await readdir(directory)).toContain(expected.licenseFile);
    const bytes = await readFile(path.join(directory, expected.licenseFile));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.licenseSha256);
    expect(bundle.manifest.packages.find(({ name }) => name === expected.name)).toMatchObject(
      expected,
    );
  }
});

it("rebuilds reproducibly without touching dist", async () => {
  const again = await bundleParser();
  expect(again.code).toBe(bundle.code);
  expect(again.licenses).toBe(bundle.licenses);
  expect(again.declaration).toBe(bundle.declaration);
  expect(again.manifest).toEqual(bundle.manifest);
});

it("checks emitted region provenance rather than arbitrary source substrings", () => {
  const labels = new Set(
    [...bundle.code.matchAll(/^\/\/#region ([^\r\n]+)$/gm)].map((match) => match[1]!),
  );
  // This checks the actual production-builder result. Existing graph assertions
  // independently retain all 78 modules, 76 inputs, transforms and licenses.
  expect(labels).toContain("\\0rolldown/runtime.js");
  expect(labels).toContain("mdrefine:edit-map");
  expect(() => assertPortableRegions(bundle.code, labels)).not.toThrow();
  const relative = [...labels].find((label) => label.startsWith("node_modules/"))!;
  expect(relative).toBeDefined();
  for (const replacement of [
    "/outside/index.js",
    "C:/outside/index.js",
    "C:outside/index.js",
    "\\\\server\\share\\index.js",
    "file:///outside/index.js",
    "../outside/index.js",
    "node_modules/a/../outside.js",
    "node_modules/a//index.js",
    "node_modules\\a\\index.js",
    "node_modules/not-in-graph/index.js",
    "mdrefine:unexpected",
    "\\0rolldown/unreviewed.js",
  ]) {
    const changed = bundle.code.replaceAll(`//#region ${relative}\n`, `//#region ${replacement}\n`);
    expect(changed, replacement).not.toBe(bundle.code);
    expect(() => assertPortableRegions(changed, labels), replacement).toThrow(
      /(?:Nonportable|Unexpected) parser region label/,
    );
  }
  for (const marker of ["//#region", "//#region ", "//#regions unexpected"]) {
    const changed = bundle.code.replaceAll(`//#region ${relative}`, marker);
    expect(() => assertPortableRegions(changed, labels), marker).toThrow(
      /(?:Malformed parser region header|Missing parser region label)/,
    );
  }
  expect(() => assertPortableRegions("export {};\n", labels)).toThrow(
    "Missing parser region headers",
  );
  // /code, /src and /build are also legitimate source fragments: no raw
  // repository-root substring test may classify them as emitted physical paths.
  const ordinary = `${bundle.code}\n// /code /src /build\nconst unrelated = "/micromark-util-edit-map/";\n`;
  expect(() => assertPortableRegions(ordinary, labels)).not.toThrow();
});
