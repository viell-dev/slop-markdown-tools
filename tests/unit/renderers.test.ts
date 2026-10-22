import { readFileSync } from "node:fs";
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
    const a = "a".repeat(32),
      b = "b".repeat(32);
    const input = "text[^note]\n\n[^note]: note\n";
    const html = (id: string) =>
      `<p><a id="user-content-fnref-note-${id}" href="#user-content-fn-note-${id}">1</a></p><section data-footnotes class="footnotes" data-run-id="${id}"><ol><li id="user-content-fn-note-${id}"><p>note <a href="#user-content-fnref-note-${id}">back</a></p></li></ol></section>`;
    expect(normalize(html(a), input)).toBe(normalize(html(b), input));
    expect(normalize(`<p data-run-id="${a}">text</p>`, input)).not.toBe(
      normalize(`<p data-run-id="${b}">text</p>`, input),
    );
    expect(normalize(html(a), html(a))).not.toBe(normalize(html(b), html(b)));
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
