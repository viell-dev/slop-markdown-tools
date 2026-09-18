import { describe, expect, it } from "vitest";
import { createWorkspace, format, lint, parse, semanticFingerprint } from "../src/index.js";
import type { Config, Plugin } from "../src/index.js";

const workspace = createWorkspace({}, { strictLineBreaks: true });
const config: Config = {
  extends: [],
  dialect: "obsidian",
  rules: { "style/wrap": ["warn", { width: 40, reportUnreflowed: true, reportUnbreakable: true }] },
};
const body =
  "A body line with enough ordinary words to wrap across several lines without changing its meaning.";

function verify(source: string, settings = config) {
  const options = { config: settings, workspace };
  const result = format(source, options);
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(semanticFingerprint(parse(result.output, "obsidian"))).toBe(
    semanticFingerprint(parse(source, "obsidian")),
  );
  expect(format(result.output, options).output).toBe(result.output);
  expect(format(source, { config: { extends: [], dialect: "obsidian" }, workspace }).output).toBe(
    source,
  );
  return result;
}

describe("direct Obsidian callout body reflow", () => {
  it("preserves the header while wrapping body lines in supported containers", () => {
    for (const newline of ["\n", "\r\n"]) {
      for (const [prefix, continuation] of [
        ["> ", "> "],
        ["> > ", "> > "],
        ["- > ", "  > "],
        ["> - > ", ">   > "],
        [">", ">"],
      ] as const) {
        for (const title of [
          "[!info] Short title",
          "[!custom-type]- **A folded title**",
          "[!tip]+",
          "[!INFO] This long title stays entirely on its original physical line",
        ]) {
          const header = `${prefix}${title}${newline}`;
          const source = `${header}${continuation}${body}${newline}`;
          const result = verify(source);
          expect(result.output.startsWith(header)).toBe(true);
          expect(result.output).not.toBe(source);
          const lines = result.output.slice(header.length).trimEnd().split(/\r?\n/);
          expect(lines.length).toBeGreaterThan(1);
          expect(lines.every((line) => line.startsWith(continuation) && line.length <= 40)).toBe(
            true,
          );
          expect(lines.map((line) => line.slice(continuation.length)).join(" ")).toBe(body);
          expect(
            result.diagnostics.every(
              (item) => item.message.includes("unbreakable atom") && item.line === 1,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it("wraps the reported example without inserting a blank quote line", () => {
    const source =
      "> [!info] Short title\n> A body line that is long enough to be reflowed by the wrapper, so it should wrap.\n";
    const result = verify(source, { ...config, rules: { "style/wrap": ["warn", { width: 60 }] } });
    expect(result.output).toBe(
      "> [!info] Short title\n> A body line that is long enough to be reflowed by the\n> wrapper, so it should wrap.\n",
    );
    const diagnostics = lint(source, { config, workspace });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(2);
    expect(diagnostics[0]?.column).toBe(3);
    expect(diagnostics[0]?.edit?.start).toBe(source.indexOf("A body"));
  });

  it("reflows multiple body source lines while preserving inline atoms", () => {
    const source =
      "> [!note] Title with `code`\n> Text with **strong words**, [a link](https://example.test),\n> `code words`, and enough ordinary words to wrap several times.\n";
    const result = verify(source);
    expect(result.output).not.toBe(source);
    expect(result.output).toContain("[a link](https://example.test)");
    expect(result.output).toContain("**strong words**");
    expect(result.output).toContain("`code words`");
  });

  it("keeps header diagnostics separate from reflow and unbreakable body atoms", () => {
    const header = "> [!warning] A long title that must stay on its original physical line\n";
    const atom = "[label](https://example.test/a-very-long-path-that-cannot-wrap)";
    const source = `${header}> ${body} ${atom}\n`;
    for (const reportUnreflowed of [false, true]) {
      for (const reportUnbreakable of [false, true]) {
        const settings: Config = {
          ...config,
          rules: { "style/wrap": ["warn", { width: 40, reportUnreflowed, reportUnbreakable }] },
        };
        const result = verify(source, settings);
        expect(result.output.startsWith(header)).toBe(true);
        expect(result.output).not.toBe(source);
        expect(result.diagnostics).toHaveLength(reportUnbreakable ? 2 : 0);
        expect(result.diagnostics.every((item) => item.message.includes("unbreakable atom"))).toBe(
          true,
        );
        if (reportUnbreakable) expect(result.diagnostics.map((item) => item.line)).toEqual([1, 2]);
      }
    }
  });

  it.each([
    `> [!info] Title\n> ${body}  \n> Next line.\n`,
    `> [!info] Title\n> ${body}\\\n> Next line.\n`,
    `> [!info] Title\n> ${body} ^block\n`,
    `> [!info] Title\n> ${body} <b>HTML</b>\n`,
    `> [!info] Title\n> ${body} with \`multiline\n> code\`.\n`,
    `> [!info] Title with \`multiline\n> code\` ${body}\n`,
    `> [!info] Title with **multiline\n> emphasis** ${body}\n`,
    `> [!info] Title\n${body}\n`,
    `> [!info] Title\n> ${body}\nlazy continuation\n`,
    `> [!info] Title\n > ${body}\n`,
  ])("preserves protected or unsupported body source: %j", (source) => {
    expect(verify(source).output).toBe(source);
  });

  it("preserves title hard breaks while reflowing body prose", () => {
    for (const marker of ["  ", "\\"]) {
      const header = `> [!info] Title${marker}\n`;
      const source = `${header}> ${body}\n`;
      const result = verify(source);
      expect(result.output.startsWith(header)).toBe(true);
      expect(result.output).not.toBe(source);
    }
  });

  it("respects width measurement and the strict-line-break gate", () => {
    const source = "> [!info] Title\n> 日本語 日本語 日本語 日本語 日本語 日本語 日本語 日本語\n";
    const result = verify(source);
    expect(result.output).not.toBe(source);
    expect(
      verify(source, {
        ...config,
        rules: { "style/wrap": ["warn", { width: 40, measure: "codepoints" }] },
      }).output,
    ).toBe(source);
    expect(format(source, { config }).output).toBe(source);
    expect(
      format(source, { config, workspace: createWorkspace({}, { strictLineBreaks: false }) })
        .output,
    ).toBe(source);
  });

  it("retains separate paragraphs and nested callouts", () => {
    const source = `> [!info] Outer\n> ${body}\n>\n> Another paragraph with enough ordinary words to wrap across several lines.\n>\n> > [!tip]- Inner\n> > ${body}\n`;
    const result = verify(source);
    expect(result.output).not.toBe(source);
    expect(result.output).toContain(">\n> Another paragraph");
    expect(result.output).toContain(">\n> > [!tip]- Inner\n");
  });

  it("does not enable callout body reflow in other dialects", () => {
    const source = `> [!info] Title\n> ${body}\n`;
    for (const dialect of ["commonmark", "github"] as const) {
      expect(format(source, { config: { ...config, dialect }, workspace }).output).toBe(source);
    }
  });

  it("rejects edits that move words between the title and body", () => {
    const source = "> [!info] Original title\n> Body words.\n";
    for (const output of [
      "> [!info] Original\n> title Body words.\n",
      "> [!info] Original title Body\n> words.\n",
    ]) {
      expect(semanticFingerprint(parse(output, "obsidian"))).not.toBe(
        semanticFingerprint(parse(source, "obsidian")),
      );
      const plugin: Plugin = {
        name: "unsafe",
        rules: {
          boundary: {
            kind: "style",
            description: "Move title/body boundary",
            check: () => [
              {
                start: 0,
                message: "Unsafe edit",
                edit: { start: 0, end: source.length, text: output },
              },
            ],
          },
        },
      };
      const result = format(source, {
        config: { extends: [], dialect: "obsidian", rules: { "unsafe/boundary": "warn" } },
        plugins: [plugin],
        workspace,
      });
      expect(result.output).toBe(source);
      expect(result.diagnostics.some((item) => item.rule.startsWith("engine/"))).toBe(true);
    }
  });

  it("permits supported inline formatting in the title", () => {
    const source = `> [!INFO]- *Custom title*\n> ${body}\n`;
    const result = verify(source, {
      ...config,
      rules: {
        ...config.rules,
        "obsidian/callout-marker": "warn",
        "style/emphasis": ["warn", { marker: "_" }],
      },
    });
    expect(result.output.startsWith("> [!info]- _Custom title_\n")).toBe(true);
  });
});
