import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { Nodes } from "mdast";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkspace,
  format,
  lint,
  parse,
  semanticFingerprint,
  textContent,
} from "../../src/index.js";
import type { Config, Dialect, Document, Plugin } from "../../src/index.js";
import {
  headingAttributeBlock,
  headingAttributes,
} from "../../src/workspace/heading-attributes.js";

// Count the attribute-block reads that only the Forgejo and Gitea anchors need.
vi.mock("../../src/workspace/heading-attributes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/workspace/heading-attributes.js")>();
  return { ...actual, headingAttributes: vi.fn(actual.headingAttributes) };
});
// Let a test follow every document that is parsed, to check that the workspace lets go of them.
const parses = vi.hoisted(() => ({
  watch: undefined as ((document: Document) => void) | undefined,
}));
vi.mock("../../src/syntax/parse.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/syntax/parse.js")>();
  const parse: typeof actual.parse = (...parameters) => {
    const document = actual.parse(...parameters);
    parses.watch?.(document);
    return document;
  };
  return { ...actual, parse };
});
/** Collect garbage now. Node.js offers that only behind a flag, which can be set while running. */
async function collectGarbage(): Promise<void> {
  // A WeakRef keeps its target alive until the task that created it has ended.
  await new Promise((resolve) => setImmediate(resolve));
  setFlagsFromString("--expose-gc");
  (runInNewContext("gc") as () => void)();
}

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
  it("does not load target contents until a fragment is checked, then caches its anchors", () => {
    const read = vi.fn(() => "# Heading\n\n## Heading\n\nA block. ^id\n");
    const unused = vi.fn(() => {
      throw new Error("must not read");
    });
    const index = createWorkspace(
      { "Target.md": read, "Unused.md": unused },
      { dialect: "obsidian" },
    );
    const exists = (fragment: string, dialect: Dialect) =>
      index.resolve("Doc.md", `Target.md#${fragment}`, dialect).fragmentExists;
    expect(index.resolve("Doc.md", "Target.md", "obsidian").status).toBe("resolved");
    expect(read).not.toHaveBeenCalled();
    expect(exists("Heading", "obsidian")).toBe(true);
    expect(exists("^id", "obsidian")).toBe(true);
    expect(exists("Missing", "obsidian")).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    // Only anchors are kept, so the first link of a dialect with other anchors
    // loads the target once more, for all the dialects that share them.
    expect(exists("heading-1", "github")).toBe(true);
    expect(exists("heading-1", "commonmark")).toBe(true);
    expect(exists("Heading", "obsidian")).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(exists("heading-1", "forgejo")).toBe(true);
    expect(exists("heading", "gitea")).toBe(true);
    expect(exists("heading", "github")).toBe(true);
    expect(exists("^id", "obsidian")).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(unused).not.toHaveBeenCalled();
  });
  it("keeps a target's anchors without its parsed document", async () => {
    const parsed: WeakRef<object>[] = [];
    const follow = (node: Nodes) => {
      parsed.push(new WeakRef(node));
      if ("children" in node) node.children.forEach(follow);
    };
    const index = createWorkspace({
      "Doc.md": "",
      "Target.md": '## Install {#setup}\n\n<a name="explicit"></a>\n\n<h2>Html</h2>\n\nText. ^id\n',
    });
    const exists = (fragment: string, dialect: Dialect) =>
      index.resolve("Doc.md", `Target.md#${fragment}`, dialect).fragmentExists;
    const check = () => {
      expect(exists("^id", "obsidian")).toBe(true);
      expect(exists("html", "github")).toBe(true);
      expect(exists("explicit", "commonmark")).toBe(true);
      expect(exists("setup", "forgejo")).toBe(true);
      expect(exists("html", "gitea")).toBe(true);
    };
    parses.watch = (document) => {
      parsed.push(new WeakRef(document));
      follow(document.tree);
    };
    try {
      check();
      expect(parsed.length).toBeGreaterThan(0);
      // The counting mock above records the document it was called with.
      vi.mocked(headingAttributes).mockClear();
      await collectGarbage();
      expect(parsed.filter((node) => node.deref() !== undefined)).toEqual([]);
      // The anchors answer later links without another parse.
      parsed.length = 0;
      check();
      expect(parsed).toEqual([]);
    } finally {
      parses.watch = undefined;
    }
  });
  it("does not keep a target's text alive through its anchors", async () => {
    // An engine may store a substring as a reference into the string it was cut
    // from, so a kept anchor could keep megabytes of text. Each target here is
    // large, its anchors are few and long enough to be stored that way, and
    // nothing but the index can hold its text: a loader builds it anew on every
    // call. One target of each kind is plain ASCII and one is not, because the
    // engine stores and lowercases the two differently.
    const marks = ["plain", "é-𝒳"];
    const workspace = (scale: number) => {
      const long = (words: string, times: number) => `${words} `.repeat(times * scale);
      const html = (mark: string) => `<p>${long(`filler ${mark} in an HTML block`, 80)}</p>`;
      const prose = (mark: string) => long(`prose ${mark} in one paragraph`, 40);
      const files: Record<string, () => string> = {};
      marks.forEach((mark, target) => {
        files[`Wide ${target}.md`] = () =>
          [
            `## A heading of target ${target} that is long {#custom-heading-id-${mark}}`,
            "",
            `<div id="Explicit-Anchor-${mark}">`,
            html(mark),
            `<a name="lowercase-anchor-${mark}"></a>`,
            "</div>",
            "",
            "```",
            long(`code ${mark} in a block that makes the file larger than its parts`, 20),
            "```",
            "",
          ].join("\n");
        files[`Block ${target}.md`] = () => `${prose(mark)} ^block-identifier-${target}\n`;
      });
      return { files, smallest: Math.min(html("plain").length, prose("plain").length) };
    };
    const anchors: [Dialect, string, (mark: string, target: number) => string][] = [
      ["obsidian", "Block", (_, target) => `^block-identifier-${target}`],
      [
        "obsidian",
        "Wide",
        (mark, target) =>
          `a heading of target ${target} that is long {%23custom-heading-id-${mark}}`,
      ],
      ["github", "Wide", (mark) => `explicit-anchor-${mark}`],
      ["commonmark", "Wide", (mark) => `EXPLICIT-ANCHOR-${mark.toUpperCase()}`],
      ["github", "Wide", (mark) => `lowercase-anchor-${mark}`],
      ["forgejo", "Wide", (mark) => `Explicit-Anchor-${mark}`],
      ["gitea", "Wide", (mark) => `lowercase-anchor-${mark}`],
      ["forgejo", "Wide", (mark) => `custom-heading-id-${mark}`],
      ["gitea", "Wide", (mark) => `custom-heading-id-${mark}`],
    ];
    const check = (files: Record<string, () => string>) => {
      const index = createWorkspace(files);
      for (const [dialect, file, anchor] of anchors)
        marks.forEach((mark, target) => {
          const link = `${file} ${target}.md#${anchor(mark, target)}`;
          expect(index.resolve("Doc.md", link, dialect).fragmentExists, link).toBe(true);
          expect(index.resolve("Doc.md", `${link}x`, dialect).fragmentExists, link).toBe(false);
        });
      vi.mocked(headingAttributes).mockClear();
      return index;
    };
    const settle = async () => {
      // The last string that a regular expression was run on stays referenced.
      /-/.test("-");
      await collectGarbage();
      return process.memoryUsage().heapUsed;
    };
    // The engine compiles code on the first runs, which also takes memory.
    check(workspace(1).files);
    check(workspace(1).files);
    const { files, smallest } = workspace(1000);
    expect(smallest).toBeGreaterThan(1_000_000);
    const documents: WeakRef<object>[] = [];
    const before = await settle();
    parses.watch = (document) => documents.push(new WeakRef(document), new WeakRef(document.tree));
    let index: ReturnType<typeof createWorkspace>;
    try {
      index = check(files);
    } finally {
      parses.watch = undefined;
    }
    const held = (await settle()) - before;
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.filter((document) => document.deref() !== undefined)).toEqual([]);
    // The anchors alone are a few kilobytes. Any one kind of them that kept its
    // text alive would hold at least the smallest of the large blocks.
    expect(held).toBeLessThan(smallest / 3);
    // The anchors are still there.
    expect(index.resolve("Doc.md", "Wide 0.md#missing", "github").fragmentExists).toBe(false);
  }, 60_000);
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

