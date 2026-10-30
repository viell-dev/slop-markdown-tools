import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Ajv } from "ajv";
import { parse as parseJsonc } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { Code, Nodes, RootContent } from "mdast";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as library from "../../src/index.js";
import { fixture, manifest, repository, run } from "../support/cli.js";

const { builtInRules, dialectAliases, dialects, lint, parse, presets, range } = library;
const read = (file: string) => readFileSync(path.join(repository, file), "utf8");
/** Every page of the site, in subdirectories too, as a path from the repository. */
const pages = readdirSync(path.join(repository, "docs"), { recursive: true, encoding: "utf8" })
  .map((name) => name.split(path.sep).join("/"))
  .filter((name) => name.endsWith(".md") && !name.startsWith(".vitepress/"))
  .map((name) => `docs/${name}`);
/** Top-level blocks of a Markdown file, which is where the documentation keeps its code blocks. */
const blocks = (file: string): RootContent[] => parse(read(file), "github", file).tree.children;
const isCode = (node: RootContent | undefined, lang: string): node is Code =>
  node?.type === "code" && node.lang === lang;

describe("rules reference", () => {
  const file = "docs/rules.md";
  const source = read(file);
  const page = blocks(file);
  const index = page.find((node) => node.type === "table");
  // The index's rows, as the source text of each cell: rule, kind, `recommended`, dialect presets, options.
  const rows =
    index?.type === "table"
      ? index.children
          .slice(1)
          .map((row) =>
            row.children.map((cell) =>
              cell.children.length
                ? source.slice(range(cell.children[0]!)[0], range(cell.children.at(-1)!)[1])
                : "",
            ),
          )
      : [];
  const listed = rows.map(([rule]) => /^`([^`]+)`$/.exec(rule ?? "")?.[1] ?? String(rule));
  /** The presets that enable a rule, with the severity they give it. */
  const enabling = (rule: string) =>
    Object.entries(presets).flatMap(([name, preset]) => {
      const value = preset.rules?.[rule];
      const severity = typeof value === "string" ? value : value?.[0];
      return severity && severity !== "off" ? [{ name, severity }] : [];
    });
  it("has one index row for every built-in rule, in alphabetical order", () => {
    expect([...listed].sort()).toEqual(Object.keys(builtInRules).sort());
    expect(listed).toEqual([...listed].sort());
  });
  /** Whether a rule takes options: its schema names at least one. */
  const hasOptions = (rule: string) =>
    Object.keys(
      (builtInRules[rule]?.schema as { properties?: object } | undefined)?.properties ?? {},
    ).length > 0;
  /**
   * A preset cell: for each severity, `warn` or `error`, followed by the presets that give it
   * when the column holds several presets, else ❌.
   */
  const cell = (enabled: { name: string; severity: string }[], named: boolean) =>
    enabled.length
      ? ["error", "warn"]
          .flatMap((severity) => {
            const names = enabled.filter((preset) => preset.severity === severity);
            if (!names.length) return [];
            const list = names.map(({ name }) => `\`${name}\``).join(", ");
            return [named ? `\`${severity}\` in ${list}` : `\`${severity}\``];
          })
          .join("; ")
      : "❌";
  it("gives each rule's kind, presets with their severity, and options as the code does", () => {
    for (const [index, [, kind, recommended, dialectPresets, options]] of rows.entries()) {
      const rule = listed[index]!;
      const style = builtInRules[rule]?.kind === "style";
      expect(kind, rule).toBe(style ? "🎨" : "🔍");
      const enabled = enabling(rule);
      expect(recommended, rule).toBe(
        cell(
          enabled.filter(({ name }) => name === "recommended"),
          false,
        ),
      );
      expect(dialectPresets, rule).toBe(
        cell(
          enabled.filter(({ name }) => name !== "recommended"),
          true,
        ),
      );
      expect(options, rule).toBe(hasOptions(rule) ? "✅" : "❌");
    }
  });
  it("opens each rule's section with what it does, then its kind, presets, dialects, and options", () => {
    const facts =
      /^\*\*(Style|Problem) rule\*\*, (fixed by `format`|reported only)\. Presets: (.+?)\. Dialects: (.+?)\. Options: (.+?)\.$/;
    page.forEach((node, at) => {
      if (node.type !== "heading" || node.depth !== 2 || node.children[0]?.type !== "inlineCode")
        return;
      const rule = node.children[0].value;
      // The opening says what the rule does, in prose rather than a label or the facts.
      const opening = page[at + 1];
      const opened = opening ? source.slice(...range(opening)) : "";
      expect(opening?.type, `${rule}: ${opened}`).toBe("paragraph");
      expect(opened, rule).not.toMatch(/^\*\*/);
      const next = page[at + 2];
      const text = next ? source.slice(...range(next)).replace(/\s+/g, " ") : "";
      const match = facts.exec(text);
      expect(match, `${rule}: ${text}`).not.toBeNull();
      const [, kind, fixes, presetsText = "", , optionsText] = match!;
      const style = builtInRules[rule]?.kind === "style";
      expect(kind, rule).toBe(style ? "Style" : "Problem");
      expect(fixes, rule).toBe(style ? "fixed by `format`" : "reported only");
      // Each preset with the severity it gives the rule, as in "`recommended` (warn)".
      const stated =
        presetsText === "none"
          ? []
          : presetsText.split(", ").map((preset) => {
              const found = /^`([^`]+)` \((warn|error)\)$/.exec(preset);
              expect(found, `${rule}: ${preset}`).not.toBeNull();
              return `${found![1]} ${found![2]}`;
            });
      expect(stated.sort(), rule).toEqual(
        enabling(rule)
          .map(({ name, severity }) => `${name} ${severity}`)
          .sort(),
      );
      expect(optionsText === "none", rule).toBe(!hasOptions(rule));
    });
  });
  it("has a section for every rule, in the order of the index", () => {
    const sections = page.flatMap((node) =>
      node.type === "heading" && node.depth === 2 && node.children[0]?.type === "inlineCode"
        ? [node.children[0].value]
        : [],
    );
    expect(sections).toEqual(listed);
  });
});

describe("configuration and dialect references", () => {
  it("list every preset, dialect, and alias", () => {
    const configuration = read("docs/configuration.md");
    for (const preset of Object.keys(presets))
      expect(configuration).toMatch(new RegExp(`^\\| \`${preset}\` +\\|`, "m"));
    const reference = read("docs/dialects.md");
    for (const dialect of [...dialects, ...Object.keys(dialectAliases)])
      expect(reference).toContain(`\`${dialect}\``);
  });
});

