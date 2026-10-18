# Releasing

Publishing a version needs the repository owner's explicit authorization for
that release. Preparing a pull request or a tested package does not supply it,
and neither do the configured trusted publisher or the `NPM_PUBLISH_ENABLED`
variable, which only make publication possible. Published versions, tags, and
release assets are never replaced: a correction gets a new version.

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
   maintainers (`npm view NAME time maintainers`).
5. Run the checks below, push, and wait for CI.

Review and merge it like any other pull request. Merging publishes nothing and
leaves the documentation site as it is.

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

The **Release** workflow, dispatched with `publish` left false, does the same on
GitHub, adds an audit of the runtime dependencies, and keeps the artifact for 14
days.

## Publication prerequisites

Check these GitHub settings with `gh` before each publication:

- The environment `npm-release` allows deployments only from the branch `main`,
  by name. "Protected branches only" is not enough: GitHub documents it for
  branch protection rules, and `main` is protected by a ruleset.
- The repository variable `NPM_PUBLISH_ENABLED` is `true`.
- GitHub Pages uses GitHub Actions as its source, and the environment
  `github-pages` allows deployments from `main`, where the Pages workflow runs.
- The ruleset for `main` requires pull requests and the three CI checks that
  `.github/rulesets/main.json` names.

The npm settings are visible only to the package's maintainer, `viell`, signed
in on npmjs.com, in the package's **Settings** tab:

- **Trusted publishing** ([npm's
  guide](https://docs.npmjs.com/trusted-publishers/)) has one entry, for GitHub
  Actions: the user `viell-dev`, the repository `slop-markdown-tools`, the
  workflow `release.yml`, and the environment `npm-release`, with direct
  publishing allowed. No npm token is stored in GitHub.
- **Publishing access** is "Require two-factor authentication and disallow
  tokens". Trusted publishing still works; publishing with a token does not, and
  a change made by hand on the account, such as a dist-tag, asks for the second
  factor.

The maintainer checks these after setting them up or changing them, not for each
release. Only the maintainer's account can change them, and a successful
publication already shows that the entry for this workflow exists. It cannot
show that no other entry exists: npm accepts up to ten trusted publishers per
package, and each of them can publish.

## Publish

Merge the release pull request after its checks pass, and review the version,
the changelog section, and the package manifest once more. Then dispatch
**Release** on `main` with the exact version, `publish: true`, and the
publishing agent's identity as `model via harness`. The workflow builds and
checks the package again, verifies the artifact's checksum, publishes the tested
tarball with provenance under `publishConfig.tag`, which it checks against the
version, and creates the GitHub release at the workflow's commit, with the
tarball and checksum attached and the changelog section as its notes. Tags are
exact versions without a `v` prefix.

A last job, with read-only access, then checks the publication: the registry's
`integrity` and `shasum` must match the tested tarball, and the version's
provenance must name that tarball, the Release workflow, and the workflow's
commit. It waits up to five minutes for the registry to know the version. If
only this job failed, re-run it with `gh run rerun RUN --failed`; it does not
publish again. When the Release run succeeds for a stable version, the **Pages**
workflow builds the documentation site from the new tag and deploys it; a
prerelease leaves the site on the newest stable release. To deploy a release's
site by hand, dispatch **Pages** on `main` with the version as its `tag`.

The workflow refuses a version or tag that already exists. Never run publication
again for an existing version. If npm succeeded but the GitHub release failed,
download the run's artifact with
`gh run download RUN --name npm-release --dir artifacts`, check the publication
with
`node scripts/verify-publication.mjs VERSION ./artifacts/mdrefine-VERSION.tgz COMMIT`,
where `COMMIT` is the run's commit, and finish only the GitHub step at that
commit. Then deploy the site by hand for a stable version. Attach every asset
before a release is published, because published releases are immutable.

## Verify

Once npm has processed the version, its dist-tag should name it:

```sh
npm dist-tag ls mdrefine
```

Then install the package into a fresh project with an empty cache and run
`npm audit signatures` there, which verifies the signatures of the registry and
of the provenance; the workflow's check only reads what the provenance names.
Check the GitHub release and its assets, the result of the publication check,
and, for a stable version, the documentation site. Work after the release
continues through pull requests.
