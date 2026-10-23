import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { format, parse, range, semanticFingerprint } from "../../src/index.js";
import type { Config, Plugin } from "../../src/index.js";
import { misreadLists } from "../../src/syntax/misread-lists.js";

const recommended: Config = { extends: ["recommended", "github"], dialect: "github" };
const configurations: Config[] = [
  recommended,
  { extends: [], dialect: "github", rules: { "style/heading": "warn" } },
  { extends: [], dialect: "github", rules: { "style/block-spacing": "warn" } },
  { extends: [], dialect: "github", rules: { "style/wrap": ["warn", { width: 20 }] } },
];
function checked(source: string, config: Config) {
  const result = format(source, { config });
  expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, { config }).output).toBe(result.output);
  expect(semanticFingerprint(parse(result.output, "github"))).toBe(
    semanticFingerprint(parse(source, "github")),
  );
  return result.output;
}

describe("GitHub boundaries beside display math (#336)", () => {
  // Both API modes require these math/title source boundaries to stay together.
  it.each([
    "$$\nx\n$$\nTitle\n---\n",
    "$$\nx\n$$\nTitle\n===\n",
    "$$ info\nx\n$$\nTitle\n---\n",
    "$$\n\nx\n$$\nTitle\n---\n",
    "$$\nx\n\n$$\nTitle\n---\n",
    "> $$\n> x\n> $$\n> Title\n> ---\n",
    "- $$\n  x\n  $$\n  Title\n  ---\n",
    "$$\na\n$$\n$$\nb\n$$\nTitle\n---\n",
    "$$\nx\n$$\n#5\n---\n",
    "$$\nx\n$$\n#5\n===\n",
    "> $$\n> x\n> $$\nTitle\n---\n",
    "> $$\n> x\n> $$\nTitle\n===\n",
    "- $$\n  x\n  $$\nTitle\n---\n",
  ])("retains the native boundary in %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      for (const bom of ["", "\uFEFF"]) {
        const input = bom + source.replaceAll("\n", newline);
        for (const config of configurations) expect(checked(input, config)).toBe(input);
        const document = parse(input, "github");
        const ranges = [...misreadLists(document).boundaryText].map(range);
        // parse() strips BOMs; node offsets index Document.source.
        expect(ranges).toEqual([
          [document.source.indexOf("$$"), document.source.length - newline.length],
        ]);
      }
    }
  });

  it("retains the generated 1019808072/12 heading while formatting later source", () => {
    const source = readFileSync(
      new URL("../fixtures/renderers/github-math-setext-1019808072.md", import.meta.url),
      "utf8",
    );
    const expected = readFileSync(
      new URL("../fixtures/renderers/github-math-setext-1019808072.expected.md", import.meta.url),
      "utf8",
    );
    expect(checked(source, recommended)).toBe(expected);
  });

  it("retains the boundary for a custom rule too", () => {
    const source = "$$\nx\n$$\nTitle\n---\n";
    const plugin: Plugin = {
      name: "split-math",
      rules: {
        split: {
          kind: "style",
          description: "Separate the apparent math block",
          check: ({ document }) => {
            const start = document.source.indexOf("Title") - 1;
            return [{ start, message: "Separate", edit: { start, end: start + 1, text: "\n\n" } }];
          },
        },
      },
    };
    const result = format(source, {
      config: { extends: [], dialect: "github", rules: { "split-math/split": "warn" } },
      plugins: [plugin],
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it("formats independent headings before and after the protected span", () => {
    expect(checked("Before\n===\n\n$$\nx\n$$\nTitle\n---\n\nLater\n===\n", recommended)).toBe(
      "# Before\n\n$$\nx\n$$\nTitle\n---\n\n# Later\n",
    );
  });

  it("still converts a heading after a real blank line or ATX interruption", () => {
    expect(checked("$$\nx\n$$\n\nTitle\n---\n", recommended)).toBe("$$\nx\n$$\n\n## Title\n");
    expect(checked("$$\nx\n$$\n# Barrier\nTitle\n---\n", recommended)).toBe(
      "$$\nx\n$$\n\n# Barrier\n\n## Title\n",
    );
  });

  it.each(["#", "##"])("keeps direct %s after math when Setext is requested", (marker) => {
    const source = `$$\nx\n$$\n${marker} Title\n`;
    expect(
      checked(source, {
        extends: [],
        dialect: "github",
        rules: { "style/heading": ["warn", { style: "setext" }] },
      }),
    ).toBe(source);
  });

  it.each(["intro", "[a]: /url"])(
    "keeps the existing joined primary heading after %j",
    (prefix) => {
      const source = `${prefix}\n$$\nx\n$$\nTitle\n---\n`;
      expect(parse(source, "github").tree.children.at(-1)?.type).toBe("heading");
      for (const config of configurations) expect(checked(source, config)).toBe(source);
    },
  );
});
