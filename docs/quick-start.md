# Quick start

Get the CLI running, select a profile, and preview a formatting pass before
writing changes.

## Install the beta

The CLI requires Node.js 22.12 or newer. Install the package in your document
workspace:

```sh
npm install --save-dev --save-exact mdrefine@0.1.0-beta.4
npx --no-install mdtools --help
```

The npm package is `mdrefine`; the executable is `mdtools`. Prereleases use the
`beta` channel. See
[versions and availability](releases.md#versions-and-availability) for registry
checks and release announcements.

Run the examples below from the workspace where you installed the package.
`--no-install` prevents fetching a different package if the local executable is
missing. Replace `/path/to/documents` with your document folder; quote paths
containing spaces.

## Install from the repository

To build a checkout instead, use Node.js 22.22.2+ or 24.15.0+ and npm 10 or
newer; Node.js 24 LTS is preferred.

```sh
git clone https://github.com/viell-dev/slop-markdown-tools.git
cd slop-markdown-tools
npm ci
npm run build
node dist/cli/main.js --help
```

From that checkout, use `node dist/cli/main.js` in place of
`npx --no-install mdtools` in the examples below.

## Choose a configuration

Create `mdtools.config.jsonc` in your document folder:

```jsonc
{
  "extends": ["recommended", "github"],
  "ignore": ["vendor/**", "**/*.external.md"],
}
```

The recommended preset wraps prose at **80 columns**, uses `_` for emphasis and
`**` for strong text, ensures a final newline, and validates local links. The
GitHub preset adds table, task marker, and alert marker rules. The configuration
controls both linting and formatting.

For CommonMark, use only `"recommended"`. For a vault, replace `"github"` with
`"obsidian"` and follow the [Obsidian setup](obsidian.md).

## Lint without writing

```sh
npx --no-install mdtools lint --root /path/to/documents
```

Lint reports diagnostics and never changes files. Add `--json` for structured
output, or `--max-warnings 0` to make warnings fail an automated check.

## Preview and apply formatting

```sh
npx --no-install mdtools format --root /path/to/documents --diff
npx --no-install mdtools format --root /path/to/documents --write
npx --no-install mdtools format --root /path/to/documents --check
```

Review the diff before running `--write`. The final check exits with code `1` if
formatting changes remain. Formatting may still report lint problems that
require a manual correction; inspect diagnostics as well as the exit code.

## Adjust the rules

Override a preset rule by adding a `rules` object:

```jsonc
{
  "extends": ["recommended", "github"],
  "rules": {
    "style/wrap": ["warn", { "width": 100 }],
    "style/emphasis": "off",
  },
}
```

This wraps at 100 columns and preserves existing emphasis delimiters. Use
`"extends": []` to start with no enabled rules.

Continue with [CLI workflows](cli.md) for automation and file selection, or
[configuration and rules](configuration.md) for presets, links, overrides, and
suppression comments.
