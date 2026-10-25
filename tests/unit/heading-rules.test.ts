import { describe, expect, it } from "vitest";
import { createWorkspace, format, lint } from "../../src/index.js";
import type { Config, Dialect, Plugin, RuleSetting } from "../../src/index.js";
import { only, formatted, refusals } from "../support/rules.js";
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
        expect(refusals(result)).toMatchObject([{ rule: "engine/unsafe-format" }]);
      }
      expect(format(source, { config: config("github"), plugins }).output).toBe(
        source.replaceAll(from, to),
      );
    }
    // The same edit before a block that sets the id is an ordinary marker change.
    const plugins = [swap("*", "_")];
    expect(format("## *Mode* {#m}\n", { config: config("forgejo"), plugins }).output).toBe(
      "## _Mode_ {#m}\n",
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
        expect(refusals(result)).toMatchObject([{ rule: "engine/unsafe-format" }]);
      }
      const github = only({ "closing/sequence": "warn" }, "github");
      expect(format(source, { config: github, plugins: [closing(text)] }).output).toBe(`${text}\n`);
    }
  });
});

describe("Forgejo and Gitea heading anchors under formatting", () => {
  const forges = ["forgejo", "gitea"] as const;
  const markers = { "style/emphasis": "warn", "style/strong": "warn" } as const;
  // Forgejo 16.0.5 and Gitea 1.21.11, 1.23.8, and 1.25.5 build the anchor from
  // the heading's last line as written: `## Emph *star* end` is #emph-star-end
  // and `## Emph _star_ end` is #emph-_star_-end.
  it.each([
    ["## Emph *star* end\n", "## Emph _star_ end\n"],
    ["## Strong __init__ end\n", "## Strong **init** end\n"],
    ["Under *lined*\n===\n", "Under _lined_\n===\n"],
    ["> ## Quoted *star*\n", "> ## Quoted _star_\n"],
  ])("leaves the markers of the heading %j alone", (source, github) => {
    for (const dialect of forges) expect(formatted(source, only(markers, dialect))).toBe(source);
    expect(formatted(source, only(markers, "github"))).toBe(github);
  });
  it.each(forges)("still converts markers that cannot change an anchor on %s", (dialect) => {
    const source = "*Two*\n*lines*\n===\n\n## *Custom* {#id}\n\nA *b* and __c__.\n";
    expect(formatted(source, only(markers, dialect))).toBe(
      "_Two_\n*lines*\n===\n\n## _Custom_ {#id}\n\nA _b_ and **c**.\n",
    );
  });
  it("leaves a link destination in a heading alone", () => {
    const rules: Record<string, RuleSetting> = {
      "links/path": ["warn", { style: "relative", leadingDot: true }],
    };
    const source = "## See [x](y.md) end\n\n## See [x](y.md) {#see}\n\n[y](y.md)\n";
    const workspace = createWorkspace({ "Doc.md": source, "y.md": "" });
    const run = (dialect: Dialect) =>
      formatted(source, only(rules, dialect), { path: "Doc.md", workspace });
    for (const dialect of forges)
      expect(run(dialect)).toBe(
        "## See [x](y.md) end\n\n## See [x](./y.md) {#see}\n\n[y](./y.md)\n",
      );
    expect(run("github")).toBe(
      "## See [x](./y.md) end\n\n## See [x](./y.md) {#see}\n\n[y](./y.md)\n",
    );
  });
  it.each(forges)("keeps every link to a heading valid through the %s preset", (dialect) => {
    const config: Config = { extends: ["recommended", dialect] };
    const source =
      "## Emph *star* end\n\n## Strong __init__ end\n\n[a](#emph-star-end) and [b](#strong-__init__-end) and *c*\n";
    const workspace = createWorkspace({ "Doc.md": source });
    const result = format(source, { config, path: "Doc.md", workspace });
    expect(result.output).toBe(source.replace("*c*", "_c_"));
    expect(result.diagnostics.filter((item) => item.rule !== "style/emphasis")).toEqual([]);
    // The links still resolve against the formatted document itself.
    const after = createWorkspace({ "Doc.md": result.output });
    expect(lint(result.output, { config, path: "Doc.md", workspace: after })).toEqual([]);
  });
  it.each(forges)("formats a quoted list heading's first line on %s", (dialect) => {
    // Rendered: Forgejo 16.0.5 and Gitea 1.25.5 give this heading `#last-keep`,
    // Gitea 28.0.0 `#first-last-keep`; only the last line is left alone.
    const source = "> - *First*\n>   Last *keep*\n>   ===\n\n[a](#last-keep)\n";
    const workspace = createWorkspace({ "Doc.md": source });
    const result = format(source, { config: only(markers, dialect), path: "Doc.md", workspace });
    expect(result.output).toBe("> - _First_\n>   Last *keep*\n>   ===\n\n[a](#last-keep)\n");
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
    expect(
      createWorkspace({ "Doc.md": result.output }).resolve("Doc.md", "#last-keep", dialect)
        .fragmentExists,
    ).toBe(true);
  });
  it.each(forges)("converts a Setext heading with a class block on %s", (dialect) => {
    // The `##` is heading text on both forms: Forgejo renders `#run`, Gitea
    // 1.25 `#run-`, before and after the conversion.
    const config = only({ "style/heading": "warn" }, dialect);
    expect(formatted("Run ## {.a}\n===\n", config)).toBe("# Run \\## {.a}\n");
    for (const source of ["Run ## {.a}\n===\n", "# Run \\## {.a}\n"]) {
      const resolves = (fragment: string, forge: Dialect) =>
        createWorkspace({ "Doc.md": source }).resolve("Doc.md", `#${fragment}`, forge)
          .fragmentExists;
      expect(resolves("run", "forgejo")).toBe(true);
      expect(resolves("run-", "gitea")).toBe(true);
    }
  });

  it("refuses an edit by any rule that changes an anchor", () => {
    const plugin: Plugin = {
      name: "swap",
      rules: {
        stars: {
          kind: "style",
          description: "Replace every asterisk with an underscore",
          check: ({ document }) =>
            [...document.source.matchAll(/\*/g)].map((match) => ({
              start: match.index,
              message: "Swap",
              edit: { start: match.index, end: match.index + 1, text: "_" },
            })),
        },
      },
    };
    const run = (source: string, dialect: Dialect) =>
      format(source, { config: only({ "swap/stars": "warn" }, dialect), plugins: [plugin] });
    for (const dialect of forges) {
      const result = run("## Emph *star* end\n", dialect);
      expect(result.output).toBe("## Emph *star* end\n");
      expect(refusals(result)).toMatchObject([{ rule: "engine/unsafe-format" }]);
      expect(run("*Two*\nlines\n===\n", dialect).output).toBe("_Two_\nlines\n===\n");
    }
    expect(run("## Emph *star* end\n", "github").output).toBe("## Emph _star_ end\n");
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
