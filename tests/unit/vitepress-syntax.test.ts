import { expect, it } from "vitest";
import { lint, parse } from "../../src/index.js";

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
