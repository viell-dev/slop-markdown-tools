import { HtmlRenderer, Parser } from "commonmark";
import { diffLines } from "diff";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  dialects,
  format,
  lint,
  parse,
  semanticFingerprint,
} from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";
import { sentenceFixture } from "../fixtures/renderers/common.mjs";

function check(source: string, dialect: Dialect = "github", options = {}) {
  const config: Config = {
    extends: [],
    dialect,
    rules: { "style/wrap": ["warn", { mode: "sentences", width: 80, ...options }] },
  };
  const workspace = createWorkspace({}, { dialect, strictLineBreaks: true });
  const settings = { config, workspace };
  const result = format(source, settings);
  expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  expect(format(result.output, settings).output).toBe(result.output);
  expect(lint(result.output, settings).filter((d) => d.edit)).toEqual([]);
  if (result.changed) expect(lint(source, settings).some((d) => d.edit)).toBe(true);
  expect(format(source, { config: { extends: [], dialect, rules: {} }, workspace }).output).toBe(
    source,
  );
  return result.output;
}

describe("sentence wrapping", () => {
  it.each(dialects)(
    "keeps the native fixture stable with other recommended rules in %s",
    (dialect) => {
      const config: Config = {
        extends: ["recommended"],
        dialect,
        rules: { "style/wrap": ["warn", { mode: "sentences", width: 30 }] },
      };
      const settings = {
        config,
        workspace: createWorkspace({}, { dialect, strictLineBreaks: true }),
      };
      const result = format(sentenceFixture.source, settings);
      expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
      expect(result.output).toContain("First **sentence.**\n");
      expect(format(result.output, settings).output).toBe(result.output);
      expect(semanticFingerprint(parse(result.output, dialect))).toBe(
        semanticFingerprint(parse(sentenceFixture.source, dialect)),
      );
    },
  );

  it("keeps unselected paragraphs outside a ranged format", () => {
    const source = "First sentence. Second sentence.\n\nThird sentence. Fourth sentence.\n";
    const start = source.indexOf("Third");
    const config: Config = {
      extends: [],
      rules: { "style/wrap": ["warn", { mode: "sentences" }] },
    };
    const result = format(source, { config, ranges: [{ start, end: start }] });
    expect(result.output).toBe(
      "First sentence. Second sentence.\n\nThird sentence.\nFourth sentence.\n",
    );
    expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
  });

  it.each(dialects)("starts sentences independently in %s", (dialect) => {
    for (const newline of ["\n", "\r\n"]) {
      expect(check(`First sentence. Second sentence! Final question?${newline}`, dialect)).toBe(
        `First sentence.${newline}Second sentence!${newline}Final question?${newline}`,
      );
      expect(check(`First sentence.${newline}Second sentence!${newline}`, dialect)).toBe(
        `First sentence.${newline}Second sentence!${newline}`,
      );
    }
  });

  it.each(dialects)("leaves ambiguous metadata alone in %s", (dialect) => {
    const source = "---\ntitle: First. Second.\ntitle: |\n  ```js\n---\n# Body\n";
    expect(check(source, dialect)).toBe(source);
  });

  it.each(dialects)("retains inline markup while reading prose in %s", (dialect) => {
    expect(check("First **sentence.** Second _sentence._ Final sentence.\n", dialect)).toBe(
      "First **sentence.**\nSecond _sentence._\nFinal sentence.\n",
    );
    expect(check("**First sentence. Second sentence.** Final sentence.\n", dialect)).toBe(
      "**First sentence.\nSecond sentence.**\nFinal sentence.\n",
    );
    expect(check("First [sentence.](https://example.com) Next sentence.\n", dialect)).toBe(
      "First [sentence.](https://example.com)\nNext sentence.\n",
    );
    expect(check("First [sentence.][ref] Next sentence.\n\n[ref]: /guide\n", dialect)).toBe(
      "First [sentence.][ref]\nNext sentence.\n\n[ref]: /guide\n",
    );
    expect(check("First [sentence.] Next sentence.\n\n[sentence.]: /guide\n", dialect)).toBe(
      "First [sentence.]\nNext sentence.\n\n[sentence.]: /guide\n",
    );
  });

  it.each(dialects)("retains escaped and entity reference identifiers in %s", (dialect) => {
    for (const label of ["a\\]b", "a\\[b", "a&amp;b", "a\\\\b"]) {
      const source = `Read [sentence.][${label}] Next sentence.\n\n[${label}]: /target\n`;
      expect(check(source, dialect)).toBe(
        `Read [sentence.][${label}]\nNext sentence.\n\n[${label}]: /target\n`,
      );
    }
  });

  it("decodes punctuation and escapes without changing their source", () => {
    expect(check("First sentence&#46; Second sentence\\! Third sentence&period; Last one.\n")).toBe(
      "First sentence&#46;\nSecond sentence\\!\nThird sentence&period;\nLast one.\n",
    );
    expect(check("First sentence\\. **Next sentence.**\n")).toBe(
      "First sentence\\.\n**Next sentence.**\n",
    );
    expect(check("First sentence.&#32;Next sentence. Final sentence.\n")).toBe(
      "First sentence.&#32;Next sentence.\nFinal sentence.\n",
    );
  });

  it.each(dialects)("keeps opaque punctuation out of detection in %s", (dialect) => {
    expect(check("Use `First. Second.` carefully. Next sentence.\n", dialect)).toBe(
      "Use `First. Second.` carefully.\nNext sentence.\n",
    );
    expect(check("See ![First. Second.](image.png) here. Next sentence.\n", dialect)).toBe(
      "See ![First. Second.](image.png) here.\nNext sentence.\n",
    );
    expect(check("Read https://example.com/v1.2/guide. Next sentence.\n", dialect)).toBe(
      "Read https://example.com/v1.2/guide.\nNext sentence.\n",
    );
  });

  it("uses fixed English heuristics with explicit ambiguity controls", () => {
    expect(check("Dr. Smith measured 3.14 units. Next sample.\n")).toBe(
      "Dr. Smith measured 3.14 units.\nNext sample.\n",
    );
    expect(check("The service runs in the U.S. Next sample.\n")).toBe(
      "The service runs in the U.S.\nNext sample.\n",
    );
    // These are documented heuristic limits, not grammatical sentence assertions.
    expect(check("Examples include e.g. Apples and pears. Next sample.\n")).toBe(
      "Examples include e.g.\nApples and pears.\nNext sample.\n",
    );
    expect(check("She said, “Ready. Go.” Then she left.\n")).toBe(
      "She said, “Ready.\nGo.” Then she left.\n",
    );
    expect(check("أول جملة. هذه جملة ثانية؟ ثم نهاية.\n")).toBe(
      "أول جملة.\nهذه جملة ثانية؟ ثم نهاية.\n",
    );
  });

  it("keeps unspaced CJK and recognizes the spaced punctuation control", () => {
    expect(check("第一句。第二句！第三句？\n")).toBe("第一句。第二句！第三句？\n");
    expect(check("第一句。 第二句！ 第三句？\n")).toBe("第一句。\n第二句！\n第三句？\n");
    expect(check("Tjänsten är klar. Nästa försök börjar nu! Är allt sparat?\n")).toBe(
      "Tjänsten är klar.\nNästa försök börjar nu!\nÄr allt sparat?\n",
    );
  });

  it.each(dialects)("wraps long sentences and counts container prefixes in %s", (dialect) => {
    const sentence = "The service records every request in its local recovery journal.";
    expect(check(`${sentence} Next task.\n`, dialect, { width: 30 })).toBe(
      "The service records every\nrequest in its local recovery\njournal.\nNext task.\n",
    );
    expect(check(`- ${sentence} Next task.\n`, dialect, { width: 30 })).toBe(
      "- The service records every\n  request in its local\n  recovery journal.\n  Next task.\n",
    );
    expect(check("> First sentence. Second sentence.\n", dialect)).toBe(
      "> First sentence.\n> Second sentence.\n",
    );
    expect(check("- [x] First sentence. Second sentence.\n", dialect)).toBe(
      `- [x] First sentence.\n${dialect === "commonmark" ? "  " : "      "}Second sentence.\n`,
    );
  });

  it.each(dialects)("retains unsafe paragraphs and dangerous line starts in %s", (dialect) => {
    for (const source of [
      "First sentence.  \nSecond sentence. Third sentence.\n",
      "First sentence.\\\nSecond sentence. Third sentence.\n",
      "First <b>sentence.</b> Second sentence.\n",
      "{{ value }} First sentence. Second sentence.\n",
    ])
      expect(check(source, dialect)).toBe(source);
    for (const source of [
      "First sentence. # Heading text. Next sentence.\n",
      "First sentence. 1. List text. Next sentence.\n",
      "First sentence. [ref]: /url More text. Next sentence.\n",
      "First sentence. \\ Next sentence. Final sentence.\n",
    ])
      check(source, dialect, { width: 30 });
  });

  it("requires strict line breaks for Obsidian and keeps link text whole", () => {
    const source = "First sentence. Second sentence.\n";
    const config: Config = {
      extends: [],
      dialect: "obsidian",
      rules: { "style/wrap": ["warn", { mode: "sentences" }] },
    };
    expect(format(source, { config }).output).toBe(source);
    expect(check("Read [First. Second.](note.md) here. Next sentence.\n", "obsidian")).toBe(
      "Read [First. Second.](note.md)\nhere.\nNext sentence.\n",
    );
    expect(
      check(
        "> [!note] First title. Second title.\n> First sentence. Second sentence.\n",
        "obsidian",
      ),
    ).toBe("> [!note] First title. Second title.\n> First sentence.\n> Second sentence.\n");
  });

  it("counts display columns and keeps unbreakable atoms", () => {
    expect(check("漢字 漢字 漢字 漢字 漢字. Next sentence.\n", "github", { width: 20 })).toBe(
      "漢字 漢字 漢字 漢字\n漢字.\nNext sentence.\n",
    );
    expect(
      check(
        "First sentence. `a very long unbreakable code span` ends here. Next sentence.\n",
        "github",
        { width: 20, reportUnbreakable: true },
      ),
    ).toContain("`a very long unbreakable code span`");
  });

  it("preserves reference rendering when the source boundaries change", () => {
    const source =
      "First **sentence.** Read [the guide.](https://example.com) Next sentence.\n\n- First sentence. Second sentence.\n";
    const output = check(source);
    const parser = new Parser();
    const renderer = new HtmlRenderer();
    const markdown = new MarkdownIt("commonmark");
    for (const render of [
      (s: string) => renderer.render(parser.parse(s)),
      (s: string) => markdown.render(s),
    ])
      expect(render(output).replace(/\s+/g, " ")).toBe(render(source).replace(/\s+/g, " "));
  });

  it("confines reflow to the changed sentence in the fixed edit pair", () => {
    const sentences = [
      "The service records each request and stores its identifier in the local log.",
      "Operators can inspect the log before starting another recovery attempt.",
      "Retries use the same identifier so that a repeated request is handled only once.",
      "The queue retains its ordering while the connection is unavailable.",
      "A successful response removes the oldest pending request from the queue.",
    ];
    const before = sentences.join(" ") + "\n";
    const after = before.replace("records each request", "records each authenticated request");
    const first = check(before, "github", { width: 60 });
    const second = check(after, "github", { width: 60 });
    expect(
      diffLines(first, second)
        .filter((part) => part.added || part.removed)
        .reduce((count, part) => count + part.count, 0),
    ).toBe(4);
    const tail = sentences
      .slice(1)
      .map((sentence) => check(sentence + "\n", "github", { width: 60 }))
      .join("");
    expect(first.endsWith(tail)).toBe(true);
    expect(second.endsWith(tail)).toBe(true);
  });
});
