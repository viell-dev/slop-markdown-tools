import { describe, expect, it } from "vitest";
import { createWorkspace, format, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Plugin } from "../../src/index.js";
import { boundaryFixtures } from "../../scripts/obsidian/boundary-fixtures.mjs";
import { misreadLists } from "../../src/syntax/misread-lists.js";

const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
const config: Config = {
  extends: ["recommended", "obsidian"],
  rules: { "style/wrap": ["warn", { width: 30 }] },
};
function checked(source: string, settings = config) {
  const options = { config: settings, workspace };
  const result = format(source, options);
  expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  expect(semanticFingerprint(parse(result.output, "obsidian"))).toBe(
    semanticFingerprint(parse(source, "obsidian")),
  );
  expect(format(source, { config: { extends: [], dialect: "obsidian" }, workspace }).output).toBe(
    source,
  );
  return result.output;
}

// Some former permissiveness controls deliberately stay unchanged under #603.
// Accept only their old exact result or unchanged source with a visible refusal.
function control(source: string, expected?: string, settings = config) {
  const output = checked(source, settings);
  if (expected !== undefined && output === expected) return;
  if (expected === undefined && output !== source) return;
  expect(output).toBe(source);
  expect(
    format(source, { config: settings, workspace }).diagnostics.some(({ message }) =>
      message.startsWith("Left as written"),
    ),
  ).toBe(true);
}

describe.each(["\n", "\r\n", "\r"])("secondary list block boundaries with %j (#598)", (newline) => {
  it.each([
    "* a\n\n    b\n9) c\n",
    "* a\n\t\n    b\n1) c\n",
    "* a\n\n  b\n+ c\n",
    "* a\n\n      b\n9) c\n",
    "* a\n\t\n      b\n9) c\n",
    "2. a\n\n    b\n9) c\n",
  ])("keeps the adjacent separator in %j", (input) => {
    const source = input.replaceAll("\n", newline);
    expect(
      checked(source, {
        extends: [],
        dialect: "obsidian",
        rules: { "style/block-spacing": "warn" },
      }),
    ).toBe(source);
  });

  it.each(["* a\n    b\n9) c\n", "* a\n  ```\n  b\n  ```\n9) c\n", "* # a\n9) c\n"])(
    "permits independent spacing in %j",
    (input) => {
      const source = input.replaceAll("\n", newline);
      expect(
        checked(source, {
          extends: [],
          dialect: "obsidian",
          rules: { "style/block-spacing": "warn" },
        }),
      ).not.toBe(source);
    },
  );
});

/** Minimal regressions also exercised in the real Obsidian fixture suite. */
const boundaries = boundaryFixtures
  .filter(({ issue, preserve }) => preserve !== false && ![496, 497, 499, 508].includes(issue))
  .map(({ issue, source, name }) => [issue, source, name] as const);

