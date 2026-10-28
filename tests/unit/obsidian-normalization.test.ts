import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeHtml } from "../../scripts/rendering.mjs";

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
    // The separator before an opening fence's info string is source formatting too (#715).
    expect(livePreview([line("~~~ \t&copy;  ")])).toEqual(livePreview([line("```&copy;")]));
    expect(livePreview([line("``` js one  two")])).not.toEqual(
      livePreview([line("```js one two")]),
    );
    expect(livePreview([line("```  ", "HyperMD-codeblock", "")])).not.toEqual(
      livePreview([line("```", "HyperMD-codeblock", "")]),
    );
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
