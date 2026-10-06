# Benchmarks

`npm run benchmark` times the tool on synthetic documents. This page explains
what is measured, records reference results, and says how good they are.

## In short

- **Checking a whole workspace takes seconds.** From the command line, 500 pages
  of documentation (1.4 MB) are linted in about 2.9 s and checked for formatting
  in about 3.2 s. That is fast enough for a CI job or a check before every push.
- **A single file is mostly start-up.** Every command needs about 0.25 s before
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
  kilobyte than a small one, about a quarter more at a megabyte, but nothing
  becomes disproportionately slow.
- **Where it is weak.** The tool uses one CPU core and remembers nothing between
  runs, so every run repeats all the work, and formatting several thousand files
  takes tens of seconds. Its start-up is slow beside the 26 ms that Node.js
  itself needs. Memory grows with the workspace, though more slowly than the
  number of files: linting peaks near 165 MB for 126 pages and near 400 MB for
  2,000. One very large document needs a multiple of its own size while it is
  parsed: about 70 times for prose and about 130 times for a long list of links.

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
| Parse only                                 | 1.01 s | 1.00 s to 1.04 s       | 2.02 ms  | 1.34 MB    | 1.0×                  |
| Lint                                       | 2.10 s | 2.09 s to 2.14 s       | 4.19 ms  | 0.65 MB    | 2.1×                  |
| Format, every file needs changes           | 4.83 s | 4.81 s to 4.88 s       | 9.63 ms  | 0.28 MB    | 4.8×                  |
| Format, every file already formatted       | 2.56 s | 2.52 s to 2.58 s       | 5.11 ms  | 0.60 MB    | 2.5×                  |
| Prettier on the same files, for comparison | 3.04 s | 3.01 s to 3.07 s       | 6.06 ms  | 0.45 MB    | 3.0×                  |

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
| Parse only                           | 479 ms | 475 ms to 503 ms       | 0.96 ms  | 1.29 MB    | 1.0×                  |
| Lint                                 | 1.04 s | 1.02 s to 1.05 s       | 2.07 ms  | 0.59 MB    | 2.2×                  |
| Format, every file needs changes     | 2.63 s | 2.61 s to 2.66 s       | 5.26 ms  | 0.23 MB    | 5.5×                  |
| Format, every file already formatted | 1.16 s | 1.15 s to 1.17 s       | 2.31 ms  | 0.54 MB    | 2.4×                  |

The vault's notes are less than half the size of the documentation pages, so
each file is cheaper while the cost per megabyte is similar. The same pattern
holds: linting costs about twice the parsing floor, formatting already formatted
notes a little more, and rewriting every note about five times.

### Command line

The repository documentation above, as 501 files on disk.

| Command                                        | Time   | Fastest to slowest run | Peak memory |
| ---------------------------------------------- | ------ | ---------------------- | ----------- |
| Start Node.js and exit, for comparison         | 26 ms  | 24 ms to 27 ms         | 51.6 MB     |
| Start the CLI and print its version            | 249 ms | 248 ms to 259 ms       | 84.4 MB     |
| Lint the workspace                             | 2.91 s | 2.76 s to 2.93 s       | 259.4 MB    |
| Lint one file of the workspace                 | 342 ms | 335 ms to 347 ms       | 94.3 MB     |
| Format and write, every file needs changes     | 6.30 s | 6.20 s to 6.33 s       | 345.8 MB    |
| Check formatting, every file already formatted | 3.23 s | 3.20 s to 3.32 s       | 342.5 MB    |

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
| 126   | 0.34 MB | 533 ms | 4.23 ms       | 1.23 s              | 9.73 ms         | 163.8 MB                           |
| 501   | 1.36 MB | 2.10 s | 4.19 ms       | 4.83 s              | 9.63 ms         | 259.4 MB                           |
| 2,001 | 5.44 MB | 8.51 s | 4.25 ms       | 19.66 s             | 9.82 ms         | 402.0 MB                           |

If the tool slowed down as a workspace grows, the per-file columns would rise
from row to row. They stay level, so the time for a larger workspace can be
estimated by multiplying.

