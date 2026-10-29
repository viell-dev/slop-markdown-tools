import { expect, it } from "vitest";
import { format as prettier } from "prettier";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/node.js";
import { convertConfig, format, lint } from "../../src/index.js";

function options(input: Parameters<typeof convertConfig>[0]) {
  const r = convertConfig(input);
  return { config: r.config, compatibility: r.compatibility };
}
it("round2 provenance preserves override ignore and pragma gates after configure-file", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdrefine-round2-"));
  try {
    await writeFile(join(root, ".markdownlint.json"), JSON.stringify({ default: false }));
    for (const requirePragma of [false, true]) {
      await writeFile(
        join(root, ".prettierrc"),
        JSON.stringify({
          overrides: [
            { files: "*.md", options: { proseWrap: "always", printWidth: 20, requirePragma } },
          ],
        }),
      );
      const loaded = await loadConfig(root);
      const o = { ...loaded, path: "note.md" };
      const paragraph =
        "This is a long paragraph that must remain exactly as written and never reflow.\n";
      const directive = "<!-- markdownlint-configure-file {} -->\n\n";
      for (const eol of ["\n", "\r\n"]) {
        const ignored = (directive + "<!-- prettier-ignore -->\n\n" + paragraph).replaceAll(
          "\n",
          eol,
        );
        expect(format(ignored, o).output).toContain(paragraph.replaceAll("\n", eol));
        const plain = (directive + paragraph).replaceAll("\n", eol);
        expect(format(plain, o).output === plain).toBe(requirePragma);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each(["MD022", "MD031", "MD032", "MD058"])("round2 shared spacing isolates %s", (disabled) => {
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
it.each(["format", "prettier"])(
  "round2 pragma after front matter @%s matches Prettier",
  async (pragma) => {
    for (const matter of [
      "---\ntitle: Test\n---",
      "---\ntitle: Test\n...",
      "---yaml\ntitle: Test\n---",
      "---toml\ntitle = 'Test'\n---",
      "+++\ntitle = 'Test'\n+++",
    ]) {
      for (const eol of ["\n", "\r\n"]) {
        const source = `${matter}\n\n<!-- @${pragma} -->\n\n*one*\n`.replaceAll("\n", eol);
        const output = format(source, options({ prettier: { requirePragma: true } })).output;
        expect(output).toContain("_one_");
        expect(await prettier(source, { parser: "markdown", requirePragma: true })).toContain(
          "_one_",
        );
        const misplaced = source.replace(`<!-- @${pragma} -->`, `text\n\n<!-- @${pragma} -->`);
        expect(format(misplaced, options({ prettier: { requirePragma: true } })).output).toBe(
          misplaced,
        );
      }
    }
  },
);
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
] as const)("round2 suppressed options use Prettier for %s", (id, setting, source, active) => {
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
] as const)("round2 reconverts shared checks %j", (checks, disabled, body) => {
  const o = options({ markdownlint: { default: false, ...checks } });
  const source = `<!-- markdownlint-disable ${disabled} -->\n\n${body}`;
  const surviving = options({ markdownlint: { default: false, ...checks, [disabled]: false } });
  expect(format(source, o).output).toBe(format(source, surviving).output);
  expect(format(body, o).output).not.toBe(body);
});
it("round2 missing provenance fails safe under a Prettier ignore", () => {
  const o = options({ prettier: { proseWrap: "always", printWidth: 20 } });
  delete o.compatibility.origins["style/wrap"];
  const source =
    "<!-- prettier-ignore -->\n\nThis paragraph must stay exactly as written despite its length.\n";
  expect(format(source, o).output).toBe(source);
});

it.each([
  ["MD022", { lines_above: 2 }, "text\n# One\n"],
  ["MD030", { ul_single: 3 }, "-   one\n"],
  ["MD007", { start_indented: true }, "- one\n"],
  ["MD055", { style: "no_leading_or_trailing" }, "| a | b |\n| --- | --- |\n| x | y |\n"],
  ["MD060", { style: "tight" }, "| a | b |\n| --- | --- |\n| x | y |\n"],
] as const)("round2 additional conflicting options %s", (id, setting, body) => {
  const o = options({ prettier: {}, markdownlint: { default: false, [id]: setting } });
  const p = options({ prettier: {} });
  const source = `<!-- markdownlint-disable ${id} -->\n\n${body}`;
  expect(format(source, o).output).toBe(format(source, p).output);
  expect(format(body, o).output).not.toBe(format(body, p).output);
});
it("round2 agreeing options retain shared behavior", () => {
  const source = "<!-- markdownlint-disable MD049 -->\n\n*one*\n";
  const o = options({
    prettier: {},
    markdownlint: { default: false, MD049: { style: "underscore" } },
  });
  expect(format(source, o).output).toContain("_one_");
});

it.each(["MD018", "MD020"])("round2 unspaced headings attribute %s separately", (disabled) => {
  const o = options({ markdownlint: { default: false, MD018: true, MD020: true } });
  const source = `<!-- markdownlint-disable ${disabled} -->\n\n#One\n\n#Two#\n`;
  const findings = lint(source, o);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.message.includes("add spaces inside the hashes")).toBe(disabled === "MD018");
});
