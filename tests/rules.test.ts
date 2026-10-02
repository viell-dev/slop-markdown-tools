import { describe, expect, it } from "vitest";
import {
  applyEdits,
  canonicalDialect,
  createWorkspace,
  format,
  lint,
  parse,
  resolveConfig,
  semanticFingerprint,
  textContent,
} from "../src/index.js";
import type { Config, Dialect, Plugin, RuleSetting } from "../src/index.js";

function only(rules: Record<string, RuleSetting>, dialect: Dialect = "commonmark"): Config {
  return { extends: [], dialect, rules };
}
/** Format, require no engine diagnostics, and require idempotence. */
function formatted(source: string, config: Config, options: Record<string, unknown> = {}) {
  const result = format(source, { config, ...options });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config, ...options }).output).toBe(result.output);
  return result.output;
}

describe("style/heading", () => {
  const config = only({ "style/heading": "warn" });
  it.each([
    ["Title\n=====\n", "# Title\n"],
    ["Sub\n---\n", "## Sub\n"],
    ["*Title* with `code`\n===\n", "# *Title* with `code`\n"],
    ["C#\n---\n", "## C#\n"],
    ["Sharp #\n---\n", "## Sharp \\#\n"],
    ["Sharp ##\n===\n", "# Sharp \\##\n"],
    ["Sharp \\#\n---\n", "## Sharp \\#\n"],
  ])("converts %j to an ATX heading", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
  it("reports the conversion with the proposed text", () => {
    const [finding] = lint("Title\n===\n", { config });
    expect(finding).toMatchObject({ rule: "style/heading", line: 1, column: 1 });
    expect(finding?.edit?.text).toBe("# Title");
  });
  it.each([
    ["# Already ATX\n"],
    ["Line one\nLine two\n---\n"],
    ["- Item\n  ---\n"],
    ["> Quoted\n> ---\n"],
  ])("leaves %j unchanged", (source) => {
    expect(formatted(source, config)).toBe(source);
    expect(lint(source, { config })).toEqual([]);
  });
});

describe("style/emphasis and style/strong next to other delimiters", () => {
  const config = only({ "style/emphasis": "warn", "style/strong": "warn" });
  it.each(["_*foo*_", "*_foo_*", "_foo_*bar*", "*foo*_bar", "bar_*foo*", "*__foo__*", "__*foo*__"])(
    "leaves %s alone because the new marker would touch an existing one",
    (source) => {
      expect(formatted(`${source}\n`, config)).toBe(`${source}\n`);
      expect(lint(`${source}\n`, { config })).toEqual([]);
    },
  );
  it.each([
    ["***foo***\n", "_**foo**_\n"],
    ["___foo___\n", "_**foo**_\n"],
    ["*foo* *bar*\n", "_foo_ _bar_\n"],
    ["**foo** __bar__\n", "**foo** **bar**\n"],
    ["*foo*(bar)\n", "_foo_(bar)\n"],
  ])("still converts %j", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
});

describe("Forgejo and Gitea backslash math", () => {
  const markers = { "style/emphasis": "warn", "style/strong": "warn" } as const;
  it.each(["forgejo", "gitea"] as const)(
    "leaves markers inside \\(...\\) alone on %s",
    (dialect) => {
      expect(formatted("\\(*x*\\) and *y*\n", only(markers, dialect))).toBe("\\(*x*\\) and _y_\n");
      expect(formatted("\\(__x__\\)\n", only(markers, dialect))).toBe("\\(__x__\\)\n");
      expect(formatted("\\(*x*\\)\n", only(markers, "github"))).toBe("\\(_x_\\)\n");
    },
  );
  it.each(["forgejo", "gitea"] as const)(
    "does not join a code span that would put \\( and \\) on one line on %s",
    (dialect) => {
      const source = "\\( `code\nspan` \\)\n";
      expect(formatted(source, only({ "style/inline-code": "warn" }, dialect))).toBe(source);
      expect(formatted(source, only({ "style/inline-code": "warn" }, "github"))).toBe(
        "\\( `code span` \\)\n",
      );
    },
  );
});

describe("style/emphasis and style/strong on Gitea", () => {
  const rules: Record<string, RuleSetting> = { "style/emphasis": "warn", "style/strong": "warn" };
  // Gitea renders `__init__.py` literally and `*config*.py` as emphasis; GFM
  // parses both as emphasis, so a marker change would alter Gitea's output.
  it.each([
    ["See __init__.py and __main__.py.\n", "See **init**.py and **main**.py.\n"],
    ["Edit *config*.py first.\n", "Edit _config_.py first.\n"],
    ["Use **setup**.py here.\n", "Use **setup**.py here.\n"],
    ["*a* and b_.py\n", "_a_ and b_.py\n"],
    ["*a* near `x_.py`\n", "_a_ near `x_.py`\n"],
    ["*.py files*\n", "_.py files_\n"],
  ])("leaves %j alone where `_.py` decides Gitea emphasis", (source, github) => {
    expect(formatted(source, only(rules, "gitea"))).toBe(source);
    expect(formatted(source, only(rules, "github"))).toBe(github);
  });
  it("converts markers on other lines", () => {
    const source = "*a* and __b__\n\n*c* on __init__.py\n";
    expect(formatted(source, only(rules, "gitea"))).toBe("_a_ and **b**\n\n*c* on __init__.py\n");
  });
  it("leaves multiline code spans on `_.py` lines unjoined", () => {
    const config = only({ "style/inline-code": "warn" }, "gitea");
    const source = "_a_ and `code\nspan` near b_.py\n";
    expect(formatted(source, config)).toBe(source);
    expect(formatted(source, { ...config, dialect: "github" })).toBe(
      "_a_ and `code span` near b_.py\n",
    );
  });
});

describe("Forgejo and Gitea heading attribute blocks", () => {
  const forges = ["forgejo", "gitea"] as const;
  const markers = { "style/emphasis": "warn", "style/strong": "warn" } as const;
  // Forgejo and Gitea read the trailing `{...}` block before they parse
  // emphasis; GFM parses the same characters as heading text. Rendered on
  // Forgejo 16.0.5 and Gitea 1.25.5, 1.27.3, and 28.0.0, each source below
  // differs from its GitHub-style rewrite in heading text, attributes, or anchor.
  it.each([
    // The rewritten block would be invalid: heading text and no `#bare` anchor.
    ["## Bare {#bare data-x=__init__}\n", "## Bare {#bare data-x=**init**}\n"],
    // The rewritten block would set another title.
    ['## Star {title="*x*"}\n', '## Star {title="_x_"}\n'],
    // No emphasis on the forges: it would start in the text and end in the block.
    ["## __Mode {.a__}\n", "## **Mode {.a**}\n"],
    // Emphasis and no block on the forges: `{.a*}` is invalid and `{.a_}` is not.
    ["## *Mode {.a*}\n", "## _Mode {.a_}\n"],
    ["Under *lined {.a*}\n===\n", "Under _lined {.a_}\n===\n"],
    // Each of the two nested emphases alone would leave the block invalid.
    ["## **Lead {.c* .d*}\n", "## __Lead {.c_ .d_}\n"],
    // Gitea before 1.26 also reads a block that a closing sequence follows.
    ["## Old {#old data-x=__init__} ##\n", "## Old {#old data-x=**init**} ##\n"],
    // From the first `{` on, every character can decide whether a block follows.
    ["## Use {braces} in *text*\n", "## Use {braces} in _text_\n"],
  ])("leaves the markers of %j alone", (source, github) => {
    for (const dialect of forges) expect(formatted(source, only(markers, dialect))).toBe(source);
    expect(formatted(source, only(markers, "github"))).toBe(github);
  });
  it.each(forges)("still converts markers outside a block on %s", (dialect) => {
    expect(
      formatted(
        "## *Install* and __run__ {#setup}\n\nA *b* {.c*}\n\n*Two*\nlines {#two}\n---\n",
        only(markers, dialect),
      ),
    ).toBe("## _Install_ and **run** {#setup}\n\nA _b_ {.c*}\n\n_Two_\nlines {#two}\n---\n");
  });
  it.each(forges)("keeps a heading's custom anchor through the %s preset", (dialect) => {
    const config: Config = { extends: ["recommended", dialect] };
    const source = "## Bare {#bare data-x=__init__}\n\n[link](#bare) and *text*\n";
    const workspace = createWorkspace({ "Doc.md": source });
    const result = format(source, { config, path: "Doc.md", workspace });
    expect(result.output).toBe("## Bare {#bare data-x=__init__}\n\n[link](#bare) and _text_\n");
    expect(result.diagnostics.filter((item) => item.rule !== "style/emphasis")).toEqual([]);
  });
  it.each([
    // A `#` run before the block would close the ATX heading on the forges.
    ["Run ## {#sid}\n===\n", "# Run \\## {#sid}\n", "# Run ## {#sid}\n"],
    ["Tight ##{#tid}\n---\n", "## Tight \\##{#tid}\n", "## Tight ##{#tid}\n"],
    ["Plain {#pid}\n---\n", "## Plain {#pid}\n", "## Plain {#pid}\n"],
    ["C# {#cs}\n---\n", "## C# {#cs}\n", "## C# {#cs}\n"],
    ["Run ## {#sid} #\n===\n", "# Run ## {#sid} \\#\n", "# Run ## {#sid} \\#\n"],
  ])("converts the Setext heading %j without changing its text", (source, forge, github) => {
    const config = { "style/heading": "warn" } as const;
    for (const dialect of forges) expect(formatted(source, only(config, dialect))).toBe(forge);
    expect(formatted(source, only(config, "github"))).toBe(github);
  });
  it.each([
    // Joined, the last line would hold a valid block.
    ['Join {title="`c\nd`"}\n---\n', 'Join {title="`c d`"}\n---\n'],
    // Forgejo builds the anchor from the last line alone: `#b-end`.
    ["Multi `a\nb` end\n===\n", "Multi `a b` end\n===\n"],
  ])("leaves the multiline code span of the heading %j unjoined", (source, github) => {
    const config = { "style/inline-code": "warn" } as const;
    for (const dialect of forges) {
      expect(formatted(source, only(config, dialect))).toBe(source);
      expect(formatted(`Text \`a\nb\` end\n\n${source}`, only(config, dialect))).toBe(
        `Text \`a b\` end\n\n${source}`,
      );
    }
    expect(formatted(source, only(config, "github"))).toBe(github);
  });
  it("leaves a link destination inside a block alone", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "relative", leadingDot: true }],
    };
    const source = '## Link {title="[x](y.md)"}\n\n[y](y.md)\n';
    const workspace = createWorkspace({ "Doc.md": source, "y.md": "" });
    const run = (dialect: Dialect) =>
      formatted(source, only(rules, dialect), { path: "Doc.md", workspace });
    for (const dialect of forges)
      expect(run(dialect)).toBe('## Link {title="[x](y.md)"}\n\n[y](./y.md)\n');
    expect(run("github")).toBe('## Link {title="[x](./y.md)"}\n\n[y](./y.md)\n');
  });
  it("refuses an edit by any rule that changes a block", () => {
    // In the GFM tree both spellings are the same emphasis, so only the
    // block's own text can tell them apart.
    const swap = (from: string, to: string): Plugin => ({
      name: "swap",
      rules: {
        markers: {
          kind: "style",
          description: "Replace the emphasis markers of the first heading",
          check: ({ document }) =>
            [...document.source.split("\n")[0]!.matchAll(/[*_]/g)]
              .filter((match) => match[0] === from)
              .map((match) => ({
                start: match.index,
                message: "Swap",
                edit: { start: match.index, end: match.index + 1, text: to },
              })),
        },
      },
    });
    const config = (dialect: Dialect) => only({ "swap/markers": "warn" }, dialect);
    for (const [source, from, to] of [
      ['## Star {title="*x*"}\n', "*", "_"],
      ["## *Mode {.a*}\n", "*", "_"],
      ["## _Mode {.a_}\n", "_", "*"],
      ["## Old {#old data-x=_i_} ##\n", "_", "*"],
    ] as const) {
      const plugins = [swap(from, to)];
      for (const dialect of forges) {
        const result = format(source, { config: config(dialect), plugins });
        expect(result.output).toBe(source);
        expect(result.diagnostics).toMatchObject([{ rule: "engine/unsafe-format" }]);
      }
      expect(format(source, { config: config("github"), plugins }).output).toBe(
        source.replaceAll(from, to),
      );
    }
    // The same edit in heading text before a block is an ordinary marker change.
    const plugins = [swap("*", "_")];
    expect(format("## *Mode* {.a}\n", { config: config("forgejo"), plugins }).output).toBe(
      "## _Mode_ {.a}\n",
    );
  });
  it("refuses an edit that adds or removes a closing sequence after a block", () => {
    // `## Title {#id}` is a block on every version; `## Title {#id} ##` only on
    // Gitea before 1.26. Both leave the same GFM tree and the same block text.
    const closing = (text: string): Plugin => ({
      name: "closing",
      rules: {
        sequence: {
          kind: "style",
          description: "Replace the first line",
          check: ({ document }) => {
            const end = document.source.indexOf("\n");
            return document.source.slice(0, end) === text
              ? []
              : [{ start: 0, message: "Replace", edit: { start: 0, end, text } }];
          },
        },
      },
    });
    for (const [source, text] of [
      ["## Title {#id} ##\n", "## Title {#id}"],
      ["## Title {#id}\n", "## Title {#id} ##"],
    ] as const) {
      for (const dialect of forges) {
        const result = format(source, {
          config: only({ "closing/sequence": "warn" }, dialect),
          plugins: [closing(text)],
        });
        expect(result.output).toBe(source);
        expect(result.diagnostics).toMatchObject([{ rule: "engine/unsafe-format" }]);
      }
      const github = only({ "closing/sequence": "warn" }, "github");
      expect(format(source, { config: github, plugins: [closing(text)] }).output).toBe(`${text}\n`);
    }
  });
  it("finds heading lines in time proportional to the document", () => {
    // Every heading used to be searched for a `{` up to the end of the document.
    const source = `${"## Heading\n\n".repeat(20000)}*x*\n`;
    const start = performance.now();
    expect(formatted(source, only(markers, "forgejo"))).toBe(source.replace("*x*", "_x_"));
    expect(performance.now() - start).toBeLessThan(10000);
  });
});

