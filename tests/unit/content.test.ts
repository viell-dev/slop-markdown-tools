import { describe, expect, it } from "vitest";
import { dialects, format, lint, presets } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

/**
 * The findings of one problem rule, which formatting reports too without
 * changing the document, and which no other rule makes.
 */
function check(source: string, rule: string, dialect: Dialect = "github") {
  const config: Config = { extends: [], dialect, rules: { [rule]: "warn" } };
  const diagnostics = lint(source, { config });
  const result = format(source, { config });
  expect(result.output).toBe(source);
  expect(result.diagnostics).toEqual(diagnostics);
  expect(diagnostics.every((item) => item.edit === undefined)).toBe(true);
  expect(lint(source, { config: { extends: [], dialect } })).toEqual([]);
  return diagnostics;
}
/** The source that each finding covers. */
const spans = (source: string, findings: { start: number; end?: number }[]) =>
  findings.map((item) => source.slice(item.start, item.end));

describe("content/image-alt", () => {
  const rule = "content/image-alt";
  it.each([
    ["![](chart.png)\n", "github"],
    ["Text ![ ](chart.png) text.\n", "github"],
    ["![][chart]\n\n[chart]: chart.png\n", "github"],
    ["![](chart.png)\n", "commonmark"],
    // In Obsidian, `|100` after the text sets the image's width.
    ["![|100](chart.png)\n", "obsidian"],
    ["![ |100x50](chart.png)\n", "obsidian"],
  ] as const)("reports an image without alternative text: %j in %s", (source, dialect) => {
    const findings = check(source, rule, dialect);
    expect(findings).toHaveLength(1);
    expect(spans(source, findings)[0]).toMatch(/^!\[.*\]/);
    expect(findings[0]?.message).toBe(
      "Add alternative text to the image, for readers who cannot see it.",
    );
  });
  it.each([
    ["![Sales by month](chart.png)\n", "github"],
    ["![Sales][chart]\n\n[chart]: chart.png\n", "github"],
    ["[![Build status](badge.svg)](https://example.com/ci)\n", "github"],
    ["`![](chart.png)`\n\n```md\n![](chart.png)\n```\n", "github"],
    // Outside Obsidian, `|100` is text.
    ["![|100](chart.png)\n", "github"],
    ["![Sales|100](chart.png)\n", "obsidian"],
    // An embed has no place for the text.
    ["![[chart.png]]\n", "obsidian"],
  ] as const)("accepts %j in %s", (source, dialect) => {
    expect(check(source, rule, dialect)).toEqual([]);
  });
  const htmlMessage =
    'Add an alt attribute to the HTML image, for readers who cannot see it, or alt="" if it is decorative.';
  it.each([
    ['<img src="chart.png">\n', '<img src="chart.png">'],
    ['Text <img src="chart.png"> text.\n', '<img src="chart.png">'],
    ['<IMG SRC="chart.png" />\n', '<IMG SRC="chart.png" />'],
    [
      '<p align="center">\n  <img src="logo.svg" width="80">\n</p>\n',
      '<img src="logo.svg" width="80">',
    ],
    ['<img\n  src="chart.png"\n  title="alt">\n', '<img\n  src="chart.png"\n  title="alt">'],
    // An `alt` in another attribute's value, or on another element, gives none.
    ['<img src="x.png" title="alt=\'a\'">\n', '<img src="x.png" title="alt=\'a\'">'],
    ['<span alt="a"><img src="x.png"></span>\n', '<img src="x.png">'],
    ['<img src="x.png" aria-hidden="false">\n', '<img src="x.png" aria-hidden="false">'],
    ['[<img src="badge.svg">](https://example.com/ci)\n', '<img src="badge.svg">'],
    ['| <img src="x.png"> |\n| --- |\n', '<img src="x.png">'],
    ["## Logo <img src='x.png'>\n", "<img src='x.png'>"],
  ])("reports an HTML image without alt: %j", (source, span) => {
    // VitePress keeps HTML blocks, Vue templates there, opaque to every rule; see below.
    for (const dialect of dialects.filter((name) => name !== "vitepress")) {
      const findings = check(source, rule, dialect);
      expect(spans(source, findings), dialect).toEqual([span]);
      expect(findings[0]?.message).toBe(htmlMessage);
    }
  });
  it("locates HTML images inside block quotes and list items", () => {
    for (const newline of ["\n", "\r\n"]) {
      const source = [
        "> <div>",
        '> <p><img src="a.png"></p>',
        "> </div>",
        "",
        "- <div>",
        '  <img src="b.png" alt="B"><img src="c.png">',
        "  </div>",
        "",
      ].join(newline);
      const findings = check(source, rule);
      expect(spans(source, findings)).toEqual(['<img src="a.png">', '<img src="c.png">']);
      expect(findings.map((item) => item.line)).toEqual([2, 6]);
    }
  });
  it.each([
    // `alt=""` marks a decorative image in HTML, as blank Markdown text cannot.
    ['<img src="divider.png" alt="">\n', "github"],
    ['<img src="divider.png" alt>\n', "github"],
    ["<img src=chart.png alt=Sales>\n", "github"],
    ['<img src="chart.png" ALT="Sales">\n', "github"],
    ['<img src="x.png" aria-hidden="true">\n', "forgejo"],
    ['<img src="x.png" aria-hidden="true">\n', "gitea"],
    ['<img src="x.png" aria-hidden="true">\n', "obsidian"],
    ['<img src="x.png" aria-hidden=" TRUE ">\n', "commonmark"],
    // Not an image element: comments, code, and other text.
    ['<!-- <img src="x.png"> -->\n', "github"],
    ['Text <!-- <img src="x.png"> --> text.\n', "github"],
    ['`<img src="x.png">`\n\n```html\n<img src="x.png">\n```\n', "github"],
    ['\\<img src="x.png">\n', "github"],
    ['<imgx src="x.png"> <picture><source srcset="x.png"></picture>\n', "github"],
    // Raw-text elements hold text, except where GitHub's tag filter shows the tags as text.
    ['<textarea>\n<img src="x.png">\n</textarea>\n', "forgejo"],
    ['Text <textarea><img src="x.png"></textarea> text.\n', "gitea"],
    ["<script>let a = '<img src=\"x.png\">';</script>\n", "obsidian"],
    // Vue binds attributes in VitePress.
    ['<img src="/logo.svg" :alt="title">\n', "vitepress"],
    ['<img src="/logo.svg" v-bind:alt="title">\n', "vitepress"],
    ['<img src="/logo.svg" v-bind="image">\n', "vitepress"],
  ] as const)("accepts HTML %j in %s", (source, dialect) => {
    expect(check(source, rule, dialect)).toEqual([]);
  });
  it("reads raw-text elements as GitHub's tag filter leaves them", () => {
    const flow = '<textarea>\n<img src="x.png">\n</textarea>\n';
    const inline = 'Text <textarea><img src="x.png"></textarea> text.\n';
    for (const source of [flow, inline]) {
      expect(spans(source, check(source, rule, "github"))).toEqual(['<img src="x.png">']);
      expect(check(source, rule, "commonmark")).toEqual([]);
    }
  });
  it("reports aria-hidden images on GitHub, whose sanitizer removes the attribute", () => {
    // GitHub's Markdown API rendered `<img src="x.png">` for this on 2026-10-28.
    const source = 'Text <img src="x.png" aria-hidden="true"> text.\n';
    expect(spans(source, check(source, rule, "github"))).toEqual([
      '<img src="x.png" aria-hidden="true">',
    ]);
    expect(check(source, rule, "forgejo")).toEqual([]);
  });
  it("reads Vue bindings only in VitePress", () => {
    const source = '<img src="/logo.svg" :alt="title">\n';
    expect(check(source, rule, "github")).toHaveLength(1);
  });
  it("checks inline HTML in VitePress and leaves its HTML blocks to Vue", () => {
    const inline = 'Text <img src="chart.png"> text.\n';
    expect(spans(inline, check(inline, rule, "vitepress"))).toEqual(['<img src="chart.png">']);
    expect(check('<img src="chart.png">\n', rule, "vitepress")).toEqual([]);
  });
});

