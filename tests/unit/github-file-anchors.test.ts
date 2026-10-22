import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { parseDocument, YAMLParseError } from "yaml";
import { createWorkspace, lint } from "../../src/index.js";
import * as syntax from "../../src/syntax/parse.js";
import { githubAnchors } from "../../src/workspace/anchors.js";
import { githubFileAnchors } from "../../src/workspace/github-file-anchors.js";

vi.mock("yaml", async (importOriginal) => {
  const actual = await importOriginal<typeof import("yaml")>();
  return { ...actual, parseDocument: vi.fn(actual.parseDocument) };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const evidence = JSON.parse(
  readFileSync(
    new URL("../fixtures/renderers/github-frontmatter-files.json", import.meta.url),
    "utf8",
  ),
) as {
  fixtureCommit: string;
  cases: {
    name: string;
    file: string;
    sourceSha256: string;
    generatedIds: string[];
    reading: "metadata" | "plain";
  }[];
};
const sourceOf = (file: string) =>
  readFileSync(new URL(`../fixtures/frontmatter-anchors/${file}`, import.meta.url), "utf8");

it("retains the complete immutable actual-file matrix", () => {
  expect(evidence.fixtureCommit).toBe("004799257d45b2a2a8b88a60d7a04479c8cfe3ec");
  expect(evidence.cases).toHaveLength(24);
  expect(new Set(evidence.cases.map(({ file }) => file)).size).toBe(24);
});

it.each(evidence.cases)("matches immutable Contents anchors for $name", (fixture) => {
  const source = sourceOf(fixture.file);
  expect(createHash("sha256").update(source).digest("hex")).toBe(fixture.sourceSha256);
  const document = syntax.parse(source, "github");
  const markdown = githubAnchors(document);
  const candidate =
    document.tree.children[0]?.type === "yaml"
      ? document.tree
      : syntax.frontMatterReading(document.tree);
  const readPlain = vi.spyOn(syntax, "plainReading");
  const anchors = githubFileAnchors(document, markdown, source);
  expect(anchors.complete).toBe(true);
  expect([...anchors.slugs]).toEqual(fixture.generatedIds);
  expect([...anchors.explicit]).toEqual([]);
  // A sequence/empty nonmap can coincidentally have the same body IDs. Assert
  // its selected reading, rather than inferring metadata from that ID count.
  expect(readPlain).toHaveBeenCalledTimes(candidate && fixture.reading === "plain" ? 1 : 0);
  expect([...githubAnchors(document).slugs]).toEqual([...markdown.slugs]);
});

it.each([
  ["github", "commonmark"],
  ["commonmark", "github"],
] as const)("keeps file selection independent of %s/%s cache order", (first, second) => {
  const parseEntry = vi.spyOn(syntax, "parse");
  for (const fixture of evidence.cases) {
    const source = sourceOf(fixture.file);
    const markdown = githubAnchors(syntax.parse(source, "github"));
    const read = vi.fn(() => source);
    const workspace = createWorkspace({ "Target.md": read });
    parseEntry.mockClear();
    for (const dialect of [first, second]) {
      const known = dialect === "github" ? fixture.generatedIds : [...markdown.slugs];
      for (const slug of new Set([
        ...fixture.generatedIds,
        ...markdown.slugs,
        "definitely-missing",
      ]))
        expect(workspace.resolve("From.md", `Target.md#${slug}`, dialect)).toMatchObject({
          status: "resolved",
          fragmentExists: known.includes(slug),
        });
    }
    expect(read).toHaveBeenCalledTimes(1);
    // Necessary alternate trees are lazy/internal to this one public entry;
    // this does not assert only one underlying Markdown AST is built.
    expect(parseEntry).toHaveBeenCalledTimes(1);
  }
});

it("keeps raw BOM rejection through the target seam after parse normalizes it", () => {
  const source = "\ufeff---\nnull\n---\n# Body\n";
  const document = syntax.parse(source, "github");
  expect(document.source.startsWith("---")).toBe(true);
  const workspace = createWorkspace({ "Target.md": source });
  expect(workspace.resolve("From.md", "Target.md#null", "github")).toMatchObject({
    status: "resolved",
    fragmentExists: true,
  });
  expect([...githubFileAnchors(document, githubAnchors(document), source).slugs]).toEqual([
    "null",
    "body",
  ]);
});

const unsettled = "---\n2001-12-15\n---\n# 2001-12-15\n\n# 2001-12-15-1\n";
it("numbers unsettled scalar-class readings independently before intersecting", () => {
  const workspace = createWorkspace({ "Target.md": unsettled });
  for (const fragment of ["2001-12-15", "2001-12-15-1"])
    expect(workspace.resolve("From.md", `Target.md#${fragment}`, "github").fragmentExists).toBe(
      true,
    );
  for (const fragment of ["2001-12-15-1-1", "missing"])
    expect(workspace.resolve("From.md", `Target.md#${fragment}`, "github")).toMatchObject({
      status: "unreadable",
      fragmentIncomplete: true,
    });
  const diagnostics = lint("[link](Target.md#missing)\n", {
    workspace,
    config: { extends: ["recommended"], dialect: "github" },
  });
  expect(diagnostics.find(({ rule }) => rule === "links/valid")?.message).toBe(
    "Fragment could not be checked: Target.md#missing (anchors in Target.md are not fully known for this renderer).",
  );
});

it("keeps cross-kind membership and equal complete answers for an unsettled tag", () => {
  const source = '---\n!opaque |\n  <div>\n  <a id="cross"></a>\n---\n# Cross\n\n# Shared\n';
  const document = syntax.parse(source, "github");
  const anchors = githubFileAnchors(document, githubAnchors(document), source);
  expect(anchors.complete).toBe(true);
  expect([...anchors.slugs]).toEqual(["cross", "shared"]);
});

it.each(["---\n!opaque |\n  ```js\n---\n# Body\n", "---\rtitle: |\r  ```js\r---\r# Body\r"])(
  "leaves unsupported classes/boundaries incomplete: %j",
  (source) => {
    const document = syntax.parse(source, "github");
    expect(githubFileAnchors(document, githubAnchors(document), source).complete).toBe(false);
  },
);

it("treats the dependency's known resource error as uncertainty, without a depth cap", async () => {
  const actual = await vi.importActual<typeof import("yaml")>("yaml");
  const exhausted = actual.parseDocument("key: value");
  exhausted.errors.push(
    new YAMLParseError([0, 0], "RESOURCE_EXHAUSTION", "Maximum call stack size exceeded"),
  );
  vi.mocked(parseDocument).mockReturnValueOnce(exhausted);
  const source = "---\ntitle: |\n  ```js\n---\n# Body\n";
  const document = syntax.parse(source, "github");
  expect(githubFileAnchors(document, githubAnchors(document), source).complete).toBe(false);
});

it("does not swallow unrelated dependency faults", () => {
  vi.mocked(parseDocument).mockImplementationOnce(() => {
    throw new Error("unrelated fault");
  });
  const source = "---\ntitle: Text\n---\n# Body\n";
  const document = syntax.parse(source, "github");
  expect(() => githubFileAnchors(document, githubAnchors(document), source)).toThrow(
    "unrelated fault",
  );
});

it("keeps original positions and the formatter's two-reading identities", () => {
  const source = sourceOf("valid-block-code.md");
  const document = syntax.parse(source, "github");
  const candidate = syntax.frontMatterReading(document.tree)!;
  expect(syntax.plainReading(candidate)).toBe(document.tree);
  expect(syntax.plainReading(document.tree)).toBe(document.tree);
  expect(syntax.otherReading(document.tree)).toBe(candidate);
  expect(syntax.otherReading(candidate)).toBeUndefined();
  const heading = candidate.children.find(({ type }) => type === "heading")!;
  expect(heading.position!.start.line).toBe(5);
  expect(document.source.slice(heading.position!.start.offset, heading.position!.end.offset)).toBe(
    "# Body valid block code",
  );
  const ordinary = syntax.parse("---\nnull\n---\n# Body\n", "github");
  expect(syntax.plainReading(ordinary.tree).children[0]?.type).toBe("thematicBreak");
  expect(syntax.otherReading(ordinary.tree)).toBeUndefined();
  const toml = syntax.parse("+++\ntitle = 'Text'\n+++\n# Body\n", "github");
  expect(syntax.otherReading(toml.tree)).toBe(syntax.plainReading(toml.tree));
});

it("retains HTML uncertainty inside a selected metadata body", () => {
  const source = "---\ntitle: Text\n---\n# Known\n\n### A <div> B\n\n# Later\n";
  const workspace = createWorkspace({ "Target.md": source });
  expect(workspace.resolve("From.md", "Target.md#known", "github").fragmentExists).toBe(true);
  expect(workspace.resolve("From.md", "Target.md#later", "github")).toMatchObject({
    status: "unreadable",
    fragmentIncomplete: true,
  });
});