describe("links/path wikilink rewriting", () => {
  const workspace = createWorkspace(
    { "Doc.md": "", "Folder/Note.md": "# Heading\n", "Other/Dup.md": "", "Folder/Dup.md": "" },
    { dialect: "obsidian" },
  );
  const rewrite = (rules: Record<string, RuleSetting>, source: string) =>
    formatted(source, only(rules, "obsidian"), { path: "Doc.md", workspace });
  it("normalizes aliased links and embeds but not bare wikilinks", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "root", extension: "omit" }],
    };
    expect(rewrite(rules, "[[Folder/Note.md|label]]\n")).toBe("[[Folder/Note|label]]\n");
    expect(rewrite(rules, "![[Folder/Note.md]]\n")).toBe("![[Folder/Note]]\n");
    expect(rewrite(rules, "[[Folder/Note.md#Heading|label]]\n")).toBe(
      "[[Folder/Note#Heading|label]]\n",
    );
    // A bare wikilink's target is also its label; changing it would change the rendering.
    expect(rewrite(rules, "[[Folder/Note.md]]\n")).toBe("[[Folder/Note.md]]\n");
    expect(rewrite(rules, "[[Folder/Note|label]]\n")).toBe("[[Folder/Note|label]]\n");
  });
  it("shortens to a basename only when the basename resolves to the same note", () => {
    const rules: Record<string, RuleSetting> = { "links/path": ["warn", { style: "shortest" }] };
    expect(rewrite(rules, "[[Folder/Note|label]]\n")).toBe("[[Note|label]]\n");
    expect(rewrite(rules, "[[Folder/Dup|label]]\n")).toBe("[[Folder/Dup|label]]\n");
  });
  it("adds a leading dot to relative destinations on request", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "relative", leadingDot: true }],
    };
    expect(rewrite(rules, "[[Folder/Note.md|label]]\n")).toBe("[[./Folder/Note.md|label]]\n");
    expect(formatted("[label](Folder/Note.md)\n", only(rules), { path: "Doc.md", workspace })).toBe(
      "[label](./Folder/Note.md)\n",
    );
  });
});

