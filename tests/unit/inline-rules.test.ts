import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dialects, lint, parse, range, semanticFingerprint } from "../../src/index.js";
import type { Dialect, RuleSetting } from "../../src/index.js";
import { giteaPyLine, inForgeMath } from "../../src/rules/protections.js";
import { codeSpanText, lazyIndentation } from "../../src/syntax/parse.js";
import { only, formatted, codeSpans } from "../support/rules.js";
describe("style/emphasis and style/strong next to other delimiters", () => {
  const config = only({ "style/emphasis": "warn", "style/strong": "warn" });
  it.each(["_*foo*_", "*_foo_*", "_foo_*bar*", "*foo*_bar", "bar_*foo*", "*__foo__*", "__*foo*__"])(
    "leaves %s alone because the new marker would touch an existing one",
    (source) => {
      expect(formatted(`${source}\n`, config)).toBe(`${source}\n`);
      expect(lint(`${source}\n`, { config })).toEqual([]);
    },
  );
  it.each([
    ["***foo***\n", "_**foo**_\n"],
    ["___foo___\n", "_**foo**_\n"],
    ["*foo* *bar*\n", "_foo_ _bar_\n"],
    ["**foo** __bar__\n", "**foo** **bar**\n"],
    ["*foo*(bar)\n", "_foo_(bar)\n"],
  ])("still converts %j", (source, output) => {
    expect(formatted(source, config)).toBe(output);
  });
  // Each would pair differently with the new markers: a `*` or `_` left as
  // text, a run of the new marker nearby, or a `~` between two markers.
  it.each([
    ["*a _b* c_\n", "_", "commonmark"],
    ["_a*b_ and _c*_\n", "*", "commonmark"],
    ["_]*__a__*i_\n", "*", "commonmark"],
    ["_~*a*e_\n", "*", "github"],
    ["_f~*a*e_\n", "*", "obsidian"],
  ] as const)("leaves the crossed delimiters of %j alone", (source, marker, dialect) => {
    const rules = only({ "style/emphasis": ["warn", { marker }] }, dialect);
    expect(formatted(source, rules)).toBe(source);
    expect(lint(source, { config: rules })).toEqual([]);
  });
  it.each([
    // A `*` or `_` left as text that the new markers cannot reach stays text.
    ["*a* and file_.\n", "_", "_a_ and file_.\n"],
    ["*a* and 2*3 and *b*\n", "_", "_a_ and 2*3 and _b_\n"],
    // Of emphases sharing a run, those that keep their pairs change.
    ["*a****c***\n", "_", "_a_***c***\n"],
    ["___b___ and ***c***\n", "*", "*__b__* and ***c***\n"],
  ] as const)("converts what keeps its pairs in %j", (source, marker, output) => {
    expect(formatted(source, only({ "style/emphasis": ["warn", { marker }] }))).toBe(output);
  });
  it.each(["*****a***\n", "___a_ x_\n", "***c***a\n", "**_c_**a\n"])(
    "formats the shared runs of %j safely with every marker",
    (source) => {
      // Which of these markers can change depends on micromark's version:
      // micromark-core-commonmark 2.0.4 no longer lets a run next to the other
      // marker close whatever follows it, as in `***c***a`.
      for (const emphasis of ["*", "_"] as const)
        for (const strong of ["*", "_"] as const) {
          const rules = only({
            "style/emphasis": ["warn", { marker: emphasis }],
            "style/strong": ["warn", { marker: strong }],
          });
          const output = formatted(source, rules);
          expect(semanticFingerprint(parse(output, "commonmark"))).toBe(
            semanticFingerprint(parse(source, "commonmark")),
          );
        }
    },
  );
  it.each(["github", "forgejo", "gitea"] as const)(
    "leaves markers next to dollar math alone on %s",
    (dialect) => {
      // A `_` after the closing dollar keeps `$x$` from being math.
      const source = "$x$_a_ and *$y$* and $z$ *b*\n";
      expect(
        formatted(source, only({ "style/emphasis": ["warn", { marker: "*" }] }, dialect)),
      ).toBe("$x$_a_ and *$y$* and $z$ *b*\n");
      expect(formatted(source, only({ "style/emphasis": "warn" }, dialect))).toBe(
        "$x$_a_ and *$y$* and $z$ _b_\n",
      );
      // CommonMark has no math, and Obsidian does not look for a `_` after it.
      for (const other of ["commonmark", "obsidian"] as const)
        expect(
          formatted(source, only({ "style/emphasis": ["warn", { marker: "*" }] }, other)),
        ).toBe("$x$*a* and *$y$* and $z$ *b*\n");
    },
  );
  it.each(["github", "forgejo", "gitea", "obsidian"] as const)(
    "leaves emphasis that holds a tilde run of strikethrough alone on %s",
    (dialect) => {
      // After `*a*`, the parser pairs `*c~~ d*`, which GitHub and Obsidian show
      // as text after a strikethrough of `b *c` (issue #320).
      const rules = only({ "style/emphasis": "warn" }, dialect);
      expect(formatted("Use *a* and ~~b *c~~ d* here.\n", rules)).toBe(
        "Use _a_ and ~~b *c~~ d* here.\n",
      );
      // One tilde marks strikethrough too, except in Obsidian (issue #319).
      expect(formatted("Use *a* and ~b *c~ d* here.\n", rules)).toBe(
        dialect === "obsidian" ? "Use _a_ and ~b _c~ d_ here.\n" : "Use _a_ and ~b *c~ d* here.\n",
      );
      // Without another run of tildes no strikethrough forms, and strikethrough
      // that the parser reads holds no tildes as text.
      expect(formatted("Some *about ~5 minutes* here.\n", rules)).toBe(
        "Some _about ~5 minutes_ here.\n",
      );
      expect(formatted("A *b ~~c~~ d* e.\n", rules)).toBe("A _b ~~c~~ d_ e.\n");
    },
  );
  it.each(["github", "forgejo", "gitea", "obsidian"] as const)(
    "leaves a `_` that tildes separate from a word alone on %s",
    (dialect) => {
      // GitHub reads such a `_` as inside the word, where it cannot open or
      // close, while the parser reads emphasis (issue #322).
      const underscores = only({ "style/emphasis": "warn" }, dialect);
      expect(formatted("x~~*b b*~~ y and *c*\n", underscores)).toBe("x~~*b b*~~ y and _c_\n");
      const stars = only({ "style/emphasis": ["warn", { marker: "*" }] }, dialect);
      expect(formatted("x~_b b_~ y and _c_\n", stars)).toBe("x~_b b_~ y and *c*\n");
      // Next to a space, a tilde does not join the marker to a word.
      expect(formatted("a ~*b* c\n", underscores)).toBe("a ~_b_ c\n");
    },
  );
  it.each(dialects)(
    "leaves markers alone where CommonMark pairs them otherwise than the parser on %s",
    (dialect) => {
      // micromark refuses the pair `***` and `*` by the rule of three, counting
      // what is left of `***`; CommonMark and GitHub count the whole run and
      // read emphasis around `*a* a` (issue #323).
      const rules = only({ "style/emphasis": "warn", "style/strong": "warn" }, dialect);
      expect(formatted("xab***a* a*y and *b*\n", rules)).toBe("xab***a* a*y and *b*\n");
      expect(formatted("xab***a* a*y\n\nAnd *b*.\n", rules)).toBe("xab***a* a*y\n\nAnd _b_.\n");
    },
  );
  it("reads strikethrough with two tildes only in Obsidian", () => {
    // Obsidian shows `~a~` as text (issue #319); GitHub, Forgejo, and Gitea
    // keep the parser's reading of one tilde.
    const deleted = (source: string, dialect: Dialect) =>
      parse(source, dialect).tree.children.flatMap((block) =>
        "children" in block ? block.children.filter((node) => node.type === "delete") : [],
      ).length;
    expect(deleted("~a~ and ~~b~~\n", "obsidian")).toBe(1);
    for (const dialect of ["github", "forgejo", "gitea"] as const)
      expect(deleted("~a~ and ~~b~~\n", dialect)).toBe(2);
    expect(
      formatted("Before ~b *c~ d* after.\n", only({ "style/emphasis": "warn" }, "obsidian")),
    ).toBe("Before ~b _c~ d_ after.\n");
  });
  it("keeps `*` next to an emoji, where `_` could neither open nor close", () => {
    // micromark reads each half of the emoji's surrogate pair as a letter.
    expect(formatted("🙂*a*🙂 and *b*\n", only({ "style/emphasis": "warn" }, "github"))).toBe(
      "🙂*a*🙂 and _b_\n",
    );
  });
  it("leaves emphasis from the line of a callout's or alert's marker into its body alone", () => {
    const rules = only({ "style/emphasis": ["warn", { marker: "*" }] }, "obsidian");
    expect(formatted("> [!note] _Title\n> body_ and _b_\n", rules)).toBe(
      "> [!note] _Title\n> body_ and *b*\n",
    );
    expect(formatted("> [!note] _Title_\n> _body_\n", rules)).toBe("> [!note] *Title*\n> *body*\n");
    // An alert's marker stays alone on its line in GitHub's reading too.
    const alert = "> [!NOTE] _Text\n> more_\n";
    expect(formatted(alert, { ...rules, dialect: "github" })).toBe(alert);
    // Also a marker written with an escape or a character reference (issue #294).
    expect(formatted("> &#91;!note] _Title\n> body_ and _b_\n", rules)).toBe(
      "> &#91;!note] _Title\n> body_ and *b*\n",
    );
    const escaped = "> \\[!NOTE] _Text\n> more_\n";
    expect(formatted(escaped, { ...rules, dialect: "github" })).toBe(escaped);
  });
  it("keeps the meaning of random runs of markers", () => {
    const words = fc.constantFrom(
      "a",
      "b c",
      "*",
      "_",
      "**",
      "__",
      "***",
      "*a*",
      "_a_",
      "**b**",
      "__b__",
      "***c***",
      "___c___",
      "*a _b* c_",
      "x_y",
      "2*3",
      "file_",
      "_f",
      "`c`",
      "\\*",
      "\\_",
      "~",
      "~~s~~",
      "$x$",
      "[*T*]",
      "[_T_][]",
      "[*T*](u)",
      "==h==",
      " ",
      "\n",
      "(",
      ".",
    );
    fc.assert(
      fc.property(
        fc.array(words, { minLength: 1, maxLength: 12 }),
        fc.constantFrom(...dialects),
        fc.constantFrom("*", "_"),
        fc.constantFrom("*", "_"),
        (parts, dialect, emphasis, strong) => {
          const source = `${parts.join("")}\n\n[*T*]: u\n`;
          const rules = only(
            {
              "style/emphasis": ["warn", { marker: emphasis }],
              "style/strong": ["warn", { marker: strong }],
            },
            dialect,
          );
          const output = formatted(source, rules);
          expect(semanticFingerprint(parse(output, dialect))).toBe(
            semanticFingerprint(parse(source, dialect)),
          );
        },
      ),
      { numRuns: 400, seed: 20261017 },
    );
  });
});

