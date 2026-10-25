import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { format, lint, unifiedDiff } from "../../src/index.js";
import type { Config, Diagnostic } from "../../src/index.js";
import { discoverWorkspace } from "../../src/node.js";
import { fixture, run, tree } from "../support/cli.js";

const config: Config = { extends: ["recommended", "github"], ignore: ["drafts/**"] };
const note = `${"A long line of prose in a vault. ".repeat(4).trim()}\nAnd *more*.\n`;
const files = {
  "mdrefine.config.json": JSON.stringify(config),
  ".gitignore": "generated/\n",
  "docs/guide.md": "# Guide\n\nSee [the reference](reference.md#section) and *more*.\n",
  "docs/reference.md": "# Reference\n\n## Section\n\nText.\n",
  "drafts/draft.md": "A *draft*.\n",
  "generated/out.md": "*generated*\n",
  "nested/.git/HEAD": "ref: refs/heads/main\n",
  "nested/inner.md": "*inner*\n",
  "vault/.obsidian/app.json": '{"strictLineBreaks":true}',
  "vault/Note.md": note,
  "broken/.obsidian/app.json": "not json",
  "broken/Other.md": "Text.\n",
};

it("exports the same unified diff that the CLI prints for a changed document", async () => {
  const source = "A *small* note.\n";
  const root = await fixture({
    "mdrefine.config.json": JSON.stringify(config),
    "note.md": source,
  });
  const printed = run(root, ["format", "--diff", "note.md"]);
  expect(printed.status, printed.stderr).toBe(0);
  expect(printed.stdout).toBe(
    unifiedDiff("a/note.md", "b/note.md", source, format(source, { config }).output),
  );
});