describe("links/path destination parsing", () => {
  const workspace = createWorkspace(
    { "Doc.md": "", "Folder/Note.md": "", "Folder/Note(1).md": "", "a>b.md": "" },
    { dialect: "commonmark" },
  );
  const angle = only({ "links/path": ["warn", { style: "relative", brackets: "angle" }] });
  const bare = only({ "links/path": ["warn", { style: "relative", brackets: "bare" }] });
  it.each([
    ["[a\\]b](./Folder/Note.md)\n", angle, "[a\\]b](<Folder/Note.md>)\n"],
    ["![a [b] c](./Folder/Note.md)\n", angle, "![a [b] c](<Folder/Note.md>)\n"],
    ["[a](<./Folder/Note.md>)\n", bare, "[a](Folder/Note.md)\n"],
    ["[a](<./a\\>b.md>)\n", angle, "[a](<a%3Eb.md>)\n"],
    ["[a](./Folder/Note(1).md)\n", angle, "[a](<Folder/Note(1).md>)\n"],
    ["[a](./Folder/Note\\(1\\).md)\n", angle, "[a](<Folder/Note(1).md>)\n"],
    ["[a](./Folder/Note(1).md)\n", bare, "[a](Folder/Note%281%29.md)\n"],
    ['[a](./Folder/Note.md "title")\n', angle, '[a](<Folder/Note.md> "title")\n'],
  ])("rewrites the destination of %j", (source, config, output) => {
    expect(formatted(source, config, { path: "Doc.md", workspace })).toBe(output);
  });
});

