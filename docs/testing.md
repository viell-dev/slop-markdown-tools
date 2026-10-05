# Testing

The tests are split by what they exercise. Unit tests call the library's source
directly. Integration tests run the built command-line tool and library the way
a consumer does: as a separate process, against real files.

```sh
npm test                    # build, then run both suites
npm run test:unit           # library behavior only; needs no build
npm run test:integration    # build, then the CLI, examples, and documentation
npm run test:package        # pack, install into a temporary project, and use it
```

The two suites run one after the other, never at the same time: integration
tests start many processes, and that load would make the time limits of a few
unit tests unreliable. `npm run check` runs both suites after the type, lint,
formatting, and documentation-site checks. GitHub Actions runs them on Linux
with Node.js 22 and 24 and on Windows with Node.js 24.

## Unit tests

`tests/unit/` imports from `src/` and touches neither the filesystem nor other
processes. A test formats or lints a string and checks the result, usually
together with the contracts every formatting change must keep: the output is
stable when formatted again, the parsed meaning is unchanged, and disabling the
rule leaves the source as written.

| File                   | Covers                                                                      |
| ---------------------- | --------------------------------------------------------------------------- |
| `engine.test.ts`       | Edit application, formatting phases, safety checks, configuration, plugins  |
| `rules.test.ts`        | Each built-in style and problem rule, per dialect                           |
| `wrap.test.ts`         | Prose wrapping, including property-based tests and a linear-time check      |
| `callout-wrap.test.ts` | Wrapping inside Obsidian callouts                                           |
| `links.test.ts`        | Link and fragment resolution for every dialect, including generated anchors |
| `structure.test.ts`    | Document structure rules                                                    |

A defect in how a rule reads or rewrites Markdown belongs here, as the smallest
synthetic document that shows it.

## Integration tests

`tests/integration/` runs `dist/cli/main.js` as a child process in temporary
workspaces, and runs the files under `examples/` and `benchmarks/` as they are.
These tests catch what unit tests cannot: file discovery, configuration loading,
exit codes, output streams, line endings and file names on disk, and
documentation that no longer matches the tool.

| File                 | Covers                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `cli.test.ts`        | Commands, flags, exit codes, discovery, ignore rules, and safeguards around writing files                           |
| `workflows.test.ts`  | Whole tasks: mixed-dialect workspaces, CRLF files, non-ASCII paths, JSON reports, plugin loading                    |
| `examples.test.ts`   | Every example: configurations load, `before/` formats into `after/`, scripts print what is shown                    |
| `docs.test.ts`       | Documentation against the code: rule and preset tables, configuration snippets, the examples page, code block width |
| `benchmarks.test.ts` | The benchmark suite runs, and its synthetic documents format cleanly                                                |

`support.ts` holds the shared helpers: `fixture()` writes a temporary workspace
that is removed after the test, `copyOf()` copies a folder of the repository
somewhere a test may write, and `run()` starts the CLI.

A defect in how the tool behaves as a program belongs here: which files it
selects, what it prints, what it writes, and how it exits.

## Installed package check

`npm run test:package` packs the package, installs the tarball into a temporary
project, and then runs the installed `mdtools` command, imports the library,
runs a shipped example, and compiles a TypeScript consumer against the published
types. It can need access to the npm registry, so it is separate from
`npm test`.

## Known defects

A test marked `it.fails` reproduces a confirmed defect that is not fixed yet. It
passes while the defect exists and fails once the defect is gone, which is the
signal to remove the marker. Each one has a comment describing the defect and
naming its issue. There is currently one, in `workflows.test.ts`: a plugin
package that declares only an `import` condition in its `exports` cannot be
loaded
([issue 112](https://github.com/viell-dev/slop-markdown-tools/issues/112)).

## Speed

The benchmark is not a test and never fails on a slow result, because shared CI
machines vary too much for a time limit on ordinary input to be reliable.
`benchmarks.test.ts` only checks that it still runs. See
[benchmarks](benchmarks.md) for the measurements and how to read them.

A few unit tests do guard against one kind of slowness: an algorithm whose cost
grows faster than its input. They give an unusual input, such as thousands of
unclosed tags, a generous time limit, or compare the time for two input sizes.
Add such a test with the fix when a defect of that kind is found.
