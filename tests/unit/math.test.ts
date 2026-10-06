import type { Nodes } from "mdast";
import { describe, expect, it } from "vitest";
import { format, lint, parse, range, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";
import { mathCases } from "./math-renderers.js";
import type { MathRenderer } from "./math-renderers.js";

/** The source text of every formula the tool reads in a document, in order. */
function formulas(source: string, dialect: Dialect): string[] {
  const found: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "inlineMath" || node.type === "math")
      found.push(source.slice(...range(node)));
    else if (node.type === "code" && node.lang === "math") found.push(source.slice(...range(node)));
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(parse(source, dialect).tree);
  return found;
}
const renderers: MathRenderer[] = ["github", "forgejo", "gitea"];

describe("dollar math, compared with what the renderers render", () => {
  // A formula that the tool takes for prose could be rewrapped or restyled, so
  // the tool must read as math at least what the renderer renders as math.
  const unread: Record<MathRenderer, Record<string, string>> = {
    github: {
      "escaped-open": "GitHub takes an escaped dollar for a delimiter; the tool does not",
      "escaped-currency-trailing": "the same, with both dollars escaped",
    },
    forgejo: {
      "backslash-paren": "backslash math is not dollar math; rules protect it instead",
      empty: "a formula with nothing in it has nothing to protect",
    },
    gitea: {},
  };
  it.each(renderers)("reads as math everything that %s renders as math", (renderer) => {
    const missed = mathCases
      .filter((item) => item.math.includes(renderer))
      .filter((item) => formulas(item.source, renderer).length === 0)
      .map((item) => item.name);
    expect(missed).toEqual(Object.keys(unread[renderer]));
  });
  it.each(renderers)("does not take sums of money for math, as %s does not", (renderer) => {
    for (const name of [
      "currency",
      "long-currency",
      "thousands",
      "us-dollar",
      "range",
      "slash-range",
      "trailing-sign",
      "trailing-sign-words",
      "paren-currency",
      "table-currency",
      "single-dollar",
      "multi-dollar-currency",
      "digit-after-close",
      "letter-after-close",
      "underscore-after-close",
      "letter-before-open",
      "digit-before-open",
      "fail-then-third",
      "fail-then-later",
    ]) {
      const item = mathCases.find((candidate) => candidate.name === name)!;
      // The renderer shows no formula, and neither does the tool.
      expect(item.math, name).not.toContain(renderer);
      expect(formulas(item.source, renderer), name).toEqual([]);
    }
  });
  it("counts how far the tool is more careful than each renderer", () => {
    // Text that only the tool takes for math is left alone, which is safe. The
    // counts keep a change that widens the gap from passing unnoticed.
    const extra = (renderer: MathRenderer) =>
      mathCases.filter(
        (item) => !item.math.includes(renderer) && formulas(item.source, renderer).length > 0,
      ).length;
    expect(renderers.map(extra)).toEqual([27, 28, 26]);
    // Before the conditions, with any text between two dollars read as math, the
    // same counts were 50, 46, and 45 of these 125 cases.
    expect(mathCases).toHaveLength(125);
  });
});