describe("carried Obsidian boundaries (#582–#584)", () => {
  it.each([
    ">\t*a*\n>\n>\n>\t*b*\n",
    "> \t*a*\n>\n>\n> \t*b*\n",
    ">\t*a*\n>\n>\n> \t*b*\n",
    "> >\t*a*\n> >\n> >\n> >\t*b*\n",
    ">\t*a*\n> \n> \n>\t*b*\n",
    ">\t*a*\n>\n>\n>\t*b*\n>\n>\n>\t*c*\n",
  ])("keeps literal blank lines between adjacent Tab-code children (#597): %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\ufeff"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(input);
        expect(
          checked(input, {
            extends: [],
            dialect: "obsidian",
            rules: { "style/blank-lines": "warn" },
          }),
        ).toBe(input);
      }
  });
  it("resumes blank-line and inline preferences after quoted literal code (#597)", () => {
    expect(checked(">\t*a*\n>\n>\n> Later *safe*.\n")).toBe(">\t*a*\n>\n> Later _safe_.\n");
    expect(checked(">  \t*a*\n>\n>\n>  \t*b*\n")).toBe(">  \t_a_\n>\n>  \t_b_\n");
    expect(checked(">\t*a*\n>\n>\n>\t*b*\n\nLater *safe*.\n")).toBe(
      ">\t*a*\n>\n>\n>\t*b*\n\nLater _safe_.\n",
    );
  });
  it.each([
    ">\t*c*\n",
    ">\t* c\n",
    ">\ttext *c*\n",
    "> \t* *c*\n",
    ">\t *c*\n",
    ">\t# *c* ##\n",
    ">\t* *c*\n> second *d*\n",
    "> [!NOTE]\n>\t* *c*\n",
    "> >\t* *c*\n",
  ])("retains a quoted block read as literal code after a Tab (#597): %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\ufeff"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(
          checked(input, {
            extends: [],
            dialect: "obsidian",
            rules: {
              "style/emphasis": "warn",
              "style/list-marker": "warn",
              "style/heading": "warn",
              "style/wrap": ["warn", { width: 30 }],
            },
          }),
        ).toBe(input);
      }
  });
  it("keeps ordinary quoted margins and independent blocks editable (#597)", () => {
    expect(checked(">  \t*c*\n")).toBe(">  \t_c_\n");
    expect(checked(">    * *c*\n")).toBe("> - _c_\n");
    expect(checked("2. a\n   + b\n>    * *c*\n")).toBe("2. a\n   - b\n> - _c_\n");
    expect(checked("2. a\n   + b\n>\t* *c*\n\nLater *safe*.\n")).toBe(
      "2. a\n   - b\n>\t* *c*\n\nLater _safe_.\n",
    );
    expect(
      format(">\t*c*\n", {
        config: { extends: [], dialect: "commonmark", rules: { "style/emphasis": "warn" } },
      }).output,
    ).toBe(">\t_c_\n");
  });
  it.each(["alpha ##\n===\n", "alpha #\n---\n", "alpha\t##\n===\n"])(
    "retains a Setext title ending in raw closing hashes (#383): %j",
    (source) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", "\ufeff"]) {
          const input = bom + source.replaceAll("\n", newline);
          expect(checked(input)).toBe(input);
          expect(
            checked(input, {
              extends: [],
              dialect: "obsidian",
              rules: { "style/heading": "warn" },
            }),
          ).toBe(input);
        }
    },
  );
  it("keeps title text and independent heading forms editable (#383)", () => {
    expect(checked("*alpha* ##\n===\n\nbeta\n---\n")).toBe("_alpha_ ##\n===\n\n## beta\n");
    for (const [source, expected] of [
      ["alpha###\n===\n", "# alpha###\n"],
      ["alpha \\##\n===\n", "# alpha \\##\n"],
      ["alpha `##`\n===\n", "# alpha `##`\n"],
      ["alpha ## tail\n===\n", "# alpha ## tail\n"],
      ["## alpha ##\n", "## alpha\n"],
    ] as const)
      expect(checked(source)).toBe(expected);
    expect(
      checked("# alpha \\##\n", {
        extends: [],
        dialect: "obsidian",
        rules: { "style/heading": ["warn", { style: "setext" }] },
      }),
    ).toBe("alpha \\##\n=========\n");
    for (const dialect of ["commonmark", "github"] as const)
      expect(
        format("alpha ##\n===\n", {
          config: { extends: [], dialect, rules: { "style/heading": "warn" } },
        }).output,
      ).toBe("# alpha \\##\n");
  });
  it.each([
    "2. a\n   + b\n>  * c\n",
    "1. a\n   + b\n>  * c\n",
    "- a\n  + b\n>  * c\n",
    "2. a\n   - b\n>  * c\n",
    "2. a\n   + b\n>  1. c\n",
    "2. a\n   + b\n\n>  * c\n",
    "2. a\n   + b\n\n\n>  * c\n",
  ])("retains quoted-list indentation after a trailing nested list (#596): %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\ufeff"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(
          checked(input, {
            extends: [],
            dialect: "obsidian",
            rules: { "style/list-indent": "warn" },
          }),
        ).toBe(input);
      }
  });
  it("keeps marker and inline edits in indentation-sensitive lists (#596)", () => {
    const source = "2. *a*\n   + *b*\n>  * *c*\n";
    expect(checked(source)).toBe("2. _a_\n   - _b_\n>  - _c_\n");
    expect(
      checked(source, {
        extends: [],
        dialect: "obsidian",
        rules: { "style/list-marker": "warn" },
      }),
    ).toBe("2. *a*\n   - *b*\n>  - *c*\n");
  });
  it.each(["8. a\n99. z\n    + b\n>  * c\n", "9. a\n1. z\n   + b\n>  * c\n"])(
    "retains number width in the earlier indentation unit (#596): %j",
    (source) => {
      expect(
        checked(source, {
          extends: [],
          dialect: "obsidian",
          rules: { "style/ordered-list": ["warn", { numbering: "ordered" }] },
        }),
      ).toBe(source);
    },
  );
  it("keeps delimiters and same-width numbering editable in retained units (#596)", () => {
    const settings: Config = {
      extends: [],
      dialect: "obsidian",
      rules: { "style/ordered-list": ["warn", { numbering: "ordered", delimiter: ")" }] },
    };
    expect(checked("8. a\n99. z\n    + b\n>  * c\n", settings)).toBe(
      "8) a\n99) z\n    + b\n>  * c\n",
    );
    expect(checked("2. a\n8. z\n   + b\n>  * c\n", settings)).toBe("2) a\n3) z\n   + b\n>  * c\n");
  });
  it.each([{ nestedIndent: 4 }, { orderedSpacesMultiline: 2 }, { bulletSpaces: 3 }])(
    "retains custom indentation on both participating units (#596): %j",
    (options) => {
      const source = "2. a\n   + b\n>  * c\n";
      expect(
        checked(source, {
          extends: [],
          dialect: "obsidian",
          rules: { "style/list-indent": ["warn", options] },
        }),
      ).toBe(source);
    },
  );
  it.each([
    ["2. a\n   + b\n> * c\n", "2. a\n   + b\n> * c\n"],
    ["2. a\n   + b\n>   * c\n", "2. a\n   + b\n> * c\n"],
    ["2. a\n>  * c\n", "2. a\n> * c\n"],
    [">  * c\n", "> * c\n"],
    ["2. a\n   + b\n# reset\n>  * c\n", "2. a\n   + b\n# reset\n> * c\n"],
    ["2. a\n   + b\n> [!NOTE]\n>  * c\n", "2. a\n   + b\n> [!NOTE]\n> * c\n"],
    ["2. a\n   + b\n> >  * c\n", "2. a\n   + b\n> > * c\n"],
  ])("keeps measured quote-indent controls editable (#596): %j", (source, expected) => {
    expect(
      checked(source, {
        extends: [],
        dialect: "obsidian",
        rules: { "style/list-indent": "warn" },
      }),
    ).toBe(expected);
  });
  it.each([
    "%%c%%\nalpha\n---\n",
    "%%c%%\nalpha\n===\n",
    "%%one\ntwo%%\nalpha\n---\n",
    "%%one%%\n%%two%%\nalpha\n---\n",
    "%%%%\nalpha\n---\n",
    "%%c%%\nalpha\n=\nbeta\n---\n",
    "%%c%%\nalpha\n--\nbeta\n---\n",
  ])("retains Setext text directly after a standalone comment (#383): %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\ufeff"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(input);
        expect(
          checked(input, { extends: [], dialect: "obsidian", rules: { "style/heading": "warn" } }),
        ).toBe(input);
      }
  });
  it("keeps comment-adjacent title text editable and permits independent headings (#383)", () => {
    expect(checked("%%c%%\n__alpha__\n---\n")).toBe("%%c%%\n**alpha**\n---\n");
    expect(checked("%%c%%\n\nalpha\n---\n")).toBe("%%c%%\n\n## alpha\n");
    expect(checked("%%c%%\nalpha\n---\nbeta\n---\n")).toBe("%%c%%\nalpha\n---\n## beta\n");
    expect(
      checked("%%c%%\n## alpha\n", {
        extends: [],
        dialect: "obsidian",
        rules: { "style/heading": ["warn", { style: "setext" }] },
      }),
    ).toBe("%%c%%\n## alpha\n");
  });
  it("handles a plugin's standalone comment without a source position (#383)", () => {
    const plugin: Plugin = {
      name: "unlocated-comment",
      syntax: {
        micromark: {},
        mdast: {
          transforms: [
            (tree) => {
              for (const child of tree.children)
                if (child.type === "obsidianComment") delete child.position;
            },
          ],
        },
      },
    };
    const result = format("%%c%%\nalpha\n---\n", {
      plugins: [plugin],
      config: { extends: [], dialect: "obsidian", rules: { "style/heading": "warn" } },
    });
    expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
  });
  it.each([
    "- a\n> b\n- c\n",
    "* a\n> b\n* c\n",
    "- a\n> b\n| c | d |\n| - | - |\n| e | f |\n- g\n",
    "1) a\n> b\n1. c\n",
    "1. a\n> b\n1. c\n",
    "1) a\n> b\n3. c\n",
  ])("retains list tightness and both units across a bridge: %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const input = source.replaceAll("\n", newline);
      const output = checked(input);
      if (source.includes("|")) {
        expect(output).toContain("- a");
        expect(output).toContain(newline + "- g");
        expect(output).not.toContain(newline + newline + "- g");
      } else expect(output).toBe(input);
      for (const rule of ["style/block-spacing", "style/list-marker", "style/ordered-list"])
        expect(
          checked(input, { extends: [], dialect: "obsidian", rules: { [rule]: "warn" } }),
        ).toBe(input);
    }
  });
  it.each([
    "* a\n> b\n- c\n",
    "* a\n> b\n\t\n- c\n",
    "* a\n> b\n| c | d |\n| - | - |\n| e | f |\n\t\n- g\n",
    "> * a\n> > b\n> - c\n",
  ])("keeps both bullet markers across a native continuation: %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const input = source.replaceAll("\n", newline);
      const output = checked(input);
      expect(output).toContain("* a");
      expect(output).toContain(source.includes("- g") ? "- g" : "- c");
      expect(
        checked(input, {
          extends: [],
          dialect: "obsidian",
          rules: { "style/list-marker": "warn" },
        }),
      ).toBe(input);
    }
  });
  it.each([
    "a\nb\n=\nc\n---\n",
    "#5\nb\n=\nc\n---\n",
    "a\n= \nc\n---\n",
    "a\nb\n--\nc\n---\n",
    "a\nb\n=\nc\n===\n",
    "a\nb\n--\n\t\nc\n---\n",
    "#5\nb\n=\n\t\nc\n---\n",
  ])("retains an adjacent title in the Reading paragraph: %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\ufeff"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(input);
        expect(
          checked(input, {
            extends: [],
            dialect: "obsidian",
            rules: { "style/heading": "warn" },
          }),
        ).toBe(input);
      }
  });
  it.each([
    "a\n2) ``` lang\nalpha\n\n\n``` text\nbeta\n```\n",
    "a\n2) b\n3) ``` lang\nalpha\n\n\n``` text\nbeta\n```\n",
    "a\n2) ``` lang\nalpha ```\n\n\nb\n",
    "a ``` x\n2) ``` lang\nalpha\n\n\n``` text\nbeta\n```\n",
    "a\n2) ~~~ lang\nalpha\n\n\nb\n",
    "a\n2) ~~~ lang\nalpha\n\nb\n\n*c*\n",
    "a\n2) ~~~ lang\nalpha\n~~~\n\n*c*\n",
  ])("retains the physical gap carried into code: %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const input = source.replaceAll("\n", newline);
      expect(checked(input)).toBe(input);
      expect(
        checked(input, {
          extends: [],
          dialect: "obsidian",
          rules: { "style/blank-lines": "warn" },
        }),
      ).toBe(input);
    }
  });
  it.each(["* a\n\n> b\n- c\n", "* a\n> b\n# h\n- c\n"])(
    "keeps independently separated list markers editable: %j",
    (source) => {
      expect(checked(source)).not.toContain("* a");
    },
  );
  it("resumes heading conversion after the native thematic break", () => {
    expect(checked("a\nb\n=\nc\n---\nd\n---\n")).toBe("a\nb\n=\nc\n---\n## d\n");
  });
  it("keeps inline formatting in both retained list units", () => {
    const output = checked("* *first*\n> *middle*\n- *last*\n");
    expect(output).toContain("* _first_");
    expect(output).toContain("> _middle_");
    expect(output).toContain("- _last_");
  });
  it("retains the missed fence suffix while earlier text remains editable", () => {
    const source =
      "Before *safe*.\n\na\n2) ``` lang\nalpha\n\n\n``` text\nbeta\n```\n\nLater *outside*.\n";
    const output = checked(source);
    expect(output).toBe(source.replace("*safe*", "_safe_"));
  });
});

