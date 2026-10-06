# Benchmarks

`npm run benchmark` times the tool on synthetic documents. This page explains
what is measured, records reference results, and says how good they are.

## In short

- **Checking a whole workspace takes seconds.** From the command line, 500 pages
  of documentation (1.4 MB) are linted in about 3.0 s and checked for formatting
  in about 3.3 s. That is fast enough for a CI job or a check before every push.
- **A single file is mostly start-up.** Every command needs about 0.27 s before
  it reads a document, nearly all of it Node.js loading the tool's code. Linting
  one file of a 500-file workspace costs little more than that. Pass many files
  to one command rather than running one command per file.
- **Formatting is in the same range as Prettier.** Rewriting files takes
  about 1.6 times as long as Prettier needs for the same files, and checking
  files that are already formatted takes slightly less time than Prettier does.
  The two do different work: this tool also validates links, and re-reads every
  document it changed to confirm that it still means the same.
- **Cost grows in step with size.** Sixteen times as many files take about
  sixteen times as long. One very large document costs somewhat more per
  kilobyte than a small one, about a third more at a megabyte, but nothing
  becomes disproportionately slow.
- **Where it is weak.** The tool uses one CPU core and remembers nothing between
  runs, so every run repeats all the work, and formatting several thousand files
  takes tens of seconds. Its start-up is slow beside the 28 ms that Node.js
  itself needs. Memory grows with the workspace, though more slowly than the
  number of files: linting peaks near 170 MB for 126 pages and near 410 MB for
  2,000.

## What is measured

The documents are generated, not collected: the same command produces the same
bytes on every machine, and nothing private is involved. There are two sets.

- **Repository documentation** for the GitHub profile: pages of about 2.7 kB
  with prose, lists, a table, a code block, an alert, and links to headings on
  other pages.
- **An Obsidian vault**: notes of about 1.2 kB with wikilinks, an embed, a
  callout, a task list, and a block reference.

Every generated file needs formatting: its prose is on long lines, its emphasis
uses the markers the default rules replace, and its tables are unaligned. That
is the worst case for a formatter. Formatting the result a second time is the
best case, and both are measured.

Each time is the median of five runs that follow one untimed warm-up run. The
library measurements call the package directly and touch no files. The
command-line measurements start `mdtools` as a separate process on files on
disk, so they include start-up, finding and reading files, and printing
diagnostics.

## Reference results

- Node.js v24.21.0 on Linux x64; AMD EPYC 7763 64-Core Processor, 4 logical
  CPUs.
- Each time is the median of 5 runs after one warm-up run.
- Prettier 3.9.9 is the comparison formatter.
- Output hash: `d99a546f0f09ad93`.

These results come from the repository's Benchmark workflow on a GitHub-hosted
runner with four CPU cores, of which the tool uses one. Read them as an order of
magnitude and as ratios between rows, not as a promise for another machine.

### Library: repository documentation

501 files, 1.36 MB.

| Step                                       | Time   | Fastest to slowest run | Per file | Per second | Compared with parsing |
| ------------------------------------------ | ------ | ---------------------- | -------- | ---------- | --------------------- |
| Parse only                                 | 1.07 s | 1.05 s to 1.11 s       | 2.14 ms  | 1.27 MB    | 1.0×                  |
| Lint                                       | 2.23 s | 2.20 s to 2.27 s       | 4.44 ms  | 0.61 MB    | 2.1×                  |
| Format, every file needs changes           | 5.11 s | 5.08 s to 5.15 s       | 10.20 ms | 0.27 MB    | 4.8×                  |
| Format, every file already formatted       | 2.70 s | 2.68 s to 2.74 s       | 5.39 ms  | 0.57 MB    | 2.5×                  |
| Prettier on the same files, for comparison | 3.11 s | 3.06 s to 3.16 s       | 6.20 ms  | 0.44 MB    | 2.9×                  |

- **Parse only** turns each file into a syntax tree and does nothing else. No
  rule can run without it, so it is the floor that the other rows are compared
  with.
- **Lint** runs every enabled rule and checks every link, which includes reading
  the headings of each linked page.
- **Format, every file needs changes** is the worst case. Formatting works in
  phases, and after each phase that changes a document the tool parses the
  result again and compares its meaning with the original. That safety check is
  why this row costs several times the parsing floor.
- **Format, every file already formatted** is the usual case, and what
  `format --check` costs in CI. Nothing changes, so nothing needs to be verified
  again.
- **Prettier on the same files** formats each file with Prettier's Markdown
  formatter at the same width. It is here to give the numbers a familiar scale.

### Library: Obsidian vault

500 files, 0.62 MB.

