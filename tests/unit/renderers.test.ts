import { readFileSync } from "node:fs";
import type { Nodes } from "mdast";
import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import {
  documentSeed,
  generateDocument,
  normalizeGithubHtml,
  normalizeHtml,
} from "../../scripts/rendering.mjs";
import { format, parse } from "../../src/index.js";
import type { Config } from "../../src/index.js";
import examples from "../fixtures/commonmark/spec.json" with { type: "json" };

// The safety check compares the parser's readings before and after formatting, so it cannot
// see an edit that another implementation reads differently (issue #303). These tests format
// documents and compare how two other implementations render them before and after:
// commonmark.js, CommonMark's reference implementation, and markdown-it. The Rendering workflow
// does the same with GitHub's renderer every week (scripts/github-rendering.mjs).

interface Known {
  /** A generated document, `generated SEED/INDEX`, or a description of `input`. */
  case: string;
  /** The issue that tracks the difference. */
  issue: number | string;
  /** The document, when it is not generated. */
  input?: string;
}
/** Small inputs whose rendering formatting changes for both renderers, as for GitHub. */
const inputs: Known[] = [];
/**
 * The cases whose rendering formatting changes, by renderer. Every one has to differ still, so
 * that a fix, here or in a dependency, shows up as an entry to remove. The documents of a seed
 * change whenever the generator or the formatting does; the comment on such an entry gives a
 * smaller input that shows the same difference.
 */
const known: Record<string, Known[]> = {
  "commonmark.js": inputs,
  "markdown-it": [
    // markdown-it keeps the indentation of a code span's next line, as the parser does, where
    // GitHub and commonmark.js leave it out, and the tool writes code spans as they read them.
    // "`\n `\n" becomes "` `\n".
    { case: "generated 3/38", issue: 276 },
    {
      case: "a code span continued on an indented line",
      input: "`npm run\n   build` now.\n",
      issue: 276,
    },
    ...inputs,
  ],
};

const commonmarkReader = new Parser();
const commonmarkWriter = new HtmlRenderer();
// The default preset reads CommonMark, tables, and strikethrough with two tildes.
const markdownIt = new MarkdownIt({ html: true });
const markdownItCommonMark = new MarkdownIt("commonmark");

/** How a renderer is compared, and on what. */
interface Target {
  renderer: string;
  render: (source: string) => string;
  /** The syntax of the generated documents, and the configuration they are formatted with. */
  syntax: "commonmark" | "gfm";
  config: Config;
  /** The CommonMark renderer for the specification examples. */
  renderCommonMark: (source: string) => string;
  /** The input as given to the renderer. */
  input: (source: string) => string;
}
const targets: Target[] = [
  {
    renderer: "commonmark.js",
    render: (source) => commonmarkWriter.render(commonmarkReader.parse(source)),
    syntax: "commonmark",
    config: { extends: ["recommended"], dialect: "commonmark" },
    renderCommonMark: (source) => commonmarkWriter.render(commonmarkReader.parse(source)),
    input: (source) => source,
  },
  {
    renderer: "markdown-it",
    render: (source) => markdownIt.render(source),
    syntax: "gfm",
    config: { extends: ["recommended", "github"] },
    renderCommonMark: (source) => markdownItCommonMark.render(source),
    // markdown-it leaves the line ending out of the last line of a code block that ends a file
    // without one, where commonmark.js and GitHub write it. Only markdown-it would show the
    // line ending that formatting adds.
    input: (source) => (source.endsWith("\n") ? source : source + "\n"),
  },
];
/** The configurations that the specification examples, which are CommonMark, are formatted with. */
const exampleConfigs: Config[] = [
  { extends: ["recommended"], dialect: "commonmark" },
  {
    extends: ["recommended"],
    dialect: "commonmark",
    rules: { "style/wrap": ["warn", { width: 20 }] },
  },
];

/** How formatting with `config` changes the rendering of `source`, if it does. */
function difference(
  source: string,
  config: Config,
  render: (source: string) => string,
): string | undefined {
  const output = format(source, { config }).output;
  if (output === source) return undefined;
  const before = normalizeHtml(render(source));
  const after = normalizeHtml(render(output));
  if (before === after) return undefined;
  let at = 0;
  while (before[at] === after[at]) at++;
  const around = (html: string) => html.slice(Math.max(0, at - 60), at + 60);
  return [
    `source: ${JSON.stringify(source)}`,
    `output: ${JSON.stringify(output)}`,
    `before: …${around(before)}…`,
    `after:  …${around(after)}…`,
  ].join("\n");
}
/** Fail with the cases that render differently unexpectedly, and the known ones that do not. */
function expectKnown(renderer: string, cases: string[], differing: Map<string, string>) {
  const entries = new Map(known[renderer]!.map((entry) => [entry.case, entry.issue]));
  const unexpected = [...differing].filter(([name]) => !entries.has(name));
  const stale = cases.filter((name) => entries.has(name) && !differing.has(name));
  expect(
    {
      unexpected: unexpected.map(([name, description]) => `${name}\n${description}`),
      stale: stale.map((name) => `${name} (issue: ${entries.get(name)})`),
    },
    `${renderer} renders the unexpected cases differently after formatting, and the stale ones alike now: check their issues and remove their entries`,
  ).toEqual({ unexpected: [], stale: [] });
}

const seeds = [1, 2, 3];
const documentsPerSeed = 50;
describe.each(targets)("rendering by $renderer", (target) => {
  it.each(["a\t  \nb\n", "a\\\\\t  \nb\n"])(
    "retains a native mixed-whitespace hard break (#562): %j",
    (source) => {
      const native = normalizeHtml(target.render(source));
      expect(native).toContain("<br");
      for (const config of [
        {
          extends: [],
          dialect: target.config.dialect ?? "github",
          rules: { "style/trailing-space": "warn" },
        },
        {
          extends: [],
          dialect: target.config.dialect ?? "github",
          rules: { "style/wrap": ["warn", { width: 20 }] },
        },
        target.config,
      ] satisfies Config[]) {
        const result = format(source, { config });
        expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
        expect(result.output).toBe(source);
        expect(format(result.output, { config }).output).toBe(source);
        expect(normalizeHtml(target.render(result.output))).toBe(native);
      }
      expect(normalizeHtml(target.render(source.replaceAll("\t  \n", "\n")))).not.toBe(native);
    },
  );

  it("keeps a code span's possible mixed-whitespace hard break (#335, #562)", () => {
    const source = "before `a\t  \nb` and more plain words follow here\n";
    const config: Config = {
      extends: [],
      dialect: target.config.dialect ?? "github",
      rules: { "style/wrap": ["warn", { width: 20 }] },
    };
    const result = format(source, { config });
    expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
    expect(result.output).toBe(source);
    expect(normalizeHtml(target.render(result.output))).toBe(normalizeHtml(target.render(source)));
  });

  it("still wraps outside a code span with a Tab and one final space (#335, #562)", () => {
    const source = "before `a\t \nb` and more plain words follow here\n";
    const config: Config = {
      extends: [],
      dialect: target.config.dialect ?? "github",
      rules: { "style/wrap": ["warn", { width: 20 }] },
    };
    const result = format(source, { config });
    expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
    expect(result.output).not.toBe(source);
    expect(normalizeHtml(target.render(result.output))).toBe(normalizeHtml(target.render(source)));
  });

  it.each(seeds)("does not change for the generated documents of seed %i", (seed) => {
    const cases: string[] = [];
    const differing = new Map<string, string>();
    for (let index = 0; index < documentsPerSeed; index++) {
      const name = `generated ${seed}/${index}`;
      cases.push(name);
      const source = target.input(generateDocument(documentSeed(seed, index), target.syntax));
      const found = difference(source, target.config, target.render);
      if (found) differing.set(name, found);
    }
    expectKnown(target.renderer, cases, differing);
  });
  it("does not change for the CommonMark specification examples", () => {
    const cases: string[] = [];
    const differing = new Map<string, string>();
    for (const example of examples) {
      const name = `example ${example.example}`;
      cases.push(name);
      for (const config of exampleConfigs) {
        const found = difference(target.input(example.markdown), config, target.renderCommonMark);
        if (found) differing.set(name, found);
      }
    }
    expectKnown(target.renderer, cases, differing);
  });
  it.each(known[target.renderer]!.filter((entry) => entry.input !== undefined))(
    "still changes for $case (issue: $issue)",
    (entry) => {
      const found = difference(target.input(entry.input!), target.config, target.render);
      expect(found, "renders alike now; check the issue and remove the entry").toBeDefined();
    },
  );
});

