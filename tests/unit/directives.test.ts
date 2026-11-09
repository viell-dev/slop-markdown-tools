import { expect, it } from "vitest";
import { format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect, Plugin } from "../../src/index.js";
import { directives } from "../../src/core/directives.js";
import { walk } from "../../src/syntax/walk.js";

const config: Config = {
  extends: [],
  rules: { "style/emphasis": "warn", "style/strong": "warn" },
};

it.each(["\n", "\r\n", "\r"])(
  "reads adjacent suppression comments separately with %j (#927)",
  (newline) => {
    const sections = [
      "<!-- ordinary --> <!-- mdrefine-disable style/emphasis -->",
      "",
      "*keep*",
      "",
      "<!-- mdrefine-enable style/emphasis --><!-- mdrefine-disable style/strong -->",
      "",
      "*change* __keep__",
      "",
      "<!-- mdrefine-enable --><!-- ordinary -->",
      "",
      "*last* __last__",
      "",
    ];
    const source = sections.join(newline);
    const expected = source
      .replace("*change*", "_change_")
      .replace("*last* __last__", "_last_ **last**");
    expect(format(source, { config }).output).toBe(expected);
    expect(lint(source, { config })).toHaveLength(6);
    expect(format(expected, { config }).changed).toBe(false);
    expect(semanticFingerprint(parse(expected, "commonmark"))).toBe(
      semanticFingerprint(parse(source, "commonmark")),
    );
  },
);

it.each(["", "> ", "- "])(
  "keeps the exact next line after adjacent comments in %j (#927)",
  (prefix) => {
    const continuation = prefix === "- " ? "  " : prefix;
    const source = `${prefix}<!-- ordinary --> <!-- mdrefine-disable-next-line style/emphasis -->\r\n${continuation}# *keep*\n\n*change*\n`;
    const settings: Config = {
      extends: [],
      rules: { "style/emphasis": "warn", "style/block-spacing": "warn" },
    };
    const result = format(source, { config: settings });
    expect(result.output).toBe(source.replace("*change*", "_change_"));
    expect(format(result.output, { config: settings }).changed).toBe(false);
  },
);

it.each([
  "`<!-- mdrefine-disable -->`",
  "```html\n<!-- mdrefine-disable -->\n```",
  '<div title="<!-- mdrefine-disable -->">text</div>',
  "<script><!-- mdrefine-disable --></script>",
  "<style><!-- mdrefine-disable --></style>",
  "<textarea><!-- mdrefine-disable --></textarea>",
  "<pre><!-- mdrefine-disable --></pre>",
])("does not interpret comment-like code or attribute text in %s (#927)", (example) => {
  const source = `${example}\n\n*change*\n`;
  expect(format(source, { config }).output).toBe(source.replace("*change*", "_change_"));
});

it("maps multiline directives back through container prefixes and mixed line endings (#927)", () => {
  const source =
    "> <!-- mdrefine-disable\r\n> style/emphasis --> <!-- mdrefine-enable style/emphasis -->\r\n> *change*\n";
  const found = directives(parse(source, "commonmark"));
  expect(found.map(({ start, end }) => source.slice(start, end))).toEqual([
    "<!-- mdrefine-disable\r\n> style/emphasis -->",
    "<!-- mdrefine-enable style/emphasis -->",
  ]);
  expect(found.map(({ kind, rules }) => [kind, [...rules]])).toEqual([
    ["disable", ["style/emphasis"]],
    ["enable", ["style/emphasis"]],
  ]);
});

it("does not combine partial HTML with a following paragraph into a directive (#927)", () => {
  const source =
    "> <!-- ordinary --> <!-- mdrefine-disable\r\n> style/emphasis --> <!-- mdrefine-enable style/emphasis -->\r\n> *change*\n";
  // CommonMark ends the HTML block on the first line. The apparent disable
  // continues as paragraph text, not as a complete parsed HTML comment.
  expect(directives(parse(source, "commonmark")).map(({ kind }) => kind)).toEqual(["enable"]);
});

it("handles inline transitions at exact source positions (#927)", () => {
  const source =
    "*before* <!-- mdrefine-disable style/emphasis -->*keep*<!-- mdrefine-enable style/emphasis --> *after*\n";
  expect(format(source, { config }).output).toBe(
    source.replace("*before*", "_before_").replace("*after*", "_after_"),
  );
});

it("recognizes real comments between HTML elements (#927)", () => {
  const source = '<div title="<!-- ordinary -->"><!-- mdrefine-disable --></div>\n\n*keep*\n';
  expect(format(source, { config }).output).toBe(source);
  expect(lint(source, { config })).toEqual([]);
});