| Step                                 | Time   | Fastest to slowest run | Per file | Per second | Compared with parsing |
| ------------------------------------ | ------ | ---------------------- | -------- | ---------- | --------------------- |
| Parse only                           | 518 ms | 495 ms to 526 ms       | 1.04 ms  | 1.19 MB    | 1.0×                  |
| Lint                                 | 1.06 s | 1.06 s to 1.07 s       | 2.12 ms  | 0.58 MB    | 2.0×                  |
| Format, every file needs changes     | 2.79 s | 2.74 s to 2.82 s       | 5.58 ms  | 0.22 MB    | 5.4×                  |
| Format, every file already formatted | 1.24 s | 1.23 s to 1.28 s       | 2.49 ms  | 0.50 MB    | 2.4×                  |

The vault's notes are less than half the size of the documentation pages, so
each file is cheaper while the cost per megabyte is similar. The same pattern
holds: linting costs about twice the parsing floor, formatting already formatted
notes a little more, and rewriting every note about five times.

### Command line

The repository documentation above, as 501 files on disk.

| Command                                        | Time   | Fastest to slowest run | Peak memory |
| ---------------------------------------------- | ------ | ---------------------- | ----------- |
| Start Node.js and exit, for comparison         | 28 ms  | 27 ms to 30 ms         | 51.9 MB     |
| Start the CLI and print its version            | 272 ms | 264 ms to 274 ms       | 90.6 MB     |
| Lint the workspace                             | 2.96 s | 2.88 s to 3.10 s       | 278.5 MB    |
| Lint one file of the workspace                 | 351 ms | 349 ms to 354 ms       | 98.2 MB     |
| Format and write, every file needs changes     | 6.25 s | 6.22 s to 6.54 s       | 350.8 MB    |
| Check formatting, every file already formatted | 3.26 s | 3.25 s to 3.39 s       | 340.9 MB    |

- **Start Node.js and exit** is the cost of the runtime alone,
  and **start the CLI and print its version** adds loading the tool. The
  difference is paid by every command, however small its input.
- **Lint one file of the workspace** shows that the other files cost almost
  nothing when they are not selected: they are listed so that links can be
  checked, but only read when a link points at them.
- The whole-workspace rows are close to the library rows above plus start-up.
  Finding, reading, and writing files is a small part of the total.
- **Peak memory** is the most memory the process held, including Node.js itself.

### More files

The middle row repeats the measurements above. The times in the other rows are
the median of 3 runs without a warm-up run.

| Files | Size    | Lint   | Lint per file | Format with changes | Format per file | Peak memory of a command-line lint |
| ----- | ------- | ------ | ------------- | ------------------- | --------------- | ---------------------------------- |
| 126   | 0.34 MB | 576 ms | 4.57 ms       | 1.27 s              | 10.05 ms        | 172.5 MB                           |
| 501   | 1.36 MB | 2.23 s | 4.44 ms       | 5.11 s              | 10.20 ms        | 278.5 MB                           |
| 2,001 | 5.44 MB | 8.87 s | 4.43 ms       | 19.97 s             | 9.98 ms         | 408.0 MB                           |

If the tool slowed down as a workspace grows, the per-file columns would rise
from row to row. They stay level, so the time for a larger workspace can be
estimated by multiplying.

Memory is different. The last column is the most memory a `mdtools lint` process
held for a workspace of that size, including the roughly 90 MB that the tool
needs before it reads a document. It grows with the workspace, though far more
slowly than the number of files: sixteen times as many files take about 2.4
times the memory. Until a run finishes, the tool keeps every file's text and
diagnostics, and the anchors of every document that a link to a heading or block
points to. Versions up to `0.2.0-rc.1` also kept the parsed form of each of
those documents, and the previous reference run, made with that version, peaked
at 496 MB for the 2,001 files. The figure also depends on when Node.js reclaims
memory, so it is an upper bound on what the run needed, not an exact amount.

These rows use the GitHub profile. For the Obsidian dialect the tool also keeps
a table for finding a note by its name, with one entry for each file of the
workspace, attachments included: about 70 bytes per file. Versions up to
`0.2.0-rc.1` kept two tables that together held about 1.6 kB per file, 160 MB
for a vault with 100,000 attachments, once a link had been searched for by name.

### Larger documents

| Document size | Format with changes | Per kilobyte |
| ------------- | ------------------- | ------------ |
| 17 kB         | 43 ms               | 2.57 ms      |
| 129 kB        | 378 ms              | 2.94 ms      |
| 1,024 kB      | 3.54 s              | 3.46 ms      |

The same check for one document instead of many files. The cost per kilobyte
rises by about a third from a short document to one of a megabyte, which is far
larger than documents usually are. The growth is mild, but it is growth: a very
large document is slower than its size alone suggests.