describe("links/valid definitions", () => {
  const config = only({ "links/valid": "error" });
  it("treats references without a definition as plain text", () => {
    const source = "[text][missing] and ![alt][gone] and [shortcut]\n";
    expect(parse(source, "github").tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: source.trimEnd() }],
    });
    expect(lint(source, { config })).toEqual([]);
    expect(lint("[text][known]\n\n[known]: https://example.test\n", { config })).toEqual([]);
    expect(lint("[text][known]\n\n[known]: missing.md\n", { config, workspace })).toMatchObject([
      { message: "Missing local target: missing.md.", line: 3 },
    ]);
  });
  const workspace = createWorkspace({ "document.md": "" });
});

describe("dialect markers", () => {
  it("leaves unknown GitHub alert types and known Obsidian types alone", () => {
    const github = only({ "github/alert-marker": "warn" }, "github");
    expect(formatted("> [!foo]\n> Text.\n", github)).toBe("> [!foo]\n> Text.\n");
    expect(formatted("> [!tip]\n> Text.\n", github)).toBe("> [!TIP]\n> Text.\n");
    const obsidian = only({ "obsidian/callout-marker": "warn" }, "obsidian");
    expect(formatted("> [!Custom-Type]- Title\n", obsidian)).toBe("> [!custom-type]- Title\n");
    expect(formatted("> [!note]\n", obsidian)).toBe("> [!note]\n");
  });
  it("applies GitHub alert casing to Forgejo documents only among GFM dialects", () => {
    const rules: Record<string, RuleSetting> = { "github/alert-marker": "warn" };
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "forgejo"))).toBe("> [!TIP]\n> Text.\n");
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "commonmark"))).toBe("> [!tip]\n> Text.\n");
  });
  it("applies GitHub alert casing to Gitea documents", () => {
    const rules: Record<string, RuleSetting> = { "github/alert-marker": "warn" };
    expect(formatted("> [!tip]\n> Text.\n", only(rules, "gitea"))).toBe("> [!TIP]\n> Text.\n");
  });
  it("provides a Gitea preset with the GitHub rules", () => {
    expect(resolveConfig({ extends: ["gitea"] })).toMatchObject({
      dialect: "gitea",
      rules: {
        "github/task-marker": "warn",
        "github/alert-marker": "warn",
        "style/table": "warn",
        "forgejo/heading-id": "error",
      },
    });
    expect(canonicalDialect("gitea")).toBe("gitea");
  });
  it("provides Forgejo and Codeberg presets and accepts aliases in overrides", () => {
    const rules = {
      "github/task-marker": "warn",
      "github/alert-marker": "warn",
      "style/table": "warn",
      "forgejo/heading-id": "error",
    };
    expect(resolveConfig({ extends: ["forgejo"] })).toMatchObject({ dialect: "forgejo", rules });
    expect(resolveConfig({ extends: ["codeberg"] })).toMatchObject({ dialect: "forgejo", rules });
    expect(resolveConfig({ dialect: "codeberg" }).dialect).toBe("forgejo");
    expect(
      resolveConfig({ overrides: [{ files: ["forge/**"], dialect: "codeberg" }] }, "forge/a.md")
        .dialect,
    ).toBe("forgejo");
    expect(canonicalDialect("codeberg")).toBe("forgejo");
    expect(canonicalDialect("github")).toBe("github");
  });
});

