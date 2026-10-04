# Benchmarks

`npm run benchmark` builds the package and times it on synthetic documents. It
takes a few minutes; run it without other work competing for the machine.

```sh
npm run benchmark              # a Markdown report
npm run benchmark -- --json    # the same measurements as JSON
npm run benchmark -- --quick   # tiny inputs and one sample, to check that it runs
```

Read
[the benchmarks page](https://viell-dev.github.io/slop-markdown-tools/benchmarks.html)
for what each measurement means, the reference results, and how to judge a
change.

| File              | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `run.mjs`         | Takes the measurements                                       |
| `corpus.mjs`      | Generates the documents, identically on every run            |
| `report.mjs`      | Renders the measurements as the Markdown report              |
| `peak-memory.mjs` | Records the peak memory of the CLI processes the run started |