describe("Obsidian display math boundaries (#586, #587)", () => {
  it("keeps list tightness across display math (#586)", () => {
    const source = "- a\n$$\nx = y\n$$\n- b\n";
    expect(checked(source)).toBe(source);
  });
  it.each(["- ## h", "- ```\n  a\n  ```"])(
    "retains both table separators after an item ending in %s (#582)",
    (prefix) => {
      const source = `${prefix}\n| b | c |\n| - | - |\n- d\n`;
      const output = checked(source);
      expect(output).toContain(`${prefix}\n| b`);
      expect(output).toContain("\n- d\n");
      expect(output).not.toContain("\n\n- d");
      if (prefix.includes("```")) expect(output).toBe(source);
      else expect(output).toContain("| --- | --- |");
      expect(
        checked(source, {
          extends: [],
          dialect: "obsidian",
          rules: { "style/block-spacing": "warn" },
        }),
      ).toBe(source);
    },
  );
  it.each([
    "- ~~~\n  a\n  ~~~\n| b | c |\n| - | - |\n- d\n",
    "- ```js\n  a\n  ```\n| b | c |\n| - | - |\n- d\n",
    "- ````\n  a\n  ````\n| b | c |\n| - | - |\n- d\n",
    "- ```\n  a\n  ```\n| b | c |\n| - | - |\n| e | f |\n- d\n",
    "- p\n  - ```\n    a\n    ```\n| b | c |\n| - | - |\n- d\n",
  ])("retains literal table source immediately after a list fence (#582): %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const input = source.replaceAll("\n", newline);
      // Native probing confirms that fence preferences remain safe while
      // changing the literal table rows is visible in Live Preview.
      expect(checked(input)).toBe(input.replaceAll("~~~", "```").replaceAll("````", "```"));
      expect(
        checked(input, {
          extends: [],
          dialect: "obsidian",
          rules: { "style/table": "warn" },
        }),
      ).toBe(input);
    }
  });
  it.each([
    "-     a\n| b | c |\n| - | - |\n- d\n",
    "```\na\n```\n| b | c |\n| - | - |\n- d\n",
    "- ```\n  a\n  ```\n\n| b | c |\n| - | - |\n- d\n",
  ])("keeps genuine tables editable beside independent code (#582): %j", (source) => {
    expect(
      checked(source, {
        extends: [],
        dialect: "obsidian",
        rules: { "style/table": "warn" },
      }),
    ).toContain("| --- | --- |");
  });
  it.each([
    "- alpha\n$$\nx = y\n$$\n",
    "1. alpha\n$$\nx = y\n$$\n",
    "2. alpha\n$$\nx = y\n$$\n",
    "- ## title\n$$\nx = y\n$$\n",
    "- ```\n  a\n  ```\n$$\nx = y\n$$\n",
    "alpha\n$$x = y$$\n",
    "- alpha\n$$x = y$$\n",
  ])("keeps the native list containment or display widget: %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\ufeff"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(input);
        for (const rule of ["style/block-spacing", "style/wrap"])
          expect(
            checked(input, { extends: [], dialect: "obsidian", rules: { [rule]: "warn" } }),
          ).toBe(input);
      }
  });
  it.each(["- alpha\n$$\nx = y\n$$\n", "alpha\n$$x = y$$\n"])(
    "rejects a plugin changing the alternate-view math boundary: %j",
    (source) => {
      const offset = source.indexOf("$$");
      const plugin: Plugin = {
        name: "split",
        rules: {
          math: {
            kind: "style",
            description: "Change the math separator",
            check: () => [
              {
                start: offset,
                message: "Change",
                edit: source.includes("\n$$\n")
                  ? { start: offset, end: offset, text: "\n" }
                  : { start: offset - 1, end: offset, text: " " },
              },
            ],
          },
        },
      };
      const result = format(source, {
        workspace,
        plugins: [plugin],
        config: { extends: [], dialect: "obsidian", rules: { "split/math": "warn" } },
      });
      expect(result.output).toBe(source);
    },
  );
  it("allows independent inline and marker formatting before math", () => {
    expect(checked("* *alpha*\n$$\nx = y\n$$\n")).toBe("- _alpha_\n$$\nx = y\n$$\n");
    expect(checked("*alpha*\n$$x = y$$\n")).toBe("_alpha_\n$$x = y$$\n");
  });
  it("still wraps ordinary inline math and spaces genuinely separated blocks", () => {
    expect(checked("alpha $$x = y$$\nbeta\n")).toBe("alpha $$x = y$$ beta\n");
    expect(checked("- alpha\n\n$$\nx = y\n$$\n")).toBe("- alpha\n\n$$\nx = y\n$$\n");
  });
});

describe.each(["\n", "\r\n", "\r"])("protected boundary start points with %j (#590)", (newline) => {
  const source = `- ## *h*${newline}outside${newline}`;
  function proposal(kind: string) {
    const at = source.indexOf(newline);
    const tail = kind === "combined-space" ? " " : kind === "combined-tab" ? "\t" : "";
    return kind === "before-break"
      ? { start: at, end: at, text: newline }
      : kind === "after-break"
        ? { start: at + newline.length, end: at + newline.length, text: newline }
        : kind === "unchanged-prefix"
          ? { start: 0, end: at, text: source.slice(0, at) + newline }
          : kind.startsWith("combined-")
            ? { start: 0, end: at, text: `- ## _h_${newline}${tail}` }
            : kind === "copied-suffix"
              ? { start: 0, end: source.length, text: source.replace("*h*", `_h_${newline}`) }
              : { start: 0, end: at, text: kind === "longer-style" ? "- ## _h_ ###" : "- ## _h_" };
  }
  function pluginOutput(kind: string) {
    const plugin: Plugin = {
      name: "edge",
      rules: {
        change: {
          kind: "style",
          description: "Change a protected boundary",
          check: ({ document }) =>
            document.source !== source
              ? []
              : [{ start: 0, message: "Change", edit: proposal(kind) }],
        },
      },
    };
    const result = format(source, {
      workspace,
      plugins: [plugin],
      config: { extends: [], dialect: "obsidian", rules: { "edge/change": "warn" } },
    });
    expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
    return result.output;
  }
  it.each([
    "before-break",
    "after-break",
    "unchanged-prefix",
    "combined-style",
    "combined-space",
    "combined-tab",
    "copied-suffix",
  ])("rejects an unsafe %s separator edit", (kind) => expect(pluginOutput(kind)).toBe(source));
  it.each(["style", "longer-style"])("allows a safe terminal %s edit", (kind) => {
    expect(pluginOutput(kind)).toBe(
      source.replace("*h*", kind === "longer-style" ? "_h_ ###" : "_h_"),
    );
  });
});

