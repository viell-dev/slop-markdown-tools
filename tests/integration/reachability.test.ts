import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditReachability } from "../../src/node.js";
import {
  copyOf,
  denyRead,
  fixture,
  run,
  tree,
  canRestrict,
  restrict,
  linkDirectory,
} from "../support/cli.js";
import { parseAudit } from "../support/json.js";

const config = { extends: [], rules: { "links/valid": "error" as const } };
const documents = {
  "README.md": "[Guide](guide.md)\n",
  "guide.md": "# Guide\n",
  "old.md": "[Appendix](appendix.md)\n",
  "appendix.md": "[Old](old.md)\n",
};

describe("reachability audit", () => {
  const braceDialects = [
    "commonmark",
    "github",
    "forgejo",
    "gitea",
    "obsidian",
    "vitepress",
  ] as const;
  it.each(
    braceDialects.flatMap((dialect) =>
      ["{{guide}}.md", "%7B%7Bguide%7D%7D.md"].map(
        (destination) => [dialect, destination] as const,
      ),
    ),
  )("audits literal brace destinations in %s: %s (#925)", async (dialect, destination) => {
    const options = { ...config, dialect };
    const root = await fixture({
      "mdrefine.config.json": JSON.stringify(options),
      "README.md": `[Guide](${destination})\n`,
      "{{guide}}.md": "# Guide\n",
      "orphan.md": "# Orphan\n",
    });
    const expected = {
      complete: true,
      reachable: ["README.md", "{{guide}}.md"],
      unreachable: ["orphan.md"],
      problems: [],
    };
    expect(
      await auditReachability({ root, entries: ["README.md"], config: options }),
    ).toMatchObject(expected);
    const result = run(root, [
      "audit",
      "reachability",
      "--root",
      root,
      "--entry",
      "README.md",
      "--json",
    ]);
    expect(result.status, result.stderr).toBe(1);
    expect(parseAudit(result.stdout)).toMatchObject(expected);
  });
  it.each(braceDialects)(
    "keeps brace external URLs outside %s graph coverage (#925)",
    async (dialect) => {
      const options = { ...config, dialect };
      const root = await fixture({
        "mdrefine.config.json": JSON.stringify(options),
        "README.md": "[External](https://example.com/{{slug}})\n",
        "orphan.md": "# Orphan\n",
      });
      const expected = {
        complete: true,
        reachable: ["README.md"],
        unreachable: ["orphan.md"],
        problems: [],
      };
      expect(
        await auditReachability({ root, entries: ["README.md"], config: options }),
      ).toMatchObject(expected);
      const result = run(root, [
        "audit",
        "reachability",
        "--root",
        root,
        "--entry",
        "README.md",
        "--json",
      ]);
      expect(result.status, result.stderr).toBe(1);
      expect(parseAudit(result.stdout)).toMatchObject(expected);
    },
  );
  it.each([
    ["vitepress", '<a :href="page">Guide</a>'],
    ["vitepress", '<a @click="go" href="guide.md">Go</a>'],
    ["vitepress", "<navigation />"],
    ["github", '> <a\n> href="guide.md">Go</a>'],
    ["github", 'See[^a].\n\n[^a]: See[^b].\n[^b]: <a href="guide.md">Go</a>'],
    ["obsidian", 'See^[note]. <a href="guide.md">Go</a>'],
    ["github", '<textarea><a href="guide.md">Go</a></textarea>'],
    ["github", '<style><a href="guide.md">Go</a></style>'],
    ["github", '<title><a href="guide.md">Go</a></title>'],
  ] as const)(
    "returns incomplete, never unreachable, for unmodeled %s HTML: %s",
    async (dialect, source) => {
      const root = await fixture({ "README.md": source, "guide.md": "# Guide\n" });
      const result = run(root, [
        "audit",
        "reachability",
        "--root",
        root,
        "--dialect",
        dialect,
        "--entry",
        "README.md",
        "--json",
      ]);
      expect(result.status, result.stderr).toBe(2);
      const report = parseAudit(result.stdout);
      expect(report.complete).toBe(false);
      expect(report.unreachable).toEqual([]);
      expect(report.problems.length).toBeGreaterThan(0);
      expect(report.problems.every((problem) => problem.code === "unsupported-navigation")).toBe(
        true,
      );
      const text = run(root, [
        "audit",
        "reachability",
        "--root",
        root,
        "--dialect",
        dialect,
        "--entry",
        "README.md",
      ]);
      expect(text.status, text.stderr).toBe(2);
      expect(text.stderr).not.toContain("undefined");
      expect(text.stdout).toContain("findings were withheld");
    },
  );
  it.each(["github", "vitepress"] as const)(
    "preserves ordinary Markdown and excluded HTML controls in %s",
    async (dialect) => {
      const root = await fixture({
        "README.md":
          '[Guide](guide.md)\n\n`<navigation />`\n\n<!-- <a href="guide.md"> -->\n\n<a href="https://example.invalid">Web</a>\n\n[^unused]: <a href="unread.md">Unused</a>\n',
        "guide.md": "# Guide\n",
      });
      const result = run(root, [
        "audit",
        "reachability",
        "--root",
        root,
        "--dialect",
        dialect,
        "--entry",
        "README.md",
        "--json",
      ]);
      expect(result.status, result.stderr).toBe(0);
      expect(parseAudit(result.stdout)).toMatchObject({
        complete: true,
        problems: [],
        unreachable: [],
      });
    },
  );
  it.each(['target="_blank"', "download"])(
    "withholds findings when VitePress bypasses page paths for %s",
    async (attribute) => {
      const root = await fixture({
        "README.md": `[Guide](guide){${attribute}}\n`,
        "guide.md": "# Guide\n",
        "orphan.md": "# Orphan\n",
      });
      const report = await auditReachability({
        root,
        entries: ["README.md"],
        config: { ...config, dialect: "vitepress" },
      });
      expect(report).toMatchObject({
        complete: false,
        unreachable: [],
        problems: [{ code: "unsupported-navigation" }],
      });
      expect(report.problems[0]!.message).toContain("bypass");
    },
  );
  it("reproduces the accepted gap, reports a disconnected cycle, and writes nothing", async () => {
    const root = await fixture({ ...documents, "mdrefine.config.json": JSON.stringify(config) });
    expect(run(root, ["lint", "--json"]).status).toBe(0);
    const before = await tree(root);
    const result = run(root, ["audit", "reachability", "--entry", "README.md", "--json"]);
    expect(result.status, result.stderr).toBe(1);
    const report = parseAudit(result.stdout);
    expect(report).toMatchObject({
      complete: true,
      reachable: ["README.md", "guide.md"],
      unreachable: ["appendix.md", "old.md"],
      problems: [],
    });
    expect(await tree(root)).toEqual(before);
    expect(await auditReachability({ root, entries: ["README.md"], config })).toEqual(
      Object.fromEntries(
        Object.entries(report).filter(([key]) => key !== "version" && key !== "mode"),
      ),
    );
    const multiple = run(root, [
      "audit",
      "reachability",
      "--entry",
      "old.md",
      "--entry",
      "README.md",
      "--entry",
      "README.md",
      "--json",
    ]);
    expect(multiple.status, multiple.stderr).toBe(0);
    expect(parseAudit(multiple.stdout)).toMatchObject({
      entries: ["README.md", "old.md"],
      unreachable: [],
    });
  });
  it("keeps excluded and config-ignored documents as transit, but not findings", async () => {
    const root = await fixture({
      "README.md": "[Bridge](generated/bridge.md)\n",
      "generated/bridge.md": "[Guide](../guide.md)\n",
      "guide.md": "# Guide\n",
      "private.md": "# Private\n",
    });
    const report = await auditReachability({
      root,
      entries: ["README.md"],
      exclude: ["private.md"],
      config: { ...config, ignore: ["generated/**"] },
    });
    expect(report).toMatchObject({
      complete: true,
      documents: ["README.md", "guide.md"],
      reachable: ["README.md", "guide.md"],
      scanned: ["README.md", "generated/bridge.md", "guide.md"],
      unreachable: [],
    });
  });
  it("keeps Git-ignored files out unless target resolution explicitly includes them", async () => {
    const root = await fixture({
      "README.md": "[Bridge](generated/bridge.md)\n",
      "generated/bridge.md": "[Guide](../guide.md)\n",
      "guide.md": "# Guide\n",
      ".gitignore": "generated/\n",
    });
    expect((await auditReachability({ root, entries: ["README.md"], config })).complete).toBe(
      false,
    );
    expect(
      await auditReachability({
        root,
        entries: ["README.md"],
        config: { ...config, resolve: { gitIgnored: true } },
      }),
    ).toMatchObject({ complete: true, documents: ["README.md", "guide.md"], unreachable: [] });
  });
  it.each(["missing.md", "../outside.md", "/site-route", "guide.md?query", "folder/"])(
    "withholds findings for unresolved navigation to %s",
    async (destination) => {
      const root = await fixture({
        "README.md": `[Go](${destination})\n`,
        "guide.md": "# Guide\n",
      });
      await mkdir(path.join(root, "folder"));
      const result = run(root, [
        "audit",
        "reachability",
        "--root",
        root,
        "--entry",
        "README.md",
        "--json",
      ]);
      expect(result.status, result.stderr).toBe(2);
      expect(parseAudit(result.stdout)).toMatchObject({
        complete: false,
        unreachable: [],
        problems: [{ code: "unresolved-link", destination }],
      });
    },
  );
  it("ignores bad fragments for document reachability, external URLs and attachments", async () => {
    const root = await fixture({
      "README.md":
        "[Guide](guide.md#missing)\n\n[Web](https://example.invalid/never-fetch)\n\n[Asset](image.png)\n\n![Not navigation](orphan.md)\n",
      "guide.md": "# Guide\n",
      "orphan.md": "# Orphan\n",
      "image.png": "synthetic",
    });
    expect(await auditReachability({ root, entries: ["README.md"], config })).toMatchObject({
      complete: true,
      reachable: ["README.md", "guide.md"],
      unreachable: ["orphan.md"],
    });
  });
  it("uses each document's configured dialect and wiki display labels/embeds", async () => {
    const root = await fixture({
      "README.md": "[Notes](notes/index.md)\n",
      "notes/.obsidian/app.json": "{}",
      "notes/index.md": "[[Topic|A label]]\n\n![[Embedded]]\n",
      "notes/Topic.md": "# Topic\n",
      "notes/Embedded.md": "# Embedded\n",
    });
    const report = await auditReachability({ root, entries: ["README.md"], config });
    expect(report.complete).toBe(true);
    expect(report.unreachable).toEqual([]);
  });
  it("does not guess YAML aliases or ambiguous wiki targets", async () => {
    const root = await fixture({
      "README.md": "[[Alternate]]\n\n[[Topic]]\n",
      ".obsidian/app.json": "{}",
      "first/Topic.md": "---\naliases: [Alternate]\n---\n# Topic\n",
      "second/Topic.md": "# Topic\n",
      "orphan.md": "# Orphan\n",
    });
    const report = await auditReachability({ root, entries: ["README.md"], config });
    expect(report).toMatchObject({ complete: false, unreachable: [] });
    expect(report.problems.map((problem) => problem.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("missing"),
        expect.stringContaining("ambiguous"),
      ]),
    );
  });
  it("uses VitePress source/page normalization without reading includes for fragments", async () => {
    const root = await fixture({
      "README.md": "[Guide](/guide.html#missing)\n",
      "guide.md": "# Guide\n",
      ".vitepress/config.mjs": "export default {};",
    });
    expect(
      await auditReachability({
        root,
        entries: ["README.md"],
        config: { ...config, dialect: "vitepress" },
      }),
    ).toMatchObject({ complete: true, unreachable: [] });
  });
  it.each([
    "../outside.md",
    "/absolute.md",
    "C:\\absolute.md",
    "missing.md",
    "folder",
    "orphan.md",
  ])("rejects invalid or excluded entry %s", async (entry) => {
    const root = await fixture({ "README.md": "# Home\n", "orphan.md": "# Orphan\n" });
    await mkdir(path.join(root, "folder"));
    await expect(
      auditReachability({ root, entries: [entry], exclude: ["orphan.md"], config }),
    ).rejects.toThrow(/Entry/);
  });
  it("requires explicit entries and rejects unsupported selection/write flags", async () => {
    const root = await fixture({ "README.md": "# Home\n" });
    await expect(auditReachability({ root, entries: [] })).rejects.toThrow(/at least one entry/);
    for (const flags of [
      [],
      ["--entry", "README.md", "."],
      ["--entry", "README.md", "--write"],
      ["--entry", "README.md", "--stdin-filepath", "README.md"],
    ])
      expect(run(root, ["audit", "reachability", ...flags]).status).toBe(2);
    expect(run(root, ["audit", "reachability", "--help"]).stdout).toContain(
      "Exit codes: 0 complete",
    );
  });
  it("does not execute configured code formatters", async () => {
    const root = await fixture({
      "README.md": "# Home\n\n```js\nconst x=1\n```\n",
      "mdrefine.config.json": JSON.stringify({
        ...config,
        codeFormatters: [
          {
            id: "probe",
            languages: ["js"],
            command: process.execPath,
            args: ["-e", "throw new Error('Code formatter must not run in an audit')"],
          },
        ],
      }),
    });
    const before = await tree(root);
    const result = run(root, ["audit", "reachability", "--entry", "README.md", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(parseAudit(result.stdout)).toMatchObject({ complete: true, unreachable: [] });
    expect(await tree(root)).toEqual(before);
  });
  it("returns an incomplete JSON report for late UTF-8 read failures", async () => {
    const root = await fixture({
      "README.md": "# Home\n",
      "bad.md": new Uint8Array([0xff]),
      "orphan.md": "# Orphan\n",
    });
    const result = run(root, ["audit", "reachability", "--entry", "README.md", "--json"]);
    expect(result.status, result.stderr).toBe(2);
    expect(parseAudit(result.stdout)).toMatchObject({
      complete: false,
      unreachable: [],
      problems: [{ path: "bad.md", code: "unreadable" }],
    });
  });
  it.skipIf(!canRestrict && process.platform !== "win32")(
    "withholds findings after a document or directory read denial",
    async () => {
      const root = await fixture({
        "README.md": "# Home\n",
        "bad.md": "# Restricted\n",
        "restricted/note.md": "# Restricted\n",
        "orphan.md": "# Orphan\n",
      });
      for (const name of ["bad.md", "restricted"])
        if (process.platform === "win32") denyRead(path.join(root, name));
        else await restrict(path.join(root, name));
      const report = await auditReachability({ root, entries: ["README.md"], config });
      expect(report).toMatchObject({ complete: false, unreachable: [] });
      expect(report.problems.map((problem) => problem.code)).toContain("unreadable");
      expect(report.problems.map((problem) => problem.code)).toContain("discovery");
    },
  );
  it("does not traverse a nested repository even when it is a configured link target", async () => {
    const root = await fixture({
      "README.md": "[Other](nested/page.md)\n",
      "nested/.git": "gitdir: synthetic\n",
      "nested/page.md": "# Other\n",
      "orphan.md": "# Orphan\n",
    });
    const report = await auditReachability({
      root,
      entries: ["README.md"],
      config: { ...config, resolve: { nestedRepositories: true } },
    });
    expect(report).toMatchObject({
      complete: false,
      unreachable: [],
      problems: [{ path: "nested/page.md", code: "boundary" }],
    });
    expect(report.scanned).not.toContain("nested/page.md");
  });
  it("does not traverse a link even if its target stays within the root", async () => {
    const root = await fixture({
      "README.md": "[Linked](shortcut/page.md)\n",
      "real/page.md": "# Other\n",
    });
    await linkDirectory(path.join(root, "real"), path.join(root, "shortcut"));
    const report = await auditReachability({ root, entries: ["README.md"], config });
    expect(report).toMatchObject({
      complete: false,
      unreachable: [],
      problems: [{ code: "boundary" }],
    });
  });
  it("has deterministic text and JSON, applies parent command options, and honors exclusions from a subdirectory", async () => {
    const root = await fixture({ ...documents, "mdrefine.config.json": JSON.stringify(config) });
    await mkdir(path.join(root, "sub"));
    const args = [
      "audit",
      "--root",
      root,
      "reachability",
      "--entry",
      "README.md",
      "--exclude",
      "../old.md",
      "--json",
    ];
    const first = run(path.join(root, "sub"), args);
    expect(first.status, first.stderr).toBe(1);
    expect(first.stdout).toBe(run(path.join(root, "sub"), args).stdout);
    expect(parseAudit(first.stdout).unreachable).toEqual(["appendix.md"]);
    const text = run(root, ["audit", "reachability", "--entry", "README.md"]);
    expect(text.stdout).toContain("appendix.md: Not reachable");
  });
  it("returns coverage limits for custom syntax and raw navigation", async () => {
    const root = await fixture({
      "README.md": '<a href="orphan.md">Orphan</a>\n',
      "orphan.md": "# Orphan\n",
    });
    expect(await auditReachability({ root, entries: ["README.md"], config })).toMatchObject({
      complete: false,
      unreachable: [],
      problems: [{ code: "unsupported-navigation" }],
    });
    await writeFile(path.join(root, "README.md"), "# Home\n");
    expect(
      await auditReachability({
        root,
        entries: ["README.md"],
        config,
        plugins: [{ name: "custom", syntax: { micromark: {}, mdast: {} } }],
      }),
    ).toMatchObject({ complete: false, unreachable: [] });
    expect(await readFile(path.join(root, "orphan.md"), "utf8")).toBe("# Orphan\n");
    expect(
      await auditReachability({
        root,
        entries: ["README.md"],
        config,
        plugins: [{ name: "rules-only", rules: {} }],
      }),
    ).toMatchObject({ complete: true, unreachable: ["orphan.md"] });
  });
  it("loads explicitly linked transit pages in a folder discovery does not enter", async () => {
    const root = await fixture({
      "README.md": "[Bridge](dist/bridge.md)\n",
      "dist/bridge.md": "[Guide](../guide.md)\n",
      "guide.md": "# Guide\n",
    });
    expect(await auditReachability({ root, entries: ["README.md"], config })).toMatchObject({
      complete: true,
      documents: ["README.md", "guide.md"],
      scanned: ["README.md", "dist/bridge.md", "guide.md"],
      unreachable: [],
    });
  });
  it("discovers a transit page's own vault before parsing or resolving its links", async () => {
    const root = await fixture({
      "README.md": "[Notes](dist/index.md)\n",
      "dist/.obsidian/app.json": "{}",
      "dist/index.md": "[[Other]]\n",
      "dist/Other.md": "# Other\n",
    });
    expect(await auditReachability({ root, entries: ["README.md"], config })).toMatchObject({
      complete: true,
      documents: ["README.md"],
      scanned: ["README.md", "dist/Other.md", "dist/index.md"],
      unreachable: [],
    });
  });
  it("runs the shipped audit example", async () => {
    const root = await copyOf("examples/reachability");
    expect(run(root, ["audit", "reachability", "--entry", "README.md", "--json"]).status).toBe(1);
    expect(
      run(root, ["audit", "reachability", "--entry", "README.md", "--entry", "archive/index.md"])
        .status,
    ).toBe(0);
  });
});