it("ignores comments inside a raw-text block and resumes after its closing tag (#927)", () => {
  const source =
    "<textarea>\n\n<!-- mdrefine-disable -->\n\n</textarea>\n\n<!-- ordinary --> <!-- mdrefine-disable-next-line -->\n*keep*\n\n*change*\n";
  const found = directives(parse(source, "commonmark"));
  expect(found.map(({ kind }) => kind)).toEqual(["disable-next-line"]);
  expect(format(source, { config }).output).toBe(source.replace("*change*", "_change_"));
});

it("tolerates plugin HTML without source positions when prose contains a directive prefix (#927)", () => {
  const plugin: Plugin = {
    name: "unlocated-html",
    syntax: {
      micromark: {},
      mdast: {
        transforms: [
          (tree) =>
            walk(tree, "html", (node) => {
              delete node.position;
            }),
        ],
      },
    },
  };
  const source = "<div>x</div>\n\n*a* mdrefine-disable is a comment prefix\n";
  const options = { plugins: [plugin], config };
  const result = format(source, options);
  expect(result.output).toBe(source.replace("*a*", "_a_"));
  expect(result.diagnostics).toEqual([]);
  expect(lint(source, options)).toHaveLength(2);
});

it.each<[Dialect, string]>([
  ["commonmark", "Use <code>x<code> here.\n\n<!-- mdrefine-disable style/emphasis -->\n\n*keep*\n"],
  ["commonmark", "- <pre>\n  code\n\n<!-- mdrefine-disable -->\n\n*keep*\n"],
  ["commonmark", "<code>a `` `</code>` `` b\n\n<!-- mdrefine-disable -->\n\n*keep*\n"],
  ["vitepress", "<Title />\n\n<!-- mdrefine-disable -->\n\n*keep*\n"],
  ["commonmark", "<code>\n\n<!-- mdrefine-disable -->\n\n*keep*\n\n</code>\n"],
])("does not let a separate %s HTML node hide later directives: %s (#927)", (dialect, source) => {
  expect(directives(parse(source, dialect))).toHaveLength(1);
  expect(format(source, { config: { ...config, dialect } }).output).toBe(source);
});

it("keeps next-line spacing when the directive shares HTML with a tag (#927)", () => {
  const html = "<!-- mdrefine-disable-next-line style/emphasis --> <b>x</b>";
  const source = `${html}\n# *keep*\n`;
  const options = {
    config: { ...config, rules: { ...config.rules, "style/block-spacing": "warn" } },
  } as const;
  expect(format(source, options).output).toBe(source);
  const control = "<!-- ordinary --> <b>x</b>\n# *change*\n";
  expect(format(control, options).output).toBe("<!-- ordinary --> <b>x</b>\n\n# _change_\n");
});

it("does not recognize directive-like attributes in namespaced HTML tags (#927)", () => {
  const source = '<div>\n<o:p title="<!-- mdrefine-disable -->">\n</div>\n\n*change*\n';
  expect(directives(parse(source, "commonmark"))).toEqual([]);
  expect(format(source, { config }).output).toBe(source.replace("*change*", "_change_"));
});

it("honors an enable immediately following its disable (#927)", () => {
  const source =
    "<!-- mdrefine-disable style/emphasis --><!-- mdrefine-enable style/emphasis -->\n\n*change*\n";
  expect(format(source, { config }).output).toBe(source.replace("*change*", "_change_"));
  expect(lint(source, { config })).toHaveLength(2);
});

it.each([
  "Write `<!-- mdrefine-disable -->` to disable rules.\n<MyComponent />\n\n*change*\n",
  "Write `<!-- mdrefine-disable -->` to disable rules.\n<my-component />\n\n*change*\n",
  "- Example:\n\n  ```md\n  <!-- mdrefine-disable -->\n  ```\n\n- Last item\n<MyComponent />\n\n*change*\n",
])("does not turn projected VitePress code examples into directives: %s (#927)", (source) => {
  const settings = { config: { ...config, dialect: "vitepress" as const } };
  expect(directives(parse(source, "vitepress"))).toEqual([]);
  expect(format(source, settings).output).toBe(source.replace("*change*", "_change_"));
  expect(format(format(source, settings).output, settings).changed).toBe(false);
  expect(directives(parse(source, "commonmark"))).toEqual([]);
  const separated = source.replace(/\n(<(?:MyComponent|my-component) \/>)/, "\n\n$1");
  expect(directives(parse(separated, "vitepress"))).toEqual([]);
});

it("does not read projected VitePress math as HTML comments (#927)", () => {
  const source = "$$\n<!-- mdrefine-disable -->\n$$\n\n*change*\n";
  expect(directives(parse(source, "vitepress", "document.md", [], { math: true }))).toEqual([]);
});

