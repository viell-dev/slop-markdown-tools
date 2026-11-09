import { expect, it } from "vitest";
import { builtInRules, convertConfig, format, lint, parse, type Plugin } from "../../src/index.js";
import { compatibilityOptions as options } from "../support/competitors.js";

it.each(["MD022", "MD031", "MD032", "MD058"])("shared spacing isolates %s", (disabled) => {
  const o = options({
    markdownlint: { default: false, MD022: true, MD031: true, MD032: true, MD058: true },
  });
  const blocks = {
    MD022: "text\n# Heading\ntext\n",
    MD031: "text\n```js\nx\n```\ntext\n",
    MD032: "text\n- item\n",
    MD058: "a | b\n--- | ---\nx | y\n> quote\n",
  };
  const source =
    `<!-- markdownlint-disable ${disabled} -->\n\n` + blocks[disabled as keyof typeof blocks];
  const findings = lint(source, o).filter((d) => d.rule === "style/block-spacing");
  expect(
    findings.some((d) =>
      d.message.includes(
        {
          MD022: "the heading",
          MD031: "the fenced code block",
          MD032: "the list",
          MD058: "the table",
        }[disabled]!,
      ),
    ),
  ).toBe(false);
  expect(format(source, o).output).toBe(source);
});

it.each([
  ["MD049", { style: "asterisk" }, "_one_\n", "*one*\n"],
  ["MD050", { style: "underscore" }, "**one**\n", "__one__\n"],
  ["MD004", { style: "plus" }, "- one\n", "+ one\n"],
  ["MD003", { style: "atx_closed" }, "# One\n", "# One #\n"],
  ["MD029", { style: "ordered" }, "1. one\n1. two\n", "1. one\n2. two\n"],
  ["MD048", { style: "tilde" }, "```js\nx\n```\n", "~~~js\nx\n~~~\n"],
  ["MD035", { style: "***" }, "---\n", "***\n"],
  ["MD009", { br_spaces: 3 }, "one  \ntwo\n", "one   \ntwo\n"],
  ["MD012", { maximum: 2 }, "one\n\n\ntwo\n", "one\n\n\ntwo\n"],
] as const)("suppressed options use Prettier for %s", (id, setting, source, active) => {
  const o = options({ prettier: {}, markdownlint: { default: false, [id]: setting } });
  const directive = `<!-- markdownlint-disable ${id} -->\n\n`;
  const expected = format(directive + source, options({ prettier: {} })).output;
  expect(format(directive + source, o).output).toBe(expected);
  expect(format(source, o).output).toBe(active);
  expect(format(expected, o).output).toBe(expected);
});

it.each([
  [{ MD003: true, MD019: true }, "MD003", "#  Heading\n"],
  [{ MD005: true, MD030: true }, "MD030", "-   one\n"],
  [{ MD055: true, MD060: { style: "aligned" } }, "MD055", "a|b\n---|---\nx|y\n"],
] as const)("reconverts shared checks %j", (checks, disabled, body) => {
  const o = options({ markdownlint: { default: false, ...checks } });
  const source = `<!-- markdownlint-disable ${disabled} -->\n\n${body}`;
  const surviving = options({ markdownlint: { default: false, ...checks, [disabled]: false } });
  expect(format(source, o).output).toBe(format(source, surviving).output);
  expect(format(body, o).output).not.toBe(body);
});

it.each([
  ["MD022", { lines_above: 2 }, "text\n# One\n"],
  ["MD030", { ul_single: 3 }, "-   one\n"],
  ["MD007", { start_indented: true }, "- one\n"],
  ["MD055", { style: "no_leading_or_trailing" }, "| a | b |\n| --- | --- |\n| x | y |\n"],
  ["MD060", { style: "tight" }, "| a | b |\n| --- | --- |\n| x | y |\n"],
] as const)("additional conflicting options %s", (id, setting, body) => {
  const o = options({ prettier: {}, markdownlint: { default: false, [id]: setting } });
  const p = options({ prettier: {} });
  const source = `<!-- markdownlint-disable ${id} -->\n\n${body}`;
  expect(format(source, o).output).toBe(format(source, p).output);
  expect(format(body, o).output).not.toBe(format(body, p).output);
});

it("agreeing options retain shared behavior", () => {
  const source = "<!-- markdownlint-disable MD049 -->\n\n*one*\n";
  const o = options({
    prettier: {},
    markdownlint: { default: false, MD049: { style: "underscore" } },
  });
  expect(format(source, o).output).toContain("_one_");
});

it.each(["MD018", "MD020"])("unspaced headings attribute %s separately", (disabled) => {
  const o = options({ markdownlint: { default: false, MD018: true, MD020: true } });
  const source = `<!-- markdownlint-disable ${disabled} -->\n\n#One\n\n#Two#\n`;
  const findings = lint(source, o);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.message.includes("add spaces inside the hashes")).toBe(disabled === "MD018");
});

it("keeps compatibility internals out of plugin options and of rules called directly", () => {
  // Attribution and the compatibility marker are internal: a plugin's options
  // and a built-in rule's findings show no extra keys, symbols included.
  const r = convertConfig({ prettier: {} });
  const seen: (string | symbol)[][] = [];
  const plugins: Plugin[] = [
    {
      name: "probe",
      rules: {
        demo: {
          kind: "style",
          phase: "block",
          description: "Record options",
          check: ({ options }) => {
            seen.push(Reflect.ownKeys(options));
            return [];
          },
        },
      },
    },
  ];
  const rules = { ...r.config.rules, "probe/demo": "warn" as const };
  lint("text\n", { config: { ...r.config, rules }, compatibility: r.compatibility, plugins });
  expect(seen.length).toBeGreaterThan(0);
  for (const keys of seen) expect(keys).toEqual([]);
  for (const [name, source] of [
    ["style/heading", "#  Heading\n"],
    ["style/list-indent", "-   one\n"],
    ["style/table", "a|b\n---|---\nx|y\n"],
  ] as const) {
    const findings = builtInRules[name]!.check({ document: parse(source, "github"), options: {} });
    expect(Array.isArray(findings) && findings.length, name).toBeTruthy();
    for (const finding of findings as object[])
      expect(
        Reflect.ownKeys(finding).filter((key) => typeof key === "symbol"),
        name,
      ).toEqual([]);
  }
});
