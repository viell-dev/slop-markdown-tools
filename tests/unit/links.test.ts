import { describe, expect, it, vi } from "vitest";
import {
  createWorkspace,
  format,
  lint,
  parse,
  semanticFingerprint,
  textContent,
} from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";
import {
  headingAttributeBlock,
  headingAttributes,
} from "../../src/workspace/heading-attributes.js";

// Count the attribute-block reads that only the Forgejo and Gitea anchors need.
vi.mock("../../src/workspace/heading-attributes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/workspace/heading-attributes.js")>();
  return { ...actual, headingAttributes: vi.fn(actual.headingAttributes) };
});

const config: Config = {
  extends: [],
  dialect: "obsidian",
  rules: { "links/valid": "error", "links/path": ["warn", { style: "root", brackets: "angle" }] },
};
describe("local target resolution", () => {
  const workspace = createWorkspace(
    {
      "README.md": "# Root\n",
      "Sub/README.md": "# Sub\n",
      "Sub/Doc.md": "",
      "Elsewhere/Unique.md": "# Unique\n",
      "Other/README.md": "",
      "Sub/Local.md": "",
      "Other/Local.md": "",
    },
    { dialect: "obsidian" },
  );
  it.each([
    ["README.md", "README.md"],
    ["/README.md", "README.md"],
    ["./README.md", "Sub/README.md"],
    ["../README.md", "README.md"],
    ["Sub/README", "Sub/README.md"],
    ["Local", "Sub/Local.md"],
    ["Unique", "Elsewhere/Unique.md"],
  ])("resolves %s by explicit, root, relative, then suffix precedence", (url, target) => {
    expect(workspace.resolve("Sub/Doc.md", url!, "obsidian")).toMatchObject({
      status: "resolved",
      target,
    });
  });
  it("does not guess between suffix matches without an exact target", () => {
    expect(workspace.resolve("Elsewhere/Doc.md", "Local", "obsidian").status).toBe("ambiguous");
    expect(workspace.resolve("Elsewhere/Doc.md", "/Local", "obsidian").status).toBe("missing");
    expect(workspace.resolve("Sub/Doc.md", "../../README.md", "obsidian").status).toBe("missing");
  });
  it("keeps root rewrites semantically valid with duplicate basenames", () => {
    const source = "[root](../README.md)\n";
    const result = format(source, { path: "Sub/Doc.md", config, workspace });
    expect(result.output).toBe("[root](<README.md>)\n");
    expect(result.diagnostics).toEqual([]);
    expect(format(result.output, { path: "Sub/Doc.md", config, workspace }).changed).toBe(false);
    expect(semanticFingerprint(parse(source, "obsidian", "Sub/Doc.md"), workspace)).toBe(
      semanticFingerprint(parse(result.output, "obsidian", "Sub/Doc.md"), workspace),
    );
  });
  it("makes relative rewrites explicit when they would otherwise resolve to the root", () => {
    const relative: Config = {
      ...config,
      rules: { "links/path": ["warn", { style: "relative" }] },
    };
    const result = format("[local](Sub/README.md)\n", {
      path: "Sub/Doc.md",
      config: relative,
      workspace,
    });
    expect(result.output).toBe("[local](./README.md)\n");
    expect(result.diagnostics).toEqual([]);
    expect(format(result.output, { path: "Sub/Doc.md", config: relative, workspace }).changed).toBe(
      false,
    );
  });
  it("keeps CommonMark relative resolution and normalizes Windows source paths", () => {
    expect(workspace.resolve("Sub/Doc.md", "README.md", "github").target).toBe("Sub/README.md");
    expect(workspace.resolve("Sub\\Doc.md", "./README.md", "obsidian").target).toBe(
      "Sub/README.md",
    );
  });
  it("distinguishes directories, including empty ones, without guessing an index note", () => {
    const index = createWorkspace({ "Sub/README.md": "" }, { directories: ["Empty"] });
    for (const destination of ["Sub", "Sub/", "Empty"]) {
      const source = `[folder](<${destination}>)\n`;
      expect(lint(source, { config, workspace: index })[0]?.message).toBe(
        `Local target is a directory: ${destination}.`,
      );
      expect(format(source, { config, workspace: index }).output).toBe(source);
      expect(
        lint(source, { config: { rules: { "links/valid": "error" } }, workspace: index }),
      ).toEqual([]);
    }
  });
  it("does not load target contents until a fragment is checked, then caches them", () => {
    const read = vi.fn(() => "# Heading\n\n## Heading\n\nA block. ^id\n");
    const unused = vi.fn(() => {
      throw new Error("must not read");
    });
    const index = createWorkspace(
      { "Target.md": read, "Unused.md": unused },
      { dialect: "obsidian" },
    );
    expect(index.resolve("Doc.md", "Target.md", "obsidian").status).toBe("resolved");
    expect(read).not.toHaveBeenCalled();
    expect(index.resolve("Doc.md", "Target.md#Heading", "obsidian").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#^id", "obsidian").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#heading-1", "github").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#Missing", "obsidian").fragmentExists).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
  });
  it("computes a dialect's anchors only when a link is checked against it", () => {
    const reads = vi.mocked(headingAttributes);
    reads.mockClear();
    const index = createWorkspace({
      "Doc.md": "",
      "Target.md": '## Install {#setup}\n\n<a name="explicit"></a>\n\n<h2>Html</h2>\n',
    });
    // GitHub and Obsidian never read attribute blocks, which need a second parse.
    expect(index.resolve("Doc.md", "Target.md#install-setup", "github").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#explicit", "github").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#html", "github").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#Install {%23setup}", "obsidian").fragmentExists).toBe(
      true,
    );
    expect(reads).not.toHaveBeenCalled();
    // The forges read them once, for both dialects and every later link.
    expect(index.resolve("Doc.md", "Target.md#setup", "forgejo").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#setup", "gitea").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#html", "gitea").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#explicit", "forgejo").fragmentExists).toBe(true);
    expect(index.resolve("Doc.md", "Target.md#install", "forgejo").fragmentExists).toBe(false);
    expect(reads).toHaveBeenCalledTimes(1);
  });
});
describe("Obsidian case-insensitive resolution", () => {
  const files = {
    "Doc.md": "",
    "Note.md": "# Note\n\n## Heading Two\n\nA block. ^id\n",
    "Folder/Inner.md": "",
    "Dup.md": "",
    "dup.md": "",
    "Other/Same.md": "",
    "Other/same.md": "",
  };
  const workspace = createWorkspace(files, { dialect: "obsidian" });
  it.each([
    ["note", "Note.md"],
    ["NOTE.md", "Note.md"],
    ["folder/inner", "Folder/Inner.md"],
    ["inner", "Folder/Inner.md"],
    ["/Folder/INNER", "Folder/Inner.md"],
  ])("resolves %s like Obsidian", (url, target) => {
    expect(workspace.resolve("Doc.md", url, "obsidian")).toMatchObject({
      status: "resolved",
      target,
    });
  });
  it("matches heading subpaths case-insensitively but block identifiers exactly", () => {
    expect(workspace.resolve("Doc.md", "note#heading two", "obsidian")).toMatchObject({
      status: "resolved",
      target: "Note.md",
      fragmentExists: true,
    });
    expect(workspace.resolve("Doc.md", "Note#HEADING TWO", "obsidian").fragmentExists).toBe(true);
    expect(workspace.resolve("Doc.md", "Note#Heading Three", "obsidian").fragmentExists).toBe(
      false,
    );
    expect(workspace.resolve("Doc.md", "Note#^id", "obsidian").fragmentExists).toBe(true);
    expect(workspace.resolve("Doc.md", "Note#^ID", "obsidian").fragmentExists).toBe(false);
  });
  it("reports names that differ only by case as ambiguous", () => {
    for (const url of ["Dup", "dup", "DUP.md", "Other/Same", "same"])
      expect(workspace.resolve("Doc.md", url, "obsidian").status, url).toBe("ambiguous");
  });
  it("keeps CommonMark and GitHub path resolution case-sensitive", () => {
    for (const dialect of ["commonmark", "github"] as const) {
      expect(workspace.resolve("Doc.md", "note.md", dialect).status).toBe("missing");
      expect(workspace.resolve("Doc.md", "Note.md#heading-two", dialect).fragmentExists).toBe(true);
      // GitHub's page script retries a fragment lowercased; see the fragment tests.
      expect(workspace.resolve("Doc.md", "Note.md#Heading-Two", dialect).fragmentExists).toBe(true);
    }
    expect(workspace.resolve("Doc.md", "Dup.md", "github").status).toBe("resolved");
  });
  it("lints and rewrites case-insensitive links in Obsidian documents", () => {
    const config: Config = {
      extends: [],
      dialect: "obsidian",
      rules: { "links/valid": "error", "links/path": ["warn", { style: "root" }] },
    };
    const source = "See [[note]], [[other/same]], and [[note#heading two|there]].\n";
    expect(lint(source, { path: "Doc.md", config, workspace })).toMatchObject([
      { rule: "links/valid", message: "Ambiguous local target: other/same." },
      { rule: "links/path", message: "Normalize wikilink destination." },
    ]);
    const result = format(source, { path: "Doc.md", config, workspace });
    expect(result.output).toBe("See [[note]], [[other/same]], and [[Note#heading two|there]].\n");
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  });
});

describe("Forgejo heading anchors", () => {
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": [
      "# test.0.1",
      "## Placeholder to force scrolling on link's click",
      "## a啊啊b",
      "## c🤔️🤔️d",
      "## Same",
      "## Same",
      "## a-b-c----",
      "## tes a a   a  a",
      "## a_b_c",
      "## ...",
      "## İstanbul",
    ].join("\n\n"),
  });
  it.each([
    ["test-0-1", true],
    ["test01", false],
    ["placeholder-to-force-scrolling-on-link-s-click", true],
    ["a啊啊b", true],
    ["c-d", true],
    ["same", true],
    ["same-1", true],
    ["same-2", false],
    ["a-b-c", true],
    ["tes-a-a-a-a", true],
    ["a_b_c", true],
    ["heading", true],
    ["istanbul", true],
  ])("resolves #%s as %s", (fragment, exists) => {
    expect(workspace.resolve("Doc.md", `Note.md#${fragment}`, "forgejo").fragmentExists).toBe(
      exists,
    );
  });
  it("keeps GitHub anchors for the GitHub dialect", () => {
    expect(workspace.resolve("Doc.md", "Note.md#test01", "github").fragmentExists).toBe(true);
    expect(workspace.resolve("Doc.md", "Note.md#test-0-1", "github").fragmentExists).toBe(false);
  });
  it("validates fragments with the document's dialect", () => {
    const options = (dialect: "github" | "forgejo") => ({
      config: { extends: [], dialect, rules: { "links/valid": "error" } } as Config,
      path: "Doc.md",
      workspace,
    });
    expect(lint("[x](Note.md#test-0-1)\n", options("forgejo"))).toEqual([]);
    expect(lint("[x](Note.md#test-0-1)\n", options("github"))).toHaveLength(1);
  });
});
describe("Gitea heading anchors", () => {
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": [
      "# test.0.1",
      "## Placeholder to force scrolling on link's click",
      "## a啊啊b",
      "## c🤔️🤔️d",
      "## a-b-c----",
      "## tes a a   a  a",
      "## a_b_c",
      "## test：ad # 23 df 2*/*",
      '## Header with "double quotes"',
      "## tes（0）",
      "## Cafe\u0301",
      "## Same",
      "## Same",
      "## ...",
      "## __init__.py",
      "## İstanbul",
    ].join("\n\n"),
  });
  it.each([
    ["test01", true],
    ["test-0-1", false],
    ["placeholder-to-force-scrolling-on-links-click", true],
    ["a啊啊b", true],
    ["cd", true],
    ["a-b-c----", true],
    ["tes-a-a---a--a", true],
    ["a_b_c", true],
    ["testad--23-df-2", true],
    ["header-with-double-quotes", true],
    ["tes0", true],
    ["cafe", true],
    ["cafe\u0301", false],
    ["same", true],
    ["same-1", true],
    ["same-2", false],
    ["heading", true],
    ["__init__py", true],
    // No version generates the anchor of the text without its underscores.
    ["initpy", false],
    ["istanbul", true],
  ])("resolves #%s as %s", (fragment, exists) => {
    expect(workspace.resolve("Doc.md", `Note.md#${fragment}`, "gitea").fragmentExists).toBe(exists);
  });
  it("differs from GitHub only where Gitea drops marks and names empty headings", () => {
    const resolves = (fragment: string, dialect: "github" | "gitea") =>
      workspace.resolve("Doc.md", `Note.md#${fragment}`, dialect).fragmentExists;
    expect(resolves("cafe\u0301", "github")).toBe(true);
    expect(resolves("cafe", "github")).toBe(false);
    expect(resolves("heading", "github")).toBe(false);
    expect(resolves("test01", "github")).toBe(true);
  });
  it("validates fragments with the document's dialect", () => {
    const options = (dialect: "forgejo" | "gitea") => ({
      config: { extends: [], dialect, rules: { "links/valid": "error" } } as Config,
      path: "Doc.md",
      workspace,
    });
    expect(lint("[x](Note.md#test01)\n", options("gitea"))).toEqual([]);
    expect(lint("[x](Note.md#test01)\n", options("forgejo"))).toHaveLength(1);
  });
});
describe("Forgejo and Gitea heading attributes", () => {
  const note = (...headings: string[]) =>
    createWorkspace({ "Doc.md": "", "Note.md": `${headings.join("\n\n")}\n` });
  const resolves = (workspace: ReturnType<typeof note>, fragment: string, dialect: Dialect) =>
    workspace.resolve("Doc.md", `Note.md#${fragment}`, dialect).fragmentExists;
  const recognized = note(
    "## More tests {#custom-id}",
    "## Usage {.note}",
    "Overview {#intro}\n========",
    "Two lines\nof text {#setext}\n---",
    "### Closed ### {#closed}",
    "## Trailing {#after} ##",
    "## Escaped \\{#escaped}",
    "## Double \\\\{#double}",
    "## Spaced { #spaced .wide data-x=1 }",
    '## Quoted {id="Quoted ID"}',
    "## Last {#first #last}",
    "## Upper {ID=shout}",
    "## Invalid {#in valid}",
    "## Empty {}",
    "## _Mode {.a_}",
    "## Case {#Case-ID}",
    "> ## Quote {#in-quote}",
    "## Unusable {#}",
    "## __init__.py {.file}",
  );
  it.each([
    // Forgejo's and Gitea's own renderer tests use this heading.
    ["custom-id", true, true],
    ["more-tests", false, false],
    ["more-tests-custom-id", false, false],
    ["usage", true, true],
    ["usage-note", false, false],
    ["intro", true, true],
    ["overview", false, false],
    ["setext", true, true],
    ["closed", true, true],
    // The block must end the line. Gitea before 1.26 also read one followed by a
    // closing sequence, which is not modeled.
    ["trailing-after", true, true],
    ["after", false, false],
    ["escaped-escaped", true, true],
    ["escaped", false, false],
    ["double", true, true],
    ["spaced", true, true],
    ["Quoted%20ID", true, true],
    ["last", true, true],
    ["first", false, false],
    ["upper", true, true],
    ["shout", false, false],
    ["invalid-in-valid", true, true],
    ["in", false, false],
    ["empty", true, true],
    // goldmark removes the block before parsing emphasis, so this underscore stays text.
    ["_mode", true, true],
    ["mode-a", false, false],
    ["Case-ID", true, true],
    ["case-id", false, false],
    ["in-quote", true, true],
    // An empty id replaces the generated anchor with an unusable one.
    ["unusable", false, false],
    ["initpy", false, false],
    ["__init__py", false, true],
    ["__init__-py", true, false],
    ["__init__py-file", false, false],
  ])("resolves #%s as %s on Forgejo and %s on Gitea", (fragment, forgejo, gitea) => {
    expect(resolves(recognized, fragment, "forgejo")).toBe(forgejo);
    expect(resolves(recognized, fragment, "gitea")).toBe(gitea);
  });
  it.each([
    ["{#a}", "a"],
    ["{}", undefined],
    ["{ #a }", "a"],
    ["{.a.b#c}", "c"],
    ["{#a:b_c-d.e}", "a:b_c-d.e"],
    ["{#é日}", "é日"],
    ["{#a,}", "a"],
    ["{#a, .b, c=d}", "a"],
    ["{id=bare}", "bare"],
    ['{id = "a \\"b\\""}', 'a "b"'],
    ['{#z id="q"}', "q"],
    ['{id="q" #z}', "z"],
    ["{a=[1 2, x] b={#c} d=-1.5e3}", undefined],
    ["{id=true}", null],
    ["{id=null}", null],
    ["{id=[a]}", null],
    ["{#}", ""],
  ])("reads %s as attributes", (block, id) => {
    expect(headingAttributeBlock(`## Title ${block}  `)).toEqual({ start: 9, id });
    expect(headingAttributeBlock(`Title ${block}`)).toEqual({ start: 6, id });
  });
  it.each([
    "{ }",
    "{#a b}",
    "{#a!b}",
    "{#a/b}",
    "{,#a}",
    "{#a,,.b}",
    "{a}",
    "{a=}",
    "{1a=2}",
    "{a=[ ]}",
    "{a=[1,]}",
    "{a=1e}",
    "{a=1e999}",
    "{a=.5}",
    '{a="b}',
    '{a="b\\"}',
    "{class=1}",
    "{a={ }}",
    "{#a} text",
    "{#a}}",
    "\\{#a}",
  ])("leaves %s as heading text", (block) => {
    expect(headingAttributeBlock(`## Title ${block}`)).toBeUndefined();
  });
  it("takes the first block that reaches the end of the line", () => {
    expect(headingAttributeBlock("## Title {#a} {#b}")).toEqual({ start: 14, id: "b" });
    expect(headingAttributeBlock("## Title { {#a}")).toEqual({ start: 11, id: "a" });
    expect(headingAttributeBlock("## Title \\x{#a}")).toEqual({ start: 11, id: "a" });
  });
  it.each([
    ["setup", true],
    // A custom id is not numbered and does not count as issued for later headings.
    ["setup-1", true],
    ["setup-2", false],
    ["same", true],
    ["same-1", true],
    ["same-2", false],
    ["twice", true],
    ["twice-1", false],
    // Written with the prefix the renderers add, it does take the generated anchor.
    ["foo", true],
    ["foo-1", true],
    ["foo-2", false],
    // A link written with the prefix reaches the same anchor as one without.
    ["user-content-foo", true],
    ["user-content-setup", true],
    ["user-content-same-1", true],
    ["user-content-user-content-foo", false],
  ])("resolves repeated #%s as %s", (fragment, exists) => {
    const repeated = note(
      "## Install {#setup}",
      "## Setup",
      "## Setup",
      "## Same {.a}",
      "## Same {.b}",
      "## Twice {#twice}",
      "## Twice",
      "## Again {#twice}",
      "## Prefixed {#user-content-foo}",
      "## Foo",
    );
    // Gitea 1.26 and later number nothing; the numbered anchors are earlier versions'.
    expect(resolves(repeated, fragment, "forgejo")).toBe(exists);
    expect(resolves(repeated, fragment, "gitea")).toBe(exists);
  });
  it("leaves a block nested too deeply to parse safely as heading text", () => {
    const arrays = (depth: number, item: string) =>
      `## Title {a=${"[".repeat(depth)}${item}${"]".repeat(depth)} #ok}`;
    const attributes = (depth: number) =>
      `## Title {${"a={".repeat(depth)}${"}".repeat(depth)} #ok}`;
    for (const heading of [
      arrays(64, ""),
      arrays(64, "0"),
      attributes(64),
      arrays(3, "{b=[{#c}]}"),
    ])
      expect(headingAttributeBlock(heading)).toEqual({ start: 9, id: "ok" });
    for (const heading of [arrays(65, ""), arrays(65, "0"), attributes(65), arrays(20000, "0")])
      expect(headingAttributeBlock(heading)).toBeUndefined();
    expect(headingAttributeBlock(`## Title ${"{a=".repeat(20000)}`)).toBeUndefined();
    const workspace = note(arrays(200, "0"), "## Next {#next}");
    for (const dialect of ["forgejo", "gitea"] as const) {
      expect(resolves(workspace, "ok", dialect)).toBe(false);
      expect(resolves(workspace, "next", dialect)).toBe(true);
    }
    expect(resolves(workspace, "next-next", "github")).toBe(true);
  });
  it("scans a long run of spaces inside a heading once", () => {
    const heading = `## T ${" ".repeat(200000)}x {.note}  \t`;
    expect(headingAttributeBlock(heading)).toEqual({ start: heading.indexOf("{"), id: undefined });
    expect(headingAttributeBlock(`## T${" ".repeat(200000)}`)).toBeUndefined();
  });
  it.each(["forgejo", "gitea"] as const)(
    "reads the remaining %s heading like one written without the block",
    (dialect) => {
      // GFM parsing, unlike the default CommonMark parsing of the other workspaces here.
      const text = (source: string, removed: boolean) => {
        const document = parse(source, dialect);
        const heading = removed
          ? [...headingAttributes(document).values()][0]?.heading
          : document.tree.children.find((node) => node.type === "heading");
        return heading && textContent(heading).replace(/[\u00A0 ]+$/u, "");
      };
      for (const inline of [
        "_https://example.com_",
        "*www.example.com*",
        "https://example.com/a_b_",
        "me@example.com",
        "~~del~~",
        "_foo_",
        "foo_bar_",
        "`code`",
        "[link](http://x.y)",
        "$x_1$",
        "a\\\\",
        "foo &amp;",
      ])
        for (const [before, after] of [
          ["## ", ""],
          ["", "\n==="],
        ])
          for (const block of [" {.c}", "{.c}"]) {
            const expected = text(`${before}${inline}${after}\n`, false);
            expect(expected).toBeDefined();
            expect(text(`${before}${inline}${block}${after}\n`, true), inline).toBe(expected);
          }
    },
  );
  it("keeps a Setext heading whose text would read as another block without its block", () => {
    const workspace = note(
      "[ref]: /url {.note}\n---",
      "*** {.x}\n---",
      "_Mode_{.a}\n===",
      "_A_ B {.x_.py}\n===",
      "Two lines\n{.alone}\n===",
      "## After {#after}",
    );
    for (const dialect of ["forgejo", "gitea"] as const) {
      expect(resolves(workspace, "ref-url", dialect)).toBe(true);
      expect(resolves(workspace, "ref-url-note", dialect)).toBe(false);
      // A heading that reads `***` has no anchor characters.
      expect(resolves(workspace, "heading", dialect)).toBe(true);
      // The source line keeps the underscores that the rendered text loses.
      expect(resolves(workspace, "_mode_", dialect)).toBe(true);
      expect(resolves(workspace, "_a_-b", dialect)).toBe(true);
      expect(resolves(workspace, "mode-a", dialect)).toBe(false);
      // Nothing is left of the last line once its block is removed.
      expect(resolves(workspace, "heading-1", dialect)).toBe(true);
      expect(resolves(workspace, "after", dialect)).toBe(true);
    }
    // Gitea 1.26 and later read the rendered text of all lines; the removed
    // block's `_.py` does not make them keep the underscores.
    for (const fragment of ["mode", "a-b", "two-lines"]) {
      expect(resolves(workspace, fragment, "forgejo")).toBe(false);
      expect(resolves(workspace, fragment, "gitea")).toBe(true);
    }
  });
  it("removes the block before reading inline HTML", () => {
    const mixed = note("## A <span>B</span> {.c}", "## C <b>D</b> {#e}");
    expect(resolves(mixed, "a-span-b-span", "forgejo")).toBe(true);
    expect(resolves(mixed, "a-span-b-span-c", "forgejo")).toBe(false);
    // Gitea 1.26 and later read the rendered text; earlier versions read the source.
    expect(resolves(mixed, "a-b", "gitea")).toBe(true);
    expect(resolves(mixed, "a-spanbspan", "gitea")).toBe(true);
    expect(resolves(mixed, "a-b-c", "gitea")).toBe(false);
    for (const dialect of ["forgejo", "gitea"] as const) {
      expect(resolves(mixed, "e", dialect)).toBe(true);
      expect(resolves(mixed, "c-d", dialect)).toBe(false);
    }
    expect(resolves(mixed, "a-b-c", "github")).toBe(true);
    expect(resolves(mixed, "c-d-e", "github")).toBe(true);
  });
  it("keeps the block as heading text for other dialects", () => {
    for (const dialect of ["commonmark", "github"] as const) {
      expect(resolves(recognized, "more-tests-custom-id", dialect)).toBe(true);
      expect(resolves(recognized, "custom-id", dialect)).toBe(false);
      expect(resolves(recognized, "usage-note", dialect)).toBe(true);
      expect(resolves(recognized, "usage", dialect)).toBe(false);
      expect(resolves(recognized, "overview-intro", dialect)).toBe(true);
    }
    expect(resolves(recognized, "More tests {%23custom-id}", "obsidian")).toBe(true);
    expect(resolves(recognized, "usage {.note}", "obsidian")).toBe(true);
    expect(resolves(recognized, "More tests", "obsidian")).toBe(false);
    expect(resolves(recognized, "Usage", "obsidian")).toBe(false);
  });
  it("reports only links that miss the anchors Forgejo and Gitea render", () => {
    const workspace = createWorkspace({
      "Doc.md": "",
      "Note.md": "## Install {#setup}\n\n## Usage {.note}\n\nOverview {#intro}\n========\n",
    });
    const messages = (source: string, dialect: Dialect) =>
      lint(source, {
        config: { extends: [], dialect, rules: { "links/valid": "error" } },
        path: "Doc.md",
        workspace,
      }).map((item) => item.message);
    const source =
      "[a](Note.md#setup) [b](Note.md#install) [c](Note.md#usage) [d](Note.md#intro)\n";
    for (const dialect of ["forgejo", "gitea"] as const) {
      expect(messages(source, dialect)).toEqual(["Missing fragment in Note.md#install."]);
      expect(messages("[x](Note.md#install-setup)\n", dialect)).toHaveLength(1);
    }
    expect(messages(source, "github")).toHaveLength(4);
    expect(messages("[x](Note.md#install-setup)\n", "github")).toEqual([]);
  });
});
describe("heading anchors with inline HTML", () => {
  // The GitHub and Forgejo anchors were read from github.com and codeberg.org
  // renderings of these headings; the Gitea anchors follow its source.
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": [
      "## A <span>B</span>",
      "## A <span>B</span>",
      "## Kbd <kbd>Ctrl</kbd>+<kbd>C</kbd>",
      "## Br<br>eak",
      "## Com <!-- note --> ment",
      '## Img <img src="x.png" alt="Alt"> end',
      "## Open <span>only",
      "## X <script>hidden</script> Y",
      "## T <SCRIPT>x</SCRIPT> end",
      "## U <scripty>x</scripty> end",
      "## Code `<span>` literal",
      "## Auto <https://example.com> link",
      "## A <b>B</b> &amp; C &copy;",
      "## __init__.py <b>x</b>",
      "Setext <em>HTML</em> heading\n---",
    ].join("\n\n"),
  });
  const resolves = (fragment: string, dialect: "github" | "forgejo" | "gitea" | "obsidian") =>
    workspace.resolve("Doc.md", `Note.md#${fragment}`, dialect).fragmentExists;
  it.each([
    ["a-b", true],
    ["a-b-1", true],
    ["a-spanbspan", false],
    ["kbd-ctrlc", true],
    ["break", true],
    ["com--ment", true],
    ["img--end", true],
    ["open-only", true],
    // GFM's tagfilter makes GitHub show these tags as text.
    ["x-scripthiddenscript-y", true],
    ["x-hidden-y", false],
    ["t-scriptxscript-end", true],
    ["u-x-end", true],
    ["code-span-literal", true],
    ["auto-httpsexamplecom-link", true],
    ["a-b--c-", true],
    ["setext-html-heading", true],
  ])("resolves #%s as %s on GitHub", (fragment, exists) => {
    expect(resolves(fragment, "github")).toBe(exists);
  });
  it.each([
    ["a-span-b-span", true],
    ["a-span-b-span-1", true],
    ["a-b", false],
    ["kbd-kbd-ctrl-kbd-kbd-c-kbd", true],
    ["br-br-eak", true],
    ["com-note-ment", true],
    ["img-img-src-x-png-alt-alt-end", true],
    ["open-span-only", true],
    ["x-script-hidden-script-y", true],
    ["setext-em-html-em-heading", true],
  ])("keeps the tags in #%s on Forgejo (%s)", (fragment, exists) => {
    expect(resolves(fragment, "forgejo")).toBe(exists);
  });
  it.each([
    // Gitea 1.26 and later: the rendered text, without numbering.
    ["a-b", true],
    ["a-b-1", false],
    ["kbd-ctrlc", true],
    ["break", true],
    ["com--ment", true],
    // Gitea 1.26 and later show `<script>` as text; `x-scripthiddenscript-y` is below.
    ["x-hidden-y", false],
    ["__init__py-x", true],
    ["setext-html-heading", true],
    // Gitea 1.21 to 1.25: the heading's source, numbered.
    ["a-spanbspan", true],
    ["a-spanbspan-1", true],
    ["kbd-kbdctrlkbdkbdckbd", true],
    ["brbreak", true],
    ["com----note----ment", true],
    ["x-scripthiddenscript-y", true],
    ["__init__py-bxb", true],
    ["setext-emhtmlem-heading", true],
  ])("resolves #%s as %s on Gitea", (fragment, exists) => {
    expect(resolves(fragment, "gitea")).toBe(exists);
  });
  it.each(["iframe", "noembed", "noframes", "script", "style", "title", "textarea", "xmp"])(
    "keeps <%s>, which GitHub shows as text, in the GitHub anchor",
    (tag) => {
      const filtered = createWorkspace({
        "Doc.md": "",
        "Note.md": `## T <${tag}>x</${tag}> end\n\n## P <plaintext>x end\n`,
      });
      const exists = (fragment: string) =>
        filtered.resolve("Doc.md", `Note.md#${fragment}`, "github").fragmentExists;
      expect(exists(`t-${tag}x${tag}-end`)).toBe(true);
      expect(exists("t-x-end")).toBe(false);
      expect(exists("p-plaintextx-end")).toBe(true);
    },
  );
  it("keeps exact heading text for Obsidian", () => {
    expect(resolves("A <span>B</span>", "obsidian")).toBe(true);
    expect(resolves("A B", "obsidian")).toBe(false);
  });
  it("reports only links to anchors the renderer does not generate", () => {
    const options = (dialect: "github" | "forgejo" | "gitea") => ({
      config: { extends: [], dialect, rules: { "links/valid": "error" } } as Config,
      path: "Doc.md",
      workspace,
    });
    expect(lint("[x](Note.md#a-b)\n", options("github"))).toEqual([]);
    expect(lint("[x](Note.md#a-spanbspan)\n", options("github"))).toHaveLength(1);
    expect(lint("[x](Note.md#a-b)\n", options("gitea"))).toEqual([]);
    expect(lint("[x](Note.md#a-b)\n", options("forgejo"))).toHaveLength(1);
    expect(lint("[x](Note.md#a-span-b-span)\n", options("forgejo"))).toEqual([]);
  });
});
describe("heading anchors built from the last source line", () => {
  // Each row is a heading and its anchor as rendered by Forgejo 16.0.5, by
  // Gitea 1.21.11, 1.23.8, and 1.25.5, which agree, and by Gitea 1.27.3 and
  // 28.0.0, which agree. Forgejo, and Gitea before 1.26, read the source of the
  // heading's last line; later Gitea versions read the rendered text, tested
  // here only where it is modeled.
  const headings: [string, string, string, string | undefined][] = [
    [
      "## Link [text](https://example.com/page) end",
      "link-text-https-example-com-page-end",
      "link-texthttpsexamplecompage-end",
      "link-text-end",
    ],
    ["## Ref [text][ref] end", "ref-text-ref-end", "ref-textref-end", "ref-text-end"],
    [
      "## Image ![Alt text](x.png) end",
      "image-alt-text-x-png-end",
      "image-alt-textxpng-end",
      "image--end",
    ],
    [
      "## Emph _under_ and *star* end",
      "emph-_under_-and-star-end",
      "emph-_under_-and-star-end",
      "emph-under-and-star-end",
    ],
    ["## Strong __init__ end", "strong-__init__-end", "strong-__init__-end", "strong-init-end"],
    ["## Entity &amp; end", "entity-amp-end", "entity-amp-end", "entity--end"],
    ["Two lines\nof text\n===", "of-text", "of-text", "two-lines-of-text"],
    // Nothing is left of the last line once its attribute block is removed.
    ["Alpha\n{.note}\n---", "heading", "heading", "alpha"],
    ["## Closed heading ##", "closed-heading", "closed-heading", "closed-heading"],
    ["##   Spaced   out   ", "spaced-out", "spaced---out", "spaced---out"],
    ["## Trailing hashes ## ##", "trailing-hashes", "trailing-hashes-", "trailing-hashes-"],
    ["## Escaped \\# hash", "escaped-hash", "escaped--hash", "escaped--hash"],
    ["## Back\\\\slash \\* star", "back-slash-star", "backslash--star", "backslash--star"],
    ["## Code `a_b` and `<x>`", "code-a_b-and-x", "code-a_b-and-x", "code-a_b-and-x"],
    ["## HTML <span>B</span> end", "html-span-b-span-end", "html-spanbspan-end", "html-b-end"],
    [
      "## Auto <https://example.com> end",
      "auto-https-example-com-end",
      "auto-httpsexamplecom-end",
      "auto-httpsexamplecom-end",
    ],
    ["## Tab\tseparated", "tab-separated", "tab-separated", "tab-separated"],
    ["## Hash#inside", "hash-inside", "hashinside", "hashinside"],
    ["## Ends with hash#", "ends-with-hash", "ends-with-hash", "ends-with-hash"],
    // Block quote and list prefixes are not part of the line.
    ["> ## Quoted heading", "quoted-heading", "quoted-heading", "quoted-heading"],
    [
      "> Quoted setext\n> second line\n> ===",
      "second-line",
      "second-line",
      "quoted-setext-second-line",
    ],
    ["> Lazy setext\nlazy line\n> ---", "lazy-line", "lazy-line", "lazy-setext-lazy-line"],
    [
      "- List setext\n  item line two\n  ---",
      "item-line-two",
      "item-line-two",
      "list-setext-item-line-two",
    ],
    ["1. ## List heading", "list-heading", "list-heading", "list-heading"],
    [
      "## Unicode Ünïcödé — dash",
      "unicode-ünïcödé-dash",
      "unicode-ünïcödé--dash",
      "unicode-ünïcödé--dash",
    ],
    ["## Strike ~~gone~~ end", "strike-gone-end", "strike-gone-end", "strike-gone-end"],
    ["## Math $x_1$ end", "math-x_1-end", "math-x_1-end", "math-x_1-end"],
    // Later Gitea versions give `#footnote1--end`, which is not modeled.
    ["## Footnote[^1] end", "footnote-1-end", "footnote1-end", undefined],
    ["## Emoji :smile: end", "emoji-smile-end", "emoji-smile-end", "emoji-smile-end"],
    ["Setext trailing   \ncontinued  \n===", "continued", "continued", "setext-trailing-continued"],
    [
      "   Indented setext\n   indented last\n---",
      "indented-last",
      "indented-last",
      "indented-setext-indented-last",
    ],
    // Empty headings are numbered after `Alpha` above; later Gitea versions give them no anchor.
    ["##", "heading-1", "heading-1", undefined],
    ["## #", "heading-2", "heading-2", undefined],
    ["## Dup", "dup", "dup", "dup"],
    ["## Dup", "dup-1", "dup-1", "dup"],
    ["## [text](url) only", "text-url-only", "texturl-only", "text-only"],
    ["## Mixed-Case_and-dash", "mixed-case_and-dash", "mixed-case_and-dash", "mixed-case_and-dash"],
    // Gitea 1.26 and later show `<script>`, `<style>`, `<html>`, and `<head>` as
    // text, keep the text of other tags they drop, and leave allowed tags out.
    [
      "## S <script>a</script> end",
      "s-script-a-script-end",
      "s-scriptascript-end",
      "s-scriptascript-end",
    ],
    ["## S <style>a</style> end", "s-style-a-style-end", "s-styleastyle-end", "s-styleastyle-end"],
    ["## S <head>a</head> end", "s-head-a-head-end", "s-headahead-end", "s-headahead-end"],
    [
      '## S <SCRIPT type="x">a</SCRIPT> end',
      "s-script-type-x-a-script-end",
      "s-script-typexascript-end",
      "s-script-typexascript-end",
    ],
    ["## S <iframe>a</iframe> end", "s-iframe-a-iframe-end", "s-iframeaiframe-end", "s-a-end"],
    ["## S <foo>a</foo> end", "s-foo-a-foo-end", "s-fooafoo-end", "s-a-end"],
    ["## S <kbd>a</kbd> end", "s-kbd-a-kbd-end", "s-kbdakbd-end", "s-a-end"],
    ["## S <title>a</title> end", "s-title-a-title-end", "s-titleatitle-end", "s-a-end"],
    // The two Gitea generations differ here only in the emphasis, which tells
    // the rendered-text path apart from the source-line path.
    [
      "## S __x__ <script>a</script> end",
      "s-__x__-script-a-script-end",
      "s-__x__-scriptascript-end",
      "s-x-scriptascript-end",
    ],
    // An indented continuation line is content from its first non-blank character,
    // so a `>` there is text; only the markers of enclosing block quotes go.
    ["Alpha\n    > beta\n---", "beta", "-beta", "alpha--beta"],
    ["> Quoted\n>     > deep\n> ---", "deep", "-deep", "quoted--deep"],
    // A closing sequence before the block closes the heading and is left out.
    ["## Title ## {.note}", "title", "title", "title"],
    ["## Title", "title-1", "title-1", "title"],
    // Only the first `#` run after a space is tried, as goldmark does.
    ["## Also #x ## {.note}", "also-x", "also-x-", "also-x"],
  ];
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": `${headings.map(([source]) => source).join("\n\n")}\n\n[ref]: https://example.com/ref\n[^1]: note\n`,
  });
  const resolves = (fragment: string, dialect: Dialect) =>
    workspace.resolve("Doc.md", `Note.md#${encodeURIComponent(fragment)}`, dialect).fragmentExists;
  const forgejoAnchors = new Set(headings.map(([, forgejo]) => forgejo));
  it.each(headings)(
    "gives %j #%s on Forgejo and #%s or #%s on Gitea",
    (_, forgejo, giteaSource, giteaRendered) => {
      expect(resolves(forgejo, "forgejo")).toBe(true);
      expect(resolves(giteaSource, "gitea")).toBe(true);
      if (giteaRendered === undefined) return;
      expect(resolves(giteaRendered, "gitea")).toBe(true);
      // Forgejo generates no anchor from the rendered text.
      if (!forgejoAnchors.has(giteaRendered))
        expect(resolves(giteaRendered, "forgejo")).toBe(false);
    },
  );
  it("leaves the anchors of the other dialects unchanged", () => {
    expect(resolves("link-text-end", "github")).toBe(true);
    expect(resolves("link-text-https-example-com-page-end", "github")).toBe(false);
    expect(resolves("of-text", "github")).toBe(false);
    expect(resolves("Link text end", "obsidian")).toBe(true);
  });
  it("numbers only the anchors that Gitea versions before 1.26 generate", () => {
    const repeated = createWorkspace({
      "Doc.md": "",
      "Note.md": "## See [x](y.md) one\n\n## See [x](y.md) one\n",
    });
    const exists = (fragment: string, dialect: Dialect) =>
      repeated.resolve("Doc.md", `Note.md#${fragment}`, dialect).fragmentExists;
    expect(exists("see-x-y-md-one", "forgejo")).toBe(true);
    expect(exists("see-x-y-md-one-1", "forgejo")).toBe(true);
    expect(exists("see-x-one", "forgejo")).toBe(false);
    // Rendered on Gitea 1.25.5 as `see-xymd-one` and `see-xymd-one-1`, and on
    // 1.27.3 as `see-x-one` twice.
    expect(exists("see-xymd-one", "gitea")).toBe(true);
    expect(exists("see-xymd-one-1", "gitea")).toBe(true);
    expect(exists("see-x-one", "gitea")).toBe(true);
    expect(exists("see-x-one-1", "gitea")).toBe(false);
  });
  it("reports only links that miss the anchors the renderer generates", () => {
    const messages = (source: string, dialect: Dialect) =>
      lint(source, {
        config: { extends: [], dialect, rules: { "links/valid": "error" } },
        path: "Doc.md",
        workspace,
      }).map((item) => item.message);
    const source = "[a](Note.md#link-text-https-example-com-page-end) [b](Note.md#link-text-end)\n";
    expect(messages(source, "forgejo")).toEqual(["Missing fragment in Note.md#link-text-end."]);
    expect(messages(source, "gitea")).toEqual([
      "Missing fragment in Note.md#link-text-https-example-com-page-end.",
    ]);
    expect(messages(source, "github")).toEqual([
      "Missing fragment in Note.md#link-text-https-example-com-page-end.",
    ]);
  });
});
describe("fragments written with the user-content- prefix", () => {
  // GitHub, Forgejo, and Gitea store every anchor as `user-content-<anchor>`
  // and add the prefix to a link's fragment unless it is already there. In a
  // browser, `#user-content-setup` reached `## Setup` on Forgejo 16.0.5 and
  // Gitea 1.21.11, 1.25.5, and 28.0.0, and a prefixed link reached an HTML
  // heading on github.com.
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": "## Setup\n\n## Setup\n\n## Install {#custom}\n\nText ^block\n",
  });
  const resolves = (fragment: string, dialect: Dialect) =>
    workspace.resolve("Doc.md", `Note.md#${fragment}`, dialect).fragmentExists;
  it.each(["github", "forgejo", "gitea", "commonmark"] as const)(
    "accepts the prefixed spelling of every anchor on %s",
    (dialect) => {
      // The custom id is text on GitHub, where the heading is #install-custom.
      const anchors = [
        "setup",
        dialect === "forgejo" || dialect === "gitea" ? "custom" : "install-custom",
      ];
      for (const anchor of anchors) {
        expect(resolves(anchor, dialect)).toBe(true);
        expect(resolves(`user-content-${anchor}`, dialect)).toBe(true);
      }
      // The renderers add the prefix once, so a second one is part of the fragment.
      expect(resolves("user-content-user-content-setup", dialect)).toBe(false);
      expect(resolves("user-content-missing", dialect)).toBe(false);
      expect(resolves("user-content-", dialect)).toBe(false);
    },
  );
  it("does not prefix a heading whose own anchor starts with the prefix again", () => {
    // Rendered on Forgejo 16.0.5 and Gitea 1.25.5: `## user-content-setup` has
    // the id `user-content-setup` and a later `## Setup` is `user-content-setup-1`.
    // Gitea 28.0.0 gives the first `user-content-user-content-setup` and the
    // second `user-content-setup`; in a browser, `#user-content-setup` reached
    // the second and `#user-content-user-content-setup` the first there.
    const prefixed = createWorkspace({
      "Doc.md": "",
      "Note.md":
        "## user-content-setup\n\n## Setup\n\n## user-content-dup\n\n## user-content-dup\n",
    });
    const exists = (fragment: string, dialect: Dialect) =>
      prefixed.resolve("Doc.md", `Note.md#${fragment}`, dialect).fragmentExists;
    for (const dialect of ["forgejo", "gitea", "github"] as const) {
      expect(exists("setup", dialect)).toBe(true);
      expect(exists("user-content-setup", dialect)).toBe(true);
      expect(exists("user-content-dup", dialect)).toBe(true);
    }
    for (const dialect of ["forgejo", "gitea"] as const) {
      expect(exists("setup-1", dialect)).toBe(true);
      expect(exists("dup-1", dialect)).toBe(true);
      expect(exists("user-content-dup-1", dialect)).toBe(true);
    }
    expect(exists("setup-1", "github")).toBe(false);
    // Gitea 1.26 and later also have the doubly prefixed element.
    expect(exists("user-content-user-content-setup", "gitea")).toBe(true);
    expect(exists("user-content-user-content-setup", "forgejo")).toBe(false);
    expect(exists("user-content-user-content-setup", "github")).toBe(false);
  });
  it("accepts a numbered anchor with the prefix only where it is generated", () => {
    expect(resolves("user-content-setup-1", "forgejo")).toBe(true);
    expect(resolves("user-content-setup-1", "gitea")).toBe(true);
    expect(resolves("user-content-setup-1", "github")).toBe(true);
  });
  it("keeps Obsidian fragments literal", () => {
    expect(resolves("Setup", "obsidian")).toBe(true);
    expect(resolves("user-content-Setup", "obsidian")).toBe(false);
    expect(resolves("^block", "obsidian")).toBe(true);
  });
  it("reports only fragments that reach no anchor", () => {
    const messages = (dialect: Dialect) =>
      lint("[a](Note.md#user-content-setup) [b](Note.md#user-content-nothing)\n", {
        config: { extends: [], dialect, rules: { "links/valid": "error" } },
        path: "Doc.md",
        workspace,
      }).map((item) => item.message);
    for (const dialect of ["github", "forgejo", "gitea"] as const)
      expect(messages(dialect)).toEqual(["Missing fragment in Note.md#user-content-nothing."]);
  });
});

