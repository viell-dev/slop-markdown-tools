import { expect, it } from "vitest";
import { convertConfig, format, lint, type Plugin } from "../../src/index.js";

const opts = (markdownlint: Record<string, unknown>, prettier?: Record<string, unknown>) => {
  const r = convertConfig({
    markdownlint: { default: false, ...markdownlint },
    ...(prettier ? { prettier } : {}),
  });
  return { config: r.config, compatibility: r.compatibility };
};
it.each([
  [{ MD003: { style: "atx" }, MD019: true }, "MD019", "#  Heading\n", "# Heading\n"],
  [{ MD003: { style: "atx" }, MD023: true }, "MD023", "  # Heading\n", "# Heading\n"],
  [{ MD003: { style: "atx_closed" }, MD021: true }, "MD021", "# Heading  #\n", "# Heading #\n"],
  [{ MD005: true, MD030: true }, "MD030", "-   one\n", "- one\n"],
  [
    { MD055: { style: "leading_and_trailing" }, MD060: { style: "aligned" } },
    "MD060",
    "| a | b |\n| --- | --- |\n| x | y |\n",
    "| a   | b   |\n| --- | --- |\n| x   | y   |\n",
  ],
] as const)(
  "round4 suppresses only the attributed behavior %s %s",
  (checks, disabled, body, repaired) => {
    for (const newline of ["\n", "\r\n"]) {
      const prefix = `<!-- markdownlint-disable ${disabled} -->\n\n`;
      const middle = `\n<!-- markdownlint-enable ${disabled} -->\n\n`;
      const source = (prefix + body + middle + body).replaceAll("\n", newline);
      const o = opts(checks);
      const result = format(source, o);
      expect(result.output).toBe((prefix + body + middle + repaired).replaceAll("\n", newline));
      expect(
        lint(source, o).every(
          (d) => d.start >= (prefix + body + middle).replaceAll("\n", newline).length,
        ),
      ).toBe(true);
      expect(format(result.output, o).output).toBe(result.output);
      expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
    }
  },
);
it.each([undefined, {}])("round4 holds a table edit across changing regions %j", (prettier) => {
  const o = opts(
    { MD055: { style: "no_leading_or_trailing" }, MD060: { style: "aligned" } },
    prettier,
  );
  for (const directive of [
    "disable MD055",
    "disable-line MD055",
    "disable MD055 MD060",
    "disable-line MD055 MD060",
  ]) {
    const source = `| a | b |\n| --- | --- |\n| x <!-- markdownlint-${directive} --> | y |\n| z | w |\n`;
    const result = format(source, o);
    expect(result.output).toBe(source);
    expect(lint(source, o).length).toBeGreaterThan(0);
    expect(lint(source, o).every((d) => !d.edit)).toBe(true);
  }
});
it("round4 retains active body diagnostics below a suppressed table header", () => {
  const source =
    "| a <!-- markdownlint-disable-line MD055 MD060 --> | b |\n| --- | --- |\n| x | y |\n";
  const o = opts({ MD055: { style: "no_leading_or_trailing" }, MD060: { style: "aligned" } });
  const diagnostics = lint(source, o);
  expect(diagnostics.length).toBeGreaterThan(0);
  expect(diagnostics.every((d) => d.line >= 2 && !d.edit)).toBe(true);
  expect(format(source, o).output).toBe(source);
});
it.each([
  [
    { MD003: { style: "atx" } },
    "Title <!-- markdownlint-disable-line MD003 -->\n=====\n",
    "style/heading",
  ],
  [
    { MD003: { style: "atx" } },
    "<!-- markdownlint-disable-next-line MD003 -->\nTitle\n=====\n",
    "style/heading",
  ],
  [
    { MD005: true, MD030: true },
    "-   one\n-   two <!-- markdownlint-disable-line MD030 -->\n",
    "style/list-indent",
  ],
  [
    { MD005: true, MD030: true },
    "-   one\n    <!-- markdownlint-disable-next-line MD030 -->\n-   two\n",
    "style/list-indent",
  ],
] as const)("round4 holds spanning heading/list proposals %s %s", (checks, source, rule) => {
  const o = opts(checks);
  expect(format(source, { config: o.config }).output).not.toBe(source);
  expect(format(source, o).output).toBe(source);
  expect(
    lint(source, o)
      .filter((d) => d.rule === rule)
      .every((d) => !d.edit),
  ).toBe(true);
});
it.each(["disable-line MD013", "disable-next-line MD013", "disable MD013"])(
  "round4 holds paragraph edits crossing %s",
  (directive) => {
    const source = `one two three four five six seven eight\ntext <!-- markdownlint-${directive} -->\nmore words on another long line\n`;
    const o = opts({ MD013: { line_length: 20 } });
    // Built-in wrapping intentionally holds paragraphs with inline HTML. A
    // synthetic paragraph rule exercises the same engine boundary contract.
    const plugins: Plugin[] = [
      {
        name: "test",
        rules: {
          paragraph: {
            kind: "style",
            description: "Normalize paragraph whitespace",
            phase: "block",
            check: ({ document }) => [
              {
                start: 0,
                end: document.source.length,
                message: "Normalize paragraph whitespace.",
                edit: {
                  start: 0,
                  end: document.source.length,
                  text: document.source.replace("one two", "one  two"),
                },
              },
            ],
          },
        },
      },
    ];
    const runOptions = {
      ...o,
      plugins,
      config: {
        ...o.config,
        rules: { ...o.config.rules, "test/paragraph": "error" as const },
      },
    };
    runOptions.compatibility.origins["test/paragraph"] = ["MD013"];
    expect(format(source, { config: runOptions.config, plugins }).output).not.toBe(source);
    const findings = lint(source, runOptions).filter((d) => d.rule === "test/paragraph");
    expect(findings.length).toBeGreaterThan(0);
    expect(format(source, runOptions).output).toBe(source);
    expect(
      lint(source, runOptions)
        .filter((d) => d.rule === "test/paragraph")
        .every((d) => !d.edit),
    ).toBe(true);
  },
);