describe.each(targets)("rendering by $renderer of lists that the parser misreads", (target) => {
  // The parser reads these lists as text, and the blocks below them outside the list
  // (issue #191). Before, formatting joined lists, moved a list out of an item, changed
  // code, turned a list into a heading, and made lists loose.
  it.each([
    "Text\n- 2. Step\n  1) Next\n",
    "Text\n> 2. a\n> 1) b\n",
    "    code\n\n2. Two\n1) Three\n",
    "_\n- 0.     *r*\n",
    "    code\n\n2. a\n---\n",
    "Text\n- 2. Step\n     1) Next\n",
    "    code\n\n2. Two\n   - Sub\n",
    "    code\n\n-\n* x\n",
    "Text\n- -\n  * x\n",
    "    code\n\n- \n  * x\n",
    "    code\n\n2) b\n   # H\n   Text\n",
    "Text\n1. 2) b\n   ===\n   *c*\n   1) d\n",
    "Text\n> 1.\n> ===\n> ---\n",
    "    code\n\n2. Two\n   # H\n1. Three\n",
  ])("does not change for %j", (source) => {
    const config: Config = {
      ...target.config,
      rules: { "style/block-spacing": "warn", "style/wrap": ["warn", { width: 20 }] },
    };
    expect(difference(source, target.config, target.render)).toBeUndefined();
    expect(difference(source, config, target.render)).toBeUndefined();
  });
});

describe("normalizeHtml", () => {
  it("ignores whitespace that a browser does not show", () => {
    expect(normalizeHtml("<p>a\nb  c</p>\n<ul>\n<li>d</li>\n</ul>\n")).toBe(
      "<p>a b c</p><ul><li>d</li></ul>",
    );
    expect(normalizeHtml("<p>a<br />\nb</p>")).toBe("<p>a<br />b</p>");
  });
  it("keeps the whitespace of code blocks and code spans", () => {
    expect(normalizeHtml("<pre><code>a  b\n</code></pre>\n")).toBe(
      "<pre><code>a  b\n</code></pre>",
    );
    expect(normalizeHtml("<p>a\n<code>b  c</code> d</p>")).toBe("<p>a <code>b  c</code> d</p>");
  });
  it("keeps the differences that a browser shows", () => {
    expect(normalizeHtml("<p>a b</p>")).not.toBe(normalizeHtml("<p>ab</p>"));
    expect(normalizeHtml("<p>a</p><p>b</p>")).not.toBe(normalizeHtml("<p>a b</p>"));
    expect(normalizeHtml("<p>a<br />\nb</p>")).not.toBe(normalizeHtml("<p>a\nb</p>"));
  });
});

