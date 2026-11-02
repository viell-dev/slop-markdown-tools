# Benchmark notes

The [benchmarks](../docs/benchmarks.md) page records the reference results and
what they mean for users. This page records the parser work behind its limits.

## Larger documents

The investigation of the cost per kilobyte also found a dependency regression:
micromark 4.0.3 repeatedly copies its accumulated document events at list/table
transitions. With many repetitions in one file, doubling the input approaches
four times the parsing work. A standalone parser reproduction gives the same
HTML as 4.0.2 while showing that growth; the issue records the version matrix,
profiling, and reproduction ([issue
#300](https://github.com/viell-dev/slop-markdown-tools/issues/300)).

Both linting and formatting parse the whole document, so either is affected in
the measured implementation. The parser adapter includes a reviewed EditMap
correction that retains the untouched event prefix instead of copying it at
every transition. They still parse complete documents for references and
container structure. Exact AST, event-identity and work-growth checks cover the
correction; the benchmark page's tables have not been measured again with it.

## Lazy list paragraphs

Micromark 4.0.3 searches accumulated flow events backward after every lazy
continuation line. A long list paragraph repeatedly finds the same open token
near the beginning, so its searches approach quadratic work
([#796](https://github.com/viell-dev/slop-markdown-tools/issues/796)). The
adapter keeps a private positive witness by event array. Its index must still
contain the same token, and the token's current bounds must still span the line;
replacement, reordering or closing falls back to the upstream search. It does
not cache absence or add token fields. Positioned trees, event observations,
stale witnesses, deterministic work and the compiled runtime are checked. This
correction does not bound arbitrary parser work or deeply nested containers.

## Deeply nested lists

Deep list nesting has a separate cost
([#859](https://github.com/viell-dev/slop-markdown-tools/issues/859)). At each
open list, micromark checks whether the remaining line is blank and scans its
indentation again. The tree compiler also traverses and rebuilds descendant
event slices for each enclosing list. Both perform cubic work in nesting depth
on a list that adds one level per line; that fixture's byte size is quadratic in
depth. The same cost reproduces in stock upstream. The lazy-line correction
above does not address these traversals, and no general parser CPU or nesting
bound is promised. The issue retains matched-size controls, exact trees,
profiling and deterministic work counts for a future correction.

## Large paragraphs

A single paragraph of 70 kB made only of bracketed references such as `[a][b]`
took from 1 to more than 30 seconds to parse, while one of 35 kB took a fraction
of a second ([issue
#240](https://github.com/viell-dev/slop-markdown-tools/issues/240)). The parser
adapter corrects the known repeated text/code event compaction, inline opener
searches and unbalanced-label autolink scans. Builtin grammars also avoid
repeated lookups and scans for proven nested bracket labels and batch eligible
single pairs of homogeneous emphasis runs
([#94](https://github.com/viell-dev/slop-markdown-tools/issues/94)). Failed
Obsidian wikilink and embed openers reuse the scanned part of their line
([#577](https://github.com/viell-dev/slop-markdown-tools/issues/577)). Mixed or
multiple raw emphasis pairs can still copy their interiors repeatedly. Syntax
plugins retain the original attention, strikethrough and CJK resolvers and
nonempty reference/footnote paths, with their costs; the shared EditMap,
text/code compaction, position and autolink repairs still apply. These
corrections cover the checked families, not every possible large paragraph; they
do not replace the benchmark page's throughput or memory measurements.
