# Agent maintenance

Read [README.md](./README.md) first for consumer-facing behavior, setup,
maintenance policy, and contribution instructions. Keep that information there
rather than duplicating it here. Public design and API documentation belongs in
`docs/`.

## Repository boundary

This directory is an independent public repository. Its parent directory and
sibling `docs/` are private project material: never stage, copy, quote, or
publish their contents. Use synthetic fixtures; do not copy real vault documents
into tests, issues, or pull requests.

## Issue triage and project scope

Review requests against the README, design boundaries, and existing extension
contracts before implementing them. A request to review or resolve issues
requires independent maintainer judgment; it does not authorize accepting every
reporter's proposed feature. Reports from agents receive the same scrutiny as
reports from people. Rejecting, narrowing, splitting, or closing an issue as out
of scope is a valid outcome.

Maintain labels as part of every issue or PR update, including answers, closure,
and reopening. Follow the
[contributor label policy](docs/contributing.md#issue-and-pull-request-labels)
and [.github/labels.json](.github/labels.json): one primary type, at most one
current status, and no priority labels. Reassess stale dispositions, remove
transient statuses on completion, and keep GitHub and the tracked catalog in
sync. Label changes do not replace explanatory comments or relevant PR links.

In an issue or PR's own body, comments, or reviews, refer to it as "this issue"
or "this PR" rather than its number or a link to itself. GitHub flags these as
self-references. Before publishing or editing, check references against the
current issue or PR number. Preserve links to other issues and PRs, including
fixing PRs and related work.

For each distinct request, separate the observed problem from its proposed
solution and choose an appropriate home:

- **Core defect or capability:** parsing, semantic preservation, supported
  dialect behavior, generally useful lint/format operations, resolution,
  diagnostics, or measured performance within the project's scope. A defect
  found in one vault can still expose a generic problem.
- **Consumer policy or workflow:** a workspace's naming conventions, document
  templates, metadata fields, migration heuristics, or external-tool
  orchestration. Prefer configuration, a consumer plugin, or a wrapper when
  these can express the requirement. Obsidian support does not mean adopting
  every vault's content conventions.
- **Extension gap:** an otherwise appropriate consumer implementation cannot use
  the supported API safely or practically. Identify the exact missing primitive
  and evaluate that reusable capability separately from the original policy. Do
  not add speculative hooks or relax semantic guards merely to accommodate one
  consumer.

Configurability, opt-in defaults, report-only behavior, safe edits, many
findings in one corpus, and ease of implementation do not by themselves
establish that a feature belongs in core. Conversely, plugin implementability
alone is not a reason to reject a broadly useful built-in rule. Explain the
general use case, why the package should own it, and the API and maintenance
cost.

Split issues containing independently decidable defects, features, or consumer
policies before implementation when separate dispositions or validation are
needed. Link the resulting issues and PRs, and do not let accepting one part
implicitly accept the others. Record the scope decision and evidence in the
issue or PR before coding. An out-of-scope request is a disposition, not a
blocker awaiting a more detailed design. Reserve blockers for missing evidence,
dependencies, or decisions needed by an otherwise accepted task.

When asked to review existing additions without reverting them, report specific
components to retain or remove and any genuine consumer API gaps. Preserve
independent correctness fixes when proposing partial reversals of mixed PRs. Do
not execute those reversals until authorized.

## Implementation and verification

- Preserve source outside enabled rules. Formatting must not change document
  meaning or resolve ambiguous targets by guessing. Unknown constructs must
  survive intact.
- Keep document parsing, workspace resolution, rule execution, and file writes
  separate. Plugins propose diagnostics and edits; the host validates and
  applies them.
- Every defect that changes document rendering needs a minimal regression
  fixture. Test idempotence, semantic preservation, rule isolation, and
  cross-platform paths where applicable.
- Run `npm run check` and inspect the complete diff before committing. Review
  packed files before changing packaging. Verify GitHub CI after pushing; fix
  failures before reporting completion.
- Do not add private source documents or credentials to diagnostic snapshots or
  logs.
- Keep dependencies and generated state inside this repository. Commit the
  lockfile, not caches.
- When updating `typescript-eslint`, recheck its TypeScript support and revisit
  the TypeScript 7 ignore in `.github/dependabot.yml` (PR #3). Remove the ignore
  once the upgrade installs and passes checks without bypassing peer
  constraints.

## Git workflow

Use focused commits and push completed work. Work on feature branches after
bootstrap. All changes to `main` go through pull requests, including version
bumps, dependency updates, documentation, and agent instructions. This applies
to prereleases as well as stable releases. Follow the release procedure linked
from the README; preparing artifacts never authorizes publication. Do not
rewrite shared history. Force-add this file when needed because some development
environments globally ignore `AGENTS.md`.

Merge PRs with a merge commit (`gh pr merge --merge --match-head-commit SHA`)
after checking the exact PR head. Squash and rebase merging are disabled to
preserve commit history and attribution. GitHub deletes merged source branches;
switch back to `main` and fast-forward the local checkout before new work. Do
not use administrator bypass or weaken protections to merge a failing PR.

When closing a PR, delete its source branch by default, including rejected or
superseded PRs. Preserve it only when the operator asks or other active work
depends on it. Check open PRs before deleting branches; never delete `main` or
another contributor's fork branch. Prune stale tracking refs and remove local
task branches after their work is merged or deliberately abandoned.

The active main and version-tag policies are recorded in `.github/rulesets/`.
Keep those files and GitHub settings synchronized. Required checks bind to the
three `verify (OS, NODE)` job names in `ci.yml` and GitHub Actions app 15368;
renaming a job or changing the matrix requires updating the ruleset. CI runs for
PRs and pushes to `main`, avoiding duplicate feature-branch runs. Zero required
approvals is deliberate for a single-account, agent-maintained repo; PRs,
passing checks, and resolved review threads remain mandatory.

## Technical map

- TypeScript ESM compiles with `tsc`; the package exports `dist/index.js` and
  the `mdtools` executable at `dist/cli/main.js`. npm package, CLI, and config
  names intentionally differ: `mdrefine`, `mdtools`, and `mdtools.config.*`.
- `src/syntax/` owns micromark/mdast parsing and Obsidian extensions;
  `src/config/` resolves presets, schemas, overrides, and trusted plugins.
  `src/core/` executes rules and validates edits; `src/workspace/` resolves
  local targets and handles discovery and atomic writes. Rules propose edits;
  they do not write files directly.
- Formatting applies inline, block, then document phases. Semantic fingerprints,
  overlap checks, and convergence checks guard edits. Fix a rule's unsafe edit
  rather than weakening the guard; preserve unsupported constructs, including
  multiline inline code. Obsidian reflow needs verified strict line breaks.
- Follow the README for development commands. Markdown uses this tool at 80
  columns; Prettier excludes Markdown. VitePress builds the public docs from
  `main`; do not commit its cache or generated site. VitePress 2 is pinned to an
  alpha to avoid the Vite 5 vulnerabilities in the older stable line.

## Release operations

Follow [the release procedure](docs/releases.md) for commands and prerequisites.
Never rerun publication for an existing registry version or release tag. Update
version metadata, the lockfile, release notes, and relevant examples together
through a PR for each new release. Use exact SemVer tags without a `v` prefix,
pointing to the tested merge commit.

The npm trusted publisher is configured for `viell-dev/slop-markdown-tools`,
`release.yml`, and environment `npm-release`, with direct publish permission.
`NPM_PUBLISH_ENABLED=true` is a capability gate, not standing authorization to
publish. The workflow still requires explicit dispatch with `publish=true`, the
exact version, and the actual agent identity. Verify live settings when
releasing; configuration was verified on 2026-09-18. Verify the workflow result
and registry provenance for each authorized release. Do not store an npm token
in GitHub.

`npm run release:prepare` verifies and retains a tarball, manifest, and checksum
in ignored `artifacts/`. Local artifacts are snapshots: regenerate after changes
and compare registry integrity after publication. Never rebuild a replacement
asset for an existing release. GitHub release immutability applies to releases
created after it was enabled; beta.1 predates it, though its tag is protected.
Upload all assets before publishing a future release. If npm succeeds but GitHub
fails, finish only the missing GitHub step at the same source commit.

During beta.1's first publication npm assigned `latest` despite `--tag beta`;
authenticated removal returned E400. Do not retry removal, deprecate beta.1, or
publish a placeholder. Until the first stable release, keep `latest`
synchronized with `beta` after each authorized beta publication. Use an
authenticated local `npm dist-tag add mdrefine@VERSION latest` after verifying
the published version and `beta` tag; OIDC publication does not authenticate tag
updates. Complete this step and verify both tags before reporting the release
complete. Once stable releases exist, `latest` follows stable and `beta` remains
the prerelease channel. The initial local publication did not produce OIDC
provenance.

With npm 12, use an explicit local tarball path (`./artifacts/name.tgz`): a bare
`artifacts/name.tgz` can be interpreted as a GitHub package spec. Pack JSON may
be keyed by package name instead of an array. Test the installed command shim
and public TypeScript declarations with `test:package`, not just the source CLI.

## Attribution

Commit trailers use `Assisted-by: <model> via <harness>`. For issues, pull
requests, and other published prose, end with
`🤖 Generated with <model> via <harness>`, using the actual session identity
rather than literal placeholders. Keep existing authors' voice when editing
prose.

Do not append agent attribution footers to repository documents. The README's
maintenance disclaimer covers them; keep attribution in commits and external
posts.
