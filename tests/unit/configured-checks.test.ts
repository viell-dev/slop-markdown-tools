import { expect, it } from "vitest";
import { builtInRules, format, lint, parse, presets } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

function check(
  source: string,
  rule: string,
  options: Record<string, unknown> = {},
  dialect: Dialect = "github",
) {
  const config: Config = { extends: [], dialect, rules: { [rule]: ["error", options] } };
  const diagnostics = lint(source, { config });
  const result = format(source, { config });
  expect(result.output).toBe(source);
  expect(result.changed).toBe(false);
  expect(result.diagnostics).toEqual(diagnostics);
  expect(format(result.output, { config }).output).toBe(source);
  expect(diagnostics.every((item) => item.rule === rule && item.edit === undefined)).toBe(true);
  return diagnostics;
}
const heading = "structure/heading-template";
const names = "content/proper-names";
it("does nothing without consumer configuration and belongs to no preset", () => {
  expect(check("# Anything\n", heading)).toEqual([]);
  expect(check("javascript\n", names)).toEqual([]);
  for (const preset of Object.values(presets)) {
    expect(preset.rules?.[heading]).toBeUndefined();
    expect(preset.rules?.[names]).toBeUndefined();
  }
});
it.each(["\n", "\r\n"])("reports the first mismatch and EOF (%j)", (eol) => {
  expect(
    check(["# Title", "", "## Wrong", ""].join(eol), heading, {
      headings: ["# Title", "## Notes"],
    })[0],
  ).toMatchObject({
    line: 3,
    column: 1,
    message: 'Heading template mismatch; expected "## Notes".',
  });
  expect(check("# Title" + eol, heading, { headings: ["# Title", "## Notes"] })[0]).toMatchObject({
    line: 2,
    message: 'Heading template mismatch; expected "## Notes".',
  });
  expect(check("# Title\n", heading, { headings: [] })).toHaveLength(1);
  expect(check("", heading, { headings: [] })).toEqual([]);
});
it.each([
  [["# Title", "*", "## Notes"], "# Title\n\n## Notes\n", 0],
  [["# Title", "+", "## Notes"], "# Title\n\n## Notes\n", 1],
  [["# Title", "+", "## Notes"], "# Title\n\n### Extra\n\n## Notes\n", 0],
  [["?"], "# Anything\n", 0],
  [["?"], "", 1],
  [["?"], "# A\n\n# B\n", 1],
  [["*", "# A", "# B"], "# A\n\n# A\n\n# B\n", 0],
  [["*", "+", "?", "*"], "# A\n\n# B\n", 0],
] as const)("matches wildcard template %j", (headings, source, count) => {
  expect(check(source, heading, { headings })).toHaveLength(count);
});
it.each(["commonmark", "github", "forgejo", "gitea", "obsidian", "vitepress"] as const)(
  "compares rendered headings in %s",
  (dialect) => {
    const suffix = ["forgejo", "gitea", "vitepress"].includes(dialect) ? " {#title}" : "";
    expect(
      check(
        `# **TITLE**${suffix}\n\n> # Quoted\n\n## [Notes](target)\n`,
        heading,
        { headings: ["# Title", "## Notes"] },
        dialect,
      ),
    ).toEqual([]);
    expect(check("# Title ###\n", heading, { headings: ["# Title"] }, dialect)).toEqual([]);
    expect(check("Title\n=====\n", heading, { headings: ["# Title"] }, dialect)).toEqual([]);
    expect(
      check("# title\n", heading, { headings: ["# Title"], matchCase: true }, dialect),
    ).toHaveLength(1);
  },
);
it("ignores independent footnote outlines and includes list headings", () => {
  expect(
    check("# Title\n\n[^a]: # Footnote\n\n- ## Notes\n", heading, {
      headings: ["# Title", "## Notes"],
    }),
  ).toEqual([]);
});
it("keeps ambiguous wildcard matching polynomial for long templates and documents", () => {
  const source = "# A\n\n".repeat(600) + "# End\n";
  expect(
    check(source, heading, {
      headings: [
        ...Array<string>(150)
          .fill("*")
          .flatMap((x) => [x, "# A"]),
        "*",
        "# End",
      ],
    }),
  ).toEqual([]);
});
it.each(["commonmark", "github", "forgejo", "gitea", "obsidian", "vitepress"] as const)(
  "checks prose, labels and alt text in %s",
  (dialect) => {
    expect(
      check(
        "javascript [javascript](javascript) ![javascript](javascript.png)\n",
        names,
        { names: ["JavaScript"] },
        dialect,
      ),
    ).toHaveLength(3);
    expect(
      check(
        "JavaScript `javascript`\n\n```javascript\njavascript\n```\n",
        names,
        { names: ["JavaScript"] },
        dialect,
      ),
    ).toEqual([]);
    expect(
      check(
        "```text\njavascript\n```\n",
        names,
        { names: ["JavaScript"], codeBlocks: true },
        dialect,
      ),
    ).toHaveLength(1);
  },
);
it("skips addresses, destinations, front matter and wiki targets", () => {
  expect(
    check("urn:javascript //example.com/javascript mailto:javascript@example.com\n", names, {
      names: ["JavaScript"],
    }),
  ).toEqual([]);
  for (const dialect of ["commonmark", "github", "obsidian"] as const) {
    expect(
      check(
        "---\njavascript: javascript\n---\n\nhttps://example.com/javascript www.javascript.com <https://javascript.com>\n\n[OK](javascript) ![OK](javascript)\n\n[ref]: javascript\n",
        names,
        { names: ["JavaScript"] },
        dialect,
      ),
    ).toEqual([]);
  }
  expect(
    check(
      "[[javascript]] ![[javascript.png]] [[javascript|javascript]]\n",
      names,
      { names: ["JavaScript"] },
      "obsidian",
    ),
  ).toHaveLength(1);
});
it("handles overlapping names, Unicode word boundaries and literal punctuation", () => {
  expect(
    check(
      "javascript java JavaScript Java javascripts myjavascript javascript_ тестJava javaтест\n",
      names,
      { names: ["Java", "JavaScript"] },
    ),
  ).toHaveLength(2);
  expect(
    check("node.js github actions c++ Node.js GitHub Actions C++\n", names, {
      names: ["Node.js", "GitHub Actions", "C++"],
    }),
  ).toHaveLength(3);
  expect(check("МОСКВА Москва подМосква Москва2\n", names, { names: ["Москва"] })).toHaveLength(1);
  expect(check("github **actions**\n", names, { names: ["GitHub Actions"] })).toHaveLength(1);
  expect(
    check("Javascript javascript\n", names, { names: ["JavaScript", "Javascript"] }),
  ).toHaveLength(1);
});
it("checks visible HTML text but never attributes or comments", () => {
  const source =
    '<div title="javascript">javascript</div>\n\n<!-- javascript -->\n\n<span title="javascript">javascript</span>\n';
  expect(check(source, names, { names: ["JavaScript"] })).toHaveLength(2);
  expect(check(source, names, { names: ["JavaScript"], htmlElements: false })).toEqual([]);
  expect(check('<div title=">javascript">OK</div>\n', names, { names: ["JavaScript"] })).toEqual(
    [],
  );
  expect(
    check("<code>javascript</code> <pre>javascript</pre>\n\njavascript\n", names, {
      names: ["JavaScript"],
    }),
  ).toHaveLength(1);
  expect(
    check("<div>javascript</div>\n\njavascript\n", names, {
      names: ["JavaScript"],
      htmlElements: false,
    }),
  ).toHaveLength(1);
});
it("recognizes supplementary Unicode letters as word boundaries", () => {
  expect(
    check("𐐀javascript javascript𐐀 javascript\u0301\n", names, { names: ["JavaScript"] }),
  ).toEqual([]);
});
it("keeps script strings opaque and resumes checking prose below them", () => {
  expect(
    check('<script>const text = "<pre>javascript";</script>\n\njavascript\n', names, {
      names: ["JavaScript"],
    }),
  ).toHaveLength(1);
});
it("does not rescan every suffix of a long word while excluding URLs", () => {
  const document = parse("a".repeat(30000) + " javascript\n", "github");
  const started = performance.now();
  const findings = builtInRules[names]!.check({ document, options: { names: ["JavaScript"] } });
  expect(findings).toHaveLength(1);
  // The reproduced suffix-rescan regression took about five seconds for 30 kB.
  // Isolate the rule, excluding parser and engine setup, with ample headroom.
  expect(performance.now() - started).toBeLessThan(2000);
});
it("keeps literal braces and attribute-like text when the dialect shows them", () => {
  expect(
    check("# Title {literal}\n", heading, { headings: ["# Title {literal}"] }, "vitepress"),
  ).toEqual([]);
  expect(check("# Title {#id}\n", heading, { headings: ["# Title"] }, "github")).toHaveLength(1);
  expect(check("# Title ^id\n", heading, { headings: ["# Title"] }, "obsidian")).toEqual([]);
});
it("reports positions under CRLF and escaped or encoded text without edits", () => {
  expect(check("Hello\r\n\r\njavascript\r\n", names, { names: ["JavaScript"] })[0]).toMatchObject({
    line: 3,
    column: 1,
  });
  expect(check("java&#115;cript\n", names, { names: ["JavaScript"] })).toHaveLength(1);
  // Decoded text maps to its whole node, not to the node's first character.
  const decoded = "Tom &amp; javascript\n";
  const [finding] = check(decoded, names, { names: ["JavaScript"] });
  expect(decoded.slice(finding!.start, finding!.end)).toContain("javascript");
});
it("does not match a name across a skipped HTML element's body", () => {
  expect(check("Java<code>x</code>script\n", names, { names: ["JavaScript"] })).toEqual([]);
  expect(check("javascript<code>x</code>\n", names, { names: ["JavaScript"] })).toHaveLength(1);
});
it("skips prose blocks with nested inline HTML when HTML is not checked", () => {
  const source = "*<b>x</b>* javascript\n";
  expect(check(source, names, { names: ["JavaScript"], htmlElements: false })).toEqual([]);
  expect(check(source, names, { names: ["JavaScript"] })).toHaveLength(1);
});
it("finds a code block's body after a lone CR line ending", () => {
  // The info string holds the same text, which a search from the start finds first.
  const source = "```javascript\rjavascript\r```\r";
  expect(
    check(source, names, { names: ["JavaScript"], codeBlocks: true }).map((item) => item.line),
  ).toEqual([2]);
});
it("validates all new option types", () => {
  for (const [rule, options] of [
    [heading, { headings: ["invalid"] }],
    [heading, { matchCase: 1 }],
    [names, { names: [""] }],
    [names, { codeBlocks: "yes" }],
    [names, { htmlElements: 1 }],
  ] as const) {
    expect(() => lint("", { config: { rules: { [rule]: ["warn", options] } } })).toThrow();
  }
  expect(builtInRules[heading]?.kind).toBe("problem");
  expect(builtInRules[names]?.kind).toBe("problem");
});
