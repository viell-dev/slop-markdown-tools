# Contributing

Issues and pull requests from people and from agents are welcome. The project is
maintained by AI agents, as the [README](README.md#status) says, and its owner
follows it through issue and pull request descriptions rather than code, so
write them for a reader who has not seen the code. Agents maintaining the
repository also follow [AGENTS.md](AGENTS.md). Everyone follows the [code of
conduct](CODE_OF_CONDUCT.md).

If an agent wrote your issue or pull request, open it with a short note, such as
a `> [!NOTE]` callout, that says so, names the model and the tool that ran it,
and says whether you reviewed it. The maintaining agents mark their own posts
the same way.

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

Development needs Node.js 22.22.2 or newer, or 24.15.0 or newer, and npm 10 or
newer. `.nvmrc` names 24, the version that the checks and releases run on, so
`nvm use` or `fnm use` selects it.

```sh
git clone https://github.com/viell-dev/slop-markdown-tools.git
cd slop-markdown-tools
nvm install # or: fnm use --install-if-missing
npm ci
npm run build
node dist/cli/main.js --help
```

In a checkout, `node dist/cli/main.js` takes the place of `npx mdrefine`. A
built checkout can also be installed into another project as a local dependency.

## Checks

```sh
npm run check
npm run test:package
```

`check` runs the TypeScript checks, ESLint, Prettier on everything but Markdown,
the tool's own lint and format check of the Markdown, the documentation site's
build, and all three test suites. `test:package` packs the package, installs it
into a temporary project with npm and again with pnpm, whose strict layout lets
a package use only the dependencies it declares, and runs the installed command,
the library through `import` and `require()`, a shipped example, and TypeScript
consumers of the published types. npm fetches the pinned pnpm into the
repository's cache, and both installations can need access to the npm registry.

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

ESLint uses the project's TypeScript types when checking source and tests. It
also checks the JavaScript scripts and examples with their existing environment
settings. Integration tests validate CLI JSON before using it; the shared
readers in `tests/integration/json.ts` keep the original payload, so assertions
still catch unexpected keys.

The configuration's JSON Schema is `src/config/resolve.ts`'s `configSchema`.
`npm run schema` writes it to `config.schema.json`, which the package ships and
the site serves; a test fails when the two differ.

GitHub Actions runs static checks, performance/integration and a dependency
audit on Linux with Node.js 24, with unit coverage on a separate Linux 24
runner; the build and tests on Linux with Node.js 22.12.0, the lowest version
the package supports, on Windows with Node.js 24, and on Linux with Node.js 26,
and `test:package` on all four. `main` requires the first three, `Unit coverage`
and the PR-only `Native checks` decision described below. The Node.js 26 job is
not required, so that a defect only the newest Node.js shows does not block
unrelated merges; its failures get an issue. Windows covers file paths, access
control lists, junctions, and the installed command; macOS is not a routine
target.

## Dependencies

Direct dependencies are pinned to exact versions, and the repository lockfile is
committed. Direct updates therefore get an explicit review and release; release
preparation also refreshes and tests eligible indirect dependencies, as
described in the [release
procedure](https://github.com/viell-dev/slop-markdown-tools/blob/main/RELEASING.md).
A parser update can affect output or performance, so those checks cover the
complete resolved dependency graph.

The internal parser adapter is generated by `scripts/build-parser.mjs` during
fresh product preparation. Vitest verifies an orchestration-owned build or
prepares its own, and maps only the parser's generated sibling import to that
runtime. The tracked declaration shim forwards the existing dependency types.
Consumers receive the built runtime, manifest, declaration and complete
third-party licenses; installation does not patch dependencies or invoke the
builder. For development, install the parser dependencies inside the checkout; a
linked or external package store outside that root is rejected. The build tool
itself may be shared. Checkout directory names are independent of parser package
identity.

`scripts/parser-patches.mjs` pins the ten corrected source modules by package,
version and SHA-256, with exact source anchors. The builder also checks the
neutral import/default bundle graph, portable emitted module-region paths, all
three EditMap redirects and the 34-package license graph in
`scripts/parser-packages.json`. A dependency refresh that changes these gates
requires source review, differential AST/event checks, the regression suite and
package/browser/renderer checks before updating the expected identities.
Generated output stays under `dist/syntax/`; keep its manifest and complete
license file in the package.

Any external `plugin.syntax` adds a per-parser compatibility marker. It selects
the original attention, strikethrough and CJK resolvers while retaining the
EditMap, text/code compaction, footnote-position and autolink repairs. The
marker is created in the shared tree factory so primary, projected, alternate
and lazy front-matter readings use the same policy. Those original resolver
costs can remain with syntax plugins. Rule-only plugins keep the builtin
optimized resolver path. Preserve both paths when changing the adapter.

Nested-label proofs and footnote-prefix caches are a separate builtin opt-in.
Any external syntax retains the original nonempty reference lookup and
potential-footnote tokenizer; empty dictionaries may shortcut on either path.
The shared factory also selects that policy for lazy plain/GitHub readings. Both
GFM and VitePress obtain their footnote factory from the generated adapter.
`parser.defined` and an initialized `parser.gfmFootnotes` are upstream arrays of
normalized identifier strings. Keep them as arrays when extending definitions;
objects that only provide `includes` or other array-like methods are
unsupported. Before adding a builtin text construct, resolver, disable entry or
definition writer, re-prove the documented label invariants or leave that
grammar off the trusted-label marker. Destination cache guards alone do not
establish them.

The shared factory also opts builtin grammars into batching a single pair of
homogeneous emphasis runs. The adapter verifies the actual source, event
boundaries and registered resolver identities before batching. Unknown resolver
identities or a missing final text resolver retain the existing matcher. On the
builtin path, empty and nonclosing runs avoid its scratch arrays. Mixed and
multiple raw pairs can still copy their interiors repeatedly. External syntax
retains the original resolver and its cost, including its nonclosing-run path.
Recheck these predicates when changing a builtin resolver or construct.

The VitePress reading uses markdown-it 14.3.3 with the same plugin generation as
the pinned VitePress 2 reference, including its parser security fixes. Its
development-only MathJax reference pulls speech-rule-engine 4.1.4, which pins
vulnerable xmldom 0.9.10; the scoped override selects patched 0.9.12. Keep the
override until that dependency accepts a fixed version, and check both the
actual math renderer and the audit when changing it. Tracking issue:
[#481](https://github.com/viell-dev/slop-markdown-tools/issues/481).

Unbundled indirect dependencies can declare version ranges. The repository's
development lockfile is not shipped or imposed on consumers, so a fresh
installation of the same mdrefine version can resolve newer indirect
dependencies than its release checks used. Consumers that need a repeatable
dependency graph should keep their own lockfile and use its frozen-install
command, such as `npm ci` or `pnpm install --frozen-lockfile`.

`@types/node` stays on the major version of the lowest supported Node.js
version, 22, so that the type check rejects interfaces that Node.js 22 does not
have; the CI job on 22.12.0 catches those that later 22.x releases added.

Dependabot proposes updates weekly, the development dependencies as one group,
and only versions published at least seven days earlier, which leaves time for a
broken or compromised release to be found. Security updates are not delayed. An
update that the pinned dependencies cannot accept, such as one whose peer range
needs the next markdown-it generation, is closed, and `.github/dependabot.yml`
ignores its version line with the reason and when to revisit it. A merged update
ships with the next release, as the [release
procedure](https://github.com/viell-dev/slop-markdown-tools/blob/main/RELEASING.md)
describes.

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
rule leaves the source as written. Rules are tested in `rules.test.ts`, list
rules in `lists.test.ts`, code fences, thematic breaks, and blank space in
`blocks.test.ts`, problem rules in `references.test.ts`, `structure.test.ts`,
and `content.test.ts`, wrapping in `wrap.test.ts` and `callout-wrap.test.ts`,
links in `links.test.ts`, dollar math in `math.test.ts` against the renderers'
output recorded in `math-renderers.ts`, the engine, configuration, and plugins
in `engine.test.ts`, and the diff that `format` prints in `diff.test.ts`.

The safety check compares the parser's readings, so `renderers.test.ts` also
compares the HTML of two other implementations, commonmark.js and markdown-it,
before and after formatting. Its inputs are documents that
`scripts/rendering.mjs` generates from fixed seeds and the CommonMark
specification's examples in `tests/fixtures/commonmark/`. Each known difference
is listed with its issue and must still differ, so that a fix shows up as an
entry to remove; a new one fails the test. The Rendering workflow compares
GitHub's rendering in the same way, through its Markdown API, every week, for
pull requests with an [applicable native input](#what-the-checks-prove), and in
the Release workflow. Run it by hand with
`gh workflow run rendering.yml --ref BRANCH`. PR and release runs use authored
fixtures and the realistic profile at fixed seeds 1–5, 25 documents each. By
hand, select `-f profile=adversarial -f seed=N` to reproduce discovery, or omit
the seed for a new one. Locally, after a build, use
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

HTML renderers cannot stand in for Obsidian, whose Live Preview editor and
Reading view read some Markdown otherwise. `npm run check:obsidian` builds the
repository, runs Obsidian in Docker, formats the documents of
`scripts/obsidian/fixtures.mjs` and generated documents in the Obsidian dialect,
and compares what both views show before and after. Docker must be running. The
image, from `scripts/obsidian/Dockerfile`, holds a virtual display and
WebdriverIO with `wdio-obsidian-service`, which downloads Obsidian at run time
into the `mdrefine-obsidian-cache` volume, because Obsidian's terms do not allow
redistributing it; the check keeps its own dependencies in
`scripts/obsidian/package.json`. It writes `artifacts/obsidian/report.json`,
with screenshots of the first differences. `PROFILE=realistic` is the default:
the fixtures and seeds 1–5, ten documents per seed. `PROFILE=adversarial`
selects discovery: one fresh seed and 100 documents. `SEEDS` selects a list,
`SEED` adds a seed (`none` adds none), `COUNT` sets documents per seed, and
`OBSIDIAN_VERSION` and `OBSIDIAN_INSTALLER_VERSION` override the app and
installer independently. They default to the verified versions in
`scripts/obsidian/baseline.json`, currently 1.14.5 for both. Realistic
generation uses separated blocks, proper container prefixes, closed fences and
documented dialect syntax. Existing adversarial seed behavior is retained.
`REDUCE`, a comma-separated list of generated documents from a report, shortens
each to the lines that still show its difference, and `PROBE`, a JSON array of
documents, only shows each in Obsidian. Live Preview is compared by its lines'
text and styles, with the characters that it shows as written left out where
only the source differs, and Reading view by its HTML. The check requires the
editor to finish parsing the whole note and publish that syntax tree before
collecting styles; incomplete parsing fails the run. Empty table source rows
with no text or embed are ignored. Table widgets ignore their known focus and
active-handle classes and a generated cell editor only when the cell also
retains its rendered preview. Rendered content, styles, code spacing, alignment,
link destinations, and row counts remain significant. A host control activates
header, code, and link cells with real input and checks those negative cases;
nested authored tables and editor-only payload remain intact. Boundary
regressions in `scripts/obsidian/boundary-fixtures.mjs` are shared with the unit
suite, including the long synthetic note in `scripts/obsidian/fixtures/508.txt`.
The comparison retains the source delimiter of styled list lines, including
checkbox widgets, and normalizes spaces within and around italic and bold runs
while keeping styled characters, code, highlights, and decorations significant.
Unchecked checkbox widgets retain their presence and count even with no text.
Styled fence delimiters ignore only their terminal spaces and tabs; code body
whitespace and internal info-string spacing remain significant. A host control
checks both the normalization and those negative cases. Native heading lines and
Setext underlines retain heading boundaries independently of optional blank
separators; host controls retain changes to their count, levels, text, styles,
and embeds, including single-character underlines and empty headings. Unstyled
records emptied by punctuation normalization are omitted after grouping, so
their removal cannot join visible paragraphs. Styled records, code, and widgets
remain significant. For the default Obsidian theme, a lone unattributed
paragraph directly inside a list item has no extra spacing and is compared as
inline content. Multiple paragraphs, attributed paragraphs, and other block
boundaries remain significant; a deterministic host control checks these cases
on every comparison run. The Obsidian workflow runs the check for pull requests
with an [applicable native input](#what-the-checks-prove), in the Release
workflow, and by hand with `gh workflow run obsidian.yml --ref BRANCH`, with the
inputs `profile`, `seed`, `count`, `obsidian-version`, and
`obsidian-installer-version`; its `obsidian` artifact holds the report and
screenshots. It fails when the check compared nothing. PR and release gates
require realistic fixed-seed evidence; weekly/manual adversarial runs are
discovery only. Both profiles retain the native calibration controls.

PR/release checks pin the app, installer and Docker base digest. Weekly checks
explicitly request `latest` for both app and installer; manual inputs also
default to `latest`, including a manual realistic run. Local checks default to
the pinned baseline; set both version variables to `latest` for drift checks. To
advance the baseline, verify the official Obsidian release and Docker digest,
run the realistic native workload and controls, and update `baseline.json`, the
Dockerfile's base and identity label together in a tested PR. Record the
observed Electron and Chrome versions in the baseline. Recheck the deliberate
latest route. Do not upgrade dependencies incidentally. The base digest does not
freeze apt repository contents: each report records the inspected built image ID
and platform, and the runner starts that exact ID. The `declaredBase` field is
the image's declared base label, mechanically checked against the Dockerfile's
`FROM` and `baseline.json`; it is not independent inspection of base ancestry.
Reports read app, installer, Electron and Chrome versions from the running
application; requested versions alone cannot certify a host.

Probe mode writes `probes.json` and `probe-metadata.json`. The companion records
the actual app, installer and renderer versions separately from the requested
versions, the inspected image ID/platform and declared base label, and hashes of
the input, executed spec file (`specSha256`), and completed capture. The spec
hash covers `obsidian.e2e.mjs`; it does not hash the Docker image or the
complete harness configuration. Interrupted captures retain a null capture hash.

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
`release-evidence.test.ts` for the Release workflow's check of CI. `support.ts`
holds the helpers: `fixture()` writes a temporary workspace, `run()` starts the
CLI, `restrict()` and `denyRead()` take away read permission on Unix and on
Windows, `denyWrite()` takes away write permission on Windows, `windowsTool()`
runs a program of Windows such as `icacls.exe`, and `linkDirectory()` links a
directory, as a junction on Windows. Tests that need Unix permission modes are
skipped on Windows and for the root user, and one that links a file needs
`canSymlink`.

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
comparison. Garbage-collection checks also run outside coverage, which changes
execution and allocation costs.

Memory checks await V8's asynchronous `last-resort` major collection, which
releases compilation caches and collects until its root set is stable. A regular
major collection does not promise that condition. Each check samples once; it
does not retry a failed measurement or select a minimum. The retained-text
allowance, parsed-document WeakRefs and cached-anchor assertions remain strict;
a deliberately retained source must still fail.

The retained-text check writes numeric failure evidence for #413 under
`artifacts/workspace-memory/`; CI uploads only its `report.json` files,
including the collection protocol and fixed measured delta. To inspect retaining
paths in a disposable container containing only synthetic inputs and no
credentials, set `MDREFINE_MEMORY_HEAP_SNAPSHOT=1` for that test. A full heap
can contain process secrets, so it is never captured or uploaded automatically.
Snapshot generation can itself collect or transform the heap; it cannot replace
or explain away the original measurement.

The HTML-continuation check parses its fixtures once per size and clones their
positioned trees for fresh range-cache keys. Those fixtures need no separate
parser metadata; do not generalize that preparation to arbitrary parsed nodes.
It retains the elapsed-time growth bound and observes native backtick search
volume separately, so the former repeated suffix search fails even when its
native calls do not dominate timing. The observer restores the native method
before assertions and is never active during timed samples.

## What the checks prove

Each promise below names the checks that back it, when they run, and what they
cannot show. "Every pull request" means CI: Linux Node.js 24 runs `check:ci`
with unit evidence in the separate `Unit coverage` job; other matrix jobs run
`test:ci`. Each environment builds and tests its own installed package.

- **Formatting keeps what a document means.** The engine refuses an edit that
  changes the parsed reading (`src/core/engine.ts`); the rule tests format
  twice, compare the meaning, and disable the rule; `renderers.test.ts` compares
  commonmark.js and markdown-it before and after formatting. Every pull request.
  The guard compares the parser's own readings, so a parser defect can hide from
  it; the renderer checks below and the workarounds in the [dependency
  overview](https://github.com/viell-dev/slop-markdown-tools/issues/330) cover
  what is known.
- **Renderers show the same before and after.** GitHub: the Rendering workflow.
  Obsidian, in Live Preview and Reading view: the Obsidian workflow. VitePress,
  on every pull request: `vitepress-build.test.ts` builds the example site
  before and after formatting, and `vitepress.test.ts` renders pages with
  VitePress's own Markdown renderer and Vue. Math: `math.test.ts` against the
  renderers' output recorded in `math-renderers.ts`. Forgejo and Gitea: the
  Forges workflow compares official disposable hosts through their file-mode API
  and actual repository file views, including heading anchors. The Rendering,
  Obsidian and Forges workflows run for pull requests that change a
  native-sensitive input, with authored fixtures and realistic documents at
  fixed seeds. The Native workflow classifies every PR and requires each
  applicable host call to succeed through its `Native checks` aggregate. It
  explicitly reports hosts that are inapplicable. The Release workflow runs all
  three checks afresh and validates their reports at its exact commit.
  `renderer-evidence.mjs` independently reconstructs intended fixture/generated
  document names, widths, views and calibration controls. Reports distinguish
  planned documents from attempted/completed formatting cases and changed
  output; unchanged cases are legitimate and need no redundant host request. A
  deterministic gate still requires at least one document comparison. Every
  expected view records comparison or unchanged output. Actual repository file
  views remain mandatory even when unchanged. Deterministic consumers bind the
  report to their host and canonical workload sizes (25 generated documents per
  seed for GitHub, ten for Obsidian and each forge), rejecting truncation even
  if a report shrinks its own plan. `renderer-evidence.test.ts` exercises
  missing, duplicate and incomplete cases, controls, views and host identities.
  Partial reports and existing failure artifacts survive failed attempts. This
  validates bookkeeping and trusted producers, not arbitrary fabricated reports.
  Release consumes fresh workflow results within its producing run; reports are
  not copied between runs, so no new cross-run report provenance is implied.
  GitHub's Markdown API version remains externally uncontrolled. Weekly/manual
  adversarial runs discover differences without gating delivery. New findings
  receive an issue and a scope disposition; they do not automatically expand the
  active fix. Forge images are pinned by version and digest in
  `scripts/forge-images.json`. Run `npm run check:forges` with Docker to
  reproduce the realistic gate;
  `PROFILE=adversarial SEED=42 npm run check:forges` selects reproducible
  discovery (set those environment variables in your shell). Each run creates
  only disposable loopback instances and synthetic accounts, then removes its
  containers and data. No owner credentials are used. Reports and differing
  source/HTML are in `artifacts/forge-rendering/`. During assigned maintenance,
  check the official [Forgejo](https://forgejo.org/download/) and
  [Gitea](https://docs.gitea.com/installation/install-with-docker/) releases and
  update pins through a tested PR. A weekly run tests the pinned hosts, not an
  automatically upgraded server. Server HTML checks math recognition/source, not
  browser KaTeX layout or custom instance settings.
- **Output is deterministic and formatting converges.** The unit tests format
  their output again and expect no change, and each example workspace's `after/`
  tree is exactly what `format --write` makes of `before/` (`examples.test.ts`).
  Every pull request. The benchmark's output hash shows whether the benchmark
  documents format differently.
- **The bundled parser preserves the pinned modules' readings, apart from its
  listed corrections.** `parser-inline`, `parser-autolink`, `parser-identity`,
  `parser-labels`, `parser-emphasis-identity`, `parser-generated`,
  `parser-build`, and `parser-work` check complete positioned trees, observer
  compatibility, token identity, source guards, provenance and deterministic
  work. `parser-writer.test.ts` checks actual output, concurrent builders,
  unchanged timestamps and recovery. Every pull request.
  `parser-emphasis-production` checks actual compiled-product batch calls in an
  isolated V8 coverage session, including lazy readings and four
  missing-registration mutants. `obsidian-openers` bounds failed literal-suffix
  scans; `obsidian-probe-metadata` checks complete and interrupted capture
  bookkeeping. These checks do not prove native-host behavior or compatibility
  with arbitrary event-history rewrites by external extensions. Mixed and
  multiple raw emphasis pairs can still copy their interiors; syntax plugins
  retain the original attention/strike resolvers and their cost. The [dependency
  overview](https://github.com/viell-dev/slop-markdown-tools/issues/330) lists
  the corrections and remaining limits.
- **Files are left safe.** `filesystem.test.ts`, `cli-access.test.ts`,
  `cli-encoding.test.ts`, and `selection.test.ts`, which compares the files a
  run selects with Git's own decisions, on Linux and on Windows, which covers
  access control lists and junctions. Every pull request. macOS is not tested;
  tests that need Unix permission modes are skipped on Windows and for the root
  user.
- **The installed package works.** `npm run test:package` installs the packed
  package with npm and pnpm and runs the command, `import` and `require()`, a
  shipped example, and TypeScript consumers, on every pull request.
  `release:pack` tests the exact tarball that the Release workflow publishes;
  local `release:prepare` additionally runs the full checks, and
  `scripts/verify-publication.mjs` checks that npm serves that tarball with
  provenance naming the workflow and the commit.
- **Rebuilds and packages contain current output only.** `build-output.test.ts`
  builds synthetic source, renames and removes modules, rebuilds and inspects an
  actual tarball. It checks source-map paths, unexpected output, failed
  preparation, concurrent product builders, live/exited child-writer temporary
  files, linked/lowercase-drive script dispatch, side-effect-free imports,
  abandoned-staging checks, linked-output rejection, and receipt identity,
  invalidation and cleanup. The package smoke check independently compares the
  tarball's complete `dist` file set with the compiler's expected names plus the
  four parser artifacts. Every pull request. Per-file publication is not a
  directory transaction; concurrent edits require a fresh invocation.
- **Cost grows with the input as expected.** `tests/performance/` compares
  growth and checks that memory is released; `large-inputs.test.ts` formats
  documents beyond the engine's argument limits, each in its own process. Every
  pull request. The parser's deterministic unit work gates fail on the original
  algorithms; its public timing checks are broad catastrophic-growth bounds, and
  some original algorithms pass them at the selected sizes. Timing alone does
  not establish that a parser defect is fixed. The Benchmark workflow's
  reference timings run for changes to `benchmarks/` and by hand, and the
  benchmark page documents the known limits.
- **Public descriptions agree with the package.** `docs.test.ts`,
  `benchmarks.test.ts`, and `metadata.test.ts` on every pull request;
  `npm run check:live` for GitHub's settings, the newest release, npm, and the
  deployed site, by hand after releases and setting changes. Prose still needs
  reading.
- **A release is the tested commit.** The Release workflow requires CI to have
  passed on the commit it releases (`scripts/release-evidence.mjs`), runs all
  three renderer checks there, refuses a version or tag that exists, and
  publishes the tarball it tested. Built-in verify/coverage checks must have
  that SHA and Actions app identity, with a check suite from this repository's
  `ci.yml` push/main run. PR events are rejected because they can test a
  synthetic merge tree. Other required checks retain their own app identities. A
  newer queued/running CI producer or rerun waits even before its jobs appear;
  the completed producer must succeed, then its newest individual check results
  must pass. Optional Node 26 can delay completion, but its allowed test failure
  does not fail the workflow or become a release requirement.
  `release-evidence.test.ts` rejects missing, queued, unsuccessful, wrong-SHA
  and wrong-producer results. Hosted preparation reuses static/unit/performance/
  integration evidence, then `release:pack` freshly builds and checks the exact
  tarball, installed consumers and declarations. No build receipt crosses jobs.

`scripts/native-checks.mjs` owns native PR classification. Shared source,
parser/build scripts, semantic helpers such as `src/workspace/html.ts`, shared
validators and renderer fixtures select all hosts. Each host's harness and
workflow select that host. Documentation, offline tests and examples do not
select native hosts. All source changes, including `src/syntax/vitepress/`,
select all hosts: shared callers invoke those helpers across dialects, and their
dialect guards are part of the source under review. VitePress also has its real
build/render checks in CI. Unknown paths select all hosts.

For manifest and lockfile changes, the classifier compares the complete resolved
graphs on both sides of the PR. Explicit VitePress-only dependencies and offline
reference/type/tool dependencies can avoid native hosts. Shared indirect
dependencies inherit every root's role, and semantic build tools such as
Rolldown and TypeScript remain native even though they are development
dependencies. Changes outside dependency declarations, unclassified roots,
unsupported lockfiles and missing/ambiguous comparisons select all hosts. The
comparison uses a complete local Git merge-base diff, including deletions and
both sides of renames, rather than the path-filter or API changed-file limits.

The unfiltered Native workflow runs on every `pull_request`, including forks,
with read-only permissions. Its aggregate fails for a failed classifier, unknown
selection, or an absent/unsuccessful applicable call. External-host failures
block applicable PRs; investigate them without waiving evidence. The separate
host workflows retain their schedules, manual inputs, artifacts and release
calls. Their job names are `GitHub rendering`, `Obsidian rendering` and
`Forgejo and Gitea rendering`. Link applicable runs in the pull request. When
changing exemptions, inspect the native scripts' imports and file reads and add
a routing regression. `native-checks.test.ts` covers routing and failure cases;
`metadata.test.ts` checks parsed workflow wiring, including harmless YAML
reserialization and missing/wrong release dependencies and coverage ownership.
`release-evidence.test.ts` binds every current required CI name to its producer.
Keep exact permissions, security values, pinned Actions and protected evidence
identities; structural checks do not replace their identity assertions. The PR
aggregate is excluded by its exact name and Actions app identity from release
status evidence; all other required exact-commit checks, coverage and fresh
native release calls remain mandatory. A difference fails the check; investigate
it and record it in an issue rather than running the check again until it
passes. A realistic or existing regression-fixture difference blocks its gate.
Adversarial discovery instead uses the [bounded renderer
work](#bounded-renderer-work) scope rule: fix meaningful changes on plausible
authored input, and document other cases as limits. A report from real use can
reopen a limit. Reuse an issue for variants of the same cause.

`scripts/renderer-known-differences.json` lists exact issue-linked discovery
source/output/view pairs. Weekly discovery replays their sources and rejects
stale entries; `renderer-profiles.test.ts` checks issue references and current
formatter outputs offline. A known discovery entry never excuses a realistic
gate difference. Keep the list empty when no measured differences remain.
Previously fixed source fixtures stay; a new renderer regression there still
requires investigation. Completing the fixed gates and disposing of discovery
findings is the finish condition, rather than finding no more adversarial bugs.

## Bounded renderer work

PR and release gates use authored fixtures and the realistic generator profile
at fixed seeds. Weekly/manual adversarial discovery is a separate triage queue,
never a merge or release gate. Keep discoveries issue-linked; exact known
source/output/view pairs are replayed, and stale entries fail. Offline tests
bind entries to current formatter output without needing Docker.

Before implementing a discovered difference, decide whether plausible authored
CommonMark or documented dialect syntax loses meaningful rendered content or
structure. Fix those cases. Record exotic constructions and stray-marker styling
as limits in the design/dialect guides; close them as not planned with
`Status: Won't Do`, reopenable with a report from real use. New findings go
through the general boundary policy before adding a specific protection.

Keep existing fixes and fixtures. Consolidate specific guards only when a
general rule demonstrably replaces them. Finish when the agreed deterministic
gates pass and discovered cases have a disposition. Do not expand a PR for
unrelated optional cases, or try to exhaust adversarial seeds. Use focused local
checks while editing and required final CI; repeat expensive checks only when
changed code or a concrete evidence gap warrants it.

## Benchmarks

`npm run benchmark` times the tool on generated documents; it takes a few
minutes, is not part of `check`, and never fails on a slow result. Run it before
and after a change that could affect speed, on the same idle machine, and
compare as the [benchmarks
page](https://viell-dev.github.io/slop-markdown-tools/benchmarks.html#run-it-and-compare)
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
the behavior they describe. CI builds the site for every pull request. The site
describes the newest stable release: the Pages workflow deploys it from that
release's tag after the Release workflow publishes it, as
[RELEASING.md](RELEASING.md) describes. A correction to that release's
documentation goes to `main` and to the release's `site-VERSION` branch, which
RELEASING.md also describes, so that the site never describes unreleased
behavior. The deployed site's `version.json` names the commit it was built from.
GitHub Pages must use GitHub Actions as its source.

## Pull requests

Every change to `main` goes through a pull request with passing CI, and is
merged with a merge commit; `main` requires three of the CI checks, the native
PR decision, `Unit coverage` and resolved review threads, but no approval from a
second account. Contributions are made under the MIT license. Keep discussion
respectful and about reproducible behavior; harassment and disclosure of private
data are not acceptable.

- Describe the problem, the resulting behavior, and the decisions made and why,
  for a reader who will not read the diff. Link the issue.
- Give the verification: the commands and their results, the platforms, the runs
  of the [renderer checks](#what-the-checks-prove) when the change triggers
  them, and what the evidence cannot show. Record which
  [review](#review-and-verification) the change got.
- A change to formatting needs tests of the expected output, of formatting
  twice, and of preserved meaning; a defect that changes rendering needs a
  minimal regression example.
- Update every document, example, and test that describes what you changed, in
  the same pull request, and add the change to the `Unreleased` section of
  [CHANGELOG.md](CHANGELOG.md). The first change after a release starts that
  section above the newest version's, because a release renames it.
- A change to the command line, the configuration, the JSON report, or the
  library that is not a defect fix waits for the next minor release; see the
  [versioning
  policy](https://viell-dev.github.io/slop-markdown-tools/versions.html).
- Keep changes scoped, and state remaining limits.

## Repository enforcement

`.github/rulesets/` records the policies for `main`, for version tags, and for
the `site-*` branches that correct the current release's site; keep it and
GitHub's settings in sync. Main requires three `verify (OS, NODE)` jobs in
`ci.yml`, where `NODE` is the matrix's major version label rather than its exact
`node-version`, its separate `Unit coverage` job, and the PR-only
`Native checks` aggregate in `native.yml`. All bind to GitHub Actions, app
15368; renaming or adding a required check needs recorded/live ruleset and
release-selector producer-mapping checks. The aggregate rejects missing or
unsuccessful applicable host calls and explicitly reports inapplicability. Keep
the coordinator unfiltered and read-only on `pull_request`, including forks. An
applicable external-host outage blocks merge; investigate it without waiving
evidence or weakening the ruleset. `release-evidence.mjs` excludes exactly that
PR-only check/app pair from its exact-commit requirements because Release calls
all three native workflows afresh. Every other required check and unit coverage
still must pass on the release commit. Built-in CI evidence must come from this
repository's `ci.yml` push/main run for that exact SHA; PR checks can test a
synthetic merge tree and cannot substitute. Hosted preparation reuses those
static/test results and runs `release:pack` to build and test the actual
publication artifact. Standalone `release:prepare` still runs the complete
checks. The Node.js 26 job is not required. Zero required approvals is
deliberate for a single-account, agent-maintained repository; PRs, passing
checks, and resolved review threads remain mandatory.

## Review and verification

Every change gets its tests and CI, then the author's review of the complete
diff after the checks pass, trying inputs that the tests do not cover. Beyond
that, the maintainer decides whether a separate agent with fresh context reviews
it, by its sensitivity, complexity, effect, and uncertainty, and records the
choice:

- Ordinary, well-understood changes use author review and relevant checks. A
  substantial parser, engine, file-write, packaging or publication change can
  get one independent review over its coherent change range, shared with the
  release review where practical. Do not repeat review for every small PR or
  re-review unchanged code merely because another commit was added.
- A release PR normally gets an in-depth independent review by a model with
  stronger reasoning suited to the work, of the changes since the previous
  release, unresolved defects, the evidence, compatibility, packaging,
  documentation, and installation and updates, not just the version. Record the
  reason when one is left out.
- The same model or provider may review; prefer a different provider for
  important releases and particularly sensitive work. Name the reviewed commit
  and scope. Address every finding; a material fix or a disputed finding gets a
  focused follow-up review of the unresolved material finding and affected
  changes. Optional cases and wording nits do not start another review round.

A PR's verification section records the commands and their results, the
platforms tested, the runs of the real-renderer checks when its changes trigger
them, what the evidence cannot show, and the review it got. The map of [what the
checks prove](#what-the-checks-prove) says which checks back which promise and
when the expensive ones run. Investigate a failing or intermittent check and fix
the product or the check; do not rerun it until it passes, and do not widen a
limit without understanding the failure.

Review bots may provide PR reviews if usage levels allow. Their findings are
claims to verify against the code and, for rendering, the actual renderer. Fix
valid findings with relevant tests; answer each thread with evidence before
resolving it. Bot reviews supplement author and independent review; their quotas
neither replace nor gate those reviews. The ruleset requires resolved threads,
not a bot review.
