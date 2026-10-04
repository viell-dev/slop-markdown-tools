# Benchmarks

`npm run benchmark` times the tool on synthetic documents. This page explains
what is measured, records reference results, and says how good they are.

## In short

- **Checking a whole workspace takes seconds.** From the command line, 500 pages
  of documentation (1.4 MB) are linted in about 2.0 s and checked for formatting
  in about 2.3 s. That is fast enough for a CI job or a check before every push.
- **A single file is mostly start-up.** Every command needs about 0.16 s before
  it reads a document, nearly all of it Node.js loading the tool's code. Linting
  one file of a 500-file workspace costs little more than that. Pass many files
  to one command rather than running one command per file.
- **Formatting is in the same range as Prettier.** Rewriting files takes
  about 1.6 times as long as Prettier needs for the same files, and checking
  files that are already formatted takes about 0.85 times as long. The two do
  different work: this tool also validates links, and re-reads every document it
  changed to confirm that it still means the same.
- **Cost grows in a straight line.** Sixteen times as many files take about
  sixteen times as long, and a document 64 times as large takes about 70 times
  as long. Nothing becomes disproportionately slow as a workspace grows.
- **Where it is weak.** The tool uses one CPU core and remembers nothing between
  runs, so every run repeats all the work, and formatting several thousand files
  takes tens of seconds. Its start-up is slow beside the 18 ms that Node.js
  itself needs. Memory grows with the workspace, by roughly 110 MB for every
  1,000 pages linted.

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

- Node.js v22.23.3 on Linux x64.
- Each time is the median of 5 runs after one warm-up run.
- Prettier 3.9.9 is the comparison formatter.
- Output hash: `a80fe70718abb2ab`.

These results were measured on a development machine while this page was
written. Results from the repository's Benchmark workflow replace them before
this change is merged.

### Library: repository documentation

501 files, 1.36 MB.

| Step                                       | Time   | Fastest to slowest run | Per file | Per second | Compared with parsing |
| ------------------------------------------ | ------ | ---------------------- | -------- | ---------- | --------------------- |
| Parse only                                 | 777 ms | 767 ms to 782 ms       | 1.55 ms  | 1.75 MB    | 1.0×                  |
| Lint                                       | 1.65 s | 1.59 s to 1.67 s       | 3.29 ms  | 0.82 MB    | 2.1×                  |
| Format, every file needs changes           | 3.71 s | 3.66 s to 3.78 s       | 7.40 ms  | 0.37 MB    | 4.8×                  |
| Format, every file already formatted       | 1.94 s | 1.93 s to 2.03 s       | 3.88 ms  | 0.79 MB    | 2.5×                  |
| Prettier on the same files, for comparison | 2.30 s | 2.26 s to 2.36 s       | 4.59 ms  | 0.59 MB    | 3.0×                  |

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
| Parse only                           | 356 ms | 350 ms to 385 ms       | 0.71 ms  | 1.73 MB    | 1.0×                  |
| Lint                                 | 778 ms | 761 ms to 792 ms       | 1.56 ms  | 0.79 MB    | 2.2×                  |
| Format, every file needs changes     | 1.97 s | 1.95 s to 2.00 s       | 3.94 ms  | 0.31 MB    | 5.5×                  |
| Format, every file already formatted | 896 ms | 888 ms to 901 ms       | 1.79 ms  | 0.69 MB    | 2.5×                  |

The vault's notes are less than half the size of the documentation pages, so
each file is cheaper while the cost per megabyte is similar. The same pattern
holds: linting costs about twice the parsing floor, formatting already formatted
notes a little more, and rewriting every note about five times.

### Command line

The repository documentation above, as 501 files on disk.