it("skips plugin HTML values whose source line mapping no longer matches (#927)", () => {
  const plugin: Plugin = {
    name: "rewritten-html",
    syntax: {
      micromark: {},
      mdast: {
        transforms: [
          (tree) =>
            walk(tree, "html", (node) => {
              node.value = "<div>\n\n\n" + node.value + "\n</div>";
            }),
        ],
      },
    },
  };
  const source = "*first*\n*second*\n\n<!-- mdrefine-disable-next-line -->\n*keep*\n\n*third*\n";
  expect(directives(parse(source, "commonmark", "document.md", [plugin]))).toEqual([]);
  expect(format(source, { config, plugins: [plugin] }).output).toBe(source.replaceAll("*", "_"));
});

it.each(["commonmark", "github", "forgejo", "gitea", "obsidian", "vitepress"] as const)(
  "maps partially consumed indentation tabs in %s directives (#927)",
  (dialect) => {
    const cases = [
      "- item\n\n\t<!-- mdrefine-disable-next-line -->\n\t*keep*\n\n*change*\n",
      "1. item\n\n\t<!-- mdrefine-disable -->\n\n*keep*\n",
      "- item\n\n\t<!-- ordinary --> <!-- mdrefine-disable-next-line -->\n\t*keep*\n\n*change*\n",
      "- item\n\n\t<!-- mdrefine-disable-next-line\n\tstyle/emphasis -->\n\t*keep*\n\n*change*\n",
    ];
    for (const source of cases) {
      const found = directives(parse(source, dialect));
      expect(found, source).toHaveLength(1);
      expect(source.slice(found[0]!.start, found[0]!.end)).toMatch(/^<!--[\s\S]*-->$/);
      const settings = { config: { ...config, dialect } };
      const result = format(source, settings);
      expect(result.output).toBe(source.replace("*change*", "_change_"));
      expect(format(result.output, settings).changed).toBe(false);
    }
  },
);

it.each([
  ["commonmark", true],
  ["github", true],
  ["forgejo", true],
  ["gitea", true],
  ["obsidian", true],
  ["vitepress", false],
] as const)("preserves the %s reading of a tabbed quote directive (#927)", (dialect, active) => {
  const source = ">\t<!-- mdrefine-disable -->\n\n*keep*\n";
  // VitePress already projects this entire quote as opaque Markdown; the
  // other dialects retain a real parsed comment. Keep both baseline readings.
  expect(directives(parse(source, dialect))).toHaveLength(active ? 1 : 0);
  expect(format(source, { config: { ...config, dialect } }).output).toBe(
    active ? source : source.replace("*keep*", "_keep_"),
  );
});

it("rejects plugin HTML with different text on the same source lines (#927)", () => {
  const plugin: Plugin = {
    name: "rewritten-comment",
    syntax: {
      micromark: {},
      mdast: {
        transforms: [
          (tree) =>
            walk(tree, "html", (node) => {
              node.value = node.value.replace("disable", "enable ");
            }),
        ],
      },
    },
  };
  const source = "<!-- mdrefine-disable -->\n\n*change*\n";
  expect(directives(parse(source, "commonmark", "document.md", [plugin]))).toEqual([]);
  expect(format(source, { config, plugins: [plugin] }).output).toBe(
    source.replace("*change*", "_change_"),
  );
});

it("applies mdrefine suppression regions and the next-line fast path", () => {
  const source = "<!-- mdrefine-disable -->\n\n*one*\n\n<!-- mdrefine-enable -->\n\n*two*\n";
  expect(format(source, { config }).output).toBe(source.replace("*two*", "_two_"));
  const next = "Text <!-- mdrefine-disable-next-line style/emphasis -->\n# *one*\n";
  const settings: Config = {
    extends: [],
    rules: {
      "style/emphasis": "error",
      "style/block-spacing": "warn",
    },
  };
  const result = format(next, { config: settings });
  expect(result.output).toBe(next);
  expect(result.diagnostics).toEqual([]);
  expect(format(result.output, { config: settings }).output).toBe(result.output);
});

it.each(["disable", "disable-next-line"])(
  "treats retired mdtools-%s as an ordinary comment",
  (kind) => {
    const source = `<!-- mdtools-${kind} style/emphasis -->\n*one*\n`;
    expect(format(source, { config }).output).toBe(source.replace("*one*", "_one_"));
    expect(lint(source, { config })).toHaveLength(2);
  },
);

it("does not let a retired enable comment end a current suppression region", () => {
  const source = "<!-- mdrefine-disable -->\n\n*one*\n\n<!-- mdtools-enable -->\n\n*two*\n";
  expect(format(source, { config }).output).toBe(source);
  expect(lint(source, { config })).toEqual([]);
});

