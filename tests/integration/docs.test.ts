import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import type { Code, RootContent } from "mdast";
import { describe, expect, it } from "vitest";
import * as library from "../../src/index.js";
import { manifest, repository } from "./support.js";

const { builtInRules, dialectAliases, dialects, lint, parse, presets } = library;
const read = (file: string) => readFileSync(path.join(repository, file), "utf8");
const pages = readdirSync(path.join(repository, "docs"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => `docs/${name}`);
/** Top-level blocks of a Markdown file, which is where the documentation keeps its code blocks. */
const blocks = (file: string): RootContent[] => parse(read(file), "github", file).tree.children;
const isCode = (node: RootContent | undefined, lang: string): node is Code =>
  node?.type === "code" && node.lang === lang;

describe("configuration reference", () => {
  const reference = read("docs/configuration.md");
  it("lists every built-in rule, and no rule that does not exist", () => {
    for (const rule of Object.keys(builtInRules)) expect(reference).toContain(`\`${rule}\``);
    const listed = [...reference.matchAll(/^\| `([a-z]+\/[a-z-]+)` +\| (?:Style|Problem) /gm)].map(
      (match) => match[1]!,
    );
    expect(listed.length).toBeGreaterThan(10);
    for (const rule of listed) expect(Object.keys(builtInRules)).toContain(rule);
    for (const [rule, { kind }] of Object.entries(builtInRules))
      if (listed.includes(rule))
        expect(reference).toMatch(
          new RegExp(`^\\| \`${rule}\` +\\| ${kind === "style" ? "Style" : "Problem"} `, "m"),
        );
  });
  it("lists every preset, dialect, and alias", () => {
    for (const preset of Object.keys(presets))
      expect(reference).toMatch(new RegExp(`^\\| \`${preset}\` +\\|`, "m"));
    for (const dialect of [...dialects, ...Object.keys(dialectAliases)])
      expect(reference).toContain(`\`${dialect}\``);
  });
});

describe("configuration snippets", () => {
  const keys = ["extends", "dialect", "rules", "ignore", "overrides", "plugins", "resolve"];
  const snippets = [...pages, "README.md", "examples/README.md"].flatMap((file) =>
    blocks(file)
      .filter((node) => isCode(node, "json") || isCode(node, "jsonc"))
      .map((node) => ({ file, value: parseJsonc((node as Code).value) as unknown }))
      .filter(
        (snippet): snippet is { file: string; value: library.Config } =>
          typeof snippet.value === "object" &&
          snippet.value !== null &&
          Object.keys(snippet.value).some((key) => keys.includes(key)),
      ),
  );
  it("are found in the documentation", () => {
    expect(snippets.length).toBeGreaterThan(5);
    expect(new Set(snippets.map((snippet) => snippet.file))).toContain("docs/quick-start.md");
  });
  it.each(snippets)("in $file are accepted by the tool: $value", ({ value }) => {
    library.validateConfig(value);
    // Rule names and options are only checked when a document is processed. A snippet
    // that loads a plugin names rules and presets that exist only with that plugin.
    if (!value.plugins) expect(() => lint("", { config: value })).not.toThrow();
  });
});

describe("examples page", () => {
  const page = blocks("docs/examples.md");
  const shown = page.flatMap((node, index) => {
    const previous = page[index - 1];
    const link = previous?.type === "paragraph" ? previous.children[0] : undefined;
    const label = link?.type === "link" ? link.children[0] : undefined;
    return node.type === "code" && label?.type === "inlineCode"
      ? [{ file: label.value, node }]
      : [];
  });
  const commands = page.flatMap((node, index) => {
    const output = page[index + 1];
    return isCode(node, "sh") && isCode(output, "text")
      ? [{ command: node.value, output: output.value }]
      : [];
  });
  it("shows files and command output", () => {
    expect(shown.length).toBeGreaterThan(8);
    expect(commands.length).toBeGreaterThan(4);
  });
  it.each(shown)("shows $file as it is in the repository", ({ file, node }) => {
    expect(file).toMatch(/^examples\//);
    expect(`${node.value}\n`).toBe(read(file));
  });
  it.each(commands)("shows the real output of: $command", ({ command, output }) => {
    // A documented command is `node <script> <arguments>`, optionally piped into another one.
    let input: string | undefined;
    let printed = "";
    for (const stage of command.split(" | ")) {
      const [program, ...args] = stage.split(" ");
      expect(program).toBe("node");
      const result = spawnSync(process.execPath, args, {
        cwd: repository,
        input,
        encoding: "utf8",
      });
      input = result.stdout;
      printed = result.stdout + result.stderr;
    }
    expect(`${output}\n`).toBe(printed);
  });
  it("mentions every example", () => {
    const text = read("docs/examples.md");
    const examples = path.join(repository, "examples");
    for (const entry of readdirSync(examples, { withFileTypes: true })) {
      if (entry.name === "README.md") continue;
      const names = entry.isDirectory()
        ? readdirSync(path.join(examples, entry.name)).map((name) => `${entry.name}/${name}`)
        : [entry.name];
      for (const name of names) expect(text, name).toContain(`examples/${name}`);
    }
  });
});

describe("documentation site", () => {
  it("links every page from the sidebar, and only pages that exist", () => {
    const sidebar = [...read("docs/.vitepress/config.mts").matchAll(/link: "\/([a-z-]+)"/g)].map(
      (match) => `docs/${match[1]}.md`,
    );
    for (const page of pages) if (page !== "docs/index.md") expect(sidebar).toContain(page);
    for (const link of sidebar) expect(pages).toContain(link);
  });
  it("gives installation commands for the current version", () => {
    for (const file of ["README.md", "docs/quick-start.md"]) {
      const versions = [...read(file).matchAll(/mdrefine@(\d[\w.-]*)/g)].map((match) => match[1]);
      expect(versions.length, file).toBeGreaterThan(0);
      for (const version of versions) expect(version, file).toBe(manifest.version);
    }
  });
});

describe("library API", () => {
  it("is the same in the built package as in the source, and is documented", async () => {
    const built = (await import(
      pathToFileURL(path.join(repository, "dist/index.js")).href
    )) as Record<string, unknown>;
    expect(Object.keys(built).sort()).toEqual(Object.keys(library).sort());
    // A name counts as documented when the page imports it in a code block or names it in code.
    const page = read("docs/plugins.md");
    const documented = new Set([
      ...[...page.matchAll(/import \{([^}]+)\} from "mdrefine"/g)].flatMap((match) =>
        match[1]!.split(",").map((name) => name.trim()),
      ),
      ...[...page.matchAll(/`(\w+)[`(]/g)].map((match) => match[1]!),
    ]);
    for (const name of Object.keys(built)) expect(documented, name).toContain(name);
  });
});
