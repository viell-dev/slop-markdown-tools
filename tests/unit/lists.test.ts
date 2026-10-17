import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dialects, format, lint, parse, presets, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect, RuleSetting } from "../../src/index.js";

const rules = {
  "style/list-marker": "warn",
  "style/ordered-list": "warn",
  "style/list-indent": "warn",
} as const;
function only(settings: Record<string, RuleSetting>, dialect: Dialect = "github"): Config {
  return { extends: [], dialect, rules: settings };
}
/**
 * Format, and require what every list edit must keep: no engine findings,
 * the parsed meaning, and nothing left to change on a second run.
 */
function formatted(source: string, config: Config = only(rules)) {
  const dialect = config.dialect as Dialect;
  const result = format(source, { config });
  expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
  expect(semanticFingerprint(parse(result.output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  expect(format(result.output, { config }).output).toBe(result.output);
  return result.output;
}

describe("style/list-marker", () => {
  const config = only({ "style/list-marker": "warn" });
  it.each([
    ["* Milk\n* Bread\n", "- Milk\n- Bread\n"],
    ["+ Milk\n", "- Milk\n"],
    ["- Milk\n", "- Milk\n"],
    // Nested lists, task items, and lists in quotes, callouts, and footnotes.
    ["* a\n  + b\n    * c\n", "- a\n  - b\n    - c\n"],
    ["* [ ] open\n* [x] done\n", "- [ ] open\n- [x] done\n"],
    ["> * a\n> * b\n", "> - a\n> - b\n"],
    ["> [!NOTE]\n> * a\n", "> [!NOTE]\n> - a\n"],
    ["[^1]: * a\n\n    * b\n\nText.[^1]\n", "[^1]: - a\n\n    - b\n\nText.[^1]\n"],
    ["1. a\n   * b\n", "1. a\n   - b\n"],
    // Loose lists, code, and lazy lines keep their content.
    ["* a\n\n  ```\n  * code\n  ```\n\n* b\n", "- a\n\n  ```\n  * code\n  ```\n\n- b\n"],
    ["* a\nlazy\n* b\n", "- a\nlazy\n- b\n"],
    ["* a\r\n* b\r\n", "- a\r\n- b\r\n"],
  ])("writes %j as %j", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
  it.each([
    ["*", "- a\n", "* a\n"],
    ["+", "* a\n", "+ a\n"],
  ])("uses the marker %j", (marker, source, output) => {
    expect(formatted(source, only({ "style/list-marker": ["warn", { marker }] }))).toBe(output);
  });
  it("gives a list that directly follows another the next marker", () => {
    // Different markers are all that separate these lists.
    expect(formatted("* a\n* b\n+ c\n- d\n", config)).toBe("- a\n- b\n* c\n- d\n");
    expect(formatted("- a\n\n* b\n", config)).toBe("- a\n\n* b\n");
    expect(formatted("+ a\n\n- b\n", config)).toBe("- a\n\n* b\n");
    expect(
      formatted("- a\n\n+ b\n", only({ "style/list-marker": ["warn", { marker: "+" }] })),
    ).toBe("+ a\n\n- b\n");
    // A list between them, or a paragraph, separates them anyway.
    expect(formatted("* a\n\n1. b\n\n* c\n", config)).toBe("- a\n\n1. b\n\n- c\n");
    expect(formatted("* a\n\nText\n\n+ c\n", config)).toBe("- a\n\nText\n\n- c\n");
  });
  it.each([
    // The new marker would make the line a thematic break.
    ["+ - -\n"],
    ["+ * *\n"],
    ["* - - -\n"],
    // Together with the marker of a list nested on the same line.
    ["- + +\n"],
    ["- * + +\n"],
  ])("keeps the markers of %j", (source) => {
    expect(formatted(source, config)).toBe(source);
    expect(lint(source, { config })).toEqual([]);
  });
  it("keeps the markers of the lists that follow a list it keeps", () => {
    // Changing only the second list would join it to the first.
    expect(formatted("+ - -\n- b\n", config)).toBe("+ - -\n- b\n");
    expect(formatted("+ - -\n+ a\n", config)).toBe("+ - -\n+ a\n");
  });
  it("keeps the document's first marker with consistent, and one per level with sublist", () => {
    const consistent = only({ "style/list-marker": ["warn", { marker: "consistent" }] });
    expect(formatted("* a\n\n- b\n\n+ c\n  - d\n", consistent)).toBe("* a\n\n+ b\n\n* c\n  * d\n");
    expect(formatted("+ a\n  - b\n", consistent)).toBe("+ a\n  + b\n");
    const sublist = only({ "style/list-marker": ["warn", { marker: "sublist" }] });
    // Each level keeps its first list's marker, unless the level above has it.
    expect(formatted("* a\n  * b\n    * c\n  * e\n", sublist)).toBe("* a\n  + b\n    * c\n  + e\n");
    expect(formatted("- a\n  * b\n- c\n  - d\n", sublist)).toBe("- a\n  * b\n- c\n  * d\n");
    // Lists inside numbered items count from their own level.
    expect(formatted("- a\n\n1. b\n   * c\n", sublist)).toBe("- a\n\n1. b\n   - c\n");
    expect(() =>
      format("- a\n", { config: only({ "style/list-marker": ["warn", { marker: "x" }] }) }),
    ).toThrow("Invalid options for style/list-marker");
  });
  it("reports one finding for a group of lists, at the first marker it changes", () => {
    expect(lint("* a\n- b\n- c\n", { config })).toEqual([
      {
        rule: "style/list-marker",
        severity: "warn",
        line: 1,
        column: 1,
        start: 0,
        end: 9,
        message: 'Use "-" as the bullet list marker.',
        edit: { start: 0, end: 9, text: "- a\n* b\n*" },
      },
    ]);
  });
});

describe("style/ordered-list", () => {
  const config = only({ "style/ordered-list": "warn" });
  it.each([
    ["1) a\n2) b\n", "1. a\n2. b\n"],
    ["1. a\n2. b\n5. c\n", "1. a\n2. b\n3. c\n"],
    ["1. a\n1. b\n2. c\n", "1. a\n1. b\n1. c\n"],
    ["3. a\n3. b\n7. c\n", "3. a\n3. b\n3. c\n"],
    ["0. a\n5. b\n", "0. a\n1. b\n"],
    // The first number stays: it is where the rendered list starts.
    ["7. a\n1. b\n", "7. a\n8. b\n"],
    ["1. a\n", "1. a\n"],
    // Nested lists are numbered on their own.
    ["1. a\n   1. b\n   3. c\n2. d\n", "1. a\n   1. b\n   2. c\n2. d\n"],
    ["> 1) a\n> 2) b\n", "> 1. a\n> 2. b\n"],
    ["- 2) a\n  3) b\n", "- 2. a\n  3. b\n"],
    ["1) a\r\n3) b\r\n", "1. a\r\n2. b\r\n"],
  ])("writes %j as %j", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
  it.each([
    ["ordered", "1. a\n1. b\n1. c\n", "1. a\n2. b\n3. c\n"],
    ["same", "1. a\n2. b\n3. c\n", "1. a\n1. b\n1. c\n"],
    ["auto", "2. a\n4. b\n", "2. a\n3. b\n"],
  ])("numbers with %j", (numbering, source, output) => {
    expect(formatted(source, only({ "style/ordered-list": ["warn", { numbering }] }))).toBe(output);
  });
  it("keeps the document's first delimiter with consistent", () => {
    const consistent = only({ "style/ordered-list": ["warn", { delimiter: "consistent" }] });
    expect(formatted("1) a\n\n- x\n\n1. b\n", consistent)).toBe("1) a\n\n- x\n\n1) b\n");
    expect(formatted("1. a\n\n- x\n\n1) b\n", consistent)).toBe("1. a\n\n- x\n\n1. b\n");
  });
  it("uses the delimiter `)`, and alternates between lists that follow each other", () => {
    const parenthesis = only({ "style/ordered-list": ["warn", { delimiter: ")" }] });
    expect(formatted("1. a\n2. b\n", parenthesis)).toBe("1) a\n2) b\n");
    // Different delimiters are all that separate these lists.
    expect(formatted("1) a\n1. b\n", config)).toBe("1. a\n1) b\n");
    expect(formatted("1) a\n\n3) b\n1. c\n", config)).toBe("1. a\n\n2. b\n1) c\n");
    expect(formatted("1. a\n1) b\n", parenthesis)).toBe("1) a\n1. b\n");
  });
  it("moves an item's other lines with a number that gets wider or narrower", () => {
    const ten = Array.from({ length: 9 }, (_, index) => `${index + 1}. step\n`).join("");
    expect(
      formatted(`${ten}9. last\n   more\n\n   - nested\n\n   \`\`\`\n   code\n   \`\`\`\n`, config),
    ).toBe(`${ten}10. last\n    more\n\n    - nested\n\n    \`\`\`\n    code\n    \`\`\`\n`);
    expect(formatted("1. a\n10. b\n    more\n\n        code\n", config)).toBe(
      "1. a\n2. b\n   more\n\n       code\n",
    );
    // A blank line in code keeps the spaces that are part of the code.
    expect(formatted("1. a\n10. b\n\n    ```\n    x\n       \n    ```\n", config)).toBe(
      "1. a\n2. b\n\n   ```\n   x\n      \n   ```\n",
    );
    expect(formatted("> 1. a\n> 10. b\n>     more\n", config)).toBe("> 1. a\n> 2. b\n>    more\n");
  });
  it.each([
    // Numbers with leading zeros, and numbers that would exceed nine digits.
    ["01. a\n03. b\n"],
    ["999999998. a\n5. b\n5. c\n"],
    // A narrower number would pull the next item, or the line after the
    // list, into the item.
    ["1. a\n100. b\n   200. c\n"],
    ["1. a\n100. b\n\n   text\n"],
    // A lazy line that would start a block inside the item.
    ["1. a\n100.  b\n    - c\n"],
    // A tab in the item's lines.
    ["1. a\n10. b\n\tmore\n"],
    ["1. a\n10.\tb\n"],
  ])("keeps the numbers of %j", (source) => {
    expect(formatted(source, config)).toBe(source);
  });
});

describe("style/list-indent", () => {
  const config = only({ "style/list-indent": "warn" });
  it.each([
    ["-   a\n-   b\n", "- a\n- b\n"],
    ["1.  a\n2.  b\n", "1. a\n2. b\n"],
    // The item's other lines and nested blocks move with its text.
    ["-   a\n\n    b\n", "- a\n\n  b\n"],
    ["-   a\n    b\n", "- a\n  b\n"],
    ["-   a\n\n        code\n", "- a\n\n      code\n"],
    ["-   a\n\n    ```\n    x\n      \n    y\n    ```\n", "- a\n\n  ```\n  x\n    \n  y\n  ```\n"],
    ["-   a\n    -   b\n        c\n", "- a\n  - b\n    c\n"],
    ["-   > a\n    > b\n", "- > a\n  > b\n"],
    ["-   | a |\n    | - |\n", "- | a |\n  | - |\n"],
    ["-   <div>\n      x\n    </div>\n", "- <div>\n    x\n  </div>\n"],
    ["-   $$\n    x\n    $$\n", "- $$\n  x\n  $$\n"],
    // Indentation before the marker, also of nested lists and of items in quotes.
    [" - a\n - b\n", "- a\n- b\n"],
    ["- a\n    - b\n    - c\n", "- a\n  - b\n  - c\n"],
    ["1. a\n    - b\n", "1. a\n   - b\n"],
    [">  - a\n>    b\n", "> - a\n>   b\n"],
    ["> *   a\n>     b\n> * c\n", "> * a\n>   b\n> * c\n"],
    ["> [!NOTE]\n> -   a\n", "> [!NOTE]\n> - a\n"],
    ["[^1]: -   a\n          b\n\nText.[^1]\n", "[^1]: - a\n        b\n\nText.[^1]\n"],
    // Task items, and a lazy line that continues a paragraph.
    ["-   [ ] a\n-   [x] b\n", "- [ ] a\n- [x] b\n"],
    ["-   a long item\n  continued\n", "- a long item\n  continued\n"],
    ["-   a\nlazy\n", "- a\nlazy\n"],
    ["-   a\r\n    b\r\n", "- a\r\n  b\r\n"],
  ])("writes %j as %j", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
  it.each([
    // Indented code that starts the item depends on the spacing.
    ["-     code\n"],
    ["-\n  text\n"],
    // The paragraph after the list would join the item.
    ["-   a\n\n  b\n"],
    ["1.   a\n\n   b\n"],
    // A lazy line that would start a block, or keep its spaces in a code span.
    ["-    a\n    - b\n"],
    ["-    a `code\n    span`\n"],
    // Tabs, such as in the nested lists that Obsidian indents with tabs.
    ["- a\n\t- b\n\t\t- c\n"],
    ["-\ta\n"],
    ["-   a\n\tb\n"],
    ["-   a\n\n    ```\n    \tx\n    ```\n"],
  ])("keeps %j", (source) => {
    expect(formatted(source, config)).toBe(source);
  });
  it.each([
    [
      { bulletSpaces: 3, orderedSpaces: 2 },
      "- a\n- b\n\n1. c\n   more\n\n   - d\n",
      "-   a\n-   b\n\n1.  c\n    more\n\n    -   d\n",
    ],
    // Like markdownlint, multiline spacing applies to a list with an item of
    // more than one line or with blank lines between its items.
    [
      { bulletSpacesMultiline: 3, orderedSpacesMultiline: 2 },
      "- a\n- b\n\n* c\n\n  more\n\n1. x\n2. y\n\n3. z\n",
      "- a\n- b\n\n*   c\n\n    more\n\n1.  x\n2.  y\n\n3.  z\n",
    ],
    [
      { nestedIndent: 4 },
      "- a\n  - b\n    - c\n1. x\n   - y\n10. z\n    - w\n",
      "- a\n    - b\n        - c\n1. x\n    - y\n10. z\n    - w\n",
    ],
    [{ nestedIndent: 4, bulletSpaces: 3 }, "- a\n  - b\n", "-   a\n    -   b\n"],
    [{ nestedIndent: 8 }, "- a\n  - b\n", "- a\n     - b\n"],
    // A list on its item's marker line has no choice of indentation: columns
    // before it are the item's spacing.
    [{ nestedIndent: 4 }, "- - a\n  - b\n", "- - a\n  - b\n"],
    // A list after another one stays out of that list's last item.
    [{ nestedIndent: 4 }, "- * x\n  1. y\n", "- * x\n   1. y\n"],
    // Indented code that starts an item keeps its spacing.
    [{ bulletSpaces: 3 }, "-     code\n", "-     code\n"],
  ])("with %j writes %j as %j", (options, source, output) => {
    expect(formatted(source, only({ "style/list-indent": ["warn", options] }))).toBe(output);
  });
  it.each([
    [{ bulletSpaces: 5 }, '"bulletSpaces" must be at most 4'],
    [{ orderedSpacesMultiline: 0 }, '"orderedSpacesMultiline" must be at least 1'],
    [{ nestedIndent: 9 }, '"nestedIndent" must be at most 8'],
    [{ spaces: 2 }, 'unknown option "spaces"'],
  ])("rejects the options %j", (options, message) => {
    expect(() =>
      format("- a\n", { config: only({ "style/list-indent": ["warn", options] }) }),
    ).toThrow(message);
  });
  it("keeps Obsidian comments and wikilinks", () => {
    const obsidian = only({ "style/list-indent": "warn" }, "obsidian");
    expect(
      formatted("-   a %%note\n    more%% [[Page]]\n\n    %%\n    block\n    %%\n", obsidian),
    ).toBe("- a %%note\n  more%% [[Page]]\n\n  %%\n  block\n  %%\n");
  });
  it("leaves a list that a suppression comment reaches as written", () => {
    const region = "<!-- mdtools-disable style/list-indent -->\n\n-   a\n-   b\n";
    expect(formatted(region, config)).toBe(region);
    const inside = "-   a\n\n    <!-- mdtools-disable-next-line style/list-indent -->\n    b\n";
    expect(formatted(inside, config)).toBe(inside);
    expect(lint(inside, { config })).toEqual([]);
    // The comment ends the list above it; the list below it is another one.
    expect(
      formatted("-   a\n<!-- mdtools-disable-next-line style/list-indent -->\n-   b\n", config),
    ).toBe("- a\n<!-- mdtools-disable-next-line style/list-indent -->\n-   b\n");
  });
});

describe("the list rules together", () => {
  it("are in the recommended preset and format nothing when off", () => {
    expect(presets.recommended?.rules).toMatchObject({
      "style/list-marker": ["warn", { marker: "-" }],
      "style/ordered-list": ["warn", { delimiter: ".", numbering: "auto" }],
      "style/list-indent": "warn",
    });
    const source = "*   a\n\n1)  b\n1)  c\n";
    expect(format(source).output).toBe("- a\n\n1. b\n1. c\n");
    expect(format(source, { config: only({}) }).output).toBe(source);
  });
  it("change a list in a range only where the range holds all of its changes", () => {
    const source = "* first item\n\n*   second item\n    more\n";
    const second = source.indexOf("second");
    const result = format(source, {
      config: only(rules),
      ranges: [{ start: second, end: second }],
    });
    // The markers of both items change together, so neither changes here.
    expect(result.output).toBe("* first item\n\n* second item\n  more\n");
    expect(result.diagnostics.filter((item) => item.rule.startsWith("engine/"))).toEqual([]);
    const whole = format(source, {
      config: only(rules),
      ranges: [{ start: 0, end: source.length }],
    });
    expect(whole.output).toBe("- first item\n\n- second item\n  more\n");
  });
  it.each(dialects)("format the same lists in the %s dialect", (dialect) => {
    expect(formatted("*   a\n    1)  b\n    3)  c\n\n> + d\n", only(rules, dialect))).toBe(
      "- a\n  1. b\n  2. c\n\n> - d\n",
    );
  });
  it("format nested lists in one run, also with wrapping", () => {
    const config = only({ ...rules, "style/wrap": ["warn", { width: 30 }] });
    expect(
      formatted(
        "*   A first item whose text is long enough to wrap.\n    1)  A nested step that also wraps at the width.\n    1)  Another\n",
        config,
      ),
    ).toBe(
      "- A first item whose text is\n  long enough to wrap.\n  1. A nested step that also\n     wraps at the width.\n  1. Another\n",
    );
  });
  it("keep the meaning of random nesting of lists, quotes, and code", () => {
    const leaf = fc.constantFrom(
      ["text"],
      ["two", "lines"],
      ["a `code", "span`"],
      ["```", "code", "", "   ", "```"],
      ["    indented", "", "      code"],
      ["$$", "x", "$$"],
      ["<div>", "  html", "</div>"],
      ["- -"],
      ["***"],
      ["Title", "==="],
      ["| a |", "| - |"],
    );
    interface Tree {
      kind: "leaf" | "quote" | "list";
      lines?: readonly string[];
      lazy?: boolean;
      children?: Tree[][];
      marker?: string;
    }
    const tree: fc.Arbitrary<Tree> = fc.letrec<{ block: Tree }>((tie) => ({
      block: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        fc.record({ kind: fc.constant("leaf" as const), lines: leaf, lazy: fc.boolean() }),
        fc.record({
          kind: fc.constant("quote" as const),
          children: fc.array(fc.array(tie("block"), { minLength: 1, maxLength: 2 }), {
            minLength: 1,
            maxLength: 1,
          }),
        }),
        fc.record({
          kind: fc.constant("list" as const),
          marker: fc.constantFrom("-", "*", "+", "1.", "1)", "9.", "10."),
          children: fc.array(fc.array(tie("block"), { maxLength: 2 }), {
            minLength: 1,
            maxLength: 3,
          }),
        }),
      ),
    })).block;
    const render = (
      block: Tree,
      first: string,
      rest: string,
      lines: string[],
      spaces: number[],
    ) => {
      if (block.kind === "leaf")
        block.lines!.forEach((line, index) =>
          lines.push(
            (index === 0 ? first : block.lazy && index === block.lines!.length - 1 ? "" : rest) +
              line,
          ),
        );
      else if (block.kind === "quote")
        for (const [index, child] of block.children![0]!.entries()) {
          if (index) lines.push(`${rest}>`);
          render(child, index ? `${rest}> ` : `${first}> `, `${rest}> `, lines, spaces);
        }
      else
        block.children!.forEach((item, index) => {
          const offset = " ".repeat(spaces.shift() ?? 0);
          const space = " ".repeat(1 + (spaces.shift() ?? 0));
          const head = `${index ? rest : first}${offset}${block.marker}${space}`;
          const inner = rest + " ".repeat(offset.length + block.marker!.length + space.length);
          if (!item.length) lines.push(head.trimEnd());
          item.forEach((child, at) => {
            if (at) lines.push(inner.trimEnd());
            render(child, at ? inner : head, inner, lines, spaces);
          });
        });
    };
    const count = fc.integer({ min: 1, max: 4 });
    // The rules' options, or none for the defaults.
    const settings = fc.option(
      fc.record({
        marker: fc.constantFrom("-", "*", "+", "consistent", "sublist"),
        delimiter: fc.constantFrom(".", ")", "consistent"),
        numbering: fc.constantFrom("auto", "ordered", "same"),
        bulletSpaces: count,
        orderedSpaces: count,
        bulletSpacesMultiline: count,
        orderedSpacesMultiline: count,
        nestedIndent: fc.integer({ min: 1, max: 8 }),
      }),
      { nil: undefined },
    );
    fc.assert(
      fc.property(
        fc.array(tree, { minLength: 1, maxLength: 3 }),
        fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 40 }),
        fc.constantFrom(...dialects),
        fc.constantFrom("\n", "\r\n"),
        settings,
        (blocks, spaces, dialect, newline, options) => {
          const lines: string[] = [];
          blocks.forEach((block, index) => {
            if (index) lines.push("");
            render(block, "", "", lines, [...spaces]);
          });
          const { marker, delimiter, numbering, ...indent } = options ?? {};
          const configured = options
            ? {
                "style/list-marker": ["warn", { marker }],
                "style/ordered-list": ["warn", { delimiter, numbering }],
                "style/list-indent": ["warn", indent],
              }
            : rules;
          formatted(lines.join(newline) + newline, only(configured as typeof rules, dialect));
        },
      ),
      { numRuns: 500, seed: 20261017 },
    );
  }, 60_000);
});
