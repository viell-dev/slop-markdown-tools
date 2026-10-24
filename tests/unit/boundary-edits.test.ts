import { describe, expect, it } from "vitest";
import { createWorkspace, format } from "../../src/index.js";
import type { Dialect, Edit, Plugin } from "../../src/index.js";

// Boundary edits must preserve native separators without freezing ordinary block edges.
const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });

function pluginOutput(source: string, edit: Edit, dialect: Dialect = "obsidian") {
  const plugin: Plugin = {
    name: "edge",
    rules: {
      change: {
        kind: "style",
        description: "Change a protected separator margin",
        check: ({ document }) =>
          document.source === source ? [{ start: edit.start, message: "Change", edit }] : [],
      },
    },
  };
  const options = {
    workspace,
    plugins: [plugin],
    config: { extends: [], dialect, rules: { "edge/change": "warn" } },
  } as const;
  const result = format(source, options);
  expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  return result.output;
}

describe.each(["\n", "\r\n", "\r"])(
  "plugin secondary list separators with %j (#598)",
  (newline) => {
    it("keeps the following bullet marker editable", () => {
      const source = `* a${newline}${newline}  b${newline}+ c${newline}`;
      const start = source.lastIndexOf("+");
      expect(pluginOutput(source, { start, end: start + 1, text: "-" })).toBe(
        source.replace("+", "-"),
      );
    });
    it.each(["* a\n\n    *b*\n9) c\n", "* a\n\n      b\n9) c\n"])(
      "retains the separator and permits inline text in %j",
      (input) => {
        const source = input.replaceAll("\n", newline);
        const at = source.indexOf(`${newline}9)`);
        for (const point of [at, at + newline.length])
          expect(pluginOutput(source, { start: point, end: point, text: newline })).toBe(source);
        expect(
          pluginOutput(source, {
            start: 0,
            end: source.length,
            text: source.replace(`${newline}9)`, `${newline}${newline}9)`),
          }),
        ).toBe(source);
        if (source.includes("*b*")) {
          const start = source.indexOf("*b*");
          expect(pluginOutput(source, { start, end: start + 3, text: "_b_" })).toBe(
            source.replace("*b*", "_b_"),
          );
        }
      },
    );
  },
);

describe.each(["\n", "\r\n", "\r"])("separator margins with %j (#590)", (newline) => {
  for (const quoted of [false, true])
    for (const margin of ["", " ", "  ", "\t"]) {
      const quote = quoted ? "> " : "";
      const blankQuote = quoted ? ">" : "";
      const source = `${quote}- ## *h*${margin}${newline}${quote}outside${newline}`;
      const at = source.indexOf(newline);
      const edits = {
        "insert-before-margin": {
          start: at - margin.length,
          end: at - margin.length,
          text: newline + blankQuote,
        },
        "combined-blank": {
          start: 0,
          end: at,
          text: `${quote}- ## _h_${newline}${blankQuote}${margin}`,
        },
        "copied-suffix": {
          start: 0,
          end: source.length,
          text: source.replace("*h*", `_h_${newline}${blankQuote}`),
        },
      } satisfies Record<string, Edit>;
      it.each(Object.entries(edits))(
        `rejects %s with quoted=${String(quoted)} margin=${JSON.stringify(margin)}`,
        (_kind, edit) => expect(pluginOutput(source, edit)).toBe(source),
      );
      it(`keeps safe terminal changes with quoted=${String(quoted)} margin=${JSON.stringify(margin)}`, () => {
        for (const replacement of ["_h_", "_h_ ###"])
          expect(
            pluginOutput(source, {
              start: 0,
              end: at,
              text: `${quote}- ## ${replacement}${margin}`,
            }),
          ).toBe(source.replace("*h*", replacement));
      });
    }

  it("allows ordinary block edges and no-op protected edits", () => {
    const ordinary = `## *h*${newline}outside${newline}`;
    const at = ordinary.indexOf(newline);
    expect(pluginOutput(ordinary, { start: at, end: at, text: newline })).toBe(
      ordinary.slice(0, at) + newline + ordinary.slice(at),
    );
    const source = `- ## *h*${newline}outside${newline}`;
    const boundary = source.indexOf(newline);
    expect(pluginOutput(source, { start: boundary, end: boundary, text: "" })).toBe(source);
    expect(pluginOutput(source, { start: 0, end: source.length, text: source })).toBe(source);
  });

  it.each([
    ["obsidian", "style/block-spacing", "x\n- [ ] \n  b\n", "x\n- [ ] \n  b\n"],
    ["obsidian", "style/blank-lines", "x\n\n\n- [ ] \n  b\n", "x\n\n- [ ] \n  b\n"],
    ["github", "style/block-spacing", "# h\n$$\na\n$$\nb\n---\n", "# h\n\n$$\na\n$$\nb\n---\n"],
  ] as const)(
    "keeps the ordinary %s %s fix at a whole-line range",
    (dialect, rule, input, output) => {
      const source = input.replaceAll("\n", newline);
      const options = { config: { extends: [], dialect, rules: { [rule]: "warn" } } } as const;
      const result = format(source, options);
      expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
      expect(result.output).toBe(output.replaceAll("\n", newline));
      if (input === output)
        expect(
          result.diagnostics.some(
            (d) => d.rule === rule && d.message.startsWith("Left as written"),
          ),
        ).toBe(true);
      expect(format(result.output, options).output).toBe(result.output);
    },
  );
});

