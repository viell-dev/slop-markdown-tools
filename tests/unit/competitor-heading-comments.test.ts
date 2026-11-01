import { expect, it } from "vitest";
import { convertConfig, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { ProcessOptions } from "../../src/index.js";

function options(markdownlint: Record<string, unknown>, prettier?: Record<string, unknown>) {
  const report = convertConfig({
    markdownlint: { default: false, ...markdownlint },
    ...(prettier ? { prettier } : {}),
  });
  return { config: report.config, compatibility: report.compatibility };
}
function checked(source: string, settings: ProcessOptions) {
  const result = format(source, settings);
  expect(result.diagnostics.filter((finding) => finding.rule.startsWith("engine/"))).toEqual([]);
  expect(semanticFingerprint(parse(result.output, "github"))).toBe(
    semanticFingerprint(parse(source, "github")),
  );
  expect(format(result.output, settings).output).toBe(result.output);
  return result;
}

// Expected source-check behavior was verified with actual markdownlint 0.42.0.
it.each(["\n", "\r\n"])("does not add MD041 or MD022 findings for comment lines with %j", (eol) => {
  const settings = options({ MD019: true, MD022: true, MD041: true });
  for (const text of [
    "<!-- markdownlint-disable MD019 -->\n#  Title\n<!-- markdownlint-enable MD019 -->\n",
    "<!-- description -->\n# Title\n<!-- end -->\n",
    "<!-- description\nmore -->\n# Title\n<!-- end\nmore -->\n",
    "# Title\n<!-- end -->\ntext\n",
  ]) {
    const source = text.replaceAll("\n", eol);
    expect(lint(source, settings)).toEqual([]);
    expect(checked(source, settings).output).toBe(source);
  }
});

it("points to a wrong-level heading after a comment", () => {
  const source = "<!-- description -->\n## Title\n";
  expect(lint(source, options({ MD041: true }))).toEqual([
    expect.objectContaining({ rule: "structure/initial-heading", line: 2, column: 1 }),
  ]);
});

it.each(["  <!-- note -->", "<!-- bad--->", "<!-- note --> visible"])(
  "retains MD041's first-block reading for %s",
  (line) => {
    expect(lint(`${line}\n# Title\n`, options({ MD041: true }))).toEqual([
      expect.objectContaining({ rule: "structure/initial-heading", line: 1 }),
    ]);
  },
);

it.each(["text <!-- comment -->", "<div></div>"])(
  "still requires heading spacing before visible content %s",
  (line) => {
    const source = `# Title\n${line}\n`;
    const settings = options({ MD022: true });
    expect(lint(source, settings)).toEqual([
      expect.objectContaining({ rule: "style/block-spacing", severity: "error" }),
    ]);
    expect(checked(source, settings).output).toBe(`# Title\n\n${line}\n`);
  },
);

it("counts comment-only lines toward configured heading spacing", () => {
  const settings = options({ MD022: { lines_below: [2] } });
  const source = "# Title\n<!-- first -->\n<!-- second -->\ntext\n";
  expect(lint(source, settings)).toEqual([]);
  expect(checked(source, settings).output).toBe(source);
  expect(lint("# Title\n<!-- first -->\ntext\n", settings)).toHaveLength(1);
});

it.each([">>>", "\t", "   "])(
  "does not treat multiline comment content %j as a blank line",
  (body) => {
    const source = `# Title\n<!-- note\n${body}\nend -->\ntext\n`;
    const settings = options({ MD022: { lines_below: 2 } });
    expect(lint(source, settings)).toEqual([
      expect.objectContaining({ rule: "style/block-spacing", severity: "error" }),
    ]);
    checked(source, settings);
  },
);

it("recognizes quote markers around a comment-only line", () => {
  const source = "> # Title\n> <!-- end -->\n";
  const settings = options({ MD022: true });
  expect(lint(source, settings)).toEqual([]);
  expect(checked(source, settings).output).toBe(source);
});

it("retains an independent Prettier spacing origin at warning severity", () => {
  const source = "# Title\n<!-- end -->\n";
  const settings = options({ MD022: true }, {});
  expect(lint(source, settings)).toEqual([
    expect.objectContaining({ rule: "style/block-spacing", severity: "warn" }),
  ]);
  expect(checked(source, settings).output).toBe("# Title\n\n<!-- end -->\n");
});

it("preserves native initial-heading and block-spacing policies", () => {
  const source = "<!-- description -->\n# Title\n<!-- end -->\n";
  const { config } = options({ MD022: true, MD041: true });
  expect(lint(source, { config }).map((finding) => finding.rule)).toEqual([
    "structure/initial-heading",
    "style/block-spacing",
  ]);
  expect(checked(source, { config }).output).toBe(
    "<!-- description -->\n# Title\n\n<!-- end -->\n",
  );
});

it.each(["\n", "\r\n"])("recognizes complete HTML headings for MD041 with %j", (eol) => {
  const settings = options({ MD041: true });
  for (const text of [
    "<h1>Title</h1>\n",
    "<!-- note -->\n<h1>Title</h1>\n",
    "  <H1 id=title>Title</H1>\n",
    "<h1\n id='title'>Title</h1>\n",
    '<h1 data-note="<h2>">Title</h1>\n',
    "</h1>\n",
    "<h1/>\n",
  ]) {
    const source = text.replaceAll("\n", eol);
    expect(lint(source, settings), source).toEqual([]);
    expect(checked(source, settings).output).toBe(source);
    expect(lint(source, { config: settings.config }).map((finding) => finding.rule)).toEqual([
      "structure/initial-heading",
    ]);
  }
});

it.each([2, 6])("uses the configured HTML heading level %i", (level) => {
  const settings = options({ MD041: { level } });
  expect(lint(`<!-- note -->\n<h${level}>Title</h${level}>\n`, settings)).toEqual([]);
  expect(lint("<!-- note -->\n<h1>Title</h1>\n", settings)).toEqual([
    expect.objectContaining({ rule: "structure/initial-heading", line: 2 }),
  ]);
});

it("selects the first HTML heading after permitted preamble, including a wrong level", () => {
  const settings = options({ MD041: { allow_preamble: true } });
  expect(lint("text\n\n<h1>Title</h1>\n", settings)).toEqual([]);
  expect(lint("<div>text</div>\n\n<h1>Title</h1>\n", settings)).toEqual([]);
  expect(lint("text\n\n<h2>Wrong</h2>\n\n# Later\n", settings)).toEqual([
    expect.objectContaining({ rule: "structure/initial-heading", line: 3 }),
  ]);
  expect(lint("text\n\n<h1>Title</h1>\n", options({ MD041: true }))).toEqual([
    expect.objectContaining({ rule: "structure/initial-heading", line: 1 }),
  ]);
});

it("does not skip an unknown HTML prefix to accept a later HTML heading", () => {
  const source = "<h2 id=>Wrong</h2>\n\n<h1>Later</h1>\n";
  expect(lint(source, options({ MD041: { allow_preamble: true } }))).toEqual([
    expect.objectContaining({ rule: "structure/initial-heading", line: 1 }),
  ]);
});

it.each([
  "<h1",
  "<h1 id=\n",
  "<h1 id=>\n",
  "<h1 / >\n",
  "<h1-more>Title</h1-more>\n",
  "<!-- note --><h1>Title</h1>\n",
  "<div><h1>Title</h1></div>\n",
  "> <h1>Title</h1>\n",
  "- <h1>Title</h1>\n",
  "<h2>First</h2><h1>Second</h1>\n",
])("retains MD041 findings for non-heading or incomplete first blocks: %j", (source) => {
  expect(lint(source, options({ MD041: true }))).toEqual([
    expect.objectContaining({ rule: "structure/initial-heading", line: 1 }),
  ]);
});

it.each(["", "\n\n", "<!-- note -->\n"])(
  "leaves an empty MD041 content scan unreported for %j",
  (source) => {
    const settings = options({ MD041: true });
    expect(lint(source, settings)).toEqual([]);
    expect(checked(source, settings).output).toBe(source);
    expect(lint(source, { config: settings.config })).toHaveLength(1);
  },
);

it.each(["text\n", "<div>Text</div>\n"])(
  "permits a preamble without headings only in MD041 compatibility for %j",
  (source) => {
    const settings = options({ MD041: { allow_preamble: true } });
    expect(lint(source, settings)).toEqual([]);
    expect(lint(source, { config: settings.config })).toHaveLength(1);
  },
);

it("keeps MD041 configuration and suppression comments around HTML headings", () => {
  expect(
    lint(
      '<!-- markdownlint-configure-file {"MD041":{"level":2}} -->\n<h2>Title</h2>\n',
      options({ MD041: true }),
    ),
  ).toEqual([]);
  expect(
    lint("<!-- markdownlint-disable MD041 -->\n<h2>Title</h2>\n", options({ MD041: true })),
  ).toEqual([]);
});

it.each(["\n", "\r\n"])("reports MD022 spacing above attached comments with %j (#849)", (eol) => {
  const source = "text\n<!-- a -->\n# Title\n".replaceAll("\n", eol);
  const settings = options({ MD022: { lines_above: 2 } });
  const findings = lint(source, settings);
  expect(findings).toEqual([
    expect.objectContaining({ rule: "style/block-spacing", line: 3, severity: "error" }),
  ]);
  expect(findings[0]!.message).toContain("before the heading");
  expect(findings[0]!.edit).toBeUndefined();
  expect(Object.getOwnPropertySymbols(findings[0]!)).toEqual([]);
  expect(checked(source, settings).output).toBe(source);
  expect(lint(source, { config: settings.config })).toEqual([]);
  expect(lint(source.replace(`<!-- a -->`, `${eol}<!-- a -->`), settings)).toEqual([]);
});

it.each([
  ["- item\n  # Title\n  text\n", 2],
  ["1. item\n   ## Title\n   text\n", 2],
  ["> - item\n>   # Title\n>   text\n", 2],
  ["- outer\n  - inner\n    # Title\n    text\n", 3],
  ["- ```txt\n  item\n  ```\n  Title\n  -----\n  text\n", 4],
] as const)("reports both MD022 boundaries inside %j (#850)", (text, line) => {
  const settings = options({ MD022: true });
  for (const eol of ["\n", "\r\n"]) {
    const source = text.replaceAll("\n", eol);
    const findings = lint(source, settings);
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.line)).toEqual([line, line]);
    expect(findings.map((finding) => finding.edit)).toEqual([undefined, undefined]);
    expect(findings[0]!.message).toContain("before the heading");
    expect(findings[1]!.message).toContain("after the heading");
    expect(checked(source, settings).output).toBe(source);
    expect(lint(source, { config: settings.config })).toEqual([]);
  }
});

