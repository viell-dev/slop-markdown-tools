import { describe, expect, it } from "vitest";
import { createWorkspace, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Plugin } from "../../src/index.js";

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
    expect(verify(source).output).toBe(
      // A link's text stays on one line in Obsidian (issue #306).
      "> [!note] Title with `code`\n> Text with **strong words**,\n> [a link](https://example.test),\n> `code words`, and enough ordinary\n> words to wrap several times.\n",
    );
  });

  it("joins a code span that the body writes across lines", () => {
    const source = `> [!info] Title\n> ${body} with \`multiline\n> code\`.\n`;
    expect(verify(source).output).toBe(
      "> [!info] Title\n> A body line with enough ordinary words\n> to wrap across several lines without\n> changing its meaning. with\n> `multiline code`.\n",
    );
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
    `> [!info] Title\n> ${body} with $multiline\n> math$.\n`,
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

  it("does not enable callout body reflow in CommonMark, which has no callouts", () => {
    const source = `> [!info] Title\n> ${body}\n`;
    expect(format(source, { config: { ...config, dialect: "commonmark" }, workspace }).output).toBe(
      source,
    );
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

describe("GitHub, Forgejo, and Gitea alert bodies", () => {
  const alerts = ["github", "forgejo", "gitea"] as const;
  function check(source: string, dialect: (typeof alerts)[number], options = {}) {
    const settings: Config = {
      extends: [],
      dialect,
      rules: { "style/wrap": ["warn", { width: 40, ...options }] },
    };
    const result = format(source, { config: settings });
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
    expect(semanticFingerprint(parse(result.output, dialect))).toBe(
      semanticFingerprint(parse(source, dialect)),
    );
    expect(format(result.output, { config: settings }).output).toBe(result.output);
    return result;
  }
  it.each(alerts)("keeps the marker line and wraps the body in the %s dialect", (dialect) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      for (const [prefix, continuation] of [
        ["> ", "> "],
        ["- > ", "  > "],
        ["> > ", "> > "],
      ] as const) {
        for (const marker of ["[!NOTE]", "[!warning]", "[!TIP]"]) {
          const header = `${prefix}${marker}${newline}`;
          const source = `${header}${continuation}${body}${newline}`;
          const { output } = check(source, dialect);
          expect(output.startsWith(header)).toBe(true);
          const lines = output.slice(header.length).split(newline).slice(0, -1);
          expect(lines.length).toBeGreaterThan(1);
          expect(lines.every((line) => line.startsWith(continuation) && line.length <= 40)).toBe(
            true,
          );
          expect(lines.map((line) => line.slice(continuation.length)).join(" ")).toBe(body);
        }
      }
    }
  });
  it.each(alerts)("keeps words after the marker on its line in the %s dialect", (dialect) => {
    const header = "> [!NOTE] Words that follow the marker on its line and run past the width\n";
    const source = `${header}> ${body}\n`;
    const result = check(source, dialect, { reportUnbreakable: true });
    expect(result.output).toBe(
      `${header}> A body line with enough ordinary words\n> to wrap across several lines without\n> changing its meaning.\n`,
    );
    expect(result.diagnostics.map((item) => [item.line, item.message])).toEqual([
      [1, "Paragraph exceeds 40 columns because of an unbreakable atom."],
    ]);
  });
  it("leaves a marker without a body, and an alert's other paragraphs, to the usual rules", () => {
    expect(check("> [!NOTE]\n", "github").output).toBe("> [!NOTE]\n");
    const source = `> [!NOTE]\n>\n> ${body}\n`;
    expect(check(source, "github").output).toBe(
      "> [!NOTE]\n>\n> A body line with enough ordinary words\n> to wrap across several lines without\n> changing its meaning.\n",
    );
  });
  it("refuses an edit that moves words onto the marker line", () => {
    const source = "> [!NOTE]\n> Body words.\n";
    const output = "> [!NOTE] Body\n> words.\n";
    expect(semanticFingerprint(parse(output, "github"))).not.toBe(
      semanticFingerprint(parse(source, "github")),
    );
    const plugin: Plugin = {
      name: "unsafe",
      rules: {
        boundary: {
          kind: "style",
          description: "Move a body word onto the marker line",
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
      config: { extends: [], dialect: "github", rules: { "unsafe/boundary": "warn" } },
      plugins: [plugin],
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics.some((item) => item.rule === "engine/unsafe-format")).toBe(true);
  });
});

describe("markers written with an escape or a character reference", () => {
  // GitHub reads each of these as the marker of an alert, as it reads
  // `[!NOTE]`: it reads the marker from the paragraph's text (issue #294).
  const markers = [
    "\\[!NOTE]",
    "&#91;!TIP]",
    "&lbrack;!WARNING]",
    "&#x5B;!NOTE]",
    "[\\!NOTE]",
    "[!&#78;OTE]",
  ];
  const marked = ["github", "forgejo", "gitea", "obsidian"] as const;
  function check(source: string, dialect: (typeof marked)[number] | "commonmark") {
    const options = {
      config: {
        extends: [],
        dialect,
        rules: { "style/wrap": ["warn", { width: 40, reportUnreflowed: true }] },
      } satisfies Config,
      workspace,
    };
    const result = format(source, options);
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
    expect(semanticFingerprint(parse(result.output, dialect))).toBe(
      semanticFingerprint(parse(source, dialect)),
    );
    expect(format(result.output, options).output).toBe(result.output);
    return result;
  }
  it.each(marked)("keeps the marker line and wraps the body in the %s dialect", (dialect) => {
    for (const newline of ["\n", "\r\n"])
      for (const marker of markers) {
        const header = `> ${marker}${newline}`;
        const { output } = check(`${header}> ${body}${newline}`, dialect);
        // On Forgejo and Gitea, a line that starts with `\[` can open display
        // math, so the whole paragraph stays as written.
        if (dialect !== "github" && dialect !== "obsidian" && marker.startsWith("\\[")) {
          expect(output).toBe(`${header}> ${body}${newline}`);
          continue;
        }
        expect(output.startsWith(header)).toBe(true);
        const lines = output.slice(header.length).split(newline).slice(0, -1);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.map((line) => line.slice(2)).join(" ")).toBe(body);
      }
  });
  it.each(markers)(
    "leaves the paragraph of %s as written in CommonMark, as `[!NOTE]`",
    (marker) => {
      const source = `> ${marker}\n> ${body}\n`;
      const result = check(source, "commonmark");
      expect(result.output).toBe(source);
      expect(result.diagnostics.map((item) => item.message)).toEqual([
        "Paragraph not reflowed: callout header (width 40 columns).",
      ]);
    },
  );
  it.each(markers)("keeps an Obsidian title after %s on the marker line", (marker) => {
    const header = `> ${marker.replace("NOTE", "note")} A title with *emphasis*\n`;
    const source = `${header}> ${body}\n`;
    const { output } = check(source, "obsidian");
    expect(output.startsWith(header)).toBe(true);
    expect(output).not.toBe(source);
  });
  it.each(markers)("refuses an edit that moves words onto the line of %s", (marker) => {
    const source = `> ${marker}\n> Body words.\n`;
    const output = `> ${marker} Body\n> words.\n`;
    for (const dialect of marked) {
      expect(semanticFingerprint(parse(output, dialect))).not.toBe(
        semanticFingerprint(parse(source, dialect)),
      );
      const plugin: Plugin = {
        name: "unsafe",
        rules: {
          boundary: {
            kind: "style",
            description: "Move a body word onto the marker line",
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
        config: { extends: [], dialect, rules: { "unsafe/boundary": "warn" } },
        plugins: [plugin],
        workspace,
      });
      expect(result.output).toBe(source);
      expect(result.diagnostics.some((item) => item.rule === "engine/unsafe-format")).toBe(true);
    }
  });
  it.each([...marked, "commonmark"] as const)(
    "leaves the reported alerts as written with the recommended preset in the %s dialect",
    (dialect) => {
      for (const marker of markers) {
        const source = `> ${marker}\n> Body.\n`;
        const config: Config = {
          extends: dialect === "commonmark" ? ["recommended"] : ["recommended", dialect],
          dialect,
        };
        const result = format(source, { config, workspace });
        expect(result.diagnostics).toEqual([]);
        expect(result.output).toBe(source);
      }
    },
  );
});
