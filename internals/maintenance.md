# Maintenance procedures

[AGENTS.md](../AGENTS.md) states the rules for maintaining this repository. This
guide holds the reference those rules route to: where each kind of fact is
described and which checks compare them, and the steps for issues and the use of
each label.

## Repository couplings

[Keeping the repository
consistent](../AGENTS.md#keeping-the-repository-consistent) means finding every
statement of what a change touches. The couplings below are a starting point,
not an exhaustive list.

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
  `.github/dependabot.yml`, and the [label policy](#labels).
- Branch and tag policy: `.github/rulesets/`, GitHub's settings, the job names
  in `ci.yml`, and `scripts/release-evidence.mjs`, which reads the required
  checks from the ruleset for `main`.
- Native PR classification: `scripts/native-checks.mjs` owns the conservative
  path and dependency-role contract; `native.yml` calls Rendering, Obsidian and
  Forges when applicable and always reports `Native checks`. Keep its tests,
  each reusable host workflow, the ruleset, release evidence and the
  [verification map](verification.md) consistent in meaning. Shared/transitive
  inputs and unknown changes select all hosts; host-specific inputs can differ.
  Dependency roles follow actual native use and shared lockfile reachability,
  never npm's development label alone. Consistent classification does not
  require identical broad path lists. Check native imports and file reads before
  exempting a path.
- Native report contracts: `scripts/renderer-evidence.mjs` derives plans from
  owned fixtures and settings independently of execution records. Deterministic
  consumers pass their expected host and canonical workload; never derive an
  expectation from completed records or accept a report's shrunken plan. Keep
  unchanged formatting attempts explicit. Obsidian's verified baseline belongs
  in `scripts/obsidian/baseline.json` and the Dockerfile; maintain observed host
  identity and the separate explicit latest route as the [testing
  procedures](testing.md#advancing-the-obsidian-baseline) describe. These
  same-run workflow results are not cross-run report provenance.
- Versions and requirements: `package.json`, the lockfile, the installation
  commands in the README and the `docs/` pages, the CI matrix in `ci.yml` and
  CONTRIBUTING.md, and `CHANGELOG.md`. The lowest supported Node.js version also
  sets the `node-version` of the CI job labeled `22` and the major version of
  `@types/node`, whose major updates `.github/dependabot.yml` ignores. The
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
  syntax; and its description in the [testing
  procedures](testing.md#obsidian-host). Test in Docker, as this check does, not
  in a profile of an installed application.

## Consistency checks

`docs.test.ts` and `metadata.test.ts` compare the mechanically comparable
couplings offline in CI. `npm run check:live` compares the live ones without
changing anything: GitHub's labels, rulesets, About description, topics,
homepage, and the settings listed in
[AGENTS.md](../AGENTS.md#git-merging-and-settings) and RELEASING.md, the newest
release with npm's `latest` and its assets, and the commit the deployed site was
built from. It needs an administrator's `gh` login. Prose still needs reading
for its meaning.

## Issue procedure

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

## Labels

Labels follow [`.github/labels.json`](../.github/labels.json), under the rules
in [AGENTS.md](../AGENTS.md#issues-and-labels). Each label's use:

- A feature's implementation PR uses `Type: Feature Request`.
- New items carry only a type until an assigned agent reviews them.
  `Status: Confirmed` means a reproduced defect or an accepted request within
  scope.
- `Status: Needs Information` states the evidence needed; `Status: Blocked`
  links the dependency, decision, or other condition that the item waits for and
  what unblocks it, and stays on an upstream defect that is closed while parked
  (see [Upstream defects](../AGENTS.md#upstream-defects));
  `Status: Can't Reproduce` follows a documented attempt with version, input,
  and result.
- `Needs: Owner` marks a request that only the repository owner can answer: a
  change of direction or scope, or a step that needs their identity, sign-in, or
  second factor, such as npm account settings. `Needs: Human` marks an
  observation, usability judgement, or action that a suitable person can
  provide. Use only the more specific of the two; either can stand with
  `Status: Blocked`. See [Requests for
  people](../AGENTS.md#requests-for-people).
- A duplicate links the canonical item and keeps `Status: Duplicate`; a declined
  item explains the decision and keeps `Status: Won't Do`, and can be
  reconsidered with new evidence. On reopening, replace the old disposition.
- On completion, remove transient statuses and keep the type. A closed, unmerged
  PR keeps its disposition.
- `Good First Issue` goes only on a ready, well-explained beginner task, with
  `Help Wanted`; remove both when the item closes or stops being ready.
