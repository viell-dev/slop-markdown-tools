# Markdown Tools

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

## Getting started

The CLI requires Node.js 22.12 or newer. For development and the checkout setup
below, use Node.js 22.22.2+ or 24.15.0+ and npm 10 or newer; Node.js 24 LTS is
preferred. This prerelease is distributed from the repository; it has not been
published to the npm registry.

```sh
git clone https://github.com/viell-dev/slop-markdown-tools.git
cd slop-markdown-tools
npm ci
npm run build
node dist/cli/main.js --help
```

From this checkout, inspect a separate document workspace:

```sh
node dist/cli/main.js lint --root /path/to/documents --json
node dist/cli/main.js format --root /path/to/documents --diff
node dist/cli/main.js format --root /path/to/documents --write
node dist/cli/main.js format --root /path/to/documents --check
```

The installed command is `mdtools`; callers can install this checkout as a local
dependency. `lint` never writes documents. `format` previews a diff by default
for file inputs and writes only with `--write`. For stdin, `format -` returns
formatted Markdown on stdout. Diagnostics use stderr unless `--json` requests a
structured report.

## Configuration

Place `mdtools.config.jsonc`, `mdtools.config.json`, or `mdtools.config.mjs` in
the document workspace, or supply `--config`. For example:

```jsonc
{
  "extends": ["recommended", "github"],
  "rules": {
    "style/wrap": ["warn", { "width": 80 }],
    "style/emphasis": ["warn", { "marker": "_" }],
    "style/strong": ["warn", { "marker": "*" }],
  },
  "ignore": ["vendor/**", "**/*.external.md"],
}
```

Use `"obsidian"` instead of `"github"` for a vault. The Obsidian profile
understands wikilinks, embeds, callouts, heading references, and block
references. It reads `.obsidian/app.json` to verify `strictLineBreaks: true`
before reflowing prose, and never changes Obsidian settings itself.

Only enabled rules govern formatting. Setting a rule to `"off"` preserves its
syntax choices; an explicit `"extends": []` starts with no enabled rules. An
omitted `extends` selects `recommended`. Dialect profiles and presentation
choices are separate: selecting `--dialect obsidian` changes parsing, while the
`obsidian` preset also enables its associated rules.

```sh
mdtools config explain notes/example.md
mdtools rules
```

See [configuration and rules](docs/configuration.md) for presets, path
overrides, link policies, suppression comments, and exit codes. See
[plugins and library API](docs/plugins.md) for custom rules, presets, and syntax
extensions.

## Supported behavior

- Reflow paragraphs and simple list/quote containers while protecting links,
  code, math, and explicit hard breaks. Unbreakable atoms may exceed the
  configured width.
- Normalize emphasis delimiters, table alignment, ATX headings, completed task
  markers, and GitHub/Obsidian callout marker casing when the corresponding
  rules are enabled.
- Validate local link destinations, GitHub heading slugs, and Obsidian
  heading/block references.
- Rewrite verified link paths, angle brackets, Markdown extensions, and eligible
  Markdown/wikilink notation without guessing missing or ambiguous targets.
- Load JavaScript rule plugins and shared presets; apply rules selectively by
  file pattern.
- Return JSON diagnostics suitable for agents and automation.

The formatter compares parsed meaning before and after edits, rejects
overlapping edits and nonconvergent rules, and leaves a document unchanged if
its safety check fails. File writes use atomic replacement and check for
concurrent modification. These checks are regression safeguards, not a proof of
identical rendering in every Markdown application. See
[design and limitations](docs/design.md).

## Contributions and verification

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
Markdown Tools for documentation, the build, and regression/property/CLI tests.
GitHub Actions runs checks on Linux with Node.js 22 and 24, plus macOS and
Windows with Node.js 24. Changes to formatting need tests for expected output,
idempotence, and preserved semantics; defects should add a regression example.
Keep fixes scoped and describe remaining limitations in the PR.

Agent contributors should read
[AGENTS.md](https://github.com/viell-dev/slop-markdown-tools/blob/main/AGENTS.md)
for maintenance-specific instructions. `test:package` packs and installs a
temporary consumer project, then exercises the installed CLI and library; it can
require access to the npm registry.

## License

[MIT](LICENSE).