describe("configuration schema", () => {
  const published = JSON.parse(read("config.schema.json")) as Record<string, unknown>;
  it("is the schema that the tool enforces", () => {
    // `npm run schema` writes the file from the schema in src/config/resolve.ts.
    expect(published).toEqual(library.configSchema);
  });
  it("accepts the repository's configuration files on its own, and is shipped", () => {
    const validate = new Ajv({ allErrors: true }).compile(published);
    const files = [
      "mdrefine.config.jsonc",
      ...readdirSync(path.join(repository, "examples"), { recursive: true, encoding: "utf8" })
        .filter((name) => name.endsWith(".jsonc"))
        .map((name) => `examples/${name.split(path.sep).join("/")}`),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const value = parseJsonc(read(file)) as unknown;
      expect(validate(value), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
    expect(validate({ extends: 5 })).toBe(false);
    const packaged = JSON.parse(read("package.json")) as {
      files: string[];
      exports: Record<string, unknown>;
    };
    expect(packaged.files).toContain("config.schema.json");
    expect(packaged.exports["./config.schema.json"]).toBe("./config.schema.json");
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
        const value = parseJsonc(node.value, errors, {
          allowTrailingComma: true,
          disallowComments: node.lang === "json",
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

describe("getting started", () => {
  it("shows the real lint output and result for the README's example", async () => {
    const [before, after] = blocks("README.md").filter((node) => isCode(node, "markdown"));
    const page = blocks("docs/quick-start.md");
    const config = page.find((node) => isCode(node, "jsonc"));
    const output = page.find((node) => isCode(node, "text"));
    expect(before && after && config && output).toBeTruthy();
    const root = await fixture({
      "README.md": `${(before as Code).value}\n`,
      "mdrefine.config.jsonc": (config as Code).value,
    });
    // A terminal shows both streams; the findings and the summary are on stderr.
    const linted = run(root, ["lint"]);
    expect(linted.stdout + linted.stderr).toBe(`${(output as Code).value}\n`);
    // The README says that `format --write` with these presets turns it into its second block.
    expect(run(root, ["format", "--write"]).status).toBe(0);
    expect(readFileSync(path.join(root, "README.md"), "utf8")).toBe(`${(after as Code).value}\n`);
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
    // A documented command is `npx mdrefine <arguments>`, which the built command runs here, or
    // `node <script> <arguments>`, optionally piped into another one.
    let input: string | undefined;
    let printed = "";
    for (const stage of command.split(" | ")) {
      const [program, ...rest] = stage.split(" ");
      const installed = program === "npx" && rest[0] === "mdrefine";
      expect(installed || program === "node", stage).toBe(true);
      const args = installed ? ["dist/cli/main.js", ...rest.slice(1)] : rest;
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
  it("lists every starting configuration in the examples' README too", () => {
    const text = read("examples/README.md");
    const configurations = readdirSync(path.join(repository, "examples")).filter((name) =>
      name.endsWith(".jsonc"),
    );
    expect(configurations.length).toBeGreaterThan(4);
    for (const name of configurations) expect(text, name).toContain(`(${name})`);
  });
});

describe("documentation site", () => {
  it("links every page from the sidebar, and only pages that exist", () => {
    const config = read("docs/.vitepress/config.mts");
    const sidebar = [...config.matchAll(/link: "\/([a-z0-9/-]+)"/g)].map(
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
  it("shows the current version in the JSON report's example", () => {
    const versions = [...read("docs/cli.md").matchAll(/^ {2}"version": "([^"]+)",$/gm)];
    expect(versions.map((match) => match[1])).toEqual([manifest.version]);
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
    const width = typeof wrap === "string" ? Number.NaN : Number(wrap?.[1]?.width);
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

describe("version annotations", () => {
  // A page describes the behavior of the version it documents; the changelog holds the history.
  // The versions of renderers and other tools, as in "Gitea before 1.26" or "Gitea version 1.26
  // fixes", are not that history: a tool's name directly before the version, or before "version"
  // or "versions" and the version, exempts it.
  const tool =
    "Forgejo|Gitea|GitHub|markdown-it|markdownlint|micromark|Node\\.js|npm|Obsidian|pnpm|Prettier|TypeScript|Vite|VitePress|Vue";
  const notTool = `(?<!\\b(?:${tool}) (?:versions? )?)`;
  const version = String.raw`v?\d+\.\d+(?:\.(?:\d+|x))?\b`;
  const annotations = [
    new RegExp(
      String.raw`${notTool}\b(?:after|since|before|until|from|as of|in|(?:added|introduced|removed|changed|new) in) (?:versions? )?${version}`,
      "gi",
    ),
    new RegExp(
      String.raw`(?<!\b(?:${tool}) )\bversions? ${version} (?:adds|added|bundles|changes|changed|corrects|fixes|gained|gains|introduces|introduced|no longer|removes|removed|retains)\b`,
      "gi",
    ),
    /\bunreleased\b/gi,
    /\bnext (?:minor |major |patch )?release\b/gi,
  ];
  /**
   * Text that names versions for another reason, with the reason. Each entry must still occur,
   * so that a removed passage does not leave a stale exception behind.
   */
  const allowed: [file: string, text: string, reason: string][] = [
    [
      "docs/benchmarks.md",
      "The figures below precede the internal parser adapter introduced in 0.4.1.",
      "the version the measurements were taken with",
    ],
    [
      "docs/versions.md",
      "Before 1.0, the second number plays the part of the first",
      "the versioning policy",
    ],
  ];
  /** Node types inside a paragraph; the others separate the text around them. */
  const phrasing = new Set<string>([
    "break",
    "delete",
    "emphasis",
    "footnoteReference",
    "html",
    "image",
    "imageReference",
    "inlineCode",
    "inlineMath",
    "link",
    "linkReference",
    "strong",
    "text",
  ]);
  /**
   * The text a reader sees, with its blank space collapsed: inline code without its backticks,
   * emphasis without its markers, link text without its destination. Code blocks are examples,
   * not the page's own statements, and are left out.
   */
  const readable = (source: string, file = "page.md") => {
    const parts: string[] = [];
    const visit = (node: Nodes) => {
      if (node.type === "code" || node.type === "definition") return;
      const block = !phrasing.has(node.type);
      if (block) parts.push(" ");
      if (node.type === "html") parts.push(node.value.replace(/<[^>]*>/g, " "));
      else if (node.type === "image") parts.push(node.alt ?? "");
      else if (node.type === "break") parts.push(" ");
      else if ("value" in node) parts.push(node.value);
      else if ("children" in node) for (const child of node.children) visit(child);
      if (block) parts.push(" ");
    };
    visit(parse(source, "github", file).tree);
    return parts.join("").replace(/\s+/g, " ");
  };
  const text = (file: string) => readable(read(file), file);
  const annotated = (text: string) =>
    annotations.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
  it.each([
    ["After 0.4.0, the rule also checks tables.", "After 0.4.0"],
    ["**Unreleased:** the option takes a list.", "Unreleased"],
    ["Since `0.5.0`, this rule accepts the option.", "Since 0.5.0"],
    ["Added **in 0.5.0**, this option selects a marker.", "Added in 0.5.0"],
    ["In 0.5.0, this rule gained an option.", "In 0.5.0"],
    ["In _version 0.5.0_, this rule gained an option.", "In version 0.5.0"],
    ["Version 0.6.0 adds the `marker` option.", "Version 0.6.0 adds"],
    ["Available [from 0.5.0](changelog.md#_0-5-0) onward.", "from 0.5.0"],
    ["It waits for the next minor release.", "next minor release"],
  ])("finds the annotation in %j", (source, found) => {
    expect(annotated(readable(source))).toEqual([found]);
  });
  it.each([
    "Gitea before 1.26 renders nothing.",
    "Gitea versions before 1.26 render nothing.",
    "Gitea version 1.26 fixes heading IDs.",
    "`Obsidian` versions since 1.12 hide the marker.",
    "Prettier version 3.9.10 changes the list marker.",
    "Node.js versions from 22.12 load the configuration.",
    "Install it with `npm install mdrefine@0.5.0`.",
    "```text\nSince 0.5.0, this rule accepts the option.\n```",
    "In the next paragraph, version numbers such as 0.5.0 stand alone.",
  ])("allows %j", (source) => {
    expect(annotated(readable(source))).toEqual([]);
  });
  // The changelog and the upgrading steps are the history that the other pages leave out.
  const history = new Set(["docs/changelog.md", "docs/upgrading.md"]);
  const checked = [...pages.filter((page) => !history.has(page)), "README.md"];
  it.each(checked)("%s describes its version without history", (file) => {
    let rest = text(file);
    for (const [owner, passage] of allowed)
      if (owner === file) rest = rest.split(passage).join(" ");
    expect(annotated(rest)).toEqual([]);
  });
  it("allows only passages that the pages still have", () => {
    for (const [file, passage, reason] of allowed)
      expect(text(file), `${file}: ${reason}`).toContain(passage);
  });
});

describe("library API", () => {
  it("has a doc comment for every export and every member that it declares", () => {
    const entries = ["dist/index.d.ts", "dist/node.d.ts"].map((file) =>
      path.join(repository, file),
    );
    const program = ts.createProgram(entries, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      types: [],
    });
    const checker = program.getTypeChecker();
    const dist = path.join(repository, "dist");
    // Members that a dependency declares, such as an mdast node's `position`, are its own.
    const declaredHere = (symbol: ts.Symbol) =>
      (symbol.getDeclarations() ?? []).some((declaration) =>
        path.resolve(declaration.getSourceFile().fileName).startsWith(dist),
      );
    const documented = (symbol: ts.Symbol) => symbol.getDocumentationComment(checker).length > 0;
    const missing: string[] = [];
    let count = 0;
    for (const entry of entries) {
      const module = checker.getSymbolAtLocation(program.getSourceFile(entry)!)!;
      for (const exported of checker.getExportsOfModule(module)) {
        count++;
        const symbol =
          exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        if (!documented(symbol)) missing.push(exported.name);
        if (symbol.flags & ts.SymbolFlags.Interface)
          for (const member of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)))
            if (declaredHere(member) && !documented(member))
              missing.push(`${exported.name}.${member.name}`);
      }
    }
    expect(count).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });
  it("is the same in the built package as in the source, and is documented", async () => {
    const built = (await import(
      pathToFileURL(path.join(repository, "dist/index.js")).href
    )) as Record<string, unknown>;
    expect(Object.keys(built).sort()).toEqual(Object.keys(library).sort());
    // A name counts as documented when the page imports it in a code block or names it in code.
    const page = read("docs/api.md");
    const documented = new Set([
      ...[...page.matchAll(/import \{([^}]+)\} from "mdrefine"/g)].flatMap((match) =>
        match[1]!.split(",").map((name) => name.trim()),
      ),
      ...[...page.matchAll(/`(\w+)[`(]/g)].map((match) => match[1]!),
    ]);
    for (const name of Object.keys(built)) expect(documented, name).toContain(name);
  });
  it("has a filesystem entry that is the same built as in the source, and is documented", async () => {
    const source = (await import("../../src/node.js")) as Record<string, unknown>;
    const built = (await import(
      pathToFileURL(path.join(repository, "dist/node.js")).href
    )) as Record<string, unknown>;
    expect(Object.keys(built).sort()).toEqual(Object.keys(source).sort());
    const page = read("docs/api.md");
    const imported = [...page.matchAll(/import \{([^}]+)\} from "mdrefine\/node"/g)].flatMap(
      (match) => match[1]!.split(",").map((name) => name.trim()),
    );
    for (const name of Object.keys(built)) expect(imported, name).toContain(name);
    const manifest = JSON.parse(read("package.json")) as { exports: Record<string, unknown> };
    expect(Object.keys(manifest.exports)).toEqual([
      ".",
      "./node",
      "./config.schema.json",
      "./package.json",
    ]);
  });
});

describe("changelog", () => {
  // The Release workflow publishes a version's section of CHANGELOG.md as its release notes.
  const notes = (version: string) =>
    spawnSync(process.execPath, ["scripts/release-notes.mjs", version], {
      cwd: repository,
      encoding: "utf8",
    });
  it("has release notes for the version in package.json, one line per paragraph", () => {
    const result = notes(manifest.version);
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines.join("")).not.toBe("");
    // GitHub shows each line break of a release's notes, so wrapped lines are joined.
    for (const [index, line] of lines.entries())
      if (index > 0 && lines[index - 1] && line) expect(line).toMatch(/^\s*(?:[-*+] |\d+[.)] |#)/);
  });
  it("refuses a version that has no section", () => {
    const result = notes("0.0.0-none.0");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CHANGELOG.md has no section for 0.0.0-none.0");
  });
});

describe("competitor fallback (#788)", () => {
  const prose = (file: string) => read(file).replace(/\s+/g, " ");
  it("does not promise the recommended preset to every workspace without a configuration", () => {
    const quickStart = prose("docs/quick-start.md");
    expect(quickStart).not.toContain("Without a configuration file, the `recommended` rules apply");
    expect(quickStart).toContain("--no-competitor-config");
    expect(quickStart).toContain("configuration.md#competitor-configuration-fallback");
    expect(quickStart).toContain("each file ending in `.md` or `.markdown`");
  });
  it("tells those upgrading how to keep the defaults", () => {
    const steps = prose("docs/upgrading.md").split("## 0.6.0")[1]!.split(/ ## /)[0]!;
    expect(steps).toContain("instead of the `recommended` preset");
    expect(steps).toContain("--no-competitor-config");
    expect(steps).toContain("mdrefine config convert --write");
  });
  it("ascribes --quiet only to the commands that take it", () => {
    const takes = (args: string[]) =>
      run(repository, [...args, "--help"]).stdout.includes("--quiet");
    expect(takes(["lint"]) && takes(["format"])).toBe(true);
    expect(takes(["config", "explain"])).toBe(false);
    const notices = prose("docs/cli.md")
      .split("### Competitor fallback notices")[1]!
      .split(" ### ")[0]!;
    const sentences = notices.split(/(?<=\.) /).filter((text) => text.includes("`--quiet`"));
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) {
      expect(sentence).toMatch(/`lint` and `format`/);
      if (sentence.includes("`config explain`"))
        expect(sentence).toContain("`config explain` takes no `--quiet`");
    }
  });
});
