# Releases

## Versions and availability

These documents cover `mdrefine@0.2.0`, the first stable release. The executable
is `mdtools`. Read the [0.2.0 release notes](releases/0.2.0.md) for changes
since the last release candidate. Previous releases:
[0.2.0-rc.2](releases/0.2.0-rc.2.md), [0.2.0-rc.1](releases/0.2.0-rc.1.md),
[0.1.0-rc.1](releases/0.1.0-rc.1.md), [beta.4](releases/0.1.0-beta.4.md),
[beta.3](releases/0.1.0-beta.3.md), [beta.2](releases/0.1.0-beta.2.md), and
[beta.1](releases/0.1.0-beta.1.md).

The registry is the source of truth for package availability:

```sh
npm view mdrefine@0.2.0 version --registry=https://registry.npmjs.org/
```

An `E404` means the requested package or version is unavailable. A version in
this repository or its documentation does not imply publication. Check
[GitHub releases](https://github.com/viell-dev/slop-markdown-tools/releases) for
release announcements and downloadable artifacts.

The npm package is published under account `viell`. Its `latest` tag points to
the newest stable release. A release candidate or beta is published under the
channel tag named after its prerelease identifier, `rc` or `beta`, and leaves
`latest` alone, so a default installation gets a stable release. Before 0.2.0
there was no stable release, and `latest` pointed to the newest prerelease of
any kind. The `rc` tag still names the last release candidate, `0.2.0-rc.2`,
until another one is published.

## Versions and compatibility

Version numbers follow [Semantic Versioning](https://semver.org/). Before 1.0,
the second number plays the part of the first: a minor release such as 0.3.0 may
change what 0.2 does and says how in its release notes, while a patch release
such as 0.2.1 fixes defects and keeps the interface below.

The interface that version numbers describe is:

- the `mdtools` commands, their options, and their exit codes;
- the JSON report printed with `--json`: its fields and what they mean;
- the configuration: file names, keys, presets, dialect names, rule IDs, rule
  options, and what each of them means;
- the library's exports from `mdrefine`, their TypeScript types, and the plugin
  contract described in [plugins and library API](plugins.md);
- the supported Node.js versions, given by `engines` in `package.json`.

These are not part of it and can change in any release:

- the wording of messages: diagnostics, warnings, and the summary line. A script
  should read the exit code and the JSON report, whose diagnostics carry rule
  IDs.
- formatting output that changes because a defect is fixed. A patch release can
  format a document differently where the previous version damaged it, refused
  it, or read it in the wrong way, and can report findings that the defect hid.
- speed and memory use, and the figures on the [benchmark page](benchmarks.md).
- files of the package that the documentation does not describe.

A deliberate change of what formatting produces, such as a new default, a rule
added to a preset, or a changed option, comes in a minor release, and so does a
higher minimum Node.js version. The installation commands pin the exact version,
so that a workspace chooses when such a change reaches it.

Only the newest release line receives fixes; see the
[security policy](https://github.com/viell-dev/slop-markdown-tools/blob/main/SECURITY.md).

## Prepare without publishing

Use Node.js 24 and npm 10 or newer from a clean checkout:

```sh
npm ci
npm run release:prepare
npm publish ./artifacts/mdrefine-0.2.0.tgz --dry-run --ignore-scripts --access public --tag latest
```

The `--tag` is the package's `publishConfig.tag`: `latest` for a stable version,
and `rc` or `beta` for a prerelease. Preparation runs all checks, packs the
allowlisted files, installs that exact tarball into a temporary consumer,
exercises the installed command and library, and compiles a TypeScript consumer.
It retains the tested tarball, file manifest, and SHA-256 checksum in ignored
`artifacts/`. No registry upload, Git tag, or GitHub release occurs. Local
artifacts must be regenerated after any change.

The manual **Release** GitHub Actions workflow performs the same checks plus a
dependency audit and uploads the artifact for 14 days. Leave `publish` false to
prepare only. CI runs full checks on Linux/Node.js 24, compatibility tests on
Linux/Node.js 22 and Windows/Node.js 24, and installed-package checks on all
three targets.

## Publication prerequisites

Publication requires explicit authorization from the repository owner for each
release. Preparing a PR or artifact does not supply that authorization. For
subsequent releases, verify these prerequisites rather than repeating the
completed bootstrap:

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

## Publish an authorized release

Dispatch **Release** on `main` with the exact package version, `publish: true`,
and the actual publishing agent's identity as `model via harness`. The workflow
builds and checks the package again, verifies the artifact checksum, and
publishes that tarball with provenance under the package's `publishConfig.tag`,
which the workflow checks against the version: `latest` for a stable version,
and the prerelease identifier, `rc` or `beta`, for a prerelease. It then creates
a GitHub release at the workflow's commit, marked as the latest release for a
stable version and as a prerelease otherwise. Tags use exact versions without a
`v` prefix.

Publishing under `latest` moves that tag, so a stable release needs no further
npm step. Before 0.2.0, each prerelease also had to be made `latest` with an
authenticated local `npm dist-tag add mdrefine@VERSION latest`, because the
workflow's OIDC authentication covers publication but not a later tag change.
That step is no longer part of a release: a prerelease must not move `latest`
now that stable releases exist.

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

## Verify a release

Wait for npm to finish processing, then check the tags and a fresh installation
with an empty cache:

```sh
npm dist-tag ls mdrefine
```

`latest` names the new version after a stable release, and the channel tag does
after a prerelease. Verify a fresh default installation, the GitHub release and
its assets, the registry provenance, and the documentation site before reporting
the release complete. All subsequent changes, including maintenance of a release
line, continue through PRs.
