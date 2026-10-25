# Releasing

Agents publish a version when it is ready: its release pull request has merged
and every check in this guide has passed. The repository owner authorized that
for every release on 2026-10-18. The configured trusted publisher and the
`NPM_PUBLISH_ENABLED` variable only make publication possible. Published
versions, tags, and release assets are never replaced: a correction gets a new
version.

Dependency updates alone are not a reason to release. Once merged, they ship
with the next release that fixes a defect or adds a feature. The exception is a
security fix in a dependency that installed packages use: publish it in a patch
release without waiting. Updates of development-only dependencies never need a
release of their own.

## Prepare the release pull request

On a branch, in one pull request:

1. Set the version in `package.json` and `package-lock.json`, and
   `publishConfig.tag` to `latest` for a stable version, or to `rc` or `beta`
   for a prerelease.
2. Rename the `Unreleased` section of `CHANGELOG.md` to
   `## VERSION - YYYY-MM-DD`, with the date of publication. The Release workflow
   takes the release notes from this section and fails without it.
3. Update the pinned installation commands in `README.md` and
   `docs/quick-start.md`, which the tests compare with the version, the
   `version` default of `.github/workflows/release.yml`, and every example and
   document that names the version.
4. Refresh the indirect dependencies with `npm update`, so that the tests run
   with what a fresh installation of the package gets. The lockfile does not
   ship, and Dependabot updates only the direct dependencies. Check first that
   every updated package is at least seven days old and comes from its known
   maintainers (`npm view NAME time maintainers`). An earlier security fix may
   use a narrowly scoped exception: record the advisory, exact version,
   publication time, maintainer and patch review, and verification in the
   release PR and #330. Keep the normal waiting period for other packages; a
   security exception does not waive checks or review.
5. Run the checks below, push, and wait for CI.

