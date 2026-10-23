# Benchmarks

`npm run benchmark`, in a checkout of the repository, times the tool on
synthetic documents. This page explains what is measured, records reference
results, and says how good they are.

The figures below precede the unreleased internal parser adapter. They remain
reference measurements for that earlier implementation; the adapter's focused
regression checks establish repaired work growth without replacing these
throughput or memory measurements.

## In short

- **Checking a whole workspace takes seconds.** From the command line, 500 pages
  of documentation (1.4 MB) are linted in about 2.1 s and checked for formatting
  in about 2.4 s, fast enough for CI or a check before every push.
- **A single file is mostly start-up.** Every command needs about 0.17 s before
  it reads a document, nearly all of it Node.js loading the tool's code. Pass
  many files to one command rather than running one command per file.
- **Formatting is in the same range as Prettier.** Rewriting files takes about
  1.8 times as long as Prettier, and checking formatted files slightly less,
  although this tool also checks links and parses every changed document again
  to confirm its meaning.
- **Cost grows in step with size.** Sixteen times as many files take about
  sixteen times as long, and a document of a megabyte costs about two thirds
  more per kilobyte than a short one.
- **Where it is weak.** The tool uses one CPU core and remembers nothing between
  runs, so formatting several thousand files takes tens of seconds every time.
  Memory grows with the workspace, though more slowly than the number of files:
  linting peaks near 170 MB for 126 pages and near 425 MB for 2,000. While one
  document is parsed, it needs about 70 times its size for prose and about 130
  times for a long list of links.

## What is measured

The documents are generated, so the same command produces the same bytes on
every machine, and nothing private is involved:

- **Repository documentation** for the GitHub dialect: pages of about 2.7 kB
  with prose, lists, a table, a code block, an alert, and links to headings on
  other pages.
- **An Obsidian vault**: notes of about 1.2 kB with wikilinks, an embed, a
  callout, a task list, and a block reference.

Every generated file needs formatting: long prose lines, the emphasis markers
that the default rules replace, and unaligned tables. That is the worst case;
formatting the result again is the best case, and both are measured. Each time
is the median of five runs after one untimed warm-up run. The library
measurements call the package and touch no files; the command-line measurements
start `mdtools` as a process on files on disk, so they include start-up, finding
and reading files, and printing.

## Reference results

- Node.js v24.21.0 on Linux x64; AMD EPYC 9V45 96-Core Processor, 4 logical
  CPUs.
- Each time is the median of 5 runs after one warm-up run.
- Prettier 3.9.10 is the comparison formatter.
- Output hash: `aea576e325adf396`.

These results come from the repository's Benchmark workflow on a GitHub-hosted
runner with four CPU cores, of which the tool uses one. Read them as an order of
magnitude and as ratios between rows, not as a promise for another machine.

### Library: repository documentation

501 files, 1.36 MB.

| Step                                       | Time   | Fastest to slowest run | Per file | Per second | Compared with parsing |
| ------------------------------------------ | ------ | ---------------------- | -------- | ---------- | --------------------- |
| Parse only                                 | 595 ms | 583 ms to 622 ms       | 1.19 ms  | 2.28 MB    | 1.0×                  |
| Lint                                       | 1.44 s | 1.43 s to 1.48 s       | 2.87 ms  | 0.94 MB    | 2.4×                  |
| Format, every file needs changes           | 3.40 s | 3.31 s to 3.42 s       | 6.79 ms  | 0.40 MB    | 5.7×                  |
| Format, every file already formatted       | 1.78 s | 1.72 s to 1.83 s       | 3.54 ms  | 0.86 MB    | 3.0×                  |
| Prettier on the same files, for comparison | 1.90 s | 1.85 s to 1.97 s       | 3.79 ms  | 0.72 MB    | 3.2×                  |

- **Parse only** turns each file into a syntax tree. No rule can run without it,
  so it is the floor for the other rows.
- **Lint** runs every enabled rule and checks every link, which includes reading
  the headings of each linked page.
- **Format, every file needs changes** is the worst case. After each formatting
  phase that changes a document, the tool parses the result again and compares
  its meaning with the original, which is why this row costs several times the
  floor.
- **Format, every file already formatted** is the usual case, and what
  `format --check` costs in CI: nothing changes, so nothing needs to be verified
  again.
- **Prettier on the same files** formats each file with Prettier's Markdown
  formatter at the same width, to give the numbers a familiar scale.

### Library: Obsidian vault

500 files, 0.62 MB.