describe("forgejo/heading-id", () => {
  const forges = ["forgejo", "gitea"] as const;
  const findings = (source: string, dialect: Dialect) =>
    lint(source, { config: only({ "forgejo/heading-id": "error" }, dialect) });
  // Rendered on local instances: Forgejo 16.0.5 and Gitea 1.21.11 showed an
  // empty page for each of these documents, Gitea 1.23.8 and 1.25.5 showed the
  // raw source, and Gitea 1.27.3 and 28.0.0 a heading with an empty id.
  it.each(["{id=5}", "{id=true}", "{id=null}", "{id=[1]}", "{id=-1.5e3}", "{#x id=5}"])(
    "reports a heading whose id is %s",
    (block) => {
      for (const dialect of forges) {
        const atx = findings(`# Before\n\n## Version ${block}\n\n## After\n`, dialect);
        expect(atx).toMatchObject([
          { rule: "forgejo/heading-id", severity: "error", line: 3, column: 12 },
        ]);
        expect(atx[0]!.message).toContain("not text");
        expect(atx[0]!.end).toBe(atx[0]!.start + block.length);
        expect(findings(`Version ${block}\n---\n`, dialect)).toHaveLength(1);
        expect(findings(`## Version ## ${block}\n`, dialect)).toHaveLength(1);
        // Gitea before 1.26 also reads a block followed by a closing sequence, and
        // rendered nothing for this one; the range ends with the block.
        const closed = findings(`## Version ${block} ##\n`, dialect);
        expect(closed).toHaveLength(1);
        expect(closed[0]!.end).toBe(closed[0]!.start + block.length);
        const quoted = findings(`> Version ${block}  \n> ---\n`, dialect);
        expect(quoted).toMatchObject([{ line: 1, column: 11 }]);
        expect(quoted[0]!.end).toBe(quoted[0]!.start + block.length);
      }
      for (const dialect of ["github", "commonmark", "obsidian"] as const)
        expect(findings(`## Version ${block}\n`, dialect)).toEqual([]);
    },
  );
  it.each([
    '{id="5"}',
    "{id=word}",
    "{#5}",
    "{.c data-level=5}",
    "{id=5} text",
    "\\{id=5}",
    "{#}",
    '{id=""}',
  ])("does not report %s", (block) => {
    for (const dialect of forges) expect(findings(`## Version ${block}\n`, dialect)).toEqual([]);
  });
  it("is an error in the Forgejo and Gitea presets and reports nothing elsewhere", () => {
    const source = "## Version {id=5}\n";
    for (const preset of ["forgejo", "codeberg", "gitea"]) {
      const result = lint(source, { config: { extends: [preset] } });
      expect(result.map((item) => `${item.rule}:${item.severity}`)).toEqual([
        "forgejo/heading-id:error",
      ]);
    }
    expect(lint(source, { config: { extends: ["github"] } })).toEqual([]);
    // Formatting leaves the heading alone and reports the problem.
    const result = format(source, { config: { extends: ["recommended", "forgejo"] } });
    expect(result.output).toBe(source);
    expect(result.diagnostics.map((item) => item.rule)).toEqual(["forgejo/heading-id"]);
  });
});