it("keeps a multiline list setext heading together when reporting MD022 below it", () => {
  const source = "- item\n  Title\n  -----\n  text\n";
  const settings = options({ MD022: true });
  const findings = lint(source, settings);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ rule: "style/block-spacing", line: 1 });
  expect(findings[0]!.message).toContain("after the heading");
  expect(checked(source, settings).output).toBe(source);
});

it("counts ordinary blank lines, per-level options and document ends in list headings", () => {
  for (const source of ["- # Title\n", "- item\n\n  # Title\n\n  text\n"])
    expect(lint(source, options({ MD022: true }))).toEqual([]);
  const source = "- item\n  ## Title\n  text\n";
  expect(lint(source, options({ MD022: { lines_above: [2, 0], lines_below: [2, -1] } }))).toEqual(
    [],
  );
  expect(
    lint("- item\n  <!-- a -->\n  ## Title\n", options({ MD022: { lines_above: [2, 1] } })),
  ).toEqual([]);
});

it("excludes front matter from MD022 list spacing unless explicitly included", () => {
  const source = "---\nslug: page\n---\n- # Title\n";
  expect(lint(source, options({ MD022: true }))).toEqual([]);
  expect(lint(source, options({ MD022: { include_front_matter: true } }))).toEqual([
    expect.objectContaining({ rule: "style/block-spacing", line: 4 }),
  ]);
});

