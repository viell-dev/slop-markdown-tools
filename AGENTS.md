# Agent maintenance

This file holds what agents maintaining this repository need beyond its other
documents. The [README](./README.md#status) states how the project is
maintained. [CONTRIBUTING.md](./CONTRIBUTING.md) holds the setup, checks, test
layout, documentation workflow, and pull request rules, and
[RELEASING.md](./RELEASING.md) the release procedure; follow them and do not
repeat them here. User and API documentation belongs in `docs/`, and the details
that users do not need, such as lists of individual protections and internal
limits, in the [maintainer notes](./internals/README.md).

## Repository boundary

Everything the project needs lives in this repository. Never stage, copy, quote,
or publish content from outside it. Use synthetic fixtures, never real vault
documents, in tests, issues, and pull requests, and keep private documents and
credentials out of diagnostic snapshots and logs.

## Upstream defects

The pinned overview of defects in dependencies is #330. It lists each defect
with the dependency and affected versions, its effect here, the evidence, how it
is handled, and what would unblock or reopen it, in one of four states:

1. **Blocked upstream:** nothing here can remedy it; the overview names the
   limit that users see and any effect on releases.
2. **Worked around:** a verified workaround here keeps renderers showing the
   same, such as the rules' protections and the check in `parse()` for #278; the
   overview names its limits and when it can be removed.
3. **Resolved upstream:** a verified fix exists upstream; adopting it, testing
   it, and removing the workaround remain work here, and the state alone does
   not mean the problem is fixed here.
4. **Upstream route unavailable:** the project does not answer, declines, or
   forbids the contribution; the overview records the dated evidence and the
   remedy chosen here.

A defect with its own issue keeps `Status: Blocked` on it, and the issue is
closed as not planned while nothing here waits on it; the overview says how it
would be reopened. Keep an issue with actionable work here open.

Reports and bounded fixes to dependencies are part of the maintainers' work,
within each project's contribution rules: read its contributing guide, code of
conduct, templates, and any policy on agent contributions first, and record what
applies in the overview. Where it is not known whether a project accepts reports
written by agents, send one report that invites the maintainers to say if they
want no more, and send nothing further until a maintainer's answer shows they
accept them. The first report to micromark, micromark/micromark#252, waits for
such an answer, so nothing more goes to micromark until one comes. Check it and
micromark/micromark#253 at the start of each maintenance session, check the
other entries' upstream state before a release they affect, and log each check
in #330.

## Keeping the repository consistent

Before committing, search the repository for other statements of what the change
touches: behavior, option names, defaults, commands, file locations, versions
and Node.js requirements, and policy.

Adding or changing a feature includes maintaining every affected public
description, usage example, and discovery field. Complete this routine work with
the feature; do not wait for the owner to identify omissions. Check both tracked
files and live repository metadata. The couplings below are a starting point,
not an exhaustive list. At publication, verify that hosted descriptions reflect
the capabilities users can install; editing source files does not update them.

Known couplings:

- Behavior and its descriptions: the `docs/` pages, the `internals/` notes, the
  README, `examples/` and each workspace's `after/` tree, CLI help text, type
  declarations, and `CHANGELOG.md`. The integration tests compare some of these
  with the code, not all.
- Public descriptions and discovery: the README's opening description, feature
  and configuration lists; GitHub's About description, topics, and homepage;
  `package.json`'s description and keywords; and the documentation site's
  description and navigation. Update the affected fields whenever capabilities
  change, including support for another renderer. The About description follows
  the README's opening description and retains the agent-maintained disclosure;
  topics include the supported renderers.
- Rules: `docs/rules.md` has one index row per rule, in alphabetical order of
  rule ID, whose description is the rule's `description` in code, and
  `docs/rules/<category>/<name>.md` has the rule's page; a new rule adds both.
- The maintenance statement: the README's status section, which other documents
  link to rather than repeat.
- Labels: `.github/labels.json`, GitHub, the issue templates,
  `.github/dependabot.yml`, and the policy below.
- Branch and tag policy: `.github/rulesets/`, GitHub's settings, the job names
  in `ci.yml`, and `scripts/release-evidence.mjs`, which reads the required
  checks from the ruleset for `main`.
- Native PR classification: `scripts/native-checks.mjs` owns the conservative
  path and dependency-role contract; `native.yml` calls Rendering, Obsidian and
  Forges when applicable and always reports `Native checks`. Keep its tests,
  each reusable host workflow, the ruleset, release evidence and CONTRIBUTING's
  check map consistent in meaning. Shared/transitive inputs and unknown changes
  select all hosts; host-specific inputs can differ. Dependency roles follow
  actual native use and shared lockfile reachability, never npm's development
  label alone. Consistent classification does not require identical broad path
  lists. Check native imports and file reads before exempting a path.
- Native report contracts: `scripts/renderer-evidence.mjs` derives plans from
  owned fixtures and settings independently of execution records. Deterministic
  consumers pass their expected host and canonical workload; never derive an
  expectation from completed records or accept a report's shrunken plan. Keep
  unchanged formatting attempts explicit. Obsidian's verified baseline belongs
  in `scripts/obsidian/baseline.json` and the Dockerfile; maintain observed host
  identity and the separate explicit latest route as CONTRIBUTING describes.
  These same-run workflow results are not cross-run report provenance.
- Versions and requirements: `package.json`, the lockfile, the installation
  commands in the README and `docs/quick-start.md`, the CI matrix in `ci.yml`
  and CONTRIBUTING.md, and `CHANGELOG.md`. The lowest supported Node.js version
  also sets the `node-version` of the CI job labeled `22` and the major version
  of `@types/node`, whose major updates `.github/dependabot.yml` ignores. The
  development version, in `.nvmrc`, is also the `node-version` of the other
  workflows, the base image of `scripts/obsidian/Dockerfile`, and CONTRIBUTING's
  set-up section. The workflows name it themselves, because the Pages workflow
  builds from a release tag that may predate a change of `.nvmrc`.
- Known renderer differences: the allow lists in `tests/unit/renderers.test.ts`
  and `scripts/github-rendering.mjs` name an issue for each entry; a fix removes
  the entries it makes stale.
- The Obsidian check (`scripts/obsidian-check.mjs`): its own dependencies and
  lockfile in `scripts/obsidian/`, which Dependabot updates on their own, with
  WebdriverIO's major version held at the one `wdio-obsidian-service` supports;
  the documents that `scripts/rendering.mjs` generates for the `obsidian`
  syntax; and its description in CONTRIBUTING.md. Test in Docker, as this check
  does, not in a profile of an installed application.

`docs.test.ts` and `metadata.test.ts` compare the mechanically comparable
couplings offline in CI. `npm run check:live` compares the live ones without
changing anything: GitHub's labels, rulesets, About description, topics,
homepage, and the settings listed here and in RELEASING.md, the newest release
with npm's `latest` and its assets, and the commit the deployed site was built
from. It needs an administrator's `gh` login; run it at the start of
maintenance, after changing a setting, and after each release. Prose still needs
reading for its meaning.

Drift found along the way is a defect. Correct it in the same PR when it lies in
what the PR already changes; otherwise file an issue rather than widening the
assignment.

## Issues and labels

Take each assigned issue through these steps, and leave it accurate after each;
the issue, not the session, is the record:

1. **Validate.** Reproduce a defect, or measure a performance or presentation
   claim, on current `main`. Post the commands, inputs, and results, and where
   they differ from the report.
2. **Decide.** Accept, narrow, or decline, settle the open design questions, and
   post the decision, its reasoning, and the alternatives rejected.
3. **Split.** A further input that shows the same problem stays. A different
   problem that could be accepted, declined, or validated on its own gets its
   own issue, even when one PR will fix both; link them, and remove the
   split-off part from the original decision.
4. **Label and retitle.** Set the status the evidence supports, and correct the
   type when the item is another kind: a discussion that ends in an accepted
   change becomes a bug, an enhancement, or a feature request. Make the title
   name the confirmed problem or the accepted request. Leave the reporter's
   description as the record and correct it in comments; edit your own comment
   when a later step makes it wrong, and say so.
5. **Close or keep open.** Close a declined or duplicate issue as not planned,
   keeping its disposition label. Keep an accepted issue open until its fix
   merges. The fixing PR names it with a closing keyword such as `Fixes #123`,
   carries the same type label, and describes each issue separately when it
   resolves several. After the merge, confirm that the issue closed and remove
   its transient status.

Labels follow [`.github/labels.json`](./.github/labels.json), which holds their
names, colors, and descriptions; keep GitHub in sync with it. Review labels
whenever an item is answered, triaged, implemented, closed, or reopened; they do
not replace explanatory comments or links to PRs.

- Every item has one `Type:` label and at most one `Status:` label, for its
  current disposition or next action. A feature's implementation PR uses
  `Type: Feature Request`. There are no priority labels; milestones and projects
  are not used. Requests for people are assigned to the person being asked.
- New items carry only a type until an assigned agent reviews them.
  `Status: Confirmed` means a reproduced defect or an accepted request within
  scope.
- `Status: Needs Information` states the evidence needed; `Status: Blocked`
  links the dependency, decision, or other condition that the item waits for and
  what unblocks it, and stays on an upstream defect that is closed while parked
  (see [Upstream defects](#upstream-defects)); `Status: Can't Reproduce` follows
  a documented attempt with version, input, and result.
- `Needs: Owner` marks a request that only the repository owner can answer: a
  change of direction or scope, or a step that needs their identity, sign-in, or
  second factor, such as npm account settings. `Needs: Human` marks an
  observation, usability judgement, or action that a suitable person can
  provide. Use only the more specific of the two; either can stand with
  `Status: Blocked`. See [Requests for people](#requests-for-people).
- A duplicate links the canonical item and keeps `Status: Duplicate`; a declined
  item explains the decision and keeps `Status: Won't Do`, and can be
  reconsidered with new evidence. On reopening, replace the old disposition.
- On completion, remove transient statuses and keep the type. A closed, unmerged
  PR keeps its disposition.
- `Good First Issue` goes only on a ready, well-explained beginner task, with
  `Help Wanted`; remove both when the item closes or stops being ready.

In an issue or PR's own body, comments, or reviews, call it "this issue" or
"this PR" rather than linking it, which GitHub shows as a self-reference. Keep
links to other issues and PRs.

## Requests for people

The maintaining agents own verification as well as the code. For this project,
which has no graphical interface, independent agent reviews of the command
line's design take the place of human usability testing, as
[RELEASING.md](RELEASING.md#human-release-testing) records; agents run and
triage them. The owner does not take over engineering, regression testing, or
code review. Other requests cover decisions on direction or scope, identity or
access, and unavailable observations.

Make such a request an issue, or reuse the issue that already owns the question,
so that it can be answered on GitHub without a checkout or a conversation. State
what is needed, why an agent cannot provide it, the recommendation or the
choices, what result to expect, and which work waits for it. A request for an
observation names the build, supplies synthetic inputs, gives numbered steps and
the expected outcome, and lists what to report. Label it `Needs: Owner` or
`Needs: Human`, assign the person being asked (including the owner under either
label), and give the work it blocks `Status: Blocked` with a link; optional
feedback blocks nothing. Keep private details out of the issue. Record an answer
given elsewhere in the issue, act on it, and update its labels and the items it
unblocks. Verify the live assignment and labels and link the pending request
before ending the thread. Keep it open after candidate publication or
preparation merges; close it only after the answer and resulting work are
handled. Improve repeated mechanical checks without removing required human
judgement.

## Review and verification

Follow [CONTRIBUTING.md](./CONTRIBUTING.md#review-and-verification) for author,
independent and optional bot review, and its [bounded renderer
work](./CONTRIBUTING.md#bounded-renderer-work) policy for discovery
dispositions. The existing [verification
map](./CONTRIBUTING.md#what-the-checks-prove) is authoritative; update it in the
PR that changes a check.

## Project scope

Review requests against the README, the design boundaries, and the extension
contracts before implementing them. Rejecting, narrowing, splitting, or closing
an issue as out of scope is a valid outcome. Document corruption and changed
rendering take priority over new style options.

For each request, separate the observed problem from its proposed solution, and
choose its home:

- **Core defect or capability:** parsing, semantic preservation, dialect
  behavior, generally useful lint and format operations, link resolution,
  diagnostics, or measured performance. A defect found in one vault can still
  expose a general problem.
- **Consumer policy or workflow:** a workspace's naming conventions, templates,
  metadata fields, migration heuristics, or orchestration of other tools, such
  as matching file names to titles, placing metadata, guessing at accidental
  Markdown markers, or updating modified dates. Prefer configuration, a plugin,
  or a wrapper; Obsidian support does not mean adopting every vault's
  conventions.
- **Extension gap:** an appropriate consumer implementation cannot use the API
  safely. Identify the missing primitive and evaluate it apart from the original
  policy. Do not add speculative hooks or relax semantic guards for one
  consumer.

The tool is a general Markdown linter and formatter that adapts to the documents
it serves, not a formatter with one fixed style. Presets are opinionated
defaults. Where documents reasonably differ, a rule takes options, at least
those that markdownlint offers for the same check, with the preset's choice as
the default. An option never lets formatting change what a document means: where
a choice would, the rule keeps the existing form. The owner set this direction;
a request for another style option is weighed on its use case, not declined for
adding an option.

Configurability, opt-in defaults, report-only behavior, many findings in one
corpus, and ease of implementation do not by themselves put a feature in core,
and plugin implementability alone is no reason to reject a broadly useful
built-in rule. Explain the general use case, why the package should own it, and
its API and maintenance cost, and record the scope decision before coding. An
out-of-scope request is a disposition, not a blocker; reserve blockers for
missing evidence, dependencies, or decisions that accepted work needs. When
asked to review existing additions without reverting them, report what to keep
or remove and any real API gaps, keep independent correctness fixes in proposed
reversals, and do not revert until authorized.

## Implementation

- Preserve source outside enabled rules. Formatting must not change a document's
  meaning or resolve an ambiguous target by guessing, and unknown constructs
  must survive intact.
- Keep parsing, workspace resolution, rule execution, and file writes separate.
  Rules and plugins propose diagnostics and edits; the host validates and
  applies them.
- Every defect that changes rendering needs a minimal regression fixture. Test
  idempotence, semantic preservation, rule isolation, and cross-platform paths
  where they apply. Check what a renderer shows with GitHub's Markdown API, the
  reference parsers in the test suite, or the renderer itself; the safety check
  only compares the parser's readings.
- For scanner alerts in synthetic fixtures, inspect the inputs and intended
  occurrence count before changing a replacement. A first-occurrence operation
  is not inherently a sanitizer; `replaceAll` is appropriate only when every
  occurrence should change. Preserve intended fixture bytes. Dismiss a false
  positive with evidence and a condition for reopening, or clarify the operation
  without changing its inputs. Do not suppress the rule or rewrite all matches
  merely to clear an alert; real sanitizer findings still need investigation.
- Review the packed files before changing packaging. Keep dependencies and
  generated state inside the repository; commit the lockfile, not caches.
- Follow CONTRIBUTING's [dependency update
  procedure](./CONTRIBUTING.md#dependencies) for grouping, support-based ignores
  and tool pins. Maintenance groups cross dependency fields and never replace
  native-role or shipped-code classification.
- Decide which release a change belongs to when it is assigned, by the
  [versioning policy](./docs/versions.md): before 1.0, a change to the interface
  that is not a defect fix waits for the next minor release. Say so in the PR.

## Git, merging, and settings

Some environments ignore `AGENTS.md` globally; force-add it when needed.

Merge with a merge commit after checking the exact head:
`gh pr merge --merge --match-head-commit SHA`. Squash and rebase merging are
disabled, so that each commit keeps its message and attribution. The ruleset
requires branches to be up to date, so after each merge the other open PRs need
`main` merged in and CI run again. GitHub deletes a merged PR's branch;
fast-forward the local `main` before new work, and prune stale tracking refs and
local task branches.

Follow CONTRIBUTING's [repository
enforcement](./CONTRIBUTING.md#repository-enforcement) policy and RELEASING's
exact-commit evidence requirements. Keep recorded/live rulesets, workflow
identities, `scripts/release-evidence.mjs` producer mapping and
`tests/integration/release-evidence.test.ts` aligned when changing a required
check.

Other repository settings, each recorded here with its reason when it changes:

- GitHub Actions may run only actions that GitHub owns, pinned by full commit
  SHA. A workflow that needs another action, or a tag instead of a SHA, fails to
  start until the setting allows it. Allow another action only when nothing
  GitHub owns, and no script in the repository, can do the job; pin it by SHA
  and give the reason in the PR, because it runs with the workflow's
  permissions.
- The publication settings, environments included, are listed in
  [RELEASING.md](./RELEASING.md#publication-prerequisites).
- CodeQL's default setup scans JavaScript, TypeScript, and the workflows. Its
  `actions/cache-poisoning/poisonable-step` alerts on the Pages build job are
  dismissed as won't fix: that job runs code from a release tag or a
  `site-VERSION` branch on `main`'s behalf, which only maintainers can dispatch,
  and tags are immutable and those branches change only through pull requests
  with CI. Reopen them if the job ever builds another ref.
- Wiki, Projects, and Discussions are off; issues and pull requests are the only
  channels.
- #330, the overview of upstream defects, is pinned.

Maintainers enforce the [code of conduct](./CODE_OF_CONDUCT.md): hide or edit a
comment, lock a conversation, or close an item that breaks it, and say why where
it helps.

## Technical map

Paths below describe the current implementation. Scoped internal reorganizations
are allowed: retain public entry points and synchronous APIs, the dependency
direction between layers, rendering and edit safety, parser source/license
identity, and platform/test isolation. Update affected instructions, navigation
and verification claims in the owning refactor PR; describe implemented layouts
only and remove superseded transition notes.

- TypeScript ESM compiled with `tsc`. The package exports `dist/index.js` as
  `mdrefine`, `dist/node.js` as `mdrefine/node`, and the `mdrefine` command at
  `dist/cli/main.js`. Configuration uses `mdrefine.config.*`, and suppression
  comments use `mdrefine-*`. The legacy 0.4.x compatibility forms were removed
  in 0.5.0; the changelog and the upgrading page retain that history.
- `src/syntax/` parses with micromark and mdast through the generated internal
  adapter and holds the Obsidian extensions; `src/config/` resolves presets,
  schemas, overrides, and plugins; `src/core/` runs rules, suppressions, and the
  edit engine; `src/rules/` holds the built-in rules; `src/workspace/` resolves
  link targets and handles discovery, reading as UTF-8, and writes; `src/cli/`
  connects them. The main entry never touches the filesystem. `mdrefine/node`
  exposes `src/workspace/discovery.ts`, which the CLI uses for discovery and
  per-document options, so change the two together.
- `src/workspace/files.ts` owns filesystem discovery and selection, Git-ignore
  and vault description helpers, and skipped-entry identity and wording.
  `selection.ts` applies literal exclusions without pruning link targets;
  `lookup.ts` supplies synchronous on-demand lookup beneath unlisted entries.
  `writes.ts` owns in-place writes, preflight checks and recovery, while the CLI
  keeps sequential batch processing and per-file failure reporting. Keep these
  concerns separate and preserve lazy reads and filesystem safety; the paths
  describe their current owners.
- Shared rule helpers currently start at `src/rules/shared.ts`, edit protections
  at `protections.ts`, and source-line primitives at `src/syntax/source.ts`.
  These are navigation, not mandatory accumulation points: give a cohesive
  concern a focused module when useful. Rule modules must not import the
  `style.ts` aggregator. Workspace HTML, anchor collection, target indexing, and
  link resolution are separate modules behind `src/workspace/index.ts`; keep its
  public entry stable.
- Consumers require fresh, verified generated output. `scripts/build.mjs` stages
  the portable parser and TypeScript product; `with-build.mjs` may reuse that
  exact output only inside its live invocation, after checking its receipt.
  Fresh generated output is the contract, not repeated builder invocation.
  Standalone commands prepare their own build. Restart after input, installation
  or output changes; do not copy receipts across invocations or jobs.
  Publication replaces individual files, not the whole directory atomically.
  Keep consumers outside overlapping builders and preserve intentional parser
  rebuild tests. `parser-patches.mjs` owns each corrected source's identity,
  rationale, dependency links, maintenance owner and removal conditions.
  `scripts/parser-adaptations/*.ts` holds the maintained algorithms, checked by
  TypeScript and ESLint; the small `parser-adaptations.mjs` loader inserts their
  JavaScript into pinned upstream scopes. Keep these fragments, their types and
  compiler configuration in manifest provenance and recursive receipt inputs.
  `parser-packages.json` pins the complete graph's license identities. Keep all
  four generated distribution artifacts together. See
  [CONTRIBUTING.md](./CONTRIBUTING.md#what-the-checks-prove) for the
  verification map and its limits.
- Parser dependency roles follow installed runtime and declaration reachability.
  The five bundled-only extension factories are development inputs; public
  mdast/plugin types and utilities used outside the bundle remain production
  dependencies. GFM bundles table/task-list tokenizers while VitePress imports
  them directly, so a future adaptation must account for both paths. Keep the
  shipped internal shim free of build-only type forwards and preserve native
  selection for semantic build inputs regardless of npm's dev label. See
  [CONTRIBUTING.md](./CONTRIBUTING.md#dependencies) for the current boundary.
- `src/code/` is the Node host for configured code tools. Keep execution out of
  ordinary rules and the portable entry. Its internal fingerprint path permits
  only selected code values and must cover alternative readings; the ordinary
  fingerprint stays exact. Fences and diagnostic locations are shared through
  `src/syntax/fences.ts` and `src/core/diagnostics.ts`.
- `src/syntax/vitepress/` keeps the positioned projection, synchronous secondary
  reading, Vue whitespace, and literal URL rules separate. Its guard must retain
  the selected-code exception without relaxing other literal values. Static
  anchors and bounded host-supplied includes live in
  `src/workspace/vitepress.ts`. Keep actual VitePress/Vue rendering and full
  builds in integration tests.
- Generated VitePress cache/temp files are ignored at every site root, including
  the published `examples/workspaces/vitepress-site` before/after projects. Keep
  their `.vitepress/config.mts` files checked and included in the examples.
- `src/config/load.ts` locates a plugin not named by path with
  `import-meta-resolve`, a port of Node.js's import resolution, and then with
  CommonJS resolution, because Node.js has no supported call that resolves an
  import from another file's location. Its conditions copy Node.js's defaults
  plus those the process was started with (`--conditions`, `--no-addons`, also
  in `NODE_OPTIONS`); recheck them when the supported Node.js range changes.
- The dialect assumed when nothing names one is chosen in `resolveConfig`: the
  caller's `defaultDialect`, which the CLI sets to `obsidian` inside a vault,
  else `fallbackDialect` (`github`), which `createWorkspace` also uses.
  `src/workspace/vault.ts` holds the one rule for which vault a document belongs
  to; discovery applies it to the directories it visits and `enclosingVault` to
  other paths, so change both together. Do not add another fallback: a dialect
  that reads a construct as a paragraph lets wrapping destroy it without
  tripping the semantic check.
- `src/syntax/math.ts` is the project's own dollar-math tokenizer, adapted from
  `micromark-extension-math` (notice in `THIRD_PARTY_NOTICES`, which ships) so
  that the package does not install KaTeX. `parse.ts` picks the conditions per
  dialect, and `tests/support/math-renderers.ts` records what the renderers
  rendered and how to observe them again. Apply a condition to a dialect only
  when its renderer was observed to apply it.
- `src/core/engine.ts` orchestrates inline, block, then document phases, with
  convergence checks and overlapping edits deferred to the next pass.
  `rule-registry.ts` owns registration and synchronous options/schema
  validation, including the shared identity-keyed schema cache. `semantics.ts`
  owns semantic fingerprints, anchor provenance and refusal locations;
  `protection-edits.ts` checks edits against renderer boundaries. Keep the
  engine's existing exports and lazy workspace callbacks stable when changing
  these internal seams.
- `src/syntax/renderer-protections.ts` owns one `RendererProtections` result
  cached by positioned root. List, GitHub, forge and VitePress list collectors
  are separate; `forge-protections.ts` retains native table continuations,
  paragraph-hidden tables and URL-adjacent hard breaks without requesting
  another parse, and `vitepress/lists.ts` keeps the lists whose markers decide
  markdown-it's table and component readings. `obsidian-protections.ts` orders
  Obsidian passes over one shared leaf projection, with code and HTML collectors
  in focused modules. List text seeds physical fences; joined footnotes seed
  paragraph/table state; Setext readings precede Tab continuation; both
  structural and line passes finish underlines before table collection; escaping
  HTML endpoints precede list-marker checks. Retain original nodes where
  possible, exact UTF-16 positions, Set order and lazy projections. These paths
  locate current ownership, not future mandatory accumulation points. Fix an
  unsafe edit rather than weakening a guard or removing historical protections
  during an unrelated extraction. Obsidian wrapping needs verified strict line
  breaks.
- `docs.test.ts` compares the examples page, the rule index and each rule page's
  presets, the preset table, the library pages, the installation commands, and
  the changelog with the code, and rejects version annotations in the pages;
  `benchmarks.test.ts` compares the benchmark page's headings and row labels.
  Each example workspace's `after/` tree is exactly what `format --write` makes
  of `before/`: regenerate it when formatting changes on purpose, and treat an
  unexpected difference as a regression.
- Replace the benchmark page's results only from a run of the Benchmark
  workflow; a local report names its machine's processor and is never published.
  Judge a change by the ratio columns or by runs before and after on one
  machine.
- The Vitest projects run unit tests, performance checks, then integration tests
  (`sequence.groupOrder`). Performance files run serially, outside unit
  coverage; unit and integration workers are capped at four so CPU-heavy
  properties and CLI subprocesses do not overwhelm a runner. In Linux 24 CI, the
  required `Unit coverage` job owns unit evidence on a separate runner;
  `check:ci` runs static checks, performance/integration, and installed
  packages. Other matrix environments retain their full suites. Keep these
  evidence and resource boundaries without repeating Linux 24 unit work;
  preserve meaningful coverage rather than a duplicate run.
- Workspace memory lifecycle checks retain their parser mocks in the performance
  suite. `tests/support/workspace-memory.mjs` shares the synthetic fixture and
  collection protocol with `workspace-memory-child.mjs`, which measures the
  freshly prepared compiled product outside the runner's heap. Preserve the
  single sample, source-size allowance, cached-answer checks and failing actual
  retention controls. Each full-size warm-up and measured corpus must use
  disjoint paths, basenames and full source content; prefilled cache keys can
  otherwise hide growth. Content guards retain only bounded digests. Wrapper
  collection is not evidence about primitive text.
- Test navigation follows product responsibilities: `engine.test.ts` covers
  phase execution and semantic acceptance; `config.test.ts` and
  `plugins.test.ts` cover configuration and registration/schema contracts.
  Engine ranges, front matter and renderer protections have separate suites;
  rule families and native comparison normalizers do too. Reusable parser probes
  and compiled-product coverage support live in `tests/support/parser/`, and the
  shared CLI workspace/permission lifecycle in `tests/support/cli.ts`. Keep a
  suite's mocks, cleanup and deliberate cache assertions together when splitting
  it: each Vitest file has its own module isolation. Authored native corpora
  live once in `tests/fixtures/renderers/`, shared by host execution, unit
  regressions and independent report plans. Preserve fixture names, order and
  source bytes, and update all consumers and native path selection on moves.
  These paths locate current ownership, not a required taxonomy or a reason to
  append unrelated tests to an existing file.
- The tool formats Markdown at 80 columns, and Prettier excludes it. VitePress
  builds the site, with heading anchors generated as GitHub generates them, so
  that the tool's link check validates the site's fragments; CI builds it for
  every PR, and the Pages workflow deploys it from the newest stable release's
  tag, or from a `site-VERSION` branch of corrections to that release's
  documentation (RELEASING.md). Do not commit its cache or output. VitePress 2
  is pinned to an alpha to avoid the Vite 5 vulnerabilities of the stable line.

## Releases

Follow [RELEASING.md](./RELEASING.md), including its standing publication
authority, readiness, immutable assets, native evidence and verification policy.
