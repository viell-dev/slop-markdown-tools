import { expect, it } from "vitest";
import { format as prettier } from "prettier";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/node.js";
import { format } from "../../src/index.js";
import { compatibilityOptions as options } from "../support/competitors.js";

it("provenance preserves override ignore and pragma gates after configure-file", async () => {
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

it.each(["format", "prettier"])(
  "pragma after front matter @%s matches Prettier",
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

it("missing provenance fails safe under a Prettier ignore", () => {
  const o = options({ prettier: { proseWrap: "always", printWidth: 20 } });
  delete o.compatibility.origins["style/wrap"];
  const source =
    "<!-- prettier-ignore -->\n\nThis paragraph must stay exactly as written despite its length.\n";
  expect(format(source, o).output).toBe(source);
});