it.each([
  "<!-- markdownlint-disable-file MD022 -->\n- item\n  # Title\n  text\n",
  "- item\n  <!-- markdownlint-disable-next-line MD022 -->\n  # Title\n  text\n",
  "- item\n  # Title <!-- markdownlint-disable-line MD022 -->\n  text\n",
])(
  "suppresses source-only MD022 reports without turning them into Prettier warnings: %j",
  (source) => {
    for (const settings of [
      options({ MD022: true }),
      options({ MD022: true }, {}),
      options({}, {}),
    ]) {
      expect(lint(source, settings)).toEqual([]);
      expect(checked(source, settings).output).toBe(source);
    }
  },
);

it("retains independent Prettier spacing when an attached-comment MD022 report is suppressed", () => {
  const source = "<!-- markdownlint-disable-file MD022 -->\n\n# Earlier\n<!-- a -->\n# Title\n";
  const settings = options({ MD022: { lines_above: 2 } }, {});
  const findings = lint(source, settings);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ rule: "style/block-spacing", severity: "warn" });
  expect(findings[0]!.edit).toBeDefined();
  expect(checked(source, settings).output).toBe(source.replace("# Earlier\n", "# Earlier\n\n"));
});

it("does not invent a Prettier spacing requirement before a comment attached to a heading", () => {
  const source = "<!-- markdownlint-disable-file MD022 -->\n\ntext\n<!-- a -->\n# Title\n";
  const settings = options({ MD022: { lines_above: 2 } }, {});
  expect(lint(source, settings)).toEqual([]);
  expect(checked(source, settings).output).toBe(source);
});