| Step                                 | Time   | Fastest to slowest run | Per file | Per second | Compared with parsing |
| ------------------------------------ | ------ | ---------------------- | -------- | ---------- | --------------------- |
| Parse only                           | 278 ms | 266 ms to 281 ms       | 0.56 ms  | 2.22 MB    | 1.0×                  |
| Lint                                 | 702 ms | 681 ms to 740 ms       | 1.40 ms  | 0.88 MB    | 2.5×                  |
| Format, every file needs changes     | 1.75 s | 1.71 s to 1.85 s       | 3.50 ms  | 0.35 MB    | 6.3×                  |
| Format, every file already formatted | 793 ms | 771 ms to 820 ms       | 1.59 ms  | 0.78 MB    | 2.9×                  |

The notes are less than half the size of the documentation pages, so each file
is cheaper while the cost per megabyte is similar.

### Command line

The repository documentation above, as 501 files on disk.

| Command                                        | Time   | Fastest to slowest run | Peak memory |
| ---------------------------------------------- | ------ | ---------------------- | ----------- |
| Start Node.js and exit, for comparison         | 22 ms  | 20 ms to 23 ms         | 51.7 MB     |
| Start the CLI and print its version            | 165 ms | 161 ms to 166 ms       | 84.4 MB     |
| Lint the workspace                             | 2.11 s | 2.06 s to 2.18 s       | 270.5 MB    |
| Lint one file of the workspace                 | 238 ms | 234 ms to 240 ms       | 101.6 MB    |
| Format and write, every file needs changes     | 4.53 s | 4.45 s to 4.68 s       | 377.1 MB    |
| Check formatting, every file already formatted | 2.43 s | 2.39 s to 2.48 s       | 359.4 MB    |

The difference between the first two rows, loading the tool, is paid by every
command. Linting one file shows that unselected files cost almost nothing: they
are listed so that links can be checked, and read only when a link points at
them. The whole-workspace rows are close to the library rows plus start-up. Peak
memory includes Node.js itself.

### More files

The middle row repeats the measurements above. The times in the other rows are
the median of 3 runs without a warm-up run.

| Files | Size    | Lint   | Lint per file | Format with changes | Format per file | Peak memory of a command-line lint |
| ----- | ------- | ------ | ------------- | ------------------- | --------------- | ---------------------------------- |
| 126   | 0.34 MB | 380 ms | 3.02 ms       | 884 ms              | 7.02 ms         | 172.0 MB                           |
| 501   | 1.36 MB | 1.44 s | 2.87 ms       | 3.40 s              | 6.79 ms         | 270.5 MB                           |
| 2,001 | 5.44 MB | 5.94 s | 2.97 ms       | 14.70 s             | 7.35 ms         | 426.8 MB                           |

The per-file columns stay level, so the time for a larger workspace can be
estimated by multiplying. Memory grows far more slowly: sixteen times as many
files take about 2.5 times the memory, including about 85 MB that the tool needs
before it reads a document. Until a run finishes, the tool keeps every file's
text and diagnostics, and the anchors of every document that a link points into;
in the Obsidian dialect also about 70 bytes per file of the workspace,
attachments included, for finding notes by name. The figure depends on when
Node.js reclaims memory, so it is an upper bound.

### Larger documents

| Document size | Format with changes | Per kilobyte |
| ------------- | ------------------- | ------------ |
| 17 kB         | 29 ms               | 1.76 ms      |
| 129 kB        | 315 ms              | 2.44 ms      |
| 1,024 kB      | 3.04 s              | 2.97 ms      |