describe("anchors from HTML in the document", () => {
  // Rendered through GitHub's Markdown API and on local Forgejo 16.0.5 and
  // Gitea 1.21.11, 1.25.5, and 28.0.0: all three keep `id` on every element
  // and `name` on `<a>`, prefixed with `user-content-`; GitHub also lowercases
  // them, and its page script lowercases a fragment it cannot find as written.
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": [
      '<a name="install"></a>',
      "## Getting started",
      '<a id="note-1"></a>Text with a marked spot.',
      '<span id="span-id">span</span> and <div id="div-id">block</div>',
      '<h2 id="explicit">Explicit</h2>',
      '<p id="para">para</p>',
      '<a name="Mixed Case"></a>',
      '<a id="user-content-pre"></a>',
      '<p id="MixedId">mixed</p>',
      '<A NAME="Caps" ID="CapsId"></A>',
      "<span id='single'>s</span> <span id=bare>b</span> <span id=\"\">empty</span>",
      '<img id="img-id" src="x.png"> <table id="t-id"><tr><td id="td-id">x</td></tr></table>',
      '<details id="det-id"><summary id="sum-id">s</summary>body</details>',
      '<span name="not-an-anchor">n</span>',
      '<!-- <a name="hidden"></a> <span id="hidden-id">x</span> -->',
      'Text <!-- <a name="inline-hidden"></a> --> more',
      '<div title="<!--" id="real">--></div>',
      '<script id="ghost">var a = "<a id=\'script-text\'></a>";</script>',
      '<textarea><a id="textarea-text"></a></textarea>',
      '<style id="style-ghost">a {}</style>',
      '<a id="first" id="second"></a>',
      '<!DOCTYPE html><a id="after-doctype"></a>',
      '`<span id="in-code">`',
      '    <span id="indented-code">',
      '```html\n<span id="fenced">\n```',
      "## install",
    ].join("\n\n"),
  });
  const resolves = (fragment: string, dialect: Dialect) =>
    workspace.resolve("Doc.md", `Note.md#${encodeURIComponent(fragment)}`, dialect).fragmentExists;
  const github = ["github", "forgejo", "gitea"] as const;
  it.each([
    "install",
    "note-1",
    "span-id",
    "div-id",
    "explicit",
    "para",
    "Mixed Case",
    "pre",
    "user-content-pre",
    "MixedId",
    "Caps",
    "CapsId",
    "single",
    "bare",
    "img-id",
    "t-id",
    "td-id",
    "det-id",
    "sum-id",
    // A `<!--` inside a quoted attribute value is part of the value, not a comment.
    "real",
    // Forgejo 16.0.5 and Gitea 28.0.0 keep the first of repeated attributes,
    // Gitea 1.25.5 the last; both are accepted.
    "first",
    "second",
    "after-doctype",
  ])("resolves #%s on GitHub, Forgejo, and Gitea", (fragment) => {
    for (const dialect of github) expect(resolves(fragment, dialect)).toBe(true);
    // Obsidian has no such anchors; `install` is also a heading's text there.
    expect(resolves(fragment, "obsidian")).toBe(fragment === "install");
  });
  it.each([
    "not-an-anchor",
    "hidden",
    "hidden-id",
    "inline-hidden",
    "in-code",
    "indented-code",
    "fenced",
    "getting-started-1",
    // Raw-text elements are shown as text or removed; nothing in them is an element.
    "ghost",
    "script-text",
    "textarea-text",
    "style-ghost",
  ])("does not resolve #%s anywhere", (fragment) => {
    for (const dialect of [...github, "obsidian"] as const)
      expect(resolves(fragment, dialect)).toBe(false);
  });
  it("matches case-insensitively on GitHub only", () => {
    expect(resolves("mixedid", "github")).toBe(true);
    expect(resolves("MIXEDID", "github")).toBe(true);
    expect(resolves("mixed case", "github")).toBe(true);
    expect(resolves("caps", "github")).toBe(true);
    for (const dialect of ["forgejo", "gitea"] as const) {
      expect(resolves("mixedid", dialect)).toBe(false);
      expect(resolves("mixed case", dialect)).toBe(false);
      expect(resolves("caps", dialect)).toBe(false);
    }
  });
  it("does not let an explicit anchor number a later heading", () => {
    // `<a name="install">` and `## install` both exist; the heading is not `install-1`.
    for (const dialect of github) {
      expect(resolves("install", dialect)).toBe(true);
      expect(resolves("install-1", dialect)).toBe(false);
    }
  });
  it("reports only links to anchors the page does not have", () => {
    const messages = (dialect: Dialect) =>
      lint("[a](Note.md#install) [b](Note.md#note-1) [c](Note.md#hidden)\n", {
        config: { extends: [], dialect, rules: { "links/valid": "error" } },
        path: "Doc.md",
        workspace,
      }).map((item) => item.message);
    for (const dialect of github)
      expect(messages(dialect)).toEqual(["Missing fragment in Note.md#hidden."]);
  });
  it("hides anchors in a comment that is never closed", () => {
    // A comment block without `-->` runs to the end of the document, and a
    // browser treats an unterminated comment the same way.
    const unclosed = createWorkspace({
      "Doc.md": "",
      "Note.md": '<a id="before"></a>\n\n<!--\n<a id="ghost"></a>\n\n<a id="after"></a>\n',
    });
    const exists = (fragment: string) =>
      unclosed.resolve("Doc.md", `Note.md#${fragment}`, "forgejo").fragmentExists;
    expect(exists("before")).toBe(true);
    expect(exists("ghost")).toBe(false);
    expect(exists("after")).toBe(false);
  });
  it("reaches a doubly prefixed id with the fragment as written on the forges", () => {
    // Forgejo's and Gitea's page scripts add the prefix to a fragment unconditionally
    // first, so `#user-content-x` finds `user-content-user-content-x`, as a browser
    // showed for a heading with the same id on Gitea 28.0.0. GitHub adds it only
    // when absent, so there the fragment must carry both.
    const doubled = createWorkspace({
      "Doc.md": "",
      "Note.md": '<a id="user-content-user-content-x"></a>\n',
    });
    const exists = (fragment: string, dialect: Dialect) =>
      doubled.resolve("Doc.md", `Note.md#${fragment}`, dialect).fragmentExists;
    for (const dialect of ["forgejo", "gitea"] as const) {
      expect(exists("user-content-x", dialect)).toBe(true);
      expect(exists("user-content-user-content-x", dialect)).toBe(true);
      expect(exists("x", dialect)).toBe(false);
    }
    expect(exists("user-content-user-content-x", "github")).toBe(true);
    expect(exists("user-content-x", "github")).toBe(false);
  });
  it("scans unusual HTML in linear time", () => {
    const hostile = createWorkspace({
      "Doc.md": "",
      "Note.md": [
        `<a ${"x ".repeat(100000)}`,
        "<a ".repeat(50000),
        `<a id="${"x".repeat(200000)}`,
        `<a ${'id="a" '.repeat(20000)}${"'".repeat(20000)}`,
        // Real HTML blocks: many tags, a raw-text element that never closes,
        // and, last because it swallows the rest, a comment opener on every line.
        '<div>\n<span id="s"></span>\n'.repeat(20000),
        `<div>\n<textarea>${"<a id='t'></a>\n".repeat(20000)}`,
        "<!--\n".repeat(50000),
      ].join("\n\n"),
    });
    const start = performance.now();
    expect(hostile.resolve("Doc.md", "Note.md#a", "forgejo").fragmentExists).toBe(false);
    expect(hostile.resolve("Doc.md", "Note.md#t", "forgejo").fragmentExists).toBe(false);
    expect(hostile.resolve("Doc.md", "Note.md#s", "forgejo").fragmentExists).toBe(true);
    expect(performance.now() - start).toBeLessThan(4000);
  });
});