describe("GitHub source-verified code normalization (#515)", () => {
  const source = "~~~md\nconst fern = 52;\n  lantern(engine)   \n\n~~~\n";
  const highlighted =
    '<div class="highlight highlight-text-md"><pre class="notranslate">const fern = 52;\n  lantern(engine)   \n</pre></div>';
  const fallback =
    '<pre lang="md" class="notranslate"><code class="notranslate">const fern = 52;\n  lantern(engine)   \n\n</code></pre>';
  const normalize = (html: string, input = source) =>
    normalizeGithubHtml(html, "gfm", parse(input, "github").tree);

  const highlightFinalFixture = (name: string) =>
    readFileSync(
      new URL(`../fixtures/renderers/github-highlight-final-lines/${name}`, import.meta.url),
      "utf8",
    );

  const finalLineValue = "const lantern = 73;\n  needle(birch)   ";
  const finalLineSource = (value: string) => "```js\n" + value + "\n```\n";
  const finalLineHighlight = (body: string) =>
    `<div class="highlight highlight-source-js"><pre>${body}</pre></div>`;
  const finalLinePlain = (body: string, language = "js") =>
    `<pre lang="${language}"><code>${body}</code></pre>`;

  it("accepts the retained full response with an omitted JS terminal LF (#515)", () => {
    const before = highlightFinalFixture("before-markdown.html");
    const after = highlightFinalFixture("after-markdown.html");
    const source = highlightFinalFixture("before.md");
    const output = highlightFinalFixture("after-markdown.md");
    expect(before).not.toBe(after);
    expect(before).toContain('class="highlight highlight-source-js"');
    expect(before).toContain("   </pre></div>");
    expect(normalizeGithubHtml(before, "markdown", parse(source, "github").tree)).toBe(
      normalizeGithubHtml(after, "markdown", parse(output, "github").tree),
    );
    expect(normalize(highlightFinalFixture("before-gfm.html"), source)).toBe(
      normalize(highlightFinalFixture("after-gfm.html"), output),
    );
  });

  // Actual eight GitHub markdown-mode responses captured by root on 2026-10-23.
  // The response body and source/value are bound by the frozen v2 provenance.
  const finalLineCapture = JSON.parse(highlightFinalFixture("api-round5.json")) as {
    observedAt: string;
    rows: Array<{
      name: string;
      source: string;
      value: string;
      html: string;
      decoded: string;
      highlighted: boolean;
    }>;
  };
  it("retains the complete eight-response calibration catalog (#515)", () => {
    expect(finalLineCapture.rows.map(({ name }) => name)).toEqual([
      "js-finalLF0",
      "js-finalLF1",
      "js-finalLF2",
      "js-finalLF3",
      "js-empty",
      "js-blank-only",
      "js-whitespace-only-last-line",
      "text-finalLF1-control",
    ]);
  });

  it.each(finalLineCapture.rows)(
    "canonicalizes the actual $name response from its complete source value (#515)",
    ({ name, source, value, html, highlighted }) => {
      const saved = highlightFinalFixture(`observed-api/${name}.html`);
      expect(saved).toBe(html);
      expect(saved.includes('class="highlight')).toBe(highlighted);
      const tree = parse(source, "github").tree;
      const language = highlighted ? "js" : "text";
      expect(tree.children[0]).toMatchObject({ type: "code", value, lang: language });
      const normalized = normalizeGithubHtml(saved, "markdown", tree);
      expect(normalized).toBe(
        normalizeGithubHtml(finalLinePlain(value + "\n", language), "markdown", tree),
      );
      // These retained fixture values contain no HTML metacharacters. This direct
      // check prevents two accidentally unnormalized responses comparing equal.
      expect(normalized).toContain(
        `<pre data-source-language="${language}" data-source-meta=""><code>${value}</code></pre>`,
      );
    },
  );

  // Keep exact values and the observed one-LF omission. Blank-only collapse
  // is tested separately; nonempty multi-LF omissions remain unequal.
  it.each(
    [0, 1, 2, 3].flatMap((sourceLFs) =>
      Array.from({ length: sourceLFs + 1 }, (_, renderedLFs) => ({
        sourceLFs,
        renderedLFs,
      })).filter(({ renderedLFs }) => renderedLFs >= sourceLFs - 1),
    ),
  )(
    "keeps all $sourceLFs source LFs when a highlight retains $renderedLFs (#515)",
    ({ sourceLFs, renderedLFs }) => {
      const value = finalLineValue + "\n".repeat(sourceLFs);
      const source = finalLineSource(value);
      expect(parse(source, "github").tree.children[0]).toMatchObject({ type: "code", value });
      expect(normalize(finalLineHighlight(finalLineValue + "\n".repeat(renderedLFs)), source)).toBe(
        normalize(finalLinePlain(value + "\n"), source),
      );
    },
  );

  it("uses capture presence for the actual empty/blank-only highlighted responses (#515)", () => {
    for (const value of ["", "\n\n"]) {
      const source = finalLineSource(value);
      expect(parse(source, "github").tree.children[0]).toMatchObject({ type: "code", value });
      expect(normalize(finalLineHighlight(""), source)).toBe(
        normalize(finalLinePlain(value + "\n"), source),
      );
    }
  });

  it("retains source blank-line counts for the observed highlighting shapes (#515)", () => {
    const canonical = [0, 1, 2, 3].map((count) =>
      normalize(
        finalLineHighlight(finalLineValue + "\n".repeat(Math.max(0, count - 1))),
        finalLineSource(finalLineValue + "\n".repeat(count)),
      ),
    );
    // The first two source values have identical highlighted bytes.
    expect(new Set(canonical).size).toBe(canonical.length);
    expect(normalize(finalLineHighlight(""), finalLineSource(""))).not.toBe(
      normalize(finalLineHighlight(""), finalLineSource("\n\n")),
    );
  });

  it("keeps plain omissions and extra response LFs outside the new allowance (#515)", () => {
    const value = finalLineValue + "\n\n";
    const source = finalLineSource(value);
    const canonical = normalize(finalLinePlain(value + "\n"), source);
    for (const body of [finalLineValue, finalLineValue + "\n"]) {
      expect(normalize(finalLinePlain(body), source)).not.toBe(canonical);
    }
    expect(normalize(finalLineHighlight(value + "\n\n"), source)).not.toBe(canonical);
    expect(normalize(finalLinePlain(value + "\n\n"), source)).not.toBe(canonical);
  });

  it("declines unobserved multi-LF omissions from nonempty highlights (#515)", () => {
    const value = finalLineValue + "\n\n\n";
    const source = finalLineSource(value);
    const canonical = normalize(finalLinePlain(value + "\n"), source);
    for (const body of [finalLineValue, finalLineValue + "\n"])
      expect(normalize(finalLineHighlight(body), source)).not.toBe(canonical);
  });

  it("keeps all non-LF bytes and leading/interior newlines exact (#515)", () => {
    const value = finalLineValue + "\n\n";
    const source = finalLineSource(value);
    const canonical = normalize(finalLinePlain(value + "\n"), source);
    for (const body of [
      finalLineValue.replace("73", "74"),
      finalLineValue.replace("  needle", " needle"),
      finalLineValue.slice(0, -1), // one of the three final spaces
      finalLineValue.trimEnd(),
      finalLineValue.replace("needle", "missing"),
      finalLineValue.replaceAll("\n", "\n\n"),
    ]) {
      expect(normalize(finalLineHighlight(body), source)).not.toBe(canonical);
    }
    const leading = "\n" + value;
    expect(normalize(finalLineHighlight(finalLineValue), finalLineSource(leading))).not.toBe(
      normalize(finalLinePlain(leading + "\n"), finalLineSource(leading)),
    );
    for (const spaces of ["  ", "\t", " \t  "]) {
      const whitespaceLine = finalLineValue + "\n" + spaces + "\n\n";
      const whitespaceSource = finalLineSource(whitespaceLine);
      expect(normalize(finalLineHighlight(finalLineValue), whitespaceSource)).not.toBe(
        normalize(finalLinePlain(whitespaceLine + "\n"), whitespaceSource),
      );
      // Only the observed single-LF omission retains eligibility here.
      expect(
        normalize(finalLineHighlight(finalLineValue + "\n" + spaces), whitespaceSource),
      ).not.toBe(normalize(finalLinePlain(whitespaceLine + "\n"), whitespaceSource));
      expect(
        normalize(finalLineHighlight(finalLineValue + "\n" + spaces + "\n"), whitespaceSource),
      ).toBe(normalize(finalLinePlain(whitespaceLine + "\n"), whitespaceSource));
    }
  });

  it("retains escaping, wrapper-count and raw-pre gates for shortened highlights (#515)", () => {
    const value = finalLineValue + "\n\n";
    const source = finalLineSource(value);
    const canonical = normalize(finalLinePlain(value + "\n"), source);
    expect(normalize(finalLineHighlight(finalLineValue + "<b>"), source)).not.toBe(canonical);
    expect(normalize(finalLineHighlight(finalLineValue).repeat(2), source)).not.toBe(canonical);
    const raw = "<pre>" + value + "</pre>\n";
    expect(normalize(finalLineHighlight(finalLineValue), raw)).not.toBe(
      normalize(finalLinePlain(value + "\n"), raw),
    );
  });

  it("accepts the retained highlighting and final-line variation for unchanged source", () => {
    expect(normalize(highlighted)).toBe(normalize(fallback, source.replaceAll("~~~", "```")));
  });

  it("keeps actual source code changes, including final blank lines, significant", () => {
    expect(normalize(fallback)).not.toBe(
      normalize(fallback.replace("52", "53"), source.replace("52", "53")),
    );
    expect(normalize(fallback)).not.toBe(
      normalize(fallback.replace("\n\n</code>", "\n</code>"), source.replace("\n\n~~~", "\n~~~")),
    );
    expect(normalize(fallback)).not.toBe(normalize(fallback.replace("  lantern", " lantern")));
    expect(normalize(fallback)).not.toBe(normalize(fallback.replace("lantern", "missing")));
  });

  it("compares code language, metadata, count, escaping, and raw HTML strictly", () => {
    expect(normalize(fallback)).not.toBe(normalize(fallback, source.replace("md\n", "js\n")));
    expect(normalize(fallback)).not.toBe(normalize(fallback, source.replace("md\n", "md title\n")));
    expect(normalize(fallback)).not.toBe(normalize(fallback + fallback));
    expect(normalize(highlighted, "<pre><code>raw</code></pre>\n")).not.toBe(
      normalize(fallback, "<pre><code>raw</code></pre>\n"),
    );
    const htmlSource = "```html\n<span>text</span>\n```\n";
    expect(
      normalize("<pre><code>&lt;span&gt;text&lt;/span&gt;\n</code></pre>", htmlSource),
    ).not.toBe(normalize("<pre><code><span>text</span>\n</code></pre>", htmlSource));
  });

  it("keeps hexadecimal and whitespace content inside code literal", () => {
    const a = "a".repeat(32),
      b = "b".repeat(32);
    expect(normalize(`<pre><code>${a}\n</code></pre>`, `\`\`\`\n${a}\n\`\`\`\n`)).not.toBe(
      normalize(`<pre><code>${b}\n</code></pre>`, `\`\`\`\n${b}\n\`\`\`\n`),
    );
    expect(normalize(`<p><code>${a}</code></p>`, `\`${a}\`\n`)).not.toBe(
      normalize(`<p><code>${b}</code></p>`, `\`${b}\`\n`),
    );
  });

  it("keeps visible hexadecimal text and ordinary attribute values significant (#523)", () => {
    const a = "a".repeat(32),
      b = "b".repeat(32);
    for (const html of [
      "<p>VALUE</p>",
      '<p id="VALUE">same</p>',
      '<a href="https://example.com/VALUE">same</a>',
    ])
      expect(normalize(html.replaceAll("VALUE", a), a)).not.toBe(
        normalize(html.replaceAll("VALUE", b), b),
      );
  });

  it("normalizes only generated footnote response identifiers (#523)", () => {
    const a = "13b2bef4044873100ccc1e1a3cb0bb74",
      b = "b".repeat(32);
    const input = "a[^n] b[^n] c[^lab-el]\n\n[^n]: note\n[^lab-el]: other\n";
    // GitHub's live gfm API response, captured 2026-10-22. It has repeated
    // references and no data-run-id on the generated section.
    const response = readFileSync(
      new URL("../fixtures/renderers/github-footnotes.html", import.meta.url),
      "utf8",
    );
    const html = (id: string) => response.replaceAll(a, id);
    expect(normalize(html(a), input)).toBe(normalize(html(b), input));
    const oldShape = (id: string) =>
      html(id).replace(
        '<section data-footnotes=""',
        `<section data-run-id="${id}" data-footnotes=""`,
      );
    expect(normalize(oldShape(a), input)).toBe(normalize(oldShape(b), input));
    expect(normalize(`<p data-run-id="${a}">text</p>`, input)).not.toBe(
      normalize(`<p data-run-id="${b}">text</p>`, input),
    );
    expect(normalize(html(a), input)).not.toBe(
      normalize(html(a).replace(`fn-lab-el-${a}`, `fn-lab-el-${b}`), input),
    );
    expect(normalize(html(a), input)).not.toBe(normalize(html(a).replace("other", b), input));
    expect(normalize(html(a), html(a))).not.toBe(normalize(html(b), html(b)));
  });

  const rawHtmlMathFixture = (name: string) =>
    readFileSync(
      new URL(`../fixtures/renderers/github-raw-html-math/${name}`, import.meta.url),
      "utf8",
    );

  it("normalizes the captured generated math ID inside raw HTML (#588)", () => {
    const input = rawHtmlMathFixture("before.md");
    const output = rawHtmlMathFixture("after-gfm.md");
    const before = rawHtmlMathFixture("before-gfm.html");
    const after = rawHtmlMathFixture("after-gfm.html");
    // This is the real missed eligibility path, not an ordinary primary math node.
    const pending: Nodes[] = [parse(input, "github").tree];
    const kinds: string[] = [];
    while (pending.length) {
      const node = pending.pop()!;
      kinds.push(node.type);
      if ("children" in node) pending.push(...node.children);
    }
    expect(kinds).toContain("html");
    expect(kinds).not.toContain("math");
    expect(kinds).not.toContain("inlineMath");
    expect(before).not.toBe(after);
    expect(normalize(before, input)).toBe(normalize(after, output));
    // The other actual API mode was equal already; preserve that control.
    expect(rawHtmlMathFixture("before-markdown.html")).toBe(
      rawHtmlMathFixture("after-markdown.html"),
    );
    expect(
      normalizeGithubHtml(
        rawHtmlMathFixture("before-markdown.html"),
        "markdown",
        parse(input, "github").tree,
      ),
    ).toBe(
      normalizeGithubHtml(
        rawHtmlMathFixture("after-markdown.html"),
        "markdown",
        parse(output, "github").tree,
      ),
    );
  });

  it("keeps raw-HTML math content, class and ordinary IDs significant (#523, #588)", () => {
    const input = rawHtmlMathFixture("before.md");
    const response = rawHtmlMathFixture("before-gfm.html");
    expect(response).toContain("$x^2$");
    expect(response).toContain('class="js-inline-math"');
    for (const other of [
      response.replace("$x^2$", "$x^3$"),
      response.replace('class="js-inline-math"', 'class="js-display-math"'),
      response.replace('style="display: inline-block"', 'style="display: block"'),
    ]) {
      expect(other).not.toBe(response);
      expect(normalize(response, input)).not.toBe(normalize(other, input));
    }
    const a = "a".repeat(32),
      b = "b".repeat(32);
    for (const template of [
      "<p>VALUE</p>",
      '<p id="VALUE">same</p>',
      '<p data-run-id="VALUE">same</p>',
      '<a href="https://example.com/VALUE">same</a>',
      '<math-renderer id="VALUE">$x^2$</math-renderer>',
      "<pre><code>VALUE\n</code></pre>",
      "<p><code>VALUE</code></p>",
      '<pre><code>&lt;math-renderer data-run-id="VALUE"&gt;$x^2$&lt;/math-renderer&gt;</code></pre>',
    ])
      expect(normalize(template.replaceAll("VALUE", a), input)).not.toBe(
        normalize(template.replaceAll("VALUE", b), input),
      );
  });

  it("rejects authored math/ID lookalikes regardless of source HTML case (#523, #588)", () => {
    const response = rawHtmlMathFixture("before-gfm.html");
    const other = response.replace(/data-run-id="[0-9a-f]{32}"/, `data-run-id="${"b".repeat(32)}"`);
    expect(other).not.toBe(response);
    const rawInput = "<div>\n$x^2$\n</div>\n";
    for (const authored of [
      "<math-renderer>authored</math-renderer>",
      "<MATH-RENDERER>authored</MATH-RENDERER>",
      '<div data-run-id="authored">text</div>',
      '<DIV DATA-RUN-ID="authored">text</DIV>',
    ]) {
      const input = rawInput + "\n" + authored + "\n";
      expect(normalize(response, input)).not.toBe(normalize(other, input));
    }
  });

  it("requires source evidence and the exact generated math element/attribute (#588)", () => {
    const a = "a".repeat(32),
      b = "b".repeat(32);
    const response = (tag: string, id: string) => `<${tag} data-run-id="${id}">$x^2$</${tag}>`;
    // A response-shaped string alone is not permission to erase an ID.
    expect(normalize(response("math-renderer", a), "<div>ordinary</div>\n")).not.toBe(
      normalize(response("math-renderer", b), "<div>ordinary</div>\n"),
    );
    const input = "<div>\n$x^2$\n</div>\n";
    for (const tag of ["p", "math-renderer-extra", "math-renderer:extra"])
      expect(normalize(response(tag, a), input)).not.toBe(normalize(response(tag, b), input));
    for (const id of ["short", "a".repeat(31), "a".repeat(33), "A".repeat(32)])
      expect(normalize(response("math-renderer", id), input)).not.toBe(
        normalize(response("math-renderer", b), input),
      );
  });

  it("normalizes generated math response IDs while retaining its content (#523)", () => {
    const input = "$$\nx = signal\n$$\n";
    const response = readFileSync(
      new URL("../fixtures/renderers/github-math.html", import.meta.url),
      "utf8",
    );
    const other = response.replace(/data-run-id="[0-9a-f]{32}"/, `data-run-id="${"b".repeat(32)}"`);
    expect(normalize(response, input)).toBe(normalize(other, input));
    expect(normalize(response, input)).not.toBe(normalize(other.replace("signal", "other"), input));
    expect(normalize(response, response)).not.toBe(normalize(other, other));
    expect(normalize(response, input + response)).not.toBe(normalize(other, input + other));
  });

  it("handles GitHub's generated fenced math without normalizing ordinary code (#523)", () => {
    const input = "```math\nx = signal\n```\n";
    const response = readFileSync(
      new URL("../fixtures/renderers/github-fenced-math.html", import.meta.url),
      "utf8",
    );
    const other = response.replace(/data-run-id="[0-9a-f]{32}"/, `data-run-id="${"b".repeat(32)}"`);
    expect(normalize(response, input)).toBe(normalize(other, input));
    expect(normalize(response, input)).not.toBe(normalize(other.replace("signal", "other"), input));
    expect(normalize(response, input.replace("math", "text"))).not.toBe(
      normalize(other, input.replace("math", "text")),
    );
    expect(normalize(response, response)).not.toBe(normalize(other, other));
  });
});