describe("filesystem discovery for library hosts (mdrefine/node)", () => {
  it("selects and prepares every document as the CLI does", async () => {
    const root = await fixture(files);
    const discovery = await discoverWorkspace({ root, config });
    expect(discovery.selected).toEqual([
      "broken/Other.md",
      "docs/guide.md",
      "docs/reference.md",
      "vault/Note.md",
    ]);
    expect(discovery.skipped).toEqual([
      expect.objectContaining({ path: "broken/.obsidian/app.json", code: "INVALID" }),
    ]);
    // The same documents, findings, and output as the CLI's JSON report.
    const library = (mode: "lint" | "format") =>
      discovery.selected.map((name) => {
        const options = discovery.options(name);
        const source = discovery.read(name);
        if (mode === "lint") return { path: name, diagnostics: lint(source, options) };
        const result = format(source, options);
        return { path: name, changed: result.changed, diagnostics: result.diagnostics };
      });
    for (const mode of ["lint", "format"] as const) {
      const report = JSON.parse(run(root, [mode, "--json"]).stdout) as {
        files: { path: string; changed?: boolean; diagnostics: Diagnostic[] }[];
        skipped: unknown[];
      };
      expect(library(mode), mode).toEqual(report.files);
      expect(discovery.skipped).toEqual(report.skipped);
    }
    // A vault's note is read as Obsidian with that vault's line-break setting.
    const options = discovery.options("vault/Note.md");
    expect(options).toMatchObject({ path: "vault/Note.md", defaultDialect: "obsidian" });
    expect(options.workspace?.strictLineBreaks).toBe(true);
    expect(discovery.options("docs/guide.md").defaultDialect).toBeUndefined();
  });
  it("resolves inputs and exclusions from the root, and selects nothing for an empty list", async () => {
    const root = await fixture(files);
    const narrowed = await discoverWorkspace({
      root,
      config,
      inputs: ["docs", path.join(root, "vault")],
      exclude: ["docs/reference.md"],
    });
    expect(narrowed.selected).toEqual(["docs/guide.md", "vault/Note.md"]);
    // A document that is not selected is still a link target.
    expect(lint(narrowed.read("docs/guide.md"), narrowed.options("docs/guide.md"))).toEqual([
      expect.objectContaining({ rule: "style/emphasis" }),
      expect.objectContaining({ rule: "style/emphasis" }),
    ]);
    expect(() => narrowed.options("docs/reference.md")).toThrow(
      "Not a selected document: docs/reference.md",
    );
    const none = await discoverWorkspace({ root, config, inputs: [] });
    expect(none.selected).toEqual([]);
    if (process.platform === "win32")
      expect((await discoverWorkspace({ root, inputs: ["docs\\guide.md"] })).selected).toEqual([
        "docs/guide.md",
      ]);
  });
  it("takes the text of supplied documents, also where no file is", async () => {
    const root = await fixture(files);
    const discovery = await discoverWorkspace({
      root,
      config,
      inputs: [],
      documents: {
        "docs/guide.md": "# Guide\n\nSee [the reference](reference.md#missing).\n",
        "vault/Ideas/Draft.md": "# Draft\n\nSee [[#Draft]] and *this*.\n",
      },
    });
    expect(discovery.selected).toEqual(["docs/guide.md", "vault/Ideas/Draft.md"]);
    expect(lint(discovery.read("docs/guide.md"), discovery.options("docs/guide.md"))).toEqual([
      expect.objectContaining({ message: "Missing fragment in reference.md#missing." }),
    ]);
    const draft = discovery.options("vault/Ideas/Draft.md");
    expect(draft.defaultDialect).toBe("obsidian");
    expect(format(discovery.read("vault/Ideas/Draft.md"), draft).output).toBe(
      "# Draft\n\nSee [[#Draft]] and _this_.\n",
    );
  });
  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, false],
    [false, false, true],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])(
    "excludes supplied documents while keeping their buffer as a link target (existing %s, folder %s, absolute %s)",
    async (existing, folder, absolute) => {
      const target = "hidden/note.md";
      const root = await fixture(existing ? { [target]: "# Disk\n" } : {});
      const before = await tree(root);
      const excluded = folder ? "hidden" : target;
      const source = "See [the hidden heading](hidden/note.md#buffer).\n";
      const discovery = await discoverWorkspace({
        root,
        inputs: [],
        exclude: [absolute ? path.join(root, excluded) : excluded],
        config: { extends: [], dialect: "github", rules: { "links/valid": "error" } },
        documents: { "visible.md": source, [target]: "# Buffer\n" },
      });
      expect(discovery.selected).toEqual(["visible.md"]);
      expect(discovery.skipped).toEqual([]);
      expect(lint(discovery.read("visible.md"), discovery.options("visible.md"))).toEqual([]);
      expect(() => discovery.read(target)).toThrow(`Not a selected document: ${target}`);
      expect(() => discovery.options(target)).toThrow(`Not a selected document: ${target}`);
      expect(await tree(root)).toEqual(before);
    },
  );
  it("refuses a document that is not UTF-8 text with a code, and checks no link into it", async () => {
    const root = await fixture({
      ...files,
      "docs/latin.md": Buffer.from("# Caf\xe9\n", "latin1"),
      "docs/guide.md": "See [the heading](latin.md#cafe) and [the file](latin.md).\n",
    });
    const discovery = await discoverWorkspace({ root, config, inputs: ["docs"] });
    expect(discovery.selected).toEqual(["docs/guide.md", "docs/latin.md", "docs/reference.md"]);
    expect(() => discovery.read("docs/latin.md")).toThrow(
      expect.objectContaining({
        code: "ERR_ENCODING_INVALID_ENCODED_DATA",
        message: "Not UTF-8 text: docs/latin.md (byte 0xE9 on line 1 is not valid UTF-8)",
      }),
    );
    expect(lint(discovery.read("docs/guide.md"), discovery.options("docs/guide.md"))).toEqual([
      expect.objectContaining({
        message: "Fragment could not be checked: latin.md#cafe (cannot read docs/latin.md).",
      }),
    ]);
  });
  it("reports paths that cannot be used in the CLI's words", async () => {
    const root = await fixture(files);
    await expect(discoverWorkspace({ root: path.join(root, "absent") })).rejects.toThrow(
      `Workspace root does not exist: ${path.join(root, "absent")}`,
    );
    await expect(discoverWorkspace({ root, inputs: ["absent.md"] })).rejects.toThrow(
      "Input does not exist: absent.md",
    );
    const outside = await fixture({ "other.md": "Text.\n" });
    await expect(
      discoverWorkspace({ root, inputs: [path.join(outside, "other.md")] }),
    ).rejects.toThrow("Input is outside the workspace");
    await expect(discoverWorkspace({ root, documents: { "../x.md": "x" } })).rejects.toThrow(
      "Document path is outside the workspace: ../x.md",
    );
    // A file that is not Markdown is no document.
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(path.join(root, "assets/picture.png"), "");
    const discovery = await discoverWorkspace({ root, inputs: ["assets"] });
    expect(discovery.selected).toEqual([]);
  });
});