describe("fragment case on GitHub", () => {
  // On github.com, `#Sponsors` scrolled to `## Sponsors`: the page script looks
  // for the anchor as written and then lowercased, and the file view lowercases
  // it outright. Forgejo and Gitea match as written: in a browser, `#Upper`
  // reached `<a name="Upper">` on Forgejo 16.0.5 and Gitea 1.21.11, 1.25.5, and
  // 28.0.0, and `#upper` did not.
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": '## Sponsors\n\n## Sponsors\n\n## Üben\n\n<a name="Upper"></a>\n',
  });
  const resolves = (fragment: string, dialect: Dialect) =>
    workspace.resolve("Doc.md", `Note.md#${encodeURIComponent(fragment)}`, dialect).fragmentExists;
  it.each([
    "Sponsors",
    "SPONSORS",
    "sponsors",
    "Sponsors-1",
    "user-content-Sponsors",
    "üben",
    "ÜBEN",
  ])("resolves #%s on GitHub", (fragment) => {
    expect(resolves(fragment, "github")).toBe(true);
    expect(resolves(fragment, "commonmark")).toBe(true);
  });
  it("still reports fragments that differ in more than case", () => {
    expect(resolves("Sponsor", "github")).toBe(false);
    expect(resolves("Sponsors-2", "github")).toBe(false);
  });
  it("keeps Forgejo and Gitea case-sensitive", () => {
    for (const dialect of ["forgejo", "gitea"] as const) {
      expect(resolves("sponsors", dialect)).toBe(true);
      expect(resolves("Sponsors", dialect)).toBe(false);
      expect(resolves("Upper", dialect)).toBe(true);
      expect(resolves("upper", dialect)).toBe(false);
    }
  });
  it("reports only fragments GitHub cannot resolve", () => {
    const messages = lint("[a](Note.md#Sponsors) [b](Note.md#Sponsor)\n", {
      config: { extends: [], dialect: "github", rules: { "links/valid": "error" } },
      path: "Doc.md",
      workspace,
    }).map((item) => item.message);
    expect(messages).toEqual(["Missing fragment in Note.md#Sponsor."]);
  });
});