describe("content/table-columns", () => {
  const rule = "content/table-columns";
  it("reports rows with more or fewer cells than the header", () => {
    const source = [
      "| Name | Size |",
      "| ---- | ---- |",
      "| a    | 1    | extra |",
      "| b    |",
      "| c    | 3    |",
      "| d | 4 | x | y |",
      "",
    ].join("\n");
    const findings = check(source, rule);
    expect(findings.map((item) => [item.line, item.message])).toEqual([
      [3, "Row has 3 cells and the header 2; the extra cell is not shown."],
      [4, "Row has 1 cell and the header 2; the row is shown with an empty cell added."],
      [6, "Row has 4 cells and the header 2; the extra cells are not shown."],
    ]);
    expect(spans(source, findings)).toEqual([
      "| a    | 1    | extra |",
      "| b    |",
      "| d | 4 | x | y |",
    ]);
  });
  it("counts cells as GFM does", () => {
    expect(
      check(
        "Name | Size\n--- | ---\na | 1\n`a\\|b` \\| c | 2\n\n> | x |\n> | - |\n> | y |\n",
        rule,
      ),
    ).toEqual([]);
    expect(check("| a | b |\n| - | - |\n| 1 | 2 |   |\n", rule)).toHaveLength(1);
    // GFM splits cells at a pipe in a code span too, unless it is escaped.
    expect(check("| a | b |\n| - | - |\n| `x|y` | z |\n", rule)).toHaveLength(1);
    expect(check("| a | b |\n| - | - |\n|\n", rule)[0]?.message).toBe(
      "Row has 1 cell and the header 2; the row is shown with an empty cell added.",
    );
  });
  it("leaves CommonMark, which has no tables, alone", () => {
    expect(check("| a | b |\n| - | - |\n| 1 | 2 | 3 |\n", rule, "commonmark")).toEqual([]);
  });
});