describe("CRLF separator normalization from earlier guards (#530, #554, #590)", () => {
  it.each(["> word\r\n    *literal*   \r\n", "- alpha\r\nbeta\r\ngamma\r\n---\r\n"])(
    "protects before and between both line-ending bytes in %j",
    (source) => {
      const at = source.indexOf("\r\n");
      for (const point of [at, at + 1])
        expect(pluginOutput(source, { start: point, end: point, text: "\r\n" })).toBe(source);
    },
  );
});

describe.each(["\n", "\r\n", "\r"])("quote-only boundary lines with %j (#590)", (newline) => {
  it.each(["", " ", "\t"])("retains the quote marker before margin %j", (margin) => {
    const source = `- a${newline}> b${newline}>${margin}${newline}- c${newline}`;
    const start = source.lastIndexOf(`>${margin}${newline}`);
    expect(pluginOutput(source, { start, end: start + 1, text: "" })).toBe(source);
    expect(pluginOutput(source, { start, end: start + 1, text: " " })).toBe(source);
    expect(pluginOutput(source, { start, end: start + 1 + margin.length, text: "" })).toBe(source);
    expect(
      pluginOutput(source, {
        start: 0,
        end: source.length,
        text: source.slice(0, start) + source.slice(start + 1),
      }),
    ).toBe(source);
    expect(
      pluginOutput(source, { start: start + 1, end: start + 1 + margin.length, text: "" }),
    ).toBe(source.slice(0, start + 1) + source.slice(start + 1 + margin.length));
  });

  it("handles a quote-only first line without freezing the document start", () => {
    const source = `>${newline}2. a${newline}`;
    expect(pluginOutput(source, { start: 0, end: 1, text: "" })).toBe(source);
    expect(pluginOutput(source, { start: 0, end: 0, text: newline })).toBe(newline + source);
  });

  it.each(["f>", "f>>", "f >", "f> "])("keeps ordinary terminal %j editable", (cell) => {
    const source = `- ## h${newline}| b | c |${newline}| - | - |${newline}| e | ${cell}${newline}- g${newline}`;
    const options = {
      workspace,
      config: { extends: [], dialect: "obsidian", rules: { "style/table": "warn" } },
    } as const;
    const result = format(source, options);
    expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
    expect(result.output).not.toBe(source);
    expect(result.output).toContain(`| --- | --- |${newline}`);
    expect(format(result.output, options).output).toBe(result.output);
  });
});
