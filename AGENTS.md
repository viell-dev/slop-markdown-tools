# Agent maintenance

This file holds what agents maintaining this repository need beyond its other
documents. The [README](./README.md#status) states how the project is
maintained. [CONTRIBUTING.md](./CONTRIBUTING.md) is the entry guide for setup,
ordinary checks, documentation and pull requests. Specialist procedures live in
the [dependency guide](./internals/dependencies.md), [testing
procedures](./internals/testing.md), [verification
map](./internals/verification.md) and [maintenance
procedures](./internals/maintenance.md); [RELEASING.md](./RELEASING.md) owns
releases. Follow the applicable procedures and do not repeat them here. Issues
and PRs own investigations, decisions, progress and verification receipts; keep
live guidance focused on current instructions and useful explanations. User and
API documentation belongs in `docs/`, and the details that users do not need,
such as lists of individual protections and internal limits, in the [maintainer
notes](./internals/README.md).

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

## Scheduled discovery triage

At the start of maintenance, read failed scheduled Rendering, Obsidian and
Forges runs and their automatically opened discovery issues. Check for a missing
issue if reporting failed. Triage each candidate under [bounded renderer
work](./CONTRIBUTING.md#bounded-renderer-work); an automatic report is not a
confirmed defect. See the [reporting
procedure](./internals/testing.md#scheduled-discovery-triage).

## Keeping the repository consistent

Before committing, search the repository for other statements of what the change
touches: behavior, option names, defaults, commands, file locations, versions
and Node.js requirements, and policy.

Adding or changing a feature includes maintaining every affected public
description, usage example, and discovery field. Complete this routine work with
the feature; do not wait for the owner to identify omissions. Check both tracked
files and live repository metadata. The [known
couplings](./internals/maintenance.md#repository-couplings) are a starting
point, not an exhaustive list. At publication, verify that hosted descriptions
reflect the capabilities users can install; editing source files does not update
them.

Offline tests and `npm run check:live` compare the mechanically comparable
couplings, as the [maintenance
guide](./internals/maintenance.md#consistency-checks) describes; prose still
needs reading for its meaning. Run `check:live` at the start of maintenance,
after changing a setting, and after each release.

Drift found along the way is a defect. Correct it in the same PR when it lies in
what the PR already changes; otherwise file an issue rather than widening the
assignment.

## Issues and labels

Take each assigned issue through the [issue
procedure](./internals/maintenance.md#issue-procedure): validate, decide, split,
label and retitle, then close or keep open. Leave it accurate after each step;
the issue, not the session, is the record.

Labels follow [`.github/labels.json`](./.github/labels.json), which holds their
names, colors, and descriptions; keep GitHub in sync with it. Review labels
whenever an item is answered, triaged, implemented, closed, or reopened; they do
not replace explanatory comments or links to PRs. Every item has one `Type:`
label and at most one `Status:` label, for its current disposition or next
action; the [label guide](./internals/maintenance.md#labels) gives each label's
use. There are no priority labels; milestones and projects are not used.
Requests for people are assigned to the person being asked.

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
dispositions. The existing [verification map](./internals/verification.md) is
authoritative; update it in the PR that changes a check.

Apply the contributor guide's [audience and applicability
guidance](./CONTRIBUTING.md#documentation) when writing or reviewing shared
documentation; keep that requirement authoritative there.

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
- Follow the [dependency update procedure](./internals/dependencies.md) for
  grouping, support-based ignores and tool pins. Maintenance groups cross
  dependency fields and never replace native-role or shipped-code
  classification.
- Decide which release a change belongs to when it is assigned, by the
  [versioning policy](./docs/versions.md): before 1.0, a change to the interface
  that is not a defect fix waits for the next minor release. Say so in the PR.

## Git, merging, and settings

Some environments ignore `AGENTS.md` globally; force-add it when needed.

Follow CONTRIBUTING's [merge and repository enforcement
procedure](./CONTRIBUTING.md#repository-enforcement). Release evidence belongs
in [RELEASING.md](./RELEASING.md#publish).

Repository-specific settings and safeguards:

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

## Implementation safeguards

Use the [contributor guide](./CONTRIBUTING.md#dependencies) for parser builds,
source reconciliation and package boundaries, its [test
guide](./CONTRIBUTING.md#tests) for suite ownership, and the [maintainer
notes](./internals/README.md) for renderer-specific limits. Paths are
navigation, not mandatory accumulation points. Internal reorganizations must
preserve the contracts below.

- Keep public entry points and synchronous APIs stable. The portable `mdrefine`
  entry must not touch the filesystem or execute configured tools; those belong
  to the Node host. Keep CLI discovery and `mdrefine/node` behavior aligned.
  Keep shipped internal declarations free of build-only type forwards.
- Rules must not import the `style.ts` aggregator. Keep parsing, configuration,
  rule execution, workspace lookup and writes independently owned, with lazy
  reads and callbacks preserved.
- Dialect selection has one chain: the caller's `defaultDialect` (the CLI uses
  `obsidian` inside a vault), then `fallbackDialect` (`github`). Discovery and
  on-demand paths must agree on vault membership. Another fallback can let
  wrapping destroy syntax without changing that parser's reading.
- Preserve renderer collectors' exact UTF-16 positions, original nodes, Set
  order and lazy projections, reusing root-cached results rather than parsing
  again. Obsidian passes share one leaf projection: list text seeds physical
  fences, joined footnotes seed paragraph/table state, Setext readings precede
  Tab continuation, both structural and line passes finish underlines before
  table collection, and escaping HTML endpoints precede list-marker checks. Fix
  unsafe edits rather than removing guards during an extraction. Obsidian
  wrapping needs verified strict line breaks.
- The configured-code fingerprint may vary only selected code values, including
  their alternative readings. The ordinary fingerprint remains exact; preserve
  that distinction in VitePress's secondary guard too. Keep actual VitePress/Vue
  rendering and full builds in integration tests.
- Plugin lookup follows Node.js import conditions, including process flags and
  `NODE_OPTIONS`, before CommonJS fallback. Recheck these defaults when changing
  the supported Node.js range; Node.js has no supported resolver for an import
  from another file's location.
- Apply a dollar-math condition to a dialect only when its renderer was observed
  to apply it. `tests/support/math-renderers.ts` records those observations.
- Each example workspace's `after/` tree must be exactly what formatting
  `before/` produces. Regenerate it for intentional output changes and treat
  unexpected differences as regressions. Keep generated VitePress cache/temp
  files ignored at every example site root and its configuration checked.
- Publish benchmark results only from the Benchmark workflow. Local output names
  its machine's processor; use same-machine comparisons for diagnosis.

## Releases

Follow [RELEASING.md](./RELEASING.md), including its standing publication
authority, readiness, immutable assets, native evidence and verification policy.
