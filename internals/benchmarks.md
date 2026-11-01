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