describe("style/emphasis and style/strong in reference labels", () => {
  const rules = { "style/emphasis": "warn", "style/strong": "warn" } as const;
  it("leaves the text of collapsed and shortcut references alone", () => {
    // The text is also the label, which would no longer match the definition.
    const source =
      "See [*Title*][] and [*Title*], [__Bold__] and [*Full*][t], and [*inline*](u).\n\n[*Title*]: u\n[__Bold__]: u\n[t]: u\n";
    expect(formatted(source, only(rules, "github"))).toBe(
      "See [*Title*][] and [*Title*], [__Bold__] and [_Full_][t], and [_inline_](u).\n\n[*Title*]: u\n[__Bold__]: u\n[t]: u\n",
    );
    expect(lint("[*Title*]\n\n[*Title*]: u\n", { config: only(rules) })).toEqual([]);
  });
  it("leaves bracketed text alone that would match a definition", () => {
    const config = only(
      { "style/emphasis": ["warn", { marker: "*" }], "style/strong": ["warn", { marker: "_" }] },
      "github",
    );
    const source = "[_T_], [**B**], [^_n_], and [_x_].\n\n[*T*]: u\n[__B__]: u\n[^*n*]: Note.\n";
    expect(formatted(source, config)).toBe(
      "[_T_], [**B**], [^_n_], and [*x*].\n\n[*T*]: u\n[__B__]: u\n[^*n*]: Note.\n",
    );
  });
});