describe("anchors of headings written as HTML", () => {
  // GitHub generates an anchor for an HTML heading as for a Markdown one
  // (`<h3 align="center">Special Sponsor</h3>` is #special-sponsor on a live
  // README). Gitea 1.27.3 and 28.0.0, run locally, do the same for headings
  // without an `id`; Forgejo 16.0.5 and Gitea 1.21.11 to 1.25.5 give them none.
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": [
      '<h2 align="center">Special Thanks</h2>',
      '<div align="center">\n<h3>Inside div</h3>\n</div>',
      "<h2>Same</h2>",
      "## Same",
      "<h2>Same</h2>",
      "<h2>Rich <em>text</em> &amp; <code>code</code> here</h2>",
      '<h2 id="given">Given id</h2>',
      "<h2>Multi\nline</h2>",
      "<h4>  Spaced  </h4>",
      "<H2>Upper Tag</H2>",
      "<h2>A &lt;b&gt; entity</h2>",
      "Inline <h2>inline heading</h2> text",
      "Inline <h2>with *emphasis* and `<h2>code</h2>`</h2> text",
      "<h2>Caf&eacute; &#233; &#xE9;</h2>",
      "<!-- <h2>Commented</h2> -->",
      "<script><h2>Scripted</h2></script>",
      "<textarea><h2>Typed</h2></textarea>",
      "<!DOCTYPE html><h2>Declared</h2>",
      "`<h2>In code</h2>`",
      "```html\n<h2>Fenced</h2>\n```",
      "<h7>Not a heading</h7>",
      "<h2>Unclosed",
    ].join("\n\n"),
  });
  const resolves = (fragment: string, dialect: Dialect) =>
    workspace.resolve("Doc.md", `Note.md#${encodeURIComponent(fragment)}`, dialect).fragmentExists;
  it.each([
    ["special-thanks", true, true],
    ["inside-div", true, true],
    ["same", true, true],
    // GitHub numbers Markdown and HTML headings together, Gitea numbers nothing.
    ["same-1", true, false],
    ["same-2", true, false],
    ["same-3", false, false],
    ["rich-text--code-here", true, true],
    // GitHub's filter also generates an anchor for a heading that has an id; Gitea keeps the id only.
    ["given", true, true],
    ["given-id", true, false],
    // GitHub replaces spaces alone, as its slugger does for Markdown headings.
    ["multi-line", false, true],
    ["multiline", true, false],
    ["spaced", false, true],
    ["--spaced--", true, false],
    ["upper-tag", true, true],
    ["a-b-entity", true, true],
    ["inline-heading", true, true],
    ["with-emphasis-and-h2codeh2", true, true],
    ["café-é-é", true, true],
    ["commented", false, false],
    // Raw-text elements are shown as text or removed, so nothing in them is a heading.
    ["scripted", false, false],
    ["typed", false, false],
    ["declared", true, true],
    ["in-code", false, false],
    ["fenced", false, false],
    ["not-a-heading", false, false],
    ["unclosed", false, false],
  ])("resolves #%s as %s on GitHub and %s on Gitea", (fragment, github, gitea) => {
    expect(resolves(fragment, "github")).toBe(github);
    expect(resolves(fragment, "commonmark")).toBe(github);
    expect(resolves(fragment, "gitea")).toBe(gitea);
  });
  it("hides headings in a comment that is never closed", () => {
    const unclosed = createWorkspace({
      "Doc.md": "",
      "Note.md": "<h2>Before</h2>\n\n<!--\n<h2>Ghost</h2>\n\n<h2>After</h2>\n",
    });
    const exists = (fragment: string) =>
      unclosed.resolve("Doc.md", `Note.md#${fragment}`, "github").fragmentExists;
    expect(exists("before")).toBe(true);
    expect(exists("ghost")).toBe(false);
    expect(exists("after")).toBe(false);
  });
  it("reads headings the way HTML is tokenized", () => {
    // Each heading was rendered on Gitea 28.0.0, whose anchors are in the comments.
    const tokenized = createWorkspace({
      "Doc.md": "",
      "Note.md": [
        // #a and #b: a heading's start tag ends the heading that is open.
        "<h2>A<h3>B</h3></h2>",
        // #c-d: a `>` inside a quoted attribute value does not end the tag.
        '<h2>C <span title=">wrong">D</span></h2>',
        // #real: a `<!--` inside a quoted value starts no comment.
        '<div title="<!--"><h2>Real</h2></div>',
        // No heading: the tags are an attribute's value.
        '<div title="<h2>Ghost</h2>"></div>',
        // #title: the tags are inside emphasis, not direct children of the paragraph.
        "*before <h2>Title</h2> after*",
        // #nul: a reference to no character becomes U+FFFD, which no anchor keeps.
        "<h2>N&#0;ul</h2>",
        // #a-semicolonless: a numeric reference needs no semicolon.
        "<h2>&#65 semicolonless</h2>",
      ].join("\n\n"),
    });
    const exists = (fragment: string, dialect: Dialect) =>
      tokenized.resolve("Doc.md", `Note.md#${fragment}`, dialect).fragmentExists;
    for (const dialect of ["github", "gitea"] as const) {
      for (const fragment of ["a", "b", "c-d", "real", "title", "nul", "a-semicolonless"])
        expect(exists(fragment, dialect), `${fragment} on ${dialect}`).toBe(true);
      for (const fragment of ["ab", "c-wrongd", "ghost", "n0ul", "65-semicolonless"])
        expect(exists(fragment, dialect), `${fragment} on ${dialect}`).toBe(false);
    }
  });
  it("does not prefix an HTML heading whose text starts with the prefix again on GitHub", () => {
    // Gitea 28.0.0 renders `<h2>user-content-setup</h2>` with the id
    // `user-content-user-content-setup`, as it does for the Markdown heading.
    const prefixed = createWorkspace({ "Doc.md": "", "Note.md": "<h2>user-content-setup</h2>\n" });
    const exists = (fragment: string, dialect: Dialect) =>
      prefixed.resolve("Doc.md", `Note.md#${fragment}`, dialect).fragmentExists;
    expect(exists("setup", "github")).toBe(true);
    expect(exists("user-content-setup", "github")).toBe(true);
    expect(exists("user-content-user-content-setup", "github")).toBe(false);
    expect(exists("user-content-setup", "gitea")).toBe(true);
    expect(exists("user-content-user-content-setup", "gitea")).toBe(true);
    expect(exists("setup", "gitea")).toBe(false);
  });
  it("reads many unclosed headings in linear time", () => {
    const hostile = createWorkspace({
      "Doc.md": "",
      "Note.md": `${"<h2>x\n".repeat(50000)}\n\n<div>\n${'<div title="<h2>">\n'.repeat(20000)}`,
    });
    const start = performance.now();
    expect(hostile.resolve("Doc.md", "Note.md#x", "github").fragmentExists).toBe(true);
    expect(hostile.resolve("Doc.md", "Note.md#x-49999", "github").fragmentExists).toBe(false);
    expect(performance.now() - start).toBeLessThan(4000);
  });
  it("gives HTML headings no anchor on Forgejo or Obsidian", () => {
    for (const fragment of ["special-thanks", "inside-div", "same-1", "inline-heading"]) {
      expect(resolves(fragment, "forgejo")).toBe(false);
      expect(resolves(fragment, "obsidian")).toBe(false);
    }
    expect(resolves("same", "forgejo")).toBe(true);
    expect(resolves("given", "forgejo")).toBe(true);
  });
  it("reports only links to anchors the renderer does not generate", () => {
    const messages = (dialect: Dialect) =>
      lint("[a](Note.md#special-thanks) [b](Note.md#same-1) [c](Note.md#commented)\n", {
        config: { extends: [], dialect, rules: { "links/valid": "error" } },
        path: "Doc.md",
        workspace,
      }).map((item) => item.message);
    expect(messages("github")).toEqual(["Missing fragment in Note.md#commented."]);
    expect(messages("gitea")).toEqual([
      "Missing fragment in Note.md#same-1.",
      "Missing fragment in Note.md#commented.",
    ]);
    expect(messages("forgejo")).toHaveLength(3);
  });
});