describe("content/code-language", () => {
  const rule = "content/code-language";
  it.each([
    ["```\nnpm test\n```\n", "```"],
    ["~~~~\nnpm test\n~~~~\n", "~~~~"],
    ["- Run:\n\n  ```\n  npm test\n  ```\n", "```"],
    ["> ```\n> npm test\n> ```\n", "```"],
    ["```   \nnpm test\n```\n", "```"],
  ])("reports a fenced code block without a language: %j", (source, fence) => {
    const findings = check(source, rule);
    expect(spans(source, findings)).toEqual([fence]);
    expect(findings[0]?.message).toBe(
      `Name the code block's language after its opening fence, such as ${fence}sh, or ${fence}text for plain text.`,
    );
  });
  it.each([
    "```sh\nnpm test\n```\n",
    "~~~text\nplain\n~~~\n",
    "```{.python}\nprint()\n```\n",
    // An indented code block has no place for a language.
    "    npm test\n",
    "- Item\n\n      npm test\n",
    "$$\nx^2\n$$\n",
    "Inline `code` only.\n",
  ])("accepts %j", (source) => {
    expect(check(source, rule)).toEqual([]);
  });
});

describe("content rules in presets", () => {
  it("enable image text and table columns in recommended as warnings, code languages nowhere", () => {
    const recommended = presets.recommended!.rules!;
    expect(recommended["content/image-alt"]).toBe("warn");
    expect(recommended["content/table-columns"]).toBe("warn");
    for (const preset of Object.values(presets))
      expect(preset.rules?.["content/code-language"]).toBeUndefined();
  });
  it("respect suppression comments", () => {
    const source =
      "<!-- mdrefine-disable-next-line content/image-alt -->\n![](a.png)\n\n![](b.png)\n";
    expect(check(source, "content/image-alt").map((item) => item.line)).toEqual([4]);
  });
});

