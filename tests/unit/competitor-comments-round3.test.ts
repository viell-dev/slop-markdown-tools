import { expect, it, vi } from "vitest";
import { convertConfig, format, lint, competitorMappings } from "../../src/index.js";
import { competitorComments } from "../../src/core/competitor-comments.js";
import { parse } from "../../src/syntax/parse.js";
const calls = vi.hoisted(() => ({ heading: 0 }));
vi.mock("../../src/rules/style.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/rules/style.js")>();
  const heading = original.styleRules["style/heading"]!;
  return {
    ...original,
    styleRules: {
      ...original.styleRules,
      "style/heading": {
        ...heading,
        check: (context: Parameters<typeof heading.check>[0]) => {
          calls.heading++;
          return heading.check(context);
        },
      },
    },
  };
});

function options(input: Parameters<typeof convertConfig>[0]) {
  const r = convertConfig(input);
  return { config: r.config, compatibility: r.compatibility };
}
it.each([
  [{ MD003: true, MD019: true }, "MD003", "#  Heading\n", "# Heading\n"],
  [{ MD005: true, MD030: true }, "MD005", "-   one\n", "- one\n"],
  [
    { MD055: true, MD060: { style: "aligned" } },
    "MD055",
    "a|b\n---|---\nx|y\n",
    // The combined pipe/padding edit needs suppressed MD055; retain MD060 diagnostics.
    "a|b\n---|---\nx|y\n",
  ],
] as const)(
  "round3 active checks survive a sibling suppression %j",
  (checks, disabled, body, repaired) => {
    for (const eol of ["\n", "\r\n"]) {
      const source = (`<!-- markdownlint-disable ${disabled} -->\n\n` + body).replaceAll("\n", eol);
      const o = options({ markdownlint: { default: false, ...checks } });
      expect(lint(source, o).some((d) => d.severity === "error")).toBe(true);
      const result = format(source, o);
      expect(result.output).toBe(
        source.slice(0, source.indexOf(body.split("\n")[0]!)) + repaired.replaceAll("\n", eol),
      );
      expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
      expect(format(result.output, o).output).toBe(result.output);
    }
  },
);
it.each([undefined, {}])(
  "round3 MD022 dependency follows active checks with Prettier %j",
  (prettier) => {
    for (const maximum of [1, 2])
      for (const disabled of ["MD022", "MD012"]) {
        const o = options({
          ...(prettier ? { prettier } : {}),
          markdownlint: { default: false, MD022: { lines_above: 3 }, MD012: { maximum } },
        });
        const directive = `<!-- markdownlint-disable ${disabled} -->\n\n`;
        const source = directive + "one\n\n\n\ntwo\n";
        const result = format(source, o);
        expect(result.output).toBe(
          directive + "one\n" + "\n".repeat(disabled === "MD022" ? maximum : 3) + "two\n",
        );
        expect(format(result.output, o).output).toBe(result.output);
        if (disabled === "MD022") expect(lint(source, o).length).toBeGreaterThan(0);
      }
  },
);
const groups = [
  [
    { MD003: { style: "atx_closed" }, MD019: true, MD021: true, MD023: true },
    "#  One\n\n  # Two\n",
  ],
  [{ MD005: true, MD007: { indent: 3 }, MD030: { ul_single: 2 } }, "-   one\n  - two\n"],
  [
    { MD055: { style: "no_leading_or_trailing" }, MD060: { style: "aligned" } },
    "a|b\n---|---\nx|y\n",
  ],
  [
    { MD022: true, MD031: true, MD032: true, MD058: true },
    "text\n# Heading\ntext\n\n```js\nx\n```\ntext\n\n- item\n\n| a | b |\n| --- | --- |\n| x | y |\n> quote\n",
  ],
  [{ MD018: true, MD020: true }, "#One\n\n#Two#\n"],
] as const;
for (const [checks, body] of groups)
  for (const disabled of Object.keys(checks)) {
    it(`round3 mixed active regions ${disabled}`, () => {
      const o = options({ markdownlint: { default: false, ...checks } });
      const reduced = options({ markdownlint: { default: false, ...checks, [disabled]: false } });
      const prefix = `<!-- markdownlint-disable ${disabled} -->\n\n`;
      const suffix = `\n<!-- markdownlint-enable ${disabled} -->\n\n`;
      const source = prefix + body + suffix + body;
      const output = format(source, o).output;
      expect(output).toBe(format(prefix + body, reduced).output + suffix + format(body, o).output);
      expect(format(output, o).output).toBe(output);
      expect(
        lint(source, o)
          .filter((d) => d.line < source.slice(0, source.indexOf(suffix)).split("\n").length)
          .map((d) => d.message),
      ).toEqual(lint(prefix + body, reduced).map((d) => d.message));
    });
  }
it("round3 evaluates distinct settings once despite many directive regions", () => {
  const o = options({
    markdownlint: { default: false, MD003: { style: "atx_closed" }, MD019: true },
  });
  const source =
    "<!-- markdownlint-disable MD003 -->\n\n#  One\n\n<!-- markdownlint-enable MD003 -->\n\n#  Two\n\n".repeat(
      100,
    );
  calls.heading = 0;
  lint(source, o);
  expect(calls.heading).toBe(2);
  const same = options({ markdownlint: { default: false, MD005: true, MD030: true } });
  const state = competitorComments(parse(source.replaceAll("MD003", "MD005"), "github"), same);
  expect(state.variants["style/list-indent"] ?? []).toHaveLength(0);
  expect(competitorMappings.filter((r) => r.rule === "style/heading")).toHaveLength(5);
});