The cost per kilobyte rises by about two thirds from a short document to one of
a megabyte, far larger than documents usually are. Earlier reference results, on
another processor, showed a rise of two fifths and of a quarter, so the size of
the rise depends on the runner. The investigation also found a dependency
regression: micromark 4.0.3 repeatedly copies its accumulated document events at
list/table transitions. With many repetitions in one file, doubling the input
approaches four times the parsing work. A standalone parser reproduction gives
the same HTML as 4.0.2 while showing that growth; the issue records the version
matrix, profiling, and reproduction ([issue
#300](https://github.com/viell-dev/slop-markdown-tools/issues/300)).

Both linting and formatting parse the whole document, so either is affected in
the measured implementation. Unreleased builds bundle a reviewed EditMap
correction that retains the untouched event prefix instead of copying it at
every transition. They still parse complete documents for references and
container structure. Exact AST, event-identity and work-growth checks cover the
correction; the tables above have not been remeasured with it.

While a document is parsed, the parser holds a list of every token it found,
many times larger than the text. These are the smallest heap limits
(`--max-old-space-size`) under which one generated document could be parsed,
found in steps of 8 MB; they depend on the document, not on the processor:

| Document                                        | Size   | Heap needed to parse |
| ----------------------------------------------- | ------ | -------------------- |
| Documentation prose                             | 0.4 MB | 39 MB                |
| The same                                        | 1.0 MB | 79 MB                |
| The same                                        | 2.0 MB | 142 MB               |
| An index note: 13,400 list items, each one link | 2.2 MB | 291 MB               |

For the index note, the token list alone holds 240 MB, and the syntax tree that
the tool keeps afterwards 40 MB. No rule or setting changes this. Each document
is parsed by itself, so a run needs the memory of its largest document, not the
sum; Node.js allows a few gigabytes by default.

## Is it any good?

| Situation                               | Reference result                                                                | Verdict                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A hook or an agent lints one file       | 0.24 s, most of it start-up                                                     | Fine, but not instant. Batch files into one command.                                               |
| CI lints and checks 500 pages           | 2.1 s and 2.4 s                                                                 | Good. Shorter than installing the dependencies.                                                    |
| Formatting 500 pages for the first time | 4.5 s                                                                           | Good for a one-time job.                                                                           |
| A workspace of 2,000 pages              | About 6 s to lint, 15 s to format everything                                    | Acceptable. Seconds to tens of seconds, on one core, every time.                                   |
| Compared with Prettier                  | 1.8 times its time when rewriting, slightly less than its time when checking    | Comparable, while also validating links and meaning.                                               |
| Memory                                  | About 270 MB to lint and 375 MB to format 500 pages; about 425 MB to lint 2,000 | Fine at these sizes. At this rate, tens of thousands of files could still need a gigabyte or more. |

The design accepts some slowness on purpose: parsing every changed document
again is what lets the tool refuse an edit that would change a document's
meaning. The real limits are start-up time, memory, and the lack of reuse
between runs, which would matter for an editor or for workspaces of tens of
thousands of files.

## Limits of these numbers

- The documents are synthetic. A document with many links to check or many long
  tables costs more per kilobyte.
- The synthetic workspaces are small. On a large real-world vault of several
  thousand notes, about 40 MB of Markdown, the throughput per megabyte matched
  within about 15% on the same machine. That run peaked at about 1.2 GB of
  memory and spent a few seconds finding files, because the vault also held well
  over 100,000 other files; finding files costs about a third of a second per
  100,000 files in a simple tree.
- One paragraph is not one document. A single paragraph of 100 kB or more that
  is full of inline code, links, or emphasis is parsed much more slowly than its
  size suggests: doubling one from 96 kB to 192 kB tripled the time, about
  twenty times as long as the same text read as CommonMark. The cause is in the
  parser, and GitHub's literal autolinks, which every dialect but CommonMark
  reads, bring it out. Lists and tables of that size are not affected. Square
  brackets are the worst case, in every dialect: a single paragraph of 70 kB
  made only of bracketed references such as `[a][b]` took from 1 to more than 30
  seconds to parse, while one of 35 kB took a fraction of a second ([issue
  #240](https://github.com/viell-dev/slop-markdown-tools/issues/240)).
  Unreleased builds correct the known repeated text/code event compaction,
  inline opener searches and unbalanced-label autolink scans. Syntax plugins
  retain the original attention/strikethrough resolvers for event compatibility,
  so that part of the former cost can remain with a syntax plugin. These
  corrections cover repeated reference pairs and the measured inline families,
  not every possible large paragraph. Deeply nested bracket labels and emphasis
  remain separate work in
  [#94](https://github.com/viell-dev/slop-markdown-tools/issues/94).
- Only the built-in rules run; plugins add their own time.
- The runner is shared. Two runs on the same day differed by a factor of about
  1.8 in every absolute time, while the "compared with parsing" ratios and the
  comparison with Prettier stayed within a tenth. Compare absolute times only
  between reports whose header names the same processor.
- Only Linux is measured. Starting a process is slower on Windows, which adds to
  every command-line row.
- The Prettier comparison uses its default Markdown settings with
  `proseWrap: "always"` at 80 columns, through its API.

## Run it and compare

```sh
npm run benchmark              # a Markdown report like the tables above
npm run benchmark -- --json    # the same measurements as JSON
npm run benchmark -- --quick   # tiny inputs, to check that it runs
```

A full run takes a few minutes; run it on a machine that is doing nothing else.
To judge a change, run it before and after on the same machine:

- A step's time should not grow by more than the spread in the "fastest to
  slowest run" column.
- The "compared with parsing" column should not grow. It depends little on the
  machine, so it can also be compared with the tables above.
- The per-file columns of "More files" should stay level, and the per-kilobyte
  column of "Larger documents" should not rise more steeply than above.
- The output hash identifies the formatted output: it stays the same unless the
  change is meant to alter what the formatter produces.

The benchmark never fails on a slow result, because a shared machine's speed
varies too much for a limit to be reliable.
