import { describe, expect, it, vi } from "vitest";
import * as syntax from "../../src/syntax/parse.js";
import {
  format,
  lint,
  parse,
  presets,
  resolveConfig,
  createWorkspace,
  semanticFingerprint,
  ruleRegistry,
  validateConfig,
  builtInRules,
  configSchema,
  dialectAliases,
  dialects,
} from "../../src/index.js";
import type { Config, Dialect, ProcessOptions } from "../../src/index.js";
import { formatted } from "../support/engine.js";
describe("configuration and plugins", () => {
  describe("recommended block spacing (#423)", () => {
    const source = "# Setup\nInstall the package.\n- Run the command.\n";
    const output = "# Setup\n\nInstall the package.\n\n- Run the command.\n";
    it.each<Config | undefined>([
      undefined,
      {},
      { extends: "recommended" },
      { extends: ["recommended"] },
    ])("warns and formats missing separators with configuration %j", (config) => {
      expect(resolveConfig({ config }).rules["style/block-spacing"]).toBe("warn");
      expect(lint(source, { config })).toMatchObject([
        { rule: "style/block-spacing", severity: "warn" },
        { rule: "style/block-spacing", severity: "warn" },
      ]);
      expect(formatted(source, { config })).toBe(output);
      expect(semanticFingerprint(parse(output, "github"))).toBe(
        semanticFingerprint(parse(source, "github")),
      );
    });
    it("allows opting out while retaining the other recommended rules", () => {
      const config: Config = { rules: { "style/block-spacing": "off" } };
      expect(lint(source, { config })).toEqual([]);
      expect(formatted(source, { config })).toBe(source);
      expect(formatted(source.replace("Install", "*Install*"), { config })).toBe(
        source.replace("Install", "_Install_"),
      );
    });
    it.each<Config>([{ extends: [] }, { extends: "github" }])(
      "does not enable spacing outside recommended with configuration %j",
      (config) => {
        expect(resolveConfig({ config }).rules["style/block-spacing"]).toBeUndefined();
        expect(lint(source, { config })).toEqual([]);
        expect(formatted(source, { config })).toBe(source);
      },
    );
  });
  it("supports region and next-line suppressions without interpreting code examples", () => {
    const source =
      "<!-- mdrefine-disable style/emphasis -->\n\n*keep*\n\n<!-- mdrefine-enable style/emphasis -->\n\n*change*\n\n<!-- mdrefine-disable-next-line style/emphasis -->\n*also keep*\n";
    const output = formatted(source);
    expect(output).toContain("*keep*");
    expect(output).toContain("_change_");
    expect(output).toContain("*also keep*");
    const code = "```md\n<!-- mdrefine-disable -->\n```\n\n*change*\n";
    expect(formatted(code)).toContain("_change_");
  });
  it("supports defaults, overrides, and explicit empty presets", () => {
    expect(resolveConfig({}).rules["style/wrap"]).toEqual(["warn", { width: 80 }]);
    const source = "word ".repeat(18).trimEnd() + "\n";
    const expected = "word ".repeat(16).trimEnd() + "\nword word\n";
    expect(formatted(source)).toBe(expected);
    expect(formatted(source, { config: { rules: { "style/wrap": "warn" } } })).toBe(expected);
    expect(
      formatted(source, { config: { rules: { "style/wrap": ["warn", { width: 100 }] } } }),
    ).toBe(source);
    expect(resolveConfig({ config: { extends: [] } }).rules).toEqual({});
    expect(
      resolveConfig({
        config: {
          overrides: [
            { files: ["vault/**/*.md"], dialect: "obsidian", rules: { "style/wrap": "off" } },
          ],
        },
        path: "vault/a.md",
      }).rules["style/wrap"],
    ).toBe("off");
  });

  it("rejects unknown configuration, rules, options, and preset cycles", () => {
    expect(() => lint("", { config: { rules: { typo: "warn" } } })).toThrow("Unknown rule");
    expect(() => lint("", { config: { rules: { "style/wrap": ["warn", { width: 2 }] } } })).toThrow(
      "Invalid options",
    );
    expect(() => resolveConfig({ config: { typo: true } as Config })).toThrow(
      "Invalid configuration",
    );
    expect(() =>
      resolveConfig({
        config: { extends: ["local/a"] },
        path: "a.md",
        plugins: [{ name: "local", presets: { a: { extends: ["local/a"] } } }],
      }),
    ).toThrow("Circular");
  });
  it("matches override patterns with their letter case on every system", () => {
    const config: Config = { overrides: [{ files: ["docs/**"], dialect: "obsidian" }] };
    expect(resolveConfig({ config, path: "docs/a.md" }).dialect).toBe("obsidian");
    expect(resolveConfig({ config, path: "Docs/a.md" }).dialect).toBe("github");
  });
  it("accepts one preset name for extends and a severity alone in a list", () => {
    expect(resolveConfig({ config: { extends: "github" } })).toEqual(
      resolveConfig({ config: { extends: ["github"] } }),
    );
    expect(() =>
      resolveConfig({
        config: { extends: "local/a" },
        path: "a.md",
        plugins: [{ name: "local", presets: { a: { extends: "local/a" } } }],
      }),
    ).toThrow("Circular preset: local/a -> local/a");
    const config: Config = { extends: [], rules: { "style/wrap": ["warn"] } };
    const source = "word ".repeat(18).trimEnd() + "\n";
    expect(formatted(source, { config })).toBe(
      formatted(source, { config: { extends: [], rules: { "style/wrap": "warn" } } }),
    );
    expect(
      lint("*a*\n", { config: { extends: [], rules: { "style/emphasis": ["off"] } } }),
    ).toEqual([]);
  });
  it.each([
    [5, "the configuration must be an object, not 5"],
    [{ typo: 1, rule: {} }, 'unknown setting "typo"; unknown setting "rule"'],
    [{ extends: 5 }, '"extends" must be a preset name or a list of preset names, not 5'],
    [{ extends: ["github", 5] }, '"extends[1]" must be a preset name, not 5'],
    [
      { dialect: "markdown" },
      '"dialect" must be "commonmark", "github", "forgejo", "codeberg", "gitea", "obsidian", or "vitepress", not "markdown"',
    ],
    [{ rules: [] }, '"rules" must be an object of rule IDs and their settings, not a list'],
    [
      { rules: { "style/wrap": "warning" } },
      'the setting of "style/wrap" must be "off", "warn", or "error", or a list of a severity and, optionally, the rule\'s options, not "warning"',
    ],
    [
      { rules: { "style/wrap": ["warnn"] } },
      'the severity of "style/wrap" must be "off", "warn", or "error", not "warnn"',
    ],
    [
      { rules: { "style/wrap": ["warn", 80] } },
      'the options of "style/wrap" must be an object, not 80',
    ],
    [
      { rules: { "style/wrap": ["warn", {}, {}] } },
      'the setting of "style/wrap" must be "off", "warn", or "error", or a list of a severity and, optionally, the rule\'s options',
    ],
    [{ ignore: "drafts/**" }, '"ignore" must be a list of path patterns, not "drafts/**"'],
    [{ plugins: [null] }, '"plugins[0]" must be a file or package name, not null'],
    [
      { resolve: { gitIgnored: "yes", other: true } },
      'unknown setting "resolve.other"; "resolve.gitIgnored" must be true or false, not "yes"',
    ],
    [{ overrides: [{ rules: {} }] }, '"overrides[0]" must have "files"'],
    [
      { overrides: [{ files: [] }] },
      '"overrides[0].files" must be a list of one or more path patterns',
    ],
    [
      { overrides: [{ files: ["a.md"], rules: { "style/wrap": "on" } }] },
      'the setting of "style/wrap" in "overrides[0]" must be "off", "warn", or "error", or a list of a severity and, optionally, the rule\'s options, not "on"',
    ],
  ])("says what is wrong with %j by setting name", (value, problem) => {
    expect(() => validateConfig(value)).toThrow(new Error(`Invalid configuration: ${problem}`));
  });
  it("takes one options object, and says so for the prereleases' form", () => {
    const message =
      "resolveConfig takes one options object, { path, config, plugins, defaultDialect }, since mdrefine 0.2.0.";
    const call = resolveConfig as (...parameters: unknown[]) => unknown;
    expect(() => call({ extends: [] })).toThrow(new TypeError(message));
    expect(() => call({ dialect: "github" })).toThrow(new TypeError(message));
    expect(() => call({}, "a.md")).toThrow(new TypeError(message));
    expect(() => call(undefined, "Note.md", [], "obsidian")).toThrow(new TypeError(message));
    expect(() => call(null)).toThrow(new TypeError(message));
    // The options of lint and format serve as they are.
    const options: ProcessOptions = {
      path: "vault/a.md",
      config: { overrides: [{ files: ["vault/**"], dialect: "obsidian" }] },
      workspace: createWorkspace({}),
      ranges: [],
    };
    expect(resolveConfig(options).dialect).toBe("obsidian");
    expect(lint("*a*\n", { ...options, ranges: undefined })).toEqual(
      lint("*a*\n", { path: options.path, config: options.config }),
    );
  });
  it("freezes the tables that it exports, which every caller shares", () => {
    expect(() => {
      // @ts-expect-error The table is read-only.
      presets.recommended!.rules!["style/wrap"] = "off";
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error The options are read-only too.
      (presets.recommended!.rules!["style/wrap"] as readonly unknown[])[1] = { width: 20 };
    }).toThrow(TypeError);
    expect(resolveConfig().rules["style/wrap"]).toEqual(["warn", { width: 80 }]);
    expect(() => {
      // @ts-expect-error The rules and their schemas are read-only.
      builtInRules["style/wrap"]!.check = () => [];
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error Bypass the read-only type to test runtime freezing.
      dialects.push("markdown"); // eslint-disable-line @typescript-eslint/no-unsafe-call
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error The aliases are read-only.
      dialectAliases.codeberg = "github";
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error The schema is read-only.
      configSchema.title = "Other";
    }).toThrow(TypeError);
    expect(Object.isFrozen((configSchema.properties as { extends: object }).extends)).toBe(true);
    // A registry is a new table, which its caller may change.
    const registry = ruleRegistry();
    delete registry["style/wrap"];
    expect(builtInRules["style/wrap"]).toBeDefined();
    // Frozen presets are configurations like any other.
    expect(resolveConfig({ config: presets.github }).dialect).toBe("github");
  });
  it("reads a document in the dialect that an alias stands for", () => {
    const source = "# Title {#custom}\n\n[Title](#custom)\n";
    const document = parse(source, "codeberg");
    expect(document.dialect).toBe("forgejo");
    expect(semanticFingerprint(document)).toBe(semanticFingerprint(parse(source, "forgejo")));
    expect(() => parse(source, "markdown" as Dialect)).toThrow("Unknown dialect: markdown");
  });
  it("says what is wrong with a rule's options by option name", () => {
    const wrap = (options: Record<string, unknown>) => () =>
      lint("", { config: { extends: [], rules: { "style/wrap": ["warn", options] } } });
    expect(wrap({ width: "80" })).toThrow(
      new Error('Invalid options for style/wrap: "width" must be an integer, not "80"'),
    );
    expect(wrap({ width: 10 })).toThrow(
      new Error('Invalid options for style/wrap: "width" must be at least 20'),
    );
    expect(wrap({ widht: 80 })).toThrow(
      new Error('Invalid options for style/wrap: unknown option "widht"'),
    );
    // An enumerated option names the values it allows.
    expect(() =>
      lint("", { config: { extends: [], rules: { "style/emphasis": ["warn", { marker: "~" }] } } }),
    ).toThrow(
      new Error(
        'Invalid options for style/emphasis: "marker" must be "*", "_", or "consistent", not "~"',
      ),
    );
  });
});

