import { expect, it } from "vitest";
import { format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Plugin } from "../../src/index.js";

const config: Config = {
  extends: [],
  rules: { "style/emphasis": "warn", "style/strong": "warn" },
};

it.each(["\n", "\r\n", "\r"])(
  "applies named and all-rule transitions in source order with %j (#456)",
  (newline) => {
    const sections = [
      ["Before *one* and __two__.", "Before _one_ and **two**."],
      ["<!-- mdtools-disable -->"],
      ["A *one* and __two__."],
      ["<!-- mdtools-enable style/emphasis -->"],
      ["B *one* and __two__.", "B _one_ and __two__."],
      ["<!-- mdtools-disable style/emphasis -->"],
      ["C *one* and __two__."],
      ["<!-- mdtools-enable -->"],
      ["D *one* and __two__.", "D _one_ and **two**."],
      ["<!-- mdtools-disable -->"],
      ["E *one* and __two__."],
      ["<!-- mdtools-enable style/emphasis, style/strong -->"],
      ["F *one* and __two__.", "F _one_ and **two**."],
      ["<!-- mdtools-disable -->"],
      ["G *one* and __two__."],
      ["<!-- mdtools-enable style/emphasis -->"],
      ["<!-- mdtools-enable style/emphasis -->"],
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
    "<!-- mdtools-disable -->",
    "<!-- mdtools-enable style/emphasis -->",
    "<!-- mdtools-disable-next-line -->",
    "A *one* and __two__.",
    "",
    "B *one* and __two__.",
    "",
    "<!-- mdtools-enable -->",
    "<!-- mdtools-disable-next-line style/emphasis -->",
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
  const source = "<!-- mdtools-disable -->\n\n<!-- mdtools-enable -->\n\n*one* __two__\n";
  const options = {
    config: { ...config, rules: { ...config.rules, "style/emphasis": "off" as const } },
  };
  expect(format(source, options).output).toContain("*one* **two**");
  expect(lint(source, options).map((item) => item.rule)).toEqual(["style/strong", "style/strong"]);
});

it("still suppresses an edit that reaches across a disabled region", () => {
  const source =
    "<!-- mdtools-disable -->\n\n*one*\n\n<!-- mdtools-enable local/span -->\n\n*two*\n";
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