it("round4 withholds a heading conversion that also normalizes suppressed spacing", () => {
  const source = "<!-- markdownlint-disable MD019 -->\n\n#  Heading\n";
  const o = opts({ MD003: { style: "setext" }, MD019: true });
  expect(lint(source, o).some((d) => d.rule === "style/heading" && !d.edit)).toBe(true);
  expect(format(source, o).output).toBe(source);
});

it("round4 locates active table rows with mixed line endings", () => {
  const source =
    "| a <!-- markdownlint-disable-line MD055 MD060 --> | b |\r\n| --- | --- |\n| x | y |\r\n";
  const o = opts({ MD055: { style: "no_leading_or_trailing" }, MD060: { style: "aligned" } });
  const diagnostics = lint(source, o);
  expect(diagnostics.map((d) => d.line)).toEqual([2, 3]);
  expect(diagnostics.every((d) => !d.edit)).toBe(true);
  expect(format(source, o).output).toBe(source);
});

it("round4 retains nested peer consistency when MD007 is suppressed", () => {
  const source = "<!-- markdownlint-disable MD007 -->\n\n- parent\n   - first\n  - second\n";
  const o = opts({ MD005: true, MD007: { indent: 2 } });
  expect(lint(source, o).some((d) => d.rule === "style/list-indent" && !d.edit)).toBe(true);
  expect(format(source, o).output).toBe(source);
});

it("round4 attributes edge-cell padding combined with pipe changes", () => {
  const source =
    "<!-- markdownlint-disable MD060 -->\n\n|  a  |  b  |\n| --- | --- |\n|  x  |  y  |\n";
  const o = opts({ MD055: { style: "no_leading_or_trailing" }, MD060: { style: "aligned" } });
  expect(lint(source, o).some((d) => d.rule === "style/table" && !d.edit)).toBe(true);
  expect(format(source, o).output).toBe(source);
});
