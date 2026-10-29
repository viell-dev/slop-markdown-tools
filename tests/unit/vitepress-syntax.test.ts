import fc from "fast-check";
import { expect, it } from "vitest";
import { lint, parse } from "../../src/index.js";
import { overlapping, partIndex, type Part } from "../../src/syntax/vitepress/projection.js";

it.each([
  ["js{1,3}", "js", "{1,3}"],
  ["ts:line-numbers=2 {1}", "ts", ":line-numbers=2 {1}"],
  ["js-vue [Example]", "js-vue", "[Example]"],
  ["vue-html", "vue-html", null],
  ["ansi", "ansi", null],
  ["{1}", null, "{1}"],
])("separates VitePress language %s from its decorations", (info, lang, meta) => {
  const source = `~~~${info}\nvalue\n~~~\n`;
  expect(parse(source, "vitepress").tree.children[0]).toMatchObject({ type: "code", lang, meta });
});

it("checks allowed base aliases and treats decorations as extra info", () => {
  const source = "~~~js{1}\nvalue\n~~~\n";
  const config = {
    extends: [],
    dialect: "vitepress",
    rules: { "content/code-language": ["warn", { allowedLanguages: ["js"] }] },
  } as const;
  expect(lint(source, { config })).toEqual([]);
  expect(
    lint(source, {
      config: {
        ...config,
        rules: {
          "content/code-language": ["warn", { allowedLanguages: ["js"], languageOnly: true }],
        },
      },
    }),
  ).toHaveLength(1);
});

it("finds the first protected part that a range overlaps as a full search does (#755)", () => {
  // Nested, overlapping, repeated and empty parts, queried as ranges and points.
  const part = fc
    .tuple(fc.nat(60), fc.nat(20), fc.boolean())
    .map(([start, length, wrapOnly]) => ({ start, end: start + length, wrapOnly, reason: "" }));
  fc.assert(
    fc.property(
      fc.array(part, { maxLength: 30 }),
      fc.nat(90),
      fc.nat(20),
      fc.boolean(),
      (parts, start, length, touching) => {
        parts.forEach((part, index) => (part.reason = String(index)));
        const end = touching ? start : start + length;
        const expected = parts
          .filter((part) =>
            touching
              ? start >= part.start && start <= part.end
              : start < part.end && end > part.start,
          )
          .reduce<Part | undefined>(
            (first, part) => (first && first.start <= part.start ? first : part),
            undefined,
          );
        expect(overlapping(partIndex(parts), start, end, touching)).toBe(expected);
      },
    ),
    { numRuns: 2000 },
  );
});