describe("Obsidian Live Preview normalizer", () => {
  const source = readFileSync(
    new URL("../../scripts/obsidian/obsidian.e2e.mjs", import.meta.url),
    "utf8",
  );
  const body = source.slice(
    source.indexOf("function cleanHtml("),
    source.indexOf("/** The documents to format:"),
  );
  type NormalizerFactory = (normalize: typeof normalizeHtml) => {
    livePreview: (
      lines: { kind: string; continuation?: boolean; marker?: string; runs: string[][] }[],
    ) => string[];
  };
  // The probe executes the repository's browser helper with its dependency injected.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Verbatim helper probe.
  const normalizerFactory = new Function(
    "normalizeHtml",
    `${body}; return { livePreview };`,
  ) as NormalizerFactory;
  const { livePreview } = normalizerFactory(normalizeHtml);

  describe("heading and normalized-empty records (#544, #545)", () => {
    const normalized = (lines: unknown[]) =>
      (livePreview as (lines: unknown[]) => string[])(structuredClone(lines));
    const line = (text: string, kind = "", classes = "") => ({
      kind,
      runs: [[classes, text]],
    });
    const blank = { kind: "", runs: [] };
    const heading = (text: string, level = 1) =>
      line(text, `HyperMD-header HyperMD-header-${level}`, `cm-header-${level}`);

    it.each([
      ["=", 1, "HyperMD-header HyperMD-header-1"],
      ["===", 1, "HyperMD-header-line HyperMD-header-line-1"],
      ["---", 2, "HyperMD-header-line HyperMD-header-line-2"],
    ] as const)(
      "ignores the actual styled %s underline without adding a heading",
      (marker, level, kind) => {
        // Obsidian 1.14.4 gives a single = the native heading kind, unlike ===.
        const underline = line(
          marker,
          kind,
          `cm-formatting cm-formatting-header cm-formatting-header-${level} cm-header-${level}`,
        );
        const first = heading("alpha", level);
        const second = heading("beta", level);
        expect(normalized([first, underline])).toEqual(normalized([first]));
        expect(normalized([first, underline, second, underline])).toEqual(
          normalized([first, blank, second]),
        );
        expect(normalized([first, underline, second, underline])).toHaveLength(2);
      },
    );

    it("retains native empty headings, literal equals content, levels, and styles", () => {
      const first = heading("alpha");
      const empty = { kind: first.kind, runs: [] };
      expect(normalized([empty, first])).toHaveLength(2);
      expect(normalized([empty, first])).not.toEqual(normalized([first]));
      expect(normalized([heading("=")])).not.toEqual(normalized([empty]));
      expect(normalized([first, heading("beta")])).not.toEqual(normalized([heading("alpha beta")]));
      expect(normalized([first, heading("beta")])).not.toEqual(
        normalized([first, heading("beta", 2)]),
      );
      const emphasized = line("beta", first.kind, "cm-em cm-header-1");
      const strong = line("beta", first.kind, "cm-header-1 cm-strong");
      expect(normalized([first, emphasized])).not.toEqual(normalized([first, strong]));
    });

    it("omits only normalized-empty unstyled records after preserving paragraph splits", () => {
      const before = line("before");
      const after = line("after");
      expect(normalized([line("***")])).toEqual([]);
      expect(normalized([before, blank, line("---"), blank, after])).toEqual(
        normalized([before, blank, after]),
      );
      expect(normalized([before, blank, line("---"), blank, after])).toHaveLength(2);
      expect(normalized([before, line("***"), after])).not.toEqual(
        normalized([before, blank, line("---"), blank, after]),
      );
      // The reduced raw-HTML failure already has a blank before the marker.
      expect(normalized([before, blank, line("***"), after])).toEqual(
        normalized([before, blank, line("---"), blank, after]),
      );
    });

    it.each(["cm-inline-code", "cm-highlight", "cm-strikethrough"])(
      "retains punctuation with the visible %s style",
      (classes) => {
        expect(normalized([line("=", "", classes)])).toHaveLength(1);
        expect(normalized([line("=", "", classes)])).not.toEqual(
          normalized([line("-", "", classes)]),
        );
      },
    );

    it("retains code, structural empty records, widgets, and embed payloads", () => {
      expect(normalized([line("=", "HyperMD-codeblock")])).not.toEqual(
        normalized([line("-", "HyperMD-codeblock")]),
      );
      expect(normalized([{ kind: "HyperMD-codeblock", runs: [] }])).toHaveLength(1);
      expect(normalized([{ kind: "HyperMD-hr", runs: [] }])).toHaveLength(1);
      for (const widget of ["", "cm-table-widget"])
        expect(normalized([{ widget, html: "" }])).toHaveLength(1);
      expect(normalized([line("first.png", "", " embed")])).not.toEqual(
        normalized([line("second.png", "", " embed")]),
      );
    });
  });

  it("ignores terminal styled fence separators while retaining code and metadata (#533)", () => {
    const line = (
      value: string,
      kind = "HyperMD-codeblock-begin",
      classes = "cm-formatting cm-formatting-code-block",
    ) => ({
      kind: `HyperMD-codeblock ${kind}`,
      runs: [[classes, value]],
    });
    expect(livePreview([line("~~~js  \t")])).toEqual(livePreview([line("```js")]));
    expect(livePreview([line("~~~ \t", "HyperMD-codeblock-end")])).toEqual(
      livePreview([line("```", "HyperMD-codeblock-end")]),
    );
    expect(livePreview([line("~~~js one  two")])).not.toEqual(livePreview([line("```js one two")]));
    expect(livePreview([line("x  ", "", "")])).not.toEqual(livePreview([line("x", "", "")]));
    expect(livePreview([line("~~~js  ", "HyperMD-codeblock-begin", "")])).not.toEqual(
      livePreview([line("~~~js", "HyperMD-codeblock-begin", "")]),
    );
  });

  it("retains empty unchecked checkbox widgets and their count (#522)", () => {
    const task = {
      kind: "HyperMD-list-line HyperMD-list-line-1 HyperMD-task-line",
      marker: "-",
      runs: [[" checkbox", " "]],
    };
    expect(livePreview([task])).not.toEqual(livePreview([task, task]));
    expect(livePreview([task])).not.toEqual(
      livePreview([{ kind: task.kind, marker: "-", runs: [] }]),
    );
    expect(livePreview([task])).not.toEqual(livePreview([{ ...task, runs: [[" checkbox", "x"]] }]));
  });

  it("keeps task list delimiter boundaries when widgets hide marker classes (#512)", () => {
    const task = (marker: string, text: string, checked = " ") => ({
      kind: "HyperMD-list-line HyperMD-list-line-1 HyperMD-task-line",
      marker,
      runs: [
        [" checkbox", checked],
        ["", text],
      ],
    });
    const blank = { kind: "", runs: [] };
    expect(livePreview([task("*", "first"), task("+", "second", "x")])).toEqual(
      livePreview([task("-", "first"), blank, task("*", "second", "x")]),
    );
    expect(livePreview([task("*", "first"), task("*", "second")])).not.toEqual(
      livePreview([task("*", "first"), blank, task("*", "second")]),
    );
    expect(livePreview([task("*", "first")])).not.toEqual(livePreview([task("*", "first", "x")]));
    // Empty unchecked ordered tasks have no non-whitespace run after the widget.
    expect(() => livePreview([task("1.", " ")])).not.toThrow();
    expect(livePreview([task("1.", " "), task("2)", "second")])).toEqual(
      livePreview([task("1.", " "), blank, task("2)", "second")]),
    );
  });

  it("normalizes only font-style whitespace while retaining styled characters (#514)", () => {
    const line = (runs: string[][]) => ({ kind: "", runs });
    const plain = [
      ["", "a "],
      ["cm-em", "word"],
    ];
    expect(livePreview([line(plain)])).toEqual(
      livePreview([
        line([
          ["", "a"],
          ["cm-em", " word"],
        ]),
      ]),
    );
    expect(livePreview([line(plain)])).toEqual(
      livePreview([
        line([
          ["", "a "],
          ["cm-em", " word"],
        ]),
      ]),
    );
    expect(livePreview([line(plain)])).not.toEqual(livePreview([line([["", "a word"]])]));
    expect(livePreview([line([["cm-strong", "basket engine"]])])).toEqual(
      livePreview([
        line([
          ["cm-strong", "basket"],
          ["", " "],
          ["cm-strong", "engine"],
        ]),
      ]),
    );
    // A nested quote's unstyled `>` separates the soft-line join from the
    // following word until quote punctuation is removed later in normalization.
    const quote = (runs: string[][]) => ({ kind: "HyperMD-quote HyperMD-quote-2", runs });
    const quote1 = "cm-formatting cm-formatting-quote cm-formatting-quote-1";
    const quote2 = "cm-formatting cm-formatting-quote cm-formatting-quote-2";
    expect(
      livePreview([
        quote([
          [quote1, ">"],
          ["", ">"],
          ["cm-strong", "basket"],
          ["", " "],
          ["cm-strong", "engine"],
        ]),
      ]),
    ).toEqual(
      livePreview([
        quote([
          [quote1, ">"],
          ["", ">"],
          ["cm-strong", "basket"],
        ]),
        quote([
          [quote1, ">"],
          ["", ">"],
          [quote2, " "],
          ["cm-strong", "engine"],
        ]),
      ]),
    );
    for (const style of ["cm-inline-code", "cm-highlight", "cm-strikethrough"])
      expect(
        livePreview([
          line([
            ["", "a "],
            [style, "word"],
          ]),
        ]),
      ).not.toEqual(
        livePreview([
          line([
            ["", "a"],
            [style, " word"],
          ]),
        ]),
      );
  });

  it("ignores empty table source rows while retaining table content (#497)", () => {
    const widget = { widget: "cm-table-widget", html: "<table><tr><td>a</td></tr></table>" };
    const empty = { kind: "HyperMD-table-row HyperMD-table-row-1", runs: [] };
    const visible = { ...empty, runs: [["", "actual text"]] };
    // The normalizer accepts both raw lines and widgets read from Obsidian.
    const normalize = livePreview as (lines: unknown[]) => string[];
    expect(normalize([empty, widget])).toEqual(normalize([widget]));
    expect(normalize([visible, widget])).not.toEqual(normalize([widget]));
    expect(normalize([{ ...empty, runs: [[" embed", "image.png"]] }, widget])).not.toEqual(
      normalize([widget]),
    );
    expect(normalize([{ kind: "HyperMD-codeblock", runs: [] }])).toHaveLength(1);
  });

  describe("styled list-family boundaries (#440)", () => {
    type PreviewLine = { kind: string; continuation?: boolean; runs: string[][] };
    const plain = (text: string): PreviewLine => ({ kind: "", runs: [["", text]] });
    const blank = (): PreviewLine => ({ kind: "", runs: [] });
    const list = (family: "ol" | "ul", text: string, depth = 1): PreviewLine => ({
      kind: `HyperMD-list-line HyperMD-list-line-${depth}`,
      runs:
        family === "ol"
          ? [
              ["cm-formatting cm-formatting-list cm-formatting-list-ol", "1. "],
              ["", text],
            ]
          : [
              ["cm-formatting cm-formatting-list cm-formatting-list-ul list-bullet", "*"],
              ["cm-formatting cm-formatting-list cm-formatting-list-ul", " "],
              ["", text],
            ],
    });
    const continuation = (text: string): PreviewLine => ({
      kind: "HyperMD-list-line HyperMD-list-line-1",
      continuation: true,
      runs: [["", `   ${text}`]],
    });
    const quote = (runs: string[][]): PreviewLine => ({
      kind: "HyperMD-quote HyperMD-quote-1",
      runs: [
        ["cm-formatting cm-formatting-quote cm-formatting-quote-1", ">"],
        ["cm-formatting cm-formatting-quote cm-formatting-quote-1", " "],
        ...runs,
      ],
    });
    const normalized = (lines: PreviewLine[]) => livePreview(structuredClone(lines));

    it.each([
      ["ol", "ul"],
      ["ul", "ol"],
    ] as const)("recognizes an actual %s to %s transition without a blank", (first, second) => {
      for (const depth of [1, 2]) {
        const before = [list(first, "a", depth), list(second, "b", depth)];
        const after = [list(first, "a", depth), blank(), list(second, "b", depth)];
        expect(normalized(before)).toEqual(normalized(after));
        expect(normalized(before)).toHaveLength(2);
      }
    });

    it("keeps a list's family across soft continuations and consecutive items", () => {
      const first = [list("ol", "a"), continuation("continued"), list("ol", "b")];
      const second = [list("ul", "c"), continuation("more")];
      expect(normalized(first)).toHaveLength(1);
      expect(normalized([...first, ...second])).toEqual(normalized([...first, blank(), ...second]));
      expect(normalized([...first, ...second])).toHaveLength(2);
      expect(normalized(first)).not.toEqual(
        normalized([list("ol", "a"), blank(), continuation("continued"), list("ol", "b")]),
      );
    });

    it("still detects changed item text, marker family, and nesting depth", () => {
      const original = [list("ol", "a"), list("ul", "b")];
      expect(normalized(original)).not.toEqual(
        normalized([list("ol", "a"), list("ul", "changed")]),
      );
      expect(normalized(original)).not.toEqual(normalized([list("ol", "a"), list("ol", "b")]));
      expect(normalized(original)).not.toEqual(normalized([list("ol", "a"), list("ul", "b", 2)]));
    });

    it("still detects genuine paragraph and raw-HTML paragraph splits", () => {
      expect(normalized([plain("a"), plain("b")])).not.toEqual(
        normalized([plain("a"), blank(), plain("b")]),
      );
      const html = [list("ol", "a <b> b"), plain("c")];
      expect(normalized([...html, plain("1. d")])).not.toEqual(
        normalized([...html, blank(), plain("1. d")]),
      );
    });

    it.each([
      [quote([["", "a"]]), quote([["", "- b"]])],
      [
        quote([
          ["", "## "],
          ["cm-em", "a"],
        ]),
        quote([["cm-em", "b"]]),
      ],
    ])("keeps a real blank-line split in unstyled quoted syntax", (first, second) => {
      // Raw Obsidian probes: these markers have neither heading nor list classes.
      expect(normalized([first, second])).not.toEqual(normalized([first, quote([]), second]));
    });

    it("keeps blank quote lines meaningful and ignores redundant first-line list classes (#400, #410)", () => {
      const first = quote([["", "a"]]);
      const second = quote([["", "b"]]);
      const redundant = { ...first, kind: `HyperMD-list-line HyperMD-list-line-1 ${first.kind}` };
      expect(normalized([redundant, second])).toEqual(normalized([first, second]));
      expect(normalized([first, second])).not.toEqual(normalized([first, quote([]), second]));
      expect(normalized([first, second])).not.toEqual(
        normalized([first, { ...second, kind: "HyperMD-quote HyperMD-quote-2" }]),
      );
    });

    it("does not infer a family from a marker-like run after visible content", () => {
      const trailing = {
        ...list("ul", "b"),
        runs: [["", "visible content "], ...list("ul", "b").runs],
      };
      expect(normalized([list("ol", "a"), trailing])).not.toEqual(
        normalized([list("ol", "a"), blank(), trailing]),
      );
    });
  });

  describe("ordered marker separators across soft lines (#443)", () => {
    type PreviewLine = { kind: string; continuation?: boolean; runs: string[][] };
    const classes = "cm-formatting cm-formatting-list cm-formatting-list-ol";
    const marker = (text: string, depth = 1): PreviewLine => ({
      kind: `HyperMD-list-line HyperMD-list-line-${depth}`,
      runs: [[classes, text]],
    });
    const prose = (): PreviewLine => ({
      kind: "",
      runs: [
        ["", "Some "],
        ["cm-em", "words"],
        ["", " after the marker."],
      ],
    });
    const joined = (text: string, depth = 1): PreviewLine => ({
      ...marker(text, depth),
      runs: [...marker(text).runs, ...prose().runs],
    });
    const normalized = (lines: PreviewLine[]) => livePreview(structuredClone(lines));
    it.each(["1. ", "1234567890. ", "42)\t"])("keeps the same separator role for %j", (text) => {
      for (const depth of [1, 2]) {
        const before = [marker(text, depth), prose()];
        const after = [joined(text, depth)];
        expect(normalized(before)).toEqual(normalized(after));
        expect(normalized(after)[0]).toContain(`{${classes}}#.{/} Some`);
      }
    });
    it("keeps text, emphasis, marker family, and depth changes detectable", () => {
      const original = normalized([marker("1234567890. "), prose()]);
      const changedText = joined("1234567890. ");
      changedText.runs[1]![1] = "Changed ";
      const changedStyle = joined("1234567890. ");
      changedStyle.runs[2]![0] = "cm-strong";
      const changedFamily = joined("1234567890. ");
      changedFamily.runs[0] = [
        "cm-formatting cm-formatting-list cm-formatting-list-ul list-bullet",
        "-",
      ];
      for (const changed of [changedText, changedStyle, changedFamily, joined("1234567890. ", 2)])
        expect(normalized([changed])).not.toEqual(original);
    });
    it("keeps genuine blanks and the loss of an actual styled marker detectable", () => {
      const original = normalized([marker("1234567890. "), prose()]);
      expect(normalized([marker("1234567890. "), { kind: "", runs: [] }, prose()])).not.toEqual(
        original,
      );
      expect(normalized([{ kind: "", runs: [["", "1234567890."]] }, prose()])).not.toEqual(
        original,
      );
      expect(
        normalized([{ kind: "", runs: [["", "1234567890.Some words after the marker."]] }]),
      ).not.toEqual(original);
    });
    it.each(["quote", "code", "inline-code", "nonleading", "incomplete"])(
      "keeps separator styles outside the genuine leading marker (%s)",
      (control) => {
        const styled = joined("1. ");
        const split = joined("1.");
        split.runs.splice(1, 0, ["", " "]);
        if (control === "quote") {
          styled.kind += " HyperMD-quote HyperMD-quote-1";
          split.kind = styled.kind;
        } else if (control === "code") {
          styled.kind += " HyperMD-codeblock";
          split.kind = styled.kind;
        } else if (control === "inline-code") {
          styled.runs[0]![0] += " cm-inline-code";
          split.runs[0]![0] += " cm-inline-code";
        } else if (control === "nonleading") {
          styled.runs.unshift(["", "visible "]);
          split.runs.unshift(["", "visible "]);
        } else {
          styled.runs[0]![1] = "1. text ";
          split.runs[0]![1] = "1. text";
        }
        expect(normalized([styled])).not.toEqual(normalized([split]));
      },
    );
  });

  it("preserves inline-code padding across soft-line joins while keeping code changes detectable (#421)", () => {
    const singlePaddedSource = [
      {
        continuation: false,
        kind: "",
        runs: [
          ["", "Words before "],
          ["cm-inline-code", "code  "],
        ],
      },
      {
        continuation: false,
        kind: "",
        runs: [["", "neighbor words after the code span, enough text to wrap at thirty columns."]],
      },
      { continuation: false, kind: "", runs: [] },
    ];
    const singlePaddedFormatted = [
      {
        continuation: false,
        kind: "",
        runs: [
          ["", "Words before "],
          ["cm-inline-code", "code  "],
          ["", " neighbor"],
        ],
      },
      { continuation: false, kind: "", runs: [["", "words after the code span,"]] },
      { continuation: false, kind: "", runs: [["", "enough text to wrap at thirty"]] },
      { continuation: false, kind: "", runs: [["", "columns."]] },
      { continuation: false, kind: "", runs: [] },
    ];
    const singleUnpaddedSource = [
      {
        continuation: false,
        kind: "",
        runs: [
          ["", "Words before "],
          ["cm-inline-code", "code"],
        ],
      },
      {
        continuation: false,
        kind: "",
        runs: [["", "neighbor words after the code span, enough text to wrap at thirty columns."]],
      },
      { continuation: false, kind: "", runs: [] },
    ];
    const singleUnpaddedFormatted = [
      {
        continuation: false,
        kind: "",
        runs: [
          ["", "Words before "],
          ["cm-inline-code", "code"],
          ["", " neighbor"],
        ],
      },
      { continuation: false, kind: "", runs: [["", "words after the code span,"]] },
      { continuation: false, kind: "", runs: [["", "enough text to wrap at thirty"]] },
      { continuation: false, kind: "", runs: [["", "columns."]] },
      { continuation: false, kind: "", runs: [] },
    ];

    const doublePaddedSource = [
      {
        continuation: false,
        kind: "",
        runs: [
          ["", "Words "],
          ["cm-inline-code", " code `   "],
        ],
      },
      {
        continuation: false,
        kind: "",
        runs: [["", "neighbor words after the code span, enough text to wrap at thirty columns."]],
      },
      { continuation: false, kind: "", runs: [] },
    ];
    const doublePaddedFormatted = [
      {
        continuation: false,
        kind: "",
        runs: [
          ["", "Words "],
          ["cm-inline-code", " code `   "],
          ["", " neighbor"],
        ],
      },
      { continuation: false, kind: "", runs: [["", "words after the code span,"]] },
      { continuation: false, kind: "", runs: [["", "enough text to wrap at thirty"]] },
      { continuation: false, kind: "", runs: [["", "columns."]] },
      { continuation: false, kind: "", runs: [] },
    ];
    const doubleUnpaddedSource = [
      {
        continuation: false,
        kind: "",
        runs: [
          ["", "Words "],
          ["cm-inline-code", " code ` "],
        ],
      },
      {
        continuation: false,
        kind: "",
        runs: [["", "neighbor words after the code span, enough text to wrap at thirty columns."]],
      },
      { continuation: false, kind: "", runs: [] },
    ];
    const doubleUnpaddedFormatted = [
      {
        continuation: false,
        kind: "",
        runs: [
          ["", "Words "],
          ["cm-inline-code", " code ` "],
          ["", " neighbor"],
        ],
      },
      { continuation: false, kind: "", runs: [["", "words after the code span,"]] },
      { continuation: false, kind: "", runs: [["", "enough text to wrap at thirty"]] },
      { continuation: false, kind: "", runs: [["", "columns."]] },
      { continuation: false, kind: "", runs: [] },
    ];

    expect(livePreview(singlePaddedSource)).toEqual(livePreview(singlePaddedFormatted));
    expect(livePreview(singleUnpaddedSource)).toEqual(livePreview(singleUnpaddedFormatted));
    expect(livePreview(doublePaddedSource)).toEqual(livePreview(doublePaddedFormatted));
    expect(livePreview(doubleUnpaddedSource)).toEqual(livePreview(doubleUnpaddedFormatted));

    // Actual inline-code content differences remain detectable.
    expect(livePreview(singlePaddedSource)).not.toEqual(livePreview(singleUnpaddedSource));
    expect(livePreview(singlePaddedFormatted)).not.toEqual(livePreview(singleUnpaddedFormatted));
    const doubleChanged = structuredClone(doublePaddedSource);
    doubleChanged[0]!.runs[1]![1] = " code `x  ";
    expect(livePreview(doublePaddedSource)).not.toEqual(livePreview(doubleChanged));

    // Trailing blank space in regular or styled non-code runs at a line end is still ignored (#406).
    const styledTrailingSpace = [
      {
        continuation: false,
        kind: "HyperMD-list-line HyperMD-list-line-1",
        runs: [
          ["cm-formatting cm-formatting-list cm-formatting-list-ul list-bullet", "•"],
          ["cm-formatting cm-formatting-list cm-formatting-list-ul", " "],
          ["cm-header cm-header-2", "A heading in an item ~~~ "],
        ],
      },
      {
        continuation: true,
        kind: "HyperMD-list-line HyperMD-list-line-1",
        runs: [["", "  A line below it in the item."]],
      },
    ];
    const styledTrimmed = [
      {
        continuation: false,
        kind: "HyperMD-list-line HyperMD-list-line-1",
        runs: [
          ["cm-formatting cm-formatting-list cm-formatting-list-ul list-bullet", "•"],
          ["cm-formatting cm-formatting-list cm-formatting-list-ul", " "],
          ["cm-header cm-header-2", "A heading in an item ~~~"],
        ],
      },
      {
        continuation: true,
        kind: "HyperMD-list-line HyperMD-list-line-1",
        runs: [["", "  A line below it in the item."]],
      },
    ];
    expect(livePreview(styledTrailingSpace)).toEqual(livePreview(styledTrimmed));
  });
});