describe("Obsidian boundaries read differently by its views", () => {
  it.each([
    "$x$\n---\n",
    "$x$ $y$\n---\n",
    "$x$%%note%%\n---\n",
    "![cedar](cedar.png)\n---\n",
    "![cedar][img]\n---\n\n[img]: cedar.png\n",
    "![[cedar.png]]\n---\n",
  ])(
    "retains widget title source with isolated heading and whitespace rules (#383): %j",
    (source) => {
      for (const rule of ["style/heading", "style/trailing-space", "style/wrap"])
        for (const newline of ["\n", "\r\n", "\r"])
          for (const bom of ["", "\uFEFF"]) {
            const input = bom + source.replaceAll("\n", newline);
            expect(
              checked(input, { extends: [], dialect: "obsidian", rules: { [rule]: "warn" } }),
            ).toBe(input);
          }
    },
  );

  it.each([
    "# $x$\n",
    "## $x$ $y$\n",
    "## $x$%%note%%\n",
    "## ![cedar](cedar.png)\n",
    "## ![[cedar.png]]\n",
  ])("also retains ATX widget titles when Setext is requested (#383): %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(
          checked(input, {
            extends: [],
            dialect: "obsidian",
            rules: { "style/heading": ["warn", { style: "setext" }] },
          }),
        ).toBe(input);
      }
  });

  it.each([
    ["before $x$ after", "## before $x$ after\n"],
    ["*$x$*", "## *$x$*\n"],
    ["![cedar](cedar.png) after", "## ![cedar](cedar.png) after\n"],
    ["`code`", "## `code`\n"],
    ["[name](https://example.com)", "## [name](https://example.com)\n"],
  ])("keeps native-safe heading conversion for %j (#383)", (text, expected) => {
    expect(
      checked(text + "\n---\n", {
        extends: [],
        dialect: "obsidian",
        rules: { "style/heading": "warn" },
      }),
    ).toBe(expected);
  });

  it("keeps a widget title while formatting a later independent paragraph (#383)", () => {
    expect(checked("$x$\n---\n\nLater *safe*.\n")).toBe("$x$\n---\n\nLater _safe_.\n");
    expect(checked("![cedar](cedar.png)\n---\n\nLater *safe*.\n")).toBe(
      "![cedar](cedar.png)\n---\n\nLater _safe_.\n",
    );
  });

  it.each([
    ["Later *safe*.\n", "Later _safe_.\n"],
    ["| a | __b__ |\n| :-- | --: |\n| c | d |\n", "| a | **b** |\n| :-- | --: |\n| c | d |\n"],
    ["+ *safe*\n", "+ _safe_\n"],
    ["### *safe* ###\n", "### _safe_\n"],
  ])("formats the block directly after a widget heading (#383): %j", (later, expected) => {
    for (const title of ["$x$", "![cedar](cedar.png)"])
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", "\uFEFF"]) {
          const source = `${title}\n---\n${later}`;
          expect(checked(bom + source.replaceAll("\n", newline))).toBe(
            bom +
              `${title}\n---\n${later.startsWith("|") || later.startsWith("+") ? "" : "\n"}${expected}`.replaceAll(
                "\n",
                newline,
              ),
          );
        }
  });

  it.each(["$x$\n--- \n", "$x$\n  ---\n", "$x$\nsecond\n===\n"])(
    "keeps paragraph-state protection when a widget underline is also literal (#383): %j",
    (title) => {
      const source = title + "| a | __b__ |\n| :-- | --: |\n| c | d |\n";
      expect(misreadLists(parse(source, "obsidian")).underlines.size).toBeGreaterThan(0);
      expect(checked(source)).toBe(source);
    },
  );

  it("preserves one-column border combinations and their Reading continuation state (#568)", () => {
    for (const headerLeading of [false, true])
      for (const headerTrailing of [false, true])
        for (const delimiterLeading of [false, true])
          for (const delimiterTrailing of [false, true]) {
            const prefix =
              `${headerLeading ? "| " : ""}basket${headerTrailing ? " |" : ""}\n` +
              `${delimiterLeading ? "| " : ""}--:${delimiterTrailing ? " |" : ""}\n` +
              `${headerLeading ? "| " : ""}walnut${headerTrailing ? " |" : ""}\n`;
            const later = "\t\n| a | __b__ |\n| :-- | --: |\n| c | d |\n";
            const source = prefix + later;
            const readingTable =
              headerTrailing && delimiterTrailing && headerLeading === delimiterLeading;
            const liveTable = readingTable && headerLeading;
            for (const newline of ["\n", "\r\n", "\r"])
              for (const bom of ["", "\uFEFF"]) {
                const input = bom + source.replaceAll("\n", newline);
                const output = checked(input);
                if (!readingTable) expect(output).toBe(input);
                else {
                  expect(output).toContain("**b**");
                  if (!liveTable)
                    expect(output.startsWith(bom + prefix.replaceAll("\n", newline))).toBe(true);
                }
              }
          }
  });

  it.each(["style/table", "style/strong"])(
    "keeps Live Preview one-column text with only %s (#568)",
    (rule) => {
      const source = "__basket__ |\n--: |\nwalnut |\n";
      expect(checked(source, { extends: [], dialect: "obsidian", rules: { [rule]: "warn" } })).toBe(
        source,
      );
    },
  );

  it("leaves ordinary bordered and multicolumn tables editable (#568)", () => {
    expect(checked("| basket |\n| --: |\n| walnut |\n")).toBe(
      "| basket |\n| -----: |\n| walnut |\n",
    );
    expect(checked("a | __b__\n-- | --\nc | d\n")).toContain("**b**");
  });

  it.each([
    "~~~ lang `x`\nc\n~~~\n\n*outside*\n",
    "* a\nb\n~~~ lang `x`\nc\n~~~\n\n*outside*\n",
    "- ~~~ lang `x`\n  c\n  ~~~\n\n*outside*\n",
    "> ~~~ lang `x`\n> c\n> ~~~\n\n*outside*\n",
    "> ~~~ lang `x`\n> c\n> ~~~\n>\n> *outside*\n",
    "  ~~~ lang `x`\n  c\n  ~~~\n\n*outside*\n",
    "~~~~ lang `x`\nc\n~~~~~\n\n*outside*\n",
    "~~~ lang \\`x\\`\nc\n~~~\n\n*outside*\n",
    "~~~ lang `x`\nc\n~~~\n\n*inside*\n\n~~~\nraw\n~~~\n\n*after*\n",
  ])("keeps later source after a primary closer opens Live Preview code (#567): %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"]) {
        const input = bom + source.replaceAll("\n", newline);
        const output = checked(input);
        expect(output).toContain(source.includes("*outside*") ? "*outside*" : "*after*");
        expect(output).not.toContain("_outside_");
        expect(output).not.toContain("_inside_");
        const document = parse(input, "obsidian");
        expect(
          [...misreadLists(document).openFences].some(
            ({ position }) => position!.end.offset === document.source.length,
          ),
        ).toBe(true);
      }
  });

  it("recognizes a final closed ignored-info fence without a later leaf (#567)", () => {
    const document = parse("~~~ lang `x`\nc\n~~~\n", "obsidian");
    expect(misreadLists(document).openFences.size).toBe(1);
  });

  it.each(["~~~ lang\nc\n~~~\n\n*outside*\n", "~~~ lang &#96;x&#96;\nc\n~~~\n\n*outside*\n"])(
    "formats the tail of a genuine tilde fence (%j, #567)",
    (source) => {
      expect(checked(source)).toContain("_outside_");
      expect(misreadLists(parse(source, "obsidian")).openFences.size).toBe(0);
    },
  );

  it.each(["~~~~ lang `x`\nc\n~~~\n", "~~~ lang `x`\nc\n    ~~~\n"])(
    "does not mistake a body run for a closing fence (#567): %j",
    (source) => expect(misreadLists(parse(source, "obsidian")).openFences.size).toBe(0),
  );

  it.each([
    "basket\n--:\nwalnut\n\t\n| a | __b__ |\n| :-- | --: |\n| c | d |\n",
    "basket\n--:\n\t\n| a | __b__ |\n| :-- | --: |\n| c | d |\n",
  ])("keeps Reading paragraph state after a one-column text table (#398): %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(input);
      }
  });

  it.each(["style/table", "style/strong"])(
    "retains later literal table rows with only %s (#398)",
    (rule) => {
      const source = "basket\n--:\nwalnut\n\t\n| a | __b__ |\n| :-- | --: |\n| c | d |\n";
      expect(checked(source, { extends: [], dialect: "obsidian", rules: { [rule]: "warn" } })).toBe(
        source,
      );
    },
  );

  it.each([
    "basket |\n--: |\nwalnut |\n\t\n",
    "basket\n--:\nwalnut\n\n",
    "basket\n--:\nwalnut\n  \n",
    "basket\n--:\nwalnut\n\t\n# boundary\n\n",
  ])("permits a later real table's inline preferences after %j (#398)", (prefix) => {
    const source = prefix + "| a | __b__ |\n| :-- | --: |\n| c | d |\n";
    expect(
      checked(source, { extends: [], dialect: "obsidian", rules: { "style/strong": "warn" } }),
    ).toBe(source.replace("__b__", "**b**"));
  });

  it("keeps directly adjacent rows in the already protected one-column parse (#398)", () => {
    const source = "basket\n--:\nwalnut\n| a | __b__ |\n| :-- | --: |\n| c | d |\n";
    expect(checked(source)).toBe(source);
    expect(parse(source, "obsidian").tree.children.map(({ type }) => type)).toEqual(["table"]);
  });

  it.each([
    ["before %%`a\n``` b`%%\n\nlater *outside*\n", true],
    ["before %%`a\n``` b` c```%%\n\nlater *outside*\n", false],
    ["before %%`a ``` b` c```%%\n\nlater *outside*\n", true],
  ] as const)(
    "carries long code after a short-code reset only while unclosed (#565): %j",
    (source, carries) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", "\uFEFF"]) {
          const input = bom + source.replaceAll("\n", newline);
          expect(checked(input)).toBe(carries ? input : input.replace("*outside*", "_outside_"));
          const document = parse(input, "obsidian");
          const later = document.source.lastIndexOf("later");
          expect(
            [...misreadLists(document).unclosedCode].some(
              ({ position }) => position!.start.offset! <= later && later < position!.end.offset!,
            ),
          ).toBe(carries);
        }
    },
  );

  it.each([
    "before *left* ![```a\nb```](image.png) and *right* __strong__ tail\n",
    "before *left* ![```a\nb```][img] and *right* __strong__ tail\n\n[img]: image.png\n",
  ])(
    "keeps a long-code image description boundary while surrounding inline text formats (#566): %j",
    (source) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", "\uFEFF"]) {
          const input = bom + source.replaceAll("\n", newline);
          expect(
            checked(input, { extends: [], dialect: "obsidian", rules: { "style/wrap": "warn" } }),
          ).toBe(input);
        }
    },
  );

  it("formats inline text around an unreflowed multiline code image (#566)", () => {
    const source = "before *left* ![```a\nb```](image.png) and *right* __strong__ tail\n";
    expect(checked(source)).toBe(
      "before _left_ ![```a\nb```](image.png) and _right_ **strong** tail\n",
    );
    expect(format(source, { config: { extends: ["recommended", "github"] } }).output).toContain(
      "![```a b```](image.png)",
    );
  });

  it.each([
    "style/wrap",
    "style/inline-code",
    "style/emphasis",
    "style/strong",
    "style/trailing-space",
  ])("retains short multiline code and literal suffix with only %s (#565)", (rule) => {
    const source = "before `a\t  \nb` and *right* __strong__ tail\n";
    expect(
      checked(source, {
        extends: [],
        dialect: "obsidian",
        rules: { [rule]: "warn" },
      }),
    ).toBe(source);
  });

  it.each(["*before `a\nb` after* and __strong__\n", "[before `a\nb` after](u) and *right*\n"])(
    "retains containing paired inline markup without partial edits (#565): %j",
    (source) => expect(checked(source)).toBe(source),
  );

  it("permits safe prefix formatting and resumes after a blank paragraph (#565)", () => {
    const source = "before *left* `a  \nb` and *right* __strong__ tail\n\nLater *outside*.\n";
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(
          input.replace("*left*", "_left_").replace("*outside*", "_outside_"),
        );
      }
  });

  it("bounds the short multiline-code protection to its first containing inline node (#565)", () => {
    const source = "*left* and **before `a\nb` after** and *right*\n\nLater *outside*.\n";
    const document = parse(source, "obsidian");
    const regions = [...misreadLists(document).unclosedCode];
    expect(
      regions.map(({ position }) =>
        document.source.slice(position!.start.offset, position!.end.offset),
      ),
    ).toEqual(["**before `a\nb` after** and *right*"]);
    expect(checked(source)).toBe(
      source.replace("*left*", "_left_").replace("*outside*", "_outside_"),
    );
  });

  it("retains ordinary multiline-code joining in GitHub (#565)", () => {
    expect(
      format("before `a\nb` and *right*\n", { config: { extends: ["recommended", "github"] } })
        .output,
    ).toBe("before `a b` and _right_\n");
  });

  it("keeps a long code span's source hard-break marker while joining soft code (#335)", () => {
    expect(checked("before ```a  \nb``` and *right*\n\nlater *outside*\n")).toBe(
      "before ```a  \nb``` and _right_\n\nlater _outside_\n",
    );
    expect(checked("before ```a\nb``` and *right*\n\nlater *outside*\n")).toBe(
      "before ```a b``` and _right_\n\nlater _outside_\n",
    );
  });

  it.each([
    "a\\ \n=== \n",
    "a  \n=== \n",
    "a\\ \n  ===\n",
    "a  \n  ===\n",
    "a\nb  \n===\n",
    "a\nb\\ \n===\n",
  ])("retains the terminal separator before a literal underline (#383): %j", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + source.replaceAll("\n", newline),
        );
  });

  it("permits earlier inline formatting above a literal underline (#383)", () => {
    expect(checked("*alpha* beta\\ \n=== \n")).toBe("_alpha_ beta\\ \n=== \n");
  });

  it("still cleans a proper Setext title's terminal separator (#383)", () => {
    const settings: Config = {
      extends: [],
      dialect: "obsidian",
      rules: { "style/trailing-space": "warn" },
    };
    expect(checked("a\\ \n===\n", settings)).toBe("a\\\n===\n");
    expect(checked("a  \n===\n", settings)).toBe("a\n===\n");
  });

  it.each(["+ - a\nb\n  1) c\n", "+ - a\nb\n  1) c\n     d\n", "- a\nb\n  1) c\n"])(
    "retains lazy text and later blocks in the affected enclosing item (#376): %j",
    (source) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", String.fromCharCode(0xfeff)]) {
          const input = bom + source.replaceAll("\n", newline);
          expect(checked(input)).toBe(input);
          const document = parse(input, "obsidian");
          const following = document.source.lastIndexOf("c");
          expect(
            [...misreadLists(document).lazyItems].some(
              ({ position }) => position!.start.offset === 0 && position!.end.offset! > following,
            ),
          ).toBe(true);
        }
    },
  );

  it.each(["+ - a\n    b\n  1) c\n", "+ - a\nb\n", "+ - a\nb\n\n1) c\n"])(
    "permits list reflow without a later affected enclosing block (#376): %j",
    (source) => {
      expect(misreadLists(parse(source, "obsidian")).lazyItems.size).toBe(0);
      control(source);
    },
  );

  it.each(
    boundaryFixtures.filter(
      ({ issue, name, preserve }) =>
        issue === 556 && name.startsWith("multiline root:") && preserve === false,
    ),
  )("resumes after a balanced $name (#556)", ({ source }) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(input.replace("*outside*", "_outside_"));
        const document = parse(input, "obsidian");
        const outside = document.source.lastIndexOf("Later");
        const { htmlText, htmlCodeToEnd } = misreadLists(document);
        expect(htmlCodeToEnd).toBe(false);
        expect(
          [...htmlText].some(
            ({ position }) => position!.start.offset! <= outside && outside < position!.end.offset!,
          ),
        ).toBe(false);
      }
  });

  it.each([
    '> <div\n>   class="note">\n> text\n> </div>\n\nLater *outside*.\n',
    '- <div\n    class="note">\n  text\n  </div>\n\nLater *outside*.\n',
  ])("retains the existing contained multiline fallback in %j (#556)", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + source.replaceAll("\n", newline),
        );
  });

  it.each([1, 2, 3])(
    "keeps a bordered table's physical row boundary with %i columns (#558)",
    (columns) => {
      const row = (count: number, prefix: string) =>
        Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(" | ");
      const table = `| ${row(columns, "h")} |\n| ${Array(columns).fill("-").join(" | ")} |\n| ${row(columns, "a")} |\n`;
      for (const cells of [1, 2, 3, 4]) {
        for (const tail of [row(cells, "x"), `${row(cells, "x")} |`]) {
          const source = `${table}${tail}\n`;
          expect(checked(source)).toBe(source);
          const document = parse(source, "obsidian");
          expect(
            [...misreadLists(document).tableText].some(
              ({ position }) =>
                position!.start.offset === table.length - 1 &&
                position!.end.offset === source.length - 1,
            ),
          ).toBe(true);
        }
      }
      const leadingOnly = `${table}| x1\n`;
      expect(checked(leadingOnly)).toBe(leadingOnly);
    },
  );

  it.each([1, 2, 3])("permits native pipe rows under a %i-column header (#558)", (columns) => {
    const row = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(" | ");
    const table = `| ${row(columns, "h")} |\n| ${Array(columns).fill("-").join(" | ")} |\n| ${row(columns, "a")} |\n`;
    for (const cells of [1, 2, 3, 4]) {
      // A leading-only row needs another pipe. Body cell count can be shorter
      // or longer than its header; the existing printer decides what it can edit.
      for (const tail of [
        `| ${row(cells, "x")} |`,
        ...(cells > 1 ? [`| ${row(cells, "x")}`] : []),
      ]) {
        const source = `${table}${tail}\n`;
        expect(misreadLists(parse(source, "obsidian")).tableText.size).toBe(0);
        checked(source);
      }
    }
  });

  it("keeps every later primary row after the first native table boundary (#558)", () => {
    const source = "| a | b |\n| - | - |\n| c | d |\nleft | *right*\n| later | __row__ |\n";
    const document = parse(source, "obsidian");
    expect(checked(source)).toBe(source);
    expect(
      [...misreadLists(document).tableText].some(
        ({ position }) =>
          position!.start.offset === source.indexOf("\nleft") &&
          position!.end.offset === source.length - 1,
      ),
    ).toBe(true);
  });

  it("keeps unbordered tables formattable and does not apply the native boundary to GitHub (#558)", () => {
    expect(checked("h1 | h2\n-|-\na1 | a2\nx1 | x2\n")).toBe(
      "| h1  | h2  |\n| --- | --- |\n| a1  | a2  |\n| x1  | x2  |\n",
    );
    const source = "| a | b |\n| - | - |\n| c | d |\nleft | right\n";
    expect(checked(source, { extends: ["recommended"], dialect: "github" })).toBe(
      "| a    | b     |\n| ---- | ----- |\n| c    | d     |\n| left | right |\n",
    );
  });

  // Every shared preserve fixture automatically gets all three newline spellings,
  // BOM, no-rules, idempotence, primary fingerprint and no engine-diagnostic checks
  // through the existing generic tests; independent appended prose is also covered.

  it.each(boundaryFixtures.filter(({ issue, preserve }) => issue === 556 && preserve !== false))(
    "keeps root HTML depth through later literal blocks with $name (#556)",
    ({ source }) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", String.fromCharCode(0xfeff)]) {
          const input = bom + source.replaceAll("\n", newline);
          expect(checked(input)).toBe(input);
          const document = parse(input, "obsidian");
          const { htmlText, htmlCodeToEnd } = misreadLists(document);
          expect(htmlCodeToEnd).toBe(false);
          expect(
            [...htmlText].some(
              ({ position }) =>
                position?.start.offset === 0 &&
                position.end.offset === document.source.length &&
                position.end.line === source.split("\n").length &&
                position.end.column === 1,
            ),
          ).toBe(true);
        }
    },
  );

  it.each(["style/block-spacing", "style/emphasis"])(
    "keeps the raw tail with isolated %s (#556)",
    (rule) => {
      const source = "<div>\n<span>text\n</div>\n\n# *title*\n> *quote*\n";
      expect(checked(source, { extends: [], dialect: "obsidian", rules: { [rule]: "warn" } })).toBe(
        source,
      );
    },
  );

  it("formats independent text before and after the root HTML depth closes (#556)", () => {
    const raw = "<div>\n<span>text\n</div>\n\n# *literal*\n> *quote*\n\n</span>";
    const source = `Before *safe*.\n\n${raw}\n\nAfter *safe*.\n`;
    const output = checked(source);
    expect(output).toContain(raw);
    expect(output).toContain("Before _safe_.");
    expect(output).toContain("After _safe_.");
    const ranges = [...misreadLists(parse(source, "obsidian")).htmlText];
    const outside = source.lastIndexOf("After");
    expect(
      ranges.some(
        ({ position }) => position!.start.offset! <= outside && outside < position!.end.offset!,
      ),
    ).toBe(false);
  });

  it("scans later roots within the original root HTML leaf (#556)", () => {
    const source = "<div></div><span>text\n\n# title\n> quote\n";
    expect(checked(source)).toBe(source);
  });

  it("resumes after closing root HTML below a joined definition (#556)", () => {
    const source =
      "text\n[^1]: note\n<div> words\n| __h__ |\n| - |\n| v |\n\n</div>\n\nLater *outside*.\n";
    expect(checked(source)).toContain("Later _outside_.");
  });

  it.each([
    [
      "padding decrease captures dependency line",
      "+    alpha\n  beta\n  gamma\n---\n",
      { extends: [], dialect: "obsidian", rules: { "style/list-indent": "warn" } },
      "+    alpha\n  beta\n  gamma\n---\n",
    ],
    [
      "physical line index includes preceding blocks",
      "# intro\n\n+    alpha\n  beta\n  gamma\n---\n",
      { extends: [], dialect: "obsidian", rules: { "style/list-indent": "warn" } },
      "# intro\n\n+    alpha\n  beta\n  gamma\n---\n",
    ],
    [
      "recommended passes keep the lazy threshold",
      "+    alpha\n  beta\n  gamma\n---\n",
      config,
      "-    alpha\n  beta\n  gamma\n---\n",
    ],
    [
      "smaller padding remains above lazy indentation",
      "+    alpha\n  beta\n  gamma\n---\n",
      {
        extends: [],
        dialect: "obsidian",
        rules: { "style/list-indent": ["warn", { bulletSpaces: 2 }] },
      },
      "+  alpha\n  beta\n  gamma\n---\n",
    ],
    [
      "larger padding keeps lazy lines outside",
      "+ alpha\nbeta\ngamma\n---\n",
      {
        extends: [],
        dialect: "obsidian",
        rules: { "style/list-indent": ["warn", { bulletSpaces: 4 }] },
      },
      "+    alpha\nbeta\ngamma\n---\n",
    ],
    [
      "padding decrease cannot capture zero-column text",
      "+    alpha\nbeta\ngamma\n---\n",
      { extends: [], dialect: "obsidian", rules: { "style/list-indent": "warn" } },
      "+ alpha\nbeta\ngamma\n---\n",
    ],
    [
      "ordered digit shrink captures dependency line",
      "9. first\n10. alpha\n   beta\n   gamma\n---\n",
      {
        extends: [],
        dialect: "obsidian",
        rules: { "style/ordered-list": ["warn", { numbering: "same" }] },
      },
      "9. first\n10. alpha\n   beta\n   gamma\n---\n",
    ],
    [
      "ordered digit shrink leaves zero-column text lazy",
      "9. first\n10. alpha\nbeta\ngamma\n---\n",
      {
        extends: [],
        dialect: "obsidian",
        rules: { "style/ordered-list": ["warn", { numbering: "same" }] },
      },
      "9. first\n9. alpha\nbeta\ngamma\n---\n",
    ],
    [
      "ordered digit increase remains eligible",
      "9. first\n9. alpha\n  beta\n  gamma\n---\n",
      {
        extends: [],
        dialect: "obsidian",
        rules: { "style/ordered-list": ["warn", { numbering: "ordered" }] },
      },
      "9. first\n10. alpha\n  beta\n  gamma\n---\n",
    ],
    [
      "nested padding shrink captures dependency line",
      "- outer\n  +    alpha\n    beta\n    gamma\n---\n",
      { extends: [], dialect: "obsidian", rules: { "style/list-indent": "warn" } },
      "- outer\n  +    alpha\n    beta\n    gamma\n---\n",
    ],
    [
      "blank before break ends dependency",
      "+    alpha\n  beta\n  gamma\n\n---\n",
      config,
      "- alpha beta gamma\n\n---\n",
    ],
    [
      "single continuation has no heading dependency",
      "+    alpha\n  beta\n---\n",
      config,
      "- alpha beta\n\n---\n",
    ],
  ] satisfies [string, string, Config, string][])(
    "keeps heading-dependent lazy margins with %s (#554)",
    (_name, source, settings, expected) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", String.fromCharCode(0xfeff)])
          control(
            bom + source.replaceAll("\n", newline),
            bom + expected.replaceAll("\n", newline),
            settings,
          );
    },
  );

  it.each([
    [
      "spaced break under body row",
      "| h |\n| - |\n| v |\n- - -\n",
      "| h   |\n| --- |\n| v   |\n- - -\n",
    ],
    ["star break under body row", "| h |\n| - |\n| v |\n***\n", "| h   |\n| --- |\n| v   |\n***\n"],
    [
      "spaced break under header-only delimiter",
      "| h |\n| - |\n- - -\n",
      "| h   |\n| --- |\n- - -\n",
    ],
    [
      "compact break preserves literal body-row spacing",
      "|h|\n|-|\n|last|\n---\n",
      "|h|\n|-|\n|last|\n---\n",
    ],
    ["compact break preserves literal header-only delimiter", "|h|\n|-|\n---\n", "|h|\n|-|\n---\n"],
    [
      "blank-separated table remains formattable",
      "| h |\n| - |\n| v |\n\n- - -\n",
      "| h   |\n| --- |\n| v   |\n\n---\n",
    ],
  ])("preserves table/underline boundaries with %s (#553)", (_name, source, expected) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + expected.replaceAll("\n", newline),
        );
  });

  it.each(["|h|\n|-|\n|last|\n---\n", "|h|\n|-|\n---\n"])(
    "retains existing compact table underlines for another preferred marker (#553)",
    (source) => {
      expect(
        checked(source, {
          ...config,
          rules: { "style/thematic-break": ["warn", { marker: "***" }] },
        }),
      ).toBe(source);
    },
  );

  it.each([
    ["two lazy list continuations", "- alpha\nbeta\ngamma\n---\n", "- alpha\nbeta\ngamma\n---\n"],
    [
      "earlier lazy line before indented title",
      "- alpha\nbeta\n  gamma\n---\n",
      "- alpha\nbeta\n  gamma\n---\n",
    ],
    ["quoted lazy continuation", "> alpha\nbeta\n---\n", "> alpha\nbeta\n---\n"],
    ["short single continuation control", "- alpha\nbeta\n---\n", "- alpha beta\n\n---\n"],
    [
      "only final continuation lazy control",
      "- alpha\n  beta\ngamma\n---\n",
      "- alpha beta gamma\n\n---\n",
    ],
    ["blank-separated control", "- alpha\nbeta\ngamma\n\n---\n", "- alpha beta gamma\n\n---\n"],
    [
      "earlier inline text remains eligible",
      "- *alpha*\nmiddle *beta*\n*gamma*\n---\n",
      "- _alpha_\nmiddle _beta_\n*gamma*\n---\n",
    ],
    [
      "paired first inline markers stay together",
      "- *alpha*\n*beta* interior *delta*\n  gamma\n---\n",
      "- _alpha_\n*beta* interior _delta_\n  gamma\n---\n",
    ],
    [
      "paired inline markers cross final boundary",
      "- *alpha\nbeta\ngamma*\n---\n",
      "- *alpha\nbeta\ngamma*\n---\n",
    ],
  ])("preserves lazy-container heading lines with %s (#554)", (_name, source, expected) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        control(bom + source.replaceAll("\n", newline), bom + expected.replaceAll("\n", newline));
  });

  it.each(["style/wrap", "style/block-spacing"])(
    "retains both lazy-heading boundaries with isolated %s (#554)",
    (rule) => {
      const source = "- alpha\nbeta\ngamma\n---\n";
      expect(checked(source, { extends: [], dialect: "obsidian", rules: { [rule]: "warn" } })).toBe(
        source,
      );
    },
  );

  it.each([
    "- alpha beta enough words to fill a line\nlazy omegaomegaomegaomegaomega\n  gamma\n---\n",
    "- alpha\nomegaomegaomegaomegaomega\n  gamma\n---\n",
    "1) alpha\nomegaomegaomegaomegaomega\n   gamma\n---\n",
  ])(
    "retains the earlier lazy margin when reflow keeps the final title suffix (#554)",
    (source) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const bom of ["", String.fromCharCode(0xfeff)])
          expect(
            checked(bom + source.replaceAll("\n", newline), {
              extends: [],
              dialect: "obsidian",
              rules: { "style/wrap": ["warn", { width: 30 }] },
            }),
          ).toBe(bom + source.replaceAll("\n", newline));
    },
  );

  it.each([
    "- *alpha\nbeta\ngamma*\n---\n",
    "- alpha\nplain *beta\ngamma*\n---\n",
    "- alpha\nplain __beta\ngamma__\n---\n",
    "- alpha\nplain [*beta\ngamma*](https://example.com/a)\n---\n",
    "- [*alpha\nbeta\ngamma*](https://example.com/a)\n---\n",
    "> *alpha\nbeta*\n---\n",
  ])("keeps paired inline edits whole across protected lazy boundaries (#554)", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + source.replaceAll("\n", newline),
        );
  });

  it.each([
    [
      "style/list-marker",
      { marker: "-" },
      "+ alpha\nbeta\ngamma\n---\n",
      "- alpha\nbeta\ngamma\n---\n",
    ],
    [
      "style/ordered-list",
      { delimiter: "." },
      "1) alpha\nbeta\ngamma\n---\n",
      "1. alpha\nbeta\ngamma\n---\n",
    ],
    [
      "style/list-indent",
      { bulletSpaces: 4 },
      "+ alpha\nbeta\ngamma\n---\n",
      "+    alpha\nbeta\ngamma\n---\n",
    ],
  ] as const)(
    "reports held structural formatting with %s (#554, #603)",
    (rule, options, source, expected) => {
      control(source, expected, {
        extends: [],
        dialect: "obsidian",
        rules: { [rule]: ["warn", options] },
      });
    },
  );

  it("keeps the table marker restriction specific to Obsidian (#553)", () => {
    const source = "| h |\n| - |\n| v |\n- - -\n";
    expect(
      format(source, {
        config: { extends: [], dialect: "github", rules: { "style/thematic-break": "warn" } },
      }).output,
    ).toBe("| h |\n| - |\n| v |\n---\n");
  });

  it.each([
    [
      "physical blank between definitions control",
      "text\n[^1]: note\n    <div> a\n\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n    <div> a\n\n[^2]: second\n    <div> b\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "physical blank inside first definition control",
      "text\n[^1]: note\n\n    <div> a\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n\n    <div> a\n[^2]: second\n    <div> b\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "space-only line ends prior joined definition context",
      "text\n[^1]: note\n \n    <div> a\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n \n    <div> a\n[^2]: second\n    <div> b\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "tab-only line retains prior joined definition context",
      "text\n[^1]: note\n\t\n    <div> a\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n\t\n    <div> a\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "nested definition after a joined heading leaf",
      "text\n[^1]: note\n    # first\n    [^2]: second\n        <div> b\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n    # first\n    [^2]: second\n        <div> b\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "same-line nested definitions after a joined HTML leaf",
      "text\n[^1]: note\n    <div> a\n[^2]: [^3]: second\n        <div> b\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n    <div> a\n[^2]: [^3]: second\n        <div> b\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "definitions without an initial paragraph remain independent",
      "[^1]: note\n    <div> a\n[^2]: second\n    <div> b\n| __h__ |\n| - |\n| v |\n",
      "[^1]: note\n    <div> a\n[^2]: second\n    <div> b\n| **h** |\n| ----- |\n| v     |\n",
    ],
  ])("retains chained footnote boundaries with %s (#551)", (_name, source, expected) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + expected.replaceAll("\n", newline),
        );
  });
  it.each([
    [
      "independent footnote after physical blank",
      "Ref[^1].\n\n[^1]: note\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "Ref[^1].\n\n[^1]: note\n    <div> words\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "physical blank before indented HTML body",
      "text\n[^1]: note\n\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n\n    <div> words\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "physical blank before following table",
      "text\n[^1]: note\n    <div> words\n\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n    <div> words\n\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "multiple tables in one joined footnote",
      "text\n[^1]: note\n    # first\n    | __a__ |\n    | - |\n    | x |\n    # second\n    | __b__ |\n    | - |\n    | y |\n",
      "text\n[^1]: note\n    # first\n    | __a__ |\n    | - |\n    | x |\n    # second\n    | __b__ |\n    | - |\n    | y |\n",
    ],
    [
      "later blank ends earlier joined-footnote context",
      "text\n[^1]: note\n    # first\n    | __a__ |\n    | - |\n    | x |\n\n    # second\n| __b__ |\n| - |\n| y |\n",
      "text\n[^1]: note\n    # first\n    | __a__ |\n    | - |\n    | x |\n\n    # second\n| **b** |\n| ----- |\n| y     |\n",
    ],
    [
      "space-only separator ends joined-footnote context",
      "text\n[^1]: note\n \n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n \n    <div> words\n| **h** |\n| ----- |\n| v     |\n",
    ],
    [
      "tab-only separator continues joined-footnote context",
      "text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "adjacent joined footnote definitions",
      "text\n[^1]: first\n[^2]: note\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: first\n[^2]: note\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "nested joined footnote definitions",
      "text\n[^1]: first\n    [^2]: note\n        <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: first\n    [^2]: note\n        <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "same-line nested joined footnote definitions",
      "text\n[^1]: [^2]: note\n        <div> words\n| __h__ |\n| - |\n| v |\n",
      "text\n[^1]: [^2]: note\n        <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "two separate joined-footnote table boundaries",
      "text\n[^1]: first\n    <div> words\n| __a__ |\n| - |\n| x |\n\nMore\n[^2]: second\n    # heading\n| __b__ |\n| - |\n| y |\n",
      "text\n[^1]: first\n    <div> words\n| __a__ |\n| - |\n| x |\n\nMore\n[^2]: second\n    # heading\n| __b__ |\n| - |\n| y |\n",
    ],
    [
      "two-column paragraph and left tab",
      "  text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "  text\n[^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "paragraph and first definition both indented 1",
      " text\n [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      " text\n [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "paragraph and first definition both indented 2",
      "  text\n  [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "  text\n  [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "paragraph and first definition both indented 3",
      "   text\n   [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "   text\n   [^1]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
    [
      "later joined definition dedents before tab",
      "  text\n  [^1]: first\n[^2]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
      "  text\n  [^1]: first\n[^2]: note\n\t\n    <div> words\n| __h__ |\n| - |\n| v |\n",
    ],
  ])("retains the paragraph boundary with %s (#549)", (_name, source, expected) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + expected.replaceAll("\n", newline),
        );
  });
  it("retains both delimiter directions across an ordered continuation (#543)", () => {
    const source = ">1. first\n2) second\n";
    expect(
      checked(source, {
        ...config,
        rules: { ...config.rules, "style/ordered-list": ["warn", { delimiter: ")" }] },
      }),
    ).toBe(source);
  });
  it("continues safe inline formatting in the earlier structural list unit (#543)", () => {
    const source = ">1) *first*\n>2) *second*\n3) *third*\n\n*outside*\n";
    expect(checked(source)).toBe(">1) _first_\n>2) _second_\n3) *third*\n\n_outside_\n");
  });
  it.each([".", ")"])(
    "retains either list's ordered delimiter around a lazy heading paragraph with %s (#513)",
    (delimiter) => {
      const source = "1) # heading\nlazy *words*\n1. next\n";
      expect(
        checked(source, {
          ...config,
          rules: { ...config.rules, "style/ordered-list": ["warn", { delimiter }] },
        }),
      ).toBe(source);
    },
  );
  it("formats inline text in both retained list units around a lazy heading paragraph (#513)", () => {
    const source = "- # *heading*\nlazy *words*\n+ next *safe*\n";
    expect(checked(source)).toBe("- # _heading_\nlazy *words*\n+ next _safe_\n");
  });
  it("keeps a blank-separated following list formattable (#513)", () => {
    const source = "- # heading\nlazy *words*\n\n- next *safe*\n";
    expect(checked(source)).toBe("- # heading\nlazy *words*\n\n- next _safe_\n");
  });
  it.each([
    [
      "following heading",
      "- # heading\nlazy *words*\n# next\n",
      "- # heading\nlazy *words*\n# next\n",
    ],
    [
      "blank-separated paragraph",
      "- # heading\n\nlazy *words*\n- next\n",
      "- # heading\n\nlazy _words_\n- next\n",
    ],
    [
      "indented paragraph",
      "- # heading\n  lazy *words*\n- next\n",
      "- # heading\n  lazy _words_\n- next\n",
    ],
  ])("keeps the %s control formattable (#513)", (_name, source, expected) => {
    expect(checked(source)).toBe(expected);
  });
  it.each([
    [
      "physical blank after a root",
      "<div>\nx\n</div>\n\n> first\n>\n> *second*\n\n_____\n",
      "<div>\nx\n</div>\n\n> first\n>\n> _second_\n\n---\n",
    ],
    [
      "empty quote line after contained HTML",
      "> <div>\n> x\n> </div>\n>\n> *second*\n\nAfter *third*.\n",
      "> <div>\n> x\n> </div>\n>\n> _second_\n\nAfter _third_.\n",
    ],
    [
      "independent prose after a root",
      "<div></div>\n \n> a\n>\n> *b*\n\nAfter *c*.\n",
      "<div></div>\n \n> a\n>\n> *b*\n\nAfter _c_.\n",
    ],
    [
      "physical blank after literal empty quotes",
      "<div></div>\n \n>\n>\n\nAfter *c*.\n",
      "<div></div>\n \n>\n>\n\nAfter _c_.\n",
    ],
    [
      "physical blank before genuine empty quotes",
      "<div></div>\n\n>\n>\n>\n\nAfter *c*.\n",
      "<div></div>\n\n>\n\nAfter _c_.\n",
    ],
    [
      "closed fence holding a bare quote marker",
      "<div>\ntext\n</div>\n\t\n```js\nx\n>\n```\n\n*outside*\n",
      "<div>\ntext\n</div>\n\t\n```js\nx\n>\n```\n\n_outside_\n",
    ],
    [
      "closed fence holding nested quote markers",
      "<div>\ntext\n</div>\n\t\n```js\nx\n>>\n```\n\n*outside*\n",
      "<div>\ntext\n</div>\n\t\n```js\nx\n>>\n```\n\n_outside_\n",
    ],
  ])("resumes formatting after a %s (#546)", (_name, source, expected) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + expected.replaceAll("\n", newline),
        );
  });
  it.each([
    ["physical empty line before a fence", "<div>\n   \n-\n\n~~~\na\n\n~~~\ntext *x* and __y__\n"],
    ["physical empty line before a list marker", "<div>\n\n-\n~~~\na\n\n~~~\ntext *x* and __y__\n"],
    ["fence body without an empty line", "<div>\n   \n-\n~~~\na\n~~~\n\ntext *x* and __y__\n"],
    ["fence body with a space-only line", "<div>\n   \n-\n~~~\na\n  \n~~~\n\ntext *x* and __y__\n"],
  ])("keeps unclosed HTML literal across a %s (#548, #556)", (_name, source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + source.replaceAll("\n", newline),
        );
  });
  it("ignores a plugin paragraph without source positions", () => {
    const document = parse("words\n", "obsidian");
    delete document.tree.children[0]!.position;
    expect(() => misreadLists(document)).not.toThrow();
  });
  it("retains prior protection for a quote-opening ordered item (#524)", () => {
    const source = "> text ```\n\n> 1) *first*\n>    - *second*\n";
    expect(checked(source)).toContain("> 1) *first*\n");
  });
  it.each(boundaries)("preserves the source for #%i", (_issue, source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", String.fromCharCode(0xfeff)]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(input);
      }
  });

  it("keeps nested footnote blocks at their original indentation (#496)", () => {
    const source = "[^1]: *note*\n    * anchor *basket ember* with enough words to wrap\n";
    expect(checked(source)).toBe(source.replace("*note*", "_note_"));
  });

  it("keeps a quoted continuation block in a footnote (#496)", () => {
    const source = boundaryFixtures.find(
      ({ name }) => name === "quoted continuation block in a footnote",
    )!.source;
    expect(checked(source)).toBe(source);
  });

  it.each(["*", "_"])("honors escaped and intraword %s opener controls (#506)", (marker) => {
    const source = `text a${marker}b\\\n> + one *two*\n`;
    if (marker === "*") expect(checked(source)).toBe(source);
    else expect(checked(source)).toContain("_two_");
    expect(checked(`text \\${marker}b\\\n> + one *two*\n`)).toContain("_two_");
    expect(checked(`text \\\\${marker}b\\\n> + one *two*\n`)).not.toContain("> -");
  });

  it.each(boundaryFixtures.filter(({ preserve }) => preserve === false))(
    "formats or visibly holds the host-verified control $name",
    ({ source }) => control(source),
  );

  it("keeps callout lists starting after their title together (#499)", () => {
    const source = "> [!note] title\n> 9) first\n>\n> 10) second *word*\n";
    expect(checked(source)).toBe(source.replace("*word*", "_word_"));
  });

  it.each(["*", "_", "**", "__"])(
    "preserves unmatched %s across a quoted boundary (#506)",
    (marker) => {
      const source = `text ${marker}\\\n> + one *two* **three**\n`;
      expect(checked(source)).toBe(source);
    },
  );

  it.each(["#", "## x", "> x", "- x", "2) x"])(
    "retains the table row beginning %j (#505)",
    (start) => {
      const source = `a | b | c\n-- | -- | --\n${start} | *word* | c\n`;
      expect(checked(source)).toContain(`\n${start} | *word* | c\n`);
      expect(checked(source)).not.toContain(`\n\n${start}`);
    },
  );

  it("retains later source when task-fence pairings disagree (#488)", () => {
    const source = "- [x] ``` x\n- *inside*\n\nStill *inside*.\n```\n\nLater *outside*.\n";
    expect(checked(source)).toBe(source);
  });

  it.each([
    "text *\\\n\n> + *words*\n",
    "text \\*\\\n> + *words*\n",
    "text `*\\`\n> + *words*\n",
    "text *closed*\n> + *words*\n",
  ])("still formats quoted text without carried emphasis: %j", (source) => {
    expect(checked(source)).toContain("_words_");
  });

  it("keeps ordinary footnote and table boundaries formattable", () => {
    expect(checked("[^1]: note\n\n2) *words*\n")).toContain("2. _words_");
    expect(checked("[^1]: note\n1) *words*\n")).toContain("1. _words_");
    control("a\n===\n| b | c |\n| - | - |\n");
  });

  it("formats an independent paragraph after each protected region", () => {
    for (const [, source] of boundaries.filter(
      // Open HTML and code regions keep later blocks literal through EOF.
      ([issue, , name]) =>
        ![488, 494, 519, 524, 529, 548, 556, 567, 584].includes(issue) &&
        !name.startsWith("HTML item coherence:") &&
        ![
          "short reset exposes an unclosed long run in an inline comment",
          "joined footnote ending in span paragraph",
          "ordinary paragraph with indented HTML",
          "unindented HTML interrupts joined paragraph",
        ].includes(name),
    ))
      expect(checked(`${source}\nLater *outside*.\n`)).toContain("Later _outside_.");
  });

  it("does not apply Obsidian protections to GitHub", () => {
    expect(
      format("text *\\\n> + *words*\n", { config: { extends: ["recommended", "github"] } }).output,
    ).toContain("> - _words_");
  });
});