describe("engine edits and fingerprints", () => {
  it("applies identical edits from two rules once", () => {
    expect(
      applyEdits("abc", [
        { start: 0, end: 1, text: "x" },
        { start: 0, end: 1, text: "x" },
      ]),
    ).toBe("xbc");
    const rule = {
      kind: "style",
      description: "Use underscores for the first emphasis",
      check: ({ document }: { document: { source: string } }) =>
        document.source.startsWith("*")
          ? [
              { start: 0, message: "Same", edit: { start: 0, end: 1, text: "_" } },
              { start: 2, message: "Same", edit: { start: 2, end: 3, text: "_" } },
            ]
          : [],
    } as const;
    const plugin: Plugin = { name: "twin", rules: { one: rule, two: rule } };
    const result = format("*a*\n", {
      config: only({ "twin/one": "warn", "twin/two": "warn" }),
      plugins: [plugin],
    });
    expect(result.output).toBe("_a_\n");
    expect(result.diagnostics).toEqual([]);
  });
  it("distinguishes embeds from links and canonicalizes their targets", () => {
    const workspace = createWorkspace({ "Doc.md": "", "Note.md": "" }, { dialect: "obsidian" });
    const print = (source: string) =>
      semanticFingerprint(parse(source, "obsidian", "Doc.md"), workspace);
    expect(print("![[Note]]\n")).toBe(print("![[Note.md]]\n"));
    expect(print("![[Note|300]]\n")).not.toBe(print("![[Note]]\n"));
    expect(print("![[Note]]\n")).not.toBe(print("[[Note]]\n"));
    expect(print("![[Note]]\n")).toContain('"type":"embed"');
  });
});