## Is it any good?

| Situation                               | Reference result                                                                | Verdict                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A hook or an agent lints one file       | 0.35 s, most of it start-up                                                     | Fine, but not instant. Batch files into one command.                                               |
| CI lints and checks 500 pages           | 3.0 s and 3.3 s                                                                 | Good. Shorter than installing the dependencies.                                                    |
| Formatting 500 pages for the first time | 6.3 s                                                                           | Good for a one-time job.                                                                           |
| A workspace of 2,000 pages              | About 9 s to lint, 20 s to format everything                                    | Acceptable. Tens of seconds, on one core, every time.                                              |
| Compared with Prettier                  | 1.6 times its time when rewriting, slightly less than its time when checking    | Comparable, while also validating links and meaning.                                               |
| Memory                                  | About 280 MB to lint and 350 MB to format 500 pages; about 410 MB to lint 2,000 | Fine at these sizes. At this rate, tens of thousands of files could still need a gigabyte or more. |

The design accepts some slowness on purpose. Parsing every changed document
again is what lets the tool refuse an edit that would alter a document's
meaning, and that guarantee matters more to this project than speed. The real
limits are start-up time, memory, and the lack of any reuse between runs. None
is a problem at the sizes measured here; they would be the place to start if the
tool had to serve an editor, or workspaces of tens of thousands of files.
Start-up time is tracked as
[issue 116](https://github.com/viell-dev/slop-markdown-tools/issues/116). The
largest part of the memory that versions up to `0.2.0-rc.1` held was removed for
[issue 114](https://github.com/viell-dev/slop-markdown-tools/issues/114); what a
run still holds is every file's text and diagnostics.

## Limits of these numbers

- The documents are synthetic. Real documents have a different mix of syntax,
  and a document with many links to check or many long tables costs more per
  kilobyte.
- The synthetic workspaces are small. A check against a large real-world vault
  of several thousand notes, about 40 MB of Markdown, matched the synthetic
  throughput per megabyte within about 15% on the same machine, which supports
  estimating time by multiplying. It also showed what small sets cannot: peak
  memory of about 1.2 GB, half of what `0.2.0-rc.1` needed, and a few seconds
  spent finding files before the first document was read, because that workspace
  also held well over 100,000 files that are not Markdown. How much heap such a
  run needs at the least is set by its largest document, not by the number of
  files: a generated index note of 2.3 MB, a list of 13,400 links, takes about
  250 MB to parse. In a simple tree, finding files costs about a third of a
  second per 100,000 files.
- Only the built-in rules run. Plugins add their own time.
- The runner is shared. GitHub assigns runs to machines with different
  processors: two runs of this benchmark on the same day differed by a factor of
  about 1.8 in every absolute time, while the "compared with parsing" ratios and
  the comparison with Prettier stayed within a tenth. Compare absolute times
  only between reports whose header names the same processor.
- Only Linux is measured. Starting a process is slower on Windows, which adds to
  every command-line row.
- The Prettier comparison uses its default Markdown settings with
  `proseWrap: "always"` at 80 columns, through its API. It says nothing about
  Prettier's command line or other configurations.

## Run it and compare

```sh
npm run benchmark              # a Markdown report like the tables above
npm run benchmark -- --json    # the same measurements as JSON
npm run benchmark -- --quick   # tiny inputs, to check that it runs
```

A full run takes a few minutes. Run it on a machine that is doing nothing else.

To judge a change, run the benchmark before and after it on the same machine,
and compare like with like:

- A step's time should not grow by more than run-to-run variation, which the
  "fastest to slowest run" column shows.
- The "compared with parsing" column should not grow. It depends little on the
  machine's speed, so it can also be compared with the tables above.
- The per-file columns of the "More files" table should stay level from row to
  row, and the per-kilobyte column of the last table should not rise more
  steeply than it does above. A steeper rise means the change made something
  more than proportionally slower.
- The output hash in the report's header identifies the formatted output. It
  stays the same when a change does not alter what the formatter produces, and
  it must change when the change is meant to.

The Benchmark workflow runs the same command on a GitHub-hosted runner, for pull
requests that change the benchmark and on request. Its report replaces the
tables on this page when they are updated, so that the published results come
from a machine anyone can use and not from one contributor's computer. Because
runners differ in speed, a new report's absolute times can differ from the old
one's without any change in the tool; judge by the ratios, or by
before-and-after runs on one machine.

The benchmark never fails on a slow result, because a shared machine's speed
varies too much for a limit to be reliable. A few [unit tests](testing.md#speed)
separately guard against algorithms whose cost grows faster than their input.
