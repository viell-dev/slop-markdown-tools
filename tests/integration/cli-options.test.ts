import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canRestrict, denyRead, fixture, linkDirectory, restrict, run } from "../support/cli.js";
import { parseExplanation, parseReport, parseRules } from "../support/json.js";
describe("the command line", () => {
  it("ends a usage error with code 2, and help and the version with 0", async () => {
    const root = await fixture({ "note.md": "A note.\n" });
    // Up to 0.2.0-rc.2 these ended with code 1, the code for findings.
    for (const [args, message] of [
      [["lint", "--bogus"], "mdrefine: unknown option '--bogus'\n"],
      [["lnt"], "mdrefine: unknown command 'lnt'\n(Did you mean lint?)\n"],
      [["lint", "--config"], "mdrefine: option '--config <file>' argument missing\n"],
      [["config", "explain"], "mdrefine: missing required argument 'file'\n"],
      [
        ["rules", "extra"],
        "mdrefine: too many arguments for 'rules'. Expected 0 arguments but got 1: extra.\n",
      ],
      [
        ["format", "--dialect", "gitlab"],
        "mdrefine: option '--dialect <dialect>' argument 'gitlab' is invalid. The dialects are commonmark, github, forgejo (alias: codeberg), gitea, obsidian, vitepress.\n",
      ],
      [
        ["format", "--check", "--write"],
        "mdrefine: --write cannot be combined with --check or --diff.\n",
      ],
    ] as const) {
      const result = run(root, [...args]);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stdout, args.join(" ")).toBe("");
      expect(result.stderr, args.join(" ")).toBe(message);
    }
    // Without a command, or with one that only groups others, the help goes to stderr, followed
    // by a line that says what is missing.
    for (const [args, missing] of [
      [[], "mdrefine: no command given; try mdrefine lint\n"],
      [["config"], "mdrefine: config needs a command: explain or convert\n"],
      [["help", "bogus"], undefined],
    ] as const) {
      const result = run(root, [...args]);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stdout, args.join(" ")).toBe("");
      expect(result.stderr, args.join(" ")).toMatch(/^Usage: mdrefine /);
      if (missing) expect(result.stderr.endsWith(`\n${missing}`), args.join(" ")).toBe(true);
      else expect(result.stderr, args.join(" ")).not.toMatch(/no command given|needs a command/);
    }
    for (const args of [["--help"], ["help"], ["help", "lint"], ["lint", "--help"], ["-V"]]) {
      const result = run(root, args);
      expect(result.status, args.join(" ")).toBe(0);
      expect(result.stderr, args.join(" ")).toBe("");
      expect(result.stdout, args.join(" ")).not.toBe("");
    }
  });
  it("answers --fix with the option that writes fixes, and writes nothing", async () => {
    const root = await fixture({ "note.md": "A *note*.\n" });
    const linted = run(root, ["lint", "--fix"]);
    expect(linted.status).toBe(2);
    expect(linted.stderr).toBe(
      "mdrefine: unknown option '--fix': lint never changes files; 'mdrefine format --write' applies the fixes.\n",
    );
    const formatted = run(root, ["format", "--fix"]);
    expect(formatted.status).toBe(2);
    expect(formatted.stderr).toBe(
      "mdrefine: unknown option '--fix': format writes its changes with --write.\n",
    );
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A *note*.\n");
    // It is no option, so the help does not list it.
    expect(run(root, ["lint", "--help"]).stdout).not.toContain("--fix");
  });
  it("describes every command and lists only the options that each one reads", async () => {
    const root = await fixture({});
    const help = (...args: string[]) => run(root, [...args, "--help"]).stdout;
    const commands = help().split("Commands:\n")[1]!;
    for (const name of ["lint", "format", "config", "rules", "help"])
      expect(commands, name).toMatch(new RegExp(`^  ${name} .*\\S  +[A-Z]`, "m"));
    for (const name of ["explain", "convert"])
      expect(help("config").split("Commands:\n")[1], name).toMatch(
        new RegExp(`^ {2}${name} .*\\S {2,}[A-Z]`, "m"),
      );
    const options = (text: string) =>
      [...text.matchAll(/^ {2}(?:-\w, )?(--[a-z-]+)/gm)].map((match) => match[1]);
    const workspace = ["--config", "--no-competitor-config", "--root", "--dialect", "--help"];
    expect(options(help("config"))).toEqual(workspace);
    expect(options(help("config", "explain"))).toEqual(workspace);
    expect(options(help("config", "convert"))).toEqual(["--root", "--write", "--help"]);
    expect(options(help("rules"))).toEqual([
      "--config",
      "--no-competitor-config",
      "--root",
      "--json",
      "--help",
    ]);
    expect(options(help("lint"))).toEqual([
      "--config",
      "--no-competitor-config",
      "--root",
      "--dialect",
      "--exclude",
      "--json",
      "--quiet",
      "--no-warn-ignored",
      "--stdin-filepath",
      "--max-warnings",
      "--help",
    ]);
    // An empty default says nothing, and the root is described as it is found.
    expect(help("lint")).not.toContain("(default: [])");
    expect(help("lint").replace(/\s+/g, " ")).toContain(
      "Workspace root (default: the configuration file's directory; without one, the Git repository or vault where the search stopped, else the current directory)",
    );
  });
  it("names files from the current directory in text, and from the root in JSON", async () => {
    const root = await fixture({
      "docs/guide.md": "A *guide*.\n",
      "docs/deep/page.md": "A [page](absent.md).\n",
      "top.md": "A *top* note.\n",
    });
    const docs = path.join(root, "docs");
    const linted = run(docs, ["lint"]);
    expect(linted.stderr).toBe(
      "deep/page.md:1:3: error links/valid: Missing local target: absent.md.\n" +
        'guide.md:1:3: warn style/emphasis: Use "_" for emphasis.\n' +
        'guide.md:1:9: warn style/emphasis: Use "_" for emphasis.\n' +
        '../top.md:1:3: warn style/emphasis: Use "_" for emphasis.\n' +
        '../top.md:1:7: warn style/emphasis: Use "_" for emphasis.\n' +
        "3 file(s) linted; 1 error(s), 4 warning(s).\n",
    );
    // The diff too, so that `patch -p1` applies it from here.
    const previewed = run(docs, ["format", "guide.md"]);
    expect(previewed.stdout).toContain("--- a/guide.md\n+++ b/guide.md\n");
    // The root need not be where the command runs.
    expect(run(root, ["lint", "--root", "docs", "docs/deep"]).stderr).toContain(
      "docs/deep/page.md:1:3: error links/valid",
    );
    // Text from stdin is named by the path given for it.
    const piped = run(docs, ["lint", "-", "--stdin-filepath", "deep/new.md"], "[x](absent.md)\n");
    expect(piped.stderr).toBe(
      "deep/new.md:1:1: error links/valid: Missing local target: absent.md.\n",
    );
    // The JSON report names files from the root, which it gives as an absolute path.
    const report = parseReport(run(docs, ["lint", "--json", "deep"]).stdout);
    expect(report.files.map((file: { path: string }) => file.path)).toEqual(["docs/deep/page.md"]);
    expect(await realpath(report.root)).toBe(await realpath(root));
  });
  it("names the paths in warnings about the run from the current directory too", async () => {
    const root = await fixture({
      ".gitignore": "docs/drafts/\n",
      "docs/drafts/a.md": "A draft.\n",
      "docs/guide.md": "A guide.\n",
      "docs/vault/.obsidian/app.json": "",
      "docs/vault/Note.md": "A note.\n",
      "docs/vendor/.git/HEAD": "",
      "docs/vendor/inner.md": "Inner.\n",
    });
    const inputs = ["guide.md", "drafts/a.md", "vendor/inner.md"];
    const settings = (file: string) =>
      `Skipped unusable settings file: ${file} (not valid JSON). Obsidian's strictLineBreaks setting is not verified for that vault, so its documents are not reflowed.`;
    const ignored = (file: string, reason: string) =>
      `Skipped ignored input: ${file} (${reason}). It is not processed.`;
    const linted = run(path.join(root, "docs"), ["lint", ...inputs]);
    expect(linted.status, linted.stderr).toBe(0);
    expect(linted.stderr).toBe(
      `mdrefine: warning: ${ignored("drafts/a.md", 'in drafts, which "docs/drafts/" in ../.gitignore matches')}\n` +
        `mdrefine: warning: ${settings("vault/.obsidian/app.json")}\n` +
        `mdrefine: warning: ${ignored("vendor/inner.md", "in vendor, a nested repository")}\n` +
        "1 file(s) linted; 0 error(s), 0 warning(s).\n",
    );
    // The JSON report, like the library, names them from the root.
    const report = parseReport(run(path.join(root, "docs"), ["lint", "--json", ...inputs]).stdout);
    expect(report.skipped).toEqual([
      {
        path: "docs/drafts/a.md",
        type: "file",
        code: "IGNORED",
        message: ignored(
          "docs/drafts/a.md",
          'in docs/drafts, which "docs/drafts/" in .gitignore matches',
        ),
      },
      {
        path: "docs/vault/.obsidian/app.json",
        type: "file",
        code: "INVALID",
        message: settings("docs/vault/.obsidian/app.json"),
      },
      {
        path: "docs/vendor/inner.md",
        type: "file",
        code: "IGNORED",
        message: ignored("docs/vendor/inner.md", "in docs/vendor, a nested repository"),
      },
    ]);
  });
  it.skipIf(process.platform !== "win32" && !canRestrict)(
    "names an unreadable directory, and the file that could not be read, from here",
    async () => {
      const root = await fixture({
        "docs/guide.md": "A guide.\n",
        "docs/closed/a.md": "A.\n",
        "docs/open/.gitignore": "b.md\n",
        "docs/open/c.md": "C.\n",
      });
      for (const file of ["docs/closed", "docs/open/.gitignore"])
        if (process.platform === "win32") denyRead(path.join(root, file));
        else await restrict(path.join(root, file));
      const refused =
        process.platform === "win32"
          ? "EPERM: operation not permitted"
          : "EACCES: permission denied";
      const unreadable = (directory: string, detail = "") =>
        `mdrefine: warning: Skipped unreadable directory: ${directory} (${refused}${detail}). Its files are not processed, and links into it cannot be checked.\n`;
      const linted = run(path.join(root, "docs"), ["lint"]);
      expect(linted.status, linted.stderr).toBe(0);
      expect(linted.stderr).toBe(
        unreadable("closed") +
          unreadable("open", " for open/.gitignore") +
          "1 file(s) linted; 0 error(s), 0 warning(s).\n",
      );
      const report = parseReport(run(path.join(root, "docs"), ["lint", "--json"]).stdout);
      expect(report.skipped!.map((item: { message: string }) => item.message)).toEqual([
        unreadable("docs/closed").slice("mdrefine: warning: ".length, -1),
        unreadable("docs/open", " for docs/open/.gitignore").slice(
          "mdrefine: warning: ".length,
          -1,
        ),
      ]);
    },
  );
  it("places --stdin-filepath in a root reached through a link", async () => {
    const root = await fixture({ "notes/a.md": "# A\n" });
    const alias = path.join(await fixture({}), "alias");
    await linkDirectory(root, alias);
    // From the real folder with the root named through the link, and the reverse.
    for (const [cwd, named] of [
      [root, alias],
      [alias, root],
    ] as const) {
      const args = ["lint", "-", "--root", named, "--stdin-filepath", "notes/new.md"];
      const piped = run(cwd, args, "See [a](a.md).\n");
      expect(piped.status, piped.stderr).toBe(0);
      expect(piped.stderr).toBe("");
    }
    const outside = run(
      root,
      ["lint", "-", "--root", alias, "--stdin-filepath", "../x.md"],
      "A.\n",
    );
    expect(outside.status).toBe(2);
    expect(outside.stderr).toBe("mdrefine: --stdin-filepath must be within the workspace.\n");
  });
  it("names the files that format --check would change, before the summary", async () => {
    const root = await fixture({
      "b.md": "B *note*.\n",
      "a.md": "A _clean_ note.\n",
      "sub/c.md": "C *note* with a [missing link](absent.md).\n",
    });
    const checked = run(path.join(root, "sub"), ["format", "--check"]);
    expect(checked.status).toBe(1);
    expect(checked.stdout).toBe("");
    expect(checked.stderr).toBe(
      "c.md:1:17: error links/valid: Missing local target: absent.md.\n" +
        "../b.md\n" +
        "c.md\n" +
        "3 file(s) processed; 2 would change.\n",
    );
    // A report for programs has `changed` instead, and stdin has only the exit code.
    expect(run(root, ["format", "--check", "--json"]).stderr).toBe("");
    const piped = run(root, ["format", "--check", "-"], "A *note*.\n");
    expect(piped.status).toBe(1);
    expect(piped.stderr).toBe("");
  });
  it("leaves warnings out of the report and the counts with --quiet", async () => {
    const root = await fixture({ "note.md": "A *note* with a [missing link](absent.md).\n" });
    const linted = run(root, ["lint", "--quiet"]);
    expect(linted.status).toBe(1);
    expect(linted.stderr).toBe(
      "note.md:1:17: error links/valid: Missing local target: absent.md.\n" +
        "1 file(s) linted; 1 error(s), 0 warning(s).\n",
    );
    const report = parseReport(run(root, ["lint", "--quiet", "--json"]).stdout);
    expect(report.files[0]!.diagnostics.map((item: { rule: string }) => item.rule)).toEqual([
      "links/valid",
    ]);
    // Warnings that are not reported are not counted either, as in ESLint.
    const warned = await fixture({ "note.md": "A *note*.\n" });
    expect(run(warned, ["lint", "--max-warnings", "0"]).status).toBe(1);
    const quiet = run(warned, ["lint", "--max-warnings", "0", "--quiet"]);
    expect(quiet.status).toBe(0);
    expect(quiet.stderr).toBe("1 file(s) linted; 0 error(s), 0 warning(s).\n");
    // Formatting still applies the edits of rules set to warn.
    expect(run(warned, ["format", "--quiet", "--check"]).status).toBe(1);
    expect(run(warned, ["format", "--quiet", "-"], "B *note*.\n").stdout).toBe("B _note_.\n");
  });
  it("applies --dialect to a frozen configuration without changing it", async () => {
    const root = await fixture({
      "mdrefine.config.mjs":
        'export default Object.freeze({ rules: Object.freeze({ "style/emphasis": "off" }) });',
      "note.md": "A *note*.\n",
    });
    const linted = run(root, ["lint", "--dialect", "gitea"]);
    expect(linted.status, linted.stderr).toBe(0);
    expect(linted.stderr).toBe("1 file(s) linted; 0 error(s), 0 warning(s).\n");
    const explained = run(root, ["config", "explain", "note.md", "--dialect", "codeberg"]);
    expect(explained.status, explained.stderr).toBe(0);
    expect(parseExplanation(explained.stdout).effective).toMatchObject({
      dialect: "forgejo",
      rules: { "style/emphasis": "off" },
    });
  });
  it("explains a document of the workspace by its path, and no other", async () => {
    const root = await fixture({
      "mdrefine.config.jsonc": '{ "overrides": [{ "files": ["notes/**"], "dialect": "gitea" }] }',
      "notes/a.md": "A note.\n",
      "other/b.md": "B note.\n",
    });
    const explain = (cwd: string, ...args: string[]) => run(cwd, ["config", "explain", ...args]);
    const explained = explain(root, "notes/a.md");
    expect(explained.status, explained.stderr).toBe(0);
    const result = parseExplanation(explained.stdout);
    expect(Object.keys(result)).toEqual(["root", "config", "path", "effective"]);
    expect(result).toMatchObject({
      config: path.join(result.root, "mdrefine.config.jsonc"),
      path: "notes/a.md",
      effective: { dialect: "gitea" },
    });
    // From a folder, of a document that does not exist yet, with the options on either side.
    const inner = explain(path.join(root, "notes"), "new/b.md", "--dialect", "github");
    expect(parseExplanation(inner.stdout)).toMatchObject({ path: "notes/new/b.md" });
    const before = run(path.join(root, "notes"), ["config", "--root", "..", "explain", "a.md"]);
    expect(parseExplanation(before.stdout)).toMatchObject({ path: "notes/a.md" });
    // A root reached through a link holds the document named by its real path.
    const elsewhere = await fixture({});
    await linkDirectory(root, path.join(elsewhere, "alias"));
    const linked = explain(root, "notes/a.md", "--root", path.join(elsewhere, "alias"));
    expect(linked.status, linked.stderr).toBe(0);
    expect(parseExplanation(linked.stdout)).toMatchObject({ path: "notes/a.md" });
    // `lint` refuses a document outside the workspace, and so does `config explain`.
    for (const args of [["../outside.md"], ["notes/a.md", "--root", "other"]]) {
      const outside = explain(root, ...args);
      expect(outside.status, args.join(" ")).toBe(2);
      expect(outside.stdout).toBe("");
      expect(outside.stderr).toBe(`mdrefine: Input is outside the workspace: ${args[0]}\n`);
    }
  });
  it("lists the rules of the configuration's plugins, also as JSON", async () => {
    const root = await fixture({
      "mdrefine.config.jsonc": '{ "plugins": ["./plugin.mjs"] }',
      "plugin.mjs":
        'export default { name: "local", rules: { report: { kind: "problem", description: "Reports\\n\\teverything.", check: () => [] } } };',
      "other/settings.json": "{}",
      "sub/note.md": "A note.\n",
    });
    // The configuration is found as for the other commands, by a search from here.
    const listed = run(path.join(root, "sub"), ["rules"]);
    expect(listed.status, listed.stderr).toBe(0);
    const lines = listed.stdout.trimEnd().split("\n");
    expect(lines).toContain(
      "style/wrap\tstyle\tReflows paragraphs to fill the line width, 80 columns by default.",
    );
    // Sorted by ID, with the plugin's rule among the built-in ones.
    const ids = lines.map((line) => line.split("\t")[0]!);
    expect(ids).toEqual([...ids].sort());
    expect(lines[ids.indexOf("local/report")]).toBe("local/report\tproblem\tReports everything.");
    const rules = (parseRules(run(root, ["rules", "--json"]).stdout) as { rules: unknown[] }).rules;
    expect(rules.length).toBe(lines.length);
    expect(rules.map((rule) => (rule as { id: string }).id)).toEqual(ids);
    expect(rules[ids.indexOf("local/report")]).toEqual({
      id: "local/report",
      kind: "problem",
      description: "Reports\n\teverything.",
    });
    const plain = run(root, ["rules", "--json", "--config", "other/settings.json"]);
    expect(parseRules(plain.stdout).rules.length).toBe(lines.length - 1);
  });
});
