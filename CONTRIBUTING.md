# Contributing

Issues and pull requests from people and from agents are welcome. The project is
maintained by AI agents, as the [README](README.md#status) says, and its owner
follows it through issue and pull request descriptions rather than code, so
write them for a reader who has not seen the code. Agents maintaining the
repository also follow [AGENTS.md](AGENTS.md).

## Report a defect

Search the open and closed
[issues](https://github.com/viell-dev/slop-markdown-tools/issues) first, then
open one with the bug form's details:

- the mdrefine version, the Node.js version, the operating system, and the exact
  command;
- the dialect in effect, and the configuration, with any plugins;
- a minimal Markdown input, synthetic or public;
- the actual output or diagnostics, with the `--json` report when you have one;
- the expected output, and how the rendering differs.

A screenshot can show a rendering difference, but only the Markdown source
reproduces it. Remove private content from every example. Agents should open an
issue only when their operator has authorized publishing it. Report
vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

## Set up

Development needs Node.js 22.22.2 or newer, or 24.15.0 or newer (24 is
preferred), and npm 10 or newer.

```sh
git clone https://github.com/viell-dev/slop-markdown-tools.git
cd slop-markdown-tools
npm ci
npm run build
node dist/cli/main.js --help
```

In a checkout, `node dist/cli/main.js` takes the place of `npx mdtools`. A built
checkout can also be installed into another project as a local dependency.

## Checks

```sh
npm run check
npm run test:package
```

`check` runs the TypeScript checks, ESLint, Prettier on everything but Markdown,
the tool's own lint and format check of the Markdown, the documentation site's
build, and both test suites. `test:package` packs the package, installs it into
a temporary project, and runs the installed command, the library, a shipped
example, and a TypeScript consumer of the published types; it can need access to
the npm registry.

GitHub Actions runs `check` and a dependency audit on Linux with Node.js 24, the
build and tests on Linux with Node.js 22 and on Windows with Node.js 24, and
`test:package` on all three. Windows covers file paths, access control lists,
junctions, and the installed command; macOS is not a routine target.

## Tests

| Command                    | Runs                                  |
| -------------------------- | ------------------------------------- |
| `npm test`                 | The build, then both suites           |
| `npm run test:unit`        | The unit suite; needs no build        |
| `npm run test:integration` | The build, then the integration suite |

The suites run one after the other, because the processes that integration tests
start would make the time limits of a few unit tests unreliable.

`tests/unit/` imports from `src/` and touches neither files nor other processes.
A defect in how a rule reads or rewrites Markdown belongs here, as the smallest
synthetic document that shows it, usually checked together with the contracts of
every formatting change: formatting the output again changes nothing, the parsed
meaning is unchanged, and disabling the rule leaves the source as written. Rules
are tested in `rules.test.ts`, problem rules in `references.test.ts`,
`structure.test.ts`, and `content.test.ts`, wrapping in `wrap.test.ts` and
`callout-wrap.test.ts`, links in `links.test.ts`, dollar math in `math.test.ts`
against the renderers' output recorded in `math-renderers.ts`, and the engine,
configuration, and plugins in `engine.test.ts`.

`tests/integration/` runs the built CLI as a child process in temporary
workspaces, and runs `examples/` and `benchmarks/` as they are. A defect in what
the tool selects, prints, writes, or how it exits belongs here: `cli.test.ts`
for commands and options, `workflows.test.ts` for whole tasks, `node.test.ts`
for `mdrefine/node`, and `examples.test.ts` and `docs.test.ts` for the examples
and documentation. `support.ts` holds the helpers: `fixture()` writes a
temporary workspace, `run()` starts the CLI, `restrict()` and `denyRead()` take
away read permission on Unix and on Windows, and `linkDirectory()` links a
directory, as a junction on Windows. Tests that need Unix permission modes are
skipped on Windows and for the root user, and one that links a file needs
`canSymlink`.

A test marked `it.fails` reproduces a confirmed defect that is not fixed yet and
names its issue; remove the marker with the fix. A few unit tests guard against
algorithms whose cost grows faster than their input; add one with the fix for
such a defect.

## Benchmarks

`npm run benchmark` times the tool on generated documents; it takes a few
minutes, is not part of `check`, and never fails on a slow result. Run it before
and after a change that could affect speed, on the same idle machine, and
compare as the
[benchmarks page](https://viell-dev.github.io/slop-markdown-tools/benchmarks.html#run-it-and-compare)
explains. The reference results on that page come from the Benchmark workflow on
a GitHub-hosted runner, which runs for pull requests that change `benchmarks/`
and on request (`gh workflow run benchmark.yml --ref <branch>`); replace them
only from such a run.

## Documentation

The site's source is `docs/`, built by VitePress. The tool formats and lints the
repository's own Markdown at 80 columns; Prettier formats everything else and
leaves Markdown alone. The fixtures in `tests/fixtures/` and the documents of
`examples/workspaces/` and `examples/plugin/notes/` are left unformatted on
purpose.

```sh
npm run format:docs        # format the Markdown
npm run format:docs:check  # lint it and check its format without writing
npm run format             # both formatters
npm run docs:dev           # preview the site while editing
npm run docs:build && npm run docs:preview
```

The preview's address includes the `/slop-markdown-tools/` base path. The site
build fails on a link to a page that does not exist, and the tool's lint fails
on a heading fragment that does not. The integration tests compare the examples
page, the rule index, and the benchmark page with the code, so update them with
the behavior they describe. The Pages workflow builds the site from `main` and
deploys it; GitHub Pages must use GitHub Actions as its source.

## Pull requests

Every change to `main` goes through a pull request with passing CI, and is
merged with a merge commit; `main` requires the three CI checks and resolved
review threads, but no approval from a second account. Contributions are made
under the MIT license. Keep discussion respectful and about reproducible
behavior; harassment and disclosure of private data are not acceptable.

- Describe the problem, the resulting behavior, and the decisions made and why,
  for a reader who will not read the diff. Link the issue.
- A change to formatting needs tests of the expected output, of formatting
  twice, and of preserved meaning; a defect that changes rendering needs a
  minimal regression example.
- Update every document, example, and test that describes what you changed, in
  the same pull request, and add the change to the `Unreleased` section of
  [CHANGELOG.md](CHANGELOG.md).
- A change to the command line, the configuration, the JSON report, or the
  library that is not a defect fix waits for the next minor release; see the
  [versioning policy](https://viell-dev.github.io/slop-markdown-tools/versions.html).
- Keep changes scoped, and state remaining limits.
