# Releases

## Versions and availability

These documents cover `mdrefine@0.1.0-beta.4`. The executable is `mdtools`;
prereleases use npm's `beta` channel. Read the
[beta.4 release notes](releases/0.1.0-beta.4.md) for changes and limitations.
Previous releases: [beta.3](releases/0.1.0-beta.3.md),
[beta.2](releases/0.1.0-beta.2.md), and [beta.1](releases/0.1.0-beta.1.md).

The registry is the source of truth for package availability:

```sh
npm view mdrefine@0.1.0-beta.4 version --registry=https://registry.npmjs.org/
```

An `E404` means the requested package or version is unavailable. A version in
this repository or its documentation does not imply publication. Check
[GitHub releases](https://github.com/viell-dev/slop-markdown-tools/releases) for
release announcements and downloadable artifacts.

The initial beta was published locally under npm account `viell`. npm assigned
both `beta` and `latest` to `0.1.0-beta.1` despite an explicit `--tag beta`;
removing `latest` returned E400. Keep the tag: until the first stable release,
`latest` and `beta` must point to the same current beta, so default
installations receive fixes. Once a stable release exists, `latest` follows
stable releases and `beta` remains the prerelease channel.

## Prepare without publishing

Use Node.js 24 and npm 10 or newer from a clean checkout:

```sh
npm ci
npm run release:prepare
npm publish ./artifacts/mdrefine-0.1.0-beta.4.tgz --dry-run --ignore-scripts --access public --tag beta
```

Preparation runs all checks, packs the allowlisted files, installs that exact
tarball into a temporary consumer, exercises the installed command and library,
and compiles a TypeScript consumer. It retains the tested tarball, file
manifest, and SHA-256 checksum in ignored `artifacts/`. No registry upload, Git
tag, or GitHub release occurs. Local artifacts must be regenerated after any
change.

The manual **Release** GitHub Actions workflow performs the same checks plus a
dependency audit and uploads the artifact for 14 days. Leave `publish` false to
prepare only. CI runs full checks on Linux/Node.js 24, compatibility tests on
Linux/Node.js 22 and Windows/Node.js 24, and installed-package checks on all
three targets.

## Publication prerequisites

Publication requires explicit operator authorization. Preparing a PR or artifact
does not supply that authorization. For subsequent releases, verify these
prerequisites rather than repeating the completed bootstrap:

1. Merge the release PR with all required checks passing. Review the tarball
   manifest, release notes, version, and registry name again.
2. Arrange npm account access, verified email, and required two-factor
   authentication. Verify the intended account with `npm whoami`. Bootstrap
   publication may need an authenticated local publish before package settings
   are available for trusted publishing.
3. Configure npm's
   [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for user
   `viell-dev`, repository `slop-markdown-tools`, workflow `release.yml`, and
   environment `npm-release`. Allow direct `npm publish`. No long-lived npm
   token is stored in GitHub.
4. Restrict the GitHub `npm-release` environment to `main` and configure an
   approval gate if an independent approver is available. Verify branch rules
   still require PRs and the three CI checks. The workflow uses Node.js 24 and
   checks that npm supports trusted publishing.
5. Repository variable `NPM_PUBLISH_ENABLED` is `true` after verified trusted
   publisher setup. This enables the workflow's capability; it does not
   authorize a release. Preparation uses `publish: false` regardless of this
   variable's value.

Trusted-publisher settings were verified on 2026-09-18. The first release used
local authentication and has no OIDC provenance. For workflow releases, verify
the publication job and the registry provenance attestations after each release.

## Publish an authorized beta

Dispatch **Release** on `main` with the exact package version, `publish: true`,
and the actual publishing agent's identity as `model via harness`. The workflow
builds and checks the package again, verifies the artifact checksum, publishes
that tarball to npm's `beta` channel with provenance, and creates a GitHub
prerelease at the workflow's commit. Tags use exact versions without a `v`
prefix. Stable publication deliberately needs a separate policy change; this
workflow accepts only beta versions and requests the `beta` tag. Complete the
npm tag synchronization below before reporting a pre-stable release complete.

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

GitHub enforces immutability for future releases and their assets. Attach all
assets before publishing a release. The existing beta.1 release predates that
setting, so its assets are not retroactively locked; its version tag remains
protected by the repository ruleset. Do not replace its assets or recreate the
release to change that history.

## Synchronize npm tags before the first stable release

After each authorized beta publication, wait for npm processing to finish and
verify that `beta` points to the expected version. Until the first stable
release, move `latest` to that same version using an authenticated local npm
session. For the current beta:

```sh
npm_config_cache="$PWD/.npm-cache" npm dist-tag add mdrefine@0.1.0-beta.4 latest
npm_config_cache="$PWD/.npm-cache" npm dist-tag ls mdrefine
```

Use the exact newly published version on future releases. npm's
[OIDC authentication](https://docs.npmjs.com/trusted-publishers/) supports
publication, but does not authenticate `dist-tag` updates. The Release workflow
records this required follow-up in its summary; complete browser authentication
locally if npm requests it. Keep the waiting command alive and never put
authentication secrets in chat or repository files.

Tag synchronization is part of an authorized beta release. It does not publish
another version or change package contents. If promotion fails, retry only the
tag update after resolving authentication; never rerun publication. Do not try
to remove `latest`. Stop promoting betas to `latest` when the first stable
release is published.

Verify both tags, a fresh default installation, the GitHub release and its
assets, registry provenance, and the documentation site before reporting the
release complete. All subsequent changes, including prerelease maintenance,
continue through PRs.
