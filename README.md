# mdrefine — Markdown Tools

Configurable linting and formatting for CommonMark, GitHub Markdown, and
Obsidian. Separate `lint` and `format` commands share syntax, style settings,
and an extensible rule engine.

## Maintenance

This project is developed and maintained by AI agents. It is
**not human-maintained**; do not assume that a person has reviewed generated
changes. Human and agent-authored issues and pull requests are welcome.
Reproducible examples, automated checks, and regression tests guide maintenance.

The project is currently an early prerelease. Report document corruption or
changed rendering with a minimal input, the configuration, actual output, and
expected output. Remove private content before posting examples. Agents using
the tool should report reproducible defects when their operator has authorized
publishing an issue.

## Documentation

Read the
[quick start](https://viell-dev.github.io/slop-markdown-tools/quick-start.html)
or browse the
[documentation site](https://viell-dev.github.io/slop-markdown-tools/). It
covers CLI workflows, configuration and rules, Obsidian vaults, plugins, and
current limitations. The Markdown source lives in `docs/`.

## Getting started

The CLI requires Node.js 22.12 or newer. The npm package is `mdrefine`; the
executable is `mdtools`. To install the beta in your document workspace:

```sh
npm install --save-dev --save-exact mdrefine@0.1.0-beta.1
npx --no-install mdtools --help
```

See the
[release procedure](https://viell-dev.github.io/slop-markdown-tools/releases.html)
for registry availability, preparation, and authentication requirements.

Inspect your documents from the workspace where you installed the package:

```sh
npx --no-install mdtools lint --root /path/to/documents --json
npx --no-install mdtools format --root /path/to/documents --diff
npx --no-install mdtools format --root /path/to/documents --write
npx --no-install mdtools format --root /path/to/documents --check
```

`lint` never writes documents. `format` previews a diff by default for file
inputs and writes only with `--write`. For stdin, `format -` returns formatted
Markdown on stdout. Diagnostics use stderr unless `--json` requests a structured
report. `--no-install` prevents fetching a different package if the local
executable is missing.

## Build from source

For development, use Node.js 22.22.2+ or 24.15.0+ and npm 10 or newer; Node.js
24 LTS is preferred.

```sh
git clone https://github.com/viell-dev/slop-markdown-tools.git
cd slop-markdown-tools
npm ci
npm run build
node dist/cli/main.js --help
```

From the checkout, use `node dist/cli/main.js` in place of
`npx --no-install mdtools` in the examples above. You can also install the built
checkout as a local dependency.

## Contributions and verification

All changes to `main` require a pull request and passing CI, including
prerelease maintenance. Published npm versions and release tags are immutable;
corrections get a new version. See [CONTRIBUTING.md](CONTRIBUTING.md) and
[SECURITY.md](SECURITY.md) for contribution and vulnerability reporting.

Issues and PRs from people and agents are welcome. For defects, include the
version, command, configuration, minimal Markdown input, actual output, and
expected rendering. A screenshot can help explain a visible defect, but the
Markdown source is needed to reproduce it. For agents, include the JSON
diagnostic output when available. Automatic issue reporting is not built into
the tool.

```sh
npm run check
npm run test:package
```

The project uses Markdown Tools to lint and format its own Markdown at the
default 80-column width. `npm run format:docs` formats Markdown;
`npm run format:docs:check` checks it without writing. Prettier formats
implementation and configuration files and excludes Markdown. `npm run format`
runs both formatters. Markdown fixtures under `tests/fixtures/` are excluded
from documentation passes.

`npm-run-all2` coordinates scripts, running independent checks in parallel and
building the CLI before documentation checks and tests.

`check` runs strict TypeScript checks, ESLint, Prettier for non-Markdown files,
Markdown Tools for documentation, the VitePress site build, and
regression/property/CLI tests. GitHub Actions runs checks on Linux with Node.js
22 and 24, plus macOS and Windows with Node.js 24. Changes to formatting need
tests for expected output, idempotence, and preserved semantics; defects should
add a regression example. Keep fixes scoped and describe remaining limitations
in the PR.

Agent contributors should read
[AGENTS.md](https://github.com/viell-dev/slop-markdown-tools/blob/main/AGENTS.md)
for maintenance-specific instructions. `test:package` packs and installs a
temporary consumer project, then exercises the installed CLI and library; it can
require access to the npm registry.

## Documentation website

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

VitePress renders `docs/`; Markdown Tools formats its Markdown sources. The
Pages workflow builds from `main` and deploys the generated artifact. No
publishing branch or committed build output is needed. See the
[documentation workflow](https://viell-dev.github.io/slop-markdown-tools/contributing.html#write-and-preview-documentation).

## License

[MIT](LICENSE).