describe("suppression directives at the end of a document", () => {
  const config = only({ "style/emphasis": "warn" });
  it("suppresses a final line without a trailing newline", () => {
    expect(formatted("<!-- mdtools-disable-next-line style/emphasis -->\n*keep*", config)).toBe(
      "<!-- mdtools-disable-next-line style/emphasis -->\n*keep*",
    );
  });
  it("ignores a next-line directive that has no next line", () => {
    expect(formatted("*change*\n<!-- mdtools-disable-next-line style/emphasis -->", config)).toBe(
      "_change_\n<!-- mdtools-disable-next-line style/emphasis -->",
    );
  });
});

describe("Obsidian syntax at the end of a document", () => {
  const config = only({ "style/emphasis": "warn", "links/valid": "error" }, "obsidian");
  const workspace = createWorkspace({ "Doc.md": "" }, { dialect: "obsidian" });
  it.each([
    "%%\n*hidden* [[Missing]]\n%%",
    "%%\n*hidden* [[Missing]]\n",
    "%%\n*hidden* [[Missing]]",
  ])("keeps a block comment ending at EOF intact (%j)", (source) => {
    expect(formatted(source, config, { path: "Doc.md", workspace })).toBe(source);
    expect(lint(source, { config, path: "Doc.md", workspace })).toEqual([]);
  });
  it("excludes comment text from text content", () => {
    expect(textContent(parse("Text %% hidden %% more\n", "obsidian").tree)).toBe("Text  more");
    expect(textContent(parse("[[Note|label]] [[Other]]\n", "obsidian").tree)).toBe("label Other");
    expect(textContent(parse("---\n", "obsidian").tree)).toBe("");
  });
});
