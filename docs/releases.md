# Releases

## Current status

`mdrefine@0.1.0-beta.1` is prepared but **not published**. No release tag or
GitHub release has been created. The npm name returned no existing package at
the time of preparation; availability is not a reservation or a guarantee that
npm will accept the name. The executable remains `mdtools`.

Read the [beta.1 release notes](releases/0.1.0-beta.1.md). Before publishing,
update this page, the README, the quick start, and plugin installation guidance
through a PR so they describe the intended published version accurately.

## Prepare without publishing

Use Node.js 24 and npm 10 or newer from a clean checkout:

```sh
npm ci
npm run release:prepare
npm publish ./artifacts/mdrefine-0.1.0-beta.1.tgz --dry-run --ignore-scripts --access public --tag beta
```

Preparation runs all checks, packs the allowlisted files, installs that exact
tarball into a temporary consumer, exercises the installed command and library,
and compiles a TypeScript consumer. It retains the tested tarball, file
manifest, and SHA-256 checksum in ignored `artifacts/`. No registry upload, Git
tag, or GitHub release occurs. Local artifacts must be regenerated after any
change.

The manual **Release** GitHub Actions workflow performs the same checks plus a
dependency audit and uploads the artifact for 14 days. Leave `publish` false to
prepare only. CI independently checks Linux, macOS, Windows, and Node.js 22/24.

## Publication prerequisites

Publication requires explicit operator authorization. Preparing a PR or artifact
does not supply that authorization. Before the first publication:

1. Merge the release PR with all required checks passing. Review the tarball
   manifest, release notes, version, and registry name again.
2. Arrange npm account access, verified email, and required two-factor
   authentication. This checkout has no authenticated npm account. Bootstrap
   publication may need an authenticated local publish before package settings
   are available for trusted publishing.
3. Configure npm's
   [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for user
   `viell-dev`, repository `slop-markdown-tools`, workflow `release.yml`, and
   environment `npm-release`. Allow direct `npm publish`. No long-lived npm
   token is stored in GitHub.
4. Restrict the GitHub `npm-release` environment to `main` and configure an
   approval gate if an independent approver is available. Verify branch rules
   still require PRs and the four CI checks. The workflow uses Node.js 24 and
   checks that npm supports trusted publishing.
5. Only after authorization and authentication setup, set repository variable
   `NPM_PUBLISH_ENABLED` to `true`. It is disabled during preparation.

## Publish an authorized beta

Dispatch **Release** on `main` with the exact package version, `publish: true`,
and the actual publishing agent's identity as `model via harness`. The workflow
builds and checks the package again, verifies the artifact checksum, publishes
that tarball to npm's `beta` channel with provenance, and creates a GitHub
prerelease at the workflow's commit. Tags use exact versions without a `v`
prefix. Stable publication deliberately needs a separate policy change; this
workflow accepts only beta versions and never assigns npm's `latest` tag.

For an authenticated first publication that cannot use OIDC yet, use the exact
reviewed tarball with `npm publish <tarball> --ignore-scripts --access public
--tag beta` only after authorization. Then create the matching GitHub
prerelease at the exact source commit, attach the tarball and checksum, and use
the reviewed notes with the actual publishing agent attribution. Complete npm
trusted publisher setup afterward.

If npm succeeds but GitHub release creation fails, do not republish or bump the
version blindly. Verify the published package integrity against the retained
artifact and finish only the missing GitHub step at the same commit. Published
versions, tags, and release assets must never be overwritten; corrections use a
new version. The workflow refuses an existing npm version or tag to make a
partial release visible instead of silently accepting it.

After publication, verify registry metadata, the `beta` dist-tag, a fresh
installation, the GitHub release and its assets, and the documentation site. All
subsequent changes, including prerelease maintenance, continue through PRs.