describe("content/shell-prompt", () => {
  const rule = "content/shell-prompt";
  const message = (prompt: string) =>
    `Every command in the code block starts with ${prompt} and the block shows no output; remove the prompts, which get in the way of copying the commands.`;
  it.each([
    ["```sh\n$ ls\n$ cd docs\n```\n", "github"],
    ["```\n$ ls\n$ cat foo\n$ less bar\n```\n", "github"],
    ["~~~bash\n  $ npm ci\n\n  $ npm test\n~~~\n", "github"],
    ["```Bash\n$\tls\n```\n", "github"],
    ["```console\n$ ls\n```\n", "github"],
    ["```shell-session\n$ ls\n```\n", "forgejo"],
    ["```zsh\n$ ls\n```\n", "gitea"],
    ["    $ ls\n    $ pwd\n", "commonmark"],
    ["- Run:\n\n  ```sh\n  $ ls\n  ```\n", "obsidian"],
    ["> ```sh\n> $ ls\n> ```\n", "obsidian"],
    // VitePress reads line highlighting and numbering apart from the language.
    ["```bash{1}\n$ ls\n```\n", "vitepress"],
    ["```sh:line-numbers\n$ ls\n```\n", "vitepress"],
    // Lines that a backslash continues belong to the command.
    ["```sh\n$ docker run \\\n    --rm \\\n    image\n$ ls\n```\n", "github"],
  ] as const)("reports %j in %s", (source, dialect) => {
    const findings = check(source, rule, dialect);
    // The whole block, from its fence or indentation.
    expect(spans(source, findings)).toEqual([
      source.slice(source.search(/`{3}|~{3}|^ {4}/m)).trimEnd(),
    ]);
    expect(findings[0]?.message).toBe(message('a "$" prompt'));
  });
  it("reports zsh's % prompt and names a mix of prompts generally", () => {
    expect(check("```zsh\n% ls\n% pwd\n```\n", rule)[0]?.message).toBe(message('a "%" prompt'));
    expect(check("```console\n$ ls\n% pwd\n```\n", rule)[0]?.message).toBe(message("a prompt"));
  });
  it.each(["\r\n", "\r"])("reads %j line endings", (eol) => {
    const source = ["Intro.", "", "```sh", "$ ls", "$ cd \\", "  docs", "```", ""].join(eol);
    expect(check(source, rule)).toMatchObject([{ line: 3, column: 1 }]);
    const output = ["```sh", "$ ls", "output", "```", ""].join(eol);
    expect(check(output, rule)).toEqual([]);
  });
  it.each([
    // Output below a command.
    "```sh\n$ ls\nfoo bar\n$ cat foo\nHello world\n```\n",
    // Some commands may show no output, if one does.
    "```sh\n$ mkdir test\nmkdir: created directory 'test'\n$ ls test\n```\n",
    "```sh\nls\ncd docs\n```\n",
    "```sh\nls\n$ cd docs\n```\n",
    // `#` starts a comment in shell code, and a line of output or a root prompt in a session.
    "```sh\n# Install the dependencies\n$ npm ci\n```\n",
    "```console\n$ cat config\n# generated\n```\n",
    "```console\n# apt install curl\n```\n",
    // A prompt needs blank space and a command after it.
    "```sh\n$HOME/bin/tool\n```\n",
    "```sh\n$\n```\n",
    "```sh\n$ls\n```\n",
    // An escaped backslash continues nothing.
    "```sh\n$ echo a\\\\\noutput\n```\n",
    "```sh\n$ echo \\\n\noutput\n```\n",
    "```sh\n```\n",
    "```\n\n```\n",
    // Other languages can start lines with `$` or `%`.
    "```text\n$ 5 for the ticket\n```\n",
    "```latex\n% A comment\n% Another\n```\n",
    "```tex\n$ x^2 $\n```\n",
    "```php\n$ value = 1;\n```\n",
    "```powershell\n$ value = 1\n```\n",
    "```math\n$ x $\n```\n",
    "$$\n$ x $\n$$\n",
    "Run `$ ls` first.\n",
  ])("accepts %j", (source) => {
    expect(check(source, rule)).toEqual([]);
  });
  it("is in no preset", () => {
    for (const preset of Object.values(presets)) expect(preset.rules?.[rule]).toBeUndefined();
  });
});