| Command                                        | Time   | Fastest to slowest run | Peak memory |
| ---------------------------------------------- | ------ | ---------------------- | ----------- |
| Start Node.js and exit, for comparison         | 18 ms  | 17 ms to 20 ms         | 49.2 MB     |
| Start the CLI and print its version            | 162 ms | 160 ms to 165 ms       | 98.0 MB     |
| Lint the workspace                             | 1.97 s | 1.97 s to 2.01 s       | 184.5 MB    |
| Lint one file of the workspace                 | 211 ms | 207 ms to 224 ms       | 106.6 MB    |
| Format and write, every file needs changes     | 4.13 s | 4.12 s to 4.29 s       | 240.8 MB    |
| Check formatting, every file already formatted | 2.34 s | 2.29 s to 2.36 s       | 245.1 MB    |

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
| 126   | 0.34 MB | 423 ms | 3.35 ms       | 925 ms              | 7.34 ms         | 146.0 MB                           |
| 501   | 1.36 MB | 1.65 s | 3.29 ms       | 3.71 s              | 7.40 ms         | 184.5 MB                           |
| 2,001 | 5.44 MB | 6.67 s | 3.33 ms       | 15.07 s             | 7.53 ms         | 349.0 MB                           |

If the tool slowed down as a workspace grows, the per-file columns would rise
from row to row. They stay level, so the time for a larger workspace can be
estimated by multiplying.

Memory is different. The last column is the most memory a `mdtools lint` process
held for a workspace of that size, including the roughly 100 MB that the tool
needs before it reads a document. It grows with the number of files, because a
run keeps results for the whole workspace until it finishes. Where exactly that
memory goes has not been investigated.

### Larger documents

| Document size | Format with changes | Per kilobyte |
| ------------- | ------------------- | ------------ |
| 17 kB         | 32 ms               | 1.93 ms      |
| 129 kB        | 276 ms              | 2.14 ms      |
| 1,024 kB      | 2.34 s              | 2.29 ms      |

The same check for one document instead of many files. The cost per kilobyte
rises by about a fifth from a short document to one of a megabyte, which is far
larger than documents usually are.

## Is it any good?

| Situation                               | Reference result                                                                | Verdict                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A hook or an agent formats one file     | 0.21 s, nearly all of it start-up                                               | Fine, but not instant. Batch files into one command.                  |
| CI lints and checks 500 pages           | 2.0 s and 2.3 s                                                                 | Good. Shorter than installing the dependencies.                       |
| Formatting 500 pages for the first time | 4.1 s                                                                           | Good for a one-time job.                                              |
| A workspace of 2,000 pages              | About 7 s to lint, 15 s to format everything                                    | Acceptable. Tens of seconds, on one core, every time.                 |
| Compared with Prettier                  | 1.6 times its time when rewriting, 0.85 times when checking                     | Comparable, while also validating links and meaning.                  |
| Memory                                  | About 185 MB to lint and 245 MB to format for 500 pages, about 350 MB for 2,000 | Fine at these sizes. Tens of thousands of files would need gigabytes. |

The design accepts some slowness on purpose. Parsing every changed document
again is what lets the tool refuse an edit that would alter a document's
meaning, and that guarantee matters more to this project than speed. The two
real limits are start-up time and the lack of any reuse between runs. Neither is
a problem at the sizes measured here; both would be the place to start if the
tool had to serve an editor, or workspaces of tens of thousands of files.

## Limits of these numbers

- The documents are synthetic. Real documents have a different mix of syntax,
  and a document with many links to check or many long tables costs more per
  kilobyte.
- Only the built-in rules run. Plugins add their own time.
- The runner is shared, and its speed varies from run to run by about a tenth.
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
- The "compared with parsing" column should not grow. It is independent of the
  machine's speed, so it can also be compared with the tables above.
- The per-file and per-kilobyte columns of the last two tables should stay level
  from row to row. A rising column means the change made something more than
  proportionally slower.
- The output hash in the report's header identifies the formatted output. It
  stays the same when a change does not alter what the formatter produces, and
  it must change when the change is meant to.

The Benchmark workflow runs the same command on a GitHub-hosted runner, for pull
requests that change the benchmark and on request. Its report replaces the
tables on this page when they are updated; results from other machines are not
mixed in, so that successive results stay comparable. The benchmark never fails
on a slow result, because a shared machine's speed varies too much for a limit
to be reliable. A few [unit tests](testing.md#speed) separately guard against
algorithms whose cost grows faster than their input.