describe("where dollar math begins and ends", () => {
  it("finds the formula that the renderers find when an earlier dollar opens nothing", () => {
    for (const dialect of renderers) {
      expect(formulas("It costs $5 but $x$ is math and $6 is not.", dialect), dialect).toEqual([
        "$x$",
      ]);
      expect(formulas("A $5 and $x$ d.", dialect), dialect).toEqual(["$x$"]);
      expect(formulas("From $5 to 10$ d.", dialect), dialect).toEqual(["$5 to 10$"]);
      expect(formulas("A $x$ and $y$ d.", dialect), dialect).toEqual(["$x$", "$y$"]);
      expect(formulas("A ($x$), $y$; $z$.", dialect), dialect).toEqual(["$x$", "$y$", "$z$"]);
      expect(formulas("A $$x + y$$ d.", dialect), dialect).toEqual(["$$x + y$$"]);
      expect(formulas("A $\\alpha_1 + \\beta$ d.", dialect), dialect).toEqual([
        "$\\alpha_1 + \\beta$",
      ]);
    }
  });
  it("applies GitHub's conditions on the space inside a single dollar only for GitHub", () => {
    for (const source of ["A $ x$ d.", "A $x $ d.", "A $\tx$ d.", "A $x\t$ d.", "A $\nx$ d."]) {
      expect(formulas(source, "github"), source).toEqual([]);
      expect(formulas(source, "forgejo"), source).toHaveLength(1);
      expect(formulas(source, "gitea"), source).toHaveLength(1);
    }
    // A line break before the closing dollar, and space inside doubled dollars, are fine there.
    expect(formulas("A $x\n$ d.", "github")).toEqual(["$x\n$"]);
    expect(formulas("A $$ x $$ d.", "github")).toEqual(["$$ x $$"]);
    // A formula may run over a line break in a file on GitHub.
    expect(formulas("A $x +\ny$ d.", "github")).toEqual(["$x +\ny$"]);
  });
  it("ends a formula at the first dollars, counted as the renderer counts them", () => {
    // GitHub ends at an escaped dollar; Forgejo and Gitea keep it in the formula.
    expect(formulas("A $x\\$ d.", "github")).toEqual(["$x\\$"]);
    expect(formulas("A $a \\$ b$ d.", "forgejo")).toEqual(["$a \\$ b$"]);
    expect(formulas("A $a \\$ b$ d.", "gitea")).toEqual(["$a \\$ b$"]);
    expect(formulas("A $a \\\\$ b$ d.", "gitea")).toEqual(["$a \\\\$"]);
    // One dollar closes a formula that one dollar opened, also before another dollar.
    expect(formulas("A $x$$ d.", "github")).toEqual(["$x$"]);
    // Forgejo and Gitea read `$$x$` as a dollar followed by a formula.
    expect(formulas("A $$x$ d.", "forgejo")).toEqual(["$x$"]);
    expect(formulas("A $$x$ d.", "gitea")).toEqual(["$x$"]);
    expect(formulas("A $$x$ d.", "github")).toEqual([]);
    expect(formulas("A $$x$$5 d.", "gitea")).toEqual(["$x$"]);
  });
  it("leaves Obsidian's reading as it was, and CommonMark without math", () => {
    // Obsidian's own conditions are not verified, so the widest reading is kept.
    expect(formulas("Costs $5 *per* item and $6 *per* box.", "obsidian")).toEqual([
      "$5 *per* item and $",
    ]);
    expect(formulas("A $ x $ d.", "obsidian")).toEqual(["$ x $"]);
    expect(formulas("A a$x$5 d.", "obsidian")).toEqual(["$x$"]);
    expect(formulas("A $x$ d.", "commonmark")).toEqual([]);
    expect(formulas("$$\nx\n$$\n", "commonmark")).toEqual([]);
  });
  it.each(["github", "forgejo", "gitea", "obsidian"] as const)(
    "keeps display math in %s as it was",
    (dialect) => {
      expect(formulas("$$\nx = y\n$$\n", dialect)).toEqual(["$$\nx = y\n$$"]);
      expect(formulas("Text\n\n$$\n\\frac{1}{2}\n\n$5 and $6\n$$\n\nMore.\n", dialect)).toEqual([
        "$$\n\\frac{1}{2}\n\n$5 and $6\n$$",
      ]);
      expect(formulas("- item\n\n  $$\n  x\n  $$\n", dialect)).toEqual(["$$\n  x\n  $$"]);
      expect(formulas("```math\nx\n```\n", dialect)).toEqual(["```math\nx\n```"]);
      // An opening fence without a closing one runs to the end, as fenced code does.
      expect(formulas("$$\nx\n", dialect)).toEqual(["$$\nx\n"]);
    },
  );
});

describe("formatting prose with dollar signs", () => {
  const config = (dialect: Dialect): Config => ({ extends: ["recommended"], dialect });
  const tidy = (source: string, dialect: Dialect) => {
    const result = format(source, { path: "note.md", config: config(dialect) });
    expect(result.diagnostics, source).toEqual([]);
    expect(format(result.output, { path: "note.md", config: config(dialect) }).changed).toBe(false);
    expect(semanticFingerprint(parse(result.output, dialect))).toBe(
      semanticFingerprint(parse(source, dialect)),
    );
    return result.output;
  };
  it.each(renderers)("restyles and wraps text between two sums of money in %s", (dialect) => {
    // Up to 0.2.0-rc.1 the first emphasis was taken for part of a formula.
    expect(tidy("Costs $5 *per* item and $6 *per* box.\n", dialect)).toBe(
      "Costs $5 _per_ item and $6 _per_ box.\n",
    );
    // And the text between the amounts could not be broken, which left a line of 124 columns.
    expect(
      tidy(
        "The basic plan costs $5 for each month that the account stays open, with no charge at all for the first two weeks, and the yearly plan costs $50 when it is paid for in advance.\n",
        dialect,
      ),
    ).toBe(
      "The basic plan costs $5 for each month that the account stays open, with no\ncharge at all for the first two weeks, and the yearly plan costs $50 when it is\npaid for in advance.\n",
    );
    expect(
      lint("Costs $5 *per* item and $6 *per* box.\n", { path: "note.md", config: config(dialect) }),
    ).toHaveLength(4);
  });
  it.each(renderers)("still leaves a formula alone in %s", (dialect) => {
    for (const source of [
      "The area is $a * b * c$ and the cost is $x_1 * y_1 * z$ in total.\n",
      "With $\\alpha *x* \\beta$ and $$a *b* c$$ inline.\n",
      "A formula $x + y = z$ that would otherwise be broken at one of its spaces if it were prose near the end of a line.\n",
    ]) {
      const output = tidy(source, dialect);
      // Every formula comes out as it went in, and none is broken across lines.
      expect(formulas(output, dialect), source).toEqual(formulas(source, dialect));
      expect(formulas(source, dialect).length, source).toBeGreaterThan(0);
    }
    expect(tidy("The area is $a * b * c$ and *more*.\n", dialect)).toBe(
      "The area is $a * b * c$ and _more_.\n",
    );
  });
  it("keeps the wide reading in Obsidian", () => {
    const source = "Costs $5 *per* item and $6 *per* box.\n";
    const workspace = { resolve: () => ({ status: "external" as const }), strictLineBreaks: true };
    const result = format(source, { path: "note.md", config: config("obsidian"), workspace });
    expect(result.output).toBe("Costs $5 *per* item and $6 _per_ box.\n");
  });
});
