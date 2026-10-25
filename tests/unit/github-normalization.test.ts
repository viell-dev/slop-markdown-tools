import { readFileSync } from "node:fs";
import type { Nodes } from "mdast";
import { describe, expect, it } from "vitest";
import { normalizeGithubHtml, normalizeHtml } from "../../scripts/rendering.mjs";
import { parse } from "../../src/index.js";

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
      expect(normalize(finalLineHighlight(body + "\n"), source)).not.toBe(canonical);
    }
    const leading = "\n" + value;
    expect(normalize(finalLineHighlight(finalLineValue + "\n"), finalLineSource(leading))).not.toBe(
      normalize(finalLinePlain(leading + "\n"), finalLineSource(leading)),
    );
    for (const spaces of ["  ", "\t", " \t  "]) {
      const whitespaceLine = finalLineValue + "\n" + spaces + "\n\n";
      const whitespaceSource = finalLineSource(whitespaceLine);
      expect(normalize(finalLineHighlight(finalLineValue), whitespaceSource)).not.toBe(
        normalize(finalLinePlain(whitespaceLine + "\n"), whitespaceSource),
      );
      expect(normalize(finalLineHighlight(finalLineValue + "\n\n"), whitespaceSource)).not.toBe(
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
