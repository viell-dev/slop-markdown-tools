# Versions

Version numbers follow [Semantic Versioning](https://semver.org/). Before 1.0,
the second number plays the part of the first: a minor release such as 0.3.0 may
change what 0.2 does, and the [changelog](changelog.md) says how, while a patch
release such as 0.2.1 only fixes defects.

## What a version number covers

- the `mdtools` commands, their options, and their exit codes;
- the [JSON report](cli.md#json-report) printed with `--json`: its fields and
  what they mean;
- the configuration: file names, keys, presets, dialect names, rule IDs, rule
  options, what each of them means, and where its
  [JSON Schema](configuration.md#json-schema) is found;
- the library's exports from `mdrefine` and `mdrefine/node`, their TypeScript
  types, and the plugin contract described in [library API](api.md) and
  [plugins](plugins.md);
- the supported Node.js versions, given by `engines` in `package.json`.

These can change in any release:

- the wording of messages: diagnostics, warnings, and the summary line. A script
  should read the exit code and the JSON report, whose diagnostics carry rule
  IDs.
- formatting output that changes because a defect is fixed. A patch release can
  format a document differently where the previous version damaged it, refused
  it, or read it the wrong way, and can report findings that the defect hid.
- speed and memory use, and the figures on the [benchmark page](benchmarks.md).
- files of the package that the documentation does not describe.

A deliberate change of what formatting produces, such as a new default, a rule
added to a preset, or a changed option, comes in a minor release, and so does a
higher minimum Node.js version. Pin the exact version, as the
[installation](quick-start.md#install) does, so that you choose when such a
change reaches your documents.

## Releases and channels

From 0.2.0, the first stable release, npm's `latest` tag names the newest stable
release. Release candidates and betas are published under the tags `rc` and
`beta` and leave `latest` alone. Only the newest release line receives fixes;
see the [security
policy](https://github.com/viell-dev/slop-markdown-tools/blob/main/SECURITY.md).
This site describes the newest stable release.

A version named in the repository is not necessarily published. The registry is
the source of truth:

```sh
npm view mdrefine versions
```

Each release has a [GitHub
release](https://github.com/viell-dev/slop-markdown-tools/releases) with the
tested package and its checksum.