describe("directories that could not be read", () => {
  const files = {
    "Doc.md": "",
    "Home.md": "",
    "Notes/Known.md": "# Known\n",
    "Sub/Doc.md": "",
  };
  const unreadable = ["locked", "Sub/Private"];
  const workspace = createWorkspace(files, { unreadable });
  const vault = createWorkspace(files, { unreadable, dialect: "obsidian" });
  const valid = (dialect: Dialect, severity: "warn" | "error" = "error"): Config => ({
    extends: [],
    dialect,
    rules: { "links/valid": severity },
  });
  it.each(["commonmark", "github", "forgejo", "gitea"] as const)(
    "resolves a %s path into one as unreadable instead of missing",
    (dialect) => {
      for (const [source, url, directory] of [
        ["Doc.md", "locked/file.md", "locked"],
        ["Doc.md", "locked/deep/file.md#part", "locked"],
        ["Doc.md", "./locked/image.png", "locked"],
        ["Sub/Doc.md", "../locked/file.md", "locked"],
        ["Sub/Doc.md", "Private/file.md", "Sub/Private"],
      ] as const)
        expect(workspace.resolve(source, url, dialect), url).toEqual({
          status: "unreadable",
          unreadable: [directory],
        });
      // The directory itself is known to exist, and so are the directories above it.
      for (const url of ["locked", "locked/", "Sub/Private", "Sub"])
        expect(workspace.resolve("Doc.md", url, dialect).status, url).toBe("directory");
      // Everything outside it is still known to be missing or present.
      for (const url of ["gone.md", "Notes/gone.md", "lockedness/file.md", "Locked/file.md"])
        expect(workspace.resolve("Doc.md", url, dialect), url).toEqual({ status: "missing" });
      expect(workspace.resolve("Doc.md", "Notes/Known.md#known", dialect)).toEqual({
        status: "resolved",
        target: "Notes/Known.md",
        fragment: "known",
        fragmentExists: true,
      });
    },
  );
  it("accepts the directory names in any spelling of the same path", () => {
    const index = createWorkspace(files, { unreadable: ["./locked/", "Sub\\Private", "locked"] });
    expect(index.resolve("Doc.md", "locked/file.md", "github").unreadable).toEqual(["locked"]);
    expect(index.resolve("Doc.md", "Sub/Private/file.md", "github").unreadable).toEqual([
      "Sub/Private",
    ]);
  });
  it("resolves a file that is listed although its directory is called unreadable", () => {
    const index = createWorkspace({ "locked/Known.md": "" }, { unreadable: ["locked"] });
    expect(index.resolve("Doc.md", "locked/Known.md", "github").status).toBe("resolved");
    expect(index.resolve("Doc.md", "locked/Other.md", "github").status).toBe("unreadable");
  });
  it("matches the directory without regard to case in Obsidian", () => {
    for (const url of ["locked/Note", "LOCKED/Note.md", "/Locked/deep/Note", "sub/private/Note"])
      expect(vault.resolve("Doc.md", url, "obsidian").status, url).toBe("unreadable");
    expect(vault.resolve("Doc.md", "LOCKED/Note", "obsidian").unreadable).toEqual(["locked"]);
    expect(vault.resolve("Doc.md", "Locked", "obsidian").status).toBe("directory");
  });
  it("does not call a note missing that an Obsidian name search could not look for everywhere", () => {
    // A name alone is searched for in every directory, so every unreadable one may hold it.
    expect(vault.resolve("Doc.md", "Diary", "obsidian")).toEqual({
      status: "unreadable",
      unreadable: ["Sub/Private", "locked"],
    });
    expect(vault.resolve("Sub/Doc.md", "Folder/Diary.md#Heading", "obsidian").status).toBe(
      "unreadable",
    );
    // A path from the vault root or from the note names one place, which is readable.
    for (const url of ["/Diary", "./Diary", "../Diary", "/Notes/Diary"])
      expect(vault.resolve("Sub/Doc.md", url, "obsidian"), url).toEqual({ status: "missing" });
    const complete = createWorkspace(files, { dialect: "obsidian" });
    expect(complete.resolve("Doc.md", "Diary", "obsidian")).toEqual({ status: "missing" });
  });
  it("marks a note that only an Obsidian name search found, because it may not be the only one", () => {
    expect(vault.resolve("Doc.md", "Known", "obsidian")).toEqual({
      status: "resolved",
      target: "Notes/Known.md",
      fragment: "",
      fragmentExists: true,
      unreadable: ["Sub/Private", "locked"],
    });
    // An exact path from the vault root or from the note is not a search.
    for (const [source, url] of [
      ["Doc.md", "Notes/Known"],
      ["Doc.md", "Home"],
      ["Sub/Doc.md", "Doc"],
      ["Sub/Doc.md", "../Notes/Known.md"],
    ] as const)
      expect(vault.resolve(source, url, "obsidian"), url).not.toHaveProperty("unreadable");
    expect(
      lint("[[Known]] and [[Known#Known]]\n", { config: valid("obsidian"), workspace: vault }),
    ).toEqual([]);
  });
  it("does not rewrite a link whose target only a name search found", () => {
    const rewrite = (style: string, source: string, index = vault) => {
      const config: Config = {
        extends: [],
        dialect: "obsidian",
        rules: { "links/valid": "error", "links/path": ["warn", { style }] },
      };
      const result = format(source, { path: "Doc.md", config, workspace: index });
      expect(result.diagnostics).toEqual([]);
      return result.output;
    };
    const complete = createWorkspace(files, { dialect: "obsidian" });
    // Another `Known` in an unreadable directory would make the name ambiguous:
    // a full path must not replace it, and the name must not replace a full path.
    expect(rewrite("root", "[[Known|label]]\n")).toBe("[[Known|label]]\n");
    expect(rewrite("root", "[[Known|label]]\n", complete)).toBe("[[Notes/Known|label]]\n");
    expect(rewrite("relative", "[[Known|label]]\n")).toBe("[[Known|label]]\n");
    expect(rewrite("shortest", "[[Notes/Known|label]]\n")).toBe("[[Notes/Known|label]]\n");
    expect(rewrite("shortest", "[[Notes/Known|label]]\n", complete)).toBe("[[Known|label]]\n");
    // Exact paths are rewritten as usual.
    expect(rewrite("root", "[[notes/known|label]]\n")).toBe("[[Notes/Known|label]]\n");
    expect(rewrite("shortest", "[[/Home.md|label]]\n")).toBe("[[Home.md|label]]\n");
  });
  it("does not let a later place stand in for one that could not be looked in", () => {
    // Obsidian looks at the vault root first: `locked/Note.md` there would win, unseen.
    const index = createWorkspace(
      { "Sub/Doc.md": "", "Sub/locked/Note.md": "" },
      { unreadable: ["locked"], dialect: "obsidian" },
    );
    expect(index.resolve("Sub/Doc.md", "locked/Note", "obsidian")).toEqual({
      status: "resolved",
      target: "Sub/locked/Note.md",
      fragment: "",
      fragmentExists: true,
      unreadable: ["locked"],
    });
    // A path from the note itself names one place.
    expect(index.resolve("Sub/Doc.md", "./locked/Note", "obsidian")).not.toHaveProperty(
      "unreadable",
    );
    const rewrite = (style: string, source: string) => {
      const config: Config = {
        extends: [],
        dialect: "obsidian",
        rules: { "links/valid": "error", "links/path": ["warn", { style }] },
      };
      const result = format(source, { path: "Sub/Doc.md", config, workspace: index });
      expect(result.diagnostics).toEqual([]);
      return result.output;
    };
    for (const style of ["root", "relative", "shortest"])
      expect(rewrite(style, "[[locked/Note|label]]\n"), style).toBe("[[locked/Note|label]]\n");
    // A destination that the rule generates must not meet the same obstruction.
    expect(rewrite("relative", "[[../Sub/locked/Note|label]]\n")).toBe("[[./locked/Note|label]]\n");
    expect(rewrite("relative", "[[./locked/Note|label]]\n")).toBe("[[./locked/Note|label]]\n");
    expect(rewrite("root", "[[./locked/Note|label]]\n")).toBe("[[Sub/locked/Note|label]]\n");
  });
  it("does not convert the notation of a link whose target is uncertain", () => {
    const complete = createWorkspace(files, { dialect: "obsidian" });
    const convert = (style: string, source: string, index = vault) =>
      format(source, {
        path: "Doc.md",
        config: {
          extends: [],
          dialect: "obsidian",
          rules: { "links/notation": ["warn", { style }] },
        },
        workspace: index,
      }).output;
    expect(convert("markdown", "[[Known|label]]\n")).toBe("[[Known|label]]\n");
    expect(convert("wiki", "[label](Known)\n")).toBe("[label](Known)\n");
    expect(convert("markdown", "[[Known|label]]\n", complete)).toBe("[label](<Known>)\n");
    expect(convert("wiki", "[label](Known)\n", complete)).toBe("[[Known|label]]\n");
    // Exact paths are converted as usual.
    expect(convert("markdown", "[[Notes/Known|label]]\n")).toBe("[label](<Notes/Known>)\n");
    expect(convert("wiki", "[label](Notes/Known)\n")).toBe("[[Notes/Known|label]]\n");
  });
  it("refuses an edit by any rule that respells a link whose target is uncertain", () => {
    const plugin: Plugin = {
      name: "respell",
      rules: {
        full: {
          description: "Spell a link to Known with its folder.",
          kind: "style",
          check({ document }) {
            const start = document.source.indexOf("[[Known") + 2;
            return start < 2
              ? []
              : [
                  {
                    start,
                    message: "Respell",
                    edit: { start, end: start + "Known".length, text: "Notes/Known" },
                  },
                ];
          },
        },
      },
    };
    const run = (index: typeof vault) =>
      format("[[Known|label]]\n", {
        path: "Doc.md",
        config: { extends: [], dialect: "obsidian", rules: { "respell/full": "warn" } },
        plugins: [plugin],
        workspace: index,
      });
    // With every directory readable the two spellings are known to name one note.
    expect(run(createWorkspace(files, { dialect: "obsidian" })).output).toBe(
      "[[Notes/Known|label]]\n",
    );
    expect(run(vault)).toMatchObject({
      output: "[[Known|label]]\n",
      changed: false,
      diagnostics: [{ rule: "engine/unsafe-format" }],
    });
  });
  it("reports an unchecked link through links/valid at the rule's severity", () => {
    const source = "[in](locked/file.md), [dir](locked), [out](gone.md), and [ok](Home.md).\n";
    expect(lint(source, { path: "Doc.md", config: valid("github"), workspace })).toMatchObject([
      {
        rule: "links/valid",
        severity: "error",
        message:
          "Local target could not be checked: locked/file.md (no readable match; cannot read locked).",
        column: 1,
      },
      { rule: "links/valid", severity: "error", message: "Missing local target: gone.md." },
    ]);
    expect(
      lint("[in](locked/file.md)\n", {
        path: "Doc.md",
        config: valid("github", "warn"),
        workspace,
      }),
    ).toMatchObject([
      { severity: "warn", message: expect.stringContaining("could not be checked") },
    ]);
    expect(
      lint("[[Diary]] and ![[locked/image.png]]\n", {
        path: "Doc.md",
        config: valid("obsidian"),
        workspace: vault,
      }).map((item) => item.message),
    ).toEqual([
      "Local target could not be checked: Diary (no readable match; cannot read Sub/Private, locked).",
      "Local target could not be checked: locked/image.png (no readable match; cannot read locked).",
    ]);
    // A long list of directories is cut short.
    const many = createWorkspace(
      {},
      { unreadable: ["e", "d", "c", "b", "a"], dialect: "obsidian" },
    );
    expect(lint("[[Diary]]\n", { config: valid("obsidian"), workspace: many })[0]?.message).toBe(
      "Local target could not be checked: Diary (no readable match; cannot read a, b, c, and 2 more).",
    );
  });
  it("can be suppressed like any other finding", () => {
    const source = "<!-- mdtools-disable-next-line links/valid -->\n[in](locked/file.md)\n";
    expect(lint(source, { path: "Doc.md", config: valid("github"), workspace })).toEqual([]);
  });
  it.each([
    ["github", "[in](locked/file.md) and [frag](<locked/file.md#part>)\n"],
    ["obsidian", "[[locked/Note|label]] and [in](locked/Note.md) and [[Diary|label]]\n"],
  ] as const)("leaves unchecked %s links as written when formatting", (dialect, source) => {
    const config: Config = {
      extends: [],
      dialect,
      rules: {
        "links/path": ["warn", { style: "relative", brackets: "angle", leadingDot: true }],
        ...(dialect === "obsidian" ? { "links/notation": ["warn", { style: "markdown" }] } : {}),
      },
    };
    const index = dialect === "obsidian" ? vault : workspace;
    const result = format(source, { path: "Doc.md", config, workspace: index });
    expect(result).toEqual({ output: source, changed: false, diagnostics: [] });
  });
});