describe("the dialect assumed when none is named", () => {
  // Every document here is a table or a footnote on GitHub, Forgejo, Gitea, and
  // in Obsidian. CommonMark, which was assumed up to 0.2.0-rc.1, reads the
  // tables and the consecutive definitions as ordinary paragraphs, which
  // `style/wrap` then reflowed, and a footnote definition as a link definition.
  const table = "| Sensor | Unit |\n|---|---|\n| Temperature | °C |\n";
  const bareTable = "Sensor | Unit\n---|---\nTemperature | °C\n";
  const wideTable =
    "| Sensor name in a long header cell | Unit of measurement in a long header cell | Notes |\n" +
    "|---|---|---|\n" +
    "| Temperature measured at the north wall | Degrees Celsius, to one decimal place | Calibrated yearly |\n";
  const footnotes = "Text with two notes.[^1][^2]\n\n[^1]: First note.\n[^2]: Second note.\n";
  const footnote = "Text with a note.[^1]\n\n[^1]: Text.\n";
  const commonmark: Config = { dialect: "commonmark" };
  // `recommended` aligns tables, which it would not do to a paragraph.
  const aligned = "| Sensor      | Unit |\n| ----------- | ---- |\n| Temperature | °C   |\n";
  const wideAligned =
    "| Sensor name in a long header cell      | Unit of measurement in a long header cell | Notes             |\n" +
    "| -------------------------------------- | ----------------------------------------- | ----------------- |\n" +
    "| Temperature measured at the north wall | Degrees Celsius, to one decimal place     | Calibrated yearly |\n";
  it("is GitHub, for a configuration, a preset, or a workspace that names none", () => {
    expect(resolveConfig().dialect).toBe("github");
    expect(resolveConfig({ config: { extends: ["recommended"] } }).dialect).toBe("github");
    expect(
      resolveConfig({ config: { extends: [], rules: { "style/wrap": "warn" } } }).dialect,
    ).toBe("github");
    const spy = vi.spyOn(syntax, "parse");
    try {
      const workspace = createWorkspace({ "note.md": "", "target.md": "# Title\n" });
      expect(workspace.resolve("note.md", "target.md#title", "github").fragmentExists).toBe(true);
      expect(spy).toHaveBeenCalledExactlyOnceWith("# Title\n", "github", "target.md");
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    ["a table with outer pipes", table, aligned],
    ["a table without outer pipes", bareTable, aligned],
    ["a table wider than 80 columns", wideTable, wideAligned],
    ["two consecutive footnote definitions", footnotes, footnotes],
  ])("keeps %s, which is not prose to wrap", (_, source, output) => {
    // No configuration: the `recommended` preset, which wraps prose at 80 columns.
    const result = format(source);
    expect(result.output).toBe(output);
    expect(result.diagnostics.filter((item) => item.rule !== "style/table")).toEqual([]);
    expect(format(source, { config: { dialect: "github" } })).toEqual(result);
    expect(format(output)).toEqual({ output, changed: false, diagnostics: [] });
    expect(lint(output)).toEqual([]);
  });
  it("reads a footnote definition as a footnote, not as a link to a missing file", () => {
    const workspace = createWorkspace({ "note.md": footnote });
    expect(lint(footnote, { path: "note.md", workspace })).toEqual([]);
    expect(format(footnote, { path: "note.md", workspace })).toEqual({
      output: footnote,
      changed: false,
      diagnostics: [],
    });
  });
  it("still reads CommonMark, tables and footnotes included, when CommonMark is named", () => {
    expect(resolveConfig({ config: commonmark }).dialect).toBe("commonmark");
    // A table is a paragraph in CommonMark, so its lines are prose to wrap.
    expect(formatted(table, { config: commonmark })).toBe(
      "| Sensor | Unit | |---|---| | Temperature | °C |\n",
    );
    expect(formatted(bareTable, { config: commonmark })).toBe(
      "Sensor | Unit ---|--- Temperature | °C\n",
    );
    expect(formatted(wideTable, { config: commonmark })).toBe(
      "| Sensor name in a long header cell | Unit of measurement in a long header cell\n" +
        "| Notes | |---|---|---| | Temperature measured at the north wall | Degrees\n" +
        "Celsius, to one decimal place | Calibrated yearly |\n",
    );
    expect(formatted(footnotes, { config: commonmark })).toBe(
      "Text with two notes.[^1][^2]\n\n[^1]: First note. [^2]: Second note.\n",
    );
    // `[^1]: Text.` defines a link named `^1` to the file `Text.` in CommonMark.
    const workspace = createWorkspace({ "note.md": footnote }, { dialect: "commonmark" });
    expect(lint(footnote, { path: "note.md", config: commonmark, workspace })).toMatchObject([
      { rule: "links/valid", severity: "error", line: 3, message: "Missing local target: Text.." },
    ]);
  });
  it("assumes the dialect only; the rules of the github preset still need the preset", () => {
    expect(Object.keys(resolveConfig().rules)).toEqual(Object.keys(presets.recommended!.rules!));
    const source = `${aligned}\n- [X] Done\n\n> [!note]\n> Text.\n`;
    expect(formatted(source)).toBe(source);
    expect(formatted(source, { config: { extends: ["recommended", "github"] } })).toBe(
      `${aligned}\n- [x] Done\n\n> [!NOTE]\n> Text.\n`,
    );
  });
  it("gives way to a dialect named by the configuration, a preset, or an override", () => {
    expect(resolveConfig({ config: { dialect: "forgejo" } }).dialect).toBe("forgejo");
    expect(resolveConfig({ config: { extends: ["recommended", "obsidian"] } }).dialect).toBe(
      "obsidian",
    );
    expect(resolveConfig({ config: { extends: ["gitea"], dialect: "commonmark" } }).dialect).toBe(
      "commonmark",
    );
    const config: Config = { overrides: [{ files: ["plain/**"], dialect: "commonmark" }] };
    expect(resolveConfig({ config, path: "plain/a.md" }).dialect).toBe("commonmark");
    expect(resolveConfig({ config, path: "docs/a.md" }).dialect).toBe("github");
    expect(formatted(table, { config, path: "plain/a.md" })).toBe(
      "| Sensor | Unit | |---|---| | Temperature | °C |\n",
    );
    expect(formatted(table, { config, path: "docs/a.md" })).toBe(aligned);
  });
});

describe("a default dialect supplied by the caller", () => {
  // What a host passes when it knows more than the configuration says, as the CLI
  // does at the root of an Obsidian vault. Obsidian shows the first two lines of
  // this note on separate lines unless its "Strict line breaks" setting is on, and
  // a wikilink must stay on one line.
  const link =
    "[[A fairly long note name that sits near the wrap column of this paragraph|alias text]]";
  const note = `Shopping list\nMilk and eggs\n\nSee ${link} here.\n`;
  const files = {
    "Note.md": note,
    "A fairly long note name that sits near the wrap column of this paragraph.md": "# Target\n",
  };
  const vault = (strictLineBreaks?: boolean) =>
    createWorkspace(files, {
      dialect: "obsidian",
      ...(strictLineBreaks === undefined ? {} : { strictLineBreaks }),
    });
  it("is assumed when nothing names a dialect, and resolves aliases", () => {
    expect(resolveConfig({ path: "Note.md", defaultDialect: "obsidian" }).dialect).toBe("obsidian");
    expect(
      resolveConfig({
        config: { extends: ["recommended"] },
        path: "Note.md",
        defaultDialect: "obsidian",
      }).dialect,
    ).toBe("obsidian");
    expect(resolveConfig({ path: "Note.md", defaultDialect: "codeberg" }).dialect).toBe("forgejo");
    expect(resolveConfig({ path: "Note.md", defaultDialect: undefined }).dialect).toBe("github");
    expect(() => resolveConfig({ path: "Note.md", defaultDialect: "markdown" as Dialect })).toThrow(
      "Unknown default dialect: markdown",
    );
    expect(() => lint("", { defaultDialect: "markdown" as Dialect })).toThrow(
      "Unknown default dialect: markdown",
    );
  });
  it.each([undefined, false])(
    "keeps a vault note's lines apart and its wikilink whole (strict line breaks: %s)",
    (strictLineBreaks) => {
      const options: ProcessOptions = {
        path: "Note.md",
        workspace: vault(strictLineBreaks),
        defaultDialect: "obsidian",
      };
      expect(format(note, options)).toEqual({ output: note, changed: false, diagnostics: [] });
      expect(lint(note, options)).toEqual([]);
      // Without the default, the note is GitHub Markdown: one paragraph, and a link to split.
      const assumed = format(note, { path: "Note.md", workspace: vault(strictLineBreaks) });
      expect(assumed.output).toBe(
        "Shopping list Milk and eggs\n\nSee [[A fairly long note name that sits near the wrap column of this\nparagraph|alias text]] here.\n",
      );
    },
  );
  it("reflows a vault note once strict line breaks are verified, around the wikilink", () => {
    const options: ProcessOptions = {
      path: "Note.md",
      workspace: vault(true),
      defaultDialect: "obsidian",
    };
    const output = formatted(note, options);
    expect(output).toBe(`Shopping list Milk and eggs\n\nSee\n${link}\nhere.\n`);
    expect(output).toBe(
      formatted(note, { path: "Note.md", workspace: vault(true), config: { dialect: "obsidian" } }),
    );
    expect(semanticFingerprint(parse(output, "obsidian"), options.workspace)).toBe(
      semanticFingerprint(parse(note, "obsidian"), options.workspace),
    );
  });
  it("assumes the dialect only; the rules of the obsidian preset still need the preset", () => {
    const options: ProcessOptions = { workspace: vault(), defaultDialect: "obsidian" };
    const resolved = resolveConfig({ path: "Note.md", defaultDialect: "obsidian" });
    expect(resolved.dialect).toBe("obsidian");
    expect(Object.keys(resolved.rules)).toEqual(Object.keys(presets.recommended!.rules!));
    const source = "> [!TIP] Title\n> Text.\n\n- [X] Done\n";
    expect(format(source, options)).toEqual({ output: source, changed: false, diagnostics: [] });
    const preset = format(source, {
      ...options,
      config: { extends: ["recommended", "obsidian"] },
    });
    expect(preset.output).toBe("> [!tip] Title\n> Text.\n\n- [x] Done\n");
    expect(preset.diagnostics.map((item) => item.rule)).toEqual(["obsidian/strict-line-breaks"]);
  });
  it("gives way to a dialect named by the configuration, a preset, or an override", () => {
    const resolved = (config: Config, path = "Note.md") =>
      resolveConfig({ config, path, defaultDialect: "obsidian" }).dialect;
    expect(resolved({ dialect: "commonmark" })).toBe("commonmark");
    expect(resolved({ extends: ["recommended", "github"] })).toBe("github");
    expect(resolved({ extends: ["codeberg"] })).toBe("forgejo");
    const config: Config = { overrides: [{ files: ["docs/**"], dialect: "gitea" }] };
    expect(resolved(config, "docs/a.md")).toBe("gitea");
    expect(resolved(config, "Note.md")).toBe("obsidian");
    // A named GitHub dialect reads the note as GitHub Markdown in spite of the default.
    const github = format(note, {
      path: "Note.md",
      workspace: vault(),
      config: { extends: ["recommended", "github"] },
      defaultDialect: "obsidian",
    });
    expect(github.output).toContain("Shopping list Milk and eggs\n");
  });
});

describe("override ruleUpdates", () => {
  it.each(["error", ["error"], "off", ["off"]] as const)(
    "patches after replacement %j",
    (setting) => {
      const config: Config = {
        extends: [],
        rules: { "style/wrap": ["warn", { width: 42, mode: "never" }] },
        overrides: [
          {
            files: ["**/*.md"],
            rules: { "style/wrap": setting },
            ruleUpdates: { "style/wrap": { options: { width: 60 } } },
          },
        ],
      };
      expect(resolveConfig({ config }).rules["style/wrap"]).toEqual([
        typeof setting === "string" ? setting : setting[0],
        { width: 60 },
      ]);
    },
  );
  it("keeps options while off and enables absent rules only on request", () => {
    const config: Config = {
      extends: [],
      overrides: [
        { files: ["**/*.md"], ruleUpdates: { "style/wrap": { options: { width: 42 } } } },
        { files: ["docs/**"], ruleUpdates: { "style/wrap": { severity: "warn" } } },
        { files: ["docs/**"], ruleUpdates: { "style/wrap": { severity: "off" } } },
        { files: ["docs/README.md"], ruleUpdates: { "style/wrap": { severity: "error" } } },
      ],
    };
    expect(resolveConfig({ config, path: "note.md" }).rules["style/wrap"]).toEqual([
      "off",
      { width: 42 },
    ]);
    expect(resolveConfig({ config, path: "docs/note.md" }).rules["style/wrap"]).toEqual([
      "off",
      { width: 42 },
    ]);
    expect(resolveConfig({ config, path: "docs/README.md" }).rules["style/wrap"]).toEqual([
      "error",
      { width: 42 },
    ]);
  });
  it("orders preset overrides before local patches and replaces nested objects shallowly", () => {
    const plugins = [
      {
        name: "test",
        presets: {
          base: {
            extends: [],
            rules: { "test/pair": ["warn", { a: 1, nested: { old: 1 } }] },
            overrides: [
              { files: ["**/*.md"], ruleUpdates: { "test/pair": { options: { a: 3 } } } },
            ],
          },
        },
      },
    ] as const;
    const config: Config = {
      extends: ["test/base"],
      overrides: [
        { files: ["**/*.md"], ruleUpdates: { "test/pair": { options: { nested: { next: 2 } } } } },
        {
          files: ["**/*.md"],
          ruleUpdates: { "test/pair": { severity: "error", options: { b: 4 } } },
        },
      ],
    };
    expect(resolveConfig({ config, plugins }).rules["test/pair"]).toEqual([
      "error",
      { a: 3, b: 4, nested: { next: 2 } },
    ]);
  });
  it("validates patch shape and checks final options only when enabled", () => {
    for (const patch of [{ severity: "bad" }, { options: [] }, { unknown: true }])
      expect(() =>
        validateConfig({ overrides: [{ files: ["*.md"], ruleUpdates: { "style/wrap": patch } }] }),
      ).toThrow();
    const config: Config = {
      extends: [],
      overrides: [
        { files: ["**/*.md"], ruleUpdates: { "style/wrap": { options: { width: "bad" } } } },
      ],
    };
    expect(lint("text\n", { config })).toEqual([]);
    const enabled: Config = {
      ...config,
      overrides: [
        ...config.overrides!,
        { files: ["**/*.md"], ruleUpdates: { "style/wrap": { severity: "warn" } } },
      ],
    };
    expect(() => lint("text\n", { config: enabled })).toThrow(/width/);
    const repaired: Config = {
      ...enabled,
      overrides: [
        ...enabled.overrides!,
        { files: ["**/*.md"], ruleUpdates: { "style/wrap": { options: { width: 40 } } } },
      ],
    };
    expect(() => lint("text\n", { config: repaired })).not.toThrow();
  });
});

describe("patch option schema at execution", () => {
  it("validates required plugin options after patches have accumulated", () => {
    const plugins = [
      {
        name: "test",
        rules: {
          pair: {
            kind: "problem",
            description: "pair",
            schema: {
              type: "object",
              properties: { a: { type: "number" }, b: { type: "number" } },
              required: ["a", "b"],
              additionalProperties: false,
            },
            check: () => [],
          },
        },
      },
    ] as const;
    const config: Config = {
      extends: [],
      overrides: [
        { files: ["**/*.md"], ruleUpdates: { "test/pair": { options: { a: 1 } } } },
        {
          files: ["**/*.md"],
          ruleUpdates: { "test/pair": { severity: "error", options: { b: 2 } } },
        },
      ],
    };
    expect(() => lint("text\n", { config, plugins })).not.toThrow();
    for (const options of [{ b: "bad" }, { c: 3 }]) {
      const invalid: Config = {
        ...config,
        overrides: [
          ...config.overrides!,
          { files: ["**/*.md"], ruleUpdates: { "test/pair": { options } } },
        ],
      };
      expect(() => lint("text\n", { config: invalid, plugins })).toThrow(/Invalid options/);
    }
  });
});