Apply the [contributor review policy](CONTRIBUTING.md#review-and-verification).
The release normally gets one independent review of the coherent change range
since the previous release, reusing earlier review coverage and focusing on
unreviewed or materially changed code. Merge it like any other pull request.
Merging publishes nothing and leaves the documentation site as it is.

Renderer gates use existing fixtures and the realistic profile at fixed seeds
1–5 at the release commit. Their JSON reports must complete the independently
derived document, width, view and control plan, and contain no unexpected, known
or stale differences. Unchanged documents are completed formatting attempts;
changed counts are observations, not fixed expectations. A gate still requires
at least one document comparison. Each workflow passes its expected renderer to
`validateRendererEvidence()` in `scripts/renderer-evidence.mjs`. It enforces
canonical workload sizes and host identity independently of a runner's exit
status. Obsidian uses the verified app, installer and runtime versions in
`scripts/obsidian/baseline.json` and its digest-pinned Docker base; reports
include observed versions and the actual built-image ID/platform and declared
base label. The [contributor guide](CONTRIBUTING.md#checks) explains baseline
advancement and the separate explicit latest route. Adversarial generation is
weekly/manual discovery and never gates release. Each discovery since the last
release receives an issue and is fixed within scope or recorded as a limit;
publication does not wait for adversarial discovery to stop producing cases.

The Forges workflow additionally validates both pinned host identities and
nonzero actual repository-file comparisons with `validateForgeEvidence()`. Its
file-mode API corpus and repository anchor controls must pass alongside GitHub
and both Obsidian views. Custom forge settings and browser math layout remain
outside that evidence.

## Prepare without publishing

From a clean checkout with Node.js 24 and npm 10 or newer:

```sh
npm ci
npm run release:prepare
npm publish ./artifacts/mdrefine-VERSION.tgz --dry-run --ignore-scripts --access public --tag TAG
```

`release:prepare` runs every check, packs the package, installs that exact
tarball into a temporary project, and tests the installed command, library, and
types. It keeps the tarball, its file manifest, and a SHA-256 checksum in the
ignored `artifacts/` directory; regenerate them after any change. `TAG` is the
package's `publishConfig.tag`. With npm 12, give the tarball as an explicit path
starting with `./`, because `artifacts/name.tgz` can be read as a GitHub
package.

Preparation builds once inside an invocation-owned verified context, shared by
the checks and packing step. The receipt binds current inputs and exact staged
output, expires with that process, and is never a reusable release artifact.
Source, configuration, dependency installation or output changes require a fresh
invocation. The actual tarball, installed npm/pnpm consumers, declarations and
retained publication assets are still checked separately; native host evidence
is unchanged.

The **Release** workflow, dispatched with `publish` left false, requires the
exact-commit CI evidence described below, then runs `release:pack` instead of
repeating the static checks and test projects. That command freshly builds,
packs and tests the actual tarball with npm and strict pnpm, including installed
commands, libraries, declarations and licenses. The workflow adds an audit of
the runtime dependencies, warns when the version or its tag already exists, and
keeps the artifact for 14 days. It publishes nothing, and the Pages workflow
that follows it leaves the site as it is. A dry run is for a version that is not
published yet: for one that npm has, npm's own dry-run publish refuses the
version, so the run fails after its checks and packing. The local
`npm publish … --dry-run` above refuses it the same way.

Hosted preparation requires a `ci.yml` push run on `main` in this repository for
the exact commit. PR checks are not reusable evidence: their head SHA can name
the branch while checkout tests a synthetic merge tree. A branch-only hosted dry
run without eligible push/main evidence waits up to 40 minutes before the CI
gate rejects it. Retrying the same branch commit cannot create a main producer;
use the full local `release:prepare` to prepare unmerged changes. No build
receipt or output is transferred from CI into preparation.

## Publication prerequisites

Check these GitHub settings with `gh` before each publication:

- The environment `npm-release` allows deployments only from the branch `main`,
  by name. "Protected branches only" is not enough: GitHub documents it for
  branch protection rules, and `main` is protected by a ruleset.
- The repository variable `NPM_PUBLISH_ENABLED` is `true`.
- GitHub Pages uses GitHub Actions as its source, and the environment
  `github-pages` allows deployments from `main`, where the Pages workflow runs.
- The ruleset for `main` requires pull requests, the three core CI checks,
  `Unit coverage` and the PR-only `Native checks` aggregate that
  `.github/rulesets/main.json` names.

The npm settings are visible only to the package's maintainer, `viell`, signed
in on npmjs.com, in the package's **Settings** tab:

- **Trusted publishing** ([npm's
  guide](https://docs.npmjs.com/trusted-publishers/)) has one entry, for GitHub
  Actions: the user `viell-dev`, the repository `slop-markdown-tools`, the
  workflow `release.yml`, and the environment `npm-release`, with the
  permissions `npm publish` and `npm stage publish`, and the status "Valid". No
  npm token is stored in GitHub.
- **Publishing access** is "Require two-factor authentication and disallow
  bypass 2fa tokens". Trusted publishing still works; a token cannot publish
  without the second factor, and a change made by hand on the account, such as a
  dist-tag, asks for it too.

The maintainer checks these after setting them up or changing them, not for each
release; they were last checked on 2026-10-18. Only the maintainer's account can
change them, and a successful publication already shows that the entry for this
workflow exists. It cannot show that no other entry exists: npm accepts up to
ten trusted publishers per package, and each of them can publish.

## Publish

Merge the release pull request after its checks pass, and review the version,
the changelog section, and the package manifest once more. Then dispatch
**Release** on `main` with the exact version and `publish: true`.

Before it builds anything, the workflow checks the evidence for its commit, and
any failure publishes nothing:

- CI passed on that exact commit: the three core checks that the ruleset for
  `main` requires and unit coverage (`scripts/release-evidence.mjs`). It
  excludes exactly `Native checks` from GitHub Actions app 15368, because that
  aggregate reports only on PRs and Release runs every native host afresh below.
  Verify and coverage results must also name this exact SHA and a check suite
  from this repository's `ci.yml` push/main run. Same-named results from another
  workflow, event, repository or commit do not qualify; other required statuses
  retain their specified app identities and are never exempted. The gate needs
  the newest eligible CI producer attempt to succeed before accepting its latest
  job results, even when an older attempt passed. A pending producer waits; an
  unsuccessful completed producer fails. Optional Node 26 can delay completion,
  but its allowed test failure does not fail the workflow or become a release
  requirement. Whether a Node 26 timeout or cancellation leaves the CI run
  successful is unverified; an unsuccessful run is rejected. The gate needs read
  access to checks and Actions runs. It waits up to 40 minutes for CI that is
  still running, so it can be dispatched right after the merge.
- The Rendering, Obsidian and Forges workflows find no difference before and
  after formatting at that commit. Each compares its regression fixtures and
  realistic documents at seeds 1–5. Forgejo/Gitea also compare actual repository
  file views. Fresh adversarial documents remain discovery, outside the gate.
- The version and its tag are unused.

The workflow then freshly builds and tests the publication package, reusing CI's
static and test-project results, verifies the artifact's checksum, publishes the
tested tarball with provenance under `publishConfig.tag`, which it checks
against the version, and creates the GitHub release at the workflow's commit,
with the tarball and checksum attached and the changelog section as its notes.
Tags are exact versions without a `v` prefix.

A last job, with read-only access, then checks the publication: the registry's
`integrity` and `shasum` must match the tested tarball, and the version's
provenance must name that tarball, the Release workflow, and the workflow's
commit. It waits up to five minutes for the registry to know the version. If
only this job failed, re-run it with `gh run rerun RUN --failed`; it does not
publish again. When the Release run succeeds for a stable version, the **Pages**
workflow builds the documentation site from the new tag and deploys it; a
prerelease leaves the site on the newest stable release. To deploy the site by
hand, dispatch **Pages** on `main` with the newest stable release's version as
its `tag`; the workflow refuses any other tag.

The workflow refuses a version or tag that already exists. Never run publication
again for an existing version. If npm succeeded but the GitHub release failed,
download the run's artifact with
`gh run download RUN --name npm-release --dir artifacts`, check the publication
with
`node scripts/verify-publication.mjs VERSION ./artifacts/mdrefine-VERSION.tgz COMMIT`,
where `COMMIT` is the run's commit, and finish only the GitHub step at that
commit. Then deploy the site by hand for a stable version, once the GitHub
release exists, because the Pages workflow deploys only the newest stable
release, which it reads from GitHub. Attach every asset before a release is
published, because published releases are immutable.

## Verify

Once npm has processed the version, its dist-tag should name it:

```sh
npm dist-tag ls mdrefine
```

Then install the package into a fresh project with an empty cache and run
`npm audit signatures` there, which verifies the signatures of the registry and
of the provenance; the workflow's check only reads what the provenance names.
Check the GitHub release and its assets and the result of the publication check.
For a stable version, once the Pages workflow has deployed the site, run
`npm run check:live`, which compares the newest release, npm's `latest`, the
release's assets, and the site's `version.json` with each other and GitHub's
settings with the repository. Work after the release continues through pull
requests.

## Correct the site of the current release

The site describes the newest stable release, so a mistake in its documentation
cannot wait for the next version, and deploying `main` would describe changes
that are not released. Correct it without a new version or a moved tag:

1. Fix the documentation on `main` through a pull request, as usual.
2. If the release has no `site-VERSION` branch yet, create one at its tag:
   `git push origin refs/tags/VERSION:refs/heads/site-VERSION`. The ruleset for
   `site-*` branches accepts it because CI passed on the tag's commit, and
   requires pull requests, CI, and resolved threads from then on, as on `main`.
3. Open a pull request into `site-VERSION` that applies only the documentation
   part of the fix, usually by cherry-picking it, and changes nothing outside
   `docs/`. Its CI checks the pages against that release's code. Merge it. Name
   its task branch without the `site-` prefix, which the ruleset reserves: it
   refuses to create such a branch at a commit that CI has not passed.
4. Dispatch **Pages** on `main` with `tag` set to the version and `corrections`
   checked (`gh workflow run pages.yml -f tag=VERSION -f corrections=true`). The
   workflow deploys only that release's `site-VERSION` branch, and refuses a tag
   that is not the newest stable release and a branch that does not descend from
   the tag or that changes anything outside `docs/`, renames included. It checks
   the Markdown, builds the site, and writes `version.json` with the version,
   the tag's commit, and the commit it built.
5. Run `npm run check:live` to confirm what is deployed.

The package and its tag stay as they were published; the corrections ship in the
next version from `main`. The next stable release deploys its own tag, which
replaces the corrected site. Like tags, `site-VERSION` branches cannot be
deleted, and each stays as the record of what its release's site showed.
