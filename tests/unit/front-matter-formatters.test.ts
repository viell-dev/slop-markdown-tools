import { expect, it, vi, beforeEach } from "vitest";
import { formatWithCode } from "../../src/node.js";
import { format, dialects, validateConfig } from "../../src/index.js";
import type { Config } from "../../src/index.js";
import { runFormatter } from "../../src/code/command.js";
vi.mock("../../src/code/command.js", () => ({ runFormatter: vi.fn() }));
const run = vi.mocked(runFormatter);
beforeEach(() => {
  run.mockReset();
});
const config = (dialect: Config["dialect"] = "github"): Config => ({
  extends: [],
  dialect,
  codeFormatters: [
    {
      id: "metadata",
      languages: ["yaml"],
      frontMatter: ["yaml", "toml"],
      command: "formatter",
      args: [],
    },
  ],
});

it.each(dialects)(
  "formats YAML bodies while preserving comments, delimiters and surrounding Markdown in %s",
  async (dialect) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source =
        "---\n# comment\ntitle:    x\ntags: [a,b]\n---\n\n# Heading\n\nA *word*.\n".replaceAll(
          "\n",
          newline,
        );
      const body = "# comment\ntitle: x\ntags: [a, b]\n";
      run.mockResolvedValue(body);
      const options = { config: config(dialect) };
      expect(format(source, options).output).toBe(source);
      const result = await formatWithCode(source, options);
      expect(result.diagnostics).toEqual([]);
      expect(result.output).toBe(
        source.replace("title:    x", "title: x").replace("[a,b]", "[a, b]"),
      );
      expect((await formatWithCode(result.output, options)).changed).toBe(false);
      expect(run).toHaveBeenCalledWith(
        expect.anything(),
        "# comment\ntitle:    x\ntags: [a,b]".replaceAll("\n", newline) + newline,
        expect.any(String),
        expect.any(String),
      );
    }
  },
);
it.each(dialects)("keeps the alternative TOML reading in %s", async (dialect) => {
  run.mockResolvedValue('title = "x"\n');
  const source = '+++\ntitle =    "x"\n+++\n\nText.\n';
  const result = await formatWithCode(source, { config: config(dialect) });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(dialect === "vitepress" ? source : source.replace("=    ", "= "));
  expect((await formatWithCode(result.output, { config: config(dialect) })).changed).toBe(false);
  run.mockResolvedValue('title = "changed"\n');
  const refused = await formatWithCode(source, { config: config(dialect) });
  expect(refused.output).toBe(source);
  expect(refused.diagnostics[0]?.rule).toBe(
    dialect === "vitepress" ? undefined : "engine/code-formatter",
  );
});
it.each(dialects)(
  "leaves front matter as written where renderers disagree whether it is metadata in %s",
  async (dialect) => {
    // The closing delimiter lies inside a code block for the reading without
    // front matter, which the document is read as, so the YAML is not sent.
    // VitePress takes front matter off before reading the Markdown, so there
    // it is metadata.
    const source = "---\ntitle:    x\n```js\n---\n```\n";
    run.mockResolvedValue("title: x\n```js\n");
    const result = await formatWithCode(source, { config: config(dialect) });
    expect(result.diagnostics).toEqual([]);
    if (dialect === "vitepress") {
      expect(result.output).toBe(source.replace("title:    x", "title: x"));
    } else {
      expect(result.output).toBe(source);
      expect(run).not.toHaveBeenCalled();
    }
  },
);
it("requires explicit front matter selection, respects exclusions, scopes and failures", async () => {
  const source = "---\ntitle:    x\n---\n\nText.\n";
  run.mockResolvedValue("title: x\n");
  const selected = config();
  const tool = selected.codeFormatters && selected.codeFormatters[0]!;
  if (!tool) throw new Error("missing fixture");
  const fenceOnly = { ...tool };
  delete fenceOnly.frontMatter;
  for (const entry of [fenceOnly, { ...tool, exclude: ["**"] }]) {
    expect(
      (await formatWithCode(source, { config: { ...selected, codeFormatters: [entry] } })).output,
    ).toBe(source);
  }
  expect(
    (
      await formatWithCode(source, {
        config: selected,
        ranges: [{ start: source.indexOf("Text"), end: source.length }],
      })
    ).output,
  ).toBe(source);
  expect(run).not.toHaveBeenCalled();
  run.mockRejectedValue(new Error("timed out"));
  const failed = await formatWithCode(source, { config: selected });
  expect(failed.output).toBe(source);
  expect(failed.diagnostics[0]?.message).toContain("timed out");
});
it("refuses delimiter injection, including empty output and a displaced metadata boundary", async () => {
  const source = "---\ntitle: x\n---\n\n# Heading\n";
  for (const output of ["title: x\n---\nInjected\n", "---\n"]) {
    run.mockResolvedValue(output);
    const result = await formatWithCode(source, { config: config() });
    expect(result.output).toBe(source);
    expect(result.diagnostics[0]?.rule).toBe("engine/code-formatter");
  }
  run.mockResolvedValue("");
  const empty = await formatWithCode(source, { config: config() });
  expect(empty.diagnostics).toEqual([]);
  expect(empty.output).toBe("---\n---\n\n# Heading\n");
});
it("rejects invalid and duplicate metadata routes", () => {
  const selected = config();
  const tool = selected.codeFormatters && selected.codeFormatters[0]!;
  if (!tool) throw new Error("missing fixture");
  for (const frontMatter of [["json"], [], ["yaml", "yaml"]])
    expect(() => validateConfig({ codeFormatters: [{ ...tool, frontMatter }] })).toThrow();
  expect(() =>
    validateConfig({ codeFormatters: [tool, { ...tool, id: "other", languages: ["toml"] }] }),
  ).toThrow();
});

it.each(dialects)(
  "keeps an empty YAML body empty and passes no delimiters in %s",
  async (dialect) => {
    run.mockImplementation((_formatter, source) => Promise.resolve(source));
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = ["---", "---", "", "Text.", ""].join(newline);
      const result = await formatWithCode(source, { config: config(dialect) });
      expect(result.output).toBe(source);
      expect(result.diagnostics).toEqual([]);
      expect(run).toHaveBeenLastCalledWith(
        expect.anything(),
        newline,
        expect.any(String),
        expect.any(String),
      );
    }
  },
);
