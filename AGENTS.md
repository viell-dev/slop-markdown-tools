# Agent maintenance

This file holds what agents maintaining this repository need beyond its other
documents. The [README](./README.md#status) states how the project is
maintained. [CONTRIBUTING.md](./CONTRIBUTING.md) holds the setup, checks, test
layout, documentation workflow, and pull request rules, and
[RELEASING.md](./RELEASING.md) the release procedure; follow them and do not
repeat them here. User and API documentation belongs in `docs/`.

## Repository boundary

Everything the project needs lives in this repository. Never stage, copy, quote,
or publish content from outside it. Use synthetic fixtures, never real vault
documents, in tests, issues, and pull requests, and keep private documents and
credentials out of diagnostic snapshots and logs.

## Upstream defects

The pinned overview of defects in dependencies is #330: each has a tracking
issue with `Status: Blocked`, closed as not planned while a workaround or a
documented limit leaves nothing here waiting on it. Here a workaround is
whatever keeps renderers showing the same, such as the rules' protections and
the check in `parse()` for #278. The first report to micromark,
micromark/micromark#252, waits for a maintainer's response, and nothing more
goes there until one comes; log each check in #330.

## Keeping the repository consistent

Before committing, search the repository for other statements of what the change
touches: behavior, option names, defaults, commands, file locations, versions
and Node.js requirements, and policy. Known couplings:

- Behavior and its descriptions: the `docs/` pages, the README, `examples/` and
  each workspace's `after/` tree, CLI help text, type declarations, and
  `CHANGELOG.md`. The integration tests compare some of these with the code, not
  all.
- Rules: `docs/rules.md` has one index row and one section per rule, in
  alphabetical order of rule ID; a new rule adds both.
- The maintenance statement: the README's status section, which other documents
  link to rather than repeat.
- Labels: `.github/labels.json`, GitHub, the issue templates,
  `.github/dependabot.yml`, and the policy below.
- Branch and tag policy: `.github/rulesets/`, GitHub's settings, and the job
  names in `ci.yml`.
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
  `Type: Feature Request`. There are no priority labels, and assignees,
  milestones, and projects are not used.
- New items carry only a type until an assigned agent reviews them.
  `Status: Confirmed` means a reproduced defect or an accepted request within
  scope.
- `Status: Needs Information` states the evidence needed; `Status: Blocked`
  links the external dependency and the condition that unblocks it, and stays on
  an upstream defect that is closed while parked (see [Upstream
  defects](#upstream-defects)); `Status: Can't Reproduce` follows a documented
  attempt with version, input, and result.
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
- Review the packed files before changing packaging. Keep dependencies and
  generated state inside the repository; commit the lockfile, not caches.
- When updating `typescript-eslint`, recheck its TypeScript support and the
  TypeScript 7 ignore in `.github/dependabot.yml`; remove the ignore once the
  upgrade installs and passes without bypassing peer constraints.
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

`.github/rulesets/` records the policies for `main` and version tags; keep it
and GitHub's settings in sync. The required checks bind to three
`verify (OS, NODE)` job names in `ci.yml`, where `NODE` is the matrix's major
version label rather than its exact `node-version`, and to GitHub Actions, app
15368, so renaming one of those jobs needs a ruleset update. The Node.js 26 job
is not required. Zero required approvals is deliberate for a single-account,
agent-maintained repository; PRs, passing checks, and resolved review threads
remain mandatory.

Other repository settings, each recorded here with its reason when it changes:

- GitHub Actions may run only actions that GitHub owns, pinned by full commit
  SHA. A workflow that needs another action, or a tag instead of a SHA, fails to
  start until the setting allows it. Allow another action only when nothing
  GitHub owns, and no script in the repository, can do the job; pin it by SHA
  and give the reason in the PR, because it runs with the workflow's
  permissions.
- The publication settings, environments included, are listed in
  [RELEASING.md](./RELEASING.md#publication-prerequisites).
- CodeQL's default setup scans JavaScript, TypeScript, and the workflows.
- Wiki, Projects, and Discussions are off; issues and pull requests are the only
  channels.
- #330, the overview of upstream defects, is pinned.
- Three review apps comment on pull requests: Sourcery and cubic on each push,
  CodeRabbit when a comment asks for it with `@coderabbitai review`. Their
  findings are claims to check, not approvals: verify each against the code and,
  where it concerns rendering, against the renderer; fix a valid one in the PR
  with a test, and answer every thread with the evidence either way before
  resolving it. The ruleset itself requires only that every thread is resolved.

Maintainers enforce the [code of conduct](./CODE_OF_CONDUCT.md): hide or edit a
comment, lock a conversation, or close an item that breaks it, and say why where
it helps.

## Technical map

- TypeScript ESM compiled with `tsc`. The package exports `dist/index.js` as
  `mdrefine`, `dist/node.js` as `mdrefine/node`, and the `mdtools` command at
  `dist/cli/main.js`. The names differ on purpose: package `mdrefine`, command
  `mdtools`, configuration `mdtools.config.*`.
- `src/syntax/` parses with micromark and mdast and holds the Obsidian
  extensions; `src/config/` resolves presets, schemas, overrides, and plugins;
  `src/core/` runs rules, suppressions, and the edit engine; `src/rules/` holds
  the built-in rules; `src/workspace/` resolves link targets and handles
  discovery, reading as UTF-8, and writes; `src/cli/` connects them. The main
  entry never touches the filesystem. `mdrefine/node` exposes
  `src/workspace/discovery.ts`, which the CLI uses for discovery and
  per-document options, so change the two together.
- Shared rule helpers belong in `src/rules/shared.ts`, renderer-specific edit
  protections in `protections.ts`, and source-line primitives in
  `src/syntax/source.ts`. Rule modules do not import the `style.ts` aggregator.
  Workspace HTML, anchor collection, target indexing, and link resolution are
  separate modules behind `src/workspace/index.ts`; keep its public entry
  stable.
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
  dialect, and `tests/unit/math-renderers.ts` records what the renderers
  rendered and how to observe them again. Apply a condition to a dialect only
  when its renderer was observed to apply it.
- Formatting applies inline, block, then document phases, guarded by semantic
  fingerprints and convergence checks: a rule whose edits would change meaning
  is left out and reported, and an overlapping edit waits for the next pass
  (`src/core/engine.ts`). Fix a rule's unsafe edit rather than weakening a
  guard; preserve unsupported constructs, such as math that spans lines.
  Obsidian wrapping needs verified strict line breaks.
- `docs.test.ts` compares the examples page, the rule index, the preset table,
  the library pages, the installation commands, and the changelog with the code,
  and `benchmarks.test.ts` the benchmark page's headings and row labels. Each
  example workspace's `after/` tree is exactly what `format --write` makes of
  `before/`: regenerate it when formatting changes on purpose, and treat an
  unexpected difference as a regression.
- Replace the benchmark page's results only from a run of the Benchmark
  workflow; a local report names its machine's processor and is never published.
  Judge a change by the ratio columns or by runs before and after on one
  machine.
- The Vitest projects run unit tests, performance checks, then integration tests
  (`sequence.groupOrder`). Performance files run serially, outside unit
  coverage; integration workers are capped at four so CLI subprocesses do not
  overwhelm a runner. Keep these boundaries when adding checks.
- The tool formats Markdown at 80 columns, and Prettier excludes it. VitePress
  builds the site, with heading anchors generated as GitHub generates them, so
  that the tool's link check validates the site's fragments; CI builds it for
  every PR, and the Pages workflow deploys it from the newest stable release's
  tag. Do not commit its cache or output. VitePress 2 is pinned to an alpha to
  avoid the Vite 5 vulnerabilities of the stable line.

## Releases

Follow [RELEASING.md](./RELEASING.md). Agents publish a release once it is
ready, without asking: the owner authorized every release on 2026-10-18. Never
rerun publication for an existing version or tag, and never store an npm token
in GitHub. For each release, check the GitHub publication settings, the
workflow's result, and the registry provenance; the npm settings are the
maintainer's to check when they change.