describe("escaping HTML keeps its originating list markers coherent (#399, #428)", () => {
  it("keeps an unclosed HTML tail literal and resumes after a real closer", () => {
    expect(checked("+ <div> a\nlazy\n\n+ b\n\nLater *outside*.\n")).toContain("Later *outside*.");
    expect(checked("+ <div> a\nlazy\n</div>\n\n+ b\n\nLater *outside*.\n")).toContain(
      "Later _outside_.",
    );
    expect(checked("> + <div> a\n> lazy\n> </div>\n>\n> + b\n\nLater *outside*.\n")).toContain(
      "Later _outside_.",
    );
  });
  it.each([
    ["- parent\n  + <div> a\n  lazy\n\n- b\n", "- parent\n  - <div> a\n  lazy\n\n- b\n"],
    ["1. parent\n   1) <div> a\n   lazy\n\n2. b\n", "1. parent\n   1. <div> a\n   lazy\n\n2. b\n"],
    [
      "> - parent\n>   + <div> a\n>   lazy\n>\n> - b\n",
      "> - parent\n>   - <div> a\n>   lazy\n>\n> - b\n",
    ],
  ])("permits the native-safe nested marker edit in %j (#399)", (source, expected) => {
    expect(checked(source)).toBe(expected);
  });
  it.each([
    "+ <div> a\nlazy\n\n+ b\n",
    "+ <div> a\nlazy\n\n- b\n",
    // Retaining the first marker is conservative when both bullets already differ.
    "+ <div> a\nlazy\n\n* b\n",
    "+ before\n+ <div> a\nlazy\n\n+ b\n",
    "2) <div> a\nlazy\n\n3) b\n",
    "2) <div> a\nlazy\n\n3. b\n",
    "> + <div> a\n> lazy\n>\n> + b\n",
    "- parent\n  + <div> a\n  lazy\n\n  + b\n",
  ])("keeps %j coherent across newline and prefix offsets", (source) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"]) {
        const input = bom + source.replaceAll("\n", newline);
        expect(checked(input)).toBe(input);
      }
  });

  it.each([
    ["+ <div> a\nlazy\n</div>\n\n+ b\n", "+ <div> a\nlazy\n</div>\n\n- b\n"],
    ["> + <div> a\n> lazy\n> </div>\n>\n> + b\n", "> + <div> a\n> lazy\n> </div>\n>\n> - b\n"],
    ["+ *a*\nlazy\n\n+ b\n", "+ _a_\nlazy\n\n+ b\n"],
    ["+ *prefix* <div> a\nlazy\n\n+ b\n", "+ _prefix_ <div> a\nlazy\n\n+ b\n"],
  ])("still permits safe edits to %j", (source, output) => {
    for (const newline of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\uFEFF"])
        expect(checked(bom + source.replaceAll("\n", newline))).toBe(
          bom + output.replaceAll("\n", newline),
        );
  });

  it("leaves the existing other-dialect marker policy available", () => {
    const source = "+ <div> a\nlazy\n\n+ b\n";
    const output = format(source, {
      config: { extends: [], dialect: "github", rules: { "style/list-marker": "warn" } },
    }).output;
    expect(output).toBe("- <div> a\nlazy\n\n- b\n");
  });
});