it("does not preserve next-line directive spacing for retired comments", () => {
  const source = "Text <!-- mdtools-disable-next-line style/emphasis -->\n# *one*\n";
  const options = {
    config: { extends: [], rules: { "style/emphasis": "error", "style/block-spacing": "warn" } },
  } as const;
  expect(format(source, options).output).toBe(
    source.replace("-->\n", "-->\n\n").replace("*one*", "_one_"),
  );
});

it.each(["\n", "\r\n", "\r"])(
  "applies named and all-rule transitions in source order with %j (#456)",
  (newline) => {
    const sections = [
      ["Before *one* and __two__.", "Before _one_ and **two**."],
      ["<!-- mdrefine-disable -->"],
      ["A *one* and __two__."],
      ["<!-- mdrefine-enable style/emphasis -->"],
      ["B *one* and __two__.", "B _one_ and __two__."],
      ["<!-- mdrefine-disable style/emphasis -->"],
      ["C *one* and __two__."],
      ["<!-- mdrefine-enable -->"],
      ["D *one* and __two__.", "D _one_ and **two**."],
      ["<!-- mdrefine-disable -->"],
      ["E *one* and __two__."],
      ["<!-- mdrefine-enable style/emphasis, style/strong -->"],
      ["F *one* and __two__.", "F _one_ and **two**."],
      ["<!-- mdrefine-disable -->"],
      ["G *one* and __two__."],
      ["<!-- mdrefine-enable style/emphasis -->"],
      ["<!-- mdrefine-enable style/emphasis -->"],
      ["H *one* and __two__.", "H _one_ and __two__."],
    ];
    const source = sections.map(([before]) => before).join(newline + newline) + newline;
    const expected =
      sections.map(([before, after]) => after ?? before).join(newline + newline) + newline;
    const findings = lint(source, { config });
    expect(findings.filter((finding) => finding.rule === "style/emphasis")).toHaveLength(10);
    expect(findings.filter((finding) => finding.rule === "style/strong")).toHaveLength(6);
    const result = format(source, { config });
    expect(result.output).toBe(expected);
    expect(result.diagnostics).toEqual([]);
    expect(format(result.output, { config }).changed).toBe(false);
    expect(semanticFingerprint(parse(result.output, "commonmark"))).toBe(
      semanticFingerprint(parse(source, "commonmark")),
    );
    expect(format(source, { config: { extends: [] } }).output).toBe(source);
  },
);

it("keeps next-line suppression independent of region enables", () => {
  const source = [
    "<!-- mdrefine-disable -->",
    "<!-- mdrefine-enable style/emphasis -->",
    "<!-- mdrefine-disable-next-line -->",
    "A *one* and __two__.",
    "",
    "B *one* and __two__.",
    "",
    "<!-- mdrefine-enable -->",
    "<!-- mdrefine-disable-next-line style/emphasis -->",
    "C *one* and __two__.",
    "",
    "D *one* and __two__.",
    "",
  ].join("\n");
  const expected = source
    .replaceAll("B *one*", "B _one_")
    .replaceAll("C *one* and __two__", "C *one* and **two**")
    .replaceAll("D *one* and __two__", "D _one_ and **two**");
  expect(format(source, { config }).output).toBe(expected);
  expect(format(expected, { config }).changed).toBe(false);
  expect(lint(source, { config })).toHaveLength(8);
});

it("does not enable a rule disabled by configuration", () => {
  const source = "<!-- mdrefine-disable -->\n\n<!-- mdrefine-enable -->\n\n*one* __two__\n";
  const options = {
    config: { ...config, rules: { ...config.rules, "style/emphasis": "off" as const } },
  };
  expect(format(source, options).output).toContain("*one* **two**");
  expect(lint(source, options).map((item) => item.rule)).toEqual(["style/strong", "style/strong"]);
});

it("still suppresses an edit that reaches across a disabled region", () => {
  const source =
    "<!-- mdrefine-disable -->\n\n*one*\n\n<!-- mdrefine-enable local/span -->\n\n*two*\n";
  const plugin: Plugin = {
    name: "local",
    rules: {
      span: {
        kind: "style",
        description: "Edit across a suppression boundary",
        check: () => [
          {
            start: 0,
            message: "Whole document",
            edit: { start: 0, end: source.length, text: source.replaceAll("*", "_") },
          },
        ],
      },
    },
  };
  const options = {
    config: { extends: [], rules: { "local/span": "warn" as const } },
    plugins: [plugin],
  };
  expect(lint(source, options)).toEqual([]);
  expect(format(source, options).output).toBe(source);
});
