import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { documentSeed, generateDocument, normalizeHtml } from "../../scripts/rendering.mjs";
import { format } from "../../src/index.js";
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