describe("style/inline-code", () => {
  const rule = { "style/inline-code": "warn" } as const;
  it.each([
    // Joined, an `==` or `[[` left as text would open a highlight or wikilink.
    "Text with ==a highlight `code` `\nspan`== here.\n",
    "==mark `code\n==` here.\n",
    "See [[note `code\nspan`]] here.\n",
  ])("leaves %j unjoined in Obsidian", (source) => {
    expect(formatted(source, only(rule, "obsidian"))).toBe(source);
    expect(formatted(source, only(rule, "github"))).toBe(source.replace(/\n(?=\S+`)/, " "));
  });
  it("leaves a code span from the line of a callout's or alert's marker unjoined", () => {
    // That line holds an Obsidian callout's title, and an alert's marker alone.
    for (const source of [
      "> [!note] Title `code\n> span` here.\n",
      "> [!NOTE] `code\n> span` here.\n",
      // Also a marker written with an escape or a character reference (issue #294).
      "> &#91;!note] Title `code\n> span` here.\n",
      "> \\[!NOTE] `code\n> span` here.\n",
    ]) {
      for (const dialect of ["github", "forgejo", "gitea", "obsidian"] as const)
        expect(formatted(source, only(rule, dialect))).toBe(source);
      expect(formatted(source, only(rule))).toBe(source.replace("\n> ", " "));
    }
  });
  it.each(dialects.filter((dialect) => dialect !== "vitepress"))(
    "handles multiline code indentation in the %s dialect",
    (dialect) => {
      // CommonMark strips it from a paragraph's lines before it reads the span,
      // and GitHub shows `npm run build`; the parser keeps it in the span.
      for (const [source, output] of [
        ["Run `npm run\n   build` now.\n", "Run `npm run build` now.\n"],
        ["Run `npm run\n\tbuild` now.\n", "Run `npm run build` now.\n"],
        ["> Run `npm run\n>    build` now.\n", "> Run `npm run build` now.\n"],
        ["- Run `npm run\n     build` now.\n", "- Run `npm run build` now.\n"],
        ["- [ ] Run `npm run\n      build` now.\n", "- [ ] Run `npm run build` now.\n"],
      ] as const)
        expect(formatted(source, only(rule, dialect))).toBe(
          dialect === "obsidian" ? source : output,
        );
    },
  );
  it("compares code spans without the indentation after their line endings", () => {
    const print = (source: string) => semanticFingerprint(parse(source, "github"));
    expect(print("Run `npm run\n   build` now.\n")).toBe(print("Run `npm run build` now.\n"));
    expect(print("Run `npm run\n   build` now.\n")).not.toBe(
      print("Run `npm run    build` now.\n"),
    );
    // A lazy line keeps its indentation, as GitHub shows it.
    expect(print("> Run `npm run\n   build` now.\n")).toBe(
      print("> Run `npm run    build` now.\n"),
    );
    expect(print("> Run `npm run\n   build` now.\n")).not.toBe(
      print("> Run `npm run build` now.\n"),
    );
  });
  // Issue #290, observed with `gh api markdown -f mode=markdown` on 2026-10-18,
  // comparing the text of each `<code>` element exactly: each case's code
  // spans as GitHub shows them, and as commonmark.js 0.31.2 shows them where
  // it differs. It differs only where a span goes on in a lazy continuation
  // line, one without its block quote's `>` or its list item's indentation,
  // that starts with spaces or tabs, which GitHub keeps in the span.
  const observed: [string, string[], string[]?][] = [
    ["Text ` \n   foo ` end.", [" foo"]],
    ["> Run `npm run\n   build` now.", ["npm run    build"], ["npm run build"]],
    ["Text ` foo \n   ` end.", ["foo "]],
    ["Text `\n   foo\n   ` end.", ["foo"]],
    ["> a `b\n>    c` d", ["b c"]],
    ["> a `b\n  c` d", ["b   c"], ["b c"]],
    ["> a `b\nc` d", ["b c"]],
    ["> > a `b\n>   c` d", ["b   c"], ["b c"]],
    ["> > a `b\n> >   c` d", ["b c"]],
    ["> > a `b\n   c` d", ["b    c"], ["b c"]],
    ["- a `b\n c` d", ["b  c"], ["b c"]],
    ["- a `b\n     c` d", ["b c"]],
    ["- a `b\n  c` d", ["b c"]],
    ["1. a `b\n  c` d", ["b   c"], ["b c"]],
    ["1. a `b\n      c` d", ["b c"]],
    ["- a\n  - b `c\n   d` e", ["c  d"], ["c d"]],
    ["- a\n  - b `c\n d` e", ["c  d"], ["c d"]],
    ["> - a `b\n>  c` d", ["b  c"], ["b c"]],
    ["> - a `b\n>     c` d", ["b c"]],
    ["> - a `b\n c` d", ["b  c"], ["b c"]],
    ["- > a `b\n  c` d", ["b c"]],
    ["- > a `b\n   c` d", ["b  c"], ["b c"]],
    ["- > a `b\n  >   c` d", ["b c"]],
    ["Ref[^a].\n\n[^a]: a `b\n c` d", ["b  c"]],
    ["Ref[^b].\n\n[^b]: a `b\n     c` d", ["b c"]],
    ["Ref[^c].\n\n[^c]: a `b\n    c` d", ["b c"]],
    ["Ref[^d].\n\n[^d]: a ` \n   foo ` d", ["    foo"]],
    ["Ref[^e].\n\n[^e]: a `\n  foo\n  ` d", ["  foo  "]],
    ["a `b\n   c`\n===", ["b c"]],
    ["> a `b\n  c`\n> ===", ["b   c"], ["b c"]],
    ["> [a `b\n  c`](u)", ["b   c"], ["b c"]],
    ["> *a `b\n  c`*", ["b   c"], ["b c"]],
    // Only spaces, which stay.
    ["a `  ` b", ["  "]],
    ["a ` \n ` b", ["  "]],
    ["a ` \n` b", ["  "]],
    ["a `\n ` b", [" "]],
    ["> a ` \n  ` b", ["    "], ["  "]],
    ["> a ` \n>   ` b", ["  "]],
    // A line break at an edge.
    ["a `\nfoo` b", [" foo"]],
    ["a `foo\n` b", ["foo "]],
    ["a `\nfoo\n` b", ["foo"]],
    ["a `\n   foo` b", [" foo"]],
    ["a `foo\n   ` b", ["foo "]],
    ["> a `\n   foo` b", ["    foo"], [" foo"]],
    ["> a `foo\n   ` b", ["foo    "], ["foo "]],
    ["> a `\n   foo\n   ` b", ["   foo   "], ["foo"]],
    ["> a `\n>   foo\n>   ` b", ["foo"]],
    ["- a `foo\n   ` b", ["foo "]],
    ["- a `foo\n ` b", ["foo  "], ["foo "]],
    ["a `b  \n  c` d", ["b   c"]],
    ["a ` b \n c ` d", ["b  c"]],
    ["a `` ` \n   `` b", ["` "]],
    ["> a `` x\n   ` `` b", ["x    `"], ["x `"]],
    // Tabs, which are not spaces, and count to the next multiple of four
    // columns where they indent.
    ["a `\tfoo\t` b", ["\tfoo\t"]],
    ["a ` \tfoo\t ` b", ["\tfoo\t"]],
    ["a `b\n\tc` d", ["b c"]],
    ["> a `b\n\tc` d", ["b \tc"], ["b c"]],
    ["> a `b\n>\tc` d", ["b c"]],
    ["> > a `b\n>\tc` d", ["b   c"], ["b c"]],
    ["- a `b\n\tc` d", ["b c"]],
    ["> a `\n\tfoo ` b", ["\tfoo"], ["foo"]],
    ["a ` \n\tfoo ` b", [" foo"]],
    ["> Run `npm run\r\n   build` now.", ["npm run    build"], ["npm run build"]],
    ["Text `\r\n   foo\r\n   ` end.", ["foo"]],
    ["> a `\r\n   foo\r\n   ` b", ["   foo   "], ["foo"]],
  ];
  it.each(observed)("reads the code spans of %j as GitHub shows them", (source, github, other) => {
    const spans = codeSpans(source, "github");
    expect(spans.map(codeSpanText)).toEqual(github);
    // commonmark.js has no footnotes.
    if (!source.includes("[^"))
      expect(spans.map(lazyIndentation)).toEqual(
        github.map((text, i) => (other?.[i] ?? text) !== text),
      );
  });
  it.each(observed)("preserves the observed code values when joining %j", (source, github) => {
    for (const dialect of dialects.filter((dialect) => dialect !== "vitepress")) {
      // CommonMark has no footnotes.
      if (dialect === "commonmark" && source.includes("[^")) continue;
      const output = formatted(source, only(rule, dialect));
      const spans = codeSpans(output, dialect);
      expect(spans.map(codeSpanText), dialect).toEqual(github);
      // Native text can retain a hard break where the primary parser pairs
      // these ticks (#335); joining conservatively keeps both marker forms.
      const sourceBreak = codeSpans(source, dialect).some((span) =>
        /(?: {2}|\\)(?:\r\n|\r|\n)/.test(source.slice(...range(span))),
      );
      // Renderers differ on a lazy line's indentation: GitHub keeps it in the
      // span, and commonmark.js does not.
      if (sourceBreak) expect(output).toBe(source);
      else if (dialect === "github")
        expect(spans.every((span) => !/[\r\n]/.test(output.slice(...range(span))))).toBe(true);
      else if (codeSpans(source, dialect).some(lazyIndentation)) expect(output).toBe(source);
    }
  });
  it("retains short code beside a single `==` or below a callout's title (#565)", () => {
    for (const source of [
      "An == sign and `code\nspan` here.\n",
      "> [!note] Title\n> Body `code\n> span` here.\n",
    ])
      expect(formatted(source, only(rule, "obsidian"))).toBe(source);
  });
  it("still joins long code beside a single `==` or below a callout's title (#565)", () => {
    expect(formatted("An == sign and ```code\nspan``` here.\n", only(rule, "obsidian"))).toBe(
      "An == sign and `code span` here.\n",
    );
    expect(
      formatted("> [!note] Title\n> Body ```code\n> span``` here.\n", only(rule, "obsidian")),
    ).toBe("> [!note] Title\n> Body `code span` here.\n");
  });
  it.each([
    // The joined span opens with one backtick, which the earlier one would pair with.
    "A ` tick and ``code\nspan`` here.\n",
    "Text \\`` and ``code\nspan`` here.\n",
    "[link](u`v) and ``code\nspan`` here.\n",
  ])("leaves %j unjoined, where an earlier run of the new backticks would pair", (source) => {
    for (const dialect of dialects) expect(formatted(source, only(rule, dialect))).toBe(source);
  });
  it.each([
    ["Ticks ``code\nspan`` and a ` after.\n", "Ticks `code span` and a ` after.\n"],
    ["`a` and `b\nc` here.\n", "`a` and `b c` here.\n"],
  ])("formats %j while retaining Obsidian's physical code lines", (source, output) => {
    // Live Preview keeps unmatched backticks and resets short multiline
    // spans, so either Obsidian paragraph stays as written (#362, #565).
    for (const dialect of dialects)
      expect(formatted(source, only(rule, dialect)), dialect).toBe(
        dialect === "obsidian" ? source : output,
      );
  });
});

describe("Forgejo and Gitea backslash math", () => {
  const markers = { "style/emphasis": "warn", "style/strong": "warn" } as const;
  it.each(["forgejo", "gitea"] as const)(
    "leaves markers inside \\(...\\) alone on %s",
    (dialect) => {
      expect(formatted("\\(*x*\\) and *y*\n", only(markers, dialect))).toBe("\\(*x*\\) and _y_\n");
      expect(formatted("\\(__x__\\)\n", only(markers, dialect))).toBe("\\(__x__\\)\n");
      expect(formatted("\\(*x*\\)\n", only(markers, "github"))).toBe("\\(_x_\\)\n");
    },
  );
  it.each(["forgejo", "gitea"] as const)(
    "does not join a code span that would put \\( and \\) on one line on %s",
    (dialect) => {
      const source = "\\( `code\nspan` \\)\n";
      expect(formatted(source, only({ "style/inline-code": "warn" }, dialect))).toBe(source);
      expect(formatted(source, only({ "style/inline-code": "warn" }, "github"))).toBe(
        "\\( `code span` \\)\n",
      );
    },
  );
});

describe("style/emphasis and style/strong on Gitea", () => {
  const rules: Record<string, RuleSetting> = { "style/emphasis": "warn", "style/strong": "warn" };
  // Gitea renders `__init__.py` literally and `*config*.py` as emphasis; GFM
  // parses both as emphasis, so a marker change would alter Gitea's output.
  it.each([
    ["See __init__.py and __main__.py.\n", "See **init**.py and **main**.py.\n"],
    ["Edit *config*.py first.\n", "Edit _config_.py first.\n"],
    ["Use **setup**.py here.\n", "Use **setup**.py here.\n"],
    ["*a* and b_.py\n", "_a_ and b_.py\n"],
    ["*a* near `x_.py`\n", "_a_ near `x_.py`\n"],
    ["*.py files*\n", "_.py files_\n"],
  ])("leaves %j alone where `_.py` decides Gitea emphasis", (source, github) => {
    expect(formatted(source, only(rules, "gitea"))).toBe(source);
    expect(formatted(source, only(rules, "github"))).toBe(github);
  });
  it("converts markers on other lines", () => {
    const source = "*a* and __b__\n\n*c* on __init__.py\n";
    expect(formatted(source, only(rules, "gitea"))).toBe("_a_ and **b**\n\n*c* on __init__.py\n");
  });
  it("leaves multiline code spans on `_.py` lines unjoined", () => {
    const config = only({ "style/inline-code": "warn" }, "gitea");
    const source = "_a_ and `code\nspan` near b_.py\n";
    expect(formatted(source, config)).toBe(source);
    expect(formatted(source, { ...config, dialect: "github" })).toBe(
      "_a_ and `code span` near b_.py\n",
    );
  });
});

describe("style/emphasis and style/strong in Obsidian, next to a * or _ that is text", () => {
  const rules: Record<string, RuleSetting> = { "style/emphasis": "warn", "style/strong": "warn" };
  // Obsidian's Reading view pairs a `*` or `_` that CommonMark leaves as text
  // with a later one: `snake_case and _em_` shows `case and _em` as emphasis,
  // and `a * b *c*` shows ` b ` (issue #361).
  it.each([
    ["snake_case and *em*\n", "snake_case and _em_\n"],
    ["See file_name.md and *this*.\n", "See file_name.md and _this_.\n"],
    ["a * b *c*\n", "a * b _c_\n"],
    ["5 * 3 = 15 and __bold__\n", "5 * 3 = 15 and **bold**\n"],
    ["a ** b __c__\n", "a ** b **c**\n"],
    ["- an item with snake_case and *em*\n", "- an item with snake_case and _em_\n"],
    ["| a_b and *c* |\n| - |\n", "| a_b and _c_ |\n| - |\n"],
    ["# snake_case and *em*\n", "# snake_case and _em_\n"],
  ])("leaves %j as written", (source, github) => {
    expect(formatted(source, only(rules, "obsidian"))).toBe(source);
    expect(formatted(source, only(rules, "github"))).toBe(github);
  });
  it.each([
    // Escaped, in code, in math, or in a wikilink, a `*` or `_` is not text that pairs.
    ["a \\_ b *c*\n", "a \\_ b _c_\n"],
    ["`snake_case` and *em*\n", "`snake_case` and _em_\n"],
    ["$a_b$ and *em*\n", "$a_b$ and _em_\n"],
    ["[[snake_case]] and *em*\n", "[[snake_case]] and _em_\n"],
    // The other paragraphs and table cells are formatted, which Obsidian reads on their own.
    ["| a_b | *c* |\n| - | - |\n", "| a_b | _c_ |\n| - | - |\n"],
    ["snake_case\n\n*em* and __b__\n", "snake_case\n\n_em_ and **b**\n"],
  ])("still formats %j", (source, output) => {
    expect(formatted(source, only(rules, "obsidian"))).toBe(output);
  });
});

describe("style/emphasis and style/strong on long lines", () => {
  /** The lines that hold a range, searched character by character. */
  function lineOf(source: string, start: number, end: number): [number, number] {
    let lineStart = start;
    while (lineStart > 0 && !/[\r\n]/.test(source[lineStart - 1]!)) lineStart--;
    let lineEnd = end;
    while (lineEnd < source.length && !/[\r\n]/.test(source[lineEnd]!)) lineEnd++;
    return [lineStart, lineEnd];
  }
  it("find `_.py`, `\\(`, and `\\)` on a line as a search of the line does", () => {
    const text = fc
      .array(
        fc.constantFrom("a", " ", "\n", "\r", "\r\n", "_.py", "_.p", "\\(", "\\)", "\\", "("),
        {
          maxLength: 30,
        },
      )
      .map((parts) => parts.join(""));
    fc.assert(
      fc.property(text, fc.nat(), fc.nat(), (source, a, b) => {
        const start = a % (source.length + 1);
        const end = start + (b % (source.length - start + 1));
        const document = parse(source, "forgejo");
        const [lineStart, lineEnd] = lineOf(source, start, end);
        const before = source.slice(lineStart, start);
        expect(giteaPyLine(document, start, end)).toBe(
          source.slice(lineStart, lineEnd).includes("_.py"),
        );
        expect(inForgeMath(document, start, end)).toBe(
          before.lastIndexOf("\\(") > before.lastIndexOf("\\)") &&
            source.slice(end, lineEnd).includes("\\)"),
        );
      }),
      { numRuns: 500 },
    );
  });
});