describe("an Obsidian vault below the workspace root", () => {
  // A repository with two vaults; `Shared` is a note in each, `Only` in the first alone.
  const files = {
    "README.md": "# Project\n",
    "Shared.md": "# Outside\n",
    "docs/guide.md": "",
    "docs/vault/Home.md": "",
    "docs/vault/Shared.md": "# First\n",
    "docs/vault/Only.md": "# Only\n",
    "docs/vault/Folder/Note.md": "",
    "docs/vault/Other/Target.md": "# Target\n\nA block. ^block\n",
    "docs/vault/inner/Deep.md": "",
    "docs/vault/inner/Shared.md": "# Inner\n",
    "notes/Shared.md": "# Second\n",
    "notes/Daily/Today.md": "",
    "notes/image.png": null,
  };
  const vaults = ["docs/vault", "notes", "docs/vault/inner"];
  const workspace = createWorkspace(files, { dialect: "obsidian", vaults });
  const note = "docs/vault/Folder/Note.md";
  const resolve = (url: string, source = note, dialect: Dialect = "obsidian") =>
    workspace.resolve(source, url, dialect);
  const found = (target: string, vault: string, fragment = "") => ({
    status: "resolved",
    target,
    fragment,
    fragmentExists: true,
    vault,
  });
  it("searches for a note by name in the linking note's vault only", () => {
    // Each vault finds its own `Shared`, although the name exists four times.
    expect(resolve("Shared")).toEqual(found("docs/vault/Shared.md", "docs/vault"));
    expect(resolve("Shared", "notes/Daily/Today.md")).toEqual(found("notes/Shared.md", "notes"));
    expect(resolve("Shared", "docs/vault/inner/Deep.md")).toEqual(
      found("docs/vault/inner/Shared.md", "docs/vault/inner"),
    );
    // A note of another vault, or of the repository around them, is not found.
    expect(resolve("Only")).toEqual(found("docs/vault/Only.md", "docs/vault"));
    expect(resolve("Only", "notes/Daily/Today.md")).toEqual({ status: "missing", vault: "notes" });
    expect(resolve("README")).toEqual({ status: "missing", vault: "docs/vault" });
    expect(resolve("guide")).toEqual({ status: "missing", vault: "docs/vault" });
    expect(resolve("Target#Target")).toEqual(
      found("docs/vault/Other/Target.md", "docs/vault", "Target"),
    );
    expect(resolve("Target#^block").status).toBe("resolved");
    expect(resolve("Target#Absent")).toMatchObject({ status: "resolved", fragmentExists: false });
  });
  it("counts a path from the vault's folder, not from the workspace root", () => {
    for (const url of ["Other/Target.md", "Other/Target", "/Other/Target.md", "other/target"])
      expect(resolve(url), url).toEqual(found("docs/vault/Other/Target.md", "docs/vault"));
    expect(resolve("../Other/Target.md")).toEqual(
      found("docs/vault/Other/Target.md", "docs/vault"),
    );
    expect(resolve("image.png", "notes/Daily/Today.md")).toEqual(found("notes/image.png", "notes"));
    // The path from the workspace root is not one that Obsidian knows, whole or in part.
    for (const url of ["docs/vault/Other/Target.md", "vault/Other/Target", "docs/vault/Only"])
      expect(resolve(url), url).toEqual({ status: "missing", vault: "docs/vault" });
    // Folders are told apart inside the vault as elsewhere.
    expect(resolve("Other")).toEqual({ status: "directory" });
  });
  it("names what a path reaches outside the vault instead of calling it missing", () => {
    for (const [url, outside] of [
      ["../../../README.md", "README.md"],
      ["../../../README", "README.md"],
      ["../../guide.md", "docs/guide.md"],
      ["../../../notes/Shared.md", "notes/Shared.md"],
      ["../../../notes/Daily", "notes/Daily"],
      ["../..", "docs"],
    ] as const)
      expect(resolve(url), url).toEqual({ status: "missing", vault: "docs/vault", outside });
    // Nothing is there, inside or outside: an ordinary missing target.
    expect(resolve("../../absent.md")).toEqual({ status: "missing", vault: "docs/vault" });
    // A path that leaves the workspace altogether is not looked at, as before.
    expect(resolve("../../../../elsewhere.md")).toEqual({ status: "missing", vault: "docs/vault" });
    const config: Config = { extends: [], dialect: "obsidian", rules: { "links/valid": "error" } };
    expect(
      lint("[the project](../../../README.md) and [[README]] and [[Shared]]\n", {
        path: note,
        config,
        workspace,
      }).map((item) => item.message),
    ).toEqual([
      "Local target is outside the vault: ../../../README.md (README.md is not in docs/vault, where Obsidian looks).",
      "Missing local target: README.",
    ]);
  });
  it("gives the notes of a vault around another vault the inner vault's notes too", () => {
    // Obsidian indexes every folder of a vault, also one that is a vault itself.
    expect(resolve("Deep")).toEqual(found("docs/vault/inner/Deep.md", "docs/vault"));
    expect(resolve("inner/Shared")).toEqual(found("docs/vault/inner/Shared.md", "docs/vault"));
    // The inner vault does not see out.
    expect(resolve("Only", "docs/vault/inner/Deep.md")).toEqual({
      status: "missing",
      vault: "docs/vault/inner",
    });
    expect(resolve("../Only.md", "docs/vault/inner/Deep.md")).toEqual({
      status: "missing",
      vault: "docs/vault/inner",
      outside: "docs/vault/Only.md",
    });
  });
  it("leaves notes outside these vaults, and other dialects, as they were", () => {
    // An Obsidian note outside the vaults reaches the whole workspace.
    expect(resolve("Only", "docs/guide.md")).toEqual({
      status: "resolved",
      target: "docs/vault/Only.md",
      fragment: "",
      fragmentExists: true,
    });
    // There, a name is first tried as a path from the workspace root.
    expect(resolve("Shared", "docs/guide.md")).toMatchObject({ target: "Shared.md" });
    expect(resolve("Deep", "docs/guide.md")).toMatchObject({ target: "docs/vault/inner/Deep.md" });
    // A document of another dialect in the vault's folder follows its own rules.
    for (const dialect of ["commonmark", "github", "forgejo", "gitea"] as const) {
      expect(resolve("../../../README.md", note, dialect), dialect).toEqual({
        status: "resolved",
        target: "README.md",
        fragment: "",
        fragmentExists: true,
      });
      expect(resolve("Other/Target.md", note, dialect), dialect).toEqual({ status: "missing" });
    }
    // Without the option nothing changes: the note reaches files outside its vault.
    const plain = createWorkspace(files, { dialect: "obsidian" });
    expect(plain.resolve(note, "README", "obsidian")).toMatchObject({ target: "README.md" });
    expect(plain.resolve(note, "Shared", "obsidian")).toMatchObject({ target: "Shared.md" });
  });
  it("accepts the folders in any spelling of the same path, and ignores the root", () => {
    const spelled = createWorkspace(files, {
      dialect: "obsidian",
      vaults: ["docs\\vault\\", "./notes/", ".", ""],
    });
    expect(spelled.resolve(note, "Shared", "obsidian")).toEqual(
      found("docs/vault/Shared.md", "docs/vault"),
    );
    expect(spelled.resolve("notes/Daily/Today.md", "Shared", "obsidian")).toEqual(
      found("notes/Shared.md", "notes"),
    );
    expect(spelled.resolve("docs/guide.md", "Only", "obsidian")).toEqual({
      status: "resolved",
      target: "docs/vault/Only.md",
      fragment: "",
      fragmentExists: true,
    });
  });
  it("lets only an unreadable directory of the same vault make a search uncertain", () => {
    const elsewhere = createWorkspace(files, {
      dialect: "obsidian",
      vaults,
      unreadable: ["notes/Private", "locked"],
    });
    // Nothing in this vault is hidden, so the answers are certain.
    expect(elsewhere.resolve(note, "Only", "obsidian")).toEqual(
      found("docs/vault/Only.md", "docs/vault"),
    );
    expect(elsewhere.resolve(note, "Absent", "obsidian")).toEqual({
      status: "missing",
      vault: "docs/vault",
    });
    // In the vault with the unreadable directory, what a search by name finds is not.
    expect(elsewhere.resolve("notes/Shared.md", "Today", "obsidian")).toEqual({
      ...found("notes/Daily/Today.md", "notes"),
      unreadable: ["notes/Private"],
    });
    // A note at the path that Obsidian tries first is certain there too.
    expect(elsewhere.resolve("notes/Daily/Today.md", "Shared", "obsidian")).toEqual(
      found("notes/Shared.md", "notes"),
    );
    expect(elsewhere.resolve("notes/Daily/Today.md", "Absent", "obsidian")).toEqual({
      status: "unreadable",
      unreadable: ["notes/Private"],
      vault: "notes",
    });
  });
  it("writes paths from the vault's folder, and the same ones as with the vault as the root", () => {
    const source =
      "[a](../Other/Target.md) [b](Other/Target.md#Target) [[Target|c]] [[Other/Target|d]] [e](../../../README.md)\n";
    // The same vault as a workspace of its own.
    const alone = createWorkspace(
      Object.fromEntries(
        Object.entries(files).flatMap(([name, value]) =>
          name.startsWith("docs/vault/") ? [[name.slice("docs/vault/".length), value]] : [],
        ),
      ),
      { dialect: "obsidian" },
    );
    for (const [style, expected] of [
      [
        "root",
        "[a](Other/Target.md) [b](Other/Target.md#Target) [[Other/Target|c]] [[Other/Target|d]] [e](../../../README.md)\n",
      ],
      [
        "shortest",
        "[a](Target.md) [b](Target.md#Target) [[Target|c]] [[Target|d]] [e](../../../README.md)\n",
      ],
      [
        "relative",
        "[a](../Other/Target.md) [b](../Other/Target.md#Target) [[../Other/Target|c]] [[../Other/Target|d]] [e](../../../README.md)\n",
      ],
    ] as const) {
      const config: Config = {
        extends: [],
        dialect: "obsidian",
        rules: { "links/path": ["warn", { style }] },
      };
      const below = format(source, { path: note, config, workspace });
      expect(below.output, style).toBe(expected);
      expect(format(below.output, { path: note, config, workspace }).changed, style).toBe(false);
      expect(
        format(source, { path: "Folder/Note.md", config, workspace: alone }).output,
        style,
      ).toBe(expected);
    }
  });
});
describe("a workspace root that is a folder of an Obsidian vault", () => {
  // The vault holds `Area/Folder`, which is the workspace root; the rest is out of sight.
  const files = {
    "Index.md": "# Index\n",
    "Home.md": "",
    "Sub/Note.md": "# Deep\n",
    "Sub/Other.md": "",
    "inner/Own.md": "",
    "inner/Sub/Note.md": "",
  };
  const workspace = createWorkspace(files, {
    dialect: "obsidian",
    rootInVault: "Area/Folder",
    vaults: ["inner"],
  });
  const resolve = (url: string, source = "Index.md", dialect: Dialect = "obsidian") =>
    workspace.resolve(source, url, dialect);
  /** A target found where nothing outside the workspace could take its place. */
  const certain = (target: string, fragment = "") => ({
    status: "resolved",
    target,
    fragment,
    fragmentExists: true,
    rooted: `Area/Folder/${target}`,
  });
  /** A target found, while the rest of the vault may hold another or a better match. */
  const uncertain = (target: string) => ({ ...certain(target), unreadable: ["../.."] });
  const unchecked = { status: "unreadable", unreadable: ["../.."] };
  it("is certain of an explicit relative path and of a vault path through the root", () => {
    for (const url of ["./Sub/Note.md", "./Sub/Note", "./sub/note.md"])
      expect(resolve(url), url).toEqual(certain("Sub/Note.md"));
    expect(resolve("../Home.md", "Sub/Note.md")).toEqual(certain("Home.md"));
    // Obsidian counts these from the vault's folder, two levels above the root.
    for (const url of ["Area/Folder/Sub/Note.md", "/Area/Folder/Sub/Note", "area/folder/sub/note"])
      expect(resolve(url), url).toEqual(certain("Sub/Note.md"));
    expect(resolve("#Index")).toEqual(certain("Index.md", "Index"));
    expect(resolve("./Sub/Note.md#Deep")).toEqual(certain("Sub/Note.md", "Deep"));
    // What an explicit path names inside the workspace is known to be missing.
    expect(resolve("./Sub/Gone.md")).toEqual({ status: "missing" });
    expect(resolve("../Gone.md", "Sub/Note.md")).toEqual({ status: "missing" });
  });
  it("marks a match that the rest of the vault could outdo", () => {
    // A path without `./` is first counted from the vault's folder, which is out of sight.
    expect(resolve("Sub/Note.md")).toEqual(uncertain("Sub/Note.md"));
    expect(resolve("Home")).toEqual(uncertain("Home.md"));
    // A search by name may find a second note elsewhere in the vault.
    expect(resolve("Other")).toEqual(uncertain("Sub/Other.md"));
    // A searched path can start in the folders above the root.
    expect(resolve("Folder/Sub/Other")).toEqual(uncertain("Sub/Other.md"));
    expect(resolve("folder/home.md")).toEqual(uncertain("Home.md"));
    // Two matches inside the workspace are ambiguous whatever lies outside.
    expect(resolve("Note", "Home.md")).toEqual({ status: "ambiguous" });
  });
  it("does not call a note missing that may be elsewhere in the vault", () => {
    for (const url of [
      "Elsewhere",
      "Elsewhere.md",
      "Topics/Elsewhere.md",
      "/Top.md",
      "../Sibling.md",
      "../../Top.md",
      "Area/Other/Note.md",
      "Folder/Note",
      "Area/Folder/Gone.md",
    ])
      expect(resolve(url), url).toEqual(unchecked);
    // Further up than the vault's folder there is no vault.
    expect(resolve("../../../Outside.md")).toEqual({ status: "missing" });
    const config: Config = { extends: [], dialect: "obsidian", rules: { "links/valid": "warn" } };
    expect(
      lint("[[Elsewhere]] [up](../Sibling.md) [gone](./Sub/Gone.md) [[Other]]\n", {
        path: "Index.md",
        config,
        workspace,
      }).map((item) => `${item.severity}: ${item.message}`),
    ).toEqual([
      "warn: Local target could not be checked: Elsewhere (no readable match; the workspace root is only a part of the vault).",
      "warn: Local target could not be checked: ../Sibling.md (no readable match; the workspace root is only a part of the vault).",
      "warn: Missing local target: ./Sub/Gone.md.",
    ]);
    // Together with a directory that could not be read, both reasons are given.
    const locked = createWorkspace(files, {
      dialect: "obsidian",
      rootInVault: "Area/Folder",
      unreadable: ["Private"],
    });
    expect(
      lint("[[Elsewhere]]\n", { path: "Index.md", config, workspace: locked }).map(
        (item) => item.message,
      ),
    ).toEqual([
      "Local target could not be checked: Elsewhere (no readable match; cannot read Private; the workspace root is only a part of the vault).",
    ]);
  });
  it("rewrites only the links it is certain of, with root paths from the vault's folder", () => {
    const source =
      "[a](Sub/Note.md) [[Sub/Note|b]] [[Other|c]] [d](./Sub/Note.md) [e](Area/Folder/Sub/Note.md) [[Elsewhere|f]]\n";
    for (const [style, expected] of [
      // The first three could name another note seen from the whole vault.
      [
        "shortest",
        "[a](Sub/Note.md) [[Sub/Note|b]] [[Other|c]] [d](Area/Folder/Sub/Note.md) [e](Area/Folder/Sub/Note.md) [[Elsewhere|f]]\n",
      ],
      [
        "root",
        "[a](Sub/Note.md) [[Sub/Note|b]] [[Other|c]] [d](Area/Folder/Sub/Note.md) [e](Area/Folder/Sub/Note.md) [[Elsewhere|f]]\n",
      ],
      [
        "relative",
        "[a](Sub/Note.md) [[Sub/Note|b]] [[Other|c]] [d](./Sub/Note.md) [e](./Sub/Note.md) [[Elsewhere|f]]\n",
      ],
    ] as const) {
      const config: Config = {
        extends: [],
        dialect: "obsidian",
        rules: { "links/path": ["warn", { style }] },
      };
      const result = format(source, { path: "Index.md", config, workspace });
      expect(result.output, style).toBe(expected);
      expect(result.diagnostics, style).toEqual([]);
      expect(format(result.output, { path: "Index.md", config, workspace }).changed, style).toBe(
        false,
      );
    }
    // Notation is converted for certain links only, as with an unreadable directory.
    const notation: Config = {
      extends: [],
      dialect: "obsidian",
      rules: { "links/notation": ["warn", { style: "wiki" }] },
    };
    expect(
      format("[a](Sub/Note.md) [b](./Sub/Note.md)\n", {
        path: "Index.md",
        config: notation,
        workspace,
      }).output,
    ).toBe("[a](Sub/Note.md) [[./Sub/Note.md|b]]\n");
  });
  it("sees the whole of a vault that lies below the root, and leaves other dialects alone", () => {
    // The inner vault is complete, so its answers are certain and counted from its folder.
    expect(resolve("Note", "inner/Own.md")).toEqual({
      status: "resolved",
      target: "inner/Sub/Note.md",
      fragment: "",
      fragmentExists: true,
      vault: "inner",
      rooted: "Sub/Note.md",
    });
    expect(resolve("Elsewhere", "inner/Own.md")).toEqual({ status: "missing", vault: "inner" });
    for (const dialect of ["commonmark", "github", "forgejo", "gitea"] as const) {
      expect(resolve("Sub/Note.md", "Index.md", dialect), dialect).toEqual({
        status: "resolved",
        target: "Sub/Note.md",
        fragment: "",
        fragmentExists: true,
      });
      expect(resolve("Elsewhere.md", "Index.md", dialect), dialect).toEqual({ status: "missing" });
    }
    // Without the option the root is taken for the vault's folder, as before.
    const whole = createWorkspace(files, { dialect: "obsidian" });
    expect(whole.resolve("Index.md", "Sub/Note.md", "obsidian")).toEqual({
      status: "resolved",
      target: "Sub/Note.md",
      fragment: "",
      fragmentExists: true,
    });
    expect(whole.resolve("Index.md", "Elsewhere", "obsidian")).toEqual({ status: "missing" });
    for (const rootInVault of ["", ".", "./"])
      expect(
        createWorkspace(files, { dialect: "obsidian", rootInVault }).resolve(
          "Index.md",
          "Elsewhere",
          "obsidian",
        ),
        rootInVault,
      ).toEqual({ status: "missing" });
    // Backslashes and a trailing slash spell the same path.
    expect(
      createWorkspace(files, { dialect: "obsidian", rootInVault: "Area\\Folder\\" }).resolve(
        "Index.md",
        "./Sub/Note.md",
        "obsidian",
      ),
    ).toEqual(certain("Sub/Note.md"));
  });
});
describe("files that could not be read", () => {
  const refuse = (code: string) =>
    vi.fn((): string => {
      throw Object.assign(new Error(`${code}: refused, open 'Secret.md'`), { code });
    });
  const valid = (dialect: Dialect, severity: "warn" | "error" = "error"): Config => ({
    extends: [],
    dialect,
    rules: { "links/valid": severity },
  });
  it.each(["EACCES", "EPERM"])(
    "resolves a fragment in a file whose loader fails with %s as unreadable",
    (code) => {
      const load = refuse(code);
      const index = createWorkspace({ "Doc.md": "", "Secret.md": load, "Open.md": "# Open\n" });
      // The file is known to exist; only a fragment needs what it contains.
      expect(index.resolve("Doc.md", "Secret.md", "github")).toMatchObject({
        status: "resolved",
        target: "Secret.md",
        fragmentExists: true,
      });
      expect(load).not.toHaveBeenCalled();
      for (const dialect of ["commonmark", "github", "forgejo", "gitea", "obsidian"] as const)
        expect(index.resolve("Doc.md", "Secret.md#section", dialect), dialect).toEqual({
          status: "unreadable",
          target: "Secret.md",
          fragment: "section",
          unreadable: ["Secret.md"],
        });
      // The refusal is remembered like a parsed target, and other files are unaffected.
      expect(load).toHaveBeenCalledTimes(1);
      expect(index.resolve("Doc.md", "Open.md#open", "github").fragmentExists).toBe(true);
    },
  );
  it("lets any other loader error through", () => {
    for (const error of [
      Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }),
      Object.assign(new Error("EIO: i/o error"), { code: "EIO" }),
      new Error("no code"),
    ]) {
      const index = createWorkspace({
        "Secret.md": () => {
          throw error;
        },
      });
      expect(() => index.resolve("Doc.md", "Secret.md#section", "github")).toThrow(error);
      expect(() =>
        lint("[a](Secret.md#section)\n", { config: valid("github"), workspace: index }),
      ).toThrow(error);
    }
  });
  it("keeps the anchors it has when a later read of the same file is refused", () => {
    let refused = false;
    const load = vi.fn((): string => {
      if (refused) throw Object.assign(new Error("EACCES: refused"), { code: "EACCES" });
      return "# Section\n";
    });
    const index = createWorkspace({ "Doc.md": "", "Secret.md": load });
    const check = (dialect: Dialect) => index.resolve("Doc.md", "Secret.md#section", dialect);
    expect(check("github").fragmentExists).toBe(true);
    refused = true;
    // Dialects with other anchors need the file again; it is asked for once more.
    for (const dialect of ["forgejo", "gitea", "obsidian"] as const)
      expect(check(dialect), dialect).toEqual({
        status: "unreadable",
        target: "Secret.md",
        fragment: "section",
        unreadable: ["Secret.md"],
      });
    expect(check("commonmark")).toMatchObject({ status: "resolved", fragmentExists: true });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("reports the fragment through links/valid at the rule's severity, naming the file", () => {
    const index = createWorkspace({ "Notes/Secret.md": refuse("EACCES"), "Doc.md": "" });
    const source = "[plain](Notes/Secret.md) and [section](Notes/Secret.md#section)\n";
    expect(lint(source, { path: "Doc.md", config: valid("github"), workspace: index })).toEqual([
      {
        rule: "links/valid",
        severity: "error",
        message:
          "Fragment could not be checked: Notes/Secret.md#section (cannot read Notes/Secret.md).",
        start: source.indexOf("[section]"),
        line: 1,
        column: source.indexOf("[section]") + 1,
      },
    ]);
    expect(
      lint("[[Secret#Section]]\n", {
        path: "Doc.md",
        config: valid("obsidian", "warn"),
        workspace: index,
      }),
    ).toMatchObject([
      {
        severity: "warn",
        message: "Fragment could not be checked: Secret#Section (cannot read Notes/Secret.md).",
      },
    ]);
  });
  it("formats the linking document without rewriting the link or failing", () => {
    const index = createWorkspace({ "Notes/Secret.md": refuse("EACCES"), "Doc.md": "" });
    const config: Config = {
      extends: [],
      dialect: "github",
      rules: {
        "style/emphasis": "warn",
        "links/valid": "error",
        "links/path": ["warn", { style: "relative", leadingDot: true }],
      },
    };
    const result = format("A *link* to [a section](Notes/Secret.md#section).\n", {
      path: "Doc.md",
      config,
      workspace: index,
    });
    // Without the fix the refusal surfaced as an `engine/unsafe-format` error.
    expect(result.output).toBe("A _link_ to [a section](Notes/Secret.md#section).\n");
    expect(result.diagnostics.map((item) => item.rule)).toEqual(["links/valid"]);
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
      // GFM parsing, as in the workspaces here, which name no dialect and so parse as GitHub.
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
    // The bound tells linear from quadratic growth, which would take minutes here. It leaves
    // room for a slow CI runner and for GFM parsing, which the workspace now uses when no
    // dialect is named and which takes about half as long again as CommonMark on this input.
    expect(performance.now() - start).toBeLessThan(10000);
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