describe("links/path on Gitea", () => {
  const workspace = createWorkspace({ "Doc.md": "", "readme.md": "# R\n" });
  const rewrite = (source: string, dialect: "github" | "gitea") =>
    format(source, {
      path: "Doc.md",
      workspace,
      config: { extends: [], dialect, rules: { "links/path": ["warn", { style: "relative" }] } },
    }).output;
  it("keeps destinations whose underscores decide the `_.py` exception on that line", () => {
    const source = "_a_ see [r](./my_dir/../readme.md) and b_.py\n";
    expect(rewrite(source, "gitea")).toBe(source);
    expect(rewrite(source, "github")).toBe("_a_ see [r](readme.md) and b_.py\n");
    expect(rewrite("See [r](./my_dir/../readme.md).\n", "gitea")).toBe("See [r](readme.md).\n");
  });
});
describe("destination spelling", () => {
  it.each([
    ["What is this? A test.md", "What is this? A test.md"],
    ["100% sure.md", "100% sure.md"],
    ["100% sure.md", "100%25 sure.md"],
    ["A#B.md", "A%23B.md"],
    ["A%20B.md", "A%2520B.md"],
  ])("preserves an already compliant destination: %s / %s", (name, url) => {
    const workspace = createWorkspace({ [`Sub/${name}`]: "# Heading\n" });
    const source = `[label](<Sub/${url}>)\n`;
    expect(lint(source, { path: "Sub/Doc.md", config, workspace })).toEqual([]);
    expect(format(source, { path: "Sub/Doc.md", config, workspace }).output).toBe(source);
  });
  it("safely encodes hashes and literal percent sequences when rewriting a path", () => {
    const workspace = createWorkspace({ "Sub/A#B%20.md": "# Heading\n" });
    const source = "[label](./A%23B%2520.md#Heading)\n";
    const result = format(source, { path: "Sub/Doc.md", config, workspace });
    expect(result.output).toBe("[label](<Sub/A%23B%2520.md#Heading>)\n");
    expect(result.diagnostics).toEqual([]);
  });
});
