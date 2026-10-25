import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { format, lint, createWorkspace } from "../../src/index.js";
import type { Plugin, ProcessOptions } from "../../src/index.js";
import { narrow, formatted } from "../support/engine.js";
describe("processing selected ranges", () => {
  const emphasis: ProcessOptions = {
    config: { extends: [], dialect: "github", rules: { "style/emphasis": "warn" } },
  };
  const at = (source: string, text: string, length = 0) => {
    const start = source.indexOf(text);
    return { start, end: start + length };
  };
  it("changes only the blocks that a range touches and keeps the rest of the document", () => {
    const source =
      "# Guide\n\nLegacy *word* stays.\n\nChange *this paragraph*, with [setup][setup].\n\n[setup]: ./setup.md\n";
    const result = format(source, { ...emphasis, ranges: [at(source, "Change", 3)] });
    expect(result.output).toBe(
      "# Guide\n\nLegacy *word* stays.\n\nChange _this paragraph_, with [setup][setup].\n\n[setup]: ./setup.md\n",
    );
    // The scope is the whole paragraph with the line breaks next to it, in the output's positions.
    const paragraph = at(result.output, "Change", 45);
    expect(result.scope).toEqual([{ start: paragraph.start - 1, end: paragraph.end + 1 }]);
    // The diagnostics describe the result; those outside the scope are left out.
    expect(result.diagnostics).toEqual([]);
    // Lint reports what starts in the selected blocks; an empty range at a position selects its block.
    expect(
      lint(source, { ...emphasis, ranges: [at(source, "stays")] }).map((item) => item.line),
    ).toEqual([3, 3]);
    // A finding belongs to the block where it starts: links/valid reports a
    // reference link's target at its definition, not at the link.
    const workspace = createWorkspace({ "guide.md": source }, { dialect: "github" });
    const links: ProcessOptions = {
      path: "guide.md",
      workspace,
      config: { extends: [], dialect: "github", rules: { "links/valid": "error" } },
    };
    expect(lint(source, { ...links, ranges: [at(source, "[setup]:", 3)] })).toEqual([
      expect.objectContaining({ line: 7, message: "Missing local target: ./setup.md." }),
    ]);
    expect(lint(source, { ...links, ranges: [at(source, "Change", 3)] })).toEqual([]);
  });
  it("processes everything without ranges, nothing for an empty list, and refuses invalid ranges", () => {
    const source = "A *b*.\n\nC *d*.\n";
    expect(format(source, emphasis)).toEqual({
      output: "A _b_.\n\nC _d_.\n",
      changed: true,
      diagnostics: [],
    });
    expect(format(source, { ...emphasis, ranges: [] })).toEqual({
      output: source,
      changed: false,
      diagnostics: [],
      scope: [],
    });
    expect(lint(source, { ...emphasis, ranges: [] })).toEqual([]);
    for (const ranges of [
      [{ start: -1, end: 2 }],
      [{ start: 3, end: 2 }],
      [{ start: 0, end: source.length + 1 }],
      [{ start: 0.5, end: 2 }],
    ])
      for (const call of [lint, format])
        expect(() => call(source, { ...emphasis, ranges }), JSON.stringify(ranges)).toThrow(
          "Invalid range",
        );
    // A range that touches no block, such as one in blank lines, selects nothing.
    expect(format(source, { ...emphasis, ranges: [{ start: 7, end: 8 }] }).output).toBe(source);
    expect(format(source, { ...emphasis, ranges: [{ start: 7, end: 7 }] }).scope).toEqual([]);
  });
  it("selects single paragraphs in lists and quotes, and everything between two of them", () => {
    const source = "- A *a*\n- B *b*\n  > Q *q*\n  >\n  > R *r*\n- C *c*\n";
    const formatted = (ranges: { start: number; end: number }[]) =>
      format(source, { ...emphasis, ranges }).output;
    expect(formatted([at(source, "Q", 1)])).toBe(
      "- A *a*\n- B *b*\n  > Q _q_\n  >\n  > R *r*\n- C *c*\n",
    );
    expect(formatted([at(source, "B", 1)])).toBe(
      "- A *a*\n- B _b_\n  > Q *q*\n  >\n  > R *r*\n- C *c*\n",
    );
    const from = source.indexOf("a*");
    expect(formatted([{ start: from, end: source.indexOf("Q") + 1 }])).toBe(
      "- A _a_\n- B _b_\n  > Q _q_\n  >\n  > R *r*\n- C *c*\n",
    );
  });
  it("moves the scope with the edits through every phase and pass", () => {
    const long = (word: string) => `${word} ${"word ".repeat(12).trim()} *end*.`;
    const source = [long("One"), long("Two"), long("Three")].join("\n\n") + "\n";
    const options: ProcessOptions = { config: narrow };
    const result = format(source, {
      ...options,
      ranges: [at(source, "One", 3), at(source, "Three", 5)],
    });
    const whole = formatted(source, options).split("\n\n");
    const parts = result.output.split("\n\n");
    expect(parts).toEqual([whole[0], long("Two"), whole[2]]);
    expect(result.scope!.map((part) => result.output.slice(part.start, part.end))).toEqual([
      `${whole[0]}\n`,
      `\n${whole[2]}`,
    ]);
    // Formatting the scope again changes nothing.
    expect(format(result.output, { ...options, ranges: result.scope! }).changed).toBe(false);
  });
  it("does not apply an edit that reaches outside the scope, and keeps its diagnostic", () => {
    const plugin: Plugin = {
      name: "wide",
      rules: {
        join: {
          description: "Propose one edit across two paragraphs",
          kind: "style",
          check: ({ document }) => {
            const end = document.source.indexOf("Second") + 6;
            return [{ start: 0, end, message: "Join", edit: { start: 0, end, text: "Joined" } }];
          },
        },
      },
    };
    const source = "First.\n\nSecond.\n";
    const result = format(source, {
      plugins: [plugin],
      config: { extends: [], rules: { "wide/join": "warn" } },
      ranges: [at(source, "First", 1)],
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics).toEqual([expect.objectContaining({ rule: "wide/join", start: 0 })]);
  });
  it("applies an insertion at the edge of the scope", () => {
    const source = "First *one*.\n\nLast *one*.";
    const options: ProcessOptions = {
      config: { extends: [], rules: { "style/final-newline": "warn", "style/emphasis": "warn" } },
    };
    expect(format(source, { ...options, ranges: [at(source, "Last", 1)] }).output).toBe(
      "First *one*.\n\nLast _one_.\n",
    );
    expect(format(source, { ...options, ranges: [at(source, "First", 1)] }).output).toBe(
      "First _one_.\n\nLast *one*.",
    );
  });
  it("counts UTF-16 units, CRLF line ends, and a byte order mark in its offsets", () => {
    const mark = String.fromCharCode(0xfeff);
    const source = `${mark}🙂 *a*.\r\n\r\nÜber *b*.\r\n`;
    const result = format(source, { ...emphasis, ranges: [at(source, "Über", 1)] });
    expect(result.output).toBe(`${mark}🙂 *a*.\r\n\r\nÜber _b_.\r\n`);
    const block = at(result.output, "Über", 9);
    expect(result.scope).toEqual([{ start: block.start - 2, end: block.end + 2 }]);
    expect(format(source, { ...emphasis, ranges: [{ start: 0, end: 1 }] }).scope).toEqual([]);
    expect(format(source, { ...emphasis, ranges: [{ start: 1, end: 2 }] }).output).toBe(
      `${mark}🙂 _a_.\r\n\r\nÜber *b*.\r\n`,
    );
  });
  it("keeps suppressions and the whole-document safety check", () => {
    const source = "<!-- mdrefine-disable-next-line style/emphasis -->\nA *b*.\n\nC *d*.\n";
    expect(format(source, { ...emphasis, ranges: [at(source, "A", 1)] }).output).toBe(source);
    const unsafe: Plugin = {
      name: "unsafe",
      rules: {
        drop: {
          description: "Remove a paragraph's text",
          kind: "style",
          check: ({ document }) => {
            const start = document.source.indexOf("C");
            return [{ start, message: "Drop", edit: { start, end: start + 6, text: "" } }];
          },
        },
      },
    };
    const result = format(source, {
      plugins: [unsafe],
      config: { extends: [], rules: { "unsafe/drop": "warn" } },
      ranges: [at(source, "C", 1)],
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics.map((item) => [item.rule, item.line])).toEqual([
      ["engine/unsafe-format", 4],
      ["unsafe/drop", 4],
    ]);
    const block = at(source, "C", 6);
    expect(result.scope).toEqual([{ start: block.start - 1, end: block.end + 1 }]);
  });
  it("takes in a selected block's markers and the line breaks next to it", () => {
    const spacing: ProcessOptions = {
      config: { extends: [], rules: { "style/block-spacing": "warn" } },
    };
    const source = "# Setup\nInstall the package.\n- Run the command.\n";
    const formattedWith = (ranges: { start: number; end: number }[]) =>
      format(source, { ...spacing, ranges }).output;
    const messages = (ranges: { start: number; end: number }[]) =>
      lint(source, { ...spacing, ranges }).map((item) => item.message);
    // The blank line next to a selected block is part of formatting that block.
    expect(formattedWith([at(source, "Setup", 1)])).toBe(
      "# Setup\n\nInstall the package.\n- Run the command.\n",
    );
    expect(formattedWith([at(source, "Install", 1)])).toBe(
      "# Setup\n\nInstall the package.\n\n- Run the command.\n",
    );
    expect(formattedWith([at(source, "Run", 1)])).toBe(
      "# Setup\nInstall the package.\n\n- Run the command.\n",
    );
    // The list's marker is on the selected block's line, and so is a cursor on it.
    expect(messages([at(source, "Run", 1)])).toEqual(["Add a blank line before the list."]);
    expect(messages([at(source, "- Run")])).toEqual(["Add a blank line before the list."]);
    expect(messages([at(source, "Setup", 1)])).toEqual(["Add a blank line after the heading."]);
    // A quote's markers on the block's first line belong to its scope too.
    const quoted = "> # Title\n> Text.\n";
    const result = format(quoted, { ...spacing, ranges: [at(quoted, "Text", 1)] });
    expect(result.output).toBe("> # Title\n>\n> Text.\n");
    // The scope grows by the line that was added in it.
    expect(result.output.slice(result.scope![0]!.start, result.scope![0]!.end)).toBe(
      "\n>\n> Text.\n",
    );
  });
  it("gives the same result for a range over the whole document as without ranges", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.constantFrom("alpha", "*bravo*", "`code`", "éclair", "🙂", "**delta**"), {
            minLength: 1,
            maxLength: 30,
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.constantFrom("", "- ", "> "),
        fc.nat(),
        fc.nat(),
        (paragraphs, prefix, a, b) => {
          const source = paragraphs.map((words) => prefix + words.join(" ")).join("\n\n") + "\n";
          const options: ProcessOptions = { config: narrow };
          const whole = format(source, options);
          const all = format(source, { ...options, ranges: [{ start: 0, end: source.length }] });
          expect({ ...all, scope: undefined }).toEqual({ ...whole, scope: undefined });
          // Outside the scope of any range, the text stays as it was.
          const start = Math.min(a, b) % (source.length + 1);
          const end = Math.max(start, Math.max(a, b) % (source.length + 1));
          const part = format(source, { ...options, ranges: [{ start, end }] });
          if (!part.scope!.length) {
            expect(part.output).toBe(source);
            return;
          }
          const first = part.scope![0]!;
          const last = part.scope![part.scope!.length - 1]!;
          expect(part.output.slice(0, first.start)).toBe(source.slice(0, first.start));
          expect(part.output.slice(last.end)).toBe(
            source.slice(source.length - (part.output.length - last.end)),
          );
          expect(format(part.output, { ...options, ranges: part.scope! }).changed).toBe(false);
        },
      ),
      { numRuns: 150, seed: 20261017 },
    );
  });
});
