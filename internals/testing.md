# Testing procedures

Start with [setup and ordinary checks](../CONTRIBUTING.md#set-up). Use the
[verification map](verification.md) to choose the evidence for a change and the
[dependency guide](dependencies.md) for dependency or parser reconciliation.

- [Build and invocation ownership](#build-and-invocation-ownership)
- [Test suites and fixtures](#tests)
- [Reference and GitHub rendering](#reference-and-github-rendering)
- [Obsidian host](#obsidian-host) and [baseline
  changes](#advancing-the-obsidian-baseline)
- [CLI and filesystem integration](#cli-and-filesystem-integration)
- [Performance and retention](#performance-and-retention)

## Build and invocation ownership

Standalone `check`, `test` and its suite variants, `test:package`, `format:docs`
and `format:docs:check` prepare a fresh product build. Raw steps such as
`format:docs:write` consume prepared output through those wrappers.
`scripts/build.mjs` generates the parser and compiles TypeScript in one unique
staging directory, checks the expected files, then publishes individual files
and prunes obsolete ordinary output. The live directory is not replaced
atomically. Links in output are rejected; live writers' temporary files are
preserved. Same-input deterministic builders may overlap, but consumers must
wait for every builder. Do not edit source, configuration or installed
dependencies during a build or its consumers. An interrupted publication
requires a fresh standalone command.

Temporary-file ownership uses a live process ID. An orphan whose ID has been
reused can be preserved; receipt-verified consumers, including release package
checks, reject that extra file. Raw `npm run build` and `npm pack`/prepack do
not promise that consumer verification. After ruling out a live writer, remove
only that exact ordinary temporary file. Process IDs are not a general lock or a
transactional publication scheme.

An interrupted process can leave its own ignored `.mdrefine-build-*` staging
directory. After confirming that its owning build process has exited, resolve
the exact directory path and check that it is an ordinary directory directly
inside this checkout before removing that directory only. Never use wildcard
cleanup, follow a link, or remove another live build's staging. Staging is
excluded from ESLint as well as Git so abandoned output does not break checks.

`scripts/with-build.mjs` owns one build and a temporary receipt for a bounded
sequence of internal npm scripts. Linux 24's `check:ci` runs `check:static`,
`test:nonunit` and `test:package:installed` together; the required, separate
`Unit coverage` job supplies its unit results. `test:ci` runs the full tests and
installed package check together. Each CI environment still builds and tests its
own tarball. `release:prepare` similarly builds once for its checks and retained
tarball. The receipt binds the canonical checkout, exact Node.js version,
source/configuration and lockfile bytes, parser graph/package/license inputs,
compiler files, and exact output names and hashes to the staged bytes. The
already-built steps `check:static`, `test:package:installed` and
`release:pack:built` reject a missing or changed context. The receipt expires
with its owning process and is removed on normal success or failure; it is never
shipped or reused by another job. Edits or dependency installation invalidate
the owning invocation: restart it rather than saving or copying its receipt.
This is verification of an unchanged build, not transactional support for
editing inputs while tools run or a persistent dependency cache.

All standalone Vitest projects use the same full product preparation, including
unit, performance and coverage selections. This adds a TypeScript compile to
their former parser-only startup and can report a product type error before
those suites run. The single preparation contract keeps direct Vitest and
project-filtered invocations predictable; orchestration still shares one build
where the product is consumed again. Coverage remains on a separate runner;
performance and integration are uninstrumented.

## Tests

| Command                    | Runs                                  |
| -------------------------- | ------------------------------------- |
| `npm test`                 | The build, then all three suites      |
| `npm run test:unit`        | A fresh build, then the unit suite    |
| `npm run test:performance` | Complexity and retention checks       |
| `npm run test:coverage`    | Unit tests with coverage reports      |
| `npm run test:integration` | The build, then the integration suite |

The unit, performance, and integration suites run in that order. Performance
files run one at a time, apart from coverage and the processes that integration
tests start. Unit and integration runs each use at most four workers, or the
machine's available parallelism when it has fewer.

`test:coverage` uses V8 coverage and writes an HTML report and
`coverage-summary.json` to `coverage/unit/`. It includes every production
TypeScript file, including files unit tests never execute. CI publishes the
`unit-coverage` artifact for 14 days, without a coverage threshold. These are
unit-coverage figures: performance cases, integration subprocesses, and
installed package checks are not included, and the command does not replace
those checks. This required job is the Linux 24 unit run; `check:ci` selects
only performance and integration with `test:nonunit`. Other matrix environments
run all three projects without coverage. Local `check` and `npm test` still run
all three projects.

`tests/unit/` imports from `src/`; renderer checks also read their fixture and
probe sources. It does not run the CLI. A defect in how a rule reads or rewrites
Markdown belongs here, as the smallest synthetic document that shows it, usually
checked together with the contracts of every formatting change: formatting the
output again changes nothing, the parsed meaning is unchanged, and disabling the
rule leaves the source as written. Inline and heading rules have
`inline-rules.test.ts` and `heading-rules.test.ts`; block spacing has
`block-spacing.test.ts`, list rules have `lists.test.ts`, and quote markers and
lazy continuation lines have `containers.test.ts`. Code fences, thematic breaks
and blank space are in `blocks.test.ts`, problem rules in `references.test.ts`,
`structure.test.ts` and `content.test.ts`, the shared reading of HTML elements
and its rules in `html-elements.test.ts`, wrapping in `wrap.test.ts` and
`callout-wrap.test.ts`, link rules in `link-rules.test.ts`, and workspace
resolution in `links.test.ts`. That resolution suite keeps its shared
heading-attribute mock and cache assertions together. Dollar math is in
`math.test.ts` against the renderers' output recorded in
`tests/support/math-renderers.ts`. Engine execution, configuration and plugin
registration have `engine.test.ts`, `config.test.ts` and `plugins.test.ts`;
`engine-ranges`, `engine-front-matter` and `engine-*-protections` cover those
specific contracts. The printed diff has `diff.test.ts`.

Competitor-comment regressions are grouped by what they prove:
`competitor-comments-provenance.test.ts` owns source provenance and pragma
gates; `competitor-comments-attribution.test.ts` owns source-check attribution
and fallback options; `competitor-comments-dispatch.test.ts` keeps the
shared-rule dispatch, mock isolation and invocation-count evidence together; and
`competitor-comments-edits.test.ts` owns edits crossing suppression boundaries.
Their identical conversion setup lives in `tests/support/competitors.ts`;
different source-tool defaulting stays local to the suite that needs it.

`tests/support/` owns reusable assertions, formatting checks and CLI harness
helpers. Its `parser/` directory holds reference-parser probes, regression
assertions and the child-process support for compiled-product coverage. A
support file is not a discovered test suite. These locations are navigation, not
a mandatory taxonomy: group tests by what they prove, retaining shared mocks,
lifecycle and deliberate cache assertions when file isolation matters. Keep the
three Vitest projects' selection, ordering and worker limits when moving suites,
and compare discovery before and after a move.

Authored native fixtures have one owner in `tests/fixtures/renderers/`:
`common.mjs` shares controls between GitHub and the forges, `forges.mjs` adds
file/API cases, and `obsidian.mjs` includes `obsidian-boundaries.mjs` and its
`obsidian/` text fixtures. Unit boundary regressions and native runners consume
that same corpus; `scripts/renderer-evidence.mjs` independently builds expected
plans from it. Preserve names, order and source bytes during moves, and update
every runner, plan and native routing check instead of copying a corpus.

### Reference and GitHub rendering

The safety check compares the parser's readings, so `renderers.test.ts` also
compares the HTML of two other implementations, commonmark.js and markdown-it,
before and after formatting. Its inputs are documents that
`scripts/rendering.mjs` generates from fixed seeds and the CommonMark
specification's examples in `tests/fixtures/commonmark/`. Each known difference
is listed with its issue and must still differ, so that a fix shows up as an
entry to remove; a new one fails the test. The Rendering workflow compares
GitHub's rendering in the same way, through its Markdown API, every week, for
pull requests with an [applicable native
input](verification.md#what-the-checks-prove), and in the Release workflow. Run
it by hand with `gh workflow run rendering.yml --ref BRANCH`. PR and release
runs use authored fixtures and the realistic profile at fixed seeds 1–5, 25
documents each. By hand, select `-f profile=adversarial -f seed=N` to reproduce
discovery, or omit the seed for a new one. Locally, after a build, use
`node scripts/github-rendering.mjs` for the fixed gate, or add
`--profile adversarial --seed N` for discovery. It needs an authenticated `gh`;
the report records the profile, actual seeds and reproduction command. The
GitHub comparison verifies rendered code text against the parsed source before
accepting highlighting-wrapper and final-line variations. Code values, language,
metadata, and actual content differences remain significant; raw HTML `pre`
elements are compared strictly. Only generated footnote identifiers established
by the response's footnote section and generated math response attributes are
normalized; visible hexadecimal text, ordinary URLs and anchors, and
source-authored reserved HTML remain significant.

### Obsidian host

HTML renderers cannot stand in for Obsidian, whose Live Preview editor and
Reading view read some Markdown otherwise. `npm run check:obsidian` builds the
repository, runs Obsidian in Docker, formats the documents of
`tests/fixtures/renderers/obsidian.mjs` and generated documents in the Obsidian
dialect, and compares what both views show before and after. Docker must be
running. The image, from `scripts/obsidian/Dockerfile`, holds a virtual display
and WebdriverIO with `wdio-obsidian-service`, which downloads Obsidian at run
time into the `mdrefine-obsidian-cache` volume, because Obsidian's terms do not
allow redistributing it; the check keeps its own dependencies in
`scripts/obsidian/package.json`. It writes `artifacts/obsidian/report.json`,
with screenshots of the first differences. `PROFILE=realistic` is the default:
the fixtures and seeds 1–5, ten documents per seed. `PROFILE=adversarial`
selects discovery: one fresh seed and 100 documents. `SEEDS` selects a list,
`SEED` adds a seed (`none` adds none), `COUNT` sets documents per seed, and
`OBSIDIAN_VERSION` and `OBSIDIAN_INSTALLER_VERSION` override the app and
installer independently. They default to the verified versions in
`scripts/obsidian/baseline.json`; read its `app` and `installer` fields for the
selected versions. Realistic generation uses separated blocks, proper container
prefixes, closed fences and documented dialect syntax. Existing adversarial seed
behavior is retained. `REDUCE`, a comma-separated list of generated documents
from a report, shortens each to the lines that still show its difference, and
`PROBE`, a JSON array of documents, only shows each in Obsidian. Live Preview is
compared by its lines' text and styles, with the characters that it shows as
written left out where only the source differs, and Reading view by its HTML.
List-number normalization applies to styled ordered markers and source-only list
prefixes before lines join; ordinary numbers and numeric hash-prefixed text
retain their digits. The check requires the editor to finish parsing the whole
note and publish that syntax tree before collecting styles; incomplete parsing
fails the run. Empty table source rows with no text or embed are ignored. Table
widgets ignore their known focus and active-handle classes and a generated cell
editor only when the cell also retains its rendered preview. Rendered content,
styles, code spacing, alignment, link destinations, and row counts remain
significant. A host control activates header, code, and link cells with real
input and checks those negative cases; nested authored tables and editor-only
payload remain intact. Boundary regressions in
`tests/fixtures/renderers/obsidian-boundaries.mjs` are shared with the unit
suite, including the long synthetic note in
`tests/fixtures/renderers/obsidian/508.txt`. The comparison retains the source
delimiter of styled list lines, including checkbox widgets, and normalizes
spaces within and around italic and bold runs while keeping styled characters,
code, highlights, and decorations significant. Unchecked checkbox widgets retain
their presence and count even with no text. Styled fence delimiters ignore only
their terminal spaces and tabs; code body whitespace and internal info-string
spacing remain significant. A host control checks both the normalization and
those negative cases. Native heading lines and Setext underlines retain heading
boundaries independently of optional blank separators; host controls retain
changes to their count, levels, text, styles, and embeds, including
single-character underlines and empty headings. Unstyled records emptied by
punctuation normalization are omitted after grouping, so their removal cannot
join visible paragraphs. Styled records, code, and widgets remain significant.
For the default Obsidian theme, a lone unattributed paragraph directly inside a
list item has no extra spacing and is compared as inline content. Multiple
paragraphs, attributed paragraphs, and other block boundaries remain
significant; a deterministic host control checks these cases on every comparison
run. The Obsidian workflow runs the check for pull requests with an [applicable
native input](verification.md#what-the-checks-prove), in the Release workflow,
and by hand with `gh workflow run obsidian.yml --ref BRANCH`, with the inputs
`profile`, `seed`, `count`, `obsidian-version`, and
`obsidian-installer-version`; its `obsidian` artifact holds the report and
screenshots. It fails when the check compared nothing. PR and release gates
require realistic fixed-seed evidence; weekly/manual adversarial runs are
discovery only. Both profiles retain the native calibration controls.

### Advancing the Obsidian baseline

PR/release checks pin the app, installer and Docker base digest. Weekly checks
explicitly request `latest` for both app and installer; manual inputs also
default to `latest`, including a manual realistic run. Local checks default to
the pinned baseline; set both version variables to `latest` for drift checks. To
advance the baseline, verify the official Obsidian release and Docker digest,
run the realistic native workload and controls, and update `baseline.json`, the
Dockerfile's base and identity label together in a tested PR. Record the
observed Electron and Chrome versions in the baseline. Recheck the deliberate
latest route. A Docker updater proposal changing only `FROM`, or an edit
changing only the identity label, must fail agreement checks until its assignee
verifies and completes that coordinated update. These failures keep an update
reviewable; do not add an all-version ignore or weaken the checks to clear them.
App and installer versions remain independently selected. Do not upgrade
dependencies incidentally. The base digest does not freeze apt repository
contents: each report records the inspected built image ID and platform, and the
runner starts that exact ID. The `declaredBase` field is the image's declared
base label, mechanically checked against the Dockerfile's `FROM` and
`baseline.json`; it is not independent inspection of base ancestry. Reports read
app, installer, Electron and Chrome versions from the running application;
requested versions alone cannot certify a host.

Probe mode writes `probes.json` and `probe-metadata.json`. The companion records
the actual app, installer and renderer versions separately from the requested
versions, the inspected image ID/platform and declared base label, and hashes of
the input, executed spec file (`specSha256`), and completed capture. The spec
hash covers `obsidian.e2e.mjs`; it does not hash the Docker image or the
complete harness configuration. Interrupted captures retain a null capture hash.

### CLI and filesystem integration

`tests/integration/` runs the built CLI as a child process in temporary
workspaces, and runs `examples/` and `benchmarks/` as they are, without the
machine's user and system Git settings, which would change what Git ignores. A
defect in what the tool selects, prints, writes, or how it exits belongs here:
`cli.test.ts` and `cli-options.test.ts` for command behavior and options,
`cli-defaults.test.ts` and `cli-obsidian.test.ts` for dialect detection,
`cli-config.test.ts` for configuration errors, `filesystem.test.ts` for write
safeguards, `cli-access.test.ts` for access failures, `cli-encoding.test.ts` for
UTF-8 handling, `selection.test.ts` for which files a run selects, compared with
Git's own decisions, `workflows.test.ts` for whole tasks, `node.test.ts` for
`mdrefine/node`, `code-formatters.test.ts` and `code-command.test.ts` for the
opt-in code tools, `examples.test.ts` and `docs.test.ts` for the examples and
documentation, `metadata.test.ts` for what the package, the README, the site,
the issue forms, and the workflows say about the same facts, and
`release-evidence.test.ts` for the Release workflow's check of CI.
`tests/support/cli.ts` holds the shared harness: `fixture()` writes a temporary
workspace, `run()` starts the CLI, `restrict()` and `denyRead()` take away read
permission on Unix and on Windows, `denyWrite()` takes away write permission on
Windows, `windowsTool()` runs a program of Windows such as `icacls.exe`, and
`linkDirectory()` links a directory, as a junction on Windows. Tests that need
Unix permission modes are skipped on Windows and for the root user, and one that
links a file needs `canSymlink`.

### Performance and retention

A test marked `it.fails` reproduces a confirmed defect that is not fixed yet and
names its issue; remove the marker with the fix. `tests/performance/` guards
against algorithms whose cost grows faster than their input and memory that
should have been released; add a regression check there with the fix for such a
defect. Keep substantive output assertions alongside the measurements, and
exclude preparation costs only when the check is specifically about a later
operation. For scaling checks, warm both measured sizes on separate inputs, use
fresh inputs for every timed call, and alternate their order. Verify every
result outside the clock. Compare growth instead of imposing a wall-clock speed
requirement; where recoverable, check that the former slow algorithm fails the
comparison. When a slow variant and shared-runner noise overlap, count the work
instead, as `lazy-html-work.test.ts` does. Garbage-collection checks also run
outside coverage, which changes execution and allocation costs.

Memory checks await V8's asynchronous `last-resort` major collection, which
releases compilation caches and collects until its root set is stable. A regular
major collection does not promise that condition. Deterministic lifecycle checks
follow parsed documents and trees with WeakRefs and verify cached answers
without reloading source. The residual retained-text check runs the same
synthetic workload in a fresh Node process using the actual compiled product,
prepared or verified by Vitest's normal build setup. Its heap excludes the
runner, mocks and other test work; a distinct reported PID checks that boundary.
The child warms two discarded full-size workspaces before its baseline, using
disjoint paths, basenames and full source content for each warm-up and the
measured workspace. Equal-length filler substitutions preserve construct kinds
and sizes; measured defaults remain unchanged. Content guards retain only
SHA-256 digests, never raw text. It keeps the measured workspace live across its
single fixed sample and checks cached answers again. The input size and
one-third allowance stay unchanged: no retry, selected minimum or larger limit.
Deliberate anchor-copy and cached-source retention must still fail on runtimes
where those mutants keep actual text alive. Primitive strings cannot be WeakRef
targets, and collecting a wrapper would not prove their backing storage was
released.

The finite corpora and concrete path-key/source-key controls check added
retention for those identities. A bounded cache that is already full before the
baseline can replace entries without growing across the sample; this check does
not establish universal absence of source retention.

The measured child writes numeric failure evidence for #413 under
`artifacts/workspace-memory/`; CI uploads only its `report.json` files,
including the isolation/collection protocol and fixed measured delta. Child
failure, timeout, signal or malformed output fails the parent check. To inspect
retaining paths in a disposable container containing only synthetic inputs and
no credentials, set `MDREFINE_MEMORY_HEAP_SNAPSHOT=1` for that test. A full heap
can contain process secrets, so it is never captured or uploaded automatically.
Snapshot generation can itself collect or transform the heap; it cannot replace
or explain away the original measurement.

#### Source-retention controls

To reproduce a bounded source-retention control, first run `npm run build` from
the checkout. Save this JavaScript as a temporary `.mjs` file and run it with
`node` from the checkout to prepare an owned copy with its own ESM package
boundary and resolvable dependencies:

```js
import { cp, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const checkout = process.cwd();
const directory = await mkdtemp(path.join(tmpdir(), "mdrefine-memory-"));
await cp("dist", path.join(directory, "dist"), { recursive: true });
await writeFile(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
await symlink(
  await realpath("node_modules"),
  path.join(directory, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
);
console.log({
  directory,
  runner: path.join(checkout, "tests/support/workspace-memory-child.mjs"),
  product: path.join(directory, "dist/index.js"),
});
```

Edit only the copied `dist` files, never the checkout or linked dependencies.
Record the source commit, runtime, exact mutation and SHA-256 hashes before and
after it. Existing controls replace anchor detachment with identity on Node 22,
cache a source on its target on Node 26, retain only the smallest plain block,
or add a module-level map populated with `name` and `source` (or the reverse) in
`compute()`. An identity operation is a valid leak control only where that
runtime actually keeps backing storage alive.

Change to the printed owned directory so failure artifacts stay with the
experiment, then supply the absolute runner and copied-product paths:

```sh
cd "<directory>"
node "<runner>" "<product>"
```

An unmodified copy should exit 0. An actual retention control should exit 1 with
the fixed sample in stdout and `artifacts/workspace-memory/<pid>/report.json`.
Retain every declared result and useful failed evidence. Remove the owned
`node_modules` junction/symlink itself before recursively deleting the owned
copy; never remove the linked dependency target. Keep full-heap capture limited
to the isolated, credential-free procedure above.

#### HTML continuation measurements

The HTML-continuation check parses its fixtures once per size and clones their
positioned trees for fresh range-cache keys. Those fixtures need no separate
parser metadata; do not generalize that preparation to arbitrary parsed nodes.
It retains the elapsed-time growth bound and observes native backtick search
volume separately, so the former repeated suffix search fails even when its
native calls do not dominate timing. The observer restores the native method
before assertions and is never active during timed samples.
