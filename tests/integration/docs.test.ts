import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
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
      .map((node) => {
        // Parse as the loader does: comments only in JSONC, trailing commas in both.
        const errors: ParseError[] = [];
        const value = parseJsonc((node as Code).value, errors, {
          allowTrailingComma: true,
          disallowComments: (node as Code).lang === "json",
        }) as unknown;
        return { file, value, errors };
      })
      .filter(
        (snippet): snippet is { file: string; value: library.Config; errors: ParseError[] } =>
          typeof snippet.value === "object" &&
          snippet.value !== null &&
          Object.keys(snippet.value).some((key) => keys.includes(key)),
      ),
  );
  it("are found in the documentation", () => {
    expect(snippets.length).toBeGreaterThan(5);
    expect(new Set(snippets.map((snippet) => snippet.file))).toContain("docs/quick-start.md");
  });
  it.each(snippets)("in $file are accepted by the tool: $value", ({ value, errors }) => {
    expect(errors).toEqual([]);
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
  it("fits a line of the default wrap width into a code block", () => {
    // The site shows formatted output, so a code block must hold a line of the default wrap
    // width without scrolling sideways. Only a browser shows the real layout. This checks the
    // arithmetic of the site's stylesheet for a text column at its full width, and that the
    // theme still has every rule the stylesheet overrides or relies on. When a VitePress update
    // changes one of them, measure the site in a browser again before changing what is
    // expected here.
    const squash = (text: string) => text.replace(/\s+/g, " ");
    const style = squash(read("docs/.vitepress/theme/style.css"));
    const theme = (file: string) =>
      squash(read(`node_modules/vitepress/dist/client/theme-default/${file}`));
    const wrap = presets.recommended?.rules?.["style/wrap"];
    const width = Array.isArray(wrap) ? Number(wrap[1]?.width) : Number.NaN;
    expect(width).toBeGreaterThan(0);

    // In rem: the text column, less the padding on both sides of a code block, divided by the
    // width of a character. The code font size is in em of the 1rem body text. The widest font
    // of the theme's monospace stack is SF Mono, which Safari uses for `ui-monospace`; its
    // characters are 1266/2048 em wide.
    const value = (pattern: RegExp) => Number(pattern.exec(style)?.[1]);
    const fontSize = value(/div\[class\*="language-"\] \{ --vp-code-font-size: ([\d.]+)em; \}/);
    const column = value(/> \.content > \.content-container \{ max-width: ([\d.]+)rem; \}/);
    const padding = 1.5;
    const columns = Math.floor((column - 2 * padding) / (fontSize * (1266 / 2048)));
    expect(columns).toBeGreaterThanOrEqual(width);

    const expected: [file: string, rule: string][] = [
      ["styles/vars.css", "--vp-code-font-size: 0.875em;"],
      ["styles/vars.css", "--vp-font-family-mono: ui-monospace, 'Menlo', 'Monaco', 'Consolas',"],
      [
        "styles/components/vp-doc.css",
        ".vp-doc [class*='language-'] code { display: block; padding: 0 1.5rem;",
      ],
      ["styles/components/vp-doc.css", "font-size: var(--vp-code-font-size); color: var(--vp-code"],
      ["components/VPDoc.vue", "'has-sidebar': hasSidebar, 'has-aside': hasAside"],
      ["components/VPDoc.vue", '<div class="container"> <div v-if="hasAside" class="aside"'],
      ["components/VPDoc.vue", '<div class="content"> <div class="content-container">'],
      ["components/VPDoc.vue", "@media (min-width: 60rem) { .VPDoc { padding: 3rem 2rem 0; }"],
      ["components/VPDoc.vue", "@media (min-width: 60rem) { .content { padding: 0 2rem 8rem; } }"],
      ["components/VPDoc.vue", "padding-left: 2rem; width: 100%; max-width: 16rem; }"],
      ["components/VPDoc.vue", ".VPDoc.has-aside .content-container { max-width: 43rem; }"],
    ];
    for (const [file, rule] of expected) expect(theme(file), file).toContain(rule);
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
