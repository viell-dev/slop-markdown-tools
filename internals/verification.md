# What the checks prove

The [contributor guide](../CONTRIBUTING.md#checks) gives the ordinary check
path. This map owns check coverage, native routing, report contracts and
evidence limits. The [testing procedures](testing.md) give their execution
details; the [release guide](../RELEASING.md) owns publication requirements.

The installed-package check also validates relative Markdown file targets in the
five maintained root documents against the packed file manifest and actual
installation. It excludes example/fixture corpora, code examples, remote URLs
and heading-fragment validation. Source-only maintenance guides stay out of the
package and are linked by their public repository URLs.

Each promise below names the checks that back it, when they run, and what they
cannot show. "Every pull request" means CI: Linux Node.js 24 runs `check:ci`
with unit evidence in the separate `Unit coverage` job; other matrix jobs run
`test:ci`. Each environment builds and tests its own installed package.

- **Source navigation auditing is bounded and read-only.**
  `reachability.test.ts` in the unit and integration projects covers actual
  references, disconnected cycles, multiple entries, excluded transit pages,
  coverage failures, dialect selection, boundaries, JSON/text output and zero
  document writes. Installed package smoke checks exercise the audit through
  `mdrefine/node` and the CLI. The Benchmark workflow compares discovery,
  collection and traversal costs with exact correctness assertions; its times
  are measurements, not pass/fail limits. Unsupported navigation and incomplete
  reads must not produce definitive unreachable findings.

- **Formatting keeps what a document means.** The engine orchestrates phases and
  refuses an edit that changes the parsed reading; `src/core/semantics.ts` owns
  fingerprints and refusal locations, and `protection-edits.ts` checks renderer
  boundaries from the root-cached `RendererProtections` result. `engine.test.ts`
  covers phase order, convergence, overlapping edits, protection-result reuse
  and workspace callback binding/errors. `config.test.ts` checks configuration
  resolution and defaults; `plugins.test.ts` checks registration, synchronous
  schema validation and identity-keyed schema caching. `engine-ranges`,
  `engine-front-matter` and `engine-*-protections` retain their respective
  selection and preservation regressions. `link-fingerprint.test.ts` covers
  resolved target identity and literal URLs. `reference-conversion.test.ts`
  checks the conversion-specific proof, label allocation, source retention,
  suppression, ranges and interaction with other rules. Ordinary fingerprints
  remain exact; only verified built-in inline to full-reference conversions
  establish a new comparison baseline. Boundary regressions and
  `tests/performance/engine.test.ts` cover source ranges, ordered protection
  fields and bounded scans. These locations describe current ownership and
  evidence, rather than requiring future helpers to accumulate there. The rule
  tests format twice, compare the meaning, and disable the rule;
  `renderers.test.ts` compares commonmark.js and markdown-it before and after
  formatting. Every pull request. The guard compares the parser's own readings,
  so a parser defect can hide from it; the renderer checks below and the
  workarounds in the [dependency
  overview](https://github.com/viell-dev/slop-markdown-tools/issues/330) cover
  what is known.
- **Renderers show the same before and after.** GitHub: the Rendering workflow.
  Obsidian, in Live Preview and Reading view: the Obsidian workflow. VitePress,
  on every pull request: `vitepress-build.test.ts` builds the example site
  before and after formatting, and `vitepress.test.ts` renders pages with
  VitePress's own Markdown renderer and Vue. Math: `math.test.ts` against the
  renderers' output recorded in `tests/support/math-renderers.ts`. Forgejo and
  Gitea: the Forges workflow compares official disposable hosts through their
  file-mode API and actual repository file views, including heading anchors. The
  Rendering, Obsidian and Forges workflows run for pull requests that change a
  native-sensitive input, with authored fixtures and realistic documents at
  fixed seeds. The Native workflow classifies every PR and requires each
  applicable host call to succeed through its `Native checks` aggregate. It
  explicitly reports hosts that are inapplicable. The Release workflow runs all
  three checks afresh and validates their reports at its exact commit.
  `renderer-evidence.mjs` independently reconstructs intended fixture/generated
  document names, widths, views, explicitly selected wrapping modes and
  calibration controls. The shared sentence-wrapping fixture opts into that mode
  on GitHub, both forges, and both Obsidian views. Plans also identify documents
  that explicitly enable inline-to-reference conversion; each host must record
  that its reference fixture actually converted. Reports distinguish planned
  documents from attempted/completed formatting cases and changed output;
  unchanged cases are legitimate and need no redundant host request. A
  deterministic gate still requires at least one document comparison. Every
  expected view records comparison or unchanged output. Actual repository file
  views remain mandatory even when unchanged. Deterministic consumers bind the
  report to their host and canonical workload sizes (25 generated documents per
  seed for GitHub, ten for Obsidian and each forge), rejecting truncation even
  if a report shrinks its own plan. `renderer-evidence.test.ts` exercises
  missing, duplicate and incomplete cases, controls, views and host identities.
  Partial reports and existing failure artifacts survive failed attempts. This
  validates bookkeeping and trusted producers, not arbitrary fabricated reports.

  Forge controls also run the opt-in autolink fix on shared authored heading
  cases, asserting exact output and equal native HTML/anchors before accepting
  their independently planned control records.

  `github-normalization.test.ts` and `obsidian-normalization.test.ts` check
  comparison normalization, including changes that must remain significant;
  these offline controls do not replace native calibration or host execution.
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
- **Configuration conversion preserves supported scopes and inherited values.**
  Unit `convert.test.ts` checks individual option mappings. Integration
  `convert.test.ts` and `editorconfig-intersections.test.ts` exercise fallback
  and written configuration, comparing effective settings with Prettier's own
  resolution. Exact and disjoint brace branches, ancestor rebasing, coupled
  EditorConfig values and notices for unsupported remainders are checked on
  every pull request. `competitor-ignores.test.ts` checks CLI1 selection,
  ancestor rebasing, CLI2/Prettier coexistence, BOM-prefixed first patterns,
  per-file negation recovery and read errors. Its selection fixtures were
  compared with the installed reference CLI during implementation; repeat that
  comparison when changing the imported semantics. Reported omissions still
  require manual migration.
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
  work. Fragment source is checked directly by TypeScript/ESLint; parser-build
  checks reject extra runtime boundaries and bind maintained source/tracking.
  Marked and debug-disabled generation comparisons reject module headers absent
  from the structured graph while preserving ordinary comments and strings.
  `build-output.test.ts` changes fragment source, shared types and configuration
  to prove that a live receipt rejects them. `parser-writer.test.ts` checks
  actual output, concurrent builders, unchanged timestamps and recovery. Its
  linked-checkout test retains body phase times and dependency-copy progress on
  failure. Every pull request. `parser-emphasis-production` checks actual
  compiled-product batch calls in an isolated V8 coverage session, including
  lazy readings and four missing-registration mutants. `parser-lazy-lines`
  checks live witnesses, positioned trees, resolver observations and
  deterministic event work; `parser-lazy-production` binds the built runtime and
  checks actual helper hits, event work, and missing-helper/cache-bypass
  mutants. `parser-containers` checks restored whitespace cursors,
  original-marker precedence, list identities and extension observations.
  `parser-containers-production` binds both fragments to the built runtime and
  rejects missing-helper, cache-bypass and repeated-descendant-scan mutants.
  Direct generated-compiler listeners also compare fast/fallback observations
  for tabbed, loose, quoted, ordered and footnote lists with LF/CRLF/CR. The
  deep-list timing case accounts for its quadratic byte size; work counters
  bound the two traversals, not all parser work. `obsidian-openers` bounds
  failed literal-suffix scans; `obsidian-probe-metadata` checks complete and
  interrupted capture bookkeeping. Tokenizer identity cases partition the full
  deterministic corpus into contiguous batches under the unchanged unit
  deadline, retaining every source, selection and identity assertion. These
  checks do not prove native-host behavior or compatibility with arbitrary
  event-history rewrites by external extensions. Mixed and multiple raw emphasis
  pairs can still copy their interiors; syntax plugins retain the original
  attention/strike resolvers and their cost. The [dependency
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
  shipped example, and TypeScript consumers, on every pull request. Consumers
  run outside the checkout with `NODE_PATH` disabled, including syntax-plugin
  declarations and execution, bundled GFM and directly imported VitePress
  table/task-list paths. The compiler also checks the shipped internal parser
  shim and protection-source declaration explicitly, because public declarations
  do not reach them. These checks do not add exported entry points or promise
  completeness for every internal declaration. The compiler executable comes
  from the checkout; consumer imports resolve from the actual installation.
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
  invalidation and cleanup. A failed abandoned-staging check retains child
  durations, results and output, including ESLint startup/configuration traces.
  These failure hooks cannot report an abruptly terminated worker or OS process.
  The package smoke check independently compares the tarball's complete `dist`
  file set with the compiler's expected names plus the four parser artifacts.
  Every pull request. Per-file publication is not a directory transaction;
  concurrent edits require a fresh invocation.
- **Cost grows with the input as expected.** `tests/performance/` compares
  growth and checks that memory is released. `wrap.test.ts` covers isolated
  rereading with syntax plugins in CommonMark and VitePress, including body
  paragraphs beginning with `---`. `large-inputs.test.ts` formats documents
  beyond the engine's argument limits, each in its own process. Every pull
  request. The parser's deterministic unit work gates fail on the original
  algorithms; its public timing checks are broad catastrophic-growth bounds, and
  some original algorithms pass them at the selected sizes. Timing alone does
  not establish that a parser defect is fixed. The Benchmark workflow's
  reference timings run for changes to `benchmarks/` and by hand, and the
  benchmark page documents the known limits. `lazy-html-work.test.ts` gates the
  GitHub lazy HTML collector's growth on counted work for its document shapes,
  because timing could not separate correct code from a real quadratic on shared
  runners ([#826](https://github.com/viell-dev/slop-markdown-tools/issues/826)).
  `document-work.ts` counts the characters and tree properties read, including
  inside native searches, and V8's block counts in `src/syntax/`, which also see
  loops over local data; each misses some quadratic variants alone. A source use
  that it cannot count fails the check. Counting shows nothing about shapes
  outside the fixtures, native calls on local data, loops elsewhere, or
  allocation cost. The collector's timing check remains a broad bound for
  catastrophic growth. Lazy-HTML range and edit-application timing checks
  compare equal work across different document sizes. The edit check targets 200
  ms per window with a 32-call cap after reproducing quota-period sampling bias
  ([#795](https://github.com/viell-dev/slop-markdown-tools/issues/795)); other
  scaling checks retain the 25 ms target and eight-call default cap. Failed
  assertions in these two checks include sizes, the timing target, warm-up and
  calibration durations, call count, and four windows per size in milliseconds.
  Their ratios use each size's fastest window.
- **Public descriptions agree with the package.** `docs.test.ts`,
  `benchmarks.test.ts`, and `metadata.test.ts` on every pull request;
  `npm run check:live` for GitHub's settings, the newest release, npm, and the
  deployed site, by hand after releases and setting changes. Prose still needs
  reading.
- **A release is the tested commit.** The Release workflow enforces the
  [publication evidence contract](../RELEASING.md#publish), runs fresh native
  checks, refuses an existing version/tag, and publishes the tarball it tested.
  `release-evidence.test.ts` rejects missing, queued, unsuccessful, wrong-SHA
  and wrong-producer results and exercises recovery through the actual command
  entry. `release-api.test.ts` checks bounded server-error recovery, deadline
  and fail-closed controls, including a fresh producer read after a failed check
  lookup. `metadata.test.ts` rejects an omitted, narrowed or non-gating release
  audit. Hosted preparation reuses eligible CI evidence, then freshly builds and
  tests the exact tarball and installed consumers. No build receipt crosses
  jobs. The [release guide](../RELEASING.md) owns commands, prerequisites and
  recovery.

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
a routing regression. `native-checks.test.ts` covers routing and failure cases.
`dependency-policy.test.ts` parses the maintained updater configuration and
checks finite grouping, exclusion and ignored-version examples across dependency
fields. These are policy assertions, not Dependabot service execution or proof
that an upgrade installs or renders correctly. `metadata.test.ts` checks parsed
workflow wiring, including harmless YAML reserialization and missing/wrong
release dependencies and coverage ownership. `release-evidence.test.ts` binds
every current required CI name to its producer. Keep exact permissions, security
values, pinned Actions and protected evidence identities; structural checks do
not replace their identity assertions. The PR aggregate is excluded by its exact
name and Actions app identity from release status evidence; all other required
exact-commit checks, coverage and fresh native release calls remain mandatory. A
difference fails the check; investigate it and record it in an issue rather than
running the check again until it passes. A realistic or existing
regression-fixture difference blocks its gate. Adversarial discovery instead
uses the [bounded renderer work](../CONTRIBUTING.md#bounded-renderer-work) scope
rule: fix meaningful changes on plausible authored input, and document other
cases as limits. A report from real use can reopen a limit. Reuse an issue for
variants of the same cause.

`scripts/renderer-known-differences.json` lists exact issue-linked discovery
source/output/view pairs. Weekly discovery replays their sources and rejects
stale entries; `renderer-profiles.test.ts` checks issue references and current
formatter outputs offline. A known discovery entry never excuses a realistic
gate difference. Keep the list empty when no measured differences remain.
Previously fixed source fixtures stay; a new renderer regression there still
requires investigation. Completing the fixed gates and disposing of discovery
findings is the finish condition, rather than finding no more adversarial bugs.
