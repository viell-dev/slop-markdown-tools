/**
 * What GitHub, Forgejo, and Gitea rendered as math for dollar signs in running
 * text, observed on 2026-10-06:
 *
 * - GitHub: the file view of a repository on github.com, through the contents
 *   API with `Accept: application/vnd.github.html`. The comment renderer differs:
 *   it turns a line break into `<br>`, which ends a formula.
 * - Forgejo 16.0.5 and Gitea 1.25.5 and 28.0.0: the file view of local instances.
 *   The two Gitea versions agreed on every case.
 *
 * Each case is one paragraph or block. `math` lists the renderers whose output
 * for it contained a formula. A case with `observed` was rendered by those
 * renderers only, and says nothing about the others. To observe again, render the sources separated by
 * thematic breaks and look for `math-renderer` (GitHub) or `language-math`
 * (Forgejo, Gitea) in each part.
 */
export type MathRenderer = "github" | "forgejo" | "gitea";
export interface MathCase {
  name: string;
  source: string;
  math: MathRenderer[];
  observed?: MathRenderer[];
}
export const mathCases: MathCase[] = [
  { name: "basic", source: "A $x$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "space-after-open", source: "A $ x$ d.", math: ["forgejo", "gitea"] },
  { name: "space-before-close", source: "A $x $ d.", math: ["forgejo", "gitea"] },
  { name: "digit-after-close", source: "A $x$5 d.", math: [] },
  { name: "letter-after-close", source: "A $x$a d.", math: [] },
  { name: "underscore-after-close", source: "A $x$_ d.", math: [] },
  { name: "punct-after-close", source: "A $x$. d", math: ["github", "forgejo", "gitea"] },
  { name: "letter-before-open", source: "A a$x$ d.", math: [] },
  { name: "digit-before-open", source: "A 5$x$ d.", math: [] },
  { name: "quote-before-open", source: 'A "$x$" d.', math: [] },
  { name: "paren-before-open", source: "A ($x$) d.", math: ["github", "forgejo", "gitea"] },
  { name: "bracket-before-open", source: "A [$x$] d.", math: [] },
  { name: "dash-before-open", source: "A -$x$ d.", math: ["forgejo", "gitea"] },
  { name: "escaped-open", source: "A \\$x$ d.", math: ["github"] },
  { name: "escaped-close", source: "A $x\\$ d.", math: ["github"] },
  { name: "escaped-inside", source: "A $a \\$ b$ d.", math: ["forgejo", "gitea"] },
  { name: "emphasis-inside", source: "A $a *b* c$ d.", math: ["forgejo", "gitea"] },
  { name: "tight-emphasis-inside", source: "A $a*b*c$ d.", math: ["forgejo", "gitea"] },
  { name: "underscores-inside", source: "A $a_b_c$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "code-inside", source: "A $x `c` y$ d.", math: ["forgejo", "gitea"] },
  { name: "link-inside", source: "A $x [l](u) y$ d.", math: ["forgejo", "gitea"] },
  { name: "currency", source: "Costs $5 *per* item and $6 *per* box.", math: [] },
  { name: "currency-then-math", source: "A $5 and $x$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "two-maths", source: "A $x$ and $y$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "soft-break-inside", source: "A $x +\ny$ d.", math: ["github"] },
  { name: "soft-break-after-open", source: "A $\nx$ d.", math: [] },
  { name: "soft-break-before-close", source: "A $x\n$ d.", math: ["github"] },
  { name: "double-inline", source: "A $$x$$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "double-inline-spaces", source: "A $$ x $$ d.", math: ["forgejo", "gitea"] },
  { name: "double-inline-soft-break", source: "A $$x\ny$$ d.", math: ["github"] },
  { name: "backtick-form", source: "A $`a *b* c`$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "display-own-paragraph", source: "$$\nx = y\n$$", math: ["github", "forgejo", "gitea"] },
  { name: "display-one-line", source: "$$ x = y $$", math: ["github", "forgejo", "gitea"] },
  { name: "display-after-text", source: "text\n$$\nx\n$$\ntext", math: ["forgejo", "gitea"] },
  { name: "display-blank-line-inside", source: "$$\nx\n\ny\n$$", math: ["forgejo", "gitea"] },
  { name: "fence", source: "```math\nx\n```", math: ["github", "forgejo", "gitea"] },
  { name: "less-than", source: "A $a < b$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "table-cell", source: "| a |\n|---|\n| $x$ |", math: ["github", "forgejo", "gitea"] },
  { name: "three-dollars", source: "A $x$$y$ d.", math: ["github", "forgejo", "gitea"] },
  {
    name: "long-currency",
    source:
      "The basic plan costs $5 for each month that the account stays open, with no charge at all for the first two weeks, and the yearly plan costs $50 when it is paid for in advance.",
    math: [],
  },
  { name: "unicode-before-open", source: "A é$x$ d.", math: ["forgejo", "gitea"] },
  { name: "unicode-after-close", source: "A $x$é d.", math: ["github"] },
  { name: "start-of-line", source: "$x$ starts.", math: ["github", "forgejo", "gitea"] },
  { name: "end-of-line", source: "Ends with $x$", math: ["github", "forgejo", "gitea"] },
  { name: "percent", source: "A $50% off and 20$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "backslash-paren", source: "A \\(x\\) d.", math: ["forgejo"] },
  { name: "backslash-bracket", source: "A \\[x\\] d.", math: [] },
  { name: "after-strong", source: "A **b**$x$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "after-code", source: "A `c`$x$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "after-link", source: "A [l](u)$x$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "after-html", source: "A <b>h</b>$x$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "after-entity", source: "A &amp;$x$ d.", math: [] },
  { name: "before-strong", source: "A $x$**b** d.", math: ["github"] },
  { name: "newline-before-open", source: "A\n$x$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "backslash-content", source: "A $\\alpha$ d.", math: ["github", "forgejo", "gitea"] },
  {
    name: "quote-open-then-math",
    source: '"$a(\n$\\alpha$ d.',
    math: ["github", "forgejo", "gitea"],
  },
  { name: "nested-parens", source: "A (($x$)) d.", math: ["github", "forgejo", "gitea"] },
  { name: "in-link-text", source: "A [$x$](u) d.", math: ["gitea"] },
  { name: "in-strong", source: "A **$x$** d.", math: ["github"] },
  { name: "in-emphasis-star", source: "A *$x$* d.", math: [] },
  { name: "in-emphasis-underscore", source: "A _$x$_ d.", math: [] },
  { name: "in-strike", source: "A ~~$x$~~ d.", math: ["github"] },
  { name: "table-currency", source: "| a | b |\n|---|---|\n| $5 | $6 |", math: [] },
  { name: "list-item", source: "- $x$ item", math: ["github", "forgejo", "gitea"] },
  { name: "blockquote", source: "> $x$ quoted", math: ["github", "forgejo", "gitea"] },
  { name: "math-dash-math", source: "A $x$-$y$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "math-slash-math", source: "A $x$/$y$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "thousands", source: "Costs $1,000 and $2,000 d.", math: [] },
  { name: "us-dollar", source: "Costs US$5 and US$6 d.", math: [] },
  { name: "range", source: "Costs $5-$10 d.", math: [] },
  { name: "slash-range", source: "Costs $5/$10 d.", math: [] },
  { name: "trailing-sign", source: "Costs 5$ and 10$ d.", math: [] },
  { name: "trailing-sign-words", source: "a 5$ or 10$ b", math: [] },
  { name: "adjacent", source: "A $a$ $b$ d.", math: ["github", "forgejo", "gitea"] },
  {
    name: "price-then-trailing",
    source: "From $5 to 10$ d.",
    math: ["github", "forgejo", "gitea"],
  },
  { name: "paren-currency", source: "Costs ($5) and ($6) d.", math: [] },
  { name: "escaped-currency", source: "Costs \\$5 and \\$6 d.", math: [] },
  { name: "escaped-currency-trailing", source: "Costs \\$5 and 6\\$ d.", math: ["github"] },
  { name: "single-dollar", source: "Only $5 here.", math: [] },
  {
    name: "math-with-spaces-inside",
    source: "A $x + y = z$ d.",
    math: ["github", "forgejo", "gitea"],
  },
  { name: "math-ending-punct", source: "A $x!$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "math-starting-digit", source: "A $2x$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "open-followed-by-newline-double", source: "A $$\nx$$ d.", math: ["forgejo"] },
  { name: "crlf-inside", source: "A $x +\r\ny$ d.", math: ["github"] },
  { name: "two-lines-two-maths", source: "A $x$\n$y$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "close-then-open-no-space", source: "A $x$$ d.", math: ["github", "gitea"] },
  { name: "code-span-dollars", source: "A `$x$` d.", math: [] },
  {
    name: "autolink-before",
    source: "A <https://e.com>$x$ d.",
    math: ["github", "forgejo", "gitea"],
  },
  { name: "image-alt", source: "A ![$x$](u) d.", math: [] },
  { name: "fail-then-third", source: "A $a$b$ d.", math: [] },
  { name: "fail-then-later", source: "A $5 x$y$ d.", math: [] },
  { name: "dollar-inside-escaped", source: "A $a \\$ b$ d.", math: ["forgejo", "gitea"] },
  { name: "close-followed-by-star", source: "A $x$* d.", math: ["github"] },
  { name: "close-followed-by-paren", source: "A $x$) d.", math: ["github", "forgejo", "gitea"] },
  { name: "close-followed-by-quote", source: 'A $x$" d.', math: ["github"] },
  { name: "close-followed-by-colon", source: "A $x$: d.", math: ["github", "forgejo", "gitea"] },
  {
    name: "close-followed-by-semicolon",
    source: "A $x$; d.",
    math: ["github", "forgejo", "gitea"],
  },
  { name: "close-followed-by-bang", source: "A $x$! d.", math: ["github", "forgejo", "gitea"] },
  { name: "close-followed-by-question", source: "A $x$? d.", math: ["github", "forgejo", "gitea"] },
  { name: "close-followed-by-bracket", source: "A $x$] d.", math: ["github"] },
  { name: "close-followed-by-brace", source: "A $x$} d.", math: ["github"] },
  { name: "close-followed-by-apostrophe", source: "A $x$'s d.", math: ["github"] },
  { name: "close-followed-by-percent", source: "A $x$% d.", math: ["github"] },
  { name: "close-followed-by-tilde", source: "A $x$~ d.", math: ["github"] },
  { name: "close-followed-by-pipe", source: "A $x$| d.", math: ["github"] },
  { name: "close-followed-by-lt", source: "A $x$< d.", math: ["github"] },
  { name: "close-followed-by-eol", source: "A $x$\nd.", math: ["github", "forgejo", "gitea"] },
  { name: "open-preceded-by-colon", source: "A :$x$ d.", math: [] },
  { name: "open-preceded-by-eq", source: "A =$x$ d.", math: ["forgejo", "gitea"] },
  { name: "open-preceded-by-slash", source: "A /$x$ d.", math: ["forgejo", "gitea"] },
  { name: "open-preceded-by-star", source: "A *$x$ d.", math: ["forgejo", "gitea"] },
  { name: "open-preceded-by-brace", source: "A {$x$ d.", math: ["forgejo", "gitea"] },
  { name: "open-preceded-by-gt", source: "A >$x$ d.", math: ["forgejo", "gitea"] },
  { name: "open-preceded-by-apostrophe", source: "A '$x$ d.", math: ["forgejo", "gitea"] },
  { name: "open-preceded-by-comma", source: "A ,$x$ d.", math: [] },
  { name: "open-preceded-by-dot", source: "A .$x$ d.", math: [] },
  { name: "open-preceded-by-cjk", source: "A 中$x$ d.", math: ["forgejo", "gitea"] },
  { name: "tab-inside", source: "A $x\ty$ d.", math: ["github", "forgejo", "gitea"] },
  { name: "only-spaces", source: "A $ $ d.", math: ["forgejo", "gitea"] },
  { name: "empty", source: "A $$ d.", math: ["forgejo"] },
  { name: "double-then-single", source: "A $$x$ d.", math: ["forgejo", "gitea"] },
  { name: "double-fail-after", source: "A $$x$$5 d.", math: ["gitea"] },
  { name: "in-heading", source: "## H $x$ here", math: ["github", "forgejo", "gitea"] },
  { name: "multi-dollar-currency", source: "Pay $5, then $6, then $7 more.", math: [] },
  {
    name: "mixed",
    source: "It costs $5 but $x$ is math and $6 is not.",
    math: ["github", "forgejo", "gitea"],
  },
  // A tab next to a dollar, observed on GitHub alone.
  { name: "tab-after-open", source: "A $\tx$ d.", math: [], observed: ["github"] },
  { name: "tab-before-close", source: "A $x\t$ d.", math: ["github"], observed: ["github"] },
  { name: "tab-both", source: "A $\tx\t$ d.", math: [], observed: ["github"] },
];

/**
 * What Obsidian showed as a formula for dollar signs in running text, observed
 * by the repository owner on 2026-10-06 and reported with screenshots in issue
 * 162. Each case was one item of a numbered list in a note. `reading` and `live`
 * hold the source of each formula that Reading view and Live Preview showed.
 * The two views differ twice: on which dollar opens the formula when an earlier
 * one cannot be closed, and on a formula that runs over a line break. Doubled
 * dollars inside a line were shown as a block in both views.
 */
export interface ObsidianMathCase {
  line: number;
  source: string;
  reading: string[];
  live: string[];
}
export const obsidianMathCases: ObsidianMathCase[] = [
  { line: 1, source: "A $x$ d.", reading: ["$x$"], live: ["$x$"] },
  { line: 2, source: "A $ x$ d.", reading: [], live: [] },
  { line: 3, source: "A $x $ d.", reading: [], live: [] },
  { line: 4, source: "A $ x $ d.", reading: [], live: [] },
  { line: 5, source: "A $x$5 d.", reading: [], live: [] },
  { line: 6, source: "A $x$a d.", reading: ["$x$"], live: ["$x$"] },
  { line: 7, source: "A a$x$ d.", reading: ["$x$"], live: ["$x$"] },
  { line: 8, source: "A 5$x$ d.", reading: ["$x$"], live: ["$x$"] },
  { line: 9, source: "A ($x$) d.", reading: ["$x$"], live: ["$x$"] },
  { line: 10, source: 'A "$x$" d.', reading: ["$x$"], live: ["$x$"] },
  { line: 11, source: "Costs $5 and $6 d.", reading: [], live: [] },
  { line: 12, source: "Costs $5 *per* item and $6 *per* box.", reading: [], live: [] },
  { line: 13, source: "From $5 to 10$ d.", reading: ["$5 to 10$"], live: ["$5 to 10$"] },
  { line: 14, source: "Costs 5$ and 10$ d.", reading: [], live: [] },
  { line: 15, source: "A $5 and $x$ d.", reading: ["$5 and $x$"], live: ["$x$"] },
  { line: 16, source: "A $a *b* c$ d.", reading: ["$a *b* c$"], live: ["$a *b* c$"] },
  { line: 17, source: "A $a \\$ b$ d.", reading: ["$a \\$ b$"], live: ["$a \\$ b$"] },
  { line: 18, source: "A \\$x$ d.", reading: [], live: [] },
  { line: 19, source: "A $$x$$ d.", reading: ["$$x$$"], live: ["$$x$$"] },
  { line: 20, source: "A $$ x $$ d.", reading: ["$$ x $$"], live: ["$$ x $$"] },
  { line: 21, source: "A $x$$ d.", reading: ["$x$"], live: ["$x$"] },
  { line: 22, source: "A $x +\ny$ d.", reading: ["$x +\ny$"], live: [] },
];
