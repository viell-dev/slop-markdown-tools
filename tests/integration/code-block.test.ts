import { createMarkdownRenderer, disposeMdItInstance } from "vitepress";
import { expect, it } from "vitest";
import { format } from "../../src/index.js";

it("reports code-form mismatches without changing VitePress code rendering (#695)", async () => {
  const md = await createMarkdownRenderer(process.cwd(), { cache: false });
  try {
    const indented = "    code\n";
    const fenced = "```\ncode\n```\n";
    expect(await md.renderAsync(indented)).not.toBe(await md.renderAsync(fenced));
    for (const source of [
      indented,
      "::: code-group\n\n    {{ value }}\n\n```js {1} [demo]\nconst x = 1;\n```\n\n:::\n",
      ">     code\n>\n>     more\n",
      "- Item\n\n      code\n",
      "\tcode\r\n",
    ]) {
      const config = {
        extends: [],
        dialect: "vitepress",
        rules: { "style/code-block": ["warn", { style: "fenced" }] },
      } as const;
      const result = format(source, { config });
      expect(result.output).toBe(source);
      expect(result.diagnostics).toMatchObject([{ rule: "style/code-block" }]);
      expect(await md.renderAsync(result.output)).toBe(await md.renderAsync(source));
    }
  } finally {
    disposeMdItInstance();
  }
});