Memory is different. The last column is the most memory a `mdtools lint` process
held for a workspace of that size, including the roughly 85 MB that the tool
needs before it reads a document. It grows with the workspace, though far more
slowly than the number of files: sixteen times as many files take about 2.5
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
| 17 kB         | 41 ms               | 2.42 ms      |
| 129 kB        | 377 ms              | 2.93 ms      |
| 1,024 kB      | 3.09 s              | 3.02 ms      |

The same check for one document instead of many files. The cost per kilobyte
rises by about a quarter from a short document to one of a megabyte, which is
far larger than documents usually are. The growth is mild, but it is growth: a
very large document is slower than its size alone suggests.

Memory for one document is a different matter. While a document is parsed, the
parser holds a list of every token it found, and that list is many times larger
than the text. These figures are the smallest heap limit
(`--max-old-space-size`) under which one generated document could be parsed,
found by trying limits 8 MB apart on one machine. They depend on the document,
not on the processor:

| Document                                        | Size   | Heap needed to parse |
| ----------------------------------------------- | ------ | -------------------- |
| Documentation prose                             | 0.4 MB | 39 MB                |
| The same                                        | 1.0 MB | 79 MB                |
| The same                                        | 2.0 MB | 142 MB               |
| An index note: 13,400 list items, each one link | 2.2 MB | 291 MB               |

That is about 70 times the size of prose and about 130 times the size of the
index note. For the index note, the parser's token list alone holds 240 MB once
it is complete, about 18 kB for each list item; the syntax tree that the tool
keeps afterwards is 40 MB. The list belongs to the parser the tool builds on,
and no rule or setting changes it. Each document is parsed by itself and its
token list is released before the next one, so a run needs the memory of its
largest document, not the sum. Node.js allows a few gigabytes by default, which
is enough for documents of several megabytes; under a tighter limit, such as
`--max-old-space-size=256`, a document like the index note is what fails.

## Is it any good?

| Situation                               | Reference result                                                                | Verdict                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A hook or an agent lints one file       | 0.34 s, most of it start-up                                                     | Fine, but not instant. Batch files into one command.                                               |
| CI lints and checks 500 pages           | 2.9 s and 3.2 s                                                                 | Good. Shorter than installing the dependencies.                                                    |
| Formatting 500 pages for the first time | 6.3 s                                                                           | Good for a one-time job.                                                                           |
| A workspace of 2,000 pages              | About 8.5 s to lint, 20 s to format everything                                  | Acceptable. Tens of seconds, on one core, every time.                                              |
| Compared with Prettier                  | 1.6 times its time when rewriting, slightly less than its time when checking    | Comparable, while also validating links and meaning.                                               |
| Memory                                  | About 260 MB to lint and 350 MB to format 500 pages; about 400 MB to lint 2,000 | Fine at these sizes. At this rate, tens of thousands of files could still need a gigabyte or more. |

The design accepts some slowness on purpose. Parsing every changed document
again is what lets the tool refuse an edit that would alter a document's
meaning, and that guarantee matters more to this project than speed. The real
limits are start-up time, memory, and the lack of any reuse between runs. None
is a problem at the sizes measured here; they would be the place to start if the
tool had to serve an editor, or workspaces of tens of thousands of files.
Start-up time was examined in
[issue 116](https://github.com/viell-dev/slop-markdown-tools/issues/116), which
declined packing the tool into one file for a gain of about 75 ms. Dropping a
dependency that the tool never used has since taken 15 to 20 ms off it
([issue 140](https://github.com/viell-dev/slop-markdown-tools/issues/140)). The
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
  files: a generated index note of 2.2 MB, a list of 13,400 links, needs about
  290 MB to parse. In a simple tree, finding files costs about a third of a
  second per 100,000 files.
- One paragraph is not one document. The times above grow in step with size
  because long documents are made of many paragraphs, and each is parsed by
  itself. A single paragraph of 100 kB or more that is full of inline code,
  links, or emphasis takes much longer than its size suggests: measured once,
  doubling such a paragraph from 96 kB to 192 kB tripled the time, and it took
  about twenty times as long as the same text read as CommonMark. The cause is
  in the parser, which merges the pieces of text between the inline constructs
  one by one, and it shows with GitHub's literal autolinks, which every dialect
  but CommonMark includes. A list or a table of that size is not affected.
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
